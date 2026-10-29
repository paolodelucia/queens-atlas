/**
 * Career Twin: pure logic. Everything here is a function of its inputs (no React, no DOM), so the
 * matching, the chart shapes and the copy can be tested exhaustively.
 *
 * Two modes share one URL (?mode=student|alum):
 *   - student (default): pick a program; see where its grads went first, who hired them, and
 *     where each first job led, year by year.
 *   - alum: four questions (degree, program, class, first job); see the most specific group of
 *     alumni who started the same way, widened honestly when the exact group is too small.
 *
 * Privacy contract (see data/types.ts): field counts under k.field (5) and named employers,
 * titles and places under k.named (10) are absent or null, and every count is lightly perturbed
 * (up to 2 either way), so parts need not add up to their totals. Nothing here derives a new
 * count by subtraction: shares are always "published count / published denominator", and
 * anything missing is described ("fewer than 5"), never computed.
 */
import { FAMILY, FAMILY_ORDER, LEVELS, SENIORITY, SENIORITY_ORDER, familyColor, yearLabel } from '../../data/taxonomy';
import type {
  CohortId, FamilyId, Floors, LevelId, Meta, NamedCount, ProgramInfo, SeniorityId, TwinFile, TwinGroup, YearPoint,
} from '../../data/types';
import { fmtInt } from '../../lib/format';

// ── Modes ────────────────────────────────────────────────────────────────────

export type Mode = 'student' | 'alum';

/**
 * ?mode=student|alum. Absent means student, except for links made before the student view
 * existed: those carry a first destination (?first=), so they still open the alumni results.
 */
export function parseMode(raw: string | null | undefined, hasFirst = false): Mode {
  const v = (raw ?? '').trim().toLowerCase();
  if (v === 'alum' || v === 'alumni' || v === 'graduated') return 'alum';
  if (v === 'student') return 'student';
  return hasFirst ? 'alum' : 'student';
}

// ── Answers ──────────────────────────────────────────────────────────────────

export type Level = Exclude<LevelId, 'all'>;
export type First = FamilyId | '*';
export type Band = Exclude<CohortId, 'all'>;

export const YEAR_MIN = 1995;
export const YEAR_MAX = 2024;
/** Smallest group the export publishes when twin.json doesn't say (it does: min_group). */
export const DEFAULT_MIN_GROUP = 20;
/** Below this many people a group gets the "shares can jump" note. */
export const SMALL_GROUP = 50;
/** Default floors when meta.k is missing (data/types.ts Floors). */
export const DEFAULT_K: Floors = { field: 5, named: 10 };
/** The cohort behind "recent classes only" in the student view. */
export const RECENT_BAND: Band = '2015-2019';

export const FORM_LEVELS = LEVELS.filter((l) => l.id !== 'all') as { id: Level; label: string; short: string }[];

export const BANDS: { id: Band; from: number; to: number }[] = [
  { id: '1995-1999', from: 1995, to: 1999 },
  { id: '2000-2004', from: 2000, to: 2004 },
  { id: '2005-2009', from: 2005, to: 2009 },
  { id: '2010-2014', from: 2010, to: 2014 },
  { id: '2015-2019', from: 2015, to: 2019 },
  { id: '2020-2024', from: 2020, to: 2024 },
];

/** Not jobs, and not a first job anyone would pick: never offered as a choice. */
const NOT_A_CHOICE = new Set<FamilyId>(['no_role_listed', 'smaller_groups']);

/** Options for "first job after Queen’s": every job field, then further study, then skip. */
export const FIRST_OPTIONS: { id: First; label: string }[] = [
  ...FAMILY_ORDER.filter((f) => FAMILY[f].isJob).map((f) => ({ id: f as First, label: FAMILY[f].label })),
  { id: 'further_study', label: FAMILY.further_study.label },
  { id: '*', label: 'Not sure / skip' },
];
const FIRST_IDS = new Set<string>(FIRST_OPTIONS.map((o) => o.id));

/** The value written to the URL for a "skip" answer ('*' looks odd in a shared link). */
export const SKIP_PARAM = 'any';

/** Field names in the student view: further study is "More school" there. */
export function fieldLabel(id: FamilyId, mode: Mode = 'alum'): string {
  if (id === 'further_study' && mode === 'student') return 'More school';
  if (id === 'smaller_groups') return 'Smaller fields combined';
  return FAMILY[id]?.label ?? id;
}

/** Strict year parse: four digits (surrounding spaces allowed), anything else is null. */
export function parseYear(raw: string | null | undefined): number | null {
  if (raw == null) return null;
  const m = /^\s*(\d{4})\s*$/.exec(raw);
  return m ? Number(m[1]) : null;
}

/** Graduation year -> five-year class band; null for years the data doesn't cover (or non-years). */
export function cohortForYear(year: number | null | undefined): Band | null {
  if (year == null || !Number.isInteger(year)) return null;
  return BANDS.find((c) => year >= c.from && year <= c.to)?.id ?? null;
}

export function cohortRange(id: CohortId | '*'): { from: number; to: number } | null {
  return BANDS.find((c) => c.id === id) ?? null;
}

export interface ProgramOption { program: string; n: number }

/**
 * Programs offered for a level, largest first. meta.programs is the primary list; programs that
 * have their own twin group but aren't in meta are appended (sized by that group), so a visitor
 * from a small program can still find it.
 */
export function programOptions(meta: Pick<Meta, 'programs'>, twin: Pick<TwinFile, 'groups'> | null, level: Level): ProgramOption[] {
  const out = new Map<string, number>();
  for (const p of meta.programs) if (p.level === level) out.set(p.program, p.n);
  if (twin) {
    for (const g of twin.groups) {
      if (g.level !== level || g.program === '*' || out.has(g.program)) continue;
      if (g.cohort === '*' && g.s0 === '*') out.set(g.program, g.n);
    }
  }
  return [...out].map(([program, n]) => ({ program, n }))
    .sort((a, b) => b.n - a.n || a.program.localeCompare(b.program));
}

/** Ready-made alumni answers for the empty state. */
export const EXAMPLES: { level: Level; program: string; year: number; first: First; label: string }[] = [
  { level: 'undergrad', program: 'Commerce', year: 2012, first: 'finance_accounting', label: 'Commerce · 2012 · Finance' },
  { level: 'undergrad', program: 'Mechanical Engineering', year: 2018, first: 'engineering', label: 'Mech Eng · 2018 · Engineering' },
  { level: 'law', program: 'Law', year: 2008, first: 'law', label: 'Law (JD) · 2008 · Law' },
  { level: 'undergrad', program: 'Psychology', year: 2021, first: '*', label: 'Psychology · 2021 · Not sure' },
  { level: 'undergrad', program: 'Life Sciences', year: 2016, first: 'further_study', label: 'Life Sci · 2016 · More school' },
];

/** Programs offered as one-click starts in the student view. */
export const STUDENT_EXAMPLES: { level: Level; program: string; label: string }[] = [
  { level: 'undergrad', program: 'Commerce', label: 'Commerce' },
  { level: 'undergrad', program: 'Computer Science', label: 'Computer Science' },
  { level: 'undergrad', program: 'Mechanical Engineering', label: 'Mech Eng' },
  { level: 'undergrad', program: 'Life Sciences', label: 'Life Sciences' },
  { level: 'undergrad', program: 'Psychology', label: 'Psychology' },
  { level: 'law', program: 'Law', label: 'Law (JD)' },
];

/** Raw query-string values ('' = absent). */
export interface RawAnswers { level: string; program: string; year: string; first: string }

export interface Answers {
  level: Level | null;
  program: string | null;
  /** Parsed year, even when outside the covered range. */
  year: number | null;
  /** null when the year is missing or outside 1995-2024. */
  cohort: Band | null;
  first: First | null;
}

export interface Validation {
  answers: Answers;
  /** Gentle notes about values that were ignored or couldn't be used. */
  notes: string[];
  /** Alumni: every question answered (a year outside the range still counts). Student: a program. */
  complete: boolean;
  /** How many of the four alumni questions have a usable answer. */
  answered: number;
  yearOutOfRange: boolean;
}

function clip(raw: string, max = 40): string {
  const s = raw.trim();
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

/**
 * Validate URL answers. Bad values are dropped with a note; nothing ever throws. In the student
 * view the year is informational only (no range note) and there is no first-job question.
 */
export function validateAnswers(raw: RawAnswers, programsFor: (level: Level) => ProgramOption[], mode: Mode = 'alum'): Validation {
  const notes: string[] = [];

  let level: Level | null = null;
  if (raw.level) {
    const hit = FORM_LEVELS.find((l) => l.id === raw.level.trim().toLowerCase());
    if (hit) level = hit.id;
    else notes.push(`“${clip(raw.level)}” isn’t a degree level here, so it’s been left out.`);
  }

  let program: string | null = null;
  const options = level ? programsFor(level) : [];
  if (raw.program) {
    if (!level) {
      if (!raw.level) notes.push(`Pick a degree first: the program “${clip(raw.program)}” is set aside until then.`);
    } else {
      const wanted = raw.program.trim().toLowerCase();
      const hit = options.find((o) => o.program.toLowerCase() === wanted);
      if (hit) program = hit.program;
      else notes.push(`“${clip(raw.program)}” isn’t one of the ${levelLabel(level)} programs here, so it’s been left out.`);
    }
  }
  // Levels with a single program (MBA, JD, MD) don't need the question.
  if (level && !program && options.length === 1) program = options[0].program;

  let year: number | null = null;
  let cohort: Answers['cohort'] = null;
  let yearOutOfRange = false;
  if (raw.year) {
    year = parseYear(raw.year);
    if (year == null) {
      notes.push(`“${clip(raw.year)}” doesn’t look like a graduation year, so it’s been left out.`);
    } else {
      cohort = cohortForYear(year);
      if (!cohort && mode === 'alum') {
        yearOutOfRange = true;
        notes.push(`The data covers the classes of ${YEAR_MIN} to ${YEAR_MAX}, so for ${year} every class counts.`);
      }
    }
  }

  let first: First | null = null;
  if (raw.first && mode === 'alum') {
    const v = raw.first.trim().toLowerCase();
    if (v === SKIP_PARAM || v === '*' || v === 'skip') first = '*';
    else if (FIRST_IDS.has(v)) first = v as First;
    else notes.push(`“${clip(raw.first)}” isn’t a first job on the list, so it’s been left out.`);
  }

  const answered = [level, program, year, first].filter((x) => x != null).length;
  const complete = mode === 'alum' ? answered === 4 : level != null && program != null;
  return { answers: { level, program, year, cohort, first }, notes, complete, answered, yearOutOfRange };
}

/** Student ?job=: a first-job field, or '*' (all of them) when absent or "any". null = unrecognised. */
export function parseJob(raw: string | null | undefined): First | null {
  const v = (raw ?? '').trim().toLowerCase();
  if (!v || v === SKIP_PARAM || v === '*') return '*';
  return FIRST_IDS.has(v) ? (v as First) : null;
}

function levelLabel(level: Level): string {
  return FORM_LEVELS.find((l) => l.id === level)?.label ?? level;
}

// ── Matching ─────────────────────────────────────────────────────────────────

export interface TwinQuery {
  level: Level | '*';
  program: string;            // or '*'
  cohort: CohortId | '*';
  s0: First;
}

export type TwinIndex = Map<string, TwinGroup>;

const keyOf = (level: string, program: string, cohort: string, s0: string) => `${level}\u0001${program}\u0001${cohort}\u0001${s0}`;

export function buildIndex(groups: TwinGroup[]): TwinIndex {
  const idx: TwinIndex = new Map();
  for (const g of groups) idx.set(keyOf(g.level, g.program, g.cohort, g.s0), g);
  return idx;
}

export function getGroup(index: TwinIndex, level: Level | '*', program: string, cohort: CohortId | '*', s0: First): TwinGroup | null {
  return index.get(keyOf(level, program, cohort, s0)) ?? null;
}

export function queryFromAnswers(a: Answers): TwinQuery {
  const level = a.level ?? '*';
  return {
    level,
    program: level === '*' ? '*' : a.program ?? '*',
    cohort: a.cohort ?? '*',
    s0: a.first ?? '*',
  };
}

/**
 * Candidate groups, most specific first. Keeping the first job outranks keeping the class, the
 * program and finally the degree level: where people started says more about where they went
 * than when they graduated. Duplicates (from '*' answers) are removed.
 */
export function lookupOrder(q: TwinQuery): TwinQuery[] {
  const { level: L, program: P, cohort: C, s0: S } = q;
  const raw: [TwinQuery['level'], string, TwinQuery['cohort'], First][] = [
    [L, P, C, S], [L, P, '*', S], [L, P, C, '*'], [L, P, '*', '*'],
    [L, '*', C, S], [L, '*', '*', S],
    ['*', '*', C, S], ['*', '*', '*', S], ['*', '*', '*', '*'],
  ];
  const seen = new Set<string>();
  const out: TwinQuery[] = [];
  for (const [level, program, cohort, s0] of raw) {
    const p = level === '*' ? '*' : program;
    const k = keyOf(level, p, cohort, s0);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push({ level, program: p, cohort, s0 });
  }
  return out;
}

export type Dimension = 'level' | 'program' | 'cohort' | 'first';

export interface TwinMatch {
  group: TwinGroup;
  /** Position in lookupOrder (0 = most specific). */
  step: number;
  /** Answers the visitor gave that this group doesn't filter on. */
  widened: Dimension[];
}

export function findTwins(index: TwinIndex, q: TwinQuery): TwinMatch | null {
  const order = lookupOrder(q);
  for (let step = 0; step < order.length; step++) {
    const c = order[step];
    const group = index.get(keyOf(c.level, c.program, c.cohort, c.s0));
    if (group) return { group, step, widened: widenedDims(q, group) };
  }
  return null;
}

export function widenedDims(q: TwinQuery, g: Pick<TwinGroup, 'level' | 'program' | 'cohort' | 's0'>): Dimension[] {
  const out: Dimension[] = [];
  if (q.level !== '*' && g.level === '*') out.push('level');
  if (q.program !== '*' && g.program === '*') out.push('program');
  if (q.cohort !== '*' && g.cohort === '*') out.push('cohort');
  if (q.s0 !== '*' && g.s0 === '*') out.push('first');
  return out;
}

// ── Copy ─────────────────────────────────────────────────────────────────────

export const LEVEL_PEOPLE: Record<Level, string> = {
  undergrad: 'undergrads',
  graduate: 'master’s & PhD grads',
  mba: 'MBA grads',
  law: 'Law (JD) grads',
  medicine: 'Medicine (MD) grads',
};

/** "Commerce grads", "master’s & PhD grads in Economics", "MBA grads", "Queen’s alumni". */
export function whoPhrase(level: Level | '*' | LevelId, program: string): string {
  if (level === '*' || level === 'all') return 'Queen’s alumni';
  if (program === '*' || level === 'mba' || level === 'law' || level === 'medicine') return LEVEL_PEOPLE[level];
  if (level === 'graduate') return `master’s & PhD grads in ${program}`;
  return `${program} grads`;
}

/** "whose first job was in finance & accounting" etc. Empty for '*'. */
export function firstPhrase(s0: First): string {
  switch (s0) {
    case '*': return '';
    case 'further_study': return 'who went straight on to more school';
    case 'no_role_listed': return 'with no role listed after graduating';
    case 'founder': return 'who started out founding their own venture';
    case 'other': return 'whose first job was outside the main fields';
    case 'smaller_groups': return '';
    default: return `whose first job was in ${FAMILY[s0]?.label.toLowerCase() ?? s0}`;
  }
}

/** "started in tech", "went straight on to more school": completes "N Commerce grads …". */
export function startPhrase(s0: FamilyId): string {
  switch (s0) {
    case 'further_study': return 'went straight on to more school';
    case 'founder': return 'started out founding their own venture';
    case 'other': return 'started outside the main fields';
    case 'no_role_listed': return 'had no role listed after graduating';
    default: return `started in ${FAMILY[s0]?.label.toLowerCase() ?? s0}`;
  }
}

/** Plain-English description of a group, without the count. */
export function describeGroup(g: Pick<TwinGroup, 'level' | 'program' | 'cohort' | 's0'>): string {
  const parts = [whoPhrase(g.level, g.program)];
  const range = cohortRange(g.cohort);
  if (range) parts.push(`from the classes of ${range.from}–${range.to}`);
  const first = firstPhrase(g.s0);
  if (first) parts.push(first);
  return parts.join(' ');
}

const DIM_WORDS: Record<Dimension, string> = {
  level: 'degree level',
  program: 'program',
  cohort: 'class',
  first: 'first job',
};

/** "class", "class and first job", "a, b and c". */
export function listWords(words: string[]): string {
  if (words.length <= 1) return words.join('');
  return `${words.slice(0, -1).join(', ')} and ${words[words.length - 1]}`;
}

/** Widened dimensions in a fixed order. A widened level always widens the program too: say it once. */
function widenedInOrder(widened: Dimension[]): Dimension[] {
  return (['level', 'program', 'cohort', 'first'] as Dimension[])
    .filter((d) => widened.includes(d))
    .filter((d) => !(d === 'program' && widened.includes('level')));
}

const BADGE_WORDS: Record<Dimension, string> = {
  level: 'all degrees',
  program: 'all programs',
  cohort: 'all classes',
  first: 'any first job',
};

/** "Widened: all classes", "Widened: all classes, any first job", …; null for an exact match. */
export function widenedBadge(widened: Dimension[]): string | null {
  const dims = widenedInOrder(widened);
  return dims.length ? `Widened: ${dims.map((d) => BADGE_WORDS[d]).join(', ')}` : null;
}

export interface MatchCopy {
  /** One sentence the results lead with (also announced to screen readers). */
  sentence: string;
  widened: boolean;
  /** Results heading as plain text: "Your 410 career twins", or "55 alumni close to your start" once widened. */
  heading: string;
  /** Specific badge for a widened match ("Widened: all classes"); null when exact. */
  badge: string | null;
}

export function matchCopy(m: TwinMatch, minGroup = DEFAULT_MIN_GROUP): MatchCopy {
  const n = fmtInt(m.group.n);
  const desc = describeGroup(m.group);
  if (!m.widened.length) {
    return { sentence: `These are the ${n} ${desc}.`, widened: false, heading: `Your ${n} career twins`, badge: null };
  }
  const dims = widenedInOrder(m.widened)
    .map((d) => (d === 'level' && m.widened.includes('program') ? 'degree and program' : DIM_WORDS[d]));
  return {
    sentence: `Fewer than ${minGroup} alumni matched every answer, so this widens to all ${n} ${desc}, from any ${listWords(dims)}.`,
    widened: true,
    heading: `${n} alumni close to your start`,
    badge: widenedBadge(m.widened),
  };
}

/** What to call the people in a group: "twins" only for an exact alumni match. */
export type Noun = 'twins' | 'alumni' | 'grads' | 'people';

export function nounFor(m: Pick<TwinMatch, 'widened'>): Noun {
  return m.widened.length ? 'alumni' : 'twins';
}

/** "410 twins", "1 twin", "55 alumni", "3,525 grads". */
export function people(n: number, noun: Noun = 'twins'): string {
  if (noun === 'alumni') return `${fmtInt(n)} alumni`;
  const one = noun === 'twins' ? 'twin' : noun === 'grads' ? 'grad' : 'person';
  const many = noun === 'people' ? 'people' : noun;
  return `${fmtInt(n)} ${n === 1 ? one : many}`;
}

export function isSmall(n: number): boolean {
  return n < SMALL_GROUP;
}
export const SMALL_NOTE = 'Small group: shares can jump a few points.';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** meta.snapshot ("2025-09") -> "Sep 2025". Anything unexpected is shown as given. */
export function snapshotLabel(snapshot: string | null | undefined): string {
  const m = /^(\d{4})-(\d{1,2})(?!\d)/.exec(snapshot ?? '');
  const month = m ? Number(m[2]) : 0;
  return m && month >= 1 && month <= 12 ? `${MONTHS[month - 1]} ${m[1]}` : snapshot ?? '';
}

/** One line on what is hidden, from the published floors. */
export function hiddenLine(k: Floors = DEFAULT_K): string {
  return `Fields with fewer than ${k.field} people, and employers, titles and places with fewer than ${k.named}, aren’t shown.`;
}

// ── Numbers → words ──────────────────────────────────────────────────────────

/** Share 0..1, or null when it can't be computed. */
export function share(part: number | null | undefined, whole: number | null | undefined): number | null {
  if (part == null || whole == null || !Number.isFinite(part) || !Number.isFinite(whole) || whole <= 0 || part < 0) return null;
  return part / whole;
}

/** Whole-number percentage: "55%", "<1%" for tiny non-zero shares, ">99%" just short of all, "—" when unknown. */
export function percent(part: number | null | undefined, whole: number | null | undefined): string {
  const s = share(part, whole);
  if (s == null) return '—';
  const p = 100 * s;
  if (p > 0 && p < 0.5) return '<1%';
  if (p < 100 && p >= 99.5) return '>99%';
  return `${Math.round(Math.min(p, 100))}%`;
}

/**
 * "1 in 6" when that reads true: the share is at most a half, N is 2..50, and 1/N is within 10%
 * (relative) of the real share. Otherwise null (callers fall back to a percentage).
 */
export function oneInN(part: number | null | undefined, whole: number | null | undefined): string | null {
  const s = share(part, whole);
  if (s == null || s <= 0 || s > 0.5) return null;
  const n = Math.round(1 / s);
  if (n < 2 || n > 50) return null;
  if (Math.abs(1 / n - s) / s > 0.1) return null;
  return `1 in ${n}`;
}

const FRACTIONS: [number, string][] = [
  [1 / 2, 'Half'], [1 / 3, 'A third'], [2 / 3, 'Two thirds'], [1 / 4, 'A quarter'], [3 / 4, 'Three quarters'],
];

/** "Half" / "A third" when the share is within one percentage point of it; else a percentage. */
export function fractionOrPercent(part: number | null | undefined, whole: number | null | undefined): string {
  const s = share(part, whole);
  if (s == null) return '—';
  const hit = FRACTIONS.find(([f]) => Math.abs(s - f) < 0.01);
  return hit ? hit[1] : percent(part, whole);
}

// ── Year points ──────────────────────────────────────────────────────────────

/** The years a Twin group can have (YearPoint.year), in order; 'now' comes after. */
export const TWIN_YEARS = [0, 1, 2, 3, 5, 7, 10, 15, 20];

export function yearPoint(g: Pick<TwinGroup, 'years'>, year: number | 'now'): YearPoint | null {
  return g.years.find((p) => p.year === year) ?? null;
}

/** Year `want` if the group has it, else the latest numeric year before it, else the latest after it. */
export function pickYear(g: Pick<TwinGroup, 'years'>, want = 10): YearPoint | null {
  const numeric = g.years.filter((p): p is YearPoint & { year: number } => typeof p.year === 'number' && p.year > 0 && p.n > 0);
  if (!numeric.length) return null;
  const exact = numeric.find((p) => p.year === want);
  if (exact) return exact;
  const before = numeric.filter((p) => p.year < want);
  return before.length ? before[before.length - 1] : numeric[0];
}

const countIn = (p: YearPoint | null, f: FamilyId): number | null => p?.fields.find(([id]) => id === f)?.[1] ?? null;

// ── First stop (student view) ────────────────────────────────────────────────

export interface FirstStopRow {
  id: FamilyId;
  label: string;
  n: number;
  /** count / year-0 n. */
  share: number;
  pct: string;
  /** Not a destination (no role listed, smaller fields combined): listed last, in grey. */
  muted: boolean;
}

export interface FirstStop { n: number; rows: FirstStopRow[] }

/**
 * The first-destination mix (year 0) as ranked rows: job fields and more school, largest first,
 * then "Smaller fields combined" and "No role listed", which aren't destinations, at the end.
 */
export function firstStop(g: Pick<TwinGroup, 'years'>, mode: Mode = 'student'): FirstStop | null {
  const p0 = yearPoint(g, 0);
  if (!p0 || p0.n <= 0 || !p0.fields.length) return null;
  const rows = p0.fields.filter(([, n]) => n > 0).map(([id, n]) => ({
    id, label: fieldLabel(id, mode), n, share: n / p0.n, pct: percent(n, p0.n), muted: NOT_A_CHOICE.has(id),
  }));
  const rank = (r: FirstStopRow) => (r.id === 'smaller_groups' ? 1 : r.id === 'no_role_listed' ? 2 : 0);
  rows.sort((a, b) => rank(a) - rank(b) || b.n - a.n || FAMILY_ORDER.indexOf(a.id) - FAMILY_ORDER.indexOf(b.id));
  return { n: p0.n, rows };
}

export interface JobChip {
  id: FamilyId;
  label: string;
  /** (level, program, '*', id), or the level-wide (level, '*', '*', id) group when the program's is too small. */
  group: TwinGroup;
  /** The group is level-wide, not the program's own. */
  widened: boolean;
}

/**
 * "Pick a first job" chips: every real first stop of the program (job fields and more school, in
 * first-stop order) that has a group to follow, the program's own or, failing that, the level's.
 */
export function jobChips(index: TwinIndex, level: Level, program: string, stop: FirstStop | null): JobChip[] {
  if (!stop) return [];
  const out: JobChip[] = [];
  for (const r of stop.rows) {
    if (r.muted) continue;
    const own = getGroup(index, level, program, '*', r.id);
    const wide = own ? null : getGroup(index, level, '*', '*', r.id);
    const group = own ?? wide;
    if (group) out.push({ id: r.id, label: fieldLabel(r.id, 'student'), group, widened: !own });
  }
  return out;
}

// ── Stats ────────────────────────────────────────────────────────────────────

export interface Stat {
  id: string;
  /** The big number ("55%", "1 in 6", "Half"). */
  value: string;
  /** Rest of the sentence, read after the value. */
  text: string;
  /** Where the number comes from (numerator of denominator). */
  detail: string;
}

/** Manager milestone to headline: year 10 for students, year 5 for alumni, else the nearest. */
const MANAGER_PREFERENCE = [5, 3, 7, 10, 1, 15];
const MANAGER_PREFERENCE_LONG = [10, 7, 15, 5, 3, 1];

function managerStat(g: TwinGroup, noun: Noun, order = MANAGER_PREFERENCE): Stat | null {
  const mgr = order.map((y) => g.managerBy.find((m) => m.years === y)).find((m) => m && m.n != null && m.of > 0);
  if (!mgr || mgr.n == null) return null;
  return {
    id: 'manager', value: fractionOrPercent(mgr.n, mgr.of),
    text: `had a manager title or above within ${mgr.years === 1 ? 'a year' : `${mgr.years} years`}`,
    detail: `${fmtInt(mgr.n)} of the ${people(mgr.of, noun)} who are ${mgr.years}+ years out`,
  };
}

function pivotStat(g: TwinGroup, noun: Noun): Stat | null {
  if (!g.pivoted || g.pivoted.n == null || g.pivoted.of <= 0) return null;
  return {
    id: 'pivoted', value: fractionOrPercent(g.pivoted.n, g.pivoted.of),
    text: 'work in a different field today than their first job',
    detail: `${fmtInt(g.pivoted.n)} of ${people(g.pivoted.of, noun)} with a job at both points`,
  };
}

function abroadStat(g: TwinGroup, noun: Noun): Stat | null {
  if (g.abroad == null || g.located == null || g.located <= 0) return null;
  const us = g.us != null ? `, ${fmtInt(g.us)} in the US` : '';
  return {
    id: 'abroad', value: oneInN(g.abroad, g.located) ?? percent(g.abroad, g.located),
    text: 'live outside Canada today',
    detail: `${fmtInt(g.abroad)} of ${people(g.located, noun)} with a known location${us}`,
  };
}

/**
 * Student hero (and the program's share card): the top first stop, how many work in a different
 * field today, how many live abroad. A number that isn't published is left out, not replaced.
 */
export function programStats(g: TwinGroup, stop: FirstStop | null): Stat[] {
  const out: Stat[] = [];
  const top = stop?.rows.find((r) => !r.muted);
  if (stop && top) {
    out.push({
      id: 'first', value: top.pct,
      text: top.id === 'further_study' ? 'went straight on to more school' : `started in ${top.label.toLowerCase()}`,
      detail: `${fmtInt(top.n)} of ${people(stop.n, 'grads')}, first job after graduating`,
    });
  }
  const pivot = pivotStat(g, 'grads');
  if (pivot) out.push(pivot);
  const abroad = abroadStat(g, 'grads');
  if (abroad) out.push(abroad);
  return out;
}

export interface ProgramHero {
  /** (level, program, all classes, any first job). */
  group: TwinGroup;
  /** Its first-destination mix. */
  stop: FirstStop | null;
  /** The headline numbers, each with its denominator. */
  stats: Stat[];
}

/**
 * Everything the student hero shows for a program, from its all-classes group. The Twin view and
 * the share cards (scripts/cards.mjs) both call this, so a card can never disagree with the page.
 */
export function programHero(index: TwinIndex, level: Level, program: string): ProgramHero | null {
  const group = getGroup(index, level, program, '*', '*');
  if (!group) return null;
  const stop = firstStop(group);
  return { group, stop, stats: programStats(group, stop) };
}

/**
 * Two plain numbers under a first job's trajectory: how many are still in that field around year
 * 10 (for more school or "all of them": the most common field then), and how many work in a
 * different field today (else time to manager).
 */
export function pathStats(g: TwinGroup, s0: First, noun: Noun = 'people', k: Floors = DEFAULT_K): Stat[] {
  const out: Stat[] = [];
  const at = pickYear(g, 10);
  if (at) {
    const yearWords = `at year ${at.year}`;
    const outOf = at.n < g.n ? `the ${people(at.n, noun)} who are ${at.year}+ years out` : people(at.n, noun);
    if (s0 !== '*' && FAMILY[s0]?.isJob) {
      const n = countIn(at, s0);
      out.push(n != null
        ? { id: 'stayed', value: percent(n, at.n), text: `still in ${FAMILY[s0].label.toLowerCase()} ${yearWords}`, detail: `${fmtInt(n)} of ${outOf}` }
        : { id: 'stayed', value: `Under ${k.field}`, text: `still in ${FAMILY[s0].label.toLowerCase()} ${yearWords}`, detail: `of ${outOf}` });
    } else {
      const top = at.fields.find(([f]) => FAMILY[f]?.isJob);
      if (top) {
        out.push({
          id: 'top', value: percent(top[1], at.n),
          text: `in ${FAMILY[top[0]].label.toLowerCase()} ${yearWords}, the most common field`,
          detail: `${fmtInt(top[1])} of ${outOf}`,
        });
      }
    }
  }
  const second = s0 === '*' ? managerStat(g, noun, MANAGER_PREFERENCE_LONG) : pivotStat(g, noun) ?? managerStat(g, noun, MANAGER_PREFERENCE_LONG);
  if (second) out.push(second);
  return out;
}

/** Alumni hero: up to four numbers, each with its denominator. */
export function headlineStats(g: TwinGroup, noun: Noun = 'twins'): Stat[] {
  const out: Stat[] = [];
  const now = yearPoint(g, 'now');
  const nowN = now?.n ?? 0;

  // 1. Still in the field they started in, else the most common field today.
  const startFam = g.s0 !== '*' && FAMILY[g.s0]?.isJob ? g.s0 : null;
  const stayed = startFam ? countIn(now, startFam) : null;
  if (startFam && stayed != null && nowN > 0) {
    out.push({
      id: 'stayed', value: percent(stayed, nowN),
      text: `still work in ${FAMILY[startFam].label.toLowerCase()} today`,
      detail: `${fmtInt(stayed)} of ${people(nowN, noun)}`,
    });
  } else {
    const top = now?.fields.find(([f]) => FAMILY[f]?.isJob);
    if (top && nowN > 0) {
      out.push({
        id: 'topField', value: percent(top[1], nowN),
        text: `work in ${FAMILY[top[0]].label.toLowerCase()} today, the most common field`,
        detail: `${fmtInt(top[1])} of ${people(nowN, noun)}`,
      });
    }
  }
  for (const s of [pivotStat(g, noun), managerStat(g, noun), abroadStat(g, noun)]) if (s) out.push(s);
  return out.slice(0, 4);
}

// ── Trajectory (stacked shares, year by year) ───────────────────────────────

export type SeriesId = FamilyId | 'other';

export interface TrajSeries {
  id: SeriesId;
  label: string;
  /** CSS colour (a sector or neutral token). */
  color: string;
  /** Drawn striped: its sector colour is already taken in this chart, or it is "no role listed". */
  striped: boolean;
  /** The field the group started in (fixed s0). */
  isStart: boolean;
}

export interface TrajCell {
  /** Published count, or null when under the floor (or nothing to fold into "other"). */
  n: number | null;
  /** n / the point's n. */
  share: number | null;
  /** Band height as a fraction of the column (never overflows, see `trajectory`). */
  h: number;
}

export interface TrajPoint {
  year: number | 'now';
  label: string;
  short: string;
  /** Denominator: members who had reached this point. */
  n: number;
  /** Fewer people than the whole group (later classes haven't reached it yet). */
  partial: boolean;
  cells: Partial<Record<SeriesId, TrajCell>>;
  /** Room left at the top of the column: people in fields under the floor (never given a number). */
  rest: number;
}

export interface Trajectory {
  series: TrajSeries[];
  /** Numeric years, in order. */
  points: TrajPoint[];
  /** The snapshot ("Today"), drawn apart from the years. */
  now: TrajPoint | null;
  groupN: number;
  start: FamilyId | null;
  /** Twin years the group hasn't reached (fewer than min_year members there). */
  missing: number[];
  /** Some column's published parts don't add up to its n. */
  uneven: boolean;
  /** Some column leaves visible room for fields under the floor. */
  hasRest: boolean;
}

/**
 * Shape a group's `years` for the stacked chart: the largest `maxFields` fields (the starting
 * field always included, at the bottom), "Other fields" (a sum of published counts only), and "No
 * role listed". Each column's bands are sized against the larger of its n and its published sum,
 * so perturbed parts can never overflow; shares are always count / that point's n.
 */
export function trajectory(g: TwinGroup, opts: { maxFields?: number; mode?: Mode; snapshot?: string } = {}): Trajectory | null {
  const maxFields = opts.maxFields ?? 5;
  const mode = opts.mode ?? 'alum';
  const pts = g.years.filter((p) => p.n > 0);
  if (!pts.length) return null;
  const start = g.s0 !== '*' && !NOT_A_CHOICE.has(g.s0) ? g.s0 : null;

  // Candidates ranked by their largest share at any point reached by enough people (a year that
  // only a handful have reached shouldn't pick the chart's fields).
  const solid = pts.filter((p) => p.n >= SMALL_GROUP);
  const best = new Map<FamilyId, number>();
  for (const p of solid.length ? solid : pts) {
    for (const [f, n] of p.fields) {
      if (NOT_A_CHOICE.has(f)) continue;
      best.set(f, Math.max(best.get(f) ?? 0, n / p.n));
    }
  }
  const ranked = [...best].sort((a, b) => b[1] - a[1] || FAMILY_ORDER.indexOf(a[0]) - FAMILY_ORDER.indexOf(b[0])).map(([f]) => f);
  const chosen = (start && best.has(start) ? [start, ...ranked.filter((f) => f !== start)] : ranked).slice(0, maxFields);
  const chosenSet = new Set(chosen);
  const hasOther = pts.some((p) => p.fields.some(([f]) => !chosenSet.has(f) && f !== 'no_role_listed'));
  const hasNone = pts.some((p) => p.fields.some(([f]) => f === 'no_role_listed'));

  const usedSectors = new Set<string>();
  const series: TrajSeries[] = chosen.map((f) => {
    const sector = FAMILY[f]?.sector ?? 'neutral';
    const striped = usedSectors.has(sector);
    usedSectors.add(sector);
    return { id: f, label: fieldLabel(f, mode), color: familyColor(f), striped, isStart: f === start };
  });
  if (hasOther) series.push({ id: 'other', label: 'Other fields', color: 'var(--sector-neutral)', striped: false, isStart: false });
  if (hasNone) series.push({ id: 'no_role_listed', label: FAMILY.no_role_listed.label, color: 'var(--sector-neutral)', striped: true, isStart: false });

  let uneven = false;
  let hasRest = false;
  const shape = (p: YearPoint): TrajPoint => {
    const counts = new Map(p.fields);
    const sum = p.fields.reduce((a, [, n]) => a + n, 0);
    const scale = Math.max(p.n, sum);
    const cells: TrajPoint['cells'] = {};
    for (const s of series) {
      let n: number | null;
      if (s.id === 'other') {
        const parts = p.fields.filter(([f]) => !chosenSet.has(f) && f !== 'no_role_listed');
        n = parts.length ? parts.reduce((a, [, v]) => a + v, 0) : null;
      } else {
        n = counts.get(s.id) ?? null;
      }
      // A group defined by its first job has no one anywhere else at year 0: that's a true zero, not a suppressed count.
      if (n == null && start && p.year === 0) n = 0;
      cells[s.id] = { n, share: n == null ? null : n / p.n, h: n == null ? 0 : n / scale };
    }
    const rest = Math.max(0, 1 - sum / scale);
    if (sum !== p.n) uneven = true;
    if (rest >= 0.02) hasRest = true;
    const year = p.year;
    const label = year === 'now' ? `Today${opts.snapshot ? ` (${opts.snapshot})` : ''}` : yearLabel(year);
    return { year, label, short: yearLabel(year, true), n: p.n, partial: p.n < g.n, cells, rest };
  };

  const points = pts.filter((p) => typeof p.year === 'number').map(shape);
  const nowP = pts.find((p) => p.year === 'now');
  const have = new Set(points.map((p) => p.year));
  return {
    series, points, now: nowP ? shape(nowP) : null, groupN: g.n, start,
    missing: TWIN_YEARS.filter((y) => !have.has(y)), uneven, hasRest,
  };
}

/** Plain-language notes under a trajectory chart. */
export function trajectoryNotes(t: Trajectory, k: Floors = DEFAULT_K, minYear = 10): string[] {
  const notes: string[] = [];
  const partial = t.points.filter((p) => p.partial);
  if (partial.length) {
    const p = partial.find((x) => x.year === 10) ?? partial[partial.length - 1];
    notes.push(`Each year counts only the people who had reached it: year ${p.year} is the ${fmtInt(p.n)} who graduated at least ${p.year} years before the snapshot.`);
  }
  const lateMissing = t.missing.filter((y) => y > 0);
  if (lateMissing.length) {
    const words = listWords(lateMissing.map(String));
    notes.push(`${lateMissing.length > 1 ? 'Years' : 'Year'} ${words} ${lateMissing.length > 1 ? 'aren’t' : 'isn’t'} shown: fewer than ${minYear} of them have been out that long.`);
  }
  if (t.uneven || t.hasRest) {
    notes.push(`Columns don’t add up to exactly 100%: fields with fewer than ${k.field} people are left out and every count is nudged slightly.`);
  }
  return notes;
}

// ── Stickers (margin notes, only when the data says so) ─────────────────────

const BIG_FOUR = new Set(['ey', 'deloitte', 'kpmg', 'pwc', 'ernst & young', 'pricewaterhousecoopers']);
const BANKS = new Set(['rbc', 'td', 'bmo', 'scotiabank', 'cibc', 'national bank', 'royal bank of canada', 'td bank', 'bank of montreal']);

/** "the Big Four top the list" when the top employer and at least three of the top four are Big Four firms (likewise the banks). */
export function employerSticker(list: NamedCount[]): string | null {
  const top = list.slice(0, 4).map((e) => e.name.trim().toLowerCase());
  if (top.length < 3) return null;
  const rule = (set: Set<string>) => set.has(top[0]) && top.filter((n) => set.has(n)).length >= 3;
  if (rule(BIG_FOUR)) return 'the Big Four top the list';
  if (rule(BANKS)) return 'the big banks top the list';
  return null;
}

/** Lowercase field nouns for margin notes. */
const NOTE_NOUN: Partial<Record<FamilyId, string>> = {
  finance_accounting: 'finance', research_academia: 'research', government_policy: 'government',
  operations_management: 'operations', sales_marketing: 'sales & marketing', nonprofit_community: 'nonprofit work',
  arts_media: 'arts & media', service_trades: 'service & trades',
};
const noteNoun = (f: FamilyId) => NOTE_NOUN[f] ?? FAMILY[f]?.label.toLowerCase() ?? f;

/** "most start in teaching" when one field holds a majority; "more school tops the list" when it leads. */
export function firstStopSticker(stop: FirstStop | null): string | null {
  const top = stop?.rows.find((r) => !r.muted);
  if (!stop || !top) return null;
  if (top.share > 0.5) return top.id === 'further_study' ? 'most go straight to more school' : `most start in ${noteNoun(top.id)}`;
  if (top.id === 'further_study') return 'more school tops the list';
  return null;
}

/** "most of finance stays put" when a majority are still in their first field around year 10. */
export function staySticker(g: TwinGroup): string | null {
  if (g.s0 === '*' || !FAMILY[g.s0]?.isJob) return null;
  const at = pickYear(g, 10);
  if (!at || typeof at.year !== 'number' || at.year < 5) return null;
  const n = countIn(at, g.s0);
  return n != null && n / at.n > 0.5 ? `most of ${noteNoun(g.s0)} stays put` : null;
}

// ── Seniority & managers ─────────────────────────────────────────────────────

export interface SeniorityRow { id: SeniorityId; label: string; n: number; share: number; managerPlus: boolean }

const MANAGER_PLUS = new Set<SeniorityId>(['manager', 'director', 'vp', 'executive']);

/** Seniority today in ladder order; shares of the whole group (people with no classifiable title aren't listed). */
export function seniorityRows(g: TwinGroup): SeniorityRow[] {
  if (g.n <= 0) return [];
  const m = new Map(g.seniorityNow);
  return SENIORITY_ORDER.filter((s) => s !== 'unknown' && m.has(s)).map((s) => ({
    id: s, label: SENIORITY[s], n: m.get(s)!, share: m.get(s)! / g.n, managerPlus: MANAGER_PLUS.has(s),
  }));
}

export interface ManagerPoint { years: number; of: number; n: number | null; share: number | null }

export function managerPoints(g: TwinGroup): ManagerPoint[] {
  return [...g.managerBy]
    .filter((m) => m.of > 0)
    .sort((a, b) => a.years - b.years)
    .map((m) => ({ years: m.years, of: m.of, n: m.n, share: m.n == null ? null : m.n / m.of }));
}

// ── Links ────────────────────────────────────────────────────────────────────

export interface RiverLink {
  href: string;
  label: string;
  /** The link goes to the visitor's own program (false: the level-wide River). */
  own: boolean;
}

/**
 * Where "follow them in the River" goes. The River only has programs with 50+ people
 * (`meta.programs[].river`; absent means true), so a smaller program links to its whole level and
 * says so. A program missing from meta.programs has no River either.
 */
export function riverLink(
  programs: readonly Pick<ProgramInfo, 'level' | 'program' | 'river'>[],
  a: Pick<Answers, 'level' | 'program'>,
): RiverLink {
  if (!a.level) return { href: '/river', label: 'Open the River', own: false };
  const info = a.program ? programs.find((p) => p.level === a.level && p.program === a.program) : undefined;
  if (a.program && info && info.river !== false) {
    return { href: riverHref(a), label: `Follow ${a.program} in the River`, own: true };
  }
  return { href: riverHref({ level: a.level, program: null }), label: `See all ${LEVEL_PEOPLE[a.level]} in the River`, own: false };
}

/** Does the River have this program? */
export function hasRiver(programs: readonly Pick<ProgramInfo, 'level' | 'program' | 'river'>[], level: Level | null, program: string | null): boolean {
  if (!level || !program) return false;
  const info = programs.find((p) => p.level === level && p.program === program);
  return !!info && info.river !== false;
}

// ── URL helpers ──────────────────────────────────────────────────────────────

export interface UrlState {
  mode: Mode;
  level?: Level | null;
  program?: string | null;
  year?: number | null;
  /** Alumni: the first destination. */
  first?: First | null;
  /** Student: the first job being followed ('*' = all of them, not written). */
  job?: First | null;
  /** Student: classes of 2015-2019 only. */
  recent?: boolean;
}

/**
 * Query string for a view (stable key order). Student is the default mode and isn't written;
 * each mode writes only its own parameters, so a shared link never carries the other's leftovers.
 */
export function twinQuery(s: UrlState): string {
  const p = new URLSearchParams();
  if (s.mode === 'alum') p.set('mode', 'alum');
  if (s.level) p.set('level', s.level);
  if (s.program && s.level) p.set('program', s.program);
  if (s.year != null) p.set('year', String(s.year));
  if (s.mode === 'alum' && s.first) p.set('first', s.first === '*' ? SKIP_PARAM : s.first);
  if (s.mode === 'student' && s.job && s.job !== '*') p.set('job', s.job);
  if (s.mode === 'student' && s.recent) p.set('recent', '1');
  const qs = p.toString();
  return qs ? `?${qs}` : '';
}

/** Absolute, shareable URL. `base` is the app's base path ("/" or "/atlas/"). */
export function shareUrl(origin: string, base: string, s: UrlState): string {
  const b = base.endsWith('/') ? base : `${base}/`;
  return `${origin}${b}twin${twinQuery(s)}`;
}

/** In-app link to the River, scoped to the visitor's level and program when known. */
export function riverHref(a: Pick<Answers, 'level' | 'program'>): string {
  const p = new URLSearchParams();
  if (a.level) p.set('level', a.level);
  if (a.level && a.program) p.set('program', a.program);
  const qs = p.toString();
  return `/river${qs ? `?${qs}` : ''}`;
}

/**
 * Two-column section layout: wide sections take a full row, half sections pair up in order. A half
 * section left without a partner (an odd run between wide ones) is widened so the grid has no hole.
 */
export function pairSections(wide: boolean[]): boolean[] {
  const out = [...wide];
  let run: number[] = [];
  const flush = () => { if (run.length % 2 === 1) out[run[run.length - 1]] = true; run = []; };
  wide.forEach((w, i) => { if (w) flush(); else run.push(i); });
  flush();
  return out;
}
