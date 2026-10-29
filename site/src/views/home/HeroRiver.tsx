import { useEffect, useId, useMemo, useState } from 'react';
import { Card, Sticker } from '../../components/ui';
import { loadData } from '../../data/load';
import { SECTOR } from '../../data/taxonomy';
import type { RiverFile, StageId } from '../../data/types';
import { fmtInt } from '../../lib/format';
import { Link } from '../../lib/router';
import { HERO_SECTOR, HERO_SLICE, STAGE_PHRASE, heroStory, layoutFlows, sectorFlows } from './model';
import type { LaidLink, LaidNode } from './model';

const W = 640;
const H = 340;
const NODE_W = 6;
const SHIMMERS = 10;
/** Ribbons thinner than this (in viewBox px) are hairline noise at this size; the River shows them. */
const MIN_W = 0.9;
/** Column labels, long and short (the short ones swap in on phones). */
const STAGE_LABEL: Record<StageId, [string, string]> = {
  s0: ['First job', 'First'],
  y3: ['Year 3', 'Yr 3'],
  y5: ['Year 5', 'Yr 5'],
  y10: ['Year 10', 'Yr 10'],
  y20: ['Year 20', 'Yr 20'],
  now: ['Today', 'Today'],
};
const COHORT_LABEL = HERO_SLICE.cohort.replace('-', '–');

type State = { status: 'waiting' } | { status: 'skipped' } | { status: 'error' } | { status: 'ready'; river: RiverFile };

function saveData(): boolean {
  const c = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection;
  return Boolean(c?.saveData);
}

/** A ribbon is "in the story" when it ends in the highlighted sector (stays and inflows). */
const inStory = (l: LaidLink) => l.toSector === HERO_SECTOR;

/**
 * The landing page's one chart: a real, sector-level river for the classes of 2010–2014 (all
 * programs), drawn from the same river.json the River uses, with one story picked out of it.
 * Every sector but Management & ventures is dimmed; the shares and the sticker are computed from
 * the slice, so they move with the data (the sticker only shows while the share rises at every
 * column). The numbers are text; the SVG is aria-hidden.
 *
 * It never blocks first paint: the file is requested when the browser is idle, the box keeps its
 * size while it waits, and Save-Data visitors (or a failed load) get nothing at all.
 */
export function HeroRiver() {
  const [state, setState] = useState<State>(() => (saveData() ? { status: 'skipped' } : { status: 'waiting' }));
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, '');

  useEffect(() => {
    if (state.status !== 'waiting') return;
    let alive = true;
    const start = () => {
      loadData('river').then(
        (river) => alive && setState({ status: 'ready', river }),
        () => alive && setState({ status: 'error' }),
      );
    };
    const w = window as Window & { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number; cancelIdleCallback?: (id: number) => void };
    let idle: number | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    if (w.requestIdleCallback) idle = w.requestIdleCallback(start, { timeout: 1200 });
    else timer = setTimeout(start, 120);
    return () => {
      alive = false;
      if (idle !== undefined) w.cancelIdleCallback?.(idle);
      if (timer !== undefined) clearTimeout(timer);
    };
  }, [state.status]);

  const flows = useMemo(() => {
    if (state.status !== 'ready') return null;
    const slice = state.river.slices.find(
      (s) => s.level === HERO_SLICE.level && s.program === HERO_SLICE.program && s.cohort === HERO_SLICE.cohort);
    const data = sectorFlows(slice);
    if (!data.links.length) return null;
    return { data, layout: layoutFlows(data, { width: W, height: H, nodeWidth: NODE_W, gap: 10 }), story: heroStory(data) };
  }, [state]);

  if (state.status === 'skipped' || state.status === 'error' || (state.status === 'ready' && !flows)) return null;

  const hi = SECTOR[HERO_SECTOR];
  const story = flows?.story ?? null;
  const shimmer = flows
    ? flows.layout.links.filter((l) => inStory(l) && l.fromSector !== l.toSector && l.w >= MIN_W).sort((a, b) => b.w - a.w).slice(0, SHIMMERS)
    : [];
  // Stage labels sit over their columns (node centres), the outer two flush with the plot edges.
  const stageIds: StageId[] = flows?.data.stages ?? ['s0', 'y3', 'y5', 'y10', 'now'];
  const stageLabels = stageIds.map((id, i) => {
    const last = stageIds.length - 1;
    const x = last > 0 ? (i / last) * (W - NODE_W) + NODE_W / 2 : 0;
    return { id, pct: (x / W) * 100, align: i === 0 ? 'start' : i === last ? 'end' : 'middle' };
  });
  // On-chart labels for the two end shares, just above the highlighted node at each end.
  const endNode = (stage: StageId | undefined): LaidNode | undefined =>
    flows?.layout.nodes.find((n) => n.stage === stage && n.sector === HERO_SECTOR);
  const marks = story ? [
    { key: 'from', node: endNode(story.from.stage), text: story.from.share, align: 'start' as const },
    { key: 'to', node: endNode(story.to.stage), text: story.to.share, align: 'end' as const },
  ].filter((m): m is { key: string; node: LaidNode; text: string; align: 'start' | 'end' } => Boolean(m.node)) : [];

  return (
    <Card
      as="figure"
      pad="lg"
      className="hero-river"
      aria-labelledby={`${uid}-story`}
      aria-describedby={`${uid}-cap`}
      data-ready={flows ? 'true' : 'false'}
    >
      <div className="hero-river__text">
        <p className="eyebrow hero-river__eyebrow">One class, {COHORT_LABEL}</p>
        <p className="hero-river__story" id={`${uid}-story`}>
          {story ? (
            <>
              <strong className="hero-river__headline">{story.rising ? 'Careers drift into management.' : `${hi.label} over a career.`}</strong>{' '}
              <span className="hero-river__shares num">
                <span>{story.from.share} {STAGE_PHRASE[story.from.stage]}</span>
                <span aria-hidden="true"> → </span><span className="sr-only">, </span>
                <span>{story.to.share} {STAGE_PHRASE[story.to.stage]}</span>
              </span>
            </>
          ) : flows ? (
            <strong className="hero-river__headline">One class, from first job to today.</strong>
          ) : (
            <span>Loading the classes of {COHORT_LABEL}…</span>
          )}
        </p>
        {flows && (
          <div id={`${uid}-cap`} className="hero-river__caption">
            <ul className="hero-river__legend" aria-label="Key">
              <li><span className="swatch" style={{ background: hi.color }} aria-hidden="true" />{hi.label}: operations, management and founders</li>
              <li><span className="swatch swatch--dim" aria-hidden="true" />Every other sector, dimmed</li>
            </ul>
            <p>
              {fmtInt(flows.data.n)} grads from the classes of {COHORT_LABEL}, every program, by career sector.
            </p>
            <Link to={`/river?cohort=${HERO_SLICE.cohort}`} className="hero-river__link">
              Open this class in the River <span aria-hidden="true">→</span>
            </Link>
          </div>
        )}
        {!flows && <p id={`${uid}-cap`} className="hero-river__caption">Real career paths, by sector.</p>}
      </div>

      <div className="hero-river__chart">
        {story?.steady && (
          <Sticker tone="lime" tilt={-5} className="hero-river__sticker" aria-hidden="true">management keeps growing</Sticker>
        )}
        <div className="hero-river__stages" aria-hidden="true">
          {stageLabels.map(({ id, pct, align }) => (
            <span key={id} className={`is-${align}`} style={{ left: `${pct}%` }}>
              <span className="hero-river__long">{STAGE_LABEL[id][0]}</span>
              <span className="hero-river__short">{STAGE_LABEL[id][1]}</span>
            </span>
          ))}
        </div>
        <div className="hero-river__plot">
          {flows && (
            <svg viewBox={`0 0 ${W} ${H}`} aria-hidden="true" focusable="false">
              <defs>
                {flows.layout.links.map((l, i) => l.fromSector !== l.toSector && (
                  <linearGradient key={i} id={`${uid}-g${i}`} gradientUnits="userSpaceOnUse" x1={l.x0} x2={l.x1} y1={0} y2={0}>
                    {/* Inflows light up as they reach the highlighted sector; everything else stays dim. */}
                    <stop offset="0.15" style={{ stopColor: SECTOR[l.fromSector].color, stopOpacity: inStory(l) ? 0.2 : 1 }} />
                    <stop offset="0.85" style={{ stopColor: SECTOR[l.toSector].color }} />
                  </linearGradient>
                ))}
              </defs>
              <g className="hero-river__links">
                {flows.layout.links.map((l, i) => l.w < MIN_W ? null : (
                  <path
                    key={i}
                    d={l.d}
                    className={`${l.fromSector === l.toSector ? 'is-stay' : 'is-move'} ${inStory(l) ? 'is-hi' : 'is-dim'}`}
                    style={{
                      stroke: l.fromSector === l.toSector ? SECTOR[l.fromSector].color : `url(#${uid}-g${i})`,
                      strokeWidth: Math.max(0.8, l.w - 0.6),
                    }}
                  />
                ))}
              </g>
              <g className="hero-river__shimmer">
                {shimmer.map((l, i) => (
                  <path key={i} d={l.d} style={{ animationDuration: `${2.6 + (i % 5) * 0.55}s`, animationDelay: `${-(i * 0.37)}s` }} />
                ))}
              </g>
              <g className="hero-river__nodes">
                {flows.layout.nodes.map((n) => (
                  <rect key={`${n.stage}-${n.sector}`} x={n.x} y={n.y} width={NODE_W} height={Math.max(1, n.h)} rx={1.5}
                    className={n.sector === HERO_SECTOR ? 'is-hi' : 'is-dim'}
                    style={{ fill: SECTOR[n.sector].color }} />
                ))}
              </g>
            </svg>
          )}
          {marks.map((m) => (
            <span
              key={m.key}
              className={`hero-river__mark is-${m.align} num`}
              style={{ top: `${(m.node.y / H) * 100}%`, ...(m.align === 'start' ? { left: 0 } : { right: 0 }) }}
              aria-hidden="true"
            >
              {m.text}
            </span>
          ))}
        </div>
      </div>
    </Card>
  );
}
