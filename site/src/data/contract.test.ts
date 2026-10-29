/**
 * Contract tests: the JSON the pipeline publishes must match what the TypeScript types promise,
 * and must keep the privacy floors (k.field for career-field counts, k.named for anything
 * naming an employer, title or place). These read the real files in public/data, so they catch
 * a pipeline change that would silently break a view (or leak a small count) before it ships.
 */
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { COHORTS, DIASPORA_COHORTS, FAMILY, LEVEL, STAGES, STAGE_ORDER, yearLabel } from './taxonomy';
import type {
  CohortId, DiasporaFile, FamilyId, Floors, InsightsFile, Meta, RiverFile, StageId, TwinFile, YearPoint,
} from './types';

const dir = resolve(__dirname, '../../public/data');
// These walk every slice and group of the real files (several MB): give them room.
vi.setConfig({ testTimeout: 60_000 });
const read = <T,>(name: string): T => JSON.parse(readFileSync(resolve(dir, `${name}.json`), 'utf8')) as T;
const has = (name: string) => existsSync(resolve(dir, `${name}.json`));

const STAGE_IDS: StageId[] = ['s0', 'y3', 'y5', 'y10', 'y20', 'now'];
const COHORT_IDS: CohortId[] = ['1995-1999', '2000-2004', '2005-2009', '2010-2014', '2015-2019', '2020-2024', 'all'];
const isFamily = (id: string): id is FamilyId => id in FAMILY;
/** The year a Sankey stage stands for in `years`. */
const STAGE_YEAR: Record<StageId, number | 'now'> = { s0: 0, y3: 3, y5: 5, y10: 10, y20: 20, now: 'now' };
/** Floors the project never goes below (pipeline/sdc.py). */
const FLOORS: Floors = { field: 5, named: 10 };

/**
 * Every published count is perturbed by at most NOISE people (cell-key method, MAX_NOISE in
 * pipeline/sdc.py). A sum of `parts` published counts can therefore exceed its published total
 * by up to NOISE per part plus NOISE for the total, even though the true parts fit inside it.
 * Single parts are capped at their total by the exporters, so those checks stay exact.
 */
const NOISE = 2;
const slack = (parts: number) => NOISE * (parts + 1);
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

/** Checks one trajectory (RiverSlice.years / TwinGroup.years) against the YearPoint contract. */
function checkYears(years: YearPoint[], total: number, k: Floors, minYear: number, where: string, allowed?: Set<number>) {
  const order = years.map((p) => (p.year === 'now' ? Infinity : p.year));
  for (let i = 1; i < order.length; i++) expect(order[i], where).toBeGreaterThan(order[i - 1]);
  expect(years.at(-1)?.year, `${where}: ends with now`).toBe('now');
  for (const p of years) {
    if (p.year !== 'now') {
      expect(Number.isInteger(p.year) && p.year >= 0 && p.year <= 20, `${where} year ${p.year}`).toBe(true);
      if (allowed) expect(allowed.has(p.year), `${where} year ${p.year}`).toBe(true);
    }
    expect(p.n, `${where} ${p.year}`).toBeGreaterThanOrEqual(Math.max(k.field, minYear - NOISE));
    expect(p.n).toBeLessThanOrEqual(total);
    const counts = p.fields.map(([, n]) => n);
    for (const [f, n] of p.fields) {
      expect(isFamily(f), f).toBe(true);
      expect(n).toBeGreaterThanOrEqual(k.field);
      expect(n).toBeLessThanOrEqual(p.n);
    }
    for (let i = 1; i < counts.length; i++) expect(counts[i]).toBeLessThanOrEqual(counts[i - 1]);   // largest first
    expect(new Set(p.fields.map(([f]) => f)).size).toBe(p.fields.length);
    expect(sum(counts)).toBeLessThanOrEqual(p.n + slack(counts.length));
  }
  // Members who reached a later year also reached the earlier ones (true counts nest; published
  // ones can wobble by the noise).
  const yearly = years.filter((p) => p.year !== 'now');
  for (let i = 1; i < yearly.length; i++) expect(yearly[i].n).toBeLessThanOrEqual(yearly[i - 1].n + 2 * NOISE);
}

describe('taxonomy labels cover the contract', () => {
  it('has a label for every stage and cohort id', () => {
    expect(STAGE_ORDER).toEqual(STAGE_IDS);
    for (const st of STAGE_IDS) expect(STAGES[st].label).toBeTruthy();
    expect(COHORTS.map((c) => c.id).sort()).toEqual([...COHORT_IDS].sort());
    expect(COHORTS.find((c) => c.id === '2010-2014')?.label).toBe('Class of 2010–2014');
    expect(DIASPORA_COHORTS.map((c) => c.id).sort()).toEqual(['pre-1995', ...COHORT_IDS].sort());
    expect([yearLabel(0), yearLabel(7), yearLabel('now'), yearLabel(3, true)]).toEqual(['First destination', 'Year 7', 'Today', 'Yr 3']);
  });
});

describe.skipIf(!has('meta'))('meta.json', () => {
  const meta = read<Meta>('meta');
  it('has both floors and sane counts', () => {
    expect(meta.k.field).toBeGreaterThanOrEqual(FLOORS.field);
    expect(meta.k.named).toBeGreaterThanOrEqual(FLOORS.named);
    expect(meta.counts.alumni).toBeLessThanOrEqual(meta.counts.profiles);
    expect(meta.counts.firstYear).toBeLessThan(meta.counts.lastYear);
  });
  it('lists programs at known levels, each >= k', () => {
    expect(meta.programs.length).toBeGreaterThan(0);
    for (const p of meta.programs) {
      expect(LEVEL[p.level], p.level).toBeDefined();
      expect(p.n).toBeGreaterThanOrEqual(meta.k.field);
      expect(p.program.trim()).toBe(p.program);
    }
  });
  it('lists the five-year cohorts, then all', () => {
    expect(meta.cohorts.map((c) => c.id)).toEqual(COHORT_IDS);
    for (const c of meta.cohorts) {
      if (c.id !== 'all') { expect(c.to - c.from).toBe(4); expect(c.label).toBe(`Class of ${c.from}–${c.to}`); }
    }
  });
});

describe.skipIf(!has('river'))('river.json', () => {
  const river = read<RiverFile>('river');
  const k = river.meta.k;

  it('declares both floors and labels every stage', () => {
    expect(k.field).toBeGreaterThanOrEqual(FLOORS.field);
    expect(k.named).toBeGreaterThanOrEqual(FLOORS.named);
    expect(Object.keys(river.meta.stages)).toEqual(STAGE_IDS);
  });

  it('has the whole-school default slices (hero: all/all/2010-2014)', () => {
    for (const cohort of COHORT_IDS) {
      expect(river.slices.some((s) => s.level === 'all' && s.program === 'all' && s.cohort === cohort), cohort).toBe(true);
    }
    const hero = river.slices.find((s) => s.level === 'all' && s.program === 'all' && s.cohort === '2010-2014')!;
    expect(hero.stages).toEqual(['s0', 'y3', 'y5', 'y10', 'now']);
  });

  it('shows a cohort the Sankey years its last class has reached', () => {
    const expected: Record<CohortId, StageId[]> = {
      '1995-1999': ['s0', 'y3', 'y5', 'y10', 'y20', 'now'], '2000-2004': ['s0', 'y3', 'y5', 'y10', 'y20', 'now'],
      '2005-2009': ['s0', 'y3', 'y5', 'y10', 'now'], '2010-2014': ['s0', 'y3', 'y5', 'y10', 'now'],
      '2015-2019': ['s0', 'y3', 'y5', 'now'], '2020-2024': ['s0', 'now'], all: ['s0', 'now'],
    };
    for (const s of river.slices) expect(s.stages, `${s.level}/${s.program}/${s.cohort}`).toEqual(expected[s.cohort]);
  });

  it('uses only known families, stages, levels and cohorts', () => {
    for (const s of river.slices) {
      expect(LEVEL[s.level], s.level).toBeDefined();
      expect(COHORT_IDS).toContain(s.cohort);
      for (const st of s.stages) expect(STAGE_IDS).toContain(st);
      for (const [st, fams] of Object.entries(s.totals)) {
        expect(s.stages).toContain(st);
        for (const f of Object.keys(fams ?? {})) expect(isFamily(f), f).toBe(true);
      }
      for (const l of s.links) {
        expect(isFamily(l.from) && isFamily(l.to), `${l.from}->${l.to}`).toBe(true);
        expect(s.stages.indexOf(l.to_stage)).toBe(s.stages.indexOf(l.from_stage) + 1);
      }
    }
  });

  it('never publishes a count under its floor, and links fit inside their nodes', () => {
    for (const s of river.slices) {
      expect(s.n).toBeGreaterThanOrEqual(river.meta.min_slice - NOISE);   // chosen on the true size
      if (s.suppressed !== null) expect(s.suppressed).toBeGreaterThanOrEqual(k.field);
      for (const fams of Object.values(s.totals)) for (const n of Object.values(fams ?? {})) expect(n).toBeGreaterThanOrEqual(k.field);
      const flowOut = new Map<string, number>();
      const flowIn = new Map<string, number>();
      for (const l of s.links) {
        expect(l.n).toBeGreaterThanOrEqual(k.field);
        expect(l.n).toBeLessThanOrEqual(s.totals[l.from_stage]?.[l.from] ?? Infinity);
        expect(l.n).toBeLessThanOrEqual(s.totals[l.to_stage]?.[l.to] ?? Infinity);
        flowOut.set(`${l.from_stage}:${l.from}`, (flowOut.get(`${l.from_stage}:${l.from}`) ?? 0) + l.n);
        flowIn.set(`${l.to_stage}:${l.to}`, (flowIn.get(`${l.to_stage}:${l.to}`) ?? 0) + l.n);
      }
      // The exporter trims perturbed links so a node's ribbons never overflow its bar.
      for (const [node, total] of [...flowOut, ...flowIn]) {
        const [st, fam] = node.split(':') as [StageId, FamilyId];
        expect(total, `${s.level}/${s.program}/${s.cohort} ${node}`).toBeLessThanOrEqual(s.totals[st]?.[fam] ?? Infinity);
      }
      // Stage totals are a partition of n (minus families under k), up to the noise.
      for (const st of s.stages) {
        const fams = Object.values(s.totals[st] ?? {}) as number[];
        expect(sum(fams)).toBeLessThanOrEqual(s.n + slack(fams.length));
      }
      for (const fams of Object.values(s.details)) {
        for (const d of Object.values(fams ?? {})) {
          for (const e of [...(d?.employers ?? []), ...(d?.titles ?? [])]) expect(e.n).toBeGreaterThanOrEqual(k.named);
        }
      }
    }
  });

  it('has a year series per slice, with honest denominators', () => {
    for (const s of river.slices) {
      const where = `${s.level}/${s.program}/${s.cohort}`;
      checkYears(s.years, s.n, k, river.meta.min_year, where);
      const byYear = new Map(s.years.map((p) => [p.year, p]));
      // Every Sankey column is a year all members have reached: its point is the whole slice,
      // with the same families as the column.
      for (const st of s.stages) {
        const p = byYear.get(STAGE_YEAR[st]);
        expect(p, `${where} ${st}`).toBeDefined();
        expect(p!.n, `${where} ${st}`).toBe(s.n);
        expect(new Set(p!.fields.map(([f]) => f)), `${where} ${st}`).toEqual(new Set(Object.keys(s.totals[st] ?? {})));
      }
      // Years past the last Sankey column cover only the earlier classes of the band.
      const last = STAGE_YEAR[s.stages[s.stages.length - 2]];
      if (typeof last === 'number') for (const p of s.years) if (typeof p.year === 'number' && p.year > last) expect(p.n).toBeLessThanOrEqual(s.n);
    }
  });
});

describe.skipIf(!has('diaspora'))('diaspora.json', () => {
  const d = read<DiasporaFile>('diaspora');
  const ids = new Set(d.metros.map((m) => m.id));

  it('uses the five-year cohorts plus pre-1995', () => {
    const ids = new Set(DIASPORA_COHORTS.map((c) => c.id));
    for (const v of d.views) expect(ids.has(v.cohort), v.cohort).toBe(true);
    for (const r of d.abroad.byCohort) expect(ids.has(r.cohort!), r.cohort).toBe(true);
    expect(d.abroad.byCohort.map((r) => r.cohort)).toEqual(['pre-1995', ...COHORT_IDS.filter((c) => c !== 'all'), 'all']);
  });

  it('has unique metro ids with valid coordinates', () => {
    expect(ids.size).toBe(d.metros.length);
    for (const m of d.metros) {
      expect(m.lat).toBeGreaterThanOrEqual(-90);
      expect(m.lat).toBeLessThanOrEqual(90);
      expect(m.lon).toBeGreaterThanOrEqual(-180);
      expect(m.lon).toBeLessThanOrEqual(180);
      expect(m.country).toMatch(/^[A-Z]{2}$/);
      expect(m.n).toBeGreaterThanOrEqual(FLOORS.named);
    }
  });

  it('only references metros that exist', () => {
    for (const v of d.views) for (const [id, n] of v.metros) { expect(ids.has(id), id).toBe(true); expect(n).toBeGreaterThanOrEqual(FLOORS.named); }
    for (const f of d.flows) { expect(ids.has(f.from) && ids.has(f.to)).toBe(true); expect(f.from).not.toBe(f.to); expect(f.n).toBeGreaterThanOrEqual(FLOORS.named); }
    for (const id of Object.keys(d.metroDetail)) expect(ids.has(id), id).toBe(true);
  });

  it('has the everyone view, and view counts never exceed their total (sums: up to the noise)', () => {
    expect(d.views.some((v) => v.level === 'all' && v.program === 'all' && v.cohort === 'all')).toBe(true);
    for (const v of d.views) {
      for (const [, n] of [...v.metros, ...v.countries]) expect(n).toBeLessThanOrEqual(v.n);
      expect(sum(v.metros.map(([, n]) => n))).toBeLessThanOrEqual(v.n + slack(v.metros.length));
      expect(sum(v.countries.map(([, n]) => n))).toBeLessThanOrEqual(v.n + slack(v.countries.length));
    }
  });

  it('publishes small totals as null, never 0', () => {
    const { firstJobInKingston, stillInKingston, nowElsewhere } = d.kingston;
    for (const x of [firstJobInKingston, stillInKingston]) if (x !== null) expect(x).toBeGreaterThanOrEqual(10);
    if (stillInKingston !== null) expect(stillInKingston).toBeLessThanOrEqual(firstJobInKingston ?? -1);
    for (const e of nowElsewhere) expect(e.n).toBeLessThanOrEqual(firstJobInKingston ?? -1);
    for (const r of [...d.abroad.byCohort, ...d.abroad.byProgram]) {
      if (r.abroad !== null) { expect(r.abroad).toBeGreaterThanOrEqual(FLOORS.field); expect(r.abroad).toBeLessThanOrEqual(r.n); }
      if (r.us !== null) { expect(r.us).toBeGreaterThanOrEqual(FLOORS.field); expect(r.us).toBeLessThanOrEqual(r.abroad ?? -1); }
    }
  });

  it('uses known families in metro details', () => {
    for (const det of Object.values(d.metroDetail)) for (const [f, n] of det.families) { expect(isFamily(f), f).toBe(true); expect(n).toBeGreaterThanOrEqual(10); }
  });
});

describe.skipIf(!has('twin'))('twin.json', () => {
  const t = read<TwinFile>('twin');

  it('has the catch-all group so every visitor gets a result', () => {
    expect(t.groups.some((g) => g.level === '*' && g.program === '*' && g.cohort === '*' && g.s0 === '*')).toBe(true);
  });

  const TWIN_YEARS = new Set([0, 1, 2, 3, 5, 7, 10, 15, 20]);

  it('has unique keys and consistent denominators', () => {
    const keys = new Set<string>();
    for (const g of t.groups) {
      const key = [g.level, g.program, g.cohort, g.s0].join('|');
      expect(keys.has(key), key).toBe(false);
      keys.add(key);
      expect(g.n).toBeGreaterThanOrEqual(t.min_group - NOISE);   // chosen on the true size
      if (g.cohort !== '*') expect(COHORT_IDS).toContain(g.cohort);
      if (g.s0 !== '*') expect(isFamily(g.s0), g.s0).toBe(true);
      checkYears(g.years, g.n, FLOORS, t.min_year, key, TWIN_YEARS);
      // Year 0 is the first destination, which every member has.
      const first = g.years[0];
      expect(first.year, key).toBe(0);
      expect(first.n, key).toBe(g.n);
      if (g.s0 !== '*') expect(first.fields).toEqual([[g.s0, g.n]]);
      expect(g.years.at(-1)!.n, key).toBe(g.n);                  // everyone has a 'now'
      if (g.pivoted) {
        expect(g.pivoted.of).toBeGreaterThanOrEqual(FLOORS.field);
        if (g.pivoted.n !== null) expect(g.pivoted.n).toBeLessThanOrEqual(g.pivoted.of);
      }
      for (const m of g.managerBy) if (m.n !== null) { expect(m.n).toBeLessThanOrEqual(m.of); expect(m.n).toBeGreaterThanOrEqual(FLOORS.field); }
      // located is null (never 0) under the floor; abroad/us can only be published when it is.
      if (g.located !== null) { expect(g.located).toBeGreaterThanOrEqual(FLOORS.field); expect(g.located).toBeLessThanOrEqual(g.n); }
      if (g.abroad !== null) expect(g.abroad).toBeLessThanOrEqual(g.located ?? -1);
      if (g.us !== null) expect(g.us).toBeLessThanOrEqual(g.abroad ?? -1);
      for (const m of g.topMetros) { expect(m.n).toBeLessThanOrEqual(g.located ?? g.n); expect(m.n).toBeGreaterThanOrEqual(FLOORS.named); }
      for (const e of [...g.employersNow, ...g.titlesNow, ...g.employersFirst]) expect(e.n).toBeGreaterThanOrEqual(FLOORS.named);
      for (const [, n] of g.seniorityNow) expect(n).toBeGreaterThanOrEqual(FLOORS.field);
    }
  });

  it.skipIf(!has('river'))('publishes the same numbers as the River for the same people', () => {
    const river = read<RiverFile>('river');
    const groups = new Map(t.groups.filter((g) => g.s0 === '*').map((g) => [[g.level, g.program, g.cohort].join('|'), g]));
    let compared = 0;
    for (const s of river.slices) {
      const g = groups.get([s.level === 'all' ? '*' : s.level, s.program === 'all' ? '*' : s.program, s.cohort === 'all' ? '*' : s.cohort].join('|'));
      if (!g) continue;
      expect(g.n).toBe(s.n);
      const ty = new Map(g.years.map((p) => [p.year, p]));
      for (const p of s.years) if (ty.has(p.year)) { expect(ty.get(p.year)).toEqual(p); compared++; }
    }
    expect(compared).toBeGreaterThan(100);
  });
});

describe.skipIf(!has('insights'))('insights.json', () => {
  const ins = read<InsightsFile>('insights');
  it('has facts with values and in-app links', () => {
    expect(ins.facts.length).toBeGreaterThan(3);
    for (const f of ins.facts) {
      expect(f.value).not.toBe('');
      expect(f.text).not.toBe('');
      if (f.link) expect(f.link.startsWith('/')).toBe(true);
      // A cohort named in a link must be one the River knows.
      const cohort = f.link ? new URLSearchParams(f.link.split('?')[1] ?? '').get('cohort') : null;
      if (cohort) expect(COHORT_IDS).toContain(cohort);
      // Old cohort bands must not survive in the copy.
      expect(f.text).not.toMatch(/2005–2015|1995–2015|1995–2004|2016–2020|2021–202[45]/);
    }
  });
  it('rankings are sorted and within bounds', () => {
    for (const r of ins.rankings) {
      for (let i = 1; i < r.rows.length; i++) expect(r.rows[i].pct).toBeLessThanOrEqual(r.rows[i - 1].pct);
      for (const row of r.rows) {
        expect(row.hits).toBeLessThanOrEqual(row.n);
        expect(row.hits).toBeGreaterThanOrEqual(FLOORS.field);
        expect(row.pct).toBeCloseTo((100 * row.hits) / row.n, 0);
      }
    }
  });
});
