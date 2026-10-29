import { geoArea, geoContains } from 'd3';
import { describe, expect, it } from 'vitest';
import { LAKES, normaliseRing, ringIsClockwise } from './lakes';
import {
  ALWAYS_LABEL, DEFAULT_FILTER, DEFAULT_FLOORS, IDENTITY, MIN_R, REGIONS, abroadByCohort, abroadFor, abroadHeadline,
  abroadRowFor, applyTransform, arcControl, arcPath, autoTarget, canadaShare, carryTransform, centerOn, clampTransform,
  cohortPhrase, cohortShort, cohortYears, computeStats, countryRows, estimateTextWidth, filterLabel, fitPoints, floorsFrom,
  flowWidth, flowsFor, inRegion, indexViews, kingstonFlowLayout, kingstonStory, makeFrame, mapHeightFor, mapLabels,
  mapSummary, metroIndex, metroRows, normalizeFilter, oneWayToToronto, parseCohort, parseLevel, pctText, pickNearest,
  placeLabels, placeName, programsForLevel, project, qualifiedNames, quadAt, radiusScale, rankPrograms, regionTransform,
  resolveFlows, resolveView, ribbonPath, shareText, sizeLegendLayout, sizeLegendValues, smallestRegion, splitPlaces,
  targetTransform, targetWithSelection, viewKey, whoPhrase, zoomRadiusFactor,
} from './model';
import type { AbroadCohortRow, Filter, LabelBubble, LabelCandidate, MapTarget, MetroRow, Pt } from './model';
import { METROS, makeFile } from './testFixture';

const file = makeFile();
const index = indexViews(file.views);
const byId = metroIndex(file.metros);
const f = (level: Filter['level'], program: string, cohort: Filter['cohort']): Filter => ({ level, program, cohort });

describe('URL parsing & filter normalisation', () => {
  it('accepts only known levels and cohorts', () => {
    expect(parseLevel('undergrad')).toBe('undergrad');
    expect(parseLevel('all')).toBe('all');
    for (const bad of ['', 'ALL', 'phd', 'undergrad ', '<script>']) expect(parseLevel(bad)).toBeNull();
    expect(parseCohort('pre-1995')).toBe('pre-1995');
    expect(parseCohort('2021-2024')).toBeNull(); // River's cohort id, not Diaspora's
    expect(parseCohort('nope')).toBeNull();
  });

  it('drops a program for level "all" and unknown programs for a level', () => {
    expect(normalizeFilter(index, f('all', 'Computer Science', 'all'))).toEqual(DEFAULT_FILTER);
    expect(normalizeFilter(index, f('undergrad', 'Underwater Basketry', '2015-2019')))
      .toEqual(f('undergrad', 'all', '2015-2019'));
    expect(normalizeFilter(index, f('undergrad', '', 'all'))).toEqual(f('undergrad', 'all', 'all'));
    expect(normalizeFilter(index, f('undergrad', 'Computer Science', 'all'))).toEqual(f('undergrad', 'Computer Science', 'all'));
  });

  it('repairs invalid levels and cohorts smuggled past the type system', () => {
    const raw = { level: 'bogus', program: 'Computer Science', cohort: 'zzz' } as unknown as Filter;
    expect(normalizeFilter(index, raw)).toEqual(DEFAULT_FILTER);
  });
});

describe('programs for a level', () => {
  it('lists programs alphabetically with their all-classes n', () => {
    const grad = programsForLevel(index, 'graduate');
    expect(grad.map((p) => p.program)).toEqual(['Art Conservation', 'Computer Science']);
    expect(grad.find((p) => p.program === 'Computer Science')?.n).toBe(469);
    const ug = programsForLevel(index, 'undergrad');
    expect(ug).toHaveLength(1);
    expect(ug[0].cohorts.sort()).toEqual(['2015-2019', 'all']);
  });

  it('is empty for level "all" and for levels without views', () => {
    expect(programsForLevel(index, 'all')).toEqual([]);
    expect(programsForLevel(index, 'medicine')).toEqual([]);
    expect(programsForLevel(indexViews([]), 'undergrad')).toEqual([]);
  });
});

describe('view lookup with fallbacks', () => {
  it('returns the exact view when it exists (including level "all")', () => {
    const r = resolveView(index, DEFAULT_FILTER);
    expect(r.view?.n).toBe(92830);
    expect(r.shown?.view).toBe(r.view);
    expect(r.alternatives).toEqual([]);
    expect(resolveView(index, f('all', 'all', '2020-2024')).view?.n).toBe(17581);
  });

  it('falls back to the closest published views, in order, when a combination is missing', () => {
    const r = resolveView(index, f('undergrad', 'Computer Science', 'pre-1995'));
    expect(r.view).toBeNull();
    expect(r.alternatives).toEqual([
      f('undergrad', 'Computer Science', 'all'),
      f('all', 'all', 'all'),
    ]);
    // undergrad/all/pre-1995 and all/all/pre-1995 don't exist in the fixture, so they're not offered.
    expect(r.shown?.filter).toEqual(f('undergrad', 'Computer Science', 'all'));
    expect(r.shown?.view.n).toBe(1384);
  });

  it('never offers the missing filter itself or duplicates', () => {
    const r = resolveView(index, f('all', 'all', 'pre-1995'));
    expect(r.alternatives).toEqual([DEFAULT_FILTER]);
    const keys = r.alternatives.map(viewKey);
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys).not.toContain(viewKey(f('all', 'all', 'pre-1995')));
  });

  it('copes with an empty file: nothing to show, nothing to offer', () => {
    const r = resolveView(indexViews([]), DEFAULT_FILTER);
    expect(r.view).toBeNull();
    expect(r.shown).toBeNull();
    expect(r.alternatives).toEqual([]);
  });

  it('labels filters for people', () => {
    expect(filterLabel(DEFAULT_FILTER)).toBe('All alumni, all classes');
    expect(filterLabel(f('undergrad', 'Computer Science', '2015-2019'))).toBe('Computer Science (Undergrad), classes of 2015–2019');
    expect(filterLabel(f('graduate', 'all', 'pre-1995'))).toBe('Master’s & PhD, classes before 1995');
    expect(whoPhrase(DEFAULT_FILTER)).toBe('alumni');
    expect(whoPhrase(f('mba', 'MBA', 'all'))).toBe('MBA alumni');
    expect(whoPhrase(f('undergrad', 'all', '2020-2024'))).toBe('undergraduate alumni from the classes of 2020–2024');
    expect(whoPhrase(f('undergrad', 'Computer Science', 'all'))).toBe('Computer Science alumni (Undergrad)');
    // Degrees use the Degree control's names, never "Grad".
    expect(whoPhrase(f('graduate', 'Computer Science', 'all'))).toBe('Computer Science alumni (Master’s/PhD)');
    expect(filterLabel(f('law', 'all', 'all'))).toBe('JD (law), all classes');
  });
});

describe('rows & stats', () => {
  it('joins metros, skips unknown ids and sorts largest first', () => {
    const view = index.byKey.get('all|all|all')!;
    const rows = metroRows(view, byId);
    expect(rows).toHaveLength(11);
    expect(rows.find((r) => r.metro.id === 'atlantis')).toBeUndefined();
    expect(rows[0].metro.id).toBe('toronto');
    expect(rows[0].share).toBeCloseTo(30120 / 92830);
    for (let i = 1; i < rows.length; i++) expect(rows[i - 1].n).toBeGreaterThanOrEqual(rows[i].n);
  });

  it('handles a missing view and an empty metros list', () => {
    expect(metroRows(null, byId)).toEqual([]);
    const countryOnly = index.byKey.get('graduate|Art Conservation|all')!;
    expect(metroRows(countryOnly, byId)).toEqual([]);
    expect(countryRows(countryOnly)).toEqual([{ iso2: 'CA', name: 'Canada', n: 50, share: 50 / 55 }]);
    expect(countryRows(null)).toEqual([]);
    expect(metroRows(index.byKey.get('all|all|all')!, new Map())).toEqual([]);
  });

  it('formats shares as whole numbers, honestly at small sizes', () => {
    expect(shareText(14, 92830)).toBe('<1%');
    expect(shareText(634, 92830)).toBe('<1%');
    expect(shareText(8330, 92830)).toBe('9%');
    expect(shareText(30120, 92830)).toBe('32%');
    expect(shareText(0, 10)).toBe('0%');
    expect(shareText(5, 0)).toBe('—');
    expect(shareText(null, 10)).toBe('—');
    expect(pctText(16.84)).toBe('17%');
    expect(pctText(0.4)).toBe('<1%');
    expect(pctText(0)).toBe('0%');
    expect(pctText(null)).toBe('—');
  });

  it('names places without repeating themselves, spelling Québec in French', () => {
    expect(placeName(byId.get('toronto')!)).toBe('Ontario, Canada');
    expect(placeName({ ...byId.get('tokyo')!, region: 'Tokyo' })).toBe('Japan');
    expect(placeName({ ...byId.get('toronto')!, name: 'Montreal', region: 'Quebec' })).toBe('Québec, Canada');
  });

  it('qualifies same-named places, and only those', () => {
    const names = qualifiedNames(file.metros);
    expect(names.get('london-gb')).toBe('London, UK');
    expect(names.get('london-on')).toBe('London, Ont.');
    expect(names.get('toronto')).toBe('Toronto');
    const extra = qualifiedNames([
      ...file.metros,
      { id: 'sydney-ns', name: 'Sydney', region: 'Nova Scotia', country: 'CA', lat: 46.1, lon: -60.2, n: 40 },
      { id: 'buffalo-ny', name: 'Buffalo', region: 'New York', country: 'US', lat: 42.9, lon: -78.9, n: 30 },
      { id: 'buffalo-on', name: 'Buffalo', region: 'Ontario', country: 'CA', lat: 43, lon: -79, n: 12 },
      { id: 'qc', name: 'Quebec City', region: 'Quebec', country: 'CA', lat: 46.8, lon: -71.2, n: 38 },
      // Already qualified by the pipeline: kept as given.
      { id: 'perth-au', name: 'Perth, WA', region: 'Western Australia', country: 'AU', lat: -31.9, lon: 115.9, n: 20 },
      { id: 'perth-wa2', name: 'Perth, WA', region: 'Western Australia', country: 'AU', lat: -31.9, lon: 115.9, n: 20 },
    ]);
    expect(extra.get('sydney')).toBe('Sydney, Australia');
    expect(extra.get('sydney-ns')).toBe('Sydney, N.S.');
    expect(extra.get('buffalo-ny')).toBe('Buffalo, N.Y.');
    expect(extra.get('buffalo-on')).toBe('Buffalo, Ont.');
    expect(extra.get('qc')).toBe('Québec City');
    expect(extra.get('perth-au')).toBe('Perth, WA');
  });

  it('sums up the map in one sentence from published shares', () => {
    const view = index.byKey.get('all|all|all')!;
    const rows = metroRows(view, byId);
    const nameOf = (m: { name: string }) => m.name;
    expect(mapSummary(view, rows, 'alumni', nameOf)).toBe(
      `${shareText(80571, 92830)} of alumni live in Canada, ${shareText(30120, 92830)} in Toronto alone.`,
    );
    const london: MetroRow = { metro: byId.get('london-gb')!, n: 50, share: 0.5 };
    expect(mapSummary({ ...view, n: 100, countries: [['CA', 40]] }, [london], 'alumni', nameOf))
      .toBe('40% of alumni live in Canada; the biggest single city is London, with 50%.');
    expect(mapSummary(null, [], 'alumni', nameOf)).toBeNull();
    expect(mapSummary({ ...view, countries: [] }, [], 'alumni', nameOf)).toBeNull();
  });

  it('uses the published abroad share when one matches the filter exactly', () => {
    expect(abroadRowFor(file, DEFAULT_FILTER)?.abroad).toBe(12259);
    expect(abroadRowFor(file, f('undergrad', 'Computer Science', 'all'))?.abroad).toBe(141);
    expect(abroadRowFor(file, f('undergrad', 'Computer Science', '2015-2019'))).toBeNull();
    expect(abroadRowFor(file, f('undergrad', 'all', 'all'))).toBeNull();
    const s = abroadFor(file, DEFAULT_FILTER, index.byKey.get('all|all|all')!);
    expect(s).toEqual({ kind: 'exact', abroad: 12259, of: 92830, us: 5110 });
  });

  it('reports a null (under 10) published count as suppressed, never as zero', () => {
    const view = index.byKey.get('graduate|Art Conservation|all')!;
    expect(abroadFor(file, f('graduate', 'Art Conservation', 'all'), view)).toEqual({ kind: 'suppressed', of: 55 });
  });

  it('falls back to a lower bound from listed countries (no subtraction from the total)', () => {
    const view = index.byKey.get('undergrad|all|all')!;
    expect(abroadFor(file, f('undergrad', 'all', 'all'), view)).toEqual({ kind: 'atLeast', abroad: 3200, of: 44659 });
    const caOnly = index.byKey.get('undergrad|Computer Science|2015-2019')!;
    expect(abroadFor(file, f('undergrad', 'Computer Science', '2015-2019'), caOnly)).toEqual({ kind: 'unlisted', of: 300 });
    expect(abroadFor(file, f('undergrad', 'Computer Science', '2015-2019'), null)).toEqual({ kind: 'none' });
  });

  it('ignores an abroad row with n = 0 and uses the view instead', () => {
    const v = { level: 'all' as const, program: 'all', cohort: '2005-2009' as const, n: 100, metros: [], countries: [['CA', 80], ['US', 20]] as [string, number][] };
    expect(abroadFor(file, f('all', 'all', '2005-2009'), v)).toEqual({ kind: 'atLeast', abroad: 20, of: 100 });
  });

  it('computes headline stats', () => {
    const view = index.byKey.get('all|all|all')!;
    const s = computeStats(file, DEFAULT_FILTER, view, metroRows(view, byId));
    expect(s.located).toBe(92830);
    expect(s.countries).toBe(6);
    expect(s.topAbroad?.metro.name).toBe('New York');
    expect(s.topMetro?.metro.name).toBe('Toronto');
    const empty = computeStats(file, DEFAULT_FILTER, null, []);
    expect(empty).toMatchObject({ located: 0, countries: 0, topAbroad: null, topMetro: null });
  });
});

describe('who leaves Canada', () => {
  it('orders cohorts oldest first, drops n = 0 rows and keeps nulls as null', () => {
    const rows = abroadByCohort(file.abroad.byCohort);
    expect(rows.map((r) => r.cohort)).toEqual(['pre-1995', '1995-1999', '2020-2024']);
    const r95 = rows.find((r) => r.cohort === '1995-1999')!;
    expect(r95.usPct).toBeNull();
    expect(r95.abroadPct).toBeCloseTo((100 * 1430) / 8315);
    expect(abroadByCohort([])).toEqual([]);
  });

  it('ranks programs, leaving out null counts and small programs, keeping true zeros', () => {
    const abroad = rankPrograms(file.abroad.byProgram, 'abroad', { minN: 200 });
    expect(abroad.map((r) => `${r.level}|${r.program}`)).toEqual([
      'graduate|Computer Science', 'undergrad|Commerce', 'undergrad|Computer Science', 'undergrad|Nursing',
    ]);
    expect(abroad.at(-1)?.pct).toBe(0);
    const us = rankPrograms(file.abroad.byProgram, 'us', { minN: 0 });
    expect(us.find((r) => r.level === 'graduate' && r.program === 'Computer Science')).toBeUndefined();
    expect(us.find((r) => r.program === 'Art Conservation')).toBeUndefined();
    expect(rankPrograms(file.abroad.byProgram, 'abroad', { limit: 1 })).toHaveLength(1);
    expect(rankPrograms([], 'abroad')).toEqual([]);
  });

  const row = (cohort: AbroadCohortRow['cohort'], n: number, abroad: number | null): AbroadCohortRow =>
    ({ cohort, label: cohort, n, abroad, us: null, abroadPct: abroad == null ? null : (100 * abroad) / n, usPct: null });

  it('heads "Who leaves Canada" without claiming a peak that leads by under 3 points', () => {
    // Fixture: 1995–1999 tops before-1995 by under 3 points, so no "likeliest" claim; its share
    // is about 1 in 6, and the newest class sits 3+ points below every other.
    expect(abroadHeadline(abroadByCohort(file.abroad.byCohort)))
      .toBe('About 1 in 6 alumni from 1995–1999 live abroad; recent grads haven’t left yet');
    // Neighbours within 2 points of the top are pooled into one span.
    expect(abroadHeadline([
      row('pre-1995', 1000, 140), row('1995-1999', 1000, 170), row('2000-2004', 1000, 160), row('2005-2009', 1000, 135),
      row('2010-2014', 1000, 140), row('2015-2019', 1000, 130), row('2020-2024', 1000, 90),
    ])).toBe('About 1 in 6 alumni from 1995–2004 live abroad; recent grads haven’t left yet');
    // A span starting before 1995 reads as "who graduated before …".
    expect(abroadHeadline([row('pre-1995', 1000, 250), row('1995-1999', 1000, 240), row('2000-2004', 1000, 235)]))
      .toBe('About 1 in 4 alumni who graduated before 2005 live abroad');
    // A gap in the published classes ends a run: 2010–2014 isn't pooled with 2000–2004.
    expect(abroadHeadline([row('2000-2004', 1000, 200), row('2010-2014', 1000, 195), row('2015-2019', 1000, 150)]))
      .toBe('About 1 in 5 alumni from 2000–2004 live abroad');
  });

  it('names a peak class only when it leads every other by 3+ points', () => {
    expect(abroadHeadline([row('pre-1995', 1000, 100), row('1995-1999', 1000, 200), row('2000-2004', 1000, 160)]))
      .toBe('The classes of 1995-1999 are the likeliest to live abroad');
    expect(abroadHeadline([row('pre-1995', 1000, 300), row('1995-1999', 1000, 200)]))
      .toBe('Grads from before 1995 are the likeliest to live abroad');
    // 2.9 points is not a lead.
    expect(abroadHeadline([row('1995-1999', 1000, 200), row('2000-2004', 1000, 171)])).not.toMatch(/likeliest/);
  });

  it('only says recent grads haven’t left when the newest class is clearly lower', () => {
    expect(abroadHeadline([row('2010-2014', 1000, 150), row('2015-2019', 1000, 140), row('2020-2024', 1000, 125)]))
      .not.toMatch(/recent grads/);
    expect(abroadHeadline([])).toBe('Living outside Canada');
    expect(abroadHeadline([row('pre-1995', 1000, null)])).toBe('Living outside Canada');
  });
});

describe('the Kingston story', () => {
  const k = file.kingston;
  const first = k.firstJobInKingston!;
  const still = k.stillInKingston!;

  it('shares are published part / published total, destinations largest first', () => {
    const story = kingstonStory(k)!;
    expect(story.firstJob).toBe(first);
    expect(story.still).toBe(still);
    expect(story.stillPct).toBeCloseTo((100 * still) / first);
    const sorted = [...k.nowElsewhere].sort((a, b) => b.n - a.n);
    expect(story.elsewhere.map((r) => r.name)).toEqual(sorted.map((r) => r.name));
    for (const r of story.elsewhere) expect(r.pct).toBeCloseTo((100 * r.n) / first);
  });

  it('shows the stayed share only when both counts are published', () => {
    const noTotal = kingstonStory({ ...k, firstJobInKingston: null })!;
    expect(noTotal.stillPct).toBeNull();
    expect(noTotal.still).toBe(still);
    expect(noTotal.elsewhere.every((r) => r.pct === null)).toBe(true);
    const noStill = kingstonStory({ ...k, stillInKingston: null })!;
    expect(noStill.still).toBeNull();
    expect(noStill.stillPct).toBeNull();
    expect(noStill.elsewhere.length).toBeGreaterThan(0);
  });

  it('is null when there is nothing to tell, and ignores junk rows', () => {
    expect(kingstonStory(null)).toBeNull();
    expect(kingstonStory({ firstJobInKingston: 0, stillInKingston: 0, nowElsewhere: [] })).toBeNull();
    expect(kingstonStory({ firstJobInKingston: 50, stillInKingston: null, nowElsewhere: [] })).toBeNull();
    expect(kingstonStory({ firstJobInKingston: 50, stillInKingston: 20, nowElsewhere: undefined as never })?.elsewhere).toEqual([]);
    const messy = kingstonStory({ firstJobInKingston: 100, stillInKingston: 40, nowElsewhere: [
      { name: 'Quebec City', n: 12 }, { name: '', n: 30 }, { name: 'Nowhere', n: 0 }, null as never,
    ] })!;
    expect(messy.elsewhere).toEqual([{ name: 'Québec City', n: 12, pct: 12 }]);
  });

  it('lays out ribbons whose thickness is proportional to people', () => {
    const story = kingstonStory(k)!;
    const lay = kingstonFlowLayout(story, { nodeHeight: 150, minSlot: 20, gap: 6 });
    const counted = lay.bands.filter((b) => b.n != null);
    expect(counted.map((b) => b.kind)).toEqual(['stay', ...story.elsewhere.map(() => 'move')]);
    const perPerson = (counted[0].y1 - counted[0].y0) / counted[0].n!;
    for (const b of counted) {
      expect((b.y1 - b.y0) / b.n!).toBeCloseTo(perPerson, 6);
      expect(b.t1 - b.t0).toBeCloseTo(b.y1 - b.y0, 6);
    }
    // The node stands for the published total, so the stayers take the headline share of it.
    expect((counted[0].y1 - counted[0].y0) / lay.nodeHeight).toBeCloseTo(story.stillPct! / 100, 6);
    // Ribbons leave the node back to back, top to bottom, and never past it.
    for (let i = 1; i < lay.bands.length; i++) expect(lay.bands[i].y0).toBeCloseTo(lay.bands[i - 1].y1, 6);
    expect(lay.bands.at(-1)!.y1).toBeLessThanOrEqual(lay.nodeHeight + 1e-6);
    // Every label gets its own slot, at least minSlot apart; the first ribbon runs straight.
    for (let i = 1; i < lay.bands.length; i++) expect(lay.bands[i].mid - lay.bands[i - 1].mid).toBeGreaterThanOrEqual(20);
    expect(lay.bands[0].t0).toBeCloseTo(lay.bands[0].y0, 6);
    expect(lay.height).toBeGreaterThanOrEqual(lay.bands.at(-1)!.t1);
  });

  it('draws the unlisted remainder without ever counting it', () => {
    const story = kingstonStory(k)!;
    const rest = kingstonFlowLayout(story).bands.filter((b) => b.kind === 'rest');
    expect(rest).toHaveLength(1);
    expect(rest[0].n).toBeNull();
    expect(rest[0].pct).toBeNull();
    // Without a published total the node is just the listed ribbons: no remainder.
    const noTotal = kingstonFlowLayout(kingstonStory({ ...k, firstJobInKingston: null })!);
    expect(noTotal.bands.some((b) => b.kind === 'rest')).toBe(false);
    expect(noTotal.bands.at(-1)!.y1).toBeCloseTo(noTotal.nodeHeight, 6);
    // No stayers published: no "Still in Kingston" ribbon.
    expect(kingstonFlowLayout(kingstonStory({ ...k, stillInKingston: null })!).bands.some((b) => b.kind === 'stay')).toBe(false);
    // Listed counts a little over the total (perturbation) still fit the node.
    const over = kingstonFlowLayout({ firstJob: 100, still: 60, stillPct: 60, elsewhere: [{ name: 'Toronto', n: 45, pct: 45 }] });
    expect(over.bands.at(-1)!.y1).toBeCloseTo(over.nodeHeight, 6);
    expect(kingstonFlowLayout({ firstJob: null, still: null, stillPct: null, elsewhere: [] }).bands).toEqual([]);
  });

  it('builds a closed ribbon path between the node and its destination', () => {
    const d = ribbonPath(10, 110, { y0: 0, y1: 20, t0: 40, t1: 60 });
    expect(d).toBe('M10,0C60,0 60,40 110,40L110,60C60,60 60,20 10,20Z');
  });

  it('backs "the 401 runs mostly one way" with the moves data only', () => {
    const story = kingstonStory(k)!;
    const arcs = resolveFlows(file.flows, byId);
    expect(oneWayToToronto(story, arcs)).toBe(true);
    // Not when the reverse move is more than half the forward one.
    const there = arcs.find((a) => a.key === 'kingston>toronto')!;
    const evened = arcs.map((a) => (a.key === 'toronto>kingston' ? { ...a, n: Math.ceil(there.n / 2) + 1 } : a));
    expect(oneWayToToronto(story, evened)).toBe(false);
    // Not without the forward move, and not when Toronto isn't the top destination.
    expect(oneWayToToronto(story, arcs.filter((a) => a.key !== 'kingston>toronto'))).toBe(false);
    const ottawaFirst = { ...story, elsewhere: [{ name: 'Ottawa', n: 9999, pct: null }, ...story.elsewhere] };
    expect(oneWayToToronto(ottawaFirst, arcs)).toBe(false);
    expect(oneWayToToronto(null, arcs)).toBe(false);
  });
});

describe('cohort names, places and floors', () => {
  it('reads class bands from their ids', () => {
    expect(cohortYears('1995-1999')).toEqual([1995, 1999]);
    expect(cohortYears('pre-1995')).toEqual([null, 1994]);
    expect(cohortYears('all')).toBeNull();
    expect(cohortShort('2000-2004')).toBe('’00–’04');
    expect(cohortShort('pre-1995')).toBe('<’95');
    expect(cohortShort('all')).toBe('All');
    expect(cohortPhrase('2020-2024')).toBe('classes of 2020–2024');
    expect(whoPhrase(f('all', 'all', 'pre-1995'))).toBe('alumni who graduated before 1995');
  });

  it('splits places into Canada and abroad, keeping the order', () => {
    const rows = metroRows(index.byKey.get('all|all|all')!, byId);
    const { canada, abroad } = splitPlaces(rows);
    expect(canada.every((r) => r.metro.country === 'CA')).toBe(true);
    expect(abroad.every((r) => r.metro.country !== 'CA')).toBe(true);
    expect(canada.length + abroad.length).toBe(rows.length);
    expect(canada.map((r) => r.metro.id)).toEqual(rows.filter((r) => r.metro.country === 'CA').map((r) => r.metro.id));
  });

  it('takes the Canada share from the published country count', () => {
    const view = index.byKey.get('all|all|all')!;
    const ca = view.countries.find(([c]) => c === 'CA')![1];
    expect(canadaShare(view)).toBeCloseTo((100 * ca) / view.n);
    expect(canadaShare({ ...view, countries: [] })).toBeNull();
    expect(canadaShare(null)).toBeNull();
  });

  it('reads the floors from meta, falling back to 5 and 10', () => {
    expect(floorsFrom({ k: { field: 5, named: 10 } })).toEqual({ field: 5, named: 10 });
    expect(floorsFrom({ k: { field: 7, named: 12 } })).toEqual({ field: 7, named: 12 });
    expect(floorsFrom(null)).toEqual(DEFAULT_FLOORS);
    expect(floorsFrom({ k: { field: 'x', named: -1 } })).toEqual(DEFAULT_FLOORS);
  });
});

describe('flows', () => {
  it('ignores unknown metro ids, self-moves and empty flows, largest first', () => {
    const arcs = resolveFlows(file.flows, byId);
    expect(arcs.map((a) => a.key)).toEqual([
      'kingston>toronto', 'toronto>kingston', 'toronto>london-gb', 'vancouver>sydney', 'tokyo>vancouver',
    ]);
    expect(resolveFlows([], byId)).toEqual([]);
    expect(resolveFlows(undefined as never, byId)).toEqual([]);
  });

  it('splits moves touching one metro into out and in', () => {
    const arcs = resolveFlows(file.flows, byId);
    const t = flowsFor(arcs, 'toronto');
    expect(t.out.map((a) => a.to.id)).toEqual(['kingston', 'london-gb']);
    expect(t.in.map((a) => a.from.id)).toEqual(['kingston']);
    expect(flowsFor(arcs, 'nobody')).toEqual({ out: [], in: [] });
  });

  it('scales stroke width linearly with a visible floor', () => {
    expect(flowWidth(699, 699)).toBe(10);
    expect(flowWidth(349.5, 699)).toBeCloseTo(5);
    expect(flowWidth(10, 699)).toBe(1.25);
    expect(flowWidth(10, 0)).toBe(1.25);
  });
});

describe('projection & arcs across the antimeridian', () => {
  const frame = makeFrame(1000);

  it('frames every metro, from Whitehorse to Auckland, inside the map', () => {
    expect(frame.height).toBe(mapHeightFor(1000));
    for (const m of METROS) {
      const p = project(frame, m.lon, m.lat)!;
      expect(p.x).toBeGreaterThan(0);
      expect(p.x).toBeLessThan(frame.width);
      expect(p.y).toBeGreaterThan(0);
      expect(p.y).toBeLessThan(frame.height);
    }
  });

  it('letterboxes narrow maps instead of making them a thin strip', () => {
    const narrow = makeFrame(343);
    expect(narrow.height).toBeGreaterThan(Math.round(343 * 0.4308));
    const p = project(narrow, 0, 0)!;
    expect(p.y).toBeGreaterThan(narrow.height * 0.35);
  });

  const pairs: [string, string][] = [
    ['vancouver', 'sydney'], ['tokyo', 'vancouver'], ['sydney', 'tokyo'], ['whitehorse', 'auckland'], ['auckland', 'whitehorse'],
  ];
  it.each(pairs)('draws %s → %s as one continuous curve that stays on the map', (a, b) => {
    const p0 = project(frame, byId.get(a)!.lon, byId.get(a)!.lat)!;
    const p1 = project(frame, byId.get(b)!.lon, byId.get(b)!.lat)!;
    const c = arcControl(p0, p1, frame);
    const arc = arcPath(p0, c, p1, 0, 0)!;
    expect(arc.d.match(/M/g)).toHaveLength(1);
    expect(arc.d.match(/Q/g)).toHaveLength(1);
    expect(arc.d).not.toMatch(/NaN|Infinity/);
    const xs: number[] = [];
    for (let i = 0; i <= 50; i++) {
      const q = quadAt(p0, c, p1, i / 50);
      xs.push(q.x);
      expect(q.x).toBeGreaterThanOrEqual(0);
      expect(q.x).toBeLessThanOrEqual(frame.width);
      expect(q.y).toBeGreaterThanOrEqual(0);
      expect(q.y).toBeLessThanOrEqual(frame.height);
    }
    // No wrap-around: the curve's horizontal reach never exceeds the straight chord plus its bulge.
    const span = Math.max(...xs) - Math.min(...xs);
    expect(span).toBeLessThanOrEqual(Math.abs(p1.x - p0.x) + 2 * 140 + 1);
  });

  it('bends opposite ways for A→B and B→A so return flows stay separate', () => {
    const k = project(frame, byId.get('kingston')!.lon, byId.get('kingston')!.lat)!;
    const t = project(frame, byId.get('toronto')!.lon, byId.get('toronto')!.lat)!;
    const ab = arcControl(k, t, frame);
    const ba = arcControl(t, k, frame);
    const side = (p0: Pt, p1: Pt, q: Pt) => Math.sign((p1.x - p0.x) * (q.y - p0.y) - (p1.y - p0.y) * (q.x - p0.x));
    expect(side(k, t, ab)).toBe(-side(k, t, ba));
  });

  it('trims arcs to bubble edges and rejects degenerate ones', () => {
    const p0 = { x: 0, y: 100 };
    const p1 = { x: 200, y: 100 };
    const c = arcControl(p0, p1, { width: 400, height: 400 });
    const arc = arcPath(p0, c, p1, 0, 20)!;
    expect(Math.hypot(arc.end.x - p1.x, arc.end.y - p1.y)).toBeGreaterThan(12);
    expect(Math.hypot(arc.end.x - p1.x, arc.end.y - p1.y)).toBeLessThan(30);
    expect(arcPath(p0, p0, p0)).toBeNull();
    expect(arcControl(p0, p0, { width: 10, height: 10 })).toEqual({ x: 0, y: 100 });
  });
});

describe('zoom helpers', () => {
  const frame = makeFrame(1000);
  const rowsOf = (key: string) => metroRows(index.byKey.get(key)!, byId);
  const onScreen = (t: { k: number; x: number; y: number }, fr: typeof frame, lon: number, lat: number, pad = 0) => {
    const s = applyTransform(t, project(fr, lon, lat)!);
    return s.x >= pad && s.x <= fr.width - pad && s.y >= pad && s.y <= fr.height - pad;
  };

  it('opens on North America, Ontario & Québec for moves, and fits one-country filters', () => {
    expect(autoTarget(rowsOf('all|all|all'))).toEqual({ kind: 'region', id: 'north-america' });
    expect(autoTarget(rowsOf('all|all|all'), { moves: true })).toEqual({ kind: 'region', id: 'ontario-quebec' });
    expect(autoTarget([])).toEqual({ kind: 'region', id: 'north-america' });
    const cs = rowsOf('undergrad|Computer Science|all');
    const fit = autoTarget(cs);
    expect(fit.kind).toBe('fit');
    const t = targetTransform(frame, fit);
    expect(t.k).toBeGreaterThan(1);
    // Every place is on screen, clear of the edges.
    for (const r of cs) expect(onScreen(t, frame, r.metro.lon, r.metro.lat, 20)).toBe(true);
    // Two nearby places still get some context (minSpan), not a street-level zoom.
    const two = targetTransform(frame, autoTarget(rowsOf('undergrad|Computer Science|2015-2019')));
    expect(two.k).toBeLessThanOrEqual(regionTransform(frame, 'ontario-quebec').k);
    expect(two.k).toBeGreaterThan(regionTransform(frame, 'north-america').k);
  });

  it('adjusts the opening view for a metro selected in the URL', () => {
    const na: MapTarget = { kind: 'region', id: 'north-america' };
    const at = (id: string) => byId.get(id)!;
    expect(targetWithSelection(na, null)).toBe(na);
    expect(targetWithSelection(na, at('kingston'))).toEqual({ kind: 'region', id: 'ontario-quebec' });
    expect(targetWithSelection(na, at('vancouver'))).toBe(na);
    expect(targetWithSelection(na, at('london-gb'))).toEqual({ kind: 'region', id: 'europe' });
    expect(targetWithSelection(na, at('sydney'))).toEqual({ kind: 'region', id: 'world' });
    const fit: MapTarget = { kind: 'fit', points: [[-79, 43]] };
    expect(targetWithSelection(fit, at('vancouver'))).toEqual({ kind: 'fit', points: [[-79, 43], [at('vancouver').lon, at('vancouver').lat]] });
  });

  it('knows which preset contains a place', () => {
    expect(inRegion(-76.5, 44.2, 'ontario-quebec')).toBe(true);
    expect(inRegion(-123, 49, 'ontario-quebec')).toBe(false);
    expect(inRegion(151, -33, 'world')).toBe(true);
    expect(smallestRegion(-76.5, 44.2)).toBe('ontario-quebec');
    expect(smallestRegion(-0.1, 51.5)).toBe('europe');
    expect(smallestRegion(-123, 49)).toBe('north-america');
    expect(smallestRegion(151, -33)).toBe('world');
  });

  it('keeps the same place centred, at the same zoom, across a resize', () => {
    const wide = makeFrame(1000);
    const narrow = makeFrame(600);
    const centreOf = (fr: typeof wide, t: { k: number; x: number; y: number }) =>
      fr.projection.invert!([(fr.width / 2 - t.x) / t.k, (fr.height / 2 - t.y) / t.k])!;
    const t = centerOn(project(wide, -76.5, 44.2)!, 6, wide.width, wide.height);
    const next = carryTransform(wide, t, narrow);
    expect(next.k).toBe(6);
    const [lon, lat] = centreOf(narrow, next);
    expect(lon).toBeCloseTo(-76.5, 1);
    expect(lat).toBeCloseTo(44.2, 1);
    expect(carryTransform(wide, IDENTITY, narrow)).toEqual(IDENTITY);
  });

  it('keeps transforms inside the map', () => {
    expect(clampTransform({ k: 0.2, x: 50, y: 50 }, 1000, 430)).toEqual(IDENTITY);
    const t = clampTransform({ k: 4, x: -99999, y: 10 }, 1000, 430);
    expect(t).toEqual({ k: 4, x: -3000, y: 0 });
    expect(clampTransform({ k: 999, x: 0, y: 0 }, 1000, 430).k).toBe(40);
  });

  it('World is the identity; Ontario & Québec puts the 401 corridor on screen', () => {
    expect(regionTransform(frame, 'world')).toEqual(IDENTITY);
    const t = regionTransform(frame, 'ontario-quebec');
    expect(t.k).toBeGreaterThan(5);
    for (const id of ['toronto', 'kingston', 'ottawa']) {
      const m = byId.get(id)!;
      const s = applyTransform(t, project(frame, m.lon, m.lat)!);
      expect(s.x).toBeGreaterThan(0);
      expect(s.x).toBeLessThan(frame.width);
      expect(s.y).toBeGreaterThan(0);
      expect(s.y).toBeLessThan(frame.height);
    }
    for (const r of REGIONS) expect(regionTransform(frame, r.id).k).toBeGreaterThanOrEqual(1);
  });

  it('zooms a region about as far on a phone as on a desktop', () => {
    const phone = makeFrame(343);
    const kPhone = regionTransform(phone, 'ontario-quebec').k;
    const kDesk = regionTransform(frame, 'ontario-quebec').k;
    expect(kPhone).toBeGreaterThan(kDesk * 0.8);
  });

  it('fits points, including a single one and none', () => {
    expect(fitPoints([], 1000, 430)).toEqual(IDENTITY);
    const one = fitPoints([{ x: 500, y: 200 }], 1000, 430, { maxK: 10 });
    expect(one.k).toBe(10);
    // A lone point is framed by minSpan (a fraction of the width), whatever the screen size.
    expect(fitPoints([{ x: 50, y: 20 }], 100, 43, { pad: 0, minSpan: 0.1 }).k).toBeCloseTo(10);
    expect(applyTransform(one, { x: 500, y: 200 })).toEqual({ x: 500, y: 215 });
    expect(fitPoints([{ x: NaN, y: 1 }], 1000, 430)).toEqual(IDENTITY);
  });
});

describe('bubble sizing & hit testing', () => {
  it('uses area-true sqrt radii with a floor', () => {
    const r = radiusScale(10000, 1000);
    expect(r(10000)).toBeCloseTo(34);
    expect(r(2500) * 2).toBeCloseTo(r(10000));
    expect(r(1)).toBe(MIN_R);
    expect(r(0)).toBe(MIN_R);
    expect(radiusScale(0, 1000)(50)).toBe(MIN_R);
    expect(radiusScale(10000, 343)(10000)).toBeLessThan(radiusScale(10000, 1000)(10000));
  });

  it('grows bubbles gently with zoom', () => {
    expect(zoomRadiusFactor(1)).toBe(1);
    expect(zoomRadiusFactor(0.5)).toBe(1);
    expect(zoomRadiusFactor(16)).toBeGreaterThan(1.3);
    expect(zoomRadiusFactor(1e6)).toBe(1.6);
  });

  it('picks round legend values', () => {
    expect(sizeLegendValues(30120)).toEqual([20000, 2000, 500]);
    expect(sizeLegendValues(595)).toEqual([500, 50, 10]);
    expect(sizeLegendValues(10)).toEqual([10]);
    expect(sizeLegendValues(5)).toEqual([]);
  });

  it('lays legend circles side by side, bottom-aligned', () => {
    const l = sizeLegendLayout([{ v: 1000, r: 20 }, { v: 100, r: 6 }]);
    expect(l.items[0].cy + l.items[0].r).toBeCloseTo(l.items[1].cy + l.items[1].r);
    expect(l.items[1].cx - l.items[1].r).toBeGreaterThan(l.items[0].cx + l.items[0].r);
    expect(l.width).toBeGreaterThan(l.items[1].cx);
    expect(sizeLegendLayout([]).items).toEqual([]);
  });

  it('prefers the nearest centre, so small bubbles on top of big ones stay reachable', () => {
    const big = { id: 'big', x: 100, y: 100, r: 40 };
    const small = { id: 'small', x: 130, y: 100, r: 2 };
    expect(pickNearest([big, small], 100, 100)?.id).toBe('big');
    expect(pickNearest([big, small], 128, 101)?.id).toBe('small');
    expect(pickNearest([big, small], 300, 300)).toBeNull();
    // A 2px dot still has a 12px hit radius.
    expect(pickNearest([small], 141, 100)?.id).toBe('small');
    expect(pickNearest([], 0, 0)).toBeNull();
  });
});

describe('label placement', () => {
  const lbl = (id: string, x: number, y: number, priority: number, extra: Partial<LabelCandidate> = {}): LabelCandidate =>
    ({ id, x, y, r: 5, width: 60, height: 14, priority, ...extra });
  const boxesOverlap = (a: { x0: number; y0: number; x1: number; y1: number }, b: typeof a) =>
    a.x0 < b.x1 && a.x1 > b.x0 && a.y0 < b.y1 && a.y1 > b.y0;

  it('never overlaps labels and keeps them inside the frame', () => {
    const cands = Array.from({ length: 40 }, (_, i) => lbl(`m${i}`, 50 + (i % 8) * 20, 50 + Math.floor(i / 8) * 12, 100 - i));
    const placed = placeLabels(cands, { width: 300, height: 200 });
    expect(placed.length).toBeGreaterThan(0);
    expect(placed.length).toBeLessThan(40);
    for (const p of placed) {
      expect(p.box.x0).toBeGreaterThanOrEqual(2);
      expect(p.box.x1).toBeLessThanOrEqual(298);
      for (const q of placed) if (p !== q) expect(boxesOverlap(p.box, q.box)).toBe(false);
    }
  });

  it('places the highest priority first and flips labels near the right edge', () => {
    const placed = placeLabels([lbl('low', 100, 100, 1), lbl('high', 100, 100, 9), lbl('edge', 290, 50, 5)], { width: 300, height: 200 });
    expect(placed[0].id).toBe('high');
    expect(placed.find((p) => p.id === 'edge')?.anchor).toBe('end');
  });

  it('keeps labels off other bubbles, but always places a forced (selected) label', () => {
    const obstacles = [{ id: 'blob', x: 150, y: 100, r: 120 }];
    expect(placeLabels([lbl('a', 150, 100, 1)], { width: 300, height: 200, obstacles })).toEqual([]);
    const forced = placeLabels([lbl('a', 150, 100, 1, { force: true })], { width: 300, height: 200, obstacles });
    expect(forced).toHaveLength(1);
    expect(placeLabels([lbl('a', NaN, 1, 1)], { width: 300, height: 200 })).toEqual([]);
  });

  it('always places forced labels: further out with a leader line, never on top of another label', () => {
    // A big bubble with two crowded neighbours: near slots are blocked, so forced labels move out.
    const obstacles = [{ id: 'big', x: 150, y: 100, r: 40 }, { id: 'a', x: 175, y: 95, r: 14 }, { id: 'b', x: 185, y: 110, r: 12 }];
    const placed = placeLabels([
      lbl('big', 150, 100, 100, { r: 40, force: true }),
      lbl('a', 175, 95, 50, { r: 14, force: true }),
      lbl('b', 185, 110, 40, { r: 12, force: true }),
    ], { width: 400, height: 250, obstacles });
    expect(placed.map((p) => p.id).sort()).toEqual(['a', 'b', 'big']);
    for (const p of placed) for (const q of placed) if (p !== q) expect(boxesOverlap(p.box, q.box)).toBe(false);
    for (const p of placed.filter((x) => x.leader)) {
      // The leader starts on its bubble's edge and ends on its label's box.
      const o = obstacles.find((c) => c.id === p.id)!;
      expect(Math.hypot(p.leader!.x1 - o.x, p.leader!.y1 - o.y)).toBeCloseTo(o.r, 0);
      expect(p.leader!.x2).toBeGreaterThanOrEqual(p.box.x0 - 0.01);
      expect(p.leader!.x2).toBeLessThanOrEqual(p.box.x1 + 0.01);
    }
  });

  it('labels the top places at every zoom, even under a big neighbour', () => {
    const frame = makeFrame(960);
    const rows = metroRows(index.byKey.get('all|all|all')!, byId);
    const rOf = radiusScale(rows[0].n, frame.width);
    const bubblesAt = (t: { k: number; x: number; y: number }): LabelBubble[] => rows.map((r) => {
      const s = applyTransform(t, project(frame, r.metro.lon, r.metro.lat)!);
      return { id: r.metro.id, x: s.x, y: s.y, r: rOf(r.n) * zoomRadiusFactor(t.k), n: r.n, text: `${r.metro.name} 99k` };
    });
    for (const region of ['north-america', 'ontario-quebec', 'world'] as const) {
      const t = regionTransform(frame, region);
      const bubbles = bubblesAt(t);
      const labels = mapLabels(bubbles, { width: frame.width, height: frame.height, k: t.k });
      const ids = new Set(labels.map((l) => l.id));
      const visible = (b: LabelBubble) => b.x > 0 && b.x < frame.width && b.y > 0 && b.y < frame.height;
      for (const b of bubbles.slice(0, ALWAYS_LABEL)) if (visible(b)) expect(ids.has(b.id), `${b.id} at ${region}`).toBe(true);
      for (const p of labels) for (const q of labels) if (p !== q) expect(boxesOverlap(p.box, q.box)).toBe(false);
    }
    // Kingston and Ottawa sit under Toronto's bubble at North America zoom: still labelled.
    const t = regionTransform(frame, 'north-america');
    const ids = mapLabels(bubblesAt(t), { width: frame.width, height: frame.height, k: t.k }).map((l) => l.id);
    expect(ids).toEqual(expect.arrayContaining(['toronto', 'kingston', 'ottawa']));
  });

  it('labels the selected place even when it is small', () => {
    const many: LabelBubble[] = Array.from({ length: 8 }, (_, i) => ({ id: `m${i}`, x: 40 + i * 40, y: 100, r: 3, n: 1000 - i, text: 'M' }));
    const small: LabelBubble = { id: 'small', x: 380, y: 150, r: 1.6, n: 1, text: 'Small' };
    expect(mapLabels([...many, small], { width: 400, height: 200, k: 1 }).map((l) => l.id)).not.toContain('small');
    expect(mapLabels([...many, small], { width: 400, height: 200, k: 1, selectedId: 'small' }).map((l) => l.id)).toContain('small');
  });

  it('estimates text width monotonically', () => {
    expect(estimateTextWidth('Toronto 31k', 12)).toBeGreaterThan(estimateTextWidth('Toronto', 12));
    expect(estimateTextWidth('', 12)).toBe(2);
  });
});

describe('hand-drawn lakes', () => {
  it('winds every lake clockwise so none paints the whole globe', () => {
    for (const lake of LAKES.features) {
      expect(ringIsClockwise(lake.geometry.coordinates[0])).toBe(true);
      expect(geoArea(lake)).toBeLessThan(0.01);
    }
    const ccw = [[0, 0], [10, 0], [10, 10], [0, 10]];
    expect(ringIsClockwise(ccw)).toBe(false);
    const fixed = normaliseRing(ccw);
    expect(ringIsClockwise(fixed)).toBe(true);
    expect(fixed[0]).toEqual(fixed[fixed.length - 1]);
  });

  it('puts water in the middle of Lake Ontario and not in Kingston', () => {
    const ontario = LAKES.features.find((l) => l.properties?.name === 'Lake Ontario')!;
    expect(geoContains(ontario, [-77.9, 43.6])).toBe(true);
    expect(geoContains(ontario, [-76.486, 44.26])).toBe(false);
  });
});
