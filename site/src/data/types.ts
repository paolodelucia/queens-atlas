/**
 * Data contract for everything under public/data/. These files are produced by the Python
 * pipeline (pipeline/07_export_river.py, pipeline/08_export_site.py) and are the ONLY data
 * the site ever sees. Two suppression floors (`Floors`, pipeline/sdc.py):
 *   - k.field (5): counts of people by career field or state: River totals, links and years,
 *     Twin years, seniority, pivoted, managerBy, located/abroad/us, group and program sizes,
 *     ranking hits, the Diaspora abroad/US shares.
 *   - k.named (10): counts behind a named organisation, job title or place: employer and
 *     title lists (River details, Twin employers/titles/topMetros), everything on the Diaspora
 *     map (metros, countries, metro profiles, moves, Kingston), the Insights employer lists.
 * Anything under its floor is absent (lists) or null (scalars), never zero-filled.
 *
 * Every published count also carries a small deterministic perturbation (cell-key method,
 * pipeline/sdc.py): at most 2 people either way, never below its floor, and the same people
 * always get the same number in every file. So parts need not add up exactly to their totals
 * (a River stage's families vs n, a view's metros vs its n, a year's fields vs its n). Each
 * single part is capped at its published total (a year's family at that year's n, a year's n
 * at the slice/group n, abroad at located, a metro at its view's n, a ranking's hits at n),
 * and River links always fit inside their nodes.
 */

/** Career families (see taxonomy.ts for labels/colours). */
export type FamilyId =
  | 'tech' | 'engineering' | 'research_academia' | 'teaching' | 'healthcare'
  | 'finance_accounting' | 'consulting' | 'sales_marketing' | 'operations_management'
  | 'law' | 'government_policy' | 'nonprofit_community' | 'arts_media' | 'founder'
  | 'service_trades' | 'other'
  /** Not jobs: states a person can be in at a stage. */
  | 'further_study' | 'no_role_listed'
  /** Export-time bucket: families under k.field at that stage or year, folded together. */
  | 'smaller_groups';

/** Degree-level groups. 'all' = every level (each person counted once). */
export type LevelId = 'all' | 'undergrad' | 'graduate' | 'mba' | 'law' | 'medicine';

/** Graduating-class cohorts used by River and Twin: five-year bands; 'all' = 1995-2024. */
export type CohortId =
  | '1995-1999' | '2000-2004' | '2005-2009' | '2010-2014' | '2015-2019' | '2020-2024' | 'all';

/**
 * Sankey columns: first destination, the June 3 / 5 / 10 / 20 years after graduating, and today
 * (the Sept 2025 snapshot). A River slice has only the years EVERY member has reached
 * (RiverSlice.stages). 'y5' / 'y10' are the former 's5' / 's10', under the same rule.
 */
export type StageId = 's0' | 'y3' | 'y5' | 'y10' | 'y20' | 'now';

/**
 * One point of a career trajectory (RiverSlice.years, TwinGroup.years).
 *   year    0 = first destination (the 's0' rule); N = what members were doing in June of
 *           grad_year + N (the Sankey years' rule); 'now' = the snapshot.
 *   n       members who have reached that point: the denominator for `fields`. In a five-year
 *           band the later classes haven't reached the later years yet, so n shrinks as year
 *           grows and late years describe the earlier classes only. A point is listed once at
 *           least min_year members have reached it (decided on the true count). n <= the
 *           slice's / group's n.
 *   fields  [family, people], largest first, each >= k.field and <= n. Families under k.field
 *           at that point are folded into 'smaller_groups' (listed only if it reaches k.field
 *           itself). Includes 'further_study' and 'no_role_listed'. Share = people / n of the
 *           SAME point, never of the slice.
 * Points come in order 0, 1, 2, ... then 'now'; a year that too few members have reached is
 * absent. River slices may have any year 0..20; Twin groups only 0, 1, 2, 3, 5, 7, 10, 15, 20.
 */
export interface YearPoint {
  year: number | 'now';
  n: number;
  fields: [FamilyId, number][];
}

/** Suppression floors (see the header): { field: 5, named: 10 }. */
export interface Floors { field: number; named: number }

/** Seniority from the title labeller. */
export type SeniorityId =
  | 'intern' | 'entry' | 'mid' | 'senior' | 'manager' | 'director' | 'vp' | 'executive' | 'unknown';

export interface NamedCount { name: string; n: number }

// ── meta.json ────────────────────────────────────────────────────────────────

export interface Meta {
  generated: string;          // ISO date the export ran
  snapshot: string;           // "2025-09"
  k: Floors;                  // suppression floors
  counts: {
    profiles: number;         // LinkedIn profiles in the scrape
    alumni: number;           // profiles with a Queen's education entry
    roles: number;            // job entries
    employers: number;        // distinct employers (parent-level) with >= k.named alumni
    countries: number;        // countries with >= k.named alumni living there now
    metros: number;           // metro areas with >= k.named alumni living there now
    paths: number;            // credentials with a career path (River/Twin population)
    firstYear: number;        // earliest graduating class in River/Twin
    lastYear: number;
  };
  /** Programs with a career-twin group (>= 30 people, 1995-2024), largest first. River and Diaspora
   *  only publish programs with >= 50 people, so a few listed here have no River slice. */
  programs: ProgramInfo[];
  /** The five-year River/Twin cohorts, oldest first, then 'all' ("Classes of 1995–2024"). */
  cohorts: { id: CohortId; label: string; from: number; to: number }[];
}

export interface ProgramInfo {
  level: Exclude<LevelId, 'all'>;
  program: string;            // canonical program name, e.g. "Commerce"
  discipline: string;         // broad discipline id, e.g. "business_commerce"
  n: number;                  // people with a career path in this program (1995-2024)
  /** The River has at least one slice for it (needs 50+ people). Absent in old files: assume true. */
  river?: boolean;
}

// ── river.json ───────────────────────────────────────────────────────────────

export interface RiverFile {
  meta: {
    generated: string; snapshot: string;
    k: Floors;
    min_slice: number;        // a slice needs this many people (50, true size)
    min_year: number;         // a YearPoint needs this many members to have reached it (10)
    /** A label for every StageId: "First destination", "Year 3", ..., "Today (Sept 2025)". */
    stages: Record<StageId, string>;
    note: string;
  };
  slices: RiverSlice[];
}

export interface RiverSlice {
  level: LevelId;
  program: string;            // canonical name, or "all"
  cohort: CohortId;
  n: number;                  // people in this slice
  /**
   * Sankey columns for this cohort, in order: 's0', then each of 'y3' | 'y5' | 'y10' | 'y20'
   * whose June the cohort's LAST class has reached, then 'now':
   *   1995-1999, 2000-2004: s0 y3 y5 y10 y20 now     2005-2009, 2010-2014: s0 y3 y5 y10 now
   *   2015-2019: s0 y3 y5 now                         2020-2024, all: s0 now
   */
  stages: StageId[];
  /** stage -> family -> people (families >= k.field; smaller ones folded into smaller_groups). */
  totals: Partial<Record<StageId, Partial<Record<FamilyId, number>>>>;
  /** Flows between consecutive stages, each >= k.field. Each fits inside both of its nodes, and a
   *  node's published flows (in or out) never add up to more than the node. */
  links: RiverLink[];
  /** People-transitions hidden because their link was < k.field (null when that total is itself < k.field). */
  suppressed: number | null;
  /** stage -> family -> top employers/titles (each >= k.named; lists may be empty). */
  details: Partial<Record<StageId, Partial<Record<FamilyId, { employers: NamedCount[]; titles: NamedCount[] }>>>>;
  /**
   * The trajectory chart: year 0 (first destination), 1, 2, ... 20 and 'now', each over the
   * members who have reached it (see YearPoint). It goes past `stages`: a 2015-2019 slice's
   * Sankey stops at year 5, its years run to year 10 (the class of 2015 only, at year 10).
   * A point that is also a Sankey column (0 = 's0', 3 = 'y3', 5, 10, 20, 'now') has
   * n = slice n and the same family numbers as `totals` (same people, same cells), unless
   * link fitting raised a node in `totals`.
   */
  years: YearPoint[];
}

export interface RiverLink {
  from_stage: StageId; from: FamilyId;
  to_stage: StageId; to: FamilyId;
  n: number;
}

// ── diaspora.json ────────────────────────────────────────────────────────────

export interface DiasporaFile {
  /** Every metro area with >= k.named alumni living there now. */
  metros: Metro[];
  /**
   * Where alumni live now, per filter. Always contains level "all"/program "all"/cohort "all".
   * Metros/countries under k.named for that filter are omitted.
   */
  views: DiasporaView[];
  /** Per-metro profile over all alumni living there (keyed by Metro.id; every count >= k.named). */
  metroDetail: Record<string, MetroDetail>;
  /** Moves between metros: where people's first job was -> where they live now (>= k.named, from != to). */
  flows: { from: string; to: string; n: number }[];
  /** Share of each cohort / program living outside Canada (abroad/us >= k.field, else null). */
  abroad: {
    byCohort: AbroadRow[];
    byProgram: (AbroadRow & { level: LevelId; program: string })[];
  };
  /** Of alumni whose first job was in Kingston, where are they now (>= k.named; totals null below). */
  kingston: { firstJobInKingston: number | null; stillInKingston: number | null; nowElsewhere: NamedCount[] };
}

export interface Metro {
  id: string;                 // stable slug, e.g. "toronto-on-ca"
  name: string;               // "Toronto"
  region: string;             // "Ontario"
  country: string;            // ISO2 "CA"
  lat: number; lon: number;
  n: number;                  // alumni living here now (all alumni)
}

export interface DiasporaView {
  level: LevelId; program: string; cohort: DiasporaCohortId;
  n: number;                  // alumni in this filter with a known location
  /** [metroId, people] pairs, largest first. */
  metros: [string, number][];
  /** [ISO2, people] pairs, largest first (includes people only placeable at country level). */
  countries: [string, number][];
}

/**
 * Diaspora also covers grads before 1995 (location doesn't depend on early-career data), then
 * the River's five-year bands. 2025 grads are counted only in 'all'.
 */
export type DiasporaCohortId =
  | 'pre-1995' | '1995-1999' | '2000-2004' | '2005-2009' | '2010-2014' | '2015-2019' | '2020-2024' | 'all';

export interface MetroDetail {
  families: [FamilyId, number][];      // current job families
  employers: NamedCount[];             // top current employers
  programs: { level: LevelId; program: string; n: number }[];
  cohorts: [DiasporaCohortId, number][];
}

export interface AbroadRow {
  cohort?: DiasporaCohortId;
  n: number;                  // alumni with a known country
  abroad: number | null;      // people living outside Canada (null if < k.field)
  us: number | null;          // people living in the US (null if < k.field)
}

// ── twin.json ────────────────────────────────────────────────────────────────

/**
 * "Career twins": aggregate outcomes for people who share your program, class and first
 * destination. Groups exist at several levels of specificity ('*' = any); the UI picks the
 * most specific group that exists for the visitor's answers (see twin lookup order in
 * src/views/twin). Only groups of at least min_group people are exported (decided on the true
 * size, so a published n can sit up to 2 below min_group).
 */
export interface TwinFile {
  min_group: number;          // 20
  min_year: number;           // a YearPoint needs this many members to have reached it (10)
  groups: TwinGroup[];
}

export interface TwinGroup {
  level: LevelId | '*';
  program: string;            // or '*'
  cohort: CohortId | '*';
  s0: FamilyId | '*';         // first destination family, or '*'
  n: number;
  /**
   * The trajectory at years 0 (first destination), 1, 2, 3, 5, 7, 10, 15, 20 and 'now' (see
   * YearPoint). Replaces the old stageN/outcomes (years 5, 10 and now) and `first` (year 0).
   * With a fixed s0, year 0 is [[s0, n]]. A group with s0 '*' holds the same people as the
   * River slice of the same level/program/cohort ('*' = 'all'), and every point they share is
   * the same numbers.
   */
  years: YearPoint[];
  seniorityNow: [SeniorityId, number][];
  employersNow: NamedCount[];
  titlesNow: NamedCount[];
  employersFirst: NamedCount[];
  /**
   * Of members with a job both at their first destination and today (`of`), how many work in a
   * different family today (`n`, null if < k.field). Null when fewer than k.field members had a
   * job at both points (e.g. groups whose first destination is further study).
   */
  pivoted: { n: number | null; of: number } | null;
  /**
   * Cumulative manager-or-above titles: of members whose class is at least `years` out (`of`),
   * how many had held one by then (`n`, null if < k.field). years: 1, 3, 5, 7, 10, 15.
   */
  managerBy: { years: number; n: number | null; of: number }[];
  /** Members with a known location now (null if < k.field): the denominator for `abroad`/`us`/`topMetros`. */
  located: number | null;
  /** People living outside Canada / in the US now (null if < k.field; never more than `located`). */
  abroad: number | null;
  us: number | null;
  /** Top home metros now (each >= k.named). */
  topMetros: NamedCount[];
}

// ── insights.json ────────────────────────────────────────────────────────────

export interface InsightsFile {
  /** Ranked lists for the landing page (all entries >= k.named). */
  firstEmployers: NamedCount[];         // first-destination employers, classes 2015-2024
  topEmployers: NamedCount[];           // distinct alumni who ever worked there (any time)
  /** Program leaderboards: share of a program's grads with a given outcome today (hits >= k.field). */
  rankings: ProgramRanking[];
  /** Headline facts, each a short sentence with its supporting numbers. */
  facts: Fact[];
  /** How the snapshot date was established (Method page). */
  snapshot: {
    currentRolesImplying: { month: string; pct: number }[];   // "Present" arithmetic
    currentRolesSample: number;                               // current roles that arithmetic used
    newestActivity: string;                                   // ISO timestamp
    exportFileTimestamp: string;                              // ISO timestamp
    asOf: string;                                             // "2025-09-30"
  };
  /** Labelling run summary for the Method page. */
  labelling: { titles: number; employers: number; fields: number; places: number; costUsd: number; model: string };
}

export interface ProgramRanking {
  id: string;                 // e.g. "tech_now"
  label: string;              // "Working in tech today"
  rows: { level: LevelId; program: string; n: number; hits: number; pct: number }[];
}

export interface Fact {
  id: string;
  /** Headline number, already formatted for display ("38%", "1 in 5", "4,212"). */
  value: string;
  text: string;               // sentence the number belongs to
  detail?: string;            // one line of context / denominator
  link?: string;              // in-app route that explores it, e.g. "/river?level=law&program=Law"
}
