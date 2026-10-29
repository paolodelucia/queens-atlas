/**
 * The River: pure logic. Everything here is a function of river.json plus the URL filters,
 * so it is unit-tested without a DOM (model.test.ts).
 *
 * Privacy rule that shapes this file: every number we show is a number the export published
 * (each >= k.field), or a sum of published numbers (fields rolled up into sectors), or a share
 * of one. We never subtract two published numbers to show a third, never fill gaps with zeros,
 * never chain flows across stages, and treat an absent field as "under k.field people", not 0.
 * The one place a remainder appears (the year-by-year chart's "not shown" band) it is drawn,
 * never printed.
 */
import { COHORTS, FAMILIES, FAMILY, FAMILY_ORDER, LEVELS, SECTOR, familyColor } from '../../data/taxonomy';
import type { SectorId } from '../../data/taxonomy';
import type { CohortId, FamilyId, LevelId, NamedCount, RiverFile, RiverSlice, StageId, YearPoint } from '../../data/types';
import { fmtInt, fmtPct } from '../../lib/format';

// ── Filters ─────────────────────────────────────────────────────────────────

export interface Filters { level: LevelId; program: string; cohort: CohortId }

export interface ResolvedFilters extends Filters {
  /**
   * A program the URL named that has no River at this level (canonical spelling when River knows
   * the program at another level, else as typed). The view says so instead of silently showing
   * the whole level.
   */
  dropped: string | null;
}

export const DEFAULT_FILTERS: Filters = { level: 'all', program: 'all', cohort: '2010-2014' };

/** The two tabs: the Sankey ("Flow") and the stacked field mix per year ("Year by year"). */
export type RiverTab = 'flow' | 'years';
export const DEFAULT_TAB: RiverTab = 'flow';

/** Fewer people than this in a slice (or at a year) and shares can move a few points either way. */
export const SMALL_CLASS = 50;

/** Fallback suppression floor for counts of people by field (river.json meta.k.field). */
export const FIELD_FLOOR = 5;

const LEVEL_IDS = new Set<string>(LEVELS.map((l) => l.id));
const COHORT_IDS = new Set<string>(COHORTS.map((c) => c.id));

/** The five-year bands, oldest first (no 'all'). */
export const COHORT_ORDER: CohortId[] = COHORTS
  .map((c) => c.id)
  .filter((id) => id !== 'all')
  .sort();

/** URL guard for ?level=. Unknown values -> null (caller falls back to the default). */
export function parseLevel(raw: string): LevelId | null {
  return LEVEL_IDS.has(raw) ? (raw as LevelId) : null;
}

/** URL guard for ?cohort=. */
export function parseCohort(raw: string): CohortId | null {
  return COHORT_IDS.has(raw) ? (raw as CohortId) : null;
}

/** URL guard for ?view=. */
export function parseTab(raw: string): RiverTab | null {
  return raw === 'flow' || raw === 'years' ? raw : null;
}

export function findSlice(river: RiverFile, level: LevelId, program: string, cohort: CohortId): RiverSlice | undefined {
  return river.slices.find((s) => s.level === level && s.program === program && s.cohort === cohort);
}

export function programExists(river: RiverFile, level: LevelId, program: string): boolean {
  if (program === 'all') return true;
  if (level === 'all') return false; // level "all" only ever has program "all"
  return river.slices.some((s) => s.level === level && s.program === program);
}

/** Loose key for program names typed into a URL: case, accents and spacing are ignored. */
export function programKey(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').trim().replace(/\s+/g, ' ').toLowerCase();
}

/**
 * River's spelling of a program named in a URL (`commerce` -> `Commerce`): an exact match first,
 * then one that exists at `level`, then any. Null when River has no such program at any level.
 */
export function canonicalProgram(river: RiverFile, raw: string, level?: LevelId): string | null {
  const want = programKey(raw);
  if (!want) return null;
  const matches = [...new Set(river.slices
    .filter((s) => s.program !== 'all' && programKey(s.program) === want)
    .map((s) => s.program))];
  if (!matches.length) return null;
  const exact = matches.find((p) => p === raw.trim());
  if (exact) return exact;
  const atLevel = level ? matches.find((p) => river.slices.some((s) => s.level === level && s.program === p)) : undefined;
  return atLevel ?? matches[0];
}

/** Levels (other than "all") where River has this program, largest first. */
export function levelsWithProgram(river: RiverFile, program: string): { level: LevelId; n: number }[] {
  const sizes = new Map<LevelId, { all: number | null; max: number }>();
  for (const s of river.slices) {
    if (s.program !== program || s.level === 'all') continue;
    const cur = sizes.get(s.level) ?? { all: null, max: 0 };
    if (s.cohort === 'all') cur.all = s.n;
    cur.max = Math.max(cur.max, s.n);
    sizes.set(s.level, cur);
  }
  return [...sizes.entries()]
    .map(([level, sz]) => ({ level, n: sz.all ?? sz.max }))
    .sort((a, b) => b.n - a.n);
}

/** A program picker entry (the shape the shared ProgramPicker takes). */
export interface ProgramOption {
  value: string;       // canonical name or "all"
  label: string;       // what the picker shows
  n: number | null;    // people in the all-classes slice (largest-first sort key)
}

/**
 * Programs that have at least one slice at this level, "All programs" first, then largest
 * first by the all-classes slice (falling back to the program's biggest slice), ties A→Z.
 */
export function programsForLevel(river: RiverFile, level: LevelId): ProgramOption[] {
  const sizes = new Map<string, { all: number | null; max: number }>();
  for (const s of river.slices) {
    if (s.level !== level || s.program === 'all') continue;
    const cur = sizes.get(s.program) ?? { all: null, max: 0 };
    if (s.cohort === 'all') cur.all = s.n;
    cur.max = Math.max(cur.max, s.n);
    sizes.set(s.program, cur);
  }
  const allSlice = findSlice(river, level, 'all', 'all');
  const head: ProgramOption = { value: 'all', label: 'All programs', n: allSlice?.n ?? null };
  if (level === 'all') return [head];
  const rest = [...sizes.entries()]
    .map(([program, sz]) => ({ value: program, label: program, n: sz.all ?? sz.max }))
    .sort((a, b) => (b.n ?? 0) - (a.n ?? 0) || a.value.localeCompare(b.value));
  return [head, ...rest];
}

/**
 * Turn raw URL values into filters that exist in the data. Unknown level -> default. Program names
 * match case-insensitively. A link that names a program but no (valid) level opens the largest
 * level that has that program. A program with no River at the level falls back to "all" and is
 * reported in `dropped`. A link with no (valid) class opens the default class if this level and
 * program have a River for it, else all classes, else the nearest class that does (so
 * `?level=medicine` or `?level=undergrad&program=Biology` never dead-ends); a class the link does
 * name is kept even without a River, so the view can say why and offer alternatives.
 */
export function resolveFilters(
  river: RiverFile,
  raw: { level?: string | null; program?: string | null; cohort?: string | null },
): ResolvedFilters {
  let level = (raw.level != null && parseLevel(raw.level)) || DEFAULT_FILTERS.level;
  const asked = raw.cohort != null ? parseCohort(raw.cohort) : null;
  const classFor = (program: string): CohortId =>
    asked ?? fallbackCohort(river, level, program, DEFAULT_FILTERS.cohort) ?? DEFAULT_FILTERS.cohort;
  const named = raw.program?.trim() ?? '';
  if (!named || programKey(named) === 'all') return { level, program: 'all', cohort: classFor('all'), dropped: null };

  const canon = canonicalProgram(river, named, level === 'all' ? undefined : level);
  if (canon && level === 'all') {
    const host = river.slices
      .filter((s) => s.program === canon && s.level !== 'all' && s.cohort === 'all')
      .sort((a, b) => b.n - a.n)[0]
      ?? river.slices.filter((s) => s.program === canon && s.level !== 'all').sort((a, b) => b.n - a.n)[0];
    if (host) level = host.level;
  }
  if (canon && programExists(river, level, canon)) return { level, program: canon, cohort: classFor(canon), dropped: null };
  return { level, program: 'all', cohort: classFor('all'), dropped: canon ?? named };
}

/** Classes that have a River for this level and program. */
export function cohortsWithSlice(river: RiverFile, level: LevelId, program: string): Set<CohortId> {
  return new Set(river.slices.filter((s) => s.level === level && s.program === program).map((s) => s.cohort));
}

/** Bands sorted by distance from `cohort` (an unknown or 'all' cohort counts as the newest), later bands winning ties. */
function nearestCohorts(cohort: CohortId): CohortId[] {
  const at = COHORT_ORDER.indexOf(cohort);
  const i = at < 0 ? COHORT_ORDER.length : at;
  const rank = (c: CohortId) => COHORT_ORDER.indexOf(c);
  return COHORT_ORDER
    .filter((c) => c !== cohort)
    .sort((a, b) => Math.abs(rank(a) - i) - Math.abs(rank(b) - i) || rank(b) - rank(a));
}

/**
 * Where a level or program change should land so it never dead-ends: the same class if it has a
 * River, else all classes, else the nearest class that does (later wins ties). Null if none.
 */
export function fallbackCohort(river: RiverFile, level: LevelId, program: string, cohort: CohortId): CohortId | null {
  const have = cohortsWithSlice(river, level, program);
  if (have.has(cohort)) return cohort;
  if (have.has('all')) return 'all';
  return nearestCohorts(cohort).find((c) => have.has(c)) ?? null;
}

// ── Labels ──────────────────────────────────────────────────────────────────

function humanize(id: string): string {
  const s = id.replace(/_/g, ' ');
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export function cohortLabel(cohort: CohortId): string {
  return COHORTS.find((c) => c.id === cohort)?.label ?? cohort;
}

/** "the class of 2010–2014" / "the classes of 1995–2024", for use mid-sentence. */
export function cohortPhrase(cohort: CohortId): string {
  const label = cohortLabel(cohort);
  return `the ${label.charAt(0).toLowerCase()}${label.slice(1)}`;
}

/** First and last graduating year of a cohort: a band's own years; 'all' spans every band. */
export function cohortYears(cohort: CohortId): { from: number; to: number } | null {
  const m = /^(\d{4})-(\d{4})$/.exec(cohort);
  if (m) return { from: Number(m[1]), to: Number(m[2]) };
  const bands = COHORT_ORDER.map(cohortYears).filter((b): b is { from: number; to: number } => b != null);
  if (cohort !== 'all' || !bands.length) return null;
  return { from: Math.min(...bands.map((b) => b.from)), to: Math.max(...bands.map((b) => b.to)) };
}

/** The last June the snapshot has seen: "2025-09" -> 2025, "2025-03" -> 2024. */
export function lastJune(snapshot: string): number | null {
  const [y, m] = snapshot.split('-').map(Number);
  if (!y) return null;
  return m && m < 6 ? y - 1 : y;
}

/**
 * The classes of a cohort that have reached a trajectory point: year N is June of grad_year + N,
 * so class c has reached it once c + N <= the snapshot's last June. Year 0 and 'now' cover every
 * class. Null when it can't be worked out.
 */
export function classesReached(cohort: CohortId, year: number | 'now', snapshot: string): { from: number; to: number } | null {
  const span = cohortYears(cohort);
  if (!span) return null;
  if (year === 'now' || year <= 0) return span;
  const june = lastJune(snapshot);
  if (june == null) return null;
  const to = Math.min(span.to, june - year);
  return to < span.from ? null : { from: span.from, to };
}

/** "the classes of 2010–2012" / "the class of 2010". */
export function classesPhrase(span: { from: number; to: number }): string {
  return span.from === span.to ? `the class of ${span.from}` : `the classes of ${span.from}–${span.to}`;
}

const LEVEL_NOUN: Record<LevelId, string> = {
  all: 'Queen’s alumni',
  undergrad: 'undergrads',
  graduate: 'master’s & PhD grads',
  mba: 'MBA grads',
  law: 'law grads',
  medicine: 'medical grads',
};

const LEVEL_TAG: Record<LevelId, string> = {
  all: '', undergrad: 'undergrad', graduate: 'master’s & PhD', mba: 'MBA', law: 'JD', medicine: 'MD',
};

/** Who the slice is about, as a plural noun phrase: "Commerce grads", "law grads". */
export function populationLabel(level: LevelId, program: string): string {
  if (level === 'all' || program === 'all') return LEVEL_NOUN[level] ?? 'alumni';
  if (level === 'graduate') return `${program} grads (master’s & PhD)`;
  return `${program} grads`;
}

/** A program with its level, for notices and links: "Computer Engineering (master’s & PhD)". */
export function programTag(level: LevelId, program: string): string {
  return LEVEL_TAG[level] ? `${program} (${LEVEL_TAG[level]})` : program;
}

/** Accessible chart title, e.g. "Commerce, class of 2010–2014" / "Undergrads, classes of 1995–2024". */
export function sliceTitle(level: LevelId, program: string, cohort: CohortId): string {
  const who = program !== 'all' && level !== 'all' ? program : populationLabel(level, 'all');
  return `${who.charAt(0).toUpperCase()}${who.slice(1)}, ${cohortPhrase(cohort).replace(/^the /, '')}`;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "2025-09" -> "Sep 2025" (anything unparseable is returned as-is). */
export function snapshotLabel(snapshot: string): string {
  const [y, m] = snapshot.split('-').map(Number);
  return y && m && m >= 1 && m <= 12 ? `${MONTHS[m - 1]} ${y}` : snapshot;
}

/** The trajectory year a Sankey column stands for: s0 -> 0, y10 -> 10, now -> 'now'. */
export function stageYear(stage: StageId): number | 'now' {
  if (stage === 'now') return 'now';
  if (stage === 's0') return 0;
  const n = Number(stage.slice(1));
  return Number.isFinite(n) ? n : 'now';
}

/** "3", "3 & 5", "3, 5 & 10": the years of some Sankey columns, for "Add years …". */
export function yearList(stages: StageId[]): string {
  const ys = stages.map(stageYear).filter((y): y is number => typeof y === 'number').map(String);
  if (ys.length <= 1) return ys[0] ?? '';
  return `${ys.slice(0, -1).join(', ')} & ${ys[ys.length - 1]}`;
}

// ── Slice picking ───────────────────────────────────────────────────────────

export interface Alternative extends Filters { label: string; n: number }

export type SlicePick =
  | { status: 'ok'; slice: RiverSlice }
  | { status: 'missing'; alternatives: Alternative[] };

/**
 * The slice for these filters, or (when the combo is under the export's minimum size) up to
 * four one-click alternatives that do exist: the same program across all classes, the same
 * program in the nearest classes, then the whole level for the same class.
 */
export function pickSlice(river: RiverFile, level: LevelId, program: string, cohort: CohortId): SlicePick {
  const slice = findSlice(river, level, program, cohort);
  if (slice) return { status: 'ok', slice };

  const out: Alternative[] = [];
  const push = (l: LevelId, p: string, c: CohortId, label: string) => {
    const s = findSlice(river, l, p, c);
    if (s && !out.some((a) => a.level === l && a.program === p && a.cohort === c)) {
      out.push({ level: l, program: p, cohort: c, label, n: s.n });
    }
  };

  const allOf = (l: LevelId) => (l === 'all' ? 'All alumni' : `All ${LEVEL_NOUN[l]}`);
  const progName = program === 'all' ? allOf(level) : program;
  if (cohort !== 'all') push(level, program, 'all', `${progName}, all classes`);
  for (const c of nearestCohorts(cohort)) {
    if (out.length >= 2) break;
    push(level, program, c, `${progName}, ${cohortLabel(c).toLowerCase()}`);
  }
  if (program !== 'all') push(level, 'all', cohort, `${allOf(level)}, ${cohortLabel(cohort).toLowerCase()}`);
  if (level !== 'all') push('all', 'all', cohort, `All alumni, ${cohortLabel(cohort).toLowerCase()}`);
  push('all', 'all', 'all', 'All alumni, all classes');
  return { status: 'missing', alternatives: out.slice(0, 4) };
}

// ── Groups: what a node stands for ──────────────────────────────────────────

type JobSector = Exclude<SectorId, 'neutral'>;
/** A sector of related fields, rolled up into one node (e.g. Finance & accounting + Consulting). */
export type SectorGroupId = `sector:${JobSector}`;
/** A node's identity: one field (career family), or a rolled-up sector of related fields. */
export type GroupId = FamilyId | SectorGroupId;

export const isSectorGroup = (id: string): id is SectorGroupId => id.startsWith('sector:');
const sectorOf = (id: SectorGroupId) => id.slice('sector:'.length) as JobSector;

/** Job fields per sector, in taxonomy order. */
const SECTOR_FIELDS = new Map<SectorId, FamilyId[]>();
for (const f of FAMILIES) {
  if (!f.isJob || f.sector === 'neutral') continue;
  SECTOR_FIELDS.set(f.sector, [...(SECTOR_FIELDS.get(f.sector) ?? []), f.id]);
}

/**
 * The node a field rolls up into: its sector when the sector has several job fields; itself when
 * it is the sector's only job field (Tech, Teaching) or not a job in a sector (further study, no
 * role listed, smaller groups, other roles, ids the taxonomy doesn't know).
 */
export function groupOf(id: FamilyId | string): GroupId {
  const info = FAMILY[id as FamilyId];
  if (!info || !info.isJob || info.sector === 'neutral') return id as GroupId;
  return (SECTOR_FIELDS.get(info.sector)?.length ?? 0) > 1 ? `sector:${info.sector as JobSector}` : info.id;
}

/** Fields that make up a group, in taxonomy order. */
export function groupFields(id: GroupId | string): FamilyId[] {
  return isSectorGroup(id) ? SECTOR_FIELDS.get(sectorOf(id)) ?? [] : [id as FamilyId];
}

/** Node labels for rolled-up sectors (the long label is the taxonomy's sector label). */
const SECTOR_SHORT: Record<JobSector, string> = {
  tech: 'Tech', finance: 'Finance', health: 'Health/Sci', education: 'Teaching', creative: 'Mktg/Media',
  public: 'Law/Public', management: 'Management', engineering: 'Engineering',
};

/** Long label: "Finance & accounting", "Finance & consulting" (a sector), tolerant of unknown ids. */
export function familyLabel(id: GroupId | string): string {
  if (isSectorGroup(id)) return SECTOR[sectorOf(id)]?.label ?? humanize(sectorOf(id));
  return FAMILY[id as FamilyId]?.label ?? humanize(id);
}

/** Short (node-label) name: "Finance", "No role". */
export function familyShort(id: GroupId | string): string {
  if (isSectorGroup(id)) return SECTOR_SHORT[sectorOf(id)] ?? familyLabel(id);
  return FAMILY[id as FamilyId]?.short ?? humanize(id);
}

/**
 * One-line description for tooltips; sectors list the fields they combine. UI copy says "field",
 * not "family", and the smaller-groups floor comes from the data (`floor` = meta.k.field).
 */
export function familyDescription(id: GroupId | string, floor = FIELD_FLOOR): string | null {
  if (isSectorGroup(id)) return `Combines ${listWords(groupFields(id).map(familyLabel))}`;
  if (id === 'smaller_groups') return `Fields with fewer than ${floor} people at this point, combined to protect privacy`;
  return FAMILY[id as FamilyId]?.description ?? null;
}

/** Colour: the sector's (related fields share a colour); neutral grey for anything unknown. */
export function groupColor(id: GroupId | string): string {
  if (isSectorGroup(id)) return SECTOR[sectorOf(id)]?.color ?? SECTOR.neutral.color;
  return familyColor(id as FamilyId);
}

/** The sector whose colour a group wears ('neutral' for non-job states and unknown ids). */
function colorSector(id: GroupId | string): SectorId {
  if (isSectorGroup(id)) return sectorOf(id);
  return FAMILY[id as FamilyId]?.sector ?? 'neutral';
}

const TONES = [1, 0.58, 0.8, 0.44];

/**
 * Fill opacity that tells same-colour neighbours apart in a stacked chart: the first group of a
 * colour (in `groups` order) is solid, the next lighter, and so on. Colour still means sector.
 */
export function toneOf(groups: (GroupId | string)[]): Map<string, number> {
  const seen = new Map<SectorId, number>();
  const out = new Map<string, number>();
  for (const g of groups) {
    const s = colorSector(g);
    const i = seen.get(s) ?? 0;
    seen.set(s, i + 1);
    out.set(g, TONES[i % TONES.length]);
  }
  return out;
}

function listWords(words: string[]): string {
  if (words.length <= 1) return words[0] ?? '';
  return `${words.slice(0, -1).join(', ')} and ${words[words.length - 1]}`;
}

/** Non-job states sit at the bottom of every column, in this order. */
export const BOTTOM_FAMILIES: FamilyId[] = ['further_study', 'no_role_listed', 'smaller_groups'];

const JOB_ORDER = FAMILY_ORDER.filter((f) => !BOTTOM_FAMILIES.includes(f));

/**
 * Vertical sort key: job fields (or sectors, at their first field's place) in taxonomy order,
 * then any id the taxonomy doesn't know (alphabetical, via the caller's tie-break), then the
 * non-job states.
 */
export function familyRank(id: GroupId | string): number {
  const b = BOTTOM_FAMILIES.indexOf(id as FamilyId);
  if (b >= 0) return 1000 + b;
  const first = isSectorGroup(id) ? groupFields(id)[0] : id;
  const j = JOB_ORDER.indexOf(first as FamilyId);
  return j >= 0 ? j : 500;
}

export function compareFamilies(a: GroupId | string, b: GroupId | string): number {
  return familyRank(a) - familyRank(b) || String(a).localeCompare(String(b));
}

function isJob(id: GroupId | string): boolean {
  if (isSectorGroup(id)) return true;
  if (BOTTOM_FAMILIES.includes(id as FamilyId)) return false;
  return FAMILY[id as FamilyId]?.isJob ?? true;
}

// ── View slices (a slice as drawn: fields, or fields rolled up into sectors) ─

export interface ViewLink { from_stage: StageId; from: GroupId; to_stage: StageId; to: GroupId; n: number }

/** A RiverSlice whose nodes may be sectors. A plain RiverSlice is a valid ViewSlice. */
export interface ViewSlice {
  level: LevelId;
  program: string;
  cohort: CohortId;
  n: number;
  stages: StageId[];
  totals: Partial<Record<StageId, Partial<Record<GroupId, number>>>>;
  links: ViewLink[];
  suppressed: number | null;
  details: Partial<Record<StageId, Partial<Record<GroupId, { employers: NamedCount[]; titles: NamedCount[] }>>>>;
  /** Rolled-up slices: the published field totals behind each sector node, largest first. */
  parts?: Partial<Record<StageId, Partial<Record<GroupId, [FamilyId, number][]>>>>;
}

/**
 * Roll fields up into sectors by adding published totals and published links (adding published
 * numbers can't reveal anything a single number didn't). Non-job states stay separate. Employer
 * and title lists are kept only for nodes that are still a single field (they're top-N lists per
 * field, so their sums would undercount).
 */
export function rollUpSlice(slice: RiverSlice): ViewSlice {
  const totals: ViewSlice['totals'] = {};
  const parts: NonNullable<ViewSlice['parts']> = {};
  for (const st of slice.stages) {
    const t: Partial<Record<GroupId, number>> = {};
    const p: Partial<Record<GroupId, [FamilyId, number][]>> = {};
    for (const [f, v] of Object.entries(slice.totals[st] ?? {}) as [FamilyId, number][]) {
      if (!(v > 0)) continue;
      const g = groupOf(f);
      t[g] = (t[g] ?? 0) + v;
      if (isSectorGroup(g)) (p[g] ??= []).push([f, v]);
    }
    for (const list of Object.values(p)) list?.sort((a, b) => b[1] - a[1] || compareFamilies(a[0], b[0]));
    if (slice.totals[st]) totals[st] = t;
    parts[st] = p;
  }

  const sums = new Map<string, ViewLink>();
  for (const l of slice.links) {
    if (!(l.n > 0)) continue;
    const from = groupOf(l.from);
    const to = groupOf(l.to);
    const key = `${l.from_stage}|${from}|${l.to_stage}|${to}`;
    const cur = sums.get(key);
    if (cur) cur.n += l.n;
    else sums.set(key, { from_stage: l.from_stage, from, to_stage: l.to_stage, to, n: l.n });
  }

  const details: ViewSlice['details'] = {};
  for (const [st, byFamily] of Object.entries(slice.details) as [StageId, RiverSlice['details'][StageId]][]) {
    const kept: NonNullable<ViewSlice['details'][StageId]> = {};
    for (const [f, d] of Object.entries(byFamily ?? {}) as [FamilyId, { employers: NamedCount[]; titles: NamedCount[] }][]) {
      if (groupOf(f) === f) kept[f] = d;
    }
    details[st] = kept;
  }

  return {
    level: slice.level, program: slice.program, cohort: slice.cohort, n: slice.n, stages: slice.stages,
    suppressed: slice.suppressed, totals, links: [...sums.values()], details, parts,
  };
}

// ── Sankey input ────────────────────────────────────────────────────────────

export interface SankeyNodeInput {
  id: string;            // `${stage}:${group}`
  stage: StageId;
  stageIndex: number;
  family: GroupId;
  value: number;         // published total at this stage
}

export interface SankeyLinkInput {
  id: string;            // `${source}>${target}`
  source: string;
  target: string;
  from: GroupId;
  to: GroupId;
  fromStage: StageId;
  toStage: StageId;
  value: number;
}

export interface SankeyInput {
  n: number;
  stages: StageId[];
  nodes: SankeyNodeInput[];
  links: SankeyLinkInput[];
}

export const nodeId = (stage: StageId, family: GroupId | string) => `${stage}:${family}`;

/** Stages with at least one published total (the chart's columns). */
export function publishedStages(slice: ViewSlice): StageId[] {
  return slice.stages.filter((st) => Object.values(slice.totals[st] ?? {}).some((v) => (v ?? 0) > 0));
}

/**
 * Nodes and links for d3-sankey. Columns are the slice's stages that have at least one
 * published total; nodes are sized from `totals` (not from links, which are a subset);
 * links only join consecutive columns and only nodes that exist.
 */
export function buildSankeyInput(slice: ViewSlice): SankeyInput {
  const stages = publishedStages(slice);
  const nodes: SankeyNodeInput[] = [];
  stages.forEach((stage, stageIndex) => {
    const entries = Object.entries(slice.totals[stage] ?? {}) as [GroupId, number][];
    entries
      .filter(([, v]) => v > 0)
      .sort(([a], [b]) => compareFamilies(a, b))
      .forEach(([family, value]) => nodes.push({ id: nodeId(stage, family), stage, stageIndex, family, value }));
  });
  const ids = new Set(nodes.map((d) => d.id));
  const next = new Map(stages.slice(0, -1).map((st, i) => [st, stages[i + 1]]));
  const links: SankeyLinkInput[] = [];
  for (const l of slice.links) {
    if (!(l.n > 0) || next.get(l.from_stage) !== l.to_stage) continue;
    const source = nodeId(l.from_stage, l.from);
    const target = nodeId(l.to_stage, l.to);
    if (!ids.has(source) || !ids.has(target)) continue;
    links.push({
      id: `${source}>${target}`, source, target,
      from: l.from, to: l.to, fromStage: l.from_stage, toStage: l.to_stage, value: l.n,
    });
  }
  return { n: slice.n, stages, nodes, links };
}

/**
 * Just the first and last columns (phones). Links are only published between consecutive
 * stages, so unless the slice has two stages there are no flows between these columns, and
 * none are invented.
 */
export function firstAndLast(input: SankeyInput): SankeyInput {
  if (input.stages.length <= 2) return input;
  const keep = [input.stages[0], input.stages[input.stages.length - 1]];
  return {
    n: input.n,
    stages: keep,
    nodes: input.nodes.filter((d) => keep.includes(d.stage)).map((d) => ({ ...d, stageIndex: keep.indexOf(d.stage) })),
    links: input.links.filter((l) => l.fromStage === keep[0] && l.toStage === keep[1]),
  };
}

// ── Summary sentence ────────────────────────────────────────────────────────

/** Largest group at a stage among those passing `keep`; ties go to taxonomy order. */
function largest(slice: ViewSlice, stage: StageId, keep: (f: GroupId) => boolean): [GroupId, number] | null {
  const entries = (Object.entries(slice.totals[stage] ?? {}) as [GroupId, number][])
    .filter(([f, v]) => keep(f) && v > 0)
    .sort(([fa, a], [fb, b]) => b - a || compareFamilies(fa, fb));
  return entries[0] ?? null;
}

const LATER_PHRASE: Partial<Record<StageId, string>> = {
  now: 'today', y20: 'by year 20', y10: 'by year 10', y5: 'by year 5', y3: 'by year 3',
};

/** Lower-case topic for "careers converge on …". */
const THEME: Partial<Record<GroupId, string>> = {
  tech: 'tech', finance_accounting: 'finance', consulting: 'consulting', healthcare: 'healthcare',
  research_academia: 'research', teaching: 'teaching', sales_marketing: 'sales & marketing',
  arts_media: 'arts & media', law: 'law', government_policy: 'government',
  nonprofit_community: 'the nonprofit sector', operations_management: 'management',
  founder: 'founding companies', engineering: 'engineering', service_trades: 'service & trades',
  other: 'other roles',
  'sector:finance': 'finance & consulting', 'sector:health': 'health & research',
  'sector:creative': 'media & marketing', 'sector:public': 'law & public service',
  'sector:management': 'management', 'sector:engineering': 'engineering & trades',
};
const theme = (id: GroupId) => THEME[id] ?? familyLabel(id).toLowerCase();
/** Labels that read as plurals ("Founders grow"). */
const PLURAL = new Set<string>(['founder', 'other']);

/** Smallest change in share (of the class) that counts as notable: 2 percentage points. */
const NOTABLE = 0.02;
/** Further study leads the story when at least this share of the class went straight on to it. */
const STUDY_LEAD = 0.25;

/** Marks the one number the view highlights; `summaryParts` splits on it. */
const KEY = '\u0000';
const key = (s: string) => `${KEY}${s}${KEY}`;

/**
 * One or two plain-English sentences about the slice, using only published numbers, as
 * [before, key number, after]: the view puts a highlight behind the key number. It leads with
 * the most notable thing between the first destination and the last stage, and names the field:
 *   "Of about 7,055 Queen’s alumni from the class of 2010–2014, careers converge on management:
 *    Operations & management grows from 11% right after graduating to [15%] today."
 * In order: one field holding a majority throughout; a further-study-first class; the biggest
 * change in a field's share (2+ points); further study narrowly first; a steady mix.
 * `who` is a plural noun phrase ("Commerce grads"), `cohort` a phrase ("the class of 2010–2014"),
 * `floor` the smallest published count (meta.k.field). Counts are perturbed, so "about".
 */
export function summaryParts(slice: ViewSlice, who: string, cohort: string, floor = FIELD_FLOOR): [string, string, string] {
  const [before = '', k = '', after = ''] = summaryRaw(slice, who, cohort, floor).split(KEY);
  return [before, k, after];
}

/** The summary as plain text. */
export function summarySentence(slice: ViewSlice, who: string, cohort: string, floor = FIELD_FLOOR): string {
  return summaryParts(slice, who, cohort, floor).join('');
}

function summaryRaw(slice: ViewSlice, who: string, cohort: string, floor: number): string {
  const n = slice.n;
  const pct = (v: number) => fmtPct(v, n);
  const L = (id: GroupId) => familyLabel(id);
  const opening = `Of about ${fmtInt(n)} ${who} from ${cohort}`;
  const stages = publishedStages(slice);
  const first = stages[0];
  if (!first || !(n > 0)) return `${opening}, no career stages could be published.`;
  const last = stages.length > 1 ? stages[stages.length - 1] : null;
  const when = last ? LATER_PHRASE[last] ?? 'later' : '';

  const top0 = largest(slice, first, isJob);
  const topN = last ? largest(slice, last, isJob) : null;
  const study0 = slice.totals[first]?.further_study ?? 0;
  const studyFirst = study0 > 0 && (!top0 || study0 > top0[1]);
  const studyLead = (): string => {
    const lead = `${opening}, ${key(pct(study0))} went straight on to further study, the most common first step`;
    if (topN) return `${lead}; ${when}, the largest field is ${L(topN[0])} (${pct(topN[1])}).`;
    if (top0) return `${lead}; ${pct(top0[1])} started in ${L(top0[0])}.`;
    return `${lead}.`;
  };

  if (studyFirst && (!top0 || !topN || study0 / n >= STUDY_LEAD)) return studyLead();
  if (!top0) return `${opening}, no single field reached ${floor} people right after graduating.`;
  if (!last) return `${opening}, ${key(pct(top0[1]))} started in ${L(top0[0])}.`;
  if (!topN) return `${opening}, ${key(pct(top0[1]))} started in ${L(top0[0])}; ${when}, no single field reaches ${floor} people.`;

  // A majority field from start to finish.
  if (top0[1] / n >= 0.5 && topN[0] === top0[0]) {
    return `${opening}, most start in ${L(top0[0])} and it stays the largest field: ${pct(top0[1])} right after graduating, ${key(pct(topN[1]))} ${when}.`;
  }

  // The biggest change in share among fields published at both ends (growth wins ties).
  const changes = (Object.entries(slice.totals[first] ?? {}) as [GroupId, number][])
    .filter(([id, a]) => isJob(id) && a > 0 && (slice.totals[last]?.[id] ?? 0) > 0)
    .map(([id, a]) => { const b = slice.totals[last]![id]!; return { id, a, b, d: (b - a) / n }; })
    .sort((x, y) => Math.abs(y.d) - Math.abs(x.d) || y.d - x.d || compareFamilies(x.id, y.id));
  const lead = changes[0];
  if (lead && Math.abs(lead.d) >= NOTABLE && pct(lead.a) !== pct(lead.b)) {
    const s = PLURAL.has(lead.id) ? '' : 's';
    if (lead.d > 0) {
      const leads = topN[0] === lead.id;
      let out = `${opening}, careers ${leads ? 'converge on' : 'drift toward'} ${theme(lead.id)}: ${L(lead.id)} grow${s} from ${pct(lead.a)} right after graduating to ${key(pct(lead.b))} ${when}.`;
      // Name the largest field when it isn't the one growing.
      if (!leads) out += ` ${L(topN[0])} is ${topN[0] === top0[0] ? 'still ' : ''}the largest field (${pct(topN[1])}).`;
      return out;
    }
    const shrink = `${opening}, careers move away from ${theme(lead.id)}: ${L(lead.id)} shrink${s} from ${pct(lead.a)} right after graduating to ${key(pct(lead.b))} ${when}`;
    return topN[0] === lead.id
      ? `${shrink}, though ${PLURAL.has(lead.id) ? 'they are' : 'it is'} still the largest field.`
      : `${shrink}. ${L(topN[0])} is the largest field ${when} (${pct(topN[1])}).`;
  }

  if (studyFirst) return studyLead();
  // Nothing moved by 2+ points. "Barely changes" needs the same leader, published at both ends.
  if (topN[0] === top0[0] && lead) {
    return `${opening}, the mix of fields barely changes: ${L(topN[0])} is the largest, with ${pct(top0[1])} right after graduating and ${key(pct(topN[1]))} ${when}.`;
  }
  return `${opening}, ${pct(top0[1])} started in ${L(top0[0])}; ${when}, the largest field is ${L(topN[0])} (${key(pct(topN[1]))}).`;
}

// ── Then vs now (the summary card) ──────────────────────────────────────────

export interface ThenNowRow {
  group: GroupId;
  /** Published people right after graduating / today. */
  first: number;
  now: number;
  /** Shares of the class. */
  a: number;
  b: number;
  /** Change in whole percentage points, from the rounded shares (so "39% → 33%" reads −6). */
  pts: number;
}

/**
 * First destination vs today for the biggest fields published at both ends (further study counts;
 * "no role listed", "smaller groups" don't): the `max` largest at either end, sorted by change,
 * biggest gain first. Empty when the slice has a single stage.
 */
export function thenVsNow(slice: ViewSlice, max = 6): ThenNowRow[] {
  const stages = publishedStages(slice);
  const first = stages[0];
  const last = stages.length > 1 ? stages[stages.length - 1] : null;
  if (!first || !last || !(slice.n > 0)) return [];
  const t0 = slice.totals[first] ?? {};
  const t1 = slice.totals[last] ?? {};
  const keep = (g: GroupId) => g !== 'no_role_listed' && g !== 'smaller_groups';
  const rows: ThenNowRow[] = (Object.entries(t0) as [GroupId, number][])
    .filter(([g, v]) => keep(g) && v > 0 && (t1[g] ?? 0) > 0)
    .map(([group, v0]) => {
      const v1 = t1[group]!;
      const a = v0 / slice.n;
      const b = v1 / slice.n;
      return { group, first: v0, now: v1, a, b, pts: Math.round(b * 100) - Math.round(a * 100) };
    });
  return rows
    .sort((x, y) => Math.max(y.a, y.b) - Math.max(x.a, x.b) || compareFamilies(x.group, y.group))
    .slice(0, max)
    .sort((x, y) => y.pts - x.pts || (y.b - y.a) - (x.b - x.a) || compareFamilies(x.group, y.group));
}

// ── Sticker (one dry margin note, only when the data backs it) ──────────────

/** Lower-case nouns that read right in "most of … stays put" / "… keeps growing". */
const NOTE_NOUN: Partial<Record<GroupId, string>> = {
  tech: 'tech', finance_accounting: 'finance', consulting: 'consulting', healthcare: 'healthcare',
  research_academia: 'research', teaching: 'teaching', law: 'law', government_policy: 'government',
  operations_management: 'management', engineering: 'engineering', sales_marketing: 'sales & marketing',
  'sector:finance': 'finance', 'sector:health': 'health & research', 'sector:public': 'law & government',
  'sector:management': 'management', 'sector:engineering': 'engineering',
};

/** Share of a field that must stay in it between every pair of columns for "most of … stays put". */
const STAYS = 0.6;
/** Gain (whole points, first destination to today) for "… keeps growing". */
const GROWS = 4;

/**
 * A four-to-six-word lowercase note for the view, or null when nothing clears the bar:
 *  - "most of finance stays put": the largest first-destination job field (20%+ of the class)
 *    keeps at least 60% of its people between every pair of consecutive columns (published
 *    links only; nothing chained or derived).
 *  - "management keeps growing": a field gains 4+ points from first destination to today and its
 *    share never drops at any column (needs at least three columns, all published).
 */
export function stickerNote(slice: ViewSlice): string | null {
  const stages = publishedStages(slice);
  if (stages.length < 2 || !(slice.n > 0)) return null;
  const share = (st: StageId, g: GroupId) => (slice.totals[st]?.[g] ?? 0) / slice.n;

  const top = largest(slice, stages[0], isJob);
  if (top && NOTE_NOUN[top[0]] && top[1] / slice.n >= 0.2) {
    const g = top[0];
    const kept = stages.slice(0, -1).every((st, i) => {
      const from = slice.totals[st]?.[g] ?? 0;
      const self = slice.links.find((l) => l.from_stage === st && l.to_stage === stages[i + 1] && l.from === g && l.to === g);
      return from > 0 && self != null && self.n / from >= STAYS;
    });
    if (kept) return `most of ${NOTE_NOUN[g]} stays put`;
  }

  if (stages.length >= 3) {
    const first = stages[0];
    const last = stages[stages.length - 1];
    const growers = thenVsNow(slice, 99)
      .filter((r) => NOTE_NOUN[r.group] && r.pts >= GROWS)
      .filter((r) => stages.every((st) => (slice.totals[st]?.[r.group] ?? 0) > 0))
      .filter((r) => stages.slice(1).every((st, i) => share(st, r.group) >= share(stages[i], r.group)))
      .filter((r) => share(last, r.group) > share(first, r.group));
    if (growers.length) return `${NOTE_NOUN[growers[0].group]} keeps growing`;
  }
  return null;
}

// ── Table rows ──────────────────────────────────────────────────────────────

export interface TableRow { family: GroupId; cells: (number | null)[] }

/** stage × field counts for the table view: every field present at any stage, in chart order. */
export function tableRows(slice: ViewSlice, stages: StageId[] = slice.stages): TableRow[] {
  const fams = new Set<GroupId>();
  for (const st of stages) for (const f of Object.keys(slice.totals[st] ?? {}) as GroupId[]) fams.add(f);
  return [...fams].sort(compareFamilies).map((family) => ({
    family,
    cells: stages.map((st) => {
      const v = slice.totals[st]?.[family];
      return v != null && v > 0 ? v : null;
    }),
  }));
}

// ── Year by year ────────────────────────────────────────────────────────────

/** One point of the trajectory as drawn: fields, or fields rolled up into sectors. */
export interface YearRow {
  year: number | 'now';
  /** Members who have reached this point: the denominator for every share at it. */
  n: number;
  /** Published people per group at this point (absent = under the floor, never 0). */
  counts: Partial<Record<GroupId, number>>;
  /** Sum of the published counts (can exceed n by a little: each count is nudged). */
  sum: number;
  /** Rolled-up rows: the published fields behind each sector, largest first. */
  parts?: Partial<Record<GroupId, [FamilyId, number][]>>;
}

export interface YearSeries {
  /** People in the slice. */
  n: number;
  /** Points in order: 0, 1, 2, … then 'now'. Missing years stay missing. */
  rows: YearRow[];
  /** Every group published at any point, in chart order (top of the stack first, like the Sankey). */
  groups: GroupId[];
}

const isYear = (y: unknown): y is number | 'now' => y === 'now' || (typeof y === 'number' && Number.isInteger(y) && y >= 0);

/**
 * The year-by-year series for the stacked chart. Points come from `slice.years` (n > 0 only,
 * deduplicated, sorted 0..N then 'now'); `grouped` rolls fields up into sectors by adding their
 * published counts, as the Sankey does for all-programs views.
 */
export function yearSeries(slice: RiverSlice, grouped: boolean): YearSeries {
  const seen = new Set<string>();
  const points = (Array.isArray(slice.years) ? slice.years : [])
    .filter((p): p is YearPoint => p != null && isYear(p.year) && p.n > 0 && Array.isArray(p.fields))
    .filter((p) => { const k = String(p.year); if (seen.has(k)) return false; seen.add(k); return true; })
    .sort((a, b) => (a.year === 'now' ? Infinity : a.year) - (b.year === 'now' ? Infinity : b.year));
  const all = new Set<GroupId>();
  const rows: YearRow[] = points.map((p) => {
    const counts: Partial<Record<GroupId, number>> = {};
    const parts: Partial<Record<GroupId, [FamilyId, number][]>> = {};
    let sum = 0;
    for (const [f, v] of p.fields) {
      if (!(v > 0)) continue;
      const g = grouped ? groupOf(f) : (f as GroupId);
      counts[g] = (counts[g] ?? 0) + v;
      sum += v;
      all.add(g);
      if (grouped && isSectorGroup(g)) (parts[g] ??= []).push([f, v]);
    }
    for (const list of Object.values(parts)) list?.sort((a, b) => b[1] - a[1] || compareFamilies(a[0], b[0]));
    return grouped ? { year: p.year, n: p.n, counts, sum, parts } : { year: p.year, n: p.n, counts, sum };
  });
  return { n: slice.n, rows, groups: [...all].sort(compareFamilies) };
}

/** The 'not shown' band's key: people whose field is under the floor at that point. */
export const REST = 'rest';
export type BandKey = GroupId | typeof REST;

export interface StackBand { key: BandKey; y0: number; y1: number }

/**
 * Stack one point as shares of 1, bottom to top: the groups in reverse chart order (so the stack
 * reads top-down like the Sankey columns), then REST, the part of the 100% no published count
 * covers. Every group gets a band (zero-height where unpublished) so areas stay continuous.
 * When nudged counts add up to more than n, the stack is drawn over their sum instead (no REST).
 */
export function stackRow(row: YearRow, groups: GroupId[]): StackBand[] {
  const d = Math.max(row.n, row.sum);
  if (!(d > 0)) return [...[...groups].reverse().map((key) => ({ key, y0: 0, y1: 0 })), { key: REST, y0: 0, y1: 1 }];
  let y = 0;
  const out: StackBand[] = [];
  for (const g of [...groups].reverse()) {
    const v = (row.counts[g] ?? 0) / d;
    out.push({ key: g, y0: y, y1: y + v });
    y += v;
  }
  out.push({ key: REST, y0: Math.min(1, y), y1: 1 });
  return out;
}

/** The point the year-by-year view starts on: year 10 if every member has reached it, else today. */
export function defaultYearIndex(series: YearSeries): number {
  const ten = series.rows.findIndex((r) => r.year === 10 && r.n >= series.n);
  if (ten >= 0) return ten;
  const now = series.rows.findIndex((r) => r.year === 'now');
  return now >= 0 ? now : Math.max(0, series.rows.length - 1);
}

/** Index of the first numeric year that not every member has reached (-1 if none). */
export function firstPartialYear(series: YearSeries): number {
  return series.rows.findIndex((r) => r.year !== 'now' && r.n < series.n);
}

export interface ReadoutRow { group: GroupId; count: number; share: number }

export interface YearReadout {
  year: number | 'now';
  n: number;
  /** Published groups, largest first; share = count / this point's n. */
  rows: ReadoutRow[];
  /** Some of this point's people are in fields under the floor (drawn as the 'not shown' band). */
  rest: boolean;
  /** Not every member has reached this point. */
  fewer: boolean;
  /** Under SMALL_CLASS people: shares can jump a few points. */
  small: boolean;
  /** The nudged counts add up to 2%+ more than n, so the shares do too. */
  over: boolean;
}

export function yearReadout(series: YearSeries, index: number): YearReadout | null {
  const row = series.rows[index];
  if (!row) return null;
  const rows = (Object.entries(row.counts) as [GroupId, number][])
    .filter(([, v]) => v > 0)
    .sort(([a, x], [b, y]) => y - x || compareFamilies(a, b))
    .map(([group, count]) => ({ group, count, share: count / row.n }));
  return {
    year: row.year,
    n: row.n,
    rows,
    rest: row.sum < row.n,
    fewer: row.n < series.n,
    small: row.n < SMALL_CLASS,
    over: row.sum - row.n >= 0.02 * row.n,
  };
}

/** group × point counts for the year-by-year table, in chart order (null = not published). */
export function yearTableRows(series: YearSeries): TableRow[] {
  return series.groups.map((family) => ({
    family,
    cells: series.rows.map((r) => {
      const v = r.counts[family];
      return v != null && v > 0 ? v : null;
    }),
  }));
}
