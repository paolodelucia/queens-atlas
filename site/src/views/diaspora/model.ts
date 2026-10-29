/**
 * Pure logic for the Diaspora view: filter validation and view lookup (with fallbacks), stats,
 * projection and zoom helpers, bubble sizing, label placement, flow-arc geometry and the small
 * rankings shown beside the map. No React, no DOM: everything here is unit-tested.
 *
 * Privacy: every count shown comes straight from diaspora.json (each lightly perturbed by the
 * pipeline, so parts may not add up exactly). Nothing here derives a new count by subtraction;
 * shares are only ever part / whole of published numbers (or of sums of published numbers).
 */
import { geoNaturalEarth1, geoPath } from 'd3';
import type { GeoProjection } from 'd3';
import type { MultiPoint } from 'geojson';
import type {
  AbroadRow, DiasporaCohortId, DiasporaFile, DiasporaView, Floors, LevelId, Metro, NamedCount,
} from '../../data/types';
import { DIASPORA_COHORTS, LEVELS, countryName } from '../../data/taxonomy';
import { fmtPct, oneIn } from '../../lib/format';

// ── Suppression floors ───────────────────────────────────────────────────────

/** meta.json's floors: k.field for counts of people (abroad / US shares), k.named for anything naming a place. */
export const DEFAULT_FLOORS: Floors = { field: 5, named: 10 };

/** The floors from meta.json when it has sane ones, else the defaults. */
export function floorsFrom(meta: unknown): Floors {
  const k = (meta as { k?: Partial<Floors> } | null | undefined)?.k;
  const ok = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v > 0;
  return { field: ok(k?.field) ? k.field : DEFAULT_FLOORS.field, named: ok(k?.named) ? k.named : DEFAULT_FLOORS.named };
}

// ── Filters ──────────────────────────────────────────────────────────────────

export interface Filter { level: LevelId; program: string; cohort: DiasporaCohortId }

export const DEFAULT_FILTER: Filter = { level: 'all', program: 'all', cohort: 'all' };

const LEVEL_IDS = new Set<string>(LEVELS.map((l) => l.id));
const COHORT_IDS = new Set<string>(DIASPORA_COHORTS.map((c) => c.id));

export function parseLevel(raw: string): LevelId | null {
  return LEVEL_IDS.has(raw) ? (raw as LevelId) : null;
}

export function parseCohort(raw: string): DiasporaCohortId | null {
  return COHORT_IDS.has(raw) ? (raw as DiasporaCohortId) : null;
}

export function viewKey(f: Filter): string {
  return `${f.level}|${f.program}|${f.cohort}`;
}

export interface ProgramOption {
  program: string;
  /** People in the program's all-classes view (null when only per-cohort views exist). */
  n: number | null;
  cohorts: DiasporaCohortId[];
}

export interface ViewIndex {
  byKey: Map<string, DiasporaView>;
  programs: Map<LevelId, ProgramOption[]>;
}

const byName = (a: string, b: string) => a.localeCompare(b, 'en', { sensitivity: 'base' });

export function indexViews(views: DiasporaView[]): ViewIndex {
  const byKey = new Map<string, DiasporaView>();
  const progs = new Map<LevelId, Map<string, ProgramOption>>();
  for (const v of views) {
    byKey.set(viewKey(v), v);
    if (v.program === 'all' || v.level === 'all') continue;
    let m = progs.get(v.level);
    if (!m) progs.set(v.level, (m = new Map()));
    let opt = m.get(v.program);
    if (!opt) m.set(v.program, (opt = { program: v.program, n: null, cohorts: [] }));
    opt.cohorts.push(v.cohort);
    if (v.cohort === 'all') opt.n = v.n;
  }
  const programs = new Map<LevelId, ProgramOption[]>();
  for (const [level, m] of progs) programs.set(level, [...m.values()].sort((a, b) => byName(a.program, b.program)));
  return { byKey, programs };
}

/** Programs with at least one view at this level, alphabetical ('all' excluded). */
export function programsForLevel(index: ViewIndex, level: LevelId): ProgramOption[] {
  if (level === 'all') return [];
  return index.programs.get(level) ?? [];
}

/**
 * Clean up a filter read from the URL: level "all" has no programs, and a program that doesn't
 * exist at that level (typo, stale link) falls back to all programs.
 */
export function normalizeFilter(index: ViewIndex, raw: Filter): Filter {
  const level = parseLevel(raw.level) ?? 'all';
  const cohort = parseCohort(raw.cohort) ?? 'all';
  let program = raw.program || 'all';
  if (level === 'all') program = 'all';
  else if (program !== 'all' && !programsForLevel(index, level).some((p) => p.program === program)) program = 'all';
  return { level, program, cohort };
}

export interface Resolution {
  filter: Filter;
  /** The exact view, or null when this combination isn't published. */
  view: DiasporaView | null;
  /** What the map actually draws: the exact view, else the first alternative (never blank if any view exists). */
  shown: { filter: Filter; view: DiasporaView } | null;
  /** One-click alternatives that do exist (only filled when the exact view is missing). */
  alternatives: Filter[];
}

export function resolveView(index: ViewIndex, filter: Filter): Resolution {
  const view = index.byKey.get(viewKey(filter)) ?? null;
  if (view) return { filter, view, shown: { filter, view }, alternatives: [] };

  const candidates: Filter[] = [
    { ...filter, cohort: 'all' },
    { ...filter, program: 'all' },
    { level: 'all', program: 'all', cohort: filter.cohort },
    DEFAULT_FILTER,
  ];
  const seen = new Set<string>([viewKey(filter)]);
  const alternatives: Filter[] = [];
  for (const c of candidates) {
    const key = viewKey(c);
    if (seen.has(key)) continue;
    seen.add(key);
    if (index.byKey.has(key)) alternatives.push(c);
  }
  const first = alternatives[0];
  return {
    filter,
    view: null,
    shown: first ? { filter: first, view: index.byKey.get(viewKey(first))! } : null,
    alternatives,
  };
}

/**
 * First and last graduating year of a class band: '1995-1999' -> [1995, 1999], 'pre-1995' ->
 * [null, 1994]. Null for 'all' and anything unrecognised, so new band ids read sensibly too.
 */
export function cohortYears(c: DiasporaCohortId | string): [number | null, number] | null {
  const pre = /^pre-(\d{4})$/.exec(c);
  if (pre) return [null, Number(pre[1]) - 1];
  const band = /^(\d{4})-(\d{4})$/.exec(c);
  return band ? [Number(band[1]), Number(band[2])] : null;
}

function cohortPhraseOf(c: DiasporaCohortId): string {
  if (c === 'all') return 'all classes';
  const y = cohortYears(c);
  if (!y) return c;
  return y[0] == null ? `classes before ${y[1] + 1}` : `classes of ${y[0]}–${y[1]}`;
}

/** Degree names as the Degree control shows them ("Master’s/PhD", "JD"). */
export const DEGREE_SHORT: Record<LevelId, string> = {
  all: 'All', undergrad: 'Undergrad', graduate: 'Master’s/PhD', mba: 'MBA', law: 'JD', medicine: 'MD',
};

const DEGREE_GROUP: Record<LevelId, string> = {
  all: 'All alumni', undergrad: 'Undergraduates', graduate: 'Master’s & PhD', mba: 'MBA', law: 'JD (law)', medicine: 'MD (medicine)',
};

export function degreeShort(level: LevelId): string {
  return DEGREE_SHORT[level] ?? level;
}

/** "Computer Science (Undergrad), classes of 2016–2020" */
export function filterLabel(f: Filter): string {
  const who = f.level === 'all' ? 'All alumni'
    : f.program === 'all' ? DEGREE_GROUP[f.level] ?? f.level
      : `${f.program} (${degreeShort(f.level)})`;
  return `${who}, ${cohortPhraseOf(f.cohort)}`;
}

const LEVEL_NOUN: Record<LevelId, string> = {
  all: '', undergrad: 'undergraduate', graduate: 'master’s & PhD', mba: 'MBA', law: 'JD', medicine: 'MD',
};

function cohortSuffix(c: DiasporaCohortId): string {
  if (c === 'all') return '';
  const y = cohortYears(c);
  if (!y) return ` (${c})`;
  return y[0] == null ? ` who graduated before ${y[1] + 1}` : ` from the classes of ${y[0]}–${y[1]}`;
}

/**
 * Noun phrase for sentences: "alumni", "undergraduate alumni", "Computer Science alumni (Undergrad)",
 * "MBA alumni from the classes of 2016–2020".
 */
export function whoPhrase(f: Filter): string {
  let who = 'alumni';
  if (f.level !== 'all') {
    if (f.program === 'all') who = `${LEVEL_NOUN[f.level] ?? f.level} alumni`;
    else {
      const short = degreeShort(f.level);
      who = f.program === short ? `${f.program} alumni` : `${f.program} alumni (${short})`;
    }
  }
  return who + cohortSuffix(f.cohort);
}

export function cohortPhrase(c: DiasporaCohortId): string {
  return cohortPhraseOf(c);
}

/** Column labels for a class band: '1995-1999' -> "’95–’99", 'pre-1995' -> "<’95", 'all' -> "All". */
export function cohortShort(c: DiasporaCohortId): string {
  if (c === 'all') return 'All';
  const y = cohortYears(c);
  if (!y) return c;
  const yy = (n: number) => `’${String(n % 100).padStart(2, '0')}`;
  return y[0] == null ? `<${yy(y[1] + 1)}` : `${yy(y[0])}–${yy(y[1])}`;
}

export function sameFilter(a: Filter, b: Filter): boolean {
  return a.level === b.level && a.program === b.program && a.cohort === b.cohort;
}

// ── Rows & stats ─────────────────────────────────────────────────────────────

/**
 * A whole-number share that stays honest at small sizes: "34%", "9%", and "<1%" instead of a
 * misleading "0%". "—" when there's no denominator. (Counts are perturbed, so decimals would be
 * false precision.)
 */
export function shareText(part: number | null | undefined, whole: number | null | undefined): string {
  if (part == null || whole == null || !(whole > 0) || !Number.isFinite(part)) return '—';
  return pctText((100 * part) / whole);
}

/** Same rule for a percentage already computed (null -> "—"). */
export function pctText(p: number | null | undefined): string {
  if (p == null || !Number.isFinite(p)) return '—';
  if (p <= 0) return '0%';
  if (p < 1) return '<1%';
  return `${Math.round(p)}%`;
}

export interface MetroRow { metro: Metro; n: number; share: number }

export function metroIndex(metros: Metro[]): Map<string, Metro> {
  return new Map(metros.map((m) => [m.id, m]));
}

/** View metros joined to their geography; ids missing from `metros` are skipped. Largest first. */
export function metroRows(view: DiasporaView | null, byId: Map<string, Metro>): MetroRow[] {
  if (!view) return [];
  const rows: MetroRow[] = [];
  for (const [id, n] of view.metros) {
    const metro = byId.get(id);
    if (!metro || !(n > 0) || !Number.isFinite(metro.lat) || !Number.isFinite(metro.lon)) continue;
    rows.push({ metro, n, share: view.n > 0 ? n / view.n : 0 });
  }
  return rows.sort((a, b) => b.n - a.n);
}

export interface CountryRow { iso2: string; name: string; n: number; share: number }

export function countryRows(view: DiasporaView | null): CountryRow[] {
  if (!view) return [];
  return view.countries
    .filter(([, n]) => n > 0)
    .map(([iso2, n]) => ({ iso2, name: countryName(iso2), n, share: view.n > 0 ? n / view.n : 0 }))
    .sort((a, b) => b.n - a.n);
}

/** The data spells it "Quebec"; the UI uses "Québec". */
export function frenchQuebec(s: string): string {
  return s.replace(/\bQuebec\b/g, 'Québec');
}

/** "Ontario, Canada"; "England, United Kingdom"; "Hong Kong" (no repeats). */
export function placeName(m: Metro): string {
  const country = countryName(m.country);
  const parts = [m.region, country].filter((p, i, all) => p && p !== m.name && all.indexOf(p) === i);
  return frenchQuebec(parts.join(', '));
}

const PROVINCE_ABBR: Record<string, string> = {
  Ontario: 'Ont.', Quebec: 'Que.', Québec: 'Que.', 'British Columbia': 'B.C.', Alberta: 'Alta.', Manitoba: 'Man.',
  Saskatchewan: 'Sask.', 'Nova Scotia': 'N.S.', 'New Brunswick': 'N.B.', 'Newfoundland and Labrador': 'N.L.',
  'Prince Edward Island': 'P.E.I.', Yukon: 'Y.T.', 'Northwest Territories': 'N.W.T.', Nunavut: 'Nvt.',
};

const STATE_ABBR: Record<string, string> = {
  Alabama: 'Ala.', Arizona: 'Ariz.', Arkansas: 'Ark.', California: 'Calif.', Colorado: 'Colo.', Connecticut: 'Conn.',
  Delaware: 'Del.', Florida: 'Fla.', Georgia: 'Ga.', Illinois: 'Ill.', Indiana: 'Ind.', Kansas: 'Kan.', Kentucky: 'Ky.',
  Louisiana: 'La.', Maryland: 'Md.', Massachusetts: 'Mass.', Michigan: 'Mich.', Minnesota: 'Minn.', Mississippi: 'Miss.',
  Missouri: 'Mo.', Montana: 'Mont.', Nebraska: 'Neb.', Nevada: 'Nev.', 'New Hampshire': 'N.H.', 'New Jersey': 'N.J.',
  'New Mexico': 'N.M.', 'New York': 'N.Y.', 'North Carolina': 'N.C.', 'North Dakota': 'N.D.', Oklahoma: 'Okla.',
  Oregon: 'Ore.', Pennsylvania: 'Pa.', 'Rhode Island': 'R.I.', 'South Carolina': 'S.C.', 'South Dakota': 'S.D.',
  Tennessee: 'Tenn.', Vermont: 'Vt.', Virginia: 'Va.', Washington: 'Wash.', 'West Virginia': 'W.Va.',
  Wisconsin: 'Wis.', Wyoming: 'Wyo.', 'District of Columbia': 'D.C.',
};

const COUNTRY_SHORT: Record<string, string> = { GB: 'UK', US: 'US', AE: 'UAE' };

function qualifier(m: Metro, group: Metro[]): string {
  if (m.country === 'CA') return PROVINCE_ABBR[m.region] ?? frenchQuebec(m.region);
  if (m.country === 'US') return STATE_ABBR[m.region] ?? m.region;
  const sameCountry = group.filter((o) => o.country === m.country).length > 1;
  if (sameCountry && m.region) return m.region;
  return COUNTRY_SHORT[m.country] ?? countryName(m.country);
}

/**
 * Display names that tell same-named places apart: "London, Ont." and "London, UK"; "Sydney, N.S."
 * and "Sydney, Australia". Unique names stay bare. Names that already carry a qualifier (a comma)
 * are kept as the data gives them. Keyed by metro id.
 */
export function qualifiedNames(metros: Metro[]): Map<string, string> {
  const key = (m: Metro) => m.name.trim().toLocaleLowerCase('en');
  const groups = new Map<string, Metro[]>();
  for (const m of metros) {
    const g = groups.get(key(m));
    if (g) g.push(m); else groups.set(key(m), [m]);
  }
  const out = new Map<string, string>();
  for (const m of metros) {
    const g = groups.get(key(m))!;
    const name = frenchQuebec(m.name);
    out.set(m.id, g.length < 2 || m.name.includes(',') ? name : `${name}, ${qualifier(m, g)}`);
  }
  return out;
}

/**
 * The sentence above the map: "87% of alumni live in Canada, 34% in Toronto alone." Shares are
 * published part / published whole for the shown view.
 */
export function mapSummary(view: DiasporaView | null, rows: MetroRow[], who: string, nameOf: (m: Metro) => string): string | null {
  if (!view || !(view.n > 0)) return null;
  const ca = view.countries.find(([c]) => c === 'CA')?.[1];
  const top = rows[0];
  if (ca != null && ca > 0) {
    let s = `${fmtPct(ca, view.n)} of ${who} live in Canada`;
    if (top) {
      s += top.metro.country === 'CA'
        ? `, ${fmtPct(top.n, view.n)} in ${nameOf(top.metro)} alone`
        : `; the biggest single city is ${nameOf(top.metro)}, with ${fmtPct(top.n, view.n)}`;
    }
    return `${s}.`;
  }
  if (top) return `${nameOf(top.metro)} is home to ${fmtPct(top.n, view.n)} of ${who}.`;
  return null;
}

export type AbroadStat =
  | { kind: 'exact'; abroad: number; of: number; us: number | null }
  | { kind: 'atLeast'; abroad: number; of: number }
  /** The published count is under k.field (null in the data). */
  | { kind: 'suppressed'; of: number }
  | { kind: 'unlisted'; of: number }
  | { kind: 'none' };

/** The published abroad row matching a filter exactly, if any. */
export function abroadRowFor(file: Pick<DiasporaFile, 'abroad'>, f: Filter): AbroadRow | null {
  if (f.level === 'all' && f.program === 'all') {
    return file.abroad.byCohort.find((r) => r.cohort === f.cohort) ?? null;
  }
  if (f.program !== 'all' && f.cohort === 'all') {
    return file.abroad.byProgram.find((r) => r.level === f.level && r.program === f.program) ?? null;
  }
  return null;
}

/**
 * Share living outside Canada. Exact when the pipeline published it for this filter; otherwise a
 * lower bound from the listed non-Canadian countries (countries under 10 people are omitted, so
 * the true share can only be higher). Never computed as n - Canada, which could expose a small group.
 */
export function abroadFor(file: Pick<DiasporaFile, 'abroad'>, f: Filter, view: DiasporaView | null): AbroadStat {
  const row = abroadRowFor(file, f);
  if (row && row.n > 0) {
    return row.abroad == null ? { kind: 'suppressed', of: row.n } : { kind: 'exact', abroad: row.abroad, of: row.n, us: row.us };
  }
  if (!view || view.n <= 0) return { kind: 'none' };
  const listed = view.countries.reduce((s, [iso, n]) => (iso !== 'CA' && n > 0 ? s + n : s), 0);
  return listed > 0 ? { kind: 'atLeast', abroad: listed, of: view.n } : { kind: 'unlisted', of: view.n };
}

export interface Stats {
  located: number;
  countries: number;
  abroad: AbroadStat;
  topAbroad: MetroRow | null;
  topMetro: MetroRow | null;
}

export function computeStats(
  file: Pick<DiasporaFile, 'abroad'>, f: Filter, view: DiasporaView | null, rows: MetroRow[],
): Stats {
  return {
    located: view?.n ?? 0,
    countries: view ? view.countries.filter(([, n]) => n > 0).length : 0,
    abroad: abroadFor(file, f, view),
    topAbroad: rows.find((r) => r.metro.country !== 'CA') ?? null,
    topMetro: rows[0] ?? null,
  };
}

// ── "Who leaves Canada" ──────────────────────────────────────────────────────

export interface AbroadCohortRow {
  cohort: DiasporaCohortId; label: string; n: number;
  abroad: number | null; us: number | null;
  abroadPct: number | null; usPct: number | null;
}

const pct = (part: number | null | undefined, whole: number) =>
  part == null || !(whole > 0) ? null : (100 * part) / whole;

/** Rows in class order (oldest first), excluding the all-classes total. */
export function abroadByCohort(rows: AbroadRow[]): AbroadCohortRow[] {
  const order = DIASPORA_COHORTS.filter((c) => c.id !== 'all');
  const out: AbroadCohortRow[] = [];
  for (const c of order) {
    const r = rows.find((x) => x.cohort === c.id);
    if (!r || !(r.n > 0)) continue;
    out.push({ cohort: c.id, label: c.label, n: r.n, abroad: r.abroad, us: r.us, abroadPct: pct(r.abroad, r.n), usPct: pct(r.us, r.n) });
  }
  return out;
}

const COHORT_ORDER = DIASPORA_COHORTS.filter((c) => c.id !== 'all').map((c) => c.id);

/**
 * Heading for "Who leaves Canada", computed so it never overclaims. A single class is named the
 * likeliest to live abroad only when it leads every other class by at least `lead` points.
 * Otherwise it describes the run of neighbouring classes within `band` points of the top one,
 * pooled from published counts ("About 1 in 6 alumni from 1995–2015 live abroad"), and adds
 * "recent grads haven’t left yet" only when the newest class sits `lead`+ points below all others.
 */
export function abroadHeadline(rows: AbroadCohortRow[], opts: { lead?: number; band?: number } = {}): string {
  const { lead = 3, band = 2 } = opts;
  const known = rows
    .filter((r): r is AbroadCohortRow & { abroad: number; abroadPct: number } => r.abroad != null && r.abroadPct != null && r.n > 0)
    .sort((a, b) => COHORT_ORDER.indexOf(a.cohort) - COHORT_ORDER.indexOf(b.cohort));
  if (!known.length) return 'Living outside Canada';
  let pi = 0;
  known.forEach((r, i) => { if (r.abroadPct > known[pi].abroadPct) pi = i; });
  const peak = known[pi];
  const others = known.filter((_, i) => i !== pi);
  if (others.length && others.every((r) => peak.abroadPct - r.abroadPct >= lead)) {
    return `${peak.cohort === 'pre-1995' ? 'Grads from before 1995 are' : `The classes of ${peak.label} are`} the likeliest to live abroad`;
  }
  // Grow a run of adjacent classes (no gaps in the class order) around the peak.
  const adjacent = (a: AbroadCohortRow, b: AbroadCohortRow) => Math.abs(COHORT_ORDER.indexOf(a.cohort) - COHORT_ORDER.indexOf(b.cohort)) === 1;
  let i0 = pi;
  let i1 = pi;
  while (i0 > 0 && adjacent(known[i0 - 1], known[i0]) && peak.abroadPct - known[i0 - 1].abroadPct <= band) i0--;
  while (i1 < known.length - 1 && adjacent(known[i1], known[i1 + 1]) && peak.abroadPct - known[i1 + 1].abroadPct <= band) i1++;
  const run = known.slice(i0, i1 + 1);
  const abroad = run.reduce((s, r) => s + r.abroad, 0);
  const n = run.reduce((s, r) => s + r.n, 0);
  const first = cohortYears(run[0].cohort);
  const last = cohortYears(run[run.length - 1].cohort);
  const span = !first || !last ? 'in these classes'
    : first[0] == null ? `who graduated before ${last[1] + 1}` : `from ${first[0]}–${last[1]}`;
  const ratio = oneIn(abroad, n);
  let s = ratio && n / abroad >= 2 ? `About ${ratio} alumni ${span} live abroad` : `About ${fmtPct(abroad, n)} of alumni ${span} live abroad`;
  const newest = known[known.length - 1];
  if (newest.cohort === COHORT_ORDER[COHORT_ORDER.length - 1] && !run.includes(newest) && known.length > 1
    && known.slice(0, -1).every((r) => r.abroadPct - newest.abroadPct >= lead)) {
    s += '; recent grads haven’t left yet';
  }
  return s;
}

export interface ProgramRank { level: LevelId; program: string; n: number; count: number; pct: number }

/**
 * Programs ranked by share abroad (or in the US). Rows whose count is null (under k.field) are
 * left out rather than ranked as zero; `minN` keeps tiny programs from topping the list on noise.
 */
export function rankPrograms(
  rows: DiasporaFile['abroad']['byProgram'], metric: 'abroad' | 'us', opts: { minN?: number; limit?: number } = {},
): ProgramRank[] {
  const { minN = 200, limit = 10 } = opts;
  const out: ProgramRank[] = [];
  for (const r of rows) {
    const count = r[metric];
    if (count == null || !(r.n >= minN) || !(r.n > 0) || count < 0) continue;
    out.push({ level: r.level, program: r.program, n: r.n, count, pct: (100 * count) / r.n });
  }
  return out.sort((a, b) => b.pct - a.pct || b.n - a.n).slice(0, limit);
}

// ── Kingston: "You got your first job in Kingston. Then what?" ───────────────

export interface KingstonPlace extends NamedCount {
  /** Share of everyone whose first job was in Kingston (null when that total isn't published). */
  pct: number | null;
}

export interface KingstonStory {
  /** Alumni whose first job was in Kingston (null: under the floor or missing). */
  firstJob: number | null;
  /** Of those, how many still live there (null: under the floor or missing). */
  still: number | null;
  /** still / firstJob, only when both are published. */
  stillPct: number | null;
  /** Where the others live now (each >= 10 people), largest first. */
  elsewhere: KingstonPlace[];
}

const positive = (n: number | null | undefined): number | null => (n != null && Number.isFinite(n) && n > 0 ? n : null);

/**
 * The Kingston story from published counts only: the share who stayed is still / firstJob, and
 * each destination's share is its own count / firstJob. Nothing is derived by subtraction (no
 * "left Kingston" count). Null when there is nothing to tell (no stayers and no destinations).
 */
export function kingstonStory(k: DiasporaFile['kingston'] | null | undefined): KingstonStory | null {
  if (!k) return null;
  const firstJob = positive(k.firstJobInKingston);
  const still = positive(k.stillInKingston);
  const pctOf = (n: number) => (firstJob ? (100 * n) / firstJob : null);
  const elsewhere = (k.nowElsewhere ?? [])
    .filter((r) => r && typeof r.name === 'string' && r.name && positive(r.n) != null)
    .sort((a, b) => b.n - a.n)
    .map((r) => ({ name: frenchQuebec(r.name), n: r.n, pct: pctOf(r.n) }));
  if (still == null && !elsewhere.length) return null;
  return { firstJob, still, stillPct: still != null ? pctOf(still) : null, elsewhere };
}

export interface KingstonBand {
  key: string;
  /** 'stay': still in Kingston; 'move': a listed destination; 'rest': the unlisted remainder (drawn only, never counted). */
  kind: 'stay' | 'move' | 'rest';
  label: string;
  /** Published count (null for 'rest': it is never computed). */
  n: number | null;
  pct: number | null;
  /** Where the band leaves the Kingston node (top, bottom). */
  y0: number; y1: number;
  /** Where it arrives (top, bottom): the same thickness as y0..y1. */
  t0: number; t1: number;
  /** Vertical centre of its label slot. */
  mid: number;
}

export interface KingstonLayout {
  height: number;
  /** The Kingston node spans 0..nodeHeight. */
  nodeHeight: number;
  bands: KingstonBand[];
}

/**
 * Geometry for the compact Kingston flow: a node for everyone whose first job was in Kingston,
 * one ribbon per published outcome (stayed, then destinations largest first), thickness
 * proportional to people. The node's height stands for the published total when there is one;
 * the part no listed ribbon covers is drawn as an unlabelled-count "rest" band, so the stayers'
 * ribbon takes the same share of the node as the headline percentage. Without a published total
 * the node is just the listed ribbons stacked. On the right each ribbon gets a label slot at
 * least `minSlot` tall, so thin ribbons still have room for their label.
 */
export function kingstonFlowLayout(
  story: KingstonStory,
  opts: { nodeHeight?: number; minSlot?: number; gap?: number; maxBands?: number } = {},
): KingstonLayout {
  const { nodeHeight = 150, minSlot = 20, gap = 6, maxBands = 7 } = opts;
  const parts: Omit<KingstonBand, 'y0' | 'y1' | 't0' | 't1' | 'mid'>[] = [];
  if (story.still != null) parts.push({ key: 'stay', kind: 'stay', label: 'Still in Kingston', n: story.still, pct: story.stillPct });
  for (const p of story.elsewhere) {
    if (parts.length >= maxBands) break;
    parts.push({ key: `to:${p.name}`, kind: 'move', label: p.name, n: p.n, pct: p.pct });
  }
  const listed = parts.reduce((s, p) => s + (p.n ?? 0), 0);
  const scaleTo = Math.max(story.firstJob ?? 0, listed);
  if (!(scaleTo > 0)) return { height: 0, nodeHeight: 0, bands: [] };
  const s = nodeHeight / scaleTo;

  const bands: KingstonBand[] = [];
  let left = 0;
  let right = 0;
  const place = (p: (typeof parts)[number], thick: number) => {
    const slot = Math.max(minSlot, thick);
    const t0 = right + (slot - thick) / 2;
    bands.push({ ...p, y0: left, y1: left + thick, t0, t1: t0 + thick, mid: right + slot / 2 });
    left += thick;
    right += slot + gap;
  };
  for (const p of parts) place(p, (p.n ?? 0) * s);
  // Whatever the listed ribbons leave of the node: drawn so the node keeps its true size, never counted.
  if (story.firstJob != null && nodeHeight - left > 0.5) {
    place({ key: 'rest', kind: 'rest', label: 'Other places', n: null, pct: null }, nodeHeight - left);
  }
  return { height: Math.max(nodeHeight, right - gap), nodeHeight, bands };
}

/** A ribbon from the node's right edge (x0) to a destination (x1): a band with eased edges. */
export function ribbonPath(x0: number, x1: number, b: Pick<KingstonBand, 'y0' | 'y1' | 't0' | 't1'>): string {
  const xm = (x0 + x1) / 2;
  const f = (v: number) => r2(v);
  return `M${f(x0)},${f(b.y0)}C${f(xm)},${f(b.y0)} ${f(xm)},${f(b.t0)} ${f(x1)},${f(b.t0)}`
    + `L${f(x1)},${f(b.t1)}C${f(xm)},${f(b.t1)} ${f(xm)},${f(b.y1)} ${f(x0)},${f(b.y1)}Z`;
}

/**
 * Supports the sticker "the 401 runs mostly one way": Toronto is where most Kingston starters who
 * moved went, and the published Kingston → Toronto move is at least twice the reverse (a reverse
 * move under the floor counts as none). False whenever the moves data can't back it up.
 */
export function oneWayToToronto(story: KingstonStory | null, arcs: FlowArc[]): boolean {
  const top = story?.elsewhere[0];
  if (!top || top.name !== 'Toronto') return false;
  const isCA = (m: Metro, name: string) => m.country === 'CA' && m.name === name;
  const there = arcs.find((a) => isCA(a.from, 'Kingston') && isCA(a.to, 'Toronto'));
  if (!there) return false;
  const back = arcs.find((a) => isCA(a.from, 'Toronto') && isCA(a.to, 'Kingston'))?.n ?? 0;
  return there.n >= 2 * back;
}

// ── Places by country side ───────────────────────────────────────────────────

/** Metro rows split into Canada and everywhere else, each still largest first. */
export function splitPlaces(rows: MetroRow[]): { canada: MetroRow[]; abroad: MetroRow[] } {
  return { canada: rows.filter((r) => r.metro.country === 'CA'), abroad: rows.filter((r) => r.metro.country !== 'CA') };
}

/** Share of the shown view living in Canada: the published CA count over the view's n (null if absent). */
export function canadaShare(view: DiasporaView | null): number | null {
  const ca = view?.countries.find(([c]) => c === 'CA')?.[1];
  return ca != null && ca > 0 && view && view.n > 0 ? (100 * ca) / view.n : null;
}

// ── Flows ────────────────────────────────────────────────────────────────────

export interface FlowArc { key: string; from: Metro; to: Metro; n: number }

/** Flows joined to metros. Unknown ids, self-loops and non-positive counts are dropped. Largest first. */
export function resolveFlows(flows: DiasporaFile['flows'], byId: Map<string, Metro>): FlowArc[] {
  const out: FlowArc[] = [];
  for (const f of flows ?? []) {
    const from = byId.get(f.from);
    const to = byId.get(f.to);
    if (!from || !to || from.id === to.id || !(f.n > 0)) continue;
    out.push({ key: `${from.id}>${to.id}`, from, to, n: f.n });
  }
  return out.sort((a, b) => b.n - a.n);
}

/** Moves touching one metro: where its first-jobbers went, and where its residents started. */
export function flowsFor(arcs: FlowArc[], metroId: string): { out: FlowArc[]; in: FlowArc[] } {
  return {
    out: arcs.filter((a) => a.from.id === metroId),
    in: arcs.filter((a) => a.to.id === metroId),
  };
}

/** Stroke width is linear in people (a width is a length), with a floor so 10 people stay visible. */
export function flowWidth(n: number, max: number, maxWidth = 10, minWidth = 1.25): number {
  if (!(max > 0) || !(n > 0)) return minWidth;
  return Math.max(minWidth, (maxWidth * n) / max);
}

// ── Projection & zoom ────────────────────────────────────────────────────────

export interface Pt { x: number; y: number }
export interface Transform { k: number; x: number; y: number }
export const IDENTITY: Transform = { k: 1, x: 0, y: 0 };
export const MAX_K = 40;

/** Latitudes kept on screen: Antarctica and the polar cap carry no alumni. */
export const FRAME_LAT: [number, number] = [-56, 83.5];

const FRAME: MultiPoint = (() => {
  const coords: [number, number][] = [];
  const edge = 179.999;
  for (let lon = -180; lon <= 180; lon += 5) {
    const l = Math.max(-edge, Math.min(edge, lon));
    coords.push([l, FRAME_LAT[1]], [l, FRAME_LAT[0]]);
  }
  for (let lat = FRAME_LAT[0]; lat <= FRAME_LAT[1]; lat += 1) coords.push([-edge, lat], [edge, lat]);
  return { type: 'MultiPoint', coordinates: coords };
})();

/** World aspect (height / width) of the framed Natural Earth projection. */
export const WORLD_ASPECT = 0.4308;

/**
 * Map height for a width. The map opens on a region (North America, Ontario & Québec), not the
 * whole world, so the box is taller than the world's own aspect: the world sits centred in it at
 * zoom 1 and region presets fill it. Phones get a squarer box so the map isn't a thin strip.
 */
export function mapHeightFor(width: number): number {
  const natural = Math.round(width * WORLD_ASPECT);
  const ratio = width < 600 ? 0.76 : 0.66;
  return Math.max(natural, Math.min(580, Math.round(width * ratio)));
}

export interface MapFrame { projection: GeoProjection; width: number; height: number }

/** Natural Earth (rotation 0, so every alumni metro from Whitehorse to Auckland sits inside the frame). */
export function makeFrame(width: number, height = mapHeightFor(width)): MapFrame {
  const w = Math.max(1, width);
  const projection = geoNaturalEarth1().precision(0.2).fitWidth(w, FRAME);
  const [[, y0], [, y1]] = geoPath(projection).bounds(FRAME);
  const natural = y1 - y0;
  const [tx, ty] = projection.translate();
  projection.translate([tx, ty + Math.max(0, (height - natural) / 2)]);
  return { projection, width: w, height: Math.max(height, Math.round(natural)) };
}

export function project(frame: MapFrame, lon: number, lat: number): Pt | null {
  const p = frame.projection([lon, lat]);
  return p && Number.isFinite(p[0]) && Number.isFinite(p[1]) ? { x: p[0], y: p[1] } : null;
}

/** Keep the map covering the viewport (d3-zoom doesn't constrain programmatic transforms). */
export function clampTransform(t: Transform, width: number, height: number, maxK = MAX_K): Transform {
  const k = Math.min(maxK, Math.max(1, t.k));
  const x = Math.min(0, Math.max(width - width * k, t.x));
  const y = Math.min(0, Math.max(height - height * k, t.y));
  return { k, x, y };
}

export function applyTransform(t: Transform, p: Pt): Pt {
  return { x: p.x * t.k + t.x, y: p.y * t.k + t.y };
}

/** Transform that fits base-coordinate points into the viewport. */
export function fitPoints(
  points: Pt[], width: number, height: number,
  opts: { pad?: number; /** Smallest box to fit, as a fraction of the width. */ minSpan?: number; maxK?: number } = {},
): Transform {
  // minSpan is a fraction of the width so a single point (or a tiny country) zooms the same on any screen.
  const { pad = 24, maxK = MAX_K } = opts;
  const minSpan = (opts.minSpan ?? 0.03) * width;
  const pts = points.filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y));
  if (!pts.length) return IDENTITY;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const p of pts) {
    x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x);
    y0 = Math.min(y0, p.y); y1 = Math.max(y1, p.y);
  }
  const dx = Math.max(x1 - x0, minSpan);
  const dy = Math.max(y1 - y0, minSpan * (height / width));
  const k = Math.min(maxK, Math.max(1, Math.min((width - 2 * pad) / dx, (height - 2 * pad) / dy)));
  const cx = (x0 + x1) / 2;
  const cy = (y0 + y1) / 2;
  return clampTransform({ k, x: width / 2 - k * cx, y: height / 2 - k * cy }, width, height, maxK);
}

export type RegionId = 'world' | 'north-america' | 'ontario-quebec' | 'europe';

export interface Region { id: RegionId; label: string; bounds: [[number, number], [number, number]] | null }

export const REGIONS: Region[] = [
  { id: 'world', label: 'World', bounds: null },
  { id: 'north-america', label: 'North America', bounds: [[-128, 24], [-58, 58]] },
  { id: 'ontario-quebec', label: 'Ontario & Québec', bounds: [[-83.4, 41.9], [-71, 46.9]] },
  { id: 'europe', label: 'Europe', bounds: [[-11, 36], [30, 60]] },
];

export function regionTransform(frame: MapFrame, regionId: RegionId): Transform {
  const region = REGIONS.find((r) => r.id === regionId);
  if (!region?.bounds) return IDENTITY;
  const [[lon0, lat0], [lon1, lat1]] = region.bounds;
  const pts: Pt[] = [];
  // Sample the edges: Natural Earth bends meridians, so corners alone undershoot.
  for (let i = 0; i <= 8; i++) {
    const lon = lon0 + ((lon1 - lon0) * i) / 8;
    const lat = lat0 + ((lat1 - lat0) * i) / 8;
    for (const p of [project(frame, lon, lat0), project(frame, lon, lat1), project(frame, lon0, lat), project(frame, lon1, lat)]) {
      if (p) pts.push(p);
    }
  }
  return fitPoints(pts, frame.width, frame.height, { pad: 16, minSpan: 0 });
}

/** Centre a base point at zoom k. */
export function centerOn(p: Pt, k: number, width: number, height: number): Transform {
  return clampTransform({ k, x: width / 2 - k * p.x, y: height / 2 - k * p.y }, width, height);
}

/** Is a point inside a preset region's lon/lat box? (World contains everything.) */
export function inRegion(lon: number, lat: number, id: RegionId): boolean {
  const b = REGIONS.find((r) => r.id === id)?.bounds;
  if (!b) return id === 'world';
  return lon >= b[0][0] && lon <= b[1][0] && lat >= b[0][1] && lat <= b[1][1];
}

/** The tightest preset that contains a point (Ontario & Québec, Europe, North America, else World). */
export function smallestRegion(lon: number, lat: number): RegionId {
  for (const id of ['ontario-quebec', 'europe', 'north-america'] as RegionId[]) if (inRegion(lon, lat, id)) return id;
  return 'world';
}

/** Where the map frames itself: a preset region, or the bounds of some places ([lon, lat]). */
export type MapTarget =
  | { kind: 'region'; id: RegionId }
  | { kind: 'fit'; points: [number, number][] };

/** The opening view when nothing more specific applies: most alumni live here. */
export const DEFAULT_REGION: RegionId = 'north-america';

/**
 * The view that tells the current filter's story. Moves are mostly an Ontario & Québec story;
 * a filter whose places all sit in one country is fitted to them (two Ontario bubbles shouldn't
 * float on a whole continent); everything else opens on North America.
 */
export function autoTarget(rows: MetroRow[], opts: { moves?: boolean } = {}): MapTarget {
  if (opts.moves) return { kind: 'region', id: 'ontario-quebec' };
  if (rows.length > 0 && rows.every((r) => r.metro.country === rows[0].metro.country)) {
    return { kind: 'fit', points: rows.map((r) => [r.metro.lon, r.metro.lat]) };
  }
  return { kind: 'region', id: DEFAULT_REGION };
}

/**
 * Adjust the opening view for a metro selected from the URL: one in Ontario & Québec opens that
 * region (Kingston and Ottawa sit under Toronto's bubble at continent scale); one outside the
 * target opens the tightest preset that contains it.
 */
export function targetWithSelection(target: MapTarget, sel: { lon: number; lat: number } | null): MapTarget {
  if (!sel) return target;
  if (inRegion(sel.lon, sel.lat, 'ontario-quebec')) return { kind: 'region', id: 'ontario-quebec' };
  if (target.kind === 'fit') return { kind: 'fit', points: [...target.points, [sel.lon, sel.lat]] };
  if (inRegion(sel.lon, sel.lat, target.id)) return target;
  return { kind: 'region', id: smallestRegion(sel.lon, sel.lat) };
}

/** The transform for a target in a frame. Fits keep some context (minSpan) and room for bubbles. */
export function targetTransform(frame: MapFrame, target: MapTarget): Transform {
  if (target.kind === 'region') return regionTransform(frame, target.id);
  const pts = target.points.map(([lon, lat]) => project(frame, lon, lat)).filter((p): p is Pt => !!p);
  return fitPoints(pts, frame.width, frame.height, { pad: Math.max(28, Math.min(64, frame.width * 0.07)), minSpan: 0.035, maxK: 14 });
}

/**
 * Keep the same place in the middle of the map across a resize: un-project the old centre and
 * centre it again in the new frame at the same zoom (the projection scales with the width, so k
 * keeps meaning "this much of the world").
 */
export function carryTransform(prev: MapFrame, t: Transform, next: MapFrame): Transform {
  const cx = (prev.width / 2 - t.x) / t.k;
  const cy = (prev.height / 2 - t.y) / t.k;
  const ll = prev.projection.invert?.([cx, cy]);
  const p = ll && Number.isFinite(ll[0]) && Number.isFinite(ll[1]) ? project(next, ll[0], ll[1]) : null;
  if (!p) {
    const s = prev.width > 0 ? next.width / prev.width : 1;
    return clampTransform({ k: t.k, x: t.x * s, y: t.y * s }, next.width, next.height);
  }
  return centerOn(p, t.k, next.width, next.height);
}

// ── Bubbles ──────────────────────────────────────────────────────────────────

export const MIN_R = 1.6;

export function maxRadiusFor(width: number): number {
  return Math.min(34, Math.max(11, width * 0.034));
}

/** sqrt scale: bubble AREA is proportional to people. Tiny metros get a visible floor. */
export function radiusScale(max: number, width: number): (n: number) => number {
  const rMax = maxRadiusFor(width);
  return (n: number) => (max > 0 && n > 0 ? Math.max(MIN_R, rMax * Math.sqrt(n / max)) : MIN_R);
}

/** Bubbles grow a little as you zoom in (so small towns become hittable) but far slower than the map. */
export function zoomRadiusFactor(k: number): number {
  return Math.min(1.6, Math.max(1, k) ** 0.15);
}

function niceFloor(v: number): number {
  if (!(v >= 10)) return 10;
  const p = 10 ** Math.floor(Math.log10(v));
  for (const m of [5, 2, 1]) if (m * p <= v) return m * p;
  return p;
}

/** Up to three round values for the size legend, largest first, all >= 10 and <= max. */
export function sizeLegendValues(max: number): number[] {
  if (!(max >= 10)) return [];
  const vals = [niceFloor(max), niceFloor(max / 8), niceFloor(max / 60)].filter((v) => v >= 10 && v <= max);
  return [...new Set(vals)].sort((a, b) => b - a);
}

/** Side-by-side legend circles, bottom-aligned, each with room for a label underneath. */
export function sizeLegendLayout(items: { v: number; r: number }[], gap = 10, minHalf = 12) {
  const maxR = Math.max(4, ...items.map((i) => i.r));
  const out: { v: number; r: number; cx: number; cy: number }[] = [];
  let x = 1;
  for (const { v, r } of items) {
    const half = Math.max(r, minHalf);
    out.push({ v, r, cx: x + half, cy: 1 + maxR * 2 - r });
    x += half * 2 + gap;
  }
  return { items: out, width: Math.max(1, x - gap + 1), height: maxR * 2 + 16 };
}

/** Hit test: among bubbles whose (generous) hit circle contains the pointer, the nearest centre wins. */
export function pickNearest<T extends { x: number; y: number; r: number }>(
  points: T[], px: number, py: number, opts: { minHit?: number; pad?: number } = {},
): T | null {
  const { minHit = 12, pad = 4 } = opts;
  let best: T | null = null;
  let bestD = Infinity;
  for (const p of points) {
    const d = Math.hypot(p.x - px, p.y - py);
    if (d <= Math.max(p.r + pad, minHit) && d < bestD) {
      best = p;
      bestD = d;
    }
  }
  return best;
}

// ── Labels ───────────────────────────────────────────────────────────────────

export interface Box { x0: number; y0: number; x1: number; y1: number }
export interface Circle { id: string; x: number; y: number; r: number }

export interface LabelCandidate {
  id: string; x: number; y: number; r: number;
  width: number; height: number;
  priority: number;
  /** Always placed (the top places, the selected metro), further out or overlapping if need be. */
  force?: boolean;
}

export type Anchor = 'start' | 'middle' | 'end';
export interface PlacedLabel {
  id: string; x: number; y: number; anchor: Anchor; box: Box;
  /** Present when the label sits away from its bubble: a line from the bubble's edge to the label. */
  leader?: { x1: number; y1: number; x2: number; y2: number };
}

/** Rough rendered width of a string in Inter at `size` px (no DOM needed; errs slightly wide). */
export function estimateTextWidth(text: string, size: number): number {
  let w = 0;
  for (const ch of text) {
    if (/[ilj.,'’·:;|!]/.test(ch)) w += 0.3;
    else if (/[mwMW]/.test(ch)) w += 0.86;
    else if (/[A-Z]/.test(ch)) w += 0.68;
    else if (/[0-9]/.test(ch)) w += 0.6;
    else if (ch === ' ') w += 0.28;
    else w += 0.56;
  }
  return w * size + 2;
}

const overlaps = (a: Box, b: Box, pad = 0) =>
  a.x0 < b.x1 + pad && a.x1 + pad > b.x0 && a.y0 < b.y1 + pad && a.y1 + pad > b.y0;

const circleHitsBox = (c: Circle, b: Box) => {
  const nx = Math.max(b.x0, Math.min(c.x, b.x1));
  const ny = Math.max(b.y0, Math.min(c.y, b.y1));
  return Math.hypot(c.x - nx, c.y - ny) < c.r;
};

/**
 * Greedy label placement: forced labels first, then highest priority. Each tries right / left /
 * the diagonals / above / below its bubble and takes the first slot that stays inside the frame
 * and clears every placed label and every other bubble listed in `obstacles`. Labels that fit
 * nowhere are dropped (the tooltip and table still carry them).
 *
 * Forced labels (the top places and the selected one) never give up: they next try rings further
 * out, joined to their bubble by a leader line; then slots over other bubbles (the text has a
 * halo) as long as they clear other labels; and only then overlap. Text is anchored at its
 * vertical centre (dominant-baseline: central).
 */
export function placeLabels(
  candidates: LabelCandidate[],
  opts: { width: number; height: number; obstacles?: Circle[]; gap?: number; margin?: number; max?: number },
): PlacedLabel[] {
  const { width, height, obstacles = [], gap = 3, margin = 2, max = Infinity } = opts;
  const order = candidates
    .filter((c) => Number.isFinite(c.x) && Number.isFinite(c.y))
    .sort((a, b) => Number(!!b.force) - Number(!!a.force) || b.priority - a.priority);
  const placed: PlacedLabel[] = [];

  for (const c of order) {
    if (placed.length >= max && !c.force) break;
    const w = c.width;
    const h = c.height;
    const at = (anchor: Anchor, x: number, y: number, ring: number): PlacedLabel => {
      const x0 = anchor === 'start' ? x : anchor === 'end' ? x - w : x - w / 2;
      const box = { x0, y0: y - h / 2, x1: x0 + w, y1: y + h / 2 };
      if (!ring) return { id: c.id, anchor, x, y, box };
      // Leader: from the bubble's edge towards the nearest point of the label box.
      const nx = Math.max(box.x0, Math.min(c.x, box.x1));
      const ny = Math.max(box.y0, Math.min(c.y, box.y1));
      const len = Math.hypot(nx - c.x, ny - c.y) || 1;
      const leader = { x1: c.x + ((nx - c.x) / len) * c.r, y1: c.y + ((ny - c.y) / len) * c.r, x2: nx, y2: ny };
      return { id: c.id, anchor, x, y, box, leader };
    };
    // Right, left, the four diagonals, then above / below; ring > 0 pushes them further out.
    const ringSlots = (ring: number): PlacedLabel[] => {
      const R = c.r + ring * (h + 4);
      const d = R * Math.SQRT1_2 + gap * 0.5;
      return [
        at('start', c.x + R + gap, c.y, ring),
        at('end', c.x - R - gap, c.y, ring),
        at('start', c.x + d, c.y - d - h / 2 + 2, ring),
        at('start', c.x + d, c.y + d + h / 2 - 2, ring),
        at('end', c.x - d, c.y - d - h / 2 + 2, ring),
        at('end', c.x - d, c.y + d + h / 2 - 2, ring),
        at('middle', c.x, c.y - R - gap - h / 2, ring),
        at('middle', c.x, c.y + R + gap + h / 2, ring),
      ];
    };
    const inFrame = (b: Box) => b.x0 >= margin && b.y0 >= margin && b.x1 <= width - margin && b.y1 <= height - margin;
    const clearOfLabels = (b: Box) => !placed.some((p) => overlaps(p.box, b, 2));
    const clearOfBubbles = (b: Box) => !obstacles.some((o) => o.id !== c.id && circleHitsBox(o, b));
    const near = ringSlots(0);
    let pick = near.find((s) => inFrame(s.box) && clearOfLabels(s.box) && clearOfBubbles(s.box));
    if (!pick && c.force) {
      const far = [1, 2, 3].flatMap(ringSlots);
      pick = far.find((s) => inFrame(s.box) && clearOfLabels(s.box) && clearOfBubbles(s.box))
        ?? [...near, ...far].find((s) => inFrame(s.box) && clearOfLabels(s.box))
        ?? near.find((s) => inFrame(s.box))
        ?? near[0];
    }
    if (pick) placed.push(pick);
  }
  return placed;
}

/** How many of the largest places are always labelled when on screen. */
export const ALWAYS_LABEL = 5;

export interface LabelBubble { id: string; x: number; y: number; r: number; n: number; text: string }

/**
 * Which bubbles get a label at the current zoom: the top {@link ALWAYS_LABEL} places and the
 * selected one are forced (so Kingston and Ottawa stay named next to Toronto's big bubble); the
 * rest are labelled largest first while they fit, with a size threshold that falls as you zoom in.
 * `bubbles` are in screen space, largest first.
 */
export function mapLabels(
  bubbles: LabelBubble[],
  opts: { width: number; height: number; k: number; selectedId?: string | null; fontSize?: number; max?: number },
): PlacedLabel[] {
  const { width, height, k, selectedId = null, fontSize = 12, max = 45 } = opts;
  const maxN = bubbles.reduce((m, b) => Math.max(m, b.n), 0);
  const threshold = (maxN * 0.012) / Math.max(1, k) ** 1.4;
  const onScreen = (b: LabelBubble) => b.x > -20 && b.x < width + 20 && b.y > -20 && b.y < height + 20;
  const top = new Set([...bubbles].sort((a, b) => b.n - a.n).slice(0, ALWAYS_LABEL).map((b) => b.id));
  const cands: LabelCandidate[] = [];
  for (const b of bubbles) {
    const visible = onScreen(b);
    const force = visible && (b.id === selectedId || top.has(b.id));
    if (!force && (b.n < threshold || !visible)) continue;
    cands.push({ id: b.id, x: b.x, y: b.y, r: b.r, width: estimateTextWidth(b.text, fontSize), height: fontSize + 3, priority: b.n, force });
  }
  const obstacles: Circle[] = bubbles.filter((b) => b.r >= 5 && onScreen(b)).map((b) => ({ id: b.id, x: b.x, y: b.y, r: b.r + 1 }));
  return placeLabels(cands, { width, height, obstacles, max });
}

// ── Arc geometry ─────────────────────────────────────────────────────────────

/**
 * Control point for a flow arc, in base (unzoomed) map coordinates. Arcs bend to the right of the
 * direction of travel (so A→B and B→A separate), with the bulge capped and the control point kept
 * inside the frame. Because arcs are drawn in projected screen space, never as great circles, a
 * Vancouver→Sydney arc can't be cut at the antimeridian and wrap around the map.
 */
export function arcControl(p0: Pt, p1: Pt, frame: { width: number; height: number }, bend = 0.2, maxOffset = 140): Pt {
  const dx = p1.x - p0.x;
  const dy = p1.y - p0.y;
  const dist = Math.hypot(dx, dy);
  const mx = (p0.x + p1.x) / 2;
  const my = (p0.y + p1.y) / 2;
  if (dist < 1e-9) return { x: mx, y: my };
  const off = Math.min(dist * bend, maxOffset);
  // Right-hand normal in screen coordinates (y points down).
  const nx = -dy / dist;
  const ny = dx / dist;
  return {
    x: Math.max(0, Math.min(frame.width, mx + nx * off)),
    y: Math.max(0, Math.min(frame.height, my + ny * off)),
  };
}

const lerp = (a: Pt, b: Pt, t: number): Pt => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });

/** Point on a quadratic Bézier. */
export function quadAt(p0: Pt, c: Pt, p1: Pt, t: number): Pt {
  return lerp(lerp(p0, c, t), lerp(c, p1, t), t);
}

const r2 = (v: number) => Math.round(v * 100) / 100;

export interface ArcPath { d: string; start: Pt; end: Pt; control: Pt; mid: Pt }

/**
 * Screen-space path for one arc, trimmed so it starts/ends at the bubble edges (the arrowhead
 * then sits outside the destination bubble). Returns null for degenerate arcs.
 */
export function arcPath(p0: Pt, c: Pt, p1: Pt, trimStart = 0, trimEnd = 0): ArcPath | null {
  const chord = Math.hypot(p1.x - p0.x, p1.y - p0.y);
  if (!(chord > 0.5)) return null;
  const len = (chord + Math.hypot(c.x - p0.x, c.y - p0.y) + Math.hypot(p1.x - c.x, p1.y - c.y)) / 2;
  const t0 = Math.min(0.4, Math.max(0, trimStart / len));
  const t1 = Math.max(0.6, Math.min(1, 1 - trimEnd / len));
  // Blossoming: the sub-curve on [t0, t1] has control b(t0, t1).
  const blossom = (u: number, v: number): Pt => ({
    x: (1 - u) * (1 - v) * p0.x + ((1 - u) * v + u * (1 - v)) * c.x + u * v * p1.x,
    y: (1 - u) * (1 - v) * p0.y + ((1 - u) * v + u * (1 - v)) * c.y + u * v * p1.y,
  });
  const start = blossom(t0, t0);
  const control = blossom(t0, t1);
  const end = blossom(t1, t1);
  return {
    d: `M${r2(start.x)},${r2(start.y)}Q${r2(control.x)},${r2(control.y)} ${r2(end.x)},${r2(end.y)}`,
    start, end, control,
    mid: quadAt(start, control, end, 0.5),
  };
}
