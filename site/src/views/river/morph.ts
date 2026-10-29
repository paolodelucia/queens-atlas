/**
 * The tab-switch morph: the Flow chart's bars bend into the Year-by-year chart's bands and back.
 * Pure geometry, no DOM (morph.test.ts).
 *
 * Both charts are reduced to the same thing: per field, a band with a top and a bottom edge at a
 * list of knots. A knot sits at a point in career time (`tau`: years after graduating, or today)
 * and at an x. The Sankey gives four knots per column (a zero-height knot, the bar's left edge, its
 * right edge, another zero-height knot), so its bands are exactly its bars, joined by invisible
 * zero-height threads. The stacked chart gives one knot per year, with zero-height knots where a
 * run of years starts and ends, and four for "Today" (and any year drawn as a column). Lining the
 * knots up by career time means the column for year 5 slides to year 5, the bars widen into the
 * stack, and the gaps between columns fill in with the years between.
 *
 * The morph passes through a middle shape: each bar stretched sideways into a lane that flows into
 * its own next bar at full height (a Sankey where nobody changes field). First the flows fade and
 * the lanes fill in between the bars, then the lanes slide and bend into the stack.
 *
 * Edges between knots are drawn as flat-tangent curves (the same as the stacked chart's own), so
 * the last frame is the stacked chart's areas and the first is the Sankey's bars.
 */
import { compareFamilies, groupColor, groupOf, isSectorGroup, REST, stackRow, toneOf } from './model';
import type { YearSeries } from './model';
import type { RiverLayout, YearsLayout } from './layout';

export type KnotKind = 'lead' | 'full' | 'trail';

export interface Knot {
  /** Career time: years after graduating, or 'now' (sorted after every year). */
  tau: number | 'now';
  x: number;
  /** 'lead' / 'trail': zero-height knots that close a shape's left / right side. */
  kind: KnotKind;
}

/** A band's edges at each knot of its chart (top <= bottom, in the chart's y). */
export interface BandEdges { top: number[]; bottom: number[] }

export interface ChartShape {
  knots: Knot[];
  /** Bands by key (a field, a sector, or REST), in paint order (bottom of the stack first). */
  bands: Map<string, BandEdges>;
  /** Fill opacity a band has in this chart (the stacked chart tones same-colour neighbours). */
  tone: Map<string, number>;
}

/** What a chart hands the morph: where it is on the page, and its shape in its own coordinates. */
export interface MorphSource {
  svg: SVGSVGElement | null;
  /** Width of the chart's own coordinate system (svg user units). */
  width: number;
  /** The chart has measured its container, so its layout is final. */
  ready: boolean;
  shape: () => ChartShape;
}

// ── Extracting shapes ───────────────────────────────────────────────────────

const STAGE_TAU: Record<string, number | 'now'> = { s0: 0, y3: 3, y5: 5, y10: 10, y20: 20, now: 'now' };

/**
 * The Sankey as bands: per field, its bar in every column (or a zero-height placeholder where the
 * field isn't published, between the fields it sorts between), plus REST as a zero-height band on
 * top of each column (the stacked chart's "not shown" grows out of it).
 */
export function sankeyShape(layout: RiverLayout): ChartShape {
  const knots: Knot[] = [];
  const keys = new Set<string>();
  const nodeW = layout.nodes[0] ? layout.nodes[0].x1 - layout.nodes[0].x0 : 0;
  for (const s of layout.stages) {
    const tau = STAGE_TAU[s.id] ?? 'now';
    knots.push({ tau, x: s.x, kind: 'lead' }, { tau, x: s.x, kind: 'full' }, { tau, x: s.x + nodeW, kind: 'full' }, { tau, x: s.x + nodeW, kind: 'trail' });
  }
  for (const d of layout.nodes) keys.add(d.family);
  const order = [...keys].sort(compareFamilies).reverse(); // bottom of the stack first
  const mid = (layout.height) / 2;

  const bands = new Map<string, BandEdges>();
  for (const key of [...order, REST]) bands.set(key, { top: [], bottom: [] });
  layout.stages.forEach((s) => {
    const col = layout.nodes.filter((d) => d.stage === s.id).sort((a, b) => a.y0 - b.y0);
    for (const [key, band] of bands) {
      const node = col.find((d) => d.family === key);
      let top: number;
      let bottom: number;
      if (node) {
        top = node.y0;
        bottom = node.y1;
      } else {
        let y: number;
        if (key === REST) y = col.length ? col[0].y0 - 2 : mid;
        else {
          const above = col.filter((d) => compareFamilies(d.family, key) < 0).pop();
          const below = col.find((d) => compareFamilies(d.family, key) > 0);
          y = above && below ? (above.y1 + below.y0) / 2 : above ? above.y1 + 2 : below ? below.y0 - 2 : mid;
        }
        top = bottom = y;
      }
      const c = (top + bottom) / 2;
      band.top.push(c, top, top, c);
      band.bottom.push(c, bottom, bottom, c);
    }
  });
  const tone = new Map<string, number>([...bands.keys()].map((k) => [k, 1]));
  return { knots, bands, tone };
}

/**
 * The stacked chart as bands: a knot per year (runs of years open and close with zero-height
 * knots), four per column (Today, or a year with no neighbours). Edges come from stackRow, the
 * same numbers the chart draws.
 */
export function yearsShape(series: YearSeries, layout: YearsLayout): ChartShape {
  const { y0: top0, y1: bottom0 } = layout.plot;
  const py = (v: number) => bottom0 - v * (bottom0 - top0);
  const stacks = series.rows.map((r) => stackRow(r, series.groups));
  const keys = stacks[0]?.map((b) => b.key as string) ?? [];
  const bands = new Map<string, BandEdges>(keys.map((k) => [k, { top: [], bottom: [] }]));
  const knots: Knot[] = [];
  const push = (i: number, x: number, kind: KnotKind) => {
    knots.push({ tau: series.rows[i].year, x, kind });
    keys.forEach((k, j) => {
      const b = stacks[i][j];
      const top = py(b.y1);
      const bottom = py(b.y0);
      const band = bands.get(k)!;
      if (kind === 'full') { band.top.push(top); band.bottom.push(bottom); } else { const c = (top + bottom) / 2; band.top.push(c); band.bottom.push(c); }
    });
  };
  const pts = layout.points;
  pts.forEach((p, i) => {
    if (p.bar) {
      push(i, p.bar.x0, 'lead'); push(i, p.bar.x0, 'full'); push(i, p.bar.x1, 'full'); push(i, p.bar.x1, 'trail');
      return;
    }
    const prev = pts[i - 1];
    const next = pts[i + 1];
    const opens = !prev || prev.bar != null || prev.year === 'now' || (typeof prev.year === 'number' && typeof p.year === 'number' && prev.year !== p.year - 1);
    const closes = !next || next.bar != null || next.year === 'now' || (typeof next.year === 'number' && typeof p.year === 'number' && next.year !== p.year + 1);
    if (opens) push(i, p.x, 'lead');
    push(i, p.x, 'full');
    if (closes) push(i, p.x, 'trail');
  });
  const tones = toneOf(series.groups);
  const tone = new Map<string, number>(keys.map((k) => [k, k === REST ? 1 : tones.get(k) ?? 1]));
  return { knots, bands, tone };
}

/** Move a shape from its chart's coordinates to the stage's: scaled by `s`, then shifted. */
export function placeShape(shape: ChartShape, dx: number, dy: number, s = 1): ChartShape {
  const bands = new Map<string, BandEdges>();
  for (const [k, b] of shape.bands) bands.set(k, { top: b.top.map((y) => dy + y * s), bottom: b.bottom.map((y) => dy + y * s) });
  return { knots: shape.knots.map((k) => ({ ...k, x: dx + k.x * s })), bands, tone: shape.tone };
}

// ── Lining two shapes up ────────────────────────────────────────────────────

/** A merged knot on one side: a real knot of that chart, or a zero-height point between two. */
type Slot = { i: number } | { prev: number; next: number; f: number };

export interface MorphBand {
  key: string;
  /** Fill: the field's colour; REST is hatched. */
  color: string;
  hatch: boolean;
  /** x and edges at each merged knot, at the Flow end (a) and the Year-by-year end (b). */
  xa: number[]; ta: number[]; ba: number[];
  xb: number[]; tb: number[]; bb: number[];
  /** Edges of the middle shape (lanes at the Flow x's: each bar flowing into its own next bar). */
  tm: number[]; bm: number[];
  /** Fill opacity at each end (0 where the band only exists in the other chart). */
  oa: number; ob: number;
}

export interface MorphPlan { bands: MorphBand[]; knots: number }

const tauValue = (t: number | 'now', now: number) => (t === 'now' ? now : t);

/** Split a slot list into zero-height opener, full knots and zero-height closer. */
function parts(shape: ChartShape, slots: Slot[]): { lead: Slot | null; full: Slot[]; trail: Slot | null } {
  const kind = (s: Slot) => ('i' in s ? shape.knots[s.i].kind : 'full');
  const lead = slots.length > 1 && kind(slots[0]) === 'lead' ? slots[0] : null;
  const trail = slots.length > 1 && kind(slots[slots.length - 1]) === 'trail' ? slots[slots.length - 1] : null;
  const full = slots.slice(lead ? 1 : 0, trail ? -1 : undefined);
  return { lead, full: full.length ? full : [lead ?? trail!], trail };
}

/**
 * Pair the knots of two shapes by career time. At each time both sides get the same number of
 * knots: zero-height openers and closers pair with each other (or with a full knot repeated), and
 * the shorter list of full knots is stretched by repeating. A side with no knot at that time gets a
 * zero-height point interpolated between its neighbours (it's between columns, or in a gap).
 */
export function alignKnots(a: ChartShape, b: ChartShape): { a: Slot[]; b: Slot[]; now: number } {
  const nums = [...a.knots, ...b.knots].map((k) => k.tau).filter((t): t is number => t !== 'now');
  const now = (nums.length ? Math.max(...nums) : 0) + 1;
  const taus = [...new Set([...a.knots, ...b.knots].map((k) => tauValue(k.tau, now)))].sort((x, y) => x - y);
  const at = (shape: ChartShape, tau: number): Slot[] => {
    const own = shape.knots.map((k, i) => ({ k, i })).filter(({ k }) => tauValue(k.tau, now) === tau).map(({ i }) => ({ i }));
    if (own.length) return own;
    let prev = -1;
    let next = -1;
    shape.knots.forEach((k, i) => {
      const t = tauValue(k.tau, now);
      if (t < tau) prev = i;
      if (t > tau && next < 0) next = i;
    });
    if (prev < 0 && next < 0) return [];
    if (prev < 0) return [{ prev: next, next, f: 0 }];
    if (next < 0) return [{ prev, next: prev, f: 0 }];
    const tp = tauValue(shape.knots[prev].tau, now);
    const tn = tauValue(shape.knots[next].tau, now);
    return [{ prev, next, f: tn > tp ? (tau - tp) / (tn - tp) : 0 }];
  };
  const outA: Slot[] = [];
  const outB: Slot[] = [];
  for (const tau of taus) {
    const sa = at(a, tau);
    const sb = at(b, tau);
    if (!sa.length || !sb.length) continue;
    const pa = parts(a, sa);
    const pb = parts(b, sb);
    if (pa.lead || pb.lead) { outA.push(pa.lead ?? pa.full[0]); outB.push(pb.lead ?? pb.full[0]); }
    const n = Math.max(pa.full.length, pb.full.length);
    for (let k = 0; k < n; k++) {
      outA.push(pa.full[Math.floor((k * pa.full.length) / n)]);
      outB.push(pb.full[Math.floor((k * pb.full.length) / n)]);
    }
    if (pa.trail || pb.trail) { outA.push(pa.trail ?? pa.full[pa.full.length - 1]); outB.push(pb.trail ?? pb.full[pb.full.length - 1]); }
  }
  return { a: outA, b: outB, now };
}

const lerp = (p: number, q: number, t: number) => p + (q - p) * t;

/** x and edges of a band at the merged knots of one side. */
function sample(shape: ChartShape, band: BandEdges, slots: Slot[]): { x: number[]; top: number[]; bottom: number[] } {
  const x: number[] = [];
  const top: number[] = [];
  const bottom: number[] = [];
  for (const s of slots) {
    if ('i' in s) {
      x.push(shape.knots[s.i].x); top.push(band.top[s.i]); bottom.push(band.bottom[s.i]);
    } else {
      const c = (i: number) => (band.top[i] + band.bottom[i]) / 2;
      x.push(lerp(shape.knots[s.prev].x, shape.knots[s.next].x, s.f));
      const y = lerp(c(s.prev), c(s.next), s.f);
      top.push(y); bottom.push(y);
    }
  }
  return { x, top, bottom };
}

const smooth = (u: number) => u * u * (3 - 2 * u);

/**
 * The middle shape on side `a`: zero-height knots take the edges of the bar they close, and
 * points between two bars ease from one bar's edges to the next one's, so every band is a lane.
 */
function sampleLanes(shape: ChartShape, band: BandEdges, slots: Slot[]): { top: number[]; bottom: number[] } {
  const full = (i: number) => {
    const k = shape.knots[i].kind;
    const j = k === 'lead' ? Math.min(i + 1, shape.knots.length - 1) : k === 'trail' ? Math.max(i - 1, 0) : i;
    return [band.top[j], band.bottom[j]];
  };
  const top: number[] = [];
  const bottom: number[] = [];
  for (const s of slots) {
    if ('i' in s) {
      const [t, b] = full(s.i);
      top.push(t); bottom.push(b);
    } else {
      const [t0, b0] = full(s.prev);
      const [t1, b1] = full(s.next);
      const u = smooth(s.f);
      top.push(lerp(t0, t1, u)); bottom.push(lerp(b0, b1, u));
    }
  }
  return { top, bottom };
}

/** Thickness-weighted split of a sector band into its fields (top to bottom in chart order). */
function splitBand(band: BandEdges, fields: string[], weights: number[], field: string): BandEdges {
  const order = fields.map((f, i) => ({ f, w: weights[i] })).sort((p, q) => compareFamilies(p.f, q.f));
  const total = order.reduce((s, o) => s + o.w, 0) || 1;
  let before = 0;
  for (const o of order) { if (o.f === field) break; before += o.w; }
  const own = order.find((o) => o.f === field)?.w ?? 0;
  const top: number[] = [];
  const bottom: number[] = [];
  band.top.forEach((t, i) => {
    const h = band.bottom[i] - t;
    top.push(t + (h * before) / total);
    bottom.push(t + (h * (before + own)) / total);
  });
  return { top, bottom };
}

const meanThickness = (b: BandEdges) => (b.top.length ? b.top.reduce((s, t, i) => s + (b.bottom[i] - t), 0) / b.top.length : 0);

/**
 * Plan the morph from Flow (`a`) to Year by year (`b`). Bands match by key. A field in one chart
 * whose sector is a band in the other starts from (or ends in) its share of the sector's band,
 * split by the fields' average thickness. A band in one chart only fades in or out where it is.
 */
export function planMorph(a: ChartShape, b: ChartShape): MorphPlan {
  const { a: slotsA, b: slotsB } = alignKnots(a, b);
  const bands: MorphBand[] = [];
  const keys = [...new Set([...b.bands.keys(), ...a.bands.keys()])];
  const consumed = new Set<string>();
  const fieldsOf = (shape: ChartShape, sector: string) => [...shape.bands.keys()].filter((k) => k !== sector && groupOf(k) === sector);

  for (const key of keys) {
    const inA = a.bands.get(key);
    const inB = b.bands.get(key);
    let ea = inA;
    let eb = inB;
    let toneA = a.tone.get(key);
    let toneB = b.tone.get(key);
    const sector = groupOf(key);
    if (inA && !inB && sector !== key && isSectorGroup(sector) && b.bands.has(sector) && !a.bands.has(sector)) {
      const fields = fieldsOf(a, sector);
      eb = splitBand(b.bands.get(sector)!, fields, fields.map((f) => meanThickness(a.bands.get(f)!)), key);
      toneB = b.tone.get(sector);
      consumed.add(sector);
    } else if (inB && !inA && sector !== key && isSectorGroup(sector) && a.bands.has(sector) && !b.bands.has(sector)) {
      const fields = fieldsOf(b, sector);
      ea = splitBand(a.bands.get(sector)!, fields, fields.map((f) => meanThickness(b.bands.get(f)!)), key);
      toneA = a.tone.get(sector);
      consumed.add(sector);
    }
    if (!ea && !eb) continue;
    const pa = ea ? sample(a, ea, slotsA) : null;
    const pb = eb ? sample(b, eb, slotsB) : null;
    // Only in one chart: stay where it is and fade.
    const A = pa ?? pb!;
    const B = pb ?? pa!;
    const M = ea && eb ? sampleLanes(a, ea, slotsA) : A;
    bands.push({
      key,
      color: key === REST ? 'none' : groupColor(key),
      hatch: key === REST,
      xa: A.x, ta: A.top, ba: A.bottom,
      xb: B.x, tb: B.top, bb: B.bottom,
      tm: M.top, bm: M.bottom,
      oa: ea ? toneA ?? 1 : 0,
      ob: eb ? toneB ?? 1 : 0,
    });
  }
  return { bands: bands.filter((d) => !consumed.has(d.key)), knots: slotsA.length };
}

// ── Frames ──────────────────────────────────────────────────────────────────

const r2 = (v: number) => Math.round(v * 100) / 100;

/** The band's outline: top edge left to right, bottom edge back, flat-tangent curves between knots. */
export function bandPath(xs: number[], tops: number[], bottoms: number[]): string {
  const n = xs.length;
  if (!n) return '';
  let d = `M${r2(xs[0])},${r2(tops[0])}`;
  for (let i = 1; i < n; i++) {
    const xm = r2((xs[i - 1] + xs[i]) / 2);
    d += `C${xm},${r2(tops[i - 1])} ${xm},${r2(tops[i])} ${r2(xs[i])},${r2(tops[i])}`;
  }
  d += `L${r2(xs[n - 1])},${r2(bottoms[n - 1])}`;
  for (let i = n - 2; i >= 0; i--) {
    const xm = r2((xs[i + 1] + xs[i]) / 2);
    d += `C${xm},${r2(bottoms[i + 1])} ${xm},${r2(bottoms[i])} ${r2(xs[i])},${r2(bottoms[i])}`;
  }
  return `${d}Z`;
}

/** Where on the eased timeline the middle shape (the lanes) sits. */
export const LANES_AT = 0.4;

/**
 * Edges of a band at eased progress `e` (0 = Flow, 1 = Year by year): Flow bars to lanes (in
 * place) up to LANES_AT, then lanes to the stacked bands (sliding to the years' x's).
 */
export function bandAt(band: MorphBand, e: number): { x: number[]; top: number[]; bottom: number[]; opacity: number } {
  const t = Math.min(1, Math.max(0, e));
  let x: number[];
  let top: number[];
  let bottom: number[];
  if (t <= LANES_AT) {
    const s = t / LANES_AT;
    x = band.xa.slice();
    top = band.ta.map((v, i) => lerp(v, band.tm[i], s));
    bottom = band.ba.map((v, i) => lerp(v, band.bm[i], s));
  } else {
    const s = (t - LANES_AT) / (1 - LANES_AT);
    x = band.xa.map((v, i) => lerp(v, band.xb[i], s));
    top = band.tm.map((v, i) => lerp(v, band.tb[i], s));
    bottom = band.bm.map((v, i) => lerp(v, band.bb[i], s));
  }
  for (let i = 0; i < bottom.length; i++) if (bottom[i] < top[i]) bottom[i] = top[i];
  return { x, top, bottom, opacity: lerp(band.oa, band.ob, t) };
}

export function framePath(band: MorphBand, e: number): string {
  const f = bandAt(band, e);
  return bandPath(f.x, f.top, f.bottom);
}

/** Ease in and out (cubic). */
export function easeInOut(t: number): number {
  const p = Math.min(1, Math.max(0, t));
  return p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2;
}

/** 0 before `a`, 1 after `b`, smooth in between. */
export function ramp(t: number, a: number, b: number): number {
  if (t <= a) return 0;
  if (t >= b) return 1;
  const u = (t - a) / (b - a);
  return u * u * (3 - 2 * u);
}

/**
 * Opacities at linear progress `p` (0 = Flow, 1 = Year by year): the outgoing chart's labels,
 * flows and axes fade early, the incoming chart's late, and the drawn bands carry the shape in
 * between, appearing over the first chart and dissolving into the second (so the hand-off at
 * either end has nothing to jump).
 */
export function morphOpacity(p: number): { flow: number; years: number; overlay: number } {
  return {
    flow: 1 - ramp(p, 0.03, 0.3),
    years: ramp(p, 0.7, 0.97),
    overlay: ramp(p, 0, 0.06) * (1 - ramp(p, 0.94, 1)),
  };
}

/** How long a full morph takes (ms); a reversal takes as long as the way back. */
export const MORPH_MS = 700;
