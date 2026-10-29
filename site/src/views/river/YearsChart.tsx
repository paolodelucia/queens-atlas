import { useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent, PointerEvent } from 'react';
import { yearLabel } from '../../data/taxonomy';
import type { CohortId } from '../../data/types';
import { fmtInt, fmtPct } from '../../lib/format';
import { useElementWidth } from './hooks';
import { layoutYears, nearestPoint, textWidth } from './layout';
import type { YearsLayout, YearsLayoutOptions } from './layout';
import {
  FIELD_FLOOR, REST, classesPhrase, classesReached, cohortYears, defaultYearIndex, familyLabel, groupColor, toneOf, yearReadout,
} from './model';
import type { BandKey, YearSeries } from './model';
import { yearsShape } from './morph';
import type { MorphSource } from './morph';

const FALLBACK_WIDTH = 960; // before the first measurement (and in jsdom)
/** Containers at least this wide put the readout beside the chart; narrower ones put it below. */
const SIDE_BY_SIDE = 720;
const READOUT_W = 300;
const GAP = 24;
/** Readout rows shown before "Show all". */
const ROWS_SHOWN = 8;

export function yearsOptions(width: number): Omit<YearsLayoutOptions, 'width'> {
  const narrow = width < 520;
  return {
    height: narrow ? 300 : 380,
    margin: { top: 30, right: 4, bottom: 62, left: narrow ? 36 : 42 },
    todayGap: narrow ? 14 : 22,
    barWidth: narrow ? 20 : 30,
    fontSize: narrow ? 11 : 12,
  };
}

/** "Year 5" / "First destination" / "Today". */
const pointName = (year: number | 'now') => yearLabel(year);

export interface YearsChartProps {
  /** Id on the wrapper (the target of the switches' aria-controls). */
  id?: string;
  series: YearSeries;
  /** Accessible name of the chart, e.g. "Commerce, class of 2010–2014". */
  title: string;
  cohort: CohortId;
  /** river.json meta.snapshot ("2025-09"). */
  snapshot: string;
  /** e.g. "Sep 2025". */
  snapshotText: string;
  /** Smallest published count of people by field (meta.k.field). */
  floor?: number;
  /** Hands the tab-switch morph this chart's bands and where they are (null on unmount). */
  onMorphSource?: (source: MorphSource | null) => void;
}

/**
 * The field mix for every year after graduating, as a stacked area: each year's bands are shares of
 * the people who had reached that year, so the stack is always out of 100%, and what no published
 * count covers is drawn as a hatched "not shown" band rather than hidden. "Today" sits apart: it
 * mixes classes at different years. A scrubber (drag, click, or the arrow keys on its handle)
 * picks the year the readout lists.
 */
export function YearsChart({ id, series, title, cohort, snapshot, snapshotText, floor = FIELD_FLOOR, onMorphSource }: YearsChartProps) {
  const uid = useId();
  const hatchId = `yrs-hatch-${uid.replace(/[^a-zA-Z0-9_-]/g, '')}`;
  const hintId = `${uid}-hint`;
  const readoutId = `${uid}-readout`;
  const [setWrap, measured] = useElementWidth<HTMLDivElement>();
  const svgRef = useRef<SVGSVGElement>(null);
  const dragging = useRef(false);

  const available = measured || FALLBACK_WIDTH;
  const side = available >= SIDE_BY_SIDE;
  const width = Math.max(260, side ? available - READOUT_W - GAP : available);
  const opts = useMemo(() => yearsOptions(width), [width]);
  const layout = useMemo(() => layoutYears(series, { ...opts, width }), [series, opts, width]);
  const tones = useMemo(() => toneOf(series.groups), [series.groups]);

  useLayoutEffect(() => {
    if (!onMorphSource) return;
    onMorphSource({ svg: svgRef.current, width: layout.width, ready: measured > 0, shape: () => yearsShape(series, layout) });
    return () => onMorphSource(null);
  }, [onMorphSource, series, layout, measured]);

  // The picked point is kept as a year, so it survives a switch to "Show all fields" or a class
  // that also has it; anything else falls back to the default.
  const [picked, setPicked] = useState<number | 'now' | null>(null);
  const [preview, setPreview] = useState<number | null>(null);
  const [hoverBand, setHoverBand] = useState<BandKey | null>(null);
  const [expanded, setExpanded] = useState(false);
  const pickedAt = picked == null ? -1 : series.rows.findIndex((r) => r.year === picked);
  const selected = pickedAt >= 0 ? pickedAt : defaultYearIndex(series);
  const shown = preview != null && series.rows[preview] ? preview : selected;
  const readout = yearReadout(series, shown);
  const sel = yearReadout(series, selected);

  const commit = (index: number) => {
    const row = series.rows[index];
    if (row) setPicked(row.year);
  };

  // ── Pointer: hover previews a year; press, drag or click keeps it ───────
  const xOf = (e: PointerEvent<SVGSVGElement>) => {
    const r = svgRef.current?.getBoundingClientRect();
    if (!r || !r.width) return null;
    return ((e.clientX - r.left) * layout.width) / r.width;
  };
  const onPointerDown = (e: PointerEvent<SVGSVGElement>) => {
    const x = xOf(e);
    if (x == null) return;
    dragging.current = true;
    try { e.currentTarget.setPointerCapture?.(e.pointerId); } catch { /* not capturable (synthetic events) */ }
    commit(nearestPoint(layout, x));
    setPreview(null);
  };
  const onPointerMove = (e: PointerEvent<SVGSVGElement>) => {
    const x = xOf(e);
    if (x == null) return;
    const i = nearestPoint(layout, x);
    if (dragging.current) commit(i);
    else if (e.pointerType === 'mouse') setPreview(i);
    const band = (e.target as Element | null)?.closest?.('[data-band]')?.getAttribute('data-band') as BandKey | null;
    setHoverBand(band ?? null);
  };
  const onPointerUp = () => { dragging.current = false; };
  const onPointerLeave = () => { if (!dragging.current) { setPreview(null); setHoverBand(null); } };

  const onKeyDown = (e: KeyboardEvent<SVGGElement>) => {
    const last = series.rows.length - 1;
    let next: number;
    switch (e.key) {
      case 'ArrowLeft': case 'ArrowDown': next = selected - 1; break;
      case 'ArrowRight': case 'ArrowUp': next = selected + 1; break;
      case 'PageDown': next = selected - 5; break;
      case 'PageUp': next = selected + 5; break;
      case 'Home': next = 0; break;
      case 'End': next = last; break;
      default: return;
    }
    e.preventDefault();
    setPreview(null);
    commit(Math.max(0, Math.min(last, next)));
  };

  const empty = series.rows.length === 0;
  const valueText = sel ? describe(sel, cohort, snapshot) : '';
  const p = layout.points[shown];
  const ps = layout.points[selected];
  const trackY = layout.plot.y1 + 18;
  const dim = (key: BandKey) => hoverBand != null && hoverBand !== key;

  return (
    <div id={id} className={`yrs${side ? ' yrs--side' : ''}`} ref={setWrap}>
      {empty ? (
        <p className="yrs-empty">No year has enough people to publish for this class.</p>
      ) : (
        <>
          <div className="yrs-chart">
            <svg
              ref={svgRef}
              className="yrs-svg"
              width={Math.round(layout.width)}
              height={Math.round(layout.height)}
              viewBox={`0 0 ${Math.round(layout.width)} ${Math.round(layout.height)}`}
              role="group"
              aria-label={`Year by year: ${title}. Share of people in each field, ${pointName(series.rows[0].year).toLowerCase()} to ${pointName(series.rows[series.rows.length - 1].year).toLowerCase()}.`}
              aria-describedby={hintId}
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerCancel={onPointerUp}
              onPointerLeave={onPointerLeave}
            >
              <defs>
                <pattern id={hatchId} width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
                  <rect width="6" height="6" className="yrs-hatch__bg" />
                  <line x1="0" y1="0" x2="0" y2="6" className="yrs-hatch__line" />
                </pattern>
              </defs>
              <rect className="yrs-svg__bg" width={layout.width} height={layout.height} />
              <YAxis layout={layout} />
              <g className="yrs-bands" aria-hidden="true">
                {layout.shapes.map((s) => (
                  <path
                    key={s.key}
                    data-band={s.key}
                    d={s.d}
                    className={`yrs-band${s.key === REST ? ' yrs-band--rest' : ''}${dim(s.key) ? ' is-dim' : ''}`}
                    style={s.key === REST
                      ? { fill: `url(#${hatchId})` }
                      : { fill: groupColor(s.key), fillOpacity: tones.get(s.key) ?? 1 }}
                  />
                ))}
              </g>
              {layout.partial && <Partial layout={layout} />}
              <g className="yrs-labels" aria-hidden="true" style={{ fontSize: opts.fontSize }}>
                {layout.labels.map((l) => (
                  <text key={l.key} x={l.x} y={l.y} dy="0.35em" textAnchor="middle" className={dim(l.key) ? 'is-dim' : undefined}>{l.text}</text>
                ))}
              </g>
              {/* The year on screen: a hover preview (dashed) and the kept year (solid). */}
              <g aria-hidden="true">
                {preview != null && p && preview !== selected && <Cursor layout={layout} x={p.x} bar={p.bar} preview />}
                {ps && <Cursor layout={layout} x={ps.x} bar={ps.bar} />}
              </g>
              <XAxis layout={layout} trackY={trackY} />
              {ps && (
                <g
                  className="yrs-knob"
                  role="slider"
                  tabIndex={0}
                  aria-label="Year after graduating"
                  aria-valuemin={0}
                  aria-valuemax={series.rows.length - 1}
                  aria-valuenow={selected}
                  aria-valuetext={valueText}
                  aria-controls={readoutId}
                  onKeyDown={onKeyDown}
                  transform={`translate(${ps.x},${trackY})`}
                >
                  <circle className="yrs-knob__hit" r={18} />
                  <circle className="yrs-knob__ring" r={13} />
                  <circle className="yrs-knob__dot" r={8} />
                </g>
              )}
            </svg>
            <p id={hintId} className="yrs-hint">
              <span>Each year adds up to 100% of the people who had reached it. Related fields share a colour.</span>{' '}
              <span className="yrs-hint__pointer">Hover to read a year; click or drag to keep it.</span>{' '}
              <span className="sr-only">Keyboard: focus the year handle and use the arrow keys, Home and End. Every number is also in the table view.</span>
            </p>
          </div>
          {readout && (
            <Readout
              id={readoutId}
              readout={readout}
              cohort={cohort}
              snapshot={snapshot}
              snapshotText={snapshotText}
              floor={floor}
              tones={tones}
              hatchId={hatchId}
              hoverBand={hoverBand}
              onHoverBand={setHoverBand}
              expanded={expanded}
              onExpand={() => setExpanded((v) => !v)}
              preview={preview != null && preview !== selected}
            />
          )}
        </>
      )}
    </div>
  );
}

/** The classes behind a point that not every member has reached (null if that can't be told apart from the whole band). */
function fewerClasses(r: NonNullable<ReturnType<typeof yearReadout>>, cohort: CohortId, snapshot: string) {
  if (!r.fewer) return null;
  const span = classesReached(cohort, r.year, snapshot);
  const all = cohortYears(cohort);
  return span && all && (span.from > all.from || span.to < all.to) ? span : null;
}

/** Screen-reader value of the year handle: "Year 13: 3,923 people (the classes of 2010–2012). Largest: Finance & accounting, 31%." */
function describe(r: NonNullable<ReturnType<typeof yearReadout>>, cohort: CohortId, snapshot: string): string {
  const span = fewerClasses(r, cohort, snapshot);
  const top = r.rows[0];
  return `${pointName(r.year)}: ${fmtInt(r.n)} people${span ? ` (${classesPhrase(span)})` : ''}.${top ? ` Largest: ${familyLabel(top.group)}, ${fmtPct(top.share, 1)}.` : ''}`;
}

function YAxis({ layout }: { layout: YearsLayout }) {
  return (
    <g className="yrs-axis" aria-hidden="true">
      {layout.yTicks.map((t) => (
        <text key={t.label} x={layout.plot.x0 - 8} y={t.y} dy="0.35em" textAnchor="end">{t.label}</text>
      ))}
    </g>
  );
}

function XAxis({ layout, trackY }: { layout: YearsLayout; trackY: number }) {
  const first = layout.points[0];
  const last = layout.points[layout.points.length - 1];
  const yearsEnd = [...layout.points].reverse().find((p) => p.year !== 'now');
  return (
    <g className="yrs-axis" aria-hidden="true">
      <line className="yrs-track" x1={first?.x ?? 0} x2={last?.x ?? 0} y1={trackY} y2={trackY} />
      {layout.xTicks.map((t, i) => (
        <g key={i}>
          <circle className="yrs-track__tick" cx={t.x} cy={trackY} r={t.label ? 2.5 : 1.5} />
          {t.label && (
            <text x={labelX(t.x, t.label, layout.width)} y={trackY + 24} textAnchor="middle" className={t.label === 'Today' ? 'yrs-axis__today' : undefined}>
              {t.label}
            </text>
          )}
        </g>
      ))}
      {yearsEnd && first && yearsEnd.x - first.x > 160 && (
        <text className="yrs-axis__title" x={(first.x + yearsEnd.x) / 2} y={trackY + 42} textAnchor="middle">years after graduating</text>
      )}
    </g>
  );
}

/** Keep an axis label inside the svg ("Today" sits on the right edge). */
function labelX(x: number, label: string, width: number): number {
  const half = (textWidth(label, 11) * 1.12) / 2;
  return Math.max(half + 1, Math.min(x, width - half - 1));
}

function Cursor({ layout, x, bar, preview }: { layout: YearsLayout; x: number; bar: { x0: number; x1: number } | null; preview?: boolean }) {
  const { y0, y1 } = layout.plot;
  if (bar) {
    return <rect className={`yrs-cursor yrs-cursor--bar${preview ? ' is-preview' : ''}`} x={bar.x0 - 2} y={y0 - 2} width={bar.x1 - bar.x0 + 4} height={y1 - y0 + 4} rx={3} />;
  }
  return <line className={`yrs-cursor${preview ? ' is-preview' : ''}`} x1={x} x2={x} y1={y0} y2={y1 + 18} />;
}

/** Later years cover only the earlier classes of a band: a dashed line, a short note, and a light veil. */
function Partial({ layout }: { layout: YearsLayout }) {
  const part = layout.partial!;
  const { y0, y1, x1: plotRight } = layout.plot;
  const text = `year ${part.year} on: earlier classes only`;
  const w = textWidth(text, 11);
  const flip = part.x + 6 + w > plotRight && part.x - 6 - w >= layout.plot.x0;
  return (
    <g className="yrs-partial" aria-hidden="true">
      <rect className="yrs-partial__veil" x={part.x} y={y0} width={Math.max(0, part.x1 - part.x)} height={y1 - y0} />
      <line className="yrs-partial__line" x1={part.x} x2={part.x} y1={y0 - 16} y2={y1} />
      <text className="yrs-partial__text" x={flip ? part.x - 6 : part.x + 6} y={y0 - 8} textAnchor={flip ? 'end' : 'start'}>{text}</text>
    </g>
  );
}

function Readout({
  id, readout, cohort, snapshot, snapshotText, floor, tones, hatchId, hoverBand, onHoverBand, expanded, onExpand, preview,
}: {
  id: string;
  readout: NonNullable<ReturnType<typeof yearReadout>>;
  cohort: CohortId;
  snapshot: string;
  snapshotText: string;
  floor: number;
  tones: Map<string, number>;
  hatchId: string;
  hoverBand: BandKey | null;
  onHoverBand: (k: BandKey | null) => void;
  expanded: boolean;
  onExpand: () => void;
  preview: boolean;
}) {
  const span = fewerClasses(readout, cohort, snapshot);
  const rows = expanded ? readout.rows : readout.rows.slice(0, ROWS_SHOWN);
  const more = readout.rows.length - ROWS_SHOWN;
  return (
    <div id={id} className={`yrs-readout${preview ? ' is-preview' : ''}`}>
      <p className="yrs-readout__eyebrow">
        {pointName(readout.year)}{readout.year === 'now' ? ` · ${snapshotText}` : ''}
      </p>
      <p className="yrs-readout__n"><span className="num">{fmtInt(readout.n)}</span> people</p>
      {readout.fewer && (
        <p className="yrs-readout__note">
          {span
            ? <>Only {classesPhrase(span)} {span.from === span.to ? 'has' : 'have'} reached {pointName(readout.year).toLowerCase()}.</>
            : <>Not everyone in this class has reached {pointName(readout.year).toLowerCase()} yet.</>}
        </p>
      )}
      {readout.small && <p className="yrs-readout__note">Small group: shares can jump a few points.</p>}
      <ul className="yrs-readout__list">
        {rows.map((r) => (
          <li
            key={r.group}
            className={hoverBand === r.group ? 'is-hl' : undefined}
            onPointerEnter={() => onHoverBand(r.group)}
            onPointerLeave={() => onHoverBand(null)}
          >
            <span className="yrs-readout__name">
              <span className="yrs-swatch" style={{ background: groupColor(r.group), opacity: tones.get(r.group) ?? 1 }} aria-hidden="true" />
              {familyLabel(r.group)}
            </span>
            <span className="yrs-readout__count num">{fmtInt(r.count)}</span>
            <span className="yrs-readout__share num">{fmtPct(r.share, 1)}</span>
          </li>
        ))}
        {readout.rest && (expanded || more <= 0) && (
          <li
            className={`yrs-readout__rest${hoverBand === REST ? ' is-hl' : ''}`}
            onPointerEnter={() => onHoverBand(REST)}
            onPointerLeave={() => onHoverBand(null)}
          >
            <span className="yrs-readout__name">
              <svg className="yrs-swatch yrs-swatch--rest" viewBox="0 0 12 12" aria-hidden="true"><rect width="12" height="12" fill={`url(#${hatchId})`} /></svg>
              Not shown
            </span>
            <span className="yrs-readout__why">fields under {floor} people</span>
          </li>
        )}
      </ul>
      {more > 0 && (
        <button type="button" className="yrs-readout__more" aria-expanded={expanded} aria-controls={id} onClick={onExpand}>
          {expanded ? 'Show fewer' : `Show all ${readout.rows.length + (readout.rest ? 1 : 0)}`}
        </button>
      )}
      {readout.over && (
        <p className="yrs-readout__note yrs-readout__note--muted">Shares add up to a bit more than 100% here: every count is nudged slightly.</p>
      )}
    </div>
  );
}
