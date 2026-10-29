/**
 * Career Twin charts. Each one shows its numbers as text (a readout, direct labels or a real
 * table), so the pointer layer only adds detail, never gates it. Data colours are the sector
 * palette and --data-mono; lime and lilac never appear here.
 */
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import type { CSSProperties, KeyboardEvent, PointerEvent as ReactPointerEvent } from 'react';
import { area as d3area, curveBumpX, line as d3line, scaleLinear } from 'd3';
import type { NamedCount } from '../../data/types';
import { fmtInt } from '../../lib/format';
import { SMALL_GROUP, SMALL_NOTE, percent } from './model';
import type { ManagerPoint, SeniorityRow, TrajPoint, TrajSeries, Trajectory } from './model';

/** Container width via ResizeObserver (falls back to `initial` where layout isn't available). */
export function useWidth<T extends HTMLElement>(initial = 560) {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(initial);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver((entries) => {
      const w = Math.round(entries[0]?.contentRect.width ?? 0);
      if (w > 0) setWidth(w);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, width] as const;
}

/** Swatch style for a series: its colour, or stripes of it when the chart draws it striped. */
export function swatchStyle(s: Pick<TrajSeries, 'color' | 'striped'>): CSSProperties {
  return s.striped
    ? { background: `repeating-linear-gradient(135deg, ${s.color} 0 2.5px, var(--surface-1) 2.5px 4.5px)` }
    : { background: s.color };
}

// ── Trajectory: stacked shares, year by year, then today ─────────────────────

const TM = { top: 14, right: 6, bottom: 40, left: 40 };

interface TrajectoryProps {
  data: Trajectory;
  /** Accessible name of the whole figure ("Where Commerce grads who started in tech were, year by year"). */
  label: string;
  height?: number;
  /** Noun for counts in the readout ("people", "twins"). */
  noun?: string;
  /** Informational class year (student view): "Year 10 is 2037 for the class of 2027". */
  classYear?: number | null;
  /** Show the "Show as a table" disclosure. */
  table?: boolean;
}

type Sel = number | 'now';

/** The point a chart opens on: year 10 when the group has it, else its latest year. */
function defaultPoint(points: TrajPoint[]): Sel {
  const ten = points.find((p) => p.year === 10);
  if (ten) return 10;
  const last = points[points.length - 1];
  return last && typeof last.year === 'number' ? last.year : 'now';
}

/**
 * Tick labels that fit. `span(t)` is the label's [left, right] extent in px; a label that would
 * come within `pad` px of the one kept before it is dropped, except the last, which replaces its
 * neighbour instead (the first label always stays).
 */
export function fitTicks<T>(items: T[], span: (t: T) => [number, number], pad = 8): T[] {
  const out: T[] = [];
  items.forEach((t, i) => {
    const prev = out[out.length - 1];
    if (!prev || span(t)[0] - span(prev)[1] >= pad) out.push(t);
    else if (i === items.length - 1 && out.length > 1) {
      out.pop();
      const before = out[out.length - 1];
      if (span(t)[0] - span(before)[1] >= pad) out.push(t);
    }
  });
  return out;
}

/** Rough label width at 11px (tabular digits ~6.5px, letters ~6px). */
const labelW = (s: string) => s.length * 6.4;

export function TrajectoryChart({ data, label, height = 280, noun = 'people', classYear, table = true, k = 5 }: TrajectoryProps & { k?: number }) {
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, '');
  const [ref, width] = useWidth<HTMLDivElement>(560);
  const { series, points, now } = data;
  const all: TrajPoint[] = useMemo(() => (now ? [...points, now] : points), [points, now]);
  const [sel, setSel] = useState<Sel>(() => defaultPoint(points));
  const current = all.find((p) => p.year === sel) ?? all[all.length - 1];

  // Geometry: the years share a linear axis; "Today" is its own column after a gap.
  const todayW = now ? Math.max(18, Math.min(34, width * 0.06)) : 0;
  const gap = now ? Math.max(18, Math.min(30, width * 0.05)) : 0;
  const x1 = Math.max(TM.left + 40, width - TM.right - todayW - gap);
  const lastYear = points.length ? (points[points.length - 1].year as number) : 0;
  const columns = points.length < 2;
  const x = scaleLinear().domain([0, Math.max(1, lastYear)]).range([TM.left + (columns ? todayW / 2 : 0), columns ? TM.left + todayW / 2 : x1]);
  const y = scaleLinear().domain([0, 1]).range([height - TM.bottom, TM.top]);
  const todayX = x1 + gap + todayW / 2;
  const xOf = (p: TrajPoint) => (p.year === 'now' ? todayX : x(p.year as number));

  // Stack: series in order from the baseline up.
  const stacks = useMemo(() => {
    const at = (p: TrajPoint) => {
      let acc = 0;
      return series.map((s) => {
        const h = p.cells[s.id]?.h ?? 0;
        const band = { y0: acc, y1: acc + h };
        acc += h;
        return band;
      });
    };
    return new Map(all.map((p) => [p.year, at(p)]));
  }, [series, all]);

  // Bump curves keep every band's thickness between its two neighbouring columns', so bands never cross.
  const areaPaths = columns ? [] : series.map((_, i) => d3area<TrajPoint>()
    .curve(curveBumpX)
    .x((p) => x(p.year as number))
    .y0((p) => y(stacks.get(p.year)![i].y0))
    .y1((p) => y(stacks.get(p.year)![i].y1))(points) ?? '');

  const fillOf = (s: TrajSeries, i: number): CSSProperties => (s.striped ? { fill: `url(#${uid}-p${i})` } : { fill: s.color });
  // Late years that fewer than SMALL_GROUP people (and under half the group) have reached are
  // shaded: a handful of people decide their shares.
  const thin = (p: TrajPoint) => p.n < SMALL_GROUP && p.n < data.groupN / 2;
  const thinIdx = columns ? -1 : points.findIndex((p, i) => i > 0 && thin(p));
  const thinX0 = thinIdx > 0 ? (xOf(points[thinIdx - 1]) + xOf(points[thinIdx])) / 2 : null;

  const tickText = (p: TrajPoint) => (p.year === 0 ? 'First job' : String(p.year));
  const startAnchored = (p: TrajPoint) => p.year === 0 && !columns;
  const ticks = fitTicks(points, (p) => {
    const w = labelW(tickText(p));
    return startAnchored(p) ? [xOf(p), xOf(p) + w] : [xOf(p) - w / 2, xOf(p) + w / 2];
  });

  const nearest = (px: number): Sel => {
    let best = all[0];
    for (const p of all) if (Math.abs(xOf(p) - px) < Math.abs(xOf(best) - px)) best = p;
    return best.year;
  };
  const onMove = (e: ReactPointerEvent<SVGRectElement>) => {
    const box = (e.currentTarget.ownerSVGElement ?? e.currentTarget).getBoundingClientRect();
    setSel(nearest(e.clientX - box.left));
  };
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const i = all.findIndex((p) => p.year === sel);
    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
      e.preventDefault();
      const next = Math.max(0, Math.min(all.length - 1, i + (e.key === 'ArrowRight' ? 1 : -1)));
      setSel(all[next].year);
    } else if (e.key === 'Home' || e.key === 'End') {
      e.preventDefault();
      setSel(all[e.key === 'Home' ? 0 : all.length - 1].year);
    }
  };

  const selX = current ? xOf(current) : 0;
  const forYou = classYear != null && current && typeof current.year === 'number' && current.year > 0
    ? `${classYear + current.year} for the class of ${classYear}` : null;
  const summary = current
    ? `${current.label}, ${fmtInt(current.n)} ${noun}: ${series.map((s) => {
      const c = current.cells[s.id];
      return `${s.label} ${c?.n == null ? `under ${k}` : percent(c.n, current.n)}`;
    }).join(', ')}.`
    : '';

  return (
    <div className="twin-traj-box">
      <div className="twin-traj">
        <div
          ref={ref}
          className="twin-traj__plot"
          tabIndex={0}
          role="group"
          aria-label={`${label}. Use the left and right arrow keys to step through the years; the numbers for the selected year are listed beside the chart.`}
          onKeyDown={onKey}
        >
          <svg width={width} height={height} aria-hidden="true" focusable="false">
            <defs>
              {series.map((s, i) => s.striped && (
                <pattern key={s.id} id={`${uid}-p${i}`} patternUnits="userSpaceOnUse" width="5" height="5" patternTransform="rotate(45)">
                  <rect width="5" height="5" style={{ fill: 'var(--surface-1)' }} />
                  <rect width="2.6" height="5" style={{ fill: s.color }} />
                </pattern>
              ))}
            </defs>
            {[0, 0.5, 1].map((t) => (
              <g key={t}>
                <line className={t === 0 ? 'twin-axis' : 'twin-gridline'} x1={TM.left} x2={now ? todayX + todayW / 2 : x1} y1={y(t)} y2={y(t)} />
                <text className="twin-tick num" x={TM.left - 8} y={y(t)} dy="0.32em" textAnchor="end">{t * 100}%</text>
              </g>
            ))}
            {!columns && series.map((s, i) => (
              <path key={s.id} className={`twin-traj__band${s.isStart ? ' is-start' : ''}`} d={areaPaths[i]} style={fillOf(s, i)} />
            ))}
            {(columns ? all : now ? [now] : []).map((p) => (
              <g key={String(p.year)}>
                {series.map((s, i) => {
                  const b = stacks.get(p.year)![i];
                  if (b.y1 - b.y0 <= 0) return null;
                  return (
                    <rect
                      key={s.id}
                      className="twin-traj__col"
                      x={xOf(p) - todayW / 2}
                      width={todayW}
                      y={y(b.y1)}
                      height={Math.max(0, y(b.y0) - y(b.y1))}
                      style={fillOf(s, i)}
                    />
                  );
                })}
              </g>
            ))}
            {thinX0 != null && (
              <g className="twin-traj__thin">
                <rect x={thinX0} y={y(1)} width={Math.max(0, x1 - thinX0 + 1)} height={y(0) - y(1)} />
                <text className="twin-tick" x={x1} y={TM.top - 4} textAnchor="end">under {SMALL_GROUP} people</text>
              </g>
            )}
            {now && !columns && (
              <line className="twin-traj__sep" x1={x1 + gap / 2} x2={x1 + gap / 2} y1={TM.top - 4} y2={height - TM.bottom} />
            )}
            {ticks.map((p) => (
              <text key={String(p.year)} className="twin-tick num" x={xOf(p)} y={height - TM.bottom + 16} textAnchor={startAnchored(p) ? 'start' : 'middle'}>
                {tickText(p)}
              </text>
            ))}
            {now && <text className="twin-tick twin-tick--today" x={todayX} y={height - TM.bottom + 16} textAnchor="middle">Today</text>}
            {!columns && points.length > 1 && (
              <text className="twin-tick twin-tick--title" x={(TM.left + x1) / 2} y={height - 4} textAnchor="middle">Years after graduating</text>
            )}
            {current && (
              current.year === 'now' || columns
                ? <rect className="twin-traj__sel-col" x={selX - todayW / 2 - 3} y={TM.top - 6} width={todayW + 6} height={height - TM.bottom - TM.top + 9} rx="4" />
                : <line className="twin-traj__sel" x1={selX} x2={selX} y1={TM.top - 6} y2={height - TM.bottom + 3} />
            )}
            <rect
              className="twin-traj__hit"
              x={TM.left - 4}
              y={TM.top - 8}
              width={Math.max(0, (now ? todayX + todayW / 2 : x1) - TM.left + 8)}
              height={height - TM.top - TM.bottom + 10}
              onPointerMove={onMove}
              onPointerDown={onMove}
            />
          </svg>
        </div>

        {current && (
          <div className="twin-readout">
            <p className="twin-readout__h">
              <strong>{current.label}</strong>
              <span className="twin-readout__n num"> · {fmtInt(current.n)} {noun}</span>
            </p>
            {(current.partial || forYou || (current.n < SMALL_GROUP && current.year !== 'now')) && (
              <p className="twin-readout__sub">
                {current.partial && typeof current.year === 'number' && <>Only the classes {current.year}+ years out. </>}
                {forYou && <>Year {current.year} is {forYou}.</>}
                {current.n < SMALL_GROUP && current.year !== 'now' && <> {SMALL_NOTE}</>}
              </p>
            )}
            <ul className="twin-readout__list">
              {series.map((s) => {
                const c = current.cells[s.id];
                return (
                  <li key={s.id} className={s.isStart ? 'is-start' : undefined}>
                    <span className="twin-sw" style={swatchStyle(s)} aria-hidden="true" />
                    <span className="twin-readout__label">{s.label}</span>
                    {c?.n == null
                      ? <span className="twin-readout__val is-under">under {k}</span>
                      : <span className="twin-readout__val num"><strong>{percent(c.n, current.n)}</strong> <span className="twin-readout__count">{fmtInt(c.n)}</span></span>}
                  </li>
                );
              })}
              {data.hasRest && (
                <li className="twin-readout__rest">
                  <span className="twin-sw is-rest" aria-hidden="true" />
                  <span className="twin-readout__label">Fields under {k} people each</span>
                </li>
              )}
            </ul>
            <p className="sr-only" aria-live="polite" aria-atomic="true">{summary}</p>
          </div>
        )}

        {table && (
          <details className="twin-details twin-traj__table">
            <summary>Show as a table</summary>
            <TrajectoryTable data={data} noun={noun} caption={label} k={k} />
          </details>
        )}
      </div>
    </div>
  );
}

export function TrajectoryTable({ data, noun, caption, k = 5 }: { data: Trajectory; noun: string; caption: string; k?: number }) {
  const cols = data.now ? [...data.points, data.now] : data.points;
  return (
    <div className="twin-table-wrap">
      <table className="twin-table">
        <caption className="sr-only">{caption}: share of the {noun} at each point who were in each field</caption>
        <thead>
          <tr>
            <th scope="col">Field</th>
            {cols.map((p) => (
              <th scope="col" key={String(p.year)}>
                {p.short}<span className="twin-table__n num">{fmtInt(p.n)}</span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.series.map((s) => (
            <tr key={s.id}>
              <th scope="row">{s.label}</th>
              {cols.map((p) => {
                const c = p.cells[s.id];
                return (
                  <td key={String(p.year)} className="num">
                    {c?.n == null ? <><span aria-hidden="true">&lt;{k}</span><span className="sr-only">fewer than {k}</span></> : percent(c.n, p.n)}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── Ranked share bars (first stop, employers, titles, cities) ────────────────

export interface BarItem {
  key: string;
  label: string;
  n: number;
  /** Denominator for the percentage. */
  of: number;
  muted?: boolean;
  title?: string;
}

/** A ranked list of shares: label, bar (one colour, --data-mono), percentage and count. */
export function ShareBars({ items, caption, max, id }: { items: BarItem[]; caption: string; max?: number; id?: string }) {
  const top = max ?? Math.max(...items.map((i) => i.n / i.of), 0.0001);
  return (
    // Explicit roles keep table semantics when the phone layout restyles rows as grids.
    <table className="twin-bars" id={id} role="table">
      <caption className="sr-only">{caption}</caption>
      <thead className="sr-only" role="rowgroup"><tr role="row"><th scope="col" role="columnheader">Name</th><th scope="col" role="columnheader">Share</th><th scope="col" role="columnheader">People</th></tr></thead>
      <tbody role="rowgroup">
        {items.map((it, i) => (
          // Names can repeat once disambiguated places or employers collide: key by position too.
          <tr key={`${it.key}-${i}`} role="row" className={it.muted ? 'is-muted' : undefined} title={it.title}>
            <th scope="row" role="rowheader" className="twin-bars__label">{it.label}</th>
            <td role="cell" className="twin-bars__track">
              <span className="twin-bars__row">
                <span className="twin-bars__bar twin-grow" style={{ ['--w' as string]: Math.min(1, it.n / it.of / top), ['--i' as string]: i }} />
                <span className="twin-bars__val num">{percent(it.n, it.of)}</span>
              </span>
            </td>
            <td role="cell" className="twin-bars__n num">{fmtInt(it.n)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function RankList({ items, total, scaleMax, label }: { items: NamedCount[]; total: number; scaleMax?: number; label: string }) {
  return (
    <ShareBars
      caption={label}
      max={scaleMax != null && total > 0 ? scaleMax / total : undefined}
      items={items.map((it) => ({ key: it.name, label: it.name, n: it.n, of: total }))}
    />
  );
}

// ── Seniority today ──────────────────────────────────────────────────────────

export function SeniorityBars({ rows, total, noun = 'twins' }: { rows: SeniorityRow[]; total: number; noun?: string }) {
  const max = Math.max(...rows.map((r) => r.share), 0);
  return (
    <>
      <ul className="twin-legend" aria-label="Legend">
        <li><span className="twin-legend__key twin-sen--ic" aria-hidden="true" />Individual contributor</li>
        <li><span className="twin-legend__key twin-sen--mgr" aria-hidden="true" />Manager or above</li>
      </ul>
      <table className="twin-bars" role="table">
        <caption className="sr-only">Seniority of current titles, share of all {fmtInt(total)} {noun}</caption>
        <thead className="sr-only" role="rowgroup"><tr role="row"><th scope="col" role="columnheader">Seniority</th><th scope="col" role="columnheader">Share</th><th scope="col" role="columnheader">People</th></tr></thead>
        <tbody role="rowgroup">
          {rows.map((r, i) => (
            <tr key={r.id} role="row">
              <th scope="row" role="rowheader" className="twin-bars__label">{r.label}</th>
              <td role="cell" className="twin-bars__track">
                <span className="twin-bars__row">
                  <span
                    className={`twin-bars__bar twin-grow ${r.managerPlus ? 'twin-sen--mgr' : 'twin-sen--ic'}`}
                    style={{ ['--w' as string]: max > 0 ? r.share / max : 0, ['--i' as string]: i }}
                  />
                  <span className="twin-bars__val num">{percent(r.n, total)}</span>
                </span>
              </td>
              <td role="cell" className="twin-bars__n num">{fmtInt(r.n)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}

// ── Time to manager ──────────────────────────────────────────────────────────

const M = { top: 22, right: 52, bottom: 40, left: 44 };
const HEIGHT = 220;

export function ManagerChart({ points, noun = 'twins' }: { points: ManagerPoint[]; noun?: string }) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [active, setActive] = useState<number | null>(null);
  const shown = useMemo(() => points.filter((p) => p.share != null), [points]);
  const maxYears = Math.max(...points.map((p) => p.years), 1);

  const x = scaleLinear().domain([0, maxYears]).range([M.left, Math.max(M.left + 40, width - M.right)]);
  const y = scaleLinear().domain([0, 1]).range([HEIGHT - M.bottom, M.top]);
  const linePath = d3line<ManagerPoint>().x((p) => x(p.years)).y((p) => y(p.share!))(shown) ?? '';
  const areaPath = d3area<ManagerPoint>().x((p) => x(p.years)).y0(y(0)).y1((p) => y(p.share!))(shown) ?? '';
  const last = shown[shown.length - 1];
  const act = active != null ? shown[active] : null;

  const nearest = (px: number) => {
    let best = 0;
    shown.forEach((p, i) => { if (Math.abs(x(p.years) - px) < Math.abs(x(shown[best].years) - px)) best = i; });
    return best;
  };
  const onMove = (e: ReactPointerEvent<SVGRectElement>) => {
    const box = (e.currentTarget.ownerSVGElement ?? e.currentTarget).getBoundingClientRect();
    setActive(nearest(e.clientX - box.left));
  };
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
      e.preventDefault();
      const cur = active ?? (e.key === 'ArrowRight' ? -1 : shown.length);
      setActive(Math.max(0, Math.min(shown.length - 1, cur + (e.key === 'ArrowRight' ? 1 : -1))));
    } else if (e.key === 'Escape') setActive(null);
  };

  const tipFlip = act ? x(act.years) > width - 170 : false;
  const tipLeft = act ? x(act.years) + (tipFlip ? -10 : 10) : 0;

  return (
    <div
      ref={ref}
      className="twin-line"
      tabIndex={0}
      role="group"
      aria-label="Time to manager chart. Use the left and right arrow keys to step through the years; the same numbers are in the table below."
      onKeyDown={onKey}
      onFocus={() => setActive((a) => a ?? shown.length - 1)}
      onBlur={() => setActive(null)}
    >
      <svg width={width} height={HEIGHT} aria-hidden="true" focusable="false">
        {[0, 0.25, 0.5, 0.75, 1].map((t) => (
          <g key={t}>
            <line className={t === 0 ? 'twin-axis' : 'twin-gridline'} x1={M.left} x2={width - M.right} y1={y(t)} y2={y(t)} />
            <text className="twin-tick num" x={M.left - 8} y={y(t)} dy="0.32em" textAnchor="end">{t * 100}%</text>
          </g>
        ))}
        {points.map((p) => (
          <text key={p.years} className="twin-tick num" x={x(p.years)} y={HEIGHT - M.bottom + 18} textAnchor="middle">{p.years}</text>
        ))}
        <text className="twin-tick twin-tick--title" x={M.left} y={HEIGHT - 4}>Years after graduating</text>
        <path className="twin-line__area" d={areaPath} />
        <path className="twin-line__path" d={linePath} />
        {act && <line className="twin-line__cross" x1={x(act.years)} x2={x(act.years)} y1={M.top - 6} y2={HEIGHT - M.bottom} />}
        {shown.map((p, i) => (
          <circle key={p.years} className={`twin-line__dot${i === active ? ' is-active' : ''}`} cx={x(p.years)} cy={y(p.share!)} r={i === active ? 6 : 4} />
        ))}
        {last && (
          <text className="twin-line__end num" x={x(last.years) + 10} y={y(last.share!)} dy="0.32em">{percent(last.n, last.of)}</text>
        )}
        <rect
          className="twin-line__hit"
          x={M.left}
          y={M.top - 10}
          width={Math.max(0, width - M.left - M.right + 20)}
          height={HEIGHT - M.top - M.bottom + 10}
          onPointerMove={onMove}
          onPointerLeave={() => setActive(null)}
        />
      </svg>
      {act && act.n != null && (
        <div className={`twin-tip${tipFlip ? ' is-flipped' : ''}`} style={{ left: tipLeft, top: M.top - 8 }} role="presentation">
          <strong className="num">{percent(act.n, act.of)}</strong>
          <span>by year {act.years}</span>
          <span className="twin-tip__detail num">{fmtInt(act.n)} of {fmtInt(act.of)} {noun}</span>
        </div>
      )}
    </div>
  );
}

export function ManagerTable({ points, noun = 'twins', k = 5 }: { points: ManagerPoint[]; noun?: string; k?: number }) {
  return (
    <div className="twin-table-wrap">
      <table className="twin-table">
        <caption className="sr-only">{noun === 'twins' ? 'Twins' : 'Alumni'} who had held a manager title or above, by years after graduating</caption>
        <thead>
          <tr><th scope="col">Years out</th><th scope="col">Had held a manager title</th><th scope="col">Share</th></tr>
        </thead>
        <tbody>
          {points.map((p) => (
            <tr key={p.years}>
              <th scope="row" className="num">{p.years}</th>
              <td className="num">{p.n == null ? `fewer than ${k} of ${fmtInt(p.of)}` : `${fmtInt(p.n)} of ${fmtInt(p.of)}`}</td>
              <td className="num">{p.n == null ? '—' : percent(p.n, p.of)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
