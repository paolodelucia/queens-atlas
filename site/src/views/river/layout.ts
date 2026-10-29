/**
 * Geometry for the River: d3-sankey does the vertical layout (node stacking, link widths),
 * we pin columns to stages, centre each node's flows inside the node, pick which labels fit,
 * and interpolate between two layouts for the slice-change transition. Pure: no DOM.
 */
import { sankey } from 'd3-sankey';
import type { SankeyLink, SankeyNode } from 'd3-sankey';
import type { StageId } from '../../data/types';
import { REST, familyShort, stackRow } from './model';
import type { BandKey, GroupId, SankeyInput, YearSeries } from './model';

export interface LayoutOptions {
  width: number;
  height: number;
  nodeWidth: number;
  nodePadding: number;
  margin: { top: number; right: number; bottom: number; left: number };
  /** Minimum distance between two label baselines in the same column. */
  labelSpacing: number;
  /** Narrowest gap between two columns before the chart scrolls sideways instead. */
  minGap: number;
}

export interface RNode {
  id: string;
  family: GroupId;
  stage: StageId;
  stageIndex: number;
  value: number;
  /** Share of the slice's class (value / n). */
  share: number;
  x0: number; x1: number; y0: number; y1: number;
  labelSide: 'left' | 'right';
  showLabel: boolean;
  opacity: number;
  labelOpacity: number;
}

export interface RLink {
  id: string;
  source: string; target: string;
  from: GroupId; to: GroupId;
  fromStage: StageId; toStage: StageId;
  value: number;
  width: number;
  x0: number; y0: number; x1: number; y1: number;
  opacity: number;
}

export interface RStage { id: StageId; index: number; x: number; opacity: number }

export interface RiverLayout {
  /** Identity of the data (not the size): transitions run only when this changes. */
  key: string;
  width: number;
  height: number;
  n: number;
  stages: RStage[];
  nodes: RNode[];
  links: RLink[];
}

interface NExtra { id: string; stageIndex: number }
interface LExtra { id: string; ghost: boolean }

export function minChartWidth(stageCount: number, o: Pick<LayoutOptions, 'nodeWidth' | 'margin' | 'minGap'>): number {
  return o.margin.left + o.margin.right + o.nodeWidth + Math.max(0, stageCount - 1) * o.minGap;
}

export function layoutRiver(input: SankeyInput, o: LayoutOptions, key = ''): RiverLayout {
  const { width, height, margin: m } = o;
  const k = input.stages.length;
  const span = Math.max(0, width - m.left - m.right - o.nodeWidth);
  const colX = (i: number) => m.left + (k > 1 ? (i * span) / (k - 1) : 0);
  const stages: RStage[] = input.stages.map((id, index) => ({ id, index, x: colX(index), opacity: 1 }));
  const empty: RiverLayout = { key, width, height, n: input.n, stages, nodes: [], links: [] };
  if (!input.nodes.length) return empty;

  // Zero-value "ghost" links chain the first node of each column so d3-sankey sees k columns
  // even when a column has no published flows in or out; they are dropped after layout.
  const firstOf = input.stages.map((_, i) => input.nodes.find((d) => d.stageIndex === i)?.id);
  const ghosts = firstOf.slice(1).map((target, i) => ({ source: firstOf[i]!, target: target!, value: 0, id: `ghost${i}`, ghost: true }));

  const order = new Map(input.nodes.map((d, i) => [d.id, i]));
  const graph = sankey<NExtra, LExtra>()
    .nodeId((d) => d.id)
    .nodeAlign((d) => d.stageIndex)
    .nodeSort((a, b) => order.get(a.id)! - order.get(b.id)!)
    .nodeWidth(o.nodeWidth)
    .nodePadding(o.nodePadding)
    .iterations(0)
    .extent([[m.left, m.top], [Math.max(m.left + o.nodeWidth + 1, width - m.right), Math.max(m.top + 1, height - m.bottom)]])({
      nodes: input.nodes.map((d) => ({ id: d.id, stageIndex: d.stageIndex, fixedValue: d.value })),
      links: [
        ...input.links.map((l) => ({ source: l.source, target: l.target, value: l.value, id: l.id, ghost: false })),
        ...ghosts,
      ],
    });

  const byId = new Map(input.nodes.map((d) => [d.id, d]));
  const sNodes = graph.nodes as SankeyNode<NExtra, LExtra>[];
  const nodes: RNode[] = sNodes.map((s) => {
    const d = byId.get(s.id)!;
    const x0 = colX(d.stageIndex);
    return {
      id: d.id, family: d.family, stage: d.stage, stageIndex: d.stageIndex, value: d.value,
      share: input.n > 0 ? d.value / input.n : 0,
      x0, x1: x0 + o.nodeWidth, y0: s.y0 ?? 0, y1: s.y1 ?? 0,
      labelSide: d.stageIndex === 0 && k > 1 ? 'left' : 'right',
      showLabel: false, opacity: 1, labelOpacity: 0,
    };
  });
  const nodeById = new Map(nodes.map((d) => [d.id, d]));

  // d3-sankey stacks flows from the top of each node; centre the published flows instead, so
  // the unpublished remainder splits evenly above and below.
  const outW = new Map<string, number>();
  const inW = new Map<string, number>();
  const real = (graph.links as SankeyLink<NExtra, LExtra>[]).filter((l) => !l.ghost);
  for (const l of real) {
    const s = (l.source as SankeyNode<NExtra, LExtra>).id;
    const t = (l.target as SankeyNode<NExtra, LExtra>).id;
    outW.set(s, (outW.get(s) ?? 0) + (l.width ?? 0));
    inW.set(t, (inW.get(t) ?? 0) + (l.width ?? 0));
  }
  const pad = (id: string, used: Map<string, number>) => {
    const d = nodeById.get(id)!;
    return Math.max(0, (d.y1 - d.y0 - (used.get(id) ?? 0)) / 2);
  };
  const inputLinks = new Map(input.links.map((l) => [l.id, l]));
  const links: RLink[] = real.map((l) => {
    const src = l.source as SankeyNode<NExtra, LExtra>;
    const tgt = l.target as SankeyNode<NExtra, LExtra>;
    const meta = inputLinks.get(l.id)!;
    return {
      ...meta,
      width: l.width ?? 0,
      x0: nodeById.get(src.id)!.x1, x1: nodeById.get(tgt.id)!.x0,
      y0: (l.y0 ?? 0) + pad(src.id, outW), y1: (l.y1 ?? 0) + pad(tgt.id, inW),
      opacity: 1,
    };
  });
  // Big flows first so thin ones paint on top and stay visible.
  links.sort((a, b) => b.width - a.width || a.id.localeCompare(b.id));

  placeLabels(nodes, o.labelSpacing, m.top, height - m.bottom);
  return { ...empty, nodes, links };
}

/**
 * Greedy label placement per column: biggest nodes claim their spot first; a label is shown
 * only if its centre is at least `spacing` from every label already placed in that column.
 * Thin nodes in a crowded column lose their label (they stay in the tooltip and table).
 */
export function placeLabels(nodes: RNode[], spacing: number, top = -Infinity, bottom = Infinity): void {
  const cols = new Map<number, RNode[]>();
  for (const d of nodes) cols.set(d.stageIndex, [...(cols.get(d.stageIndex) ?? []), d]);
  for (const col of cols.values()) {
    const placed: number[] = [];
    for (const d of [...col].sort((a, b) => b.value - a.value || a.y0 - b.y0)) {
      const cy = (d.y0 + d.y1) / 2;
      if (cy >= top && cy <= bottom && placed.every((p) => Math.abs(p - cy) >= spacing)) {
        placed.push(cy);
        d.showLabel = true;
        d.labelOpacity = 1;
      } else {
        d.showLabel = false;
        d.labelOpacity = 0;
      }
    }
  }
}

/**
 * Left edge (svg coords) for a node's tooltip that keeps it clear of everything the hover
 * highlights: the node's column, its source and target columns, their flows and their labels
 * (`labelRoom` px beside each node). It goes just right of that span, or just left of it, when
 * there's room inside [0, width]; null means no room (the caller then sits it beside the node).
 */
export function tooltipSlotX(layout: RiverLayout, i: number, tipWidth: number, labelRoom: number, gap = 10): number | null {
  const k = layout.stages.length;
  if (k < 2) return null;
  const nodeW = (layout.nodes[0]?.x1 ?? 0) - (layout.nodes[0]?.x0 ?? 0);
  const lo = Math.max(0, i - 1);
  const hi = Math.min(k - 1, i + 1);
  const xLo = layout.stages[lo]?.x ?? 0;
  const xHi = layout.stages[hi]?.x ?? 0;
  const spanLeft = lo === 0 ? xLo - labelRoom : xLo;
  const spanRight = xHi + nodeW + labelRoom;
  if (layout.width - spanRight >= tipWidth + 2 * gap) return spanRight + gap;
  if (spanLeft >= tipWidth + 2 * gap) return spanLeft - gap - tipWidth;
  return null;
}

/** Horizontal ribbon centre-line, the same curve as d3.sankeyLinkHorizontal(). */
export function linkPath(l: Pick<RLink, 'x0' | 'y0' | 'x1' | 'y1'>): string {
  const xm = (l.x0 + l.x1) / 2;
  const r = (v: number) => Math.round(v * 100) / 100;
  return `M${r(l.x0)},${r(l.y0)}C${r(xm)},${r(l.y0)} ${r(xm)},${r(l.y1)} ${r(l.x1)},${r(l.y1)}`;
}

// ── Transitions ─────────────────────────────────────────────────────────────

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

export function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - Math.min(1, Math.max(0, t)), 3);
}

/**
 * Frame `t` (0..1) of the morph from layout `a` to layout `b`. Elements in both morph;
 * elements only in `b` grow from their centre line and fade in; elements only in `a`
 * collapse and fade out (they are kept until t = 1).
 */
export function interpolateLayout(a: RiverLayout, b: RiverLayout, t: number): RiverLayout {
  if (t >= 1) return b;
  const aNodes = new Map(a.nodes.map((d) => [d.id, d]));
  const bNodeIds = new Set(b.nodes.map((d) => d.id));
  const nodes: RNode[] = b.nodes.map((nb) => {
    const na = aNodes.get(nb.id);
    if (na) {
      return {
        ...nb,
        x0: lerp(na.x0, nb.x0, t), x1: lerp(na.x1, nb.x1, t),
        y0: lerp(na.y0, nb.y0, t), y1: lerp(na.y1, nb.y1, t),
        opacity: lerp(na.opacity, nb.opacity, t),
        labelOpacity: lerp(na.labelOpacity, nb.labelOpacity, t),
      };
    }
    const cy = (nb.y0 + nb.y1) / 2;
    return { ...nb, y0: lerp(cy, nb.y0, t), y1: lerp(cy, nb.y1, t), opacity: nb.opacity * t, labelOpacity: nb.labelOpacity * t };
  });
  for (const na of a.nodes) {
    if (bNodeIds.has(na.id)) continue;
    const cy = (na.y0 + na.y1) / 2;
    nodes.push({ ...na, y0: lerp(na.y0, cy, t), y1: lerp(na.y1, cy, t), opacity: na.opacity * (1 - t), labelOpacity: na.labelOpacity * (1 - t) });
  }

  const aLinks = new Map(a.links.map((d) => [d.id, d]));
  const bLinkIds = new Set(b.links.map((d) => d.id));
  const links: RLink[] = b.links.map((lb) => {
    const la = aLinks.get(lb.id);
    if (la) {
      return {
        ...lb,
        x0: lerp(la.x0, lb.x0, t), x1: lerp(la.x1, lb.x1, t),
        y0: lerp(la.y0, lb.y0, t), y1: lerp(la.y1, lb.y1, t),
        width: lerp(la.width, lb.width, t), opacity: lerp(la.opacity, lb.opacity, t),
      };
    }
    return { ...lb, width: lb.width * t, opacity: lb.opacity * t };
  });
  for (const la of a.links) {
    if (bLinkIds.has(la.id)) continue;
    links.push({ ...la, width: la.width * (1 - t), opacity: la.opacity * (1 - t) });
  }

  const aStages = new Map(a.stages.map((s) => [s.id, s]));
  const bStageIds = new Set(b.stages.map((s) => s.id));
  const stages: RStage[] = b.stages.map((sb) => {
    const sa = aStages.get(sb.id);
    return sa ? { ...sb, x: lerp(sa.x, sb.x, t), opacity: lerp(sa.opacity, sb.opacity, t) } : { ...sb, opacity: sb.opacity * t };
  });
  for (const sa of a.stages) if (!bStageIds.has(sa.id)) stages.push({ ...sa, opacity: sa.opacity * (1 - t) });

  return {
    key: b.key, n: b.n,
    width: lerp(a.width, b.width, t), height: lerp(a.height, b.height, t),
    stages, nodes, links,
  };
}

// ── Year by year: the stacked field mix ─────────────────────────────────────

export interface YearsLayoutOptions {
  width: number;
  height: number;
  margin: { top: number; right: number; bottom: number; left: number };
  /** Space between the last year and the "Today" column. */
  todayGap: number;
  /** Width of the "Today" column (and of any year drawn on its own). */
  barWidth: number;
  /** Font size of the in-band labels (px). */
  fontSize: number;
}

export interface YearsPoint {
  index: number;
  year: number | 'now';
  /** Centre of the point (the scrubber snaps here). */
  x: number;
  /** Points drawn as a column (Today, or a year with no neighbours) span x0..x1. */
  bar: { x0: number; x1: number } | null;
}

export interface YearsShape { key: BandKey; d: string }
export interface YearsLabel { key: GroupId; x: number; y: number; text: string }
export interface YearsTick { x: number; label: string | null }

export interface YearsLayout {
  width: number;
  height: number;
  /** Plot box: x0..x1 left to right, y0 (100%) to y1 (0%) top to bottom. */
  plot: { x0: number; x1: number; y0: number; y1: number };
  points: YearsPoint[];
  /** One path per band (every run of years and every column of it), bottom of the stack first. */
  shapes: YearsShape[];
  labels: YearsLabel[];
  xTicks: YearsTick[];
  yTicks: { y: number; label: string }[];
  /** Where the years not every member has reached begin (null when there are none). */
  partial: { x: number; x1: number; year: number } | null;
}

const r2 = (v: number) => Math.round(v * 100) / 100;

/** A smooth line through points with flat tangents at each (d3.curveBumpX): curves through the same
 *  x's never cross when their points don't, so stacked bands can't overlap between years. */
function bump(pts: [number, number][], move: boolean): string {
  let d = '';
  pts.forEach(([x, y], i) => {
    if (i === 0) { d += `${move ? 'M' : 'L'}${r2(x)},${r2(y)}`; return; }
    const [px, py] = pts[i - 1];
    const xm = (px + x) / 2;
    d += `C${r2(xm)},${r2(py)} ${r2(xm)},${r2(y)} ${r2(x)},${r2(y)}`;
  });
  return d;
}

/**
 * Geometry for the year-by-year chart: years 0..N evenly spaced by year (a missing year leaves a
 * gap rather than being bridged), then "Today" as its own column after a gap (it mixes classes at
 * different years, so it isn't joined to the last year). Each band is a share of that point's n
 * (see stackRow). Labels go inside bands where the band is tall enough across the label's width.
 */
export function layoutYears(series: YearSeries, o: YearsLayoutOptions): YearsLayout {
  const { width, height, margin: m } = o;
  const plot = { x0: m.left, x1: Math.max(m.left + 1, width - m.right), y0: m.top, y1: Math.max(m.top + 1, height - m.bottom) };
  const ph = plot.y1 - plot.y0;
  const py = (v: number) => plot.y1 - v * ph;
  const rows = series.rows;
  const years = rows.map((r) => r.year).filter((y): y is number => y !== 'now');
  const hasNow = rows.some((r) => r.year === 'now');
  const minY = years.length ? Math.min(...years) : 0;
  const maxY = years.length ? Math.max(...years) : 0;
  const right = plot.x1 - (hasNow ? o.todayGap + o.barWidth : 0);
  const spread = maxY > minY;
  const step = spread ? (right - plot.x0) / (maxY - minY) : 0;
  const yearX = (y: number) => (spread ? plot.x0 + (y - minY) * step : plot.x0 + o.barWidth / 2);

  // Runs of consecutive years become areas; a lone year and Today become columns.
  const runs: number[][] = [];
  rows.forEach((r, i) => {
    if (r.year === 'now') return;
    const prev = runs[runs.length - 1];
    const last = prev ? rows[prev[prev.length - 1]].year : null;
    if (prev && typeof last === 'number' && r.year === last + 1) prev.push(i);
    else runs.push([i]);
  });
  const lone = new Set(runs.filter((run) => run.length === 1 || !spread).flat());
  const loneW = spread ? Math.min(o.barWidth, Math.max(6, step * 0.7)) : o.barWidth;

  const points: YearsPoint[] = rows.map((r, index) => {
    if (r.year === 'now') {
      const x0 = right + o.todayGap;
      return { index, year: r.year, x: x0 + o.barWidth / 2, bar: { x0, x1: x0 + o.barWidth } };
    }
    const x = yearX(r.year);
    return { index, year: r.year, x, bar: lone.has(index) ? { x0: x - loneW / 2, x1: x + loneW / 2 } : null };
  });

  const stacks = rows.map((r) => stackRow(r, series.groups));
  const keys = stacks[0]?.map((b) => b.key) ?? [];
  const band = (i: number, k: number) => stacks[i][k];

  const shapes: YearsShape[] = keys.map((key, k) => {
    let d = '';
    for (const run of runs) {
      if (run.length < 2 || !spread) continue;
      const top = run.map((i): [number, number] => [points[i].x, py(band(i, k).y1)]);
      const bottom = [...run].reverse().map((i): [number, number] => [points[i].x, py(band(i, k).y0)]);
      d += `${bump(top, true)}${bump(bottom, false)}Z`;
    }
    for (const p of points) {
      if (!p.bar) continue;
      const b = band(p.index, k);
      d += `M${r2(p.bar.x0)},${r2(py(b.y1))}H${r2(p.bar.x1)}V${r2(py(b.y0))}H${r2(p.bar.x0)}Z`;
    }
    return { key, d };
  });

  // In-band labels, biggest bands first; each must clear its band over its whole width.
  const labels: YearsLabel[] = [];
  const boxes: { x0: number; x1: number; y0: number; y1: number }[] = [];
  const lineH = o.fontSize + 4;
  const order = keys
    .map((key, k) => ({ key, k, total: stacks.reduce((a, s) => a + (s[k].y1 - s[k].y0), 0) }))
    .filter((b) => b.key !== REST)
    .sort((a, b) => b.total - a.total);
  for (const { key, k } of order) {
    const text = familyShort(key);
    const w = textWidth(text, o.fontSize) + 8;
    let best: { x: number; y: number; h: number } | null = null;
    for (const run of runs) {
      if (run.length < 2 || !spread) continue;
      const rx0 = points[run[0]].x;
      const rx1 = points[run[run.length - 1]].x;
      if (rx1 - rx0 < w) continue;
      for (const i of run) {
        const cx = Math.min(Math.max(points[i].x, rx0 + w / 2), rx1 - w / 2);
        // Every point whose segment the label touches bounds it (bump curves stay between their points).
        const touched = run.filter((j, n) => {
          const xj = points[j].x;
          const xNext = n + 1 < run.length ? points[run[n + 1]].x : xj;
          const xPrev = n > 0 ? points[run[n - 1]].x : xj;
          return xNext >= cx - w / 2 && xPrev <= cx + w / 2;
        });
        const lo = Math.max(...touched.map((j) => band(j, k).y0));
        const hi = Math.min(...touched.map((j) => band(j, k).y1));
        const h = (hi - lo) * ph;
        if (h >= lineH && (!best || h > best.h)) best = { x: cx, y: py((lo + hi) / 2), h };
      }
    }
    if (!best) continue;
    const box = { x0: best.x - w / 2, x1: best.x + w / 2, y0: best.y - lineH / 2, y1: best.y + lineH / 2 };
    if (boxes.some((b) => b.x0 < box.x1 && box.x0 < b.x1 && b.y0 < box.y1 && box.y0 < b.y1)) continue;
    boxes.push(box);
    labels.push({ key: key as GroupId, x: best.x, y: best.y, text });
  }

  // Axis: "First", then every fifth year, and the last year if it sits clear of the one before.
  const xTicks: YearsTick[] = [];
  let lastLabelled = -Infinity;
  for (const p of points) {
    if (p.year === 'now') { xTicks.push({ x: p.x, label: 'Today' }); continue; }
    const y = p.year;
    const isLast = y === maxY;
    let label: string | null = null;
    if (y === 0) label = 'First';
    else if (y % 5 === 0 && p.x - lastLabelled >= 22) label = String(y);
    else if (isLast && y - (Math.floor(y / 5) * 5) >= 2 && p.x - lastLabelled >= 22) label = String(y);
    if (label) lastLabelled = p.x;
    xTicks.push({ x: p.x, label });
  }
  // A year label that would run into "Today" gives way to it.
  const today = points.find((p) => p.year === 'now');
  if (today) for (const t of xTicks) if (t.label && t.label !== 'Today' && today.x - t.x < 30) t.label = null;
  const yTicks = [0, 0.25, 0.5, 0.75, 1].map((v) => ({ y: py(v), label: `${Math.round(v * 100)}%` }));

  const firstPartial = rows.findIndex((r) => r.year !== 'now' && r.n < series.n);
  const lastYearIdx = rows.reduce((a, r, i) => (r.year === 'now' ? a : i), -1);
  const partial = firstPartial >= 0 && typeof rows[firstPartial].year === 'number'
    ? { x: points[firstPartial].x, x1: points[lastYearIdx].bar?.x1 ?? points[lastYearIdx].x, year: rows[firstPartial].year as number }
    : null;

  return { width, height, plot, points, shapes, labels, xTicks, yTicks, partial };
}

/** The point nearest an x position (the scrubber's snap). */
export function nearestPoint(layout: YearsLayout, x: number): number {
  let best = 0;
  let dist = Infinity;
  for (const p of layout.points) {
    const d = p.bar ? (x < p.bar.x0 ? p.bar.x0 - x : x > p.bar.x1 ? x - p.bar.x1 : 0) : Math.abs(p.x - x);
    if (d < dist) { dist = d; best = p.index; }
  }
  return best;
}

// ── Text measurement ────────────────────────────────────────────────────────

/**
 * Approximate rendered width (px) of a UI label in Inter without touching the DOM: per-character
 * advance widths in em, rounded up a little. Used to size the label margins so the outer
 * columns' labels are never clipped by the edge of the chart.
 */
export function textWidth(text: string, fontSize: number): number {
  let em = 0;
  for (const ch of text) {
    if (/[ilIj.,:;'’!|]/.test(ch)) em += 0.28;
    else if (ch === ' ') em += 0.28;
    else if (/[frt/()\-–]/.test(ch)) em += 0.37;
    else if (/[mwMW%&@]/.test(ch)) em += 0.86;
    else if (/[A-Z]/.test(ch)) em += 0.68;
    else if (/[0-9<]/.test(ch)) em += 0.62;
    else em += 0.56;
  }
  return Math.ceil(em * fontSize * 1.04);
}
