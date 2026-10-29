import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { FamilyId, RiverFile, YearPoint } from '../../data/types';
import {
  BOTTOM_FAMILIES, COHORT_ORDER, DEFAULT_FILTERS, DEFAULT_TAB, REST, SMALL_CLASS, buildSankeyInput, canonicalProgram,
  classesPhrase, classesReached, cohortPhrase, cohortYears, cohortsWithSlice, compareFamilies, defaultYearIndex,
  fallbackCohort, familyDescription, familyLabel, familyRank, familyShort, findSlice, firstAndLast, firstPartialYear,
  groupColor, groupFields, groupOf, lastJune, levelsWithProgram, parseCohort, parseLevel, parseTab, pickSlice,
  populationLabel, programExists, programTag, programsForLevel, resolveFilters, rollUpSlice, sliceTitle,
  snapshotLabel, stackRow, stageYear, stickerNote, summaryParts, summarySentence, tableRows, thenVsNow, toneOf,
  yearList, yearReadout, yearSeries, yearTableRows,
} from './model';
import { allAlumni, commerce, makeSlice, recent, river, smallProgram } from './testFixture';

const Y = (year: number | 'now', n: number, fields: [FamilyId, number][]): YearPoint => ({ year, n, fields });

describe('URL parsing & filter resolution', () => {
  it('accepts known levels, cohorts and tabs, rejects anything else', () => {
    expect(parseLevel('law')).toBe('law');
    expect(parseLevel('LAW')).toBeNull();
    expect(parseLevel('phd')).toBeNull();
    expect(parseCohort('2015-2019')).toBe('2015-2019');
    expect(parseCohort('2015–2019')).toBeNull(); // en dash is not an id
    expect(parseCohort('2005-2015')).toBeNull(); // the old ten-year bands are gone
    expect(parseCohort('')).toBeNull();
    expect(parseTab('years')).toBe('years');
    expect(parseTab('flow')).toBe('flow');
    expect(parseTab('table')).toBeNull();
    expect(DEFAULT_TAB).toBe('flow');
  });

  it('knows the five-year bands, oldest first', () => {
    expect(COHORT_ORDER).toEqual(['1995-1999', '2000-2004', '2005-2009', '2010-2014', '2015-2019', '2020-2024']);
  });

  it('falls back to defaults for missing or unknown values', () => {
    expect(resolveFilters(river, {})).toEqual({ ...DEFAULT_FILTERS, dropped: null });
    expect(resolveFilters(river, { level: 'bogus', program: '', cohort: '1890-1900' })).toEqual({ ...DEFAULT_FILTERS, dropped: null });
    expect(resolveFilters(river, { program: 'all' })).toEqual({ ...DEFAULT_FILTERS, dropped: null });
    expect(DEFAULT_FILTERS).toEqual({ level: 'all', program: 'all', cohort: '2010-2014' });
    // an old link with a ten-year band lands on the default class
    expect(resolveFilters(river, { cohort: '2005-2015' }).cohort).toBe('2010-2014');
  });

  it('handles the inbound links other pages send', () => {
    // Home, for a program with no River: the level's all-programs view, not the default level
    expect(resolveFilters(river, { level: 'undergrad' })).toEqual({ level: 'undergrad', program: 'all', cohort: '2010-2014', dropped: null });
    // ... and when that level has no River for the default class, all classes rather than a dead end
    expect(resolveFilters(river, { level: 'medicine' })).toEqual({ level: 'medicine', program: 'all', cohort: 'all', dropped: null });
    // Home's summary card: a class only
    expect(resolveFilters(river, { cohort: '2010-2014' })).toEqual({ level: 'all', program: 'all', cohort: '2010-2014', dropped: null });
    expect(resolveFilters(river, { cohort: '2020-2024' })).toEqual({ level: 'all', program: 'all', cohort: '2020-2024', dropped: null });
    // Twin: level and program, no class -> the default class if the program has it, else all classes, else the nearest
    expect(resolveFilters(river, { level: 'undergrad', program: 'Commerce' }).cohort).toBe('2010-2014');
    expect(resolveFilters(river, { level: 'undergrad', program: 'Economics' }).cohort).toBe('all');
    expect(resolveFilters(river, { level: 'undergrad', program: 'Biology' }).cohort).toBe('2015-2019');
    expect(resolveFilters(river, { program: 'biology' })).toMatchObject({ level: 'undergrad', program: 'Biology', cohort: '2015-2019' });
    // an unknown class counts as none; a class the link names is kept even without a River (the view explains)
    expect(resolveFilters(river, { level: 'undergrad', program: 'Biology', cohort: '2005-2015' }).cohort).toBe('2015-2019');
    expect(resolveFilters(river, { level: 'undergrad', program: 'Biology', cohort: '1995-1999' }).cohort).toBe('1995-1999');
  });

  it('drops a program that has no River at the level, and reports it', () => {
    expect(resolveFilters(river, { level: 'undergrad', program: 'Underwater Basket Weaving' }))
      .toEqual({ level: 'undergrad', program: 'all', cohort: '2010-2014', dropped: 'Underwater Basket Weaving' });
    expect(resolveFilters(river, { level: 'law', program: 'Commerce', cohort: 'all' }))
      .toEqual({ level: 'law', program: 'all', cohort: 'all', dropped: 'Commerce' });
    // a link from Career Twin: the program exists at another level only
    expect(resolveFilters(river, { level: 'graduate', program: 'Computer Engineering' }))
      .toMatchObject({ level: 'graduate', program: 'all', dropped: 'Computer Engineering' });
  });

  it('matches program names case-insensitively and reports the canonical spelling', () => {
    expect(resolveFilters(river, { level: 'undergrad', program: 'commerce' })).toMatchObject({ program: 'Commerce', dropped: null });
    expect(resolveFilters(river, { program: 'COMMERCE' })).toMatchObject({ level: 'undergrad', program: 'Commerce' });
    expect(resolveFilters(river, { program: '  art   history ' })).toMatchObject({ level: 'undergrad', program: 'Art History' });
    expect(resolveFilters(river, { level: 'law', program: 'commerce' })).toMatchObject({ program: 'all', dropped: 'Commerce' });
  });

  it('keeps a valid level/program/cohort as is', () => {
    expect(resolveFilters(river, { level: 'undergrad', program: 'Commerce', cohort: '2020-2024' }))
      .toEqual({ level: 'undergrad', program: 'Commerce', cohort: '2020-2024', dropped: null });
  });

  it('infers the level for a program-only link, picking the largest level that has it', () => {
    expect(resolveFilters(river, { program: 'Commerce' }).level).toBe('undergrad');
    // Economics exists at undergrad (1,092) and graduate (406)
    expect(resolveFilters(river, { level: 'all', program: 'Economics' })).toMatchObject({ level: 'undergrad', program: 'Economics' });
    // an unknown level is treated like no level
    expect(resolveFilters(river, { level: 'nope', program: 'Commerce' })).toMatchObject({ level: 'undergrad', program: 'Commerce' });
    expect(resolveFilters(river, { program: 'Nope' })).toEqual({ level: 'all', program: 'all', cohort: '2010-2014', dropped: 'Nope' });
  });

  it('level "all" only ever has program "all"', () => {
    expect(programExists(river, 'all', 'all')).toBe(true);
    expect(programExists(river, 'all', 'Commerce')).toBe(false);
    expect(programExists(river, 'undergrad', 'Commerce')).toBe(true);
    expect(programExists(river, 'graduate', 'Commerce')).toBe(false);
  });

  it('finds the canonical program name, preferring an exact match, then the level', () => {
    const twoSpellings: RiverFile = {
      ...river,
      slices: [
        makeSlice({ level: 'undergrad', program: 'Data Science', cohort: 'all' }),
        makeSlice({ level: 'graduate', program: 'Data science', cohort: 'all' }),
      ],
    };
    expect(canonicalProgram(twoSpellings, 'Data science')).toBe('Data science');
    expect(canonicalProgram(twoSpellings, 'data SCIENCE', 'graduate')).toBe('Data science');
    expect(canonicalProgram(twoSpellings, 'data science')).toBe('Data Science');
    expect(canonicalProgram(river, 'nothing')).toBeNull();
    expect(canonicalProgram(river, '   ')).toBeNull();
  });

  it('lists the levels that have a program, largest first', () => {
    expect(levelsWithProgram(river, 'Economics')).toEqual([{ level: 'undergrad', n: 1092 }, { level: 'graduate', n: 406 }]);
    expect(levelsWithProgram(river, 'Computer Engineering')).toEqual([{ level: 'undergrad', n: 507 }]);
    expect(levelsWithProgram(river, 'Nope')).toEqual([]);
  });
});

describe('class availability', () => {
  it('lists the classes that have a River for a program', () => {
    expect([...cohortsWithSlice(river, 'undergrad', 'Art History')].sort()).toEqual(['2010-2014', 'all']);
    expect([...cohortsWithSlice(river, 'undergrad', 'Biology')]).toEqual(['2015-2019']);
    expect(cohortsWithSlice(river, 'undergrad', 'Nope').size).toBe(0);
  });

  it('falls back to all classes, then the nearest class, so a change never dead-ends', () => {
    expect(fallbackCohort(river, 'undergrad', 'Commerce', '2010-2014')).toBe('2010-2014');
    expect(fallbackCohort(river, 'undergrad', 'Art History', '1995-1999')).toBe('all');
    expect(fallbackCohort(river, 'undergrad', 'Biology', '2010-2014')).toBe('2015-2019');
    expect(fallbackCohort(river, 'undergrad', 'Biology', 'all')).toBe('2015-2019');
    expect(fallbackCohort(river, 'undergrad', 'Biology', '1995-1999')).toBe('2015-2019');
    expect(fallbackCohort(river, 'undergrad', 'Nope', '2010-2014')).toBeNull();
  });
});

describe('programsForLevel', () => {
  it('level "all" offers only "All programs"', () => {
    expect(programsForLevel(river, 'all')).toEqual([{ value: 'all', label: 'All programs', n: 41489 }]);
  });

  it('lists "All programs" first, then largest first by the all-classes slice', () => {
    const opts = programsForLevel(river, 'undergrad');
    expect(opts.map((o) => o.value)).toEqual(['all', 'Commerce', 'Economics', 'Computer Engineering', 'Art History', 'Biology']);
    expect(opts[1]).toEqual({ value: 'Commerce', label: 'Commerce', n: 3533 });
  });

  it('falls back to the biggest slice when a program has no all-classes slice', () => {
    expect(programsForLevel(river, 'law')).toEqual([
      { value: 'all', label: 'All programs', n: null },
      { value: 'Law', label: 'Law', n: 837 },
    ]);
    // Biology only has a 2015-2019 slice (120)
    expect(programsForLevel(river, 'undergrad').find((o) => o.value === 'Biology')?.n).toBe(120);
  });

  it('breaks ties alphabetically', () => {
    const tie: RiverFile = {
      ...river,
      slices: [
        makeSlice({ level: 'mba', program: 'Zeta', cohort: 'all', n: 100 }),
        makeSlice({ level: 'mba', program: 'Alpha', cohort: 'all', n: 100 }),
      ],
    };
    expect(programsForLevel(tie, 'mba').map((o) => o.value)).toEqual(['all', 'Alpha', 'Zeta']);
  });
});

describe('pickSlice', () => {
  it('returns the slice when it exists', () => {
    const pick = pickSlice(river, 'undergrad', 'Commerce', '2010-2014');
    expect(pick).toEqual({ status: 'ok', slice: commerce });
  });

  it('offers alternatives for a missing combo: same program first, then nearest class, then the level', () => {
    const pick = pickSlice(river, 'undergrad', 'Art History', '1995-1999');
    expect(pick.status).toBe('missing');
    if (pick.status !== 'missing') return;
    expect(pick.alternatives.map((a) => [a.level, a.program, a.cohort])).toEqual([
      ['undergrad', 'Art History', 'all'],
      ['undergrad', 'Art History', '2010-2014'],
      ['undergrad', 'all', '1995-1999'],
      ['all', 'all', '1995-1999'],
    ]);
    expect(pick.alternatives[0]).toMatchObject({ label: 'Art History, all classes', n: 183 });
    expect(pick.alternatives[1].label).toBe('Art History, class of 2010–2014');
    expect(pick.alternatives[2].label).toBe('All undergrads, class of 1995–1999');
    // every suggestion really exists
    for (const a of pick.alternatives) expect(findSlice(river, a.level, a.program, a.cohort)).toBeDefined();
  });

  it('never suggests duplicates and caps the list at four', () => {
    const pick = pickSlice(river, 'undergrad', 'Biology', '2020-2024');
    if (pick.status !== 'missing') throw new Error('expected missing');
    const keys = pick.alternatives.map((a) => `${a.level}|${a.program}|${a.cohort}`);
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys.length).toBeLessThanOrEqual(4);
    expect(keys[0]).toBe('undergrad|Biology|2015-2019');
  });

  it('handles a missing level-wide combo (level "all") without suggesting itself', () => {
    const pick = pickSlice(river, 'all', 'all', '2015-2019');
    if (pick.status !== 'missing') throw new Error('expected missing');
    expect(pick.alternatives[0]).toMatchObject({ level: 'all', program: 'all', cohort: 'all', label: 'All alumni, all classes' });
    // the nearest band that exists, the later one on a tie
    expect(pick.alternatives[1]).toMatchObject({ cohort: '2020-2024', label: 'All alumni, class of 2020–2024' });
    expect(pick.alternatives.some((a) => a.cohort === '2015-2019')).toBe(false);
  });

  it('returns an empty list rather than crashing on an empty file', () => {
    expect(pickSlice({ ...river, slices: [] }, 'all', 'all', 'all')).toEqual({ status: 'missing', alternatives: [] });
  });
});

describe('field order', () => {
  it('puts job fields in taxonomy order and non-job states at the bottom', () => {
    const ids: FamilyId[] = ['no_role_listed', 'smaller_groups', 'further_study', 'other', 'finance_accounting', 'tech'];
    expect([...ids].sort(compareFamilies)).toEqual(['tech', 'finance_accounting', 'other', 'further_study', 'no_role_listed', 'smaller_groups']);
    expect(BOTTOM_FAMILIES).toEqual(['further_study', 'no_role_listed', 'smaller_groups']);
  });

  it('places ids the taxonomy does not know after known jobs, before the bottom group', () => {
    expect(familyRank('space_mining')).toBeGreaterThan(familyRank('other'));
    expect(familyRank('space_mining')).toBeLessThan(familyRank('further_study'));
    expect(['zoo_keeping', 'space_mining'].sort(compareFamilies)).toEqual(['space_mining', 'zoo_keeping']);
    expect(familyLabel('space_mining')).toBe('Space mining');
    expect(familyShort('space_mining')).toBe('Space mining');
    expect(familyLabel('finance_accounting')).toBe('Finance & accounting');
    expect(familyShort('finance_accounting')).toBe('Finance');
    expect(familyShort('no_role_listed')).toBe('No role');
  });

  it('sorts sectors at their first field’s place', () => {
    const ids = ['no_role_listed', 'sector:engineering', 'teaching', 'sector:finance', 'tech', 'other', 'sector:health'];
    expect([...ids].sort(compareFamilies)).toEqual(['tech', 'sector:finance', 'sector:health', 'teaching', 'sector:engineering', 'other', 'no_role_listed']);
  });

  it('gives same-colour neighbours different tones, starting solid', () => {
    const tones = toneOf(['tech', 'finance_accounting', 'consulting', 'other', 'no_role_listed', 'smaller_groups']);
    expect(tones.get('tech')).toBe(1);
    expect(tones.get('finance_accounting')).toBe(1);
    expect(tones.get('consulting')).toBeLessThan(1); // same sector as finance
    expect(tones.get('other')).toBe(1);
    expect(tones.get('no_role_listed')).toBeLessThan(1); // neutral, after "other"
    expect(tones.get('smaller_groups')).not.toBe(tones.get('no_role_listed'));
  });
});

describe('rolling fields up into sectors', () => {
  it('maps fields to sectors, keeping single-field sectors and non-job states as they are', () => {
    expect(groupOf('finance_accounting')).toBe('sector:finance');
    expect(groupOf('consulting')).toBe('sector:finance');
    expect(groupOf('operations_management')).toBe('sector:management');
    expect(groupOf('tech')).toBe('tech');
    expect(groupOf('teaching')).toBe('teaching'); // further study is not a job, so teaching is alone
    for (const id of ['further_study', 'no_role_listed', 'smaller_groups', 'other', 'space_mining']) expect(groupOf(id)).toBe(id);
    expect(groupFields('sector:finance')).toEqual(['finance_accounting', 'consulting']);
    expect(groupFields('law')).toEqual(['law']);
  });

  it('labels, colours and describes sectors, with the field floor from the data', () => {
    expect(familyLabel('sector:finance')).toBe('Finance & consulting');
    expect(familyShort('sector:finance')).toBe('Finance');
    expect(groupColor('sector:finance')).toBe('var(--sector-2)');
    expect(groupColor('finance_accounting')).toBe('var(--sector-2)');
    expect(groupColor('space_mining')).toBe('var(--sector-neutral)');
    expect(familyDescription('sector:public')).toBe('Combines Law, Government & policy and Nonprofit & community');
    expect(familyDescription('smaller_groups')).toMatch(/^Fields with fewer than 5 people/);
    expect(familyDescription('smaller_groups', 7)).toMatch(/^Fields with fewer than 7 people/);
    expect(familyDescription('smaller_groups')).not.toMatch(/famil/i);
  });

  const slice = makeSlice({
    n: 1000,
    stages: ['s0', 'y3'],
    totals: {
      s0: { finance_accounting: 200, consulting: 50, tech: 100, further_study: 80, no_role_listed: 40, smaller_groups: 20, other: 12 },
      y3: { finance_accounting: 180, consulting: 90, law: 30, government_policy: 20, tech: 110 },
    },
    links: [
      { from_stage: 's0', from: 'finance_accounting', to_stage: 'y3', to: 'finance_accounting', n: 150 },
      { from_stage: 's0', from: 'finance_accounting', to_stage: 'y3', to: 'consulting', n: 20 },
      { from_stage: 's0', from: 'consulting', to_stage: 'y3', to: 'consulting', n: 30 },
      { from_stage: 's0', from: 'further_study', to_stage: 'y3', to: 'law', n: 15 },
      { from_stage: 's0', from: 'further_study', to_stage: 'y3', to: 'government_policy', n: 11 },
      { from_stage: 's0', from: 'tech', to_stage: 'y3', to: 'tech', n: 90 },
    ],
    details: {
      s0: {
        tech: { employers: [{ name: 'Shopify', n: 20 }], titles: [] },
        finance_accounting: { employers: [{ name: 'RBC', n: 40 }], titles: [] },
      },
    },
  });
  const up = rollUpSlice(slice);

  it('adds up published totals per sector and keeps the rest separate', () => {
    expect(up.totals.s0).toEqual({ 'sector:finance': 250, tech: 100, further_study: 80, no_role_listed: 40, smaller_groups: 20, other: 12 });
    expect(up.totals.y3).toEqual({ 'sector:finance': 270, 'sector:public': 50, tech: 110 });
    expect(up.parts?.y3?.['sector:finance']).toEqual([['finance_accounting', 180], ['consulting', 90]]);
    expect(up.parts?.s0?.tech).toBeUndefined();
    expect(up.n).toBe(1000);
    expect(up).not.toHaveProperty('years'); // the year series is rolled up on its own (yearSeries)
  });

  it('adds up published links between the same pair of nodes', () => {
    const byKey = Object.fromEntries(up.links.map((l) => [`${l.from}>${l.to}`, l.n]));
    expect(byKey).toEqual({
      'sector:finance>sector:finance': 200,
      'further_study>sector:public': 26,
      'tech>tech': 90,
    });
  });

  it('keeps employer lists only for nodes that are still one field', () => {
    expect(up.details.s0?.tech?.employers[0].name).toBe('Shopify');
    expect(up.details.s0?.['sector:finance']).toBeUndefined();
    expect(up.details.s0?.finance_accounting).toBeUndefined();
  });

  it('feeds the chart: sector nodes in sector order, links between them', () => {
    const input = buildSankeyInput(up);
    expect(input.nodes.filter((d) => d.stage === 's0').map((d) => d.family))
      .toEqual(['tech', 'sector:finance', 'other', 'further_study', 'no_role_listed', 'smaller_groups']);
    expect(input.links.map((l) => l.id)).toContain('s0:sector:finance>y3:sector:finance');
  });
});

describe('buildSankeyInput', () => {
  it('builds one node per published total, ordered consistently in every column', () => {
    const input = buildSankeyInput(commerce);
    expect(input.stages).toEqual(['s0', 'y3', 'y5', 'y10', 'now']);
    expect(input.n).toBe(1060);
    const s0 = input.nodes.filter((d) => d.stage === 's0').map((d) => d.family);
    expect(s0).toEqual(['tech', 'finance_accounting', 'sales_marketing', 'other', 'further_study', 'no_role_listed', 'smaller_groups']);
    const y5 = input.nodes.filter((d) => d.stage === 'y5').map((d) => d.family);
    expect(y5).toEqual(['finance_accounting', 'sales_marketing', 'operations_management', 'no_role_listed', 'smaller_groups']);
    expect(input.nodes.find((d) => d.id === 's0:finance_accounting')).toMatchObject({ value: 410, stageIndex: 0 });
  });

  it('draws every column of the oldest classes: first, years 3, 5, 10, 20 and today', () => {
    const old = findSlice(river, 'all', 'all', '1995-1999')!;
    expect(buildSankeyInput(old).stages).toEqual(['s0', 'y3', 'y5', 'y10', 'y20', 'now']);
  });

  it('keeps a node that has a total but no links', () => {
    const input = buildSankeyInput(commerce);
    const other = input.nodes.find((d) => d.id === 's0:other');
    expect(other).toMatchObject({ value: 10 });
    expect(input.links.some((l) => l.source === 's0:other' || l.target === 's0:other')).toBe(false);
  });

  it('turns links into source/target ids between consecutive stages', () => {
    const input = buildSankeyInput(commerce);
    expect(input.links).toHaveLength(commerce.links.length);
    expect(input.links[0]).toEqual({
      id: 's0:finance_accounting>y3:finance_accounting', source: 's0:finance_accounting', target: 'y3:finance_accounting',
      from: 'finance_accounting', to: 'finance_accounting', fromStage: 's0', toStage: 'y3', value: 300,
    });
  });

  it('handles a recent class (first destination and today only): s0 → now', () => {
    const input = buildSankeyInput(recent);
    expect(input.stages).toEqual(['s0', 'now']);
    expect(input.links.map((l) => l.id)).toEqual(['s0:tech>now:tech', 's0:operations_management>now:operations_management']);
  });

  it('handles empty links', () => {
    const input = buildSankeyInput(makeSlice({ totals: { s0: { tech: 50 }, y3: { tech: 45 }, y5: { tech: 40 }, y10: { tech: 30 }, now: { tech: 20 } }, links: [] }));
    expect(input.nodes).toHaveLength(5);
    expect(input.links).toEqual([]);
  });

  it('drops links that skip a stage, point at missing nodes, or are not positive', () => {
    const slice = makeSlice({
      stages: ['s0', 'y3', 'now'],
      totals: { s0: { tech: 50 }, y3: { tech: 40 }, now: { tech: 30 } },
      links: [
        { from_stage: 's0', from: 'tech', to_stage: 'now', to: 'tech', n: 20 },       // skips y3
        { from_stage: 's0', from: 'law', to_stage: 'y3', to: 'tech', n: 20 },         // no s0 law node
        { from_stage: 's0', from: 'tech', to_stage: 'y3', to: 'tech', n: 0 },         // empty
        { from_stage: 'y3', from: 'tech', to_stage: 'now', to: 'tech', n: 25 },       // ok
      ],
    });
    expect(buildSankeyInput(slice).links.map((l) => l.id)).toEqual(['y3:tech>now:tech']);
  });

  it('drops a listed stage that has no published totals', () => {
    const slice = makeSlice({ totals: { s0: { tech: 50 }, y10: {}, now: { tech: 30 } }, stages: ['s0', 'y3', 'y5', 'y10', 'now'] });
    expect(buildSankeyInput(slice).stages).toEqual(['s0', 'now']);
  });
});

describe('firstAndLast (phones)', () => {
  it('keeps the first and last columns and invents no flows between them', () => {
    const input = firstAndLast(buildSankeyInput(commerce));
    expect(input.stages).toEqual(['s0', 'now']);
    expect(new Set(input.nodes.map((d) => `${d.stage}:${d.stageIndex}`))).toEqual(new Set(['s0:0', 'now:1']));
    expect(input.nodes.filter((d) => d.stage === 'now').map((d) => d.value)).toEqual([348, 168, 168, 84, 33]);
    expect(input.links).toEqual([]); // commerce publishes no s0 → now links
  });

  it('leaves two-stage slices (and their flows) alone', () => {
    const full = buildSankeyInput(recent);
    expect(firstAndLast(full)).toBe(full);
  });

  it('names the years it leaves out', () => {
    expect(yearList(['y3', 'y5', 'y10'])).toBe('3, 5 & 10');
    expect(yearList(['y3', 'y5'])).toBe('3 & 5');
    expect(yearList(['y5'])).toBe('5');
    expect(yearList([])).toBe('');
    expect(stageYear('s0')).toBe(0);
    expect(stageYear('y20')).toBe(20);
    expect(stageYear('now')).toBe('now');
  });
});

describe('summarySentence', () => {
  it('leads with the most notable change, names the field, and says "about" for the perturbed count', () => {
    expect(summarySentence(allAlumni, 'Queen’s alumni', 'the class of 2010–2014')).toBe(
      'Of about 13,440 Queen’s alumni from the class of 2010–2014, careers converge on management: '
      + 'Operations & management grows from 10% right after graduating to 16% today.',
    );
  });

  it('marks one key number for the highlight', () => {
    const [before, key, after] = summaryParts(allAlumni, 'Queen’s alumni', 'the class of 2010–2014');
    expect(key).toBe('16%');
    expect(before.endsWith('to ')).toBe(true);
    expect(after).toBe(' today.');
    expect(`${before}${key}${after}`).not.toContain('\u0000');
    // the key is today's share for a shrinking field too
    expect(summaryParts(commerce, 'Commerce grads', 'the class')[1]).toBe('33%');
  });

  it('uses the sector label in the rolled-up view, so the sentence matches the chart', () => {
    expect(summarySentence(rollUpSlice(allAlumni), 'Queen’s alumni', 'the class of 2010–2014')).toBe(
      'Of about 13,440 Queen’s alumni from the class of 2010–2014, careers converge on management: '
      + 'Management & ventures grows from 10% right after graduating to 16% today.',
    );
  });

  it('names the largest field when the biggest grower is not it', () => {
    const slice = makeSlice({
      n: 1000, stages: ['s0', 'y3', 'now'],
      totals: { s0: { finance_accounting: 400, operations_management: 100 }, now: { finance_accounting: 350, operations_management: 160 } },
    });
    expect(summarySentence(slice, 'Commerce grads', 'the class of 2010–2014')).toBe(
      'Of about 1,000 Commerce grads from the class of 2010–2014, careers drift toward management: '
      + 'Operations & management grows from 10% right after graduating to 16% today. Finance & accounting is still the largest field (35%).',
    );
  });

  it('describes a shrinking field, noting when it is still the largest', () => {
    expect(summarySentence(commerce, 'Commerce grads', 'the class of 2010–2014')).toBe(
      'Of about 1,060 Commerce grads from the class of 2010–2014, careers move away from finance: '
      + 'Finance & accounting shrinks from 39% right after graduating to 33% today, though it is still the largest field.',
    );
  });

  it('says when one field holds a majority from start to finish', () => {
    const law = findSlice(river, 'law', 'Law', '2010-2014')!;
    expect(summarySentence(law, 'law grads', 'the class of 2010–2014')).toBe(
      'Of about 837 law grads from the class of 2010–2014, most start in Law and it stays the largest field: 87% right after graduating, 79% today.',
    );
  });

  it('leads with further study for study-first programs, then names today’s largest field', () => {
    const slice = makeSlice({
      n: 100, stages: ['s0', 'y3', 'now'],
      totals: { s0: { further_study: 45, healthcare: 10, research_academia: 12 }, now: { healthcare: 30, research_academia: 14 } },
    });
    expect(summarySentence(slice, 'Life Sciences grads', 'the class of 2010–2014')).toBe(
      'Of about 100 Life Sciences grads from the class of 2010–2014, 45% went straight on to further study, the most common first step; '
      + 'today, the largest field is Healthcare (30%).',
    );
    expect(summaryParts(slice, 'grads', 'the class')[1]).toBe('45%');
  });

  it('handles two-stage classes (first destination and today)', () => {
    expect(summarySentence(recent, 'Queen’s alumni', 'the class of 2020–2024')).toBe(
      'Of about 11,365 Queen’s alumni from the class of 2020–2024, the mix of fields barely changes: Tech is the largest, with 11% right after graduating and 11% today.',
    );
    const shifted = makeSlice({
      n: 200, stages: ['s0', 'y3', 'now'],
      totals: { s0: { tech: 80, law: 40 }, y3: { tech: 50, law: 60 }, now: { tech: 40, law: 90 } },
    });
    expect(summarySentence(shifted, 'grads', 'the class of 2015–2019'))
      .toBe('Of about 200 grads from the class of 2015–2019, careers converge on law: Law grows from 20% right after graduating to 45% today.');
  });

  it('gets the grammar right for plural labels', () => {
    const slice = makeSlice({ n: 100, stages: ['s0', 'now'], totals: { s0: { founder: 10, tech: 40 }, now: { founder: 20, tech: 40 } } });
    expect(summarySentence(slice, 'grads', 'the class of 2010–2014')).toContain('Founders grow from 10% right after graduating to 20% today.');
  });

  it('never derives a number when the first field later falls under the floor', () => {
    const slice = makeSlice({ n: 100, totals: { s0: { arts_media: 30 }, y3: {}, y5: {}, y10: { law: 20 }, now: {} } });
    const s = summarySentence(slice, 'grads', 'the class of 2010–2014');
    expect(s).toBe('Of about 100 grads from the class of 2010–2014, 30% started in Arts & media; by year 10, the largest field is Law (20%).');
    expect(s).not.toMatch(/\b(0|10)%/);
  });

  it('copes with no job field at the first stage, naming the floor from the data', () => {
    const onlyGroups = makeSlice({ n: 70, totals: { s0: { smaller_groups: 70 }, now: { smaller_groups: 70 } }, stages: ['s0', 'now'] });
    expect(summarySentence(onlyGroups, 'Art History grads', 'the class of 2010–2014'))
      .toBe('Of about 70 Art History grads from the class of 2010–2014, no single field reached 5 people right after graduating.');
    expect(summarySentence(onlyGroups, 'grads', 'the class', 7)).toContain('no single field reached 7 people');
    const onlyStudy = makeSlice({ n: 70, totals: { s0: { further_study: 40, smaller_groups: 30 } }, stages: ['s0', 'now'] });
    expect(summarySentence(onlyStudy, 'grads', 'the classes of 1995–2024'))
      .toBe('Of about 70 grads from the classes of 1995–2024, 57% went straight on to further study, the most common first step.');
  });

  it('ignores no_role_listed and smaller_groups even when they are the largest', () => {
    const slice = makeSlice({ n: 100, stages: ['s0', 'now'], totals: { s0: { no_role_listed: 50, smaller_groups: 30, law: 20 }, now: { law: 25 } } });
    expect(summarySentence(slice, 'grads', 'the class of 2010–2014'))
      .toBe('Of about 100 grads from the class of 2010–2014, careers converge on law: Law grows from 20% right after graduating to 25% today.');
  });

  it('says so when nothing was published', () => {
    expect(summarySentence(makeSlice({ n: 60, totals: {} }), 'grads', 'the class of 2010–2014'))
      .toBe('Of about 60 grads from the class of 2010–2014, no career stages could be published.');
    expect(summaryParts(makeSlice({ n: 60, totals: {} }), 'grads', 'the class')[1]).toBe('');
  });
});

describe('then vs now (the summary card)', () => {
  it('compares right after graduating with today for fields published at both ends, biggest gain first', () => {
    const rows = thenVsNow(commerce);
    // tech, further study and other roles aren't published today; no role / smaller groups aren't fields
    expect(rows.map((r) => r.group)).toEqual(['sales_marketing', 'finance_accounting']);
    const fin = rows.find((r) => r.group === 'finance_accounting')!;
    expect(fin).toMatchObject({ first: 410, now: 348 });
    expect(fin.a).toBeCloseTo(410 / 1060);
    expect(fin.b).toBeCloseTo(348 / 1060);
    // points come from the rounded shares, so "39% → 33%" reads −6
    expect(fin.pts).toBe(33 - 39);
  });

  it('keeps the six largest fields at either end, then sorts them by change', () => {
    const totals = {
      s0: { tech: 100, finance_accounting: 90, consulting: 80, healthcare: 70, law: 60, teaching: 50, engineering: 40, further_study: 30 },
      now: { tech: 60, finance_accounting: 95, consulting: 82, healthcare: 70, law: 64, teaching: 55, engineering: 150, further_study: 30 },
    };
    const rows = thenVsNow(makeSlice({ n: 1000, stages: ['s0', 'now'], totals }));
    expect(rows).toHaveLength(6);
    expect(rows.map((r) => r.group)).not.toContain('further_study'); // 3% at both ends: not in the top six
    expect(rows[0].group).toBe('engineering'); // +11 points, and big today
    expect(rows[rows.length - 1].group).toBe('tech'); // −4 points
    for (let i = 1; i < rows.length; i++) expect(rows[i - 1].pts).toBeGreaterThanOrEqual(rows[i].pts);
    expect(thenVsNow(makeSlice({ n: 1000, stages: ['s0', 'now'], totals }), 3)).toHaveLength(3);
  });

  it('uses the rolled-up groups when the view is grouped, and is empty with a single stage', () => {
    expect(thenVsNow(rollUpSlice(allAlumni)).map((r) => r.group)).toEqual(['sector:management', 'sector:engineering']);
    expect(thenVsNow(makeSlice({ stages: ['now'], totals: { now: { tech: 50 } } }))).toEqual([]);
  });
});

describe('stickerNote', () => {
  it('says most of a big first field stays put when every published step keeps 60%+ of it', () => {
    expect(stickerNote(commerce)).toBe('most of finance stays put');
    // break one step: the note goes
    const leaky = { ...commerce, links: commerce.links.map((l) => (l.from_stage === 'y5' && l.from === 'finance_accounting' ? { ...l, n: 100 } : l)) };
    expect(stickerNote(leaky)).not.toBe('most of finance stays put');
  });

  it('says a field keeps growing only when its share never drops and gains 4+ points', () => {
    expect(stickerNote(allAlumni)).toBe('management keeps growing');
    expect(stickerNote(rollUpSlice(allAlumni))).toBe('management keeps growing');
    const dip = { ...allAlumni, totals: { ...allAlumni.totals, y5: { ...allAlumni.totals.y5, operations_management: 1000 } } };
    expect(stickerNote(dip)).toBeNull();
  });

  it('stays quiet when the data doesn’t back a note', () => {
    expect(stickerNote(recent)).toBeNull(); // two columns, no 20%+ field
    expect(stickerNote(findSlice(river, 'law', 'Law', '2010-2014')!)).toBeNull(); // no published links
    expect(stickerNote(makeSlice({ totals: {} }))).toBeNull();
  });
});

describe('tableRows', () => {
  it('lists every field present at any stage, null where unpublished', () => {
    const rows = tableRows(commerce);
    expect(rows.map((r) => r.family)).toEqual([
      'tech', 'finance_accounting', 'sales_marketing', 'operations_management', 'other', 'further_study', 'no_role_listed', 'smaller_groups',
    ]);
    expect(rows.find((r) => r.family === 'operations_management')?.cells).toEqual([null, 120, 152, 174, 168]);
    expect(rows.find((r) => r.family === 'tech')?.cells).toEqual([66, null, null, null, null]);
  });

  it('respects the stage list it is given (suppressed null slices too)', () => {
    expect(recent.suppressed).not.toBeNull();
    const slice = makeSlice({ suppressed: null, stages: ['s0', 'now'], totals: { s0: { tech: 20 }, now: { law: 15 } } });
    expect(tableRows(slice)).toEqual([{ family: 'tech', cells: [20, null] }, { family: 'law', cells: [null, 15] }]);
  });
});

describe('year by year', () => {
  const series = yearSeries(commerce, false);

  it('keeps every published point in order, 0..N then today, with its own denominator', () => {
    expect(series.n).toBe(1060);
    expect(series.rows.map((r) => r.year)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 'now']);
    expect(series.rows.map((r) => r.n).slice(10)).toEqual([1060, 1060, 830, 40, 1060]);
    expect(series.rows[0].counts).toMatchObject({ finance_accounting: 410, further_study: 47 });
    expect(series.rows[0].sum).toBe(410 + 177 + 73 + 66 + 47 + 20 + 10);
  });

  it('orders groups like the Sankey (jobs, then further study, no role, smaller groups)', () => {
    expect(series.groups).toEqual([
      'tech', 'finance_accounting', 'sales_marketing', 'operations_management', 'other', 'further_study', 'no_role_listed', 'smaller_groups',
    ]);
  });

  it('sorts, de-duplicates and drops points it can’t place', () => {
    const messy = makeSlice({
      n: 100,
      years: [
        Y('now', 100, [['tech', 40]]),
        Y(2, 90, [['tech', 30]]),
        Y(0, 100, [['tech', 20]]),
        Y(2, 80, [['tech', 99]]),        // duplicate year: first one wins
        Y(-1, 100, [['tech', 10]]),      // not a year
        Y(1.5, 100, [['tech', 10]]),     // not a year
        Y(3, 0, [['tech', 10]]),         // nobody has reached it
      ],
    });
    const s = yearSeries(messy, false);
    expect(s.rows.map((r) => r.year)).toEqual([0, 2, 'now']); // year 1 is missing and stays missing
    expect(s.rows[1].counts.tech).toBe(30);
    expect(yearSeries(makeSlice({ years: undefined as unknown as YearPoint[] }), false).rows).toEqual([]);
  });

  it('rolls fields up into sectors when grouped, keeping the parts', () => {
    const grouped = yearSeries(allAlumni, true);
    expect(grouped.groups).toEqual(['sector:management', 'sector:engineering', 'further_study', 'no_role_listed']);
    expect(grouped.rows[0].counts['sector:management']).toBe(1409);
    expect(grouped.rows[0].parts?.['sector:management']).toEqual([['operations_management', 1409]]);
  });

  it('stacks a point out of its own n, with the unpublished rest on top', () => {
    const bands = stackRow(series.rows[0], series.groups);
    // bottom of the stack is the last group in chart order; REST caps it
    expect(bands.map((b) => b.key)).toEqual([...[...series.groups].reverse(), REST]);
    const fin = bands.find((b) => b.key === 'finance_accounting')!;
    expect(fin.y1 - fin.y0).toBeCloseTo(410 / 1060);
    const rest = bands[bands.length - 1];
    expect(rest.y0).toBeCloseTo(series.rows[0].sum / 1060);
    expect(rest.y1).toBe(1);
    // an unpublished field gets a zero-height band, not a gap in the stack
    const ops = bands.find((b) => b.key === 'operations_management')!;
    expect(ops.y1).toBe(ops.y0);
    for (let i = 1; i < bands.length; i++) expect(bands[i].y0).toBeCloseTo(bands[i - 1].y1);
  });

  it('draws nudged counts that add up past n over their sum, with no rest', () => {
    const over = series.rows[13]; // n 40, counts 26 + 20
    const bands = stackRow(over, series.groups);
    expect(bands.find((b) => b.key === 'finance_accounting')!.y1 - bands.find((b) => b.key === 'finance_accounting')!.y0).toBeCloseTo(26 / 46);
    const rest = bands[bands.length - 1];
    expect(rest.y1 - rest.y0).toBeCloseTo(0);
  });

  it('starts on year 10 when everyone has reached it, else today', () => {
    expect(series.rows[defaultYearIndex(series)].year).toBe(10);
    const young = yearSeries(recent, false);
    expect(young.rows[defaultYearIndex(young)].year).toBe('now');
    expect(defaultYearIndex(yearSeries(makeSlice({ years: [Y(0, 50, [])] }), false))).toBe(0);
    expect(firstPartialYear(series)).toBe(12);
    expect(firstPartialYear(yearSeries(allAlumni, false))).toBe(-1);
  });

  it('reads a point out: shares of that point’s n, largest first, with honest flags', () => {
    const y0 = yearReadout(series, 0)!;
    expect(y0.rows[0]).toEqual({ group: 'finance_accounting', count: 410, share: 410 / 1060 });
    expect(y0.rows.map((r) => r.count)).toEqual([...y0.rows.map((r) => r.count)].sort((a, b) => b - a));
    expect(y0).toMatchObject({ year: 0, n: 1060, rest: true, fewer: false, small: false, over: false });

    expect(yearReadout(series, 11)).toMatchObject({ year: 11, n: 1060, fewer: false });
    const y12 = yearReadout(series, 12)!;
    expect(y12).toMatchObject({ year: 12, n: 830, fewer: true, small: false });
    expect(y12.rows[0].share).toBeCloseTo(280 / 830); // over that year's n, not the slice's

    const y13 = yearReadout(series, 13)!;
    expect(y13).toMatchObject({ n: 40, fewer: true, small: true, over: true, rest: false });

    const now = yearReadout(series, 14)!;
    expect(now).toMatchObject({ year: 'now', n: 1060, fewer: false });
    expect(yearReadout(series, 99)).toBeNull();
  });

  it('builds the table: one row per group, a cell per point, null where unpublished', () => {
    const rows = yearTableRows(series);
    expect(rows.map((r) => r.family)).toEqual(series.groups);
    const ops = rows.find((r) => r.family === 'operations_management')!;
    expect(ops.cells).toHaveLength(series.rows.length);
    expect(ops.cells[0]).toBeNull();
    expect(ops.cells[1]).toBe(50);
  });
});

describe('classes reached', () => {
  it('works out which classes of a band have reached a year', () => {
    expect(cohortYears('2010-2014')).toEqual({ from: 2010, to: 2014 });
    expect(cohortYears('all')).toEqual({ from: 1995, to: 2024 });
    expect(lastJune('2025-09')).toBe(2025);
    expect(lastJune('2025-03')).toBe(2024);
    expect(classesReached('2010-2014', 0, '2025-09')).toEqual({ from: 2010, to: 2014 });
    expect(classesReached('2010-2014', 11, '2025-09')).toEqual({ from: 2010, to: 2014 });
    expect(classesReached('2010-2014', 12, '2025-09')).toEqual({ from: 2010, to: 2013 });
    expect(classesReached('2010-2014', 15, '2025-09')).toEqual({ from: 2010, to: 2010 });
    expect(classesReached('2010-2014', 16, '2025-09')).toBeNull();
    expect(classesReached('2010-2014', 'now', '2025-09')).toEqual({ from: 2010, to: 2014 });
    expect(classesReached('all', 20, '2025-09')).toEqual({ from: 1995, to: 2005 });
    expect(classesPhrase({ from: 2010, to: 2013 })).toBe('the classes of 2010–2013');
    expect(classesPhrase({ from: 2010, to: 2010 })).toBe('the class of 2010');
  });
});

describe('labels', () => {
  it('formats the snapshot month', () => {
    expect(snapshotLabel('2025-09')).toBe('Sep 2025');
    expect(snapshotLabel('2025-13')).toBe('2025-13');
    expect(snapshotLabel('soon')).toBe('soon');
  });

  it('builds population and cohort phrases', () => {
    expect(populationLabel('all', 'all')).toBe('Queen’s alumni');
    expect(populationLabel('undergrad', 'all')).toBe('undergrads');
    expect(populationLabel('undergrad', 'Commerce')).toBe('Commerce grads');
    expect(populationLabel('graduate', 'Economics')).toBe('Economics grads (master’s & PhD)');
    expect(cohortPhrase('2010-2014')).toBe('the class of 2010–2014');
    expect(cohortPhrase('all')).toBe('the classes of 1995–2024');
    expect(sliceTitle('undergrad', 'Commerce', '2010-2014')).toBe('Commerce, class of 2010–2014');
    expect(sliceTitle('all', 'all', 'all')).toBe('Queen’s alumni, classes of 1995–2024');
    expect(sliceTitle('law', 'all', '2020-2024')).toBe('Law grads, class of 2020–2024');
    expect(programTag('graduate', 'Computer Engineering')).toBe('Computer Engineering (master’s & PhD)');
    expect(programTag('all', 'Commerce')).toBe('Commerce');
  });

  it('flags small classes', () => {
    expect(SMALL_CLASS).toBe(50);
    expect(smallProgram.n).toBeLessThan(SMALL_CLASS);
    expect(commerce.n).toBeGreaterThanOrEqual(SMALL_CLASS);
  });
});

// The real export (counts are perturbed and shift between runs, so nothing here is exact).
const riverJson = resolve(__dirname, '../../../public/data/river.json');
// Every slice of the real file, twice: slow on a busy machine, so these tests get more time.
describe.skipIf(!existsSync(riverJson))('the real river.json', { timeout: 30_000 }, () => {
  const real = JSON.parse(readFileSync(riverJson, 'utf8')) as RiverFile;
  const levelWide = real.slices.filter((s) => s.program === 'all');

  it('uses the new contract: Floors, five-year bands, year series', () => {
    expect(real.meta.k).toMatchObject({ field: expect.any(Number), named: expect.any(Number) });
    expect(real.meta.k.named).toBeGreaterThanOrEqual(real.meta.k.field);
    const cohorts = new Set(real.slices.map((s) => s.cohort));
    for (const c of cohorts) expect(parseCohort(c), c).not.toBeNull();
    expect(cohorts.has(DEFAULT_FILTERS.cohort)).toBe(true);
    expect(findSlice(real, 'all', 'all', DEFAULT_FILTERS.cohort)).toBeDefined();
    for (const s of real.slices) expect(Array.isArray(s.years), `${s.level}|${s.program}|${s.cohort}`).toBe(true);
  });

  it('cuts every all-programs column to at most 12 nodes and loses no one', () => {
    expect(levelWide.length).toBeGreaterThan(0);
    for (const s of levelWide) {
      const up = rollUpSlice(s);
      for (const st of s.stages) {
        const before = Object.values(s.totals[st] ?? {}).reduce((a, b) => a + (b ?? 0), 0);
        const after = Object.values(up.totals[st] ?? {}).reduce((a, b) => a + (b ?? 0), 0);
        expect(after).toBe(before);
        expect(Object.keys(up.totals[st] ?? {}).length).toBeLessThanOrEqual(12);
      }
      const linksBefore = s.links.reduce((a, l) => a + l.n, 0);
      expect(up.links.reduce((a, l) => a + l.n, 0)).toBe(linksBefore);
      expect(summarySentence(up, 'alumni', 'the class')).toMatch(/^Of about [\d,]+ alumni from the class, .+\.$/);
    }
  });

  it('writes a summary for every slice that names a field or further study', () => {
    for (const s of real.slices) {
      const text = summarySentence(s, 'grads', 'the class', real.meta.k.field);
      expect(text, `${s.level}|${s.program}|${s.cohort}`).not.toMatch(/undefined|NaN|family/);
    }
  });

  it('shapes every year series into stacks that stay inside 0..1', () => {
    for (const s of real.slices) {
      for (const grouped of [false, true]) {
        const ys = yearSeries(s, grouped);
        expect(ys.rows.length, `${s.level}|${s.program}|${s.cohort}`).toBeGreaterThan(0);
        for (const r of ys.rows) {
          expect(r.n).toBeLessThanOrEqual(s.n);
          const bands = stackRow(r, ys.groups);
          expect(bands[0].y0).toBe(0);
          expect(bands[bands.length - 1].y1).toBeCloseTo(1);
          for (const b of bands) expect(b.y1 + 1e-9).toBeGreaterThanOrEqual(b.y0);
        }
        expect(yearReadout(ys, defaultYearIndex(ys))).not.toBeNull();
      }
      for (const r of thenVsNow(s)) expect(Number.isInteger(r.pts)).toBe(true);
    }
  });
});
