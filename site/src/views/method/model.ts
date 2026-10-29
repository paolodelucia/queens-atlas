/**
 * Method page: pure helpers (unit-tested in model.test.ts). The page re-derives its worked
 * examples live from insights.json, so the prose can't drift from the data it describes.
 */
import type { CohortId, Floors, InsightsFile, Meta, StageId } from '../../data/types';
import { fmtInt } from '../../lib/format';

// ── Sections ─────────────────────────────────────────────────────────────────

export const SECTIONS = [
  { id: 'data', title: 'The data' },
  { id: 'dating', title: 'Dating the snapshot' },
  { id: 'labels', title: 'Teaching a model to read job titles' },
  { id: 'careers', title: 'From jobs to careers' },
  { id: 'privacy', title: 'Privacy' },
  { id: 'limits', title: 'Where the numbers bend' },
  { id: 'stack', title: 'Credits' },
] as const;

export type SectionId = (typeof SECTIONS)[number]['id'];

// ── Dates ────────────────────────────────────────────────────────────────────

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTHS_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** "2025-09" -> "Sep 2025" (long: "September 2025"); malformed input is returned unchanged. */
export function fmtMonth(ym: string, long = false): string {
  const m = /^(\d{4})-(\d{1,2})$/.exec(ym ?? '');
  if (!m) return ym ?? '';
  const i = Number(m[2]) - 1;
  if (i < 0 || i > 11) return ym;
  return `${(long ? MONTHS_LONG : MONTHS)[i]} ${m[1]}`;
}

/**
 * Parse an ISO-ish timestamp as UTC. The export writes minute precision without seconds
 * ("2025-09-29T20:52Z"), which some engines reject, so seconds are added when missing.
 */
export function parseUtc(iso: string | null | undefined): Date | null {
  if (!iso) return null;
  let s = iso.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) s += 'T00:00:00Z';
  s = s.replace(/T(\d{2}):(\d{2})(Z|[+-]\d{2}:?\d{2})?$/, (_, h, mi, z) => `T${h}:${mi}:00${z ?? 'Z'}`);
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** "2025-09-29 20:52 UTC" */
export function fmtUtc(d: Date | null): string {
  if (!d) return '—';
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())} UTC`;
}

/** "30 September 2025" in prose; "30 Sep 2025" (short) in compact places like the key facts. */
export function fmtDay(d: Date | null, short = false): string {
  if (!d) return '—';
  return `${d.getUTCDate()} ${(short ? MONTHS : MONTHS_LONG)[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

/** "Sep 29, 20:52 UTC" — short form for timeline labels. */
export function fmtShortUtc(d: Date | null): string {
  if (!d) return '—';
  const p = (n: number) => String(n).padStart(2, '0');
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}, ${p(d.getUTCHours())}:${p(d.getUTCMinutes())} UTC`;
}

// ── Clue 1: "Present" arithmetic ─────────────────────────────────────────────

/**
 * LinkedIn shows "Jan 2025 – Present · 9 mos", counting months inclusively, so the page was
 * viewed in month start + duration − 1. Returns that month as { year, month (1-12) }.
 */
export function viewedMonth(startYear: number, startMonth: number, durationMonths: number): { year: number; month: number } {
  const idx = startYear * 12 + (startMonth - 1) + Math.max(1, Math.round(durationMonths)) - 1;
  return { year: Math.floor(idx / 12), month: (idx % 12) + 1 };
}

export interface MonthBar { month: string; label: string; pct: number; width: number; top: boolean }

/** The "Present" chart: newest month first, widths relative to the largest share, mode flagged. */
export function snapshotBars(rows: { month: string; pct: number }[] | undefined): MonthBar[] {
  const clean = (rows ?? []).filter((r) => Number.isFinite(r.pct) && r.pct >= 0);
  const sorted = [...clean].sort((a, b) => b.month.localeCompare(a.month));
  const max = Math.max(0, ...sorted.map((r) => r.pct));
  return sorted.map((r) => ({
    month: r.month,
    label: fmtMonth(r.month, true),
    pct: r.pct,
    width: max > 0 ? r.pct / max : 0,
    top: max > 0 && r.pct === max,
  }));
}

/** "84.8%" / "0.4%" / "12%": one decimal unless it's whole. */
export function fmtPct1(pct: number): string {
  if (!Number.isFinite(pct)) return '—';
  return `${Number.isInteger(pct) ? pct : pct.toFixed(1)}%`;
}

// ── Clue 2: snowflake IDs ────────────────────────────────────────────────────

/** LinkedIn activity IDs are snowflakes: the top 41 bits are milliseconds since the epoch. */
export function snowflakeToMs(id: bigint): bigint {
  return id >> 22n;
}

/**
 * An illustrative ID for a timestamp (ms << 22, low bits zero). Used so the page can show the
 * trick on a real-shaped number without printing any real post's ID.
 */
export function msToSnowflake(ms: bigint): bigint {
  return ms << 22n;
}

// ── Clue 3: base36 timestamp ─────────────────────────────────────────────────

/** "mg5xrzjc" -> 1759199191464 (ms). Null for anything that isn't plain base36. */
export function decodeBase36(s: string): number | null {
  if (!/^[0-9a-z]{1,12}$/i.test(s ?? '')) return null;
  const n = parseInt(s.toLowerCase(), 36);
  return Number.isSafeInteger(n) ? n : null;
}

// ── Timeline of the three clues ──────────────────────────────────────────────

export interface TimelineMark { id: string; label: string; date: Date; x: number }

/**
 * Place the dating evidence on a [from, to) axis as fractions 0..1. Marks outside the axis are
 * clamped to its ends so a surprising date stays visible rather than vanishing.
 */
export function timelineMarks(
  marks: { id: string; label: string; date: Date | null }[],
  from: Date,
  to: Date,
): TimelineMark[] {
  const span = to.getTime() - from.getTime();
  if (!(span > 0)) return [];
  return marks
    .filter((m): m is { id: string; label: string; date: Date } => m.date instanceof Date && !Number.isNaN(m.date.getTime()))
    .map((m) => ({ ...m, x: Math.min(1, Math.max(0, (m.date.getTime() - from.getTime()) / span)) }));
}

/** The month the as-of date falls in, as a [first of month, first of next month) axis. */
export function monthAxis(asOf: Date | null): { from: Date; to: Date } | null {
  if (!asOf) return null;
  const from = new Date(Date.UTC(asOf.getUTCFullYear(), asOf.getUTCMonth(), 1));
  const to = new Date(Date.UTC(asOf.getUTCFullYear(), asOf.getUTCMonth() + 1, 1));
  return { from, to };
}

// ── Labelling ────────────────────────────────────────────────────────────────

export interface LabelStat { id: string; value: number; label: string }

export function labellingStats(l: InsightsFile['labelling'] | undefined): { stats: LabelStat[]; total: number } {
  if (!l) return { stats: [], total: 0 };
  const stats: LabelStat[] = [
    { id: 'titles', value: l.titles, label: 'distinct job titles' },
    { id: 'employers', value: l.employers, label: 'employer names' },
    { id: 'fields', value: l.fields, label: 'fields of study' },
    { id: 'places', value: l.places, label: 'locations' },
  ].filter((s) => Number.isFinite(s.value) && s.value > 0);
  return { stats, total: stats.reduce((a, s) => a + s.value, 0) };
}

/** "$65.33" */
export function fmtUsd(x: number): string {
  if (!Number.isFinite(x)) return '—';
  return `$${x.toFixed(2)}`;
}

/** Cost per thousand labelled strings, e.g. "$0.28"; "—" when there's nothing to divide by. */
export function costPerThousand(costUsd: number, strings: number): string {
  if (!Number.isFinite(costUsd) || !(strings > 0)) return '—';
  const per = (1000 * costUsd) / strings;
  return per >= 0.01 ? `$${per.toFixed(2)}` : '<$0.01';
}

// ── Privacy illustration ─────────────────────────────────────────────────────

export interface FoldedGroup { label: string; n: number; folded: boolean; parts?: number }

/**
 * The suppression rule as a function: groups under k are folded into one "Smaller groups" row,
 * which is itself shown only if it reaches k. Used for the illustration on this page; it mirrors
 * the rule the pipeline applies before it perturbs every published count.
 */
export function foldSmallGroups(groups: { label: string; n: number }[], k: number): FoldedGroup[] {
  const big = groups.filter((g) => g.n >= k).sort((a, b) => b.n - a.n).map((g) => ({ ...g, folded: false }));
  const small = groups.filter((g) => g.n > 0 && g.n < k);
  const total = small.reduce((a, g) => a + g.n, 0);
  return total >= k ? [...big, { label: 'Smaller groups', n: total, folded: true, parts: small.length }] : big;
}

/** 12345 -> "12,345" — re-exported so the view formats every count the same way. */
export const fmtCount = fmtInt;

// ── Privacy floors and sizes ─────────────────────────────────────────────────

/**
 * The two suppression floors from meta.k: counts by career field need `field` people, anything
 * naming an employer, job title or place needs `named`. Older files had one number; read it as
 * both floors. Anything else falls back to the pipeline's floors.
 */
export function floorsOf(k: Meta['k'] | number | null | undefined): Floors {
  if (typeof k === 'number' && Number.isFinite(k) && k > 0) return { field: k, named: k };
  if (k && typeof k === 'object' && Number.isFinite(k.field) && Number.isFinite(k.named)) return { field: k.field, named: k.named };
  return { field: 5, named: 10 };
}

/**
 * Minimum group sizes (pipeline settings, not privacy floors): they keep a chart meaningful.
 * River class: river.json meta.min_slice; Twin group: twin.json min_group; a year point:
 * min_year in both; Diaspora filter and leaderboard program: pipeline/08_export_site.py.
 */
export const MIN_SIZES = { riverClass: 30, twinGroup: 20, diasporaFilter: 50, yearPoint: 10, leaderboard: 100 } as const;

/** Twin keeps these years of the trajectory (types.ts YearPoint). */
export const TWIN_YEARS = [0, 1, 2, 3, 5, 7, 10, 15, 20] as const;

/** The cell-key noise: how often a published count moves by each amount (pipeline/sdc.py). */
export const NOISE_ODDS: { delta: number; pct: number }[] = [
  { delta: -2, pct: 10 }, { delta: -1, pct: 20 }, { delta: 0, pct: 40 }, { delta: 1, pct: 20 }, { delta: 2, pct: 10 },
];

// ── River columns by class ───────────────────────────────────────────────────

/** The River's columns and the year after graduating each one reads ('s0' and 'now' have none). */
export const RIVER_COLUMNS: { id: StageId; year: number | null; label: string }[] = [
  { id: 's0', year: null, label: 'First job' },
  { id: 'y3', year: 3, label: 'Year 3' },
  { id: 'y5', year: 5, label: 'Year 5' },
  { id: 'y10', year: 10, label: 'Year 10' },
  { id: 'y20', year: 20, label: 'Year 20' },
  { id: 'now', year: null, label: 'Today' },
];

/**
 * The River columns a class gets: first job and today always; year N only once the class's LAST
 * graduates have reached June of grad year + N by the snapshot ("2025-09"). Matches the pipeline:
 * 2015–2019 -> s0 y3 y5 now; 2020–2024 -> s0 now.
 */
export function riverColumns(lastClass: number, snapshot: string): StageId[] {
  const m = /^(\d{4})-(\d{2})$/.exec(snapshot ?? '');
  if (!m || !Number.isFinite(lastClass)) return ['s0', 'now'];
  const year = Number(m[1]);
  const month = Number(m[2]);
  const reached = (n: number) => lastClass + n < year || (lastClass + n === year && month >= 6);
  return RIVER_COLUMNS.filter((c) => c.year === null || reached(c.year)).map((c) => c.id);
}

export interface ClassReachRow { id: CohortId; label: string; columns: StageId[] }

/** One row per five-year class (oldest first), then all classes, with the columns each gets. */
export function classReach(cohorts: Meta['cohorts'] | undefined, snapshot: string): ClassReachRow[] {
  const list = cohorts ?? [];
  const bands = list.filter((c) => c.id !== 'all').sort((a, b) => a.from - b.from);
  const all = list.filter((c) => c.id === 'all');
  return [...bands, ...all].map((c) => ({
    id: c.id,
    label: c.id === 'all' ? `All, ${c.from}–${c.to}` : `${c.from}–${c.to}`,
    columns: riverColumns(c.to, snapshot),
  }));
}

/**
 * A margin note for the "Present" chart, only when one month holds a majority: "most say
 * september" (lowercase, as stickers are).
 */
export function presentSticker(rows: { month: string; pct: number }[] | undefined): string | null {
  const top = snapshotBars(rows).find((b) => b.top);
  if (!top || top.pct < 50) return null;
  const name = fmtMonth(top.month, true).split(' ')[0].toLowerCase();
  return `most say ${name}`;
}
