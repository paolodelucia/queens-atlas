/**
 * Landing page: pure logic. Everything the page shows is shaped here from meta.json,
 * insights.json and (for the river card) one river.json slice, so it is unit-tested
 * without a DOM (model.test.ts).
 *
 * Privacy rule carried over from the River: we only ever show numbers the export published
 * (each >= k, and each already perturbed by the pipeline's cell-key noise), sums of them, or
 * shares computed from those sums. Nothing is derived by subtracting one published count from
 * another, and nothing here assumes the published parts add up exactly to a published total.
 */
import { FAMILY, LEVEL, SECTORS } from '../../data/taxonomy';
import type { SectorId } from '../../data/taxonomy';
import type { Fact, FamilyId, LevelId, NamedCount, ProgramInfo, ProgramRanking, RiverSlice, StageId } from '../../data/types';
import { fmtInt } from '../../lib/format';

// ── Numbers ──────────────────────────────────────────────────────────────────

/**
 * Headline rounding, for any rounded mention of a count, so the page never says "92k" in one
 * place and "93,000" in another: 12,345 -> "12,000"; 9,512 -> "10,000"; under 1,000 stays exact.
 */
export function headlineNumber(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return '0';
  if (n < 1000) return fmtInt(n);
  return fmtInt(Math.round(n / 1000) * 1000);
}

const MONTHS_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * The snapshot month from meta.snapshot: "2025-09" -> "September 2025" in prose, "Sep 2025" in
 * compact places (eyebrows, card footers). Falls back to the raw string when malformed.
 */
export function fmtSnapshot(ym: string, style: 'long' | 'short' = 'long'): string {
  const m = /^(\d{4})-(\d{2})$/.exec(ym ?? '');
  if (!m) return ym ?? '';
  const month = Number(m[2]);
  if (month < 1 || month > 12) return ym;
  return `${(style === 'short' ? MONTHS_SHORT : MONTHS_LONG)[month - 1]} ${m[1]}`;
}

/**
 * A share for display: whole percent from 10% up, one decimal below (5.5%), "<1%" for
 * tiny non-zero shares. Input is a percentage (53.5 means 53.5%).
 */
export function fmtShare(pct: number): string {
  if (!Number.isFinite(pct)) return '—';
  if (pct > 0 && pct < 1) return '<1%';
  if (pct >= 10 || Number.isInteger(pct)) return `${Math.round(pct)}%`;
  return `${pct.toFixed(1).replace(/\.0$/, '')}%`;
}

// ── Program labels ───────────────────────────────────────────────────────────

/** Short level tags used after a program name: "Computer Science (master’s/PhD)". */
export const LEVEL_TAG: Record<LevelId, string> = {
  all: '',
  undergrad: 'undergrad',
  graduate: 'master’s/PhD',
  mba: 'MBA',
  law: 'JD',
  medicine: 'MD',
};

/** Program names that name their own level, so a tag would only repeat them. */
const SELF_NAMED: Partial<Record<LevelId, string>> = { mba: 'mba', law: 'law', medicine: 'medicine' };

export interface ProgramLabel {
  name: string;           // "Computer Science"
  tag: string | null;     // "master’s/PhD", or null when the name says it all
  text: string;           // "Computer Science (master’s/PhD)" — for screen readers and tests
}

/**
 * "Program (level)" on every row, so a list never mixes tagged and untagged names (a bare
 * "Applied Mathematics" next to "Physics (undergrad)" reads as a different kind of thing).
 * Programs that name their own level (MBA at level mba, Law at level law) never get a tag.
 */
export function programLabel(level: LevelId, program: string): ProgramLabel {
  const name = program.trim();
  const selfNamed = SELF_NAMED[level] === name.toLowerCase();
  const tag = !selfNamed && level !== 'all' ? LEVEL_TAG[level] || null : null;
  return { name, tag, text: tag ? `${name} (${tag})` : name };
}

// ── Leaderboards ─────────────────────────────────────────────────────────────

/**
 * Short tab labels. Bars are one single-series colour (--data-mono) on every tab: a share of a
 * program is a magnitude, not a category, so sector colours stay with the River.
 */
const RANKING_TABS: Record<string, string> = {
  tech_now: 'Tech',
  finance_now: 'Finance',
  consulting_now: 'Consulting',
  founder_now: 'Founders',
  study_first: 'More study',
  abroad_now: 'Abroad',
  us_now: 'In the US',
};

/** Short tab label for a ranking; unknown ids fall back to the ranking's own label. */
export function rankingTab(r: ProgramRanking): string {
  return RANKING_TABS[r.id] ?? r.label;
}

export interface RankRow {
  key: string;
  rank: number;
  label: ProgramLabel;
  pct: number;
  share: string;        // "54%"
  hits: number;
  n: number;
  width: number;        // 0..1 of the panel's largest share
}

/** The line under a leaderboard's title: what's ranked and who's counted. */
export function rankingNote(r: ProgramRanking, years: { from: number; to: number }, minGrads: number): string {
  const located = r.id === 'abroad_now' || r.id === 'us_now';
  const top = r.rows.length === 1 ? 'The one program' : `Top ${r.rows.length} programs`;
  return `${top} by share of grads${located ? ' with a known location' : ''}, classes of ${years.from}–${years.to}. `
    + `Programs with at least ${fmtInt(minGrads)} grads.`;
}

/** Rankings worth a tab: at least one row. */
export function usableRankings(rankings: ProgramRanking[] | undefined): ProgramRanking[] {
  return (rankings ?? []).filter((r) => r.rows.length > 0);
}

/** One ranking's rows, largest share first, with bar widths relative to the top row. */
export function rankRows(r: ProgramRanking): RankRow[] {
  const rows = [...r.rows].sort((a, b) => b.pct - a.pct || b.n - a.n);
  const max = Math.max(0, ...rows.map((x) => x.pct));
  return rows.map((x, i) => ({
    key: `${x.level}|${x.program}`,
    rank: i + 1,
    label: programLabel(x.level, x.program),
    pct: x.pct,
    share: fmtShare(x.pct),
    hits: x.hits,
    n: x.n,
    width: max > 0 ? Math.max(0, x.pct) / max : 0,
  }));
}

/**
 * Roving-tabindex keyboard model for the tab list (WAI-ARIA tabs, automatic activation).
 * Returns the index to move to, or null when the key isn't a tab-navigation key.
 */
export function nextTabIndex(current: number, key: string, count: number): number | null {
  if (count <= 0) return null;
  switch (key) {
    case 'ArrowRight': return (current + 1) % count;
    case 'ArrowLeft': return (current - 1 + count) % count;
    case 'Home': return 0;
    case 'End': return count - 1;
    default: return null;
  }
}

// ── Employers ────────────────────────────────────────────────────────────────

export interface EmployerBar { name: string; n: number; width: number; rank: number }

export function employerBars(list: NamedCount[] | undefined, limit = 20): EmployerBar[] {
  const rows = [...(list ?? [])].filter((e) => e.n > 0).sort((a, b) => b.n - a.n).slice(0, Math.max(0, limit));
  const max = rows[0]?.n ?? 0;
  return rows.map((e, i) => ({ name: e.name, n: e.n, width: max > 0 ? e.n / max : 0, rank: i + 1 }));
}

// ── Facts ────────────────────────────────────────────────────────────────────

export type FactVisual =
  | { kind: 'share'; share: number }       // "39%" -> a meter
  | { kind: 'oneIn'; of: number }          // "1 in 34" -> a row of 34 marks, one filled
  | { kind: 'none' };

/** Reads the fact's display value to pick a small honest visual; anything else gets none. */
export function factVisual(value: string): FactVisual {
  const v = (value ?? '').trim();
  const pct = /^(\d+(?:\.\d+)?)\s*%$/.exec(v);
  if (pct) {
    const share = Number(pct[1]) / 100;
    return share > 0 && share <= 1 ? { kind: 'share', share } : { kind: 'none' };
  }
  const one = /^1\s+in\s+([\d,]+)$/i.exec(v);
  if (one) {
    const of = Number(one[1].replace(/,/g, ''));
    if (of >= 2 && of <= 60) return { kind: 'oneIn', of };
    if (of > 60) return { kind: 'share', share: 1 / of };
  }
  return { kind: 'none' };
}

/** Numbers render at poster size; a word-value ("Queen's University") gets a smaller face. */
export function isNumericValue(value: string): boolean {
  return /^[\d.,%\s]+$|^1\s+in\s+[\d,]+$/i.test((value ?? '').trim()) && /\d/.test(value ?? '');
}

/** Call to action for a fact's link, by destination. Null when there's no in-app link. */
export function factLinkLabel(link: string | undefined | null): string | null {
  if (!link || !link.startsWith('/')) return null;
  const path = link.split(/[?#]/)[0];
  if (path === '/river') return 'See it in the River';
  if (path === '/diaspora') return 'See it on the map';
  if (path === '/twin') return 'Find your career twin';
  if (path === '/method') return 'How it was measured';
  return 'Open it';
}

/** The three findings on the landing page, in this order, when the data has them. */
export const FEATURED_FACTS = ['top_metro', 'law_stays', 'consulting_exit'];

/**
 * Split the facts into the featured few and the rest. Featured ids come first in the given
 * order; ids the data doesn't have are skipped and the gap is filled from the remaining facts in
 * file order, so a renamed or dropped fact never leaves a hole in the row.
 */
export function featuredFacts(facts: Fact[] | undefined, ids: readonly string[] = FEATURED_FACTS, count = ids.length): { featured: Fact[]; rest: Fact[] } {
  const all = [...(facts ?? [])];
  const byId = new Map(all.map((f) => [f.id, f]));
  const picked = ids.map((id) => byId.get(id)).filter((f): f is Fact => Boolean(f));
  const unique = [...new Set(picked)];
  for (const f of all) {
    if (unique.length >= count) break;
    if (!unique.includes(f)) unique.push(f);
  }
  const featured = unique.slice(0, Math.max(0, count));
  return { featured, rest: all.filter((f) => !featured.includes(f)) };
}

/**
 * A margin note for a fact card, only where the fact's own number supports it (a sticker that
 * says "most" needs a majority). Lowercase, as the voice guide asks of stickers.
 */
const FACT_STICKERS: Record<string, { text: string; minShare: number }> = {
  law_stays: { text: 'most lawyers are still lawyers', minShare: 0.5 },
};

export function factSticker(fact: Fact): string | null {
  const rule = FACT_STICKERS[fact.id];
  if (!rule) return null;
  const v = factVisual(fact.value);
  return v.kind === 'share' && v.share >= rule.minShare ? rule.text : null;
}

const normName = (s: string) => s.toLowerCase().replace(/[’']/g, '').replace(/\s+/g, ' ').trim();

/**
 * Context for the first-employers list: when the "most common first employer" fact names the
 * list's top row (Queen's itself), its detail explains why (mostly research and teaching roles).
 */
export function firstEmployerNote(facts: Fact[] | undefined, top: { name: string } | undefined): string | null {
  const fact = (facts ?? []).find((f) => f.id === 'top_first_employer');
  if (!fact?.detail || !top || normName(fact.value) !== normName(top.name)) return null;
  return `${top.name}: ${fact.detail}`;
}

// ── Hero motif: a sector-level river ─────────────────────────────────────────

export interface FlowNode { stage: StageId; sector: SectorId; value: number }
export interface FlowLink { from: StageId; fromSector: SectorId; to: StageId; toSector: SectorId; value: number }
export interface FlowData { stages: StageId[]; nodes: FlowNode[]; links: FlowLink[]; n: number }

const SECTOR_ORDER = SECTORS.map((s) => s.id);
const sectorOf = (f: FamilyId): SectorId => FAMILY[f]?.sector ?? 'neutral';

/**
 * Roll a River slice's 19 families up to the 9 colour sectors. Sums of published (>= k)
 * counts only; links under k were never exported, so they're simply absent.
 */
export function sectorFlows(slice: RiverSlice | undefined | null): FlowData {
  if (!slice) return { stages: [], nodes: [], links: [], n: 0 };
  const stages = slice.stages.filter((s) => slice.totals[s]);
  const nodeMap = new Map<string, FlowNode>();
  for (const stage of stages) {
    for (const [fam, n] of Object.entries(slice.totals[stage] ?? {})) {
      if (!n || n <= 0) continue;
      const sector = sectorOf(fam as FamilyId);
      const key = `${stage}|${sector}`;
      const node = nodeMap.get(key) ?? { stage, sector, value: 0 };
      node.value += n;
      nodeMap.set(key, node);
    }
  }
  const linkMap = new Map<string, FlowLink>();
  for (const l of slice.links) {
    if (!stages.includes(l.from_stage) || !stages.includes(l.to_stage) || l.n <= 0) continue;
    const fromSector = sectorOf(l.from);
    const toSector = sectorOf(l.to);
    const key = `${l.from_stage}|${fromSector}|${l.to_stage}|${toSector}`;
    const link = linkMap.get(key) ?? { from: l.from_stage, fromSector, to: l.to_stage, toSector, value: 0 };
    link.value += l.n;
    linkMap.set(key, link);
  }
  const rank = (s: SectorId) => SECTOR_ORDER.indexOf(s);
  const nodes = [...nodeMap.values()].sort((a, b) =>
    stages.indexOf(a.stage) - stages.indexOf(b.stage) || rank(a.sector) - rank(b.sector));
  const links = [...linkMap.values()].sort((a, b) =>
    stages.indexOf(a.from) - stages.indexOf(b.from) || rank(a.fromSector) - rank(b.fromSector) || rank(a.toSector) - rank(b.toSector));
  return { stages, nodes, links, n: slice.n };
}

export interface LaidNode extends FlowNode { x: number; y: number; h: number }
export interface LaidLink extends FlowLink { x0: number; x1: number; y0: number; y1: number; w: number; d: string }
export interface FlowLayout { width: number; height: number; nodeWidth: number; nodes: LaidNode[]; links: LaidLink[] }

/**
 * A small Sankey layout: one column per stage, sectors stacked in palette order, one shared
 * vertical scale so a column's height is its people. Links are centre-lines meant to be drawn
 * with stroke-width = w (the d3-sankey convention), ordered so ribbons don't cross at a node.
 */
export function layoutFlows(
  data: FlowData,
  opts: { width: number; height: number; nodeWidth?: number; gap?: number },
): FlowLayout {
  const { width, height } = opts;
  const nodeWidth = opts.nodeWidth ?? 6;
  const gap = opts.gap ?? 6;
  const cols = data.stages.length;
  const empty = { width, height, nodeWidth, nodes: [], links: [] };
  if (cols === 0 || width <= 0 || height <= 0) return empty;

  const byStage = data.stages.map((s) => data.nodes.filter((n) => n.stage === s));
  // A node is as tall as the most people it carries in, out, or in total.
  const flowIn = new Map<string, number>();
  const flowOut = new Map<string, number>();
  for (const l of data.links) {
    flowOut.set(`${l.from}|${l.fromSector}`, (flowOut.get(`${l.from}|${l.fromSector}`) ?? 0) + l.value);
    flowIn.set(`${l.to}|${l.toSector}`, (flowIn.get(`${l.to}|${l.toSector}`) ?? 0) + l.value);
  }
  const size = (n: FlowNode) => Math.max(n.value, flowIn.get(`${n.stage}|${n.sector}`) ?? 0, flowOut.get(`${n.stage}|${n.sector}`) ?? 0);

  const ky = Math.min(...byStage.map((col) => {
    const total = col.reduce((a, n) => a + size(n), 0);
    const room = height - gap * Math.max(0, col.length - 1);
    return total > 0 && room > 0 ? room / total : Infinity;
  }));
  if (!Number.isFinite(ky)) return empty;

  const step = cols > 1 ? (width - nodeWidth) / (cols - 1) : 0;
  const laid = new Map<string, LaidNode>();
  byStage.forEach((col, i) => {
    const total = col.reduce((a, n) => a + size(n) * ky, 0) + gap * Math.max(0, col.length - 1);
    let y = (height - total) / 2;
    for (const n of col) {
      const h = size(n) * ky;
      laid.set(`${n.stage}|${n.sector}`, { ...n, x: i * step, y, h });
      y += h + gap;
    }
  });

  const rank = (s: SectorId) => SECTOR_ORDER.indexOf(s);
  const outOffset = new Map<string, number>();
  const inOffset = new Map<string, number>();
  // Outgoing ribbons leave in target order; incoming ones arrive in source order.
  const outgoing = [...data.links].sort((a, b) => rank(a.fromSector) - rank(b.fromSector) || rank(a.toSector) - rank(b.toSector));
  const incoming = [...data.links].sort((a, b) => rank(a.toSector) - rank(b.toSector) || rank(a.fromSector) - rank(b.fromSector));
  const sy = new Map<FlowLink, number>();
  const ty = new Map<FlowLink, number>();
  for (const l of outgoing) {
    const src = laid.get(`${l.from}|${l.fromSector}`);
    if (!src) continue;
    const k = `${l.from}|${l.fromSector}`;
    const off = outOffset.get(k) ?? 0;
    sy.set(l, src.y + off + (l.value * ky) / 2);
    outOffset.set(k, off + l.value * ky);
  }
  for (const l of incoming) {
    const tgt = laid.get(`${l.to}|${l.toSector}`);
    if (!tgt) continue;
    const k = `${l.to}|${l.toSector}`;
    const off = inOffset.get(k) ?? 0;
    ty.set(l, tgt.y + off + (l.value * ky) / 2);
    inOffset.set(k, off + l.value * ky);
  }

  const links: LaidLink[] = [];
  for (const l of data.links) {
    const src = laid.get(`${l.from}|${l.fromSector}`);
    const tgt = laid.get(`${l.to}|${l.toSector}`);
    const y0 = sy.get(l);
    const y1 = ty.get(l);
    if (!src || !tgt || y0 === undefined || y1 === undefined) continue;
    const x0 = src.x + nodeWidth;
    const x1 = tgt.x;
    const xm = (x0 + x1) / 2;
    links.push({
      ...l, x0, x1, y0, y1, w: l.value * ky,
      d: `M${r2(x0)},${r2(y0)}C${r2(xm)},${r2(y0)} ${r2(xm)},${r2(y1)} ${r2(x1)},${r2(y1)}`,
    });
  }
  return { width, height, nodeWidth, nodes: [...laid.values()], links };
}

const r2 = (x: number) => Math.round(x * 100) / 100;

/** The slice the river card draws: everyone, classes of 2010–2014 (they have reached year 10). */
export const HERO_SLICE = { level: 'all' as LevelId, program: 'all', cohort: '2010-2014' as const };

/** The one sector the river card highlights (operations & management + founders); the rest are dimmed. */
export const HERO_SECTOR: SectorId = 'management';

export interface StageShare { stage: StageId; pct: number; share: string }
export interface HeroStory {
  sector: SectorId;
  from: StageShare;
  to: StageShare;
  /** Every stage's share, in stage order (stages where the sector is absent are left out). */
  path: StageShare[];
  /** True when the sector's share grew by at least a whole point (rounded), so "drift into" is honest. */
  rising: boolean;
  /** Rising, and no stage's (rounded) share is below the one before: "keeps growing" is honest. */
  steady: boolean;
}

/**
 * The story the slice supports, computed from it: the highlighted sector's share of each stage's
 * people. Shares are a sector's summed (published) node counts over the column's summed counts;
 * a column can differ from the slice's n by a little because each count carries the pipeline's
 * privacy noise, so the column is the denominator.
 */
export function heroStory(data: FlowData, sector: SectorId = HERO_SECTOR): HeroStory | null {
  const first = data.stages[0];
  const last = data.stages[data.stages.length - 1];
  if (!first || !last || first === last) return null;
  const share = (stage: StageId): StageShare | null => {
    const col = data.nodes.filter((n) => n.stage === stage);
    const total = col.reduce((a, n) => a + n.value, 0);
    const v = col.find((n) => n.sector === sector)?.value ?? 0;
    if (!(total > 0) || !(v > 0)) return null;
    const pct = (100 * v) / total;
    return { stage, pct, share: fmtShare(pct) };
  };
  const from = share(first);
  const to = share(last);
  if (!from || !to) return null;
  const path = data.stages.map(share).filter((x): x is StageShare => Boolean(x));
  const rising = Math.round(to.pct) - Math.round(from.pct) >= 1;
  const steady = rising && path.length === data.stages.length
    && path.every((p, i) => i === 0 || Math.round(p.pct) >= Math.round(path[i - 1].pct));
  return { sector, from, to, path, rising, steady };
}

/** How a stage reads after a share: "12% at the first job", "19% today". */
export const STAGE_PHRASE: Record<StageId, string> = {
  s0: 'at the first job',
  y3: 'at year 3',
  y5: 'at year 5',
  y10: 'at year 10',
  y20: 'at year 20',
  now: 'today',
};

// ── Program search ───────────────────────────────────────────────────────────

type Level = Exclude<LevelId, 'all'>;

/** One program a visitor can pick: a level and a canonical name, as meta.programs lists it. */
export interface ProgramChoice {
  key: string;            // "undergrad|Computer Science"
  level: Level;
  program: string;        // canonical name, as the River and Twin expect it
  n: number;              // people with a career path (meta.programs[].n)
  river: boolean;         // the River has a slice for it
  /** The level, shown only when the same name exists at another level ("undergrad"); else null. */
  tag: string | null;
  /** What the search box shows once picked: "Computer Science (undergrad)", or just "Commerce". */
  text: string;
  /** The level in words, for the list's second line: "Undergraduate", "Master’s & PhD". */
  levelLabel: string;
}

const choiceKey = (level: string, program: string) => `${level}|${program}`;
const normProgram = (s: string) => s.trim().toLowerCase().replace(/[’']/g, '').replace(/\s+/g, ' ');
const isLevel = (l: string): l is Level => l !== 'all' && l in LEVEL;

/**
 * Every program in meta.programs as a search choice, largest first. A name that exists at more
 * than one level (Computer Science, Law, Education) carries its level in `text`, so "Law (JD)" and
 * "Law (master’s/PhD)" never look the same once picked. Duplicates (same level and name) are
 * dropped; a missing `river` flag means an older file, where every program had a River.
 */
export function programChoices(programs: ProgramInfo[] | undefined): ProgramChoice[] {
  const list = (programs ?? []).filter((p) => p.program?.trim() && isLevel(p.level));
  const levels = new Map<string, Set<string>>();
  for (const p of list) {
    const k = normProgram(p.program);
    levels.set(k, (levels.get(k) ?? new Set()).add(p.level));
  }
  const seen = new Set<string>();
  const out: ProgramChoice[] = [];
  for (const p of [...list].sort((a, b) => b.n - a.n)) {
    const key = choiceKey(p.level, p.program);
    if (seen.has(key)) continue;
    seen.add(key);
    const ambiguous = (levels.get(normProgram(p.program))?.size ?? 0) > 1;
    const tag = ambiguous ? LEVEL_TAG[p.level] || null : null;
    const name = p.program.trim();
    out.push({
      key, level: p.level, program: p.program, n: p.n, river: p.river !== false,
      tag, text: tag ? `${name} (${tag})` : name, levelLabel: LEVEL[p.level].label,
    });
  }
  return out;
}

/** The choice for a level and program from the URL (program matched without case); null if none. */
export function findChoice(choices: ProgramChoice[], level: string | null, program: string | null): ProgramChoice | null {
  if (!level || !program) return null;
  const want = normProgram(program);
  return choices.find((c) => c.level === level && c.program === program)
    ?? choices.find((c) => c.level === level && normProgram(c.program) === want)
    ?? null;
}

/** The "Popular" chips: the largest programs, one per name (the biggest level wins). */
export function popularChoices(choices: ProgramChoice[], count = 5): ProgramChoice[] {
  const names = new Set<string>();
  const out: ProgramChoice[] = [];
  for (const c of [...choices].sort((a, b) => b.n - a.n)) {
    if (out.length >= count) break;
    const k = normProgram(c.program);
    if (names.has(k)) continue;
    names.add(k);
    out.push(c);
  }
  return out;
}

/** "undergrads", "master’s and PhD grads": the level-wide River a program without its own falls back to. */
export const LEVEL_GRADS: Record<Level, string> = {
  undergrad: 'undergrads',
  graduate: 'master’s and PhD grads',
  mba: 'MBA grads',
  law: 'JD grads',
  medicine: 'MD grads',
};

const query = (pairs: [string, string][]) => new URLSearchParams(pairs).toString();

/**
 * Where "See where this class went" goes: the program's own River, or, for a program too small
 * for one, the River of its whole level.
 */
export function riverHref(c: ProgramChoice): string {
  return c.river
    ? `/river?${query([['level', c.level], ['program', c.program]])}`
    : `/river?${query([['level', c.level]])}`;
}

/** Where "Where it can take you" goes: Career Twin in student mode, program filled in. */
export function twinHref(c: ProgramChoice): string {
  return `/twin?${query([['mode', 'student'], ['level', c.level], ['program', c.program]])}`;
}

/** The landing page's own URL for a picked program (so Back from the River keeps the choice). */
export function homeHref(c: ProgramChoice | null): string {
  return c ? `/?${query([['level', c.level], ['program', c.program]])}` : '/';
}

export interface ProgramRank { id: string; label: string; rank: number; share: string }

/**
 * Where a program shows up on the leaderboards (insights.rankings), best rank first: "2nd for
 * finance & accounting today, 32%". Rows are matched on level and name.
 */
export function programRanks(rankings: ProgramRanking[] | undefined, c: ProgramChoice | null): ProgramRank[] {
  if (!c) return [];
  const out: ProgramRank[] = [];
  for (const r of usableRankings(rankings)) {
    const hit = rankRows(r).find((x) => x.key === choiceKey(c.level, c.program));
    if (hit) out.push({ id: r.id, label: r.label, rank: hit.rank, share: hit.share });
  }
  return out.sort((a, b) => a.rank - b.rank);
}

/** 1 -> "1st", 2 -> "2nd", 11 -> "11th", 23 -> "23rd". */
export function ordinal(n: number): string {
  const v = Math.abs(Math.trunc(n));
  const teen = v % 100 >= 11 && v % 100 <= 13;
  const suffix = teen ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' } as Record<number, string>)[v % 10] ?? 'th';
  return `${Math.trunc(n)}${suffix}`;
}
