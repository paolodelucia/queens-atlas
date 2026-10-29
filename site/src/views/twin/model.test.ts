import { describe, expect, it } from 'vitest';
import type { TwinGroup } from '../../data/types';
import {
  BANDS, FIRST_OPTIONS, buildIndex, cohortForYear, describeGroup, employerSticker, fieldLabel, findTwins, firstStop,
  firstStopSticker, fractionOrPercent, headlineStats, hiddenLine, isSmall, jobChips, listWords, lookupOrder, managerPoints,
  matchCopy, oneInN, pairSections, parseJob, parseMode, parseYear, pathStats, people, percent, pickYear, programOptions,
  programStats, queryFromAnswers, riverHref, riverLink, seniorityRows, shareUrl, snapshotLabel, staySticker, trajectory,
  trajectoryNotes, twinQuery, validateAnswers, widenedBadge, widenedDims,
} from './model';
import type { Level, ProgramOption } from './model';
import {
  COMMERCE, COMMERCE_1995, COMMERCE_2000, COMMERCE_2010_ALL, COMMERCE_2010_FIN, COMMERCE_2020, COMMERCE_FIN, COMMERCE_RECENT,
  COMMERCE_STUDY, EVERYONE, LINGUISTICS, META, TWIN, UG_TECH, blank, pt,
} from './testFixtures';

const index = buildIndex(TWIN.groups);
const programsFor = (level: Level): ProgramOption[] => programOptions(META, TWIN, level);

// ── Modes & answers ──────────────────────────────────────────────────────────

describe('parseMode', () => {
  it('defaults to student', () => {
    expect(parseMode('')).toBe('student');
    expect(parseMode(null)).toBe('student');
    expect(parseMode('student', true)).toBe('student');
  });
  it('reads alum and its spellings', () => {
    for (const v of ['alum', 'ALUMNI', ' graduated ']) expect(parseMode(v)).toBe('alum');
  });
  it('keeps links made before the student view (they carry ?first=) on the alumni results', () => {
    expect(parseMode('', true)).toBe('alum');
    expect(parseMode('nonsense', true)).toBe('alum');
  });
});

describe('parseYear & cohortForYear (five-year classes)', () => {
  it('parses four digits only', () => {
    expect(parseYear(' 2012 ')).toBe(2012);
    for (const v of ['12', '20123', 'abc', '2012a', '', null, undefined]) expect(parseYear(v)).toBeNull();
  });
  it.each([
    [1994, null], [1995, '1995-1999'], [1999, '1995-1999'], [2000, '2000-2004'], [2004, '2000-2004'],
    [2005, '2005-2009'], [2012, '2010-2014'], [2019, '2015-2019'], [2020, '2020-2024'], [2024, '2020-2024'], [2025, null],
  ])('%s -> %s', (year, band) => expect(cohortForYear(year)).toBe(band));
  it('covers 1995-2024 with no gaps or overlaps', () => {
    for (let y = 1995; y <= 2024; y++) expect(BANDS.filter((b) => y >= b.from && y <= b.to)).toHaveLength(1);
    expect(cohortForYear(null)).toBeNull();
    expect(cohortForYear(2012.5)).toBeNull();
  });
});

describe('programOptions', () => {
  it('lists the level’s programs largest first', () => {
    expect(programsFor('undergrad').map((o) => o.program)).toEqual(['Commerce', 'Linguistics']);
    expect(programsFor('mba')).toEqual([{ program: 'MBA', n: 500 }]);
    expect(programsFor('law')).toEqual([]);
  });
  it('appends programs that have a twin group but no meta entry', () => {
    const extra: TwinGroup = { ...blank, level: 'graduate', program: 'Classics', cohort: '*', s0: '*', n: 21, years: [] };
    expect(programOptions(META, { groups: [extra] }, 'graduate')).toEqual([{ program: 'Classics', n: 21 }]);
  });
});

describe('validateAnswers', () => {
  const raw = { level: 'undergrad', program: 'commerce', year: '2012', first: 'finance_accounting' };
  it('accepts a full alumni answer set, normalising case', () => {
    const v = validateAnswers(raw, programsFor);
    expect(v.answers).toEqual({ level: 'undergrad', program: 'Commerce', year: 2012, cohort: '2010-2014', first: 'finance_accounting' });
    expect(v.complete).toBe(true);
    expect(v.notes).toEqual([]);
  });
  it('drops bad values with a note, never with "we"', () => {
    const v = validateAnswers({ level: 'wizard', program: 'x', year: 'abc', first: 'astronaut' }, programsFor);
    expect(v.answers).toEqual({ level: null, program: null, year: null, cohort: null, first: null });
    expect(v.notes).toHaveLength(3);
    expect(v.notes.join(' ')).toMatch(/“wizard” isn’t a degree level/);
    expect(v.notes.join(' ')).not.toMatch(/\bwe\b/i);
  });
  it('keeps an out-of-range alumni year as answered, across every class', () => {
    const v = validateAnswers({ ...raw, year: '1994' }, programsFor);
    expect(v.answers.cohort).toBeNull();
    expect(v.yearOutOfRange).toBe(true);
    expect(v.complete).toBe(true);
    expect(v.notes[0]).toMatch(/classes of 1995 to 2024, so for 1994 every class counts/);
  });
  it('in the student view: year is informational, no first job, complete once a program is set', () => {
    const v = validateAnswers({ level: 'undergrad', program: 'Commerce', year: '2028', first: 'tech' }, programsFor, 'student');
    expect(v.notes).toEqual([]);
    expect(v.answers.first).toBeNull();
    expect(v.answers.year).toBe(2028);
    expect(v.complete).toBe(true);
    expect(validateAnswers({ level: 'undergrad', program: '', year: '', first: '' }, programsFor, 'student').complete).toBe(false);
  });
  it('fills in the program for single-program levels', () => {
    expect(validateAnswers({ level: 'mba', program: '', year: '', first: '' }, programsFor).answers.program).toBe('MBA');
  });
  it('offers every job field, further study and skip, but never no-role or smaller groups', () => {
    const ids = FIRST_OPTIONS.map((o) => o.id);
    expect(ids).toContain('further_study');
    expect(ids[ids.length - 1]).toBe('*');
    expect(ids).not.toContain('no_role_listed');
    expect(ids).not.toContain('smaller_groups');
  });
});

describe('parseJob', () => {
  it('reads a first-job field, treats absent and "any" as all, rejects the rest', () => {
    expect(parseJob('')).toBe('*');
    expect(parseJob('any')).toBe('*');
    expect(parseJob('Tech')).toBe('tech');
    expect(parseJob('further_study')).toBe('further_study');
    expect(parseJob('astronaut')).toBeNull();
  });
});

// ── Matching ─────────────────────────────────────────────────────────────────

describe('lookupOrder & findTwins', () => {
  it('follows the documented fallback order', () => {
    const order = lookupOrder({ level: 'undergrad', program: 'Commerce', cohort: '2010-2014', s0: 'tech' });
    expect(order.map((q) => `${q.level}|${q.program}|${q.cohort}|${q.s0}`)).toEqual([
      'undergrad|Commerce|2010-2014|tech', 'undergrad|Commerce|*|tech', 'undergrad|Commerce|2010-2014|*', 'undergrad|Commerce|*|*',
      'undergrad|*|2010-2014|tech', 'undergrad|*|*|tech', '*|*|2010-2014|tech', '*|*|*|tech', '*|*|*|*',
    ]);
  });
  it('drops duplicates when answers are skipped', () => {
    expect(lookupOrder({ level: 'undergrad', program: 'Commerce', cohort: '*', s0: '*' })).toHaveLength(3);
  });
  it('finds the exact group for the class of 2012 and a finance start', () => {
    const v = validateAnswers({ level: 'undergrad', program: 'Commerce', year: '2012', first: 'finance_accounting' }, programsFor);
    const m = findTwins(index, queryFromAnswers(v.answers))!;
    expect(m.group).toBe(COMMERCE_2010_FIN);
    expect(m.widened).toEqual([]);
  });
  it.each([
    ['1994', COMMERCE, []],
    ['1995', COMMERCE_1995, []],
    ['1999', COMMERCE_1995, []],
    ['2000', COMMERCE_2000, []],
    ['2012', COMMERCE_2010_ALL, []],
    ['2024', COMMERCE_2020, []],
    ['2025', COMMERCE, []],
  ])('class of %s with the first job skipped -> its five-year group', (year, group, widened) => {
    const v = validateAnswers({ level: 'undergrad', program: 'Commerce', year, first: 'any' }, programsFor);
    const m = findTwins(index, queryFromAnswers(v.answers))!;
    expect(m.group).toBe(group);
    expect(m.widened).toEqual(widened);
  });
  it('widens class before first job, and says so', () => {
    const v = validateAnswers({ level: 'undergrad', program: 'Commerce', year: '2016', first: 'finance_accounting' }, programsFor);
    const m = findTwins(index, queryFromAnswers(v.answers))!;
    expect(m.group).toBe(COMMERCE_FIN);
    expect(m.widened).toEqual(['cohort']);
  });
  it('widens to the level when the program is too small, then to everyone', () => {
    const tech = findTwins(index, { level: 'undergrad', program: 'Linguistics', cohort: '*', s0: 'tech' })!;
    expect(tech.group).toBe(LINGUISTICS);
    expect(tech.widened).toEqual(['first']);
    const law = findTwins(index, { level: 'law', program: 'Law', cohort: '2000-2004', s0: 'law' })!;
    expect(law.group).toBe(EVERYONE);
    expect(law.widened).toEqual(['level', 'program', 'cohort', 'first']);
  });
  it('widenedDims ignores answers that were skipped', () => {
    expect(widenedDims({ level: 'undergrad', program: 'Commerce', cohort: '*', s0: '*' }, COMMERCE)).toEqual([]);
  });
  it('returns null when nothing matches', () => {
    expect(findTwins(buildIndex([]), { level: '*', program: '*', cohort: '*', s0: '*' })).toBeNull();
  });
});

// ── Copy ─────────────────────────────────────────────────────────────────────

describe('copy', () => {
  it('describes groups in plain words', () => {
    expect(describeGroup(COMMERCE_2010_FIN)).toBe('Commerce grads from the classes of 2010–2014 whose first job was in finance & accounting');
    expect(describeGroup(COMMERCE_STUDY)).toBe('Commerce grads who went straight on to more school');
    expect(describeGroup(EVERYONE)).toBe('Queen’s alumni');
    expect(listWords(['a', 'b', 'c'])).toBe('a, b and c');
  });
  it('an exact match is "your career twins"', () => {
    const c = matchCopy({ group: COMMERCE_2010_FIN, step: 0, widened: [] }, 20);
    expect(c.heading).toBe('Your 120 career twins');
    expect(c.sentence).toBe('These are the 120 Commerce grads from the classes of 2010–2014 whose first job was in finance & accounting.');
    expect(c.badge).toBeNull();
  });
  it('a widened match uses the published minimum and names what was let go', () => {
    const c = matchCopy({ group: LINGUISTICS, step: 3, widened: ['cohort', 'first'] }, 20);
    expect(c.heading).toBe('34 alumni close to your start');
    expect(c.sentence).toBe('Fewer than 20 alumni matched every answer, so this widens to all 34 Linguistics grads, from any class and first job.');
    expect(c.badge).toBe('Widened: all classes, any first job');
    expect(widenedBadge(['level', 'program'])).toBe('Widened: all degrees');
  });
  it('counts people with the right noun', () => {
    expect(people(1)).toBe('1 twin');
    expect(people(1200, 'alumni')).toBe('1,200 alumni');
    expect(people(3, 'grads')).toBe('3 grads');
    expect(people(2, 'people')).toBe('2 people');
  });
  it('flags small groups under 50', () => {
    expect(isSmall(49)).toBe(true);
    expect(isSmall(50)).toBe(false);
  });
  it('states the floors from meta.k', () => {
    expect(hiddenLine({ field: 5, named: 10 })).toBe('Fields with fewer than 5 people, and employers, titles and places with fewer than 10, aren’t shown.');
  });
  it('formats the snapshot', () => {
    expect(snapshotLabel('2025-09')).toBe('Sep 2025');
    expect(snapshotLabel('soon')).toBe('soon');
  });
  it('calls further study "More school" in the student view only', () => {
    expect(fieldLabel('further_study', 'student')).toBe('More school');
    expect(fieldLabel('further_study', 'alum')).toBe('Further study');
    expect(fieldLabel('smaller_groups')).toBe('Smaller fields combined');
  });
});

describe('numbers', () => {
  it('percent guards edge cases', () => {
    expect(percent(1, 3)).toBe('33%');
    expect(percent(1, 1000)).toBe('<1%');
    expect(percent(999, 1000)).toBe('>99%');
    expect(percent(12, 10)).toBe('100%');
    expect(percent(null, 10)).toBe('—');
    expect(percent(1, 0)).toBe('—');
  });
  it('oneInN only when it reads true', () => {
    expect(oneInN(165, 990)).toBe('1 in 6');
    expect(oneInN(600, 1000)).toBeNull();
    expect(oneInN(30, 100)).toBeNull();
  });
  it('fractionOrPercent', () => {
    expect(fractionOrPercent(50, 100)).toBe('Half');
    expect(fractionOrPercent(42, 100)).toBe('42%');
  });
});

// ── Student view ─────────────────────────────────────────────────────────────

describe('firstStop', () => {
  it('ranks year 0 with more school included, and puts non-destinations last', () => {
    const s = firstStop(COMMERCE)!;
    expect(s.n).toBe(1000);
    expect(s.rows.map((r) => r.label)).toEqual([
      'Finance & accounting', 'Sales & marketing', 'Consulting & strategy', 'Tech', 'More school', 'Operations & management',
      'Founders', 'Service, trades & sport', 'Law', 'Teaching', 'Smaller fields combined', 'No role listed',
    ]);
    expect(s.rows[0]).toMatchObject({ n: 400, share: 0.4, pct: '40%', muted: false });
    expect(s.rows.slice(-2).every((r) => r.muted)).toBe(true);
  });
  it('keeps a small program’s folded fields last even when they are the biggest', () => {
    expect(firstStop(LINGUISTICS)!.rows.map((r) => r.id)).toEqual(['further_study', 'smaller_groups', 'no_role_listed']);
  });
  it('returns null without a year 0', () => {
    expect(firstStop({ years: [pt('now', 10, [])] })).toBeNull();
  });
});

describe('jobChips', () => {
  it('offers first jobs with a group: the program’s own, else the level’s, else none', () => {
    const chips = jobChips(index, 'undergrad', 'Commerce', firstStop(COMMERCE));
    expect(chips.map((c) => [c.id, c.widened])).toEqual([['finance_accounting', false], ['tech', true], ['further_study', false]]);
    expect(chips[1].group).toBe(UG_TECH);
    expect(chips[2].label).toBe('More school');
  });
  it('is empty without a first stop', () => {
    expect(jobChips(index, 'undergrad', 'Commerce', null)).toEqual([]);
  });
});

describe('programStats & pathStats', () => {
  it('leads with the top first stop, then switching fields and living abroad, with denominators', () => {
    const s = programStats(COMMERCE, firstStop(COMMERCE));
    expect(s.map((x) => [x.value, x.text])).toEqual([
      ['40%', 'started in finance & accounting'],
      ['41%', 'work in a different field today than their first job'],
      ['1 in 6', 'live outside Canada today'],
    ]);
    expect(s[0].detail).toBe('400 of 1,000 grads, first job after graduating');
    expect(s[2].detail).toBe('165 of 990 grads with a known location, 70 in the US');
  });
  it('says "more school" when that is the top first stop, and copes with nulls', () => {
    const s = programStats(LINGUISTICS, firstStop(LINGUISTICS));
    expect(s).toEqual([{ id: 'first', value: '18%', text: 'went straight on to more school', detail: '6 of 34 grads, first job after graduating' }]);
  });
  it('a first job: share still in it at year 10 (of those 10+ years out), then switched fields', () => {
    const s = pathStats(COMMERCE_FIN, 'finance_accounting');
    expect(s[0]).toEqual({ id: 'stayed', value: '56%', text: 'still in finance & accounting at year 10', detail: '90 of the 160 people who are 10+ years out' });
    expect(s[1]).toMatchObject({ id: 'pivoted', value: '39%', detail: '150 of 380 people with a job at both points' });
  });
  it('more school: the most common field at the nearest year, and nothing invented when pivoted is null', () => {
    const s = pathStats(COMMERCE_STUDY, 'further_study');
    expect(s).toEqual([{ id: 'top', value: '50%', text: 'in law at year 5, the most common field', detail: '20 of the 40 people who are 5+ years out' }]);
  });
  it('all of them: the most common field at year 10, then time to manager', () => {
    const s = pathStats(COMMERCE, '*', 'grads');
    expect(s.map((x) => x.id)).toEqual(['top', 'manager']);
    expect(s[1]).toMatchObject({ value: 'Three quarters', text: 'had a manager title or above within 10 years' });
  });
  it('a first field under the floor at year 10 is described, never computed', () => {
    const g: TwinGroup = { ...COMMERCE_FIN, years: [pt(0, 50, [['tech', 50]]), pt(10, 30, [['finance_accounting', 12]])], s0: 'tech' };
    expect(pathStats(g, 'tech', 'people', { field: 5, named: 10 })[0]).toMatchObject({ value: 'Under 5', detail: 'of the 30 people who are 10+ years out' });
  });
  it('pickYear prefers 10, then the latest year before it', () => {
    expect(pickYear(COMMERCE)!.year).toBe(10);
    expect(pickYear(COMMERCE_STUDY)!.year).toBe(5);
    expect(pickYear({ years: [pt(0, 5, [])] })).toBeNull();
  });
});

// ── Trajectory ───────────────────────────────────────────────────────────────

describe('trajectory', () => {
  it('puts the starting field first and keeps the largest others, then Other fields and No role listed', () => {
    const t = trajectory(COMMERCE_FIN, { maxFields: 3 })!;
    expect(t.series.map((s) => s.id)).toEqual(['finance_accounting', 'operations_management', 'consulting', 'no_role_listed']);
    expect(t.series[0].isStart).toBe(true);
    expect(t.start).toBe('finance_accounting');
  });
  it('stripes a field whose sector colour is already taken, and No role listed', () => {
    const t = trajectory(COMMERCE_FIN, { maxFields: 3 })!;
    const striped = Object.fromEntries(t.series.map((s) => [s.id, s.striped]));
    expect(striped).toEqual({ finance_accounting: false, operations_management: false, consulting: true, no_role_listed: true });
  });
  it('shares are of each point’s own n (the people who had reached it)', () => {
    const t = trajectory(COMMERCE_FIN)!;
    const y10 = t.points.find((p) => p.year === 10)!;
    expect(y10.n).toBe(160);
    expect(y10.partial).toBe(true);
    expect(y10.cells.finance_accounting).toEqual({ n: 90, share: 90 / 160, h: 90 / 160 });
    expect(t.points[0].partial).toBe(false);
    // Year 0 of a first-job group: everyone else is a true zero, not "under 5".
    expect(t.points[0].cells.consulting).toEqual({ n: 0, share: 0, h: 0 });
    // Without a fixed start, a missing field is under the floor: null, never zero.
    expect(trajectory(COMMERCE)!.points.find((p) => p.year === 20)!.cells.consulting!.n).toBeNull();
    expect(t.now!.n).toBe(400);
    expect(t.now!.label).toBe('Today');
  });
  it('lists the years a group hasn’t reached', () => {
    expect(trajectory(COMMERCE_FIN)!.missing).toEqual([2, 7, 15, 20]);
    expect(trajectory(COMMERCE)!.missing).toEqual([]);
  });
  it('folds the rest into Other fields as a sum of published counts, null where there is nothing', () => {
    const t = trajectory(COMMERCE, { maxFields: 2 })!;
    // Operations peaks later (22% at year 10) above sales' best (15% at year 0).
    expect(t.series.map((s) => s.id)).toEqual(['finance_accounting', 'operations_management', 'other', 'no_role_listed']);
    const y0 = t.points[0];
    expect(y0.cells.other!.n).toBe(150 + 120 + 80 + 60 + 20 + 15 + 9 + 6 + 12);
    const y20 = t.points.find((p) => p.year === 20)!;
    expect(y20.cells.other).toEqual({ n: null, share: null, h: 0 });
    expect(y20.cells.no_role_listed!.n).toBeNull();
  });
  it('picks fields from the years enough people reached, not a thin late year', () => {
    const g: TwinGroup = { ...COMMERCE_FIN, years: [
      pt(0, 200, [['finance_accounting', 200]]), pt(5, 200, [['finance_accounting', 150], ['consulting', 20], ['law', 10]]),
      pt(20, 12, [['finance_accounting', 6], ['law', 6]]),
    ] };
    expect(trajectory(g, { maxFields: 2 })!.series.map((s) => s.id)).toEqual(['finance_accounting', 'consulting', 'other']);
  });
  it('leaves the unpublished remainder as room at the top, never a number', () => {
    const t = trajectory(COMMERCE_FIN)!;
    const y10 = t.points.find((p) => p.year === 10)!;
    expect(y10.rest).toBeCloseTo(1 - (90 + 30 + 15 + 8) / 160);
    expect(t.hasRest).toBe(true);
    expect(t.uneven).toBe(true);
  });
  it('never overflows when perturbed parts add up to more than n', () => {
    const g: TwinGroup = { ...COMMERCE_FIN, years: [pt(0, 100, [['finance_accounting', 100]]), pt(1, 100, [['finance_accounting', 70], ['consulting', 32]])] };
    const t = trajectory(g)!;
    const y1 = t.points[1];
    const total = Object.values(y1.cells).reduce((a, c) => a + (c?.h ?? 0), 0);
    expect(total).toBeCloseTo(1);
    expect(y1.rest).toBe(0);
    expect(y1.cells.finance_accounting!.share).toBe(0.7);
    expect(t.uneven).toBe(true);
    expect(t.now).toBeNull();
  });
  it('labels today with the snapshot and returns null with nothing to draw', () => {
    expect(trajectory(COMMERCE, { snapshot: 'Sep 2025' })!.now!.label).toBe('Today (Sep 2025)');
    expect(trajectory({ ...COMMERCE, years: [] })).toBeNull();
  });
  it('calls further study "More school" in the student view', () => {
    expect(trajectory(COMMERCE_STUDY, { mode: 'student' })!.series[0].label).toBe('More school');
  });
  it('notes partial denominators, missing years and uneven columns in plain words', () => {
    const notes = trajectoryNotes(trajectory(COMMERCE_FIN)!, { field: 5, named: 10 });
    expect(notes).toEqual([
      'Each year counts only the people who had reached it: year 10 is the 160 who graduated at least 10 years before the snapshot.',
      'Years 2, 7, 15 and 20 aren’t shown: fewer than 10 of them have been out that long.',
      'Columns don’t add up to exactly 100%: fields with fewer than 5 people are left out and every count is nudged slightly.',
    ]);
    const single = trajectoryNotes(trajectory({ ...COMMERCE, years: COMMERCE.years.filter((p) => p.year !== 20) })!);
    expect(single[1]).toBe('Year 20 isn’t shown: fewer than 10 of them have been out that long.');
  });
});

// ── Stickers ─────────────────────────────────────────────────────────────────

describe('stickers say only what the data supports', () => {
  it('Big Four or banks at the top of first employers', () => {
    expect(employerSticker(COMMERCE.employersFirst)).toBe('the Big Four top the list');
    expect(employerSticker(COMMERCE_RECENT.employersFirst)).toBe('the big banks top the list');
    expect(employerSticker([{ name: 'RBC', n: 9 }, { name: 'EY', n: 8 }, { name: 'KPMG', n: 7 }, { name: 'PwC', n: 6 }])).toBeNull();
    expect(employerSticker([{ name: 'EY', n: 9 }])).toBeNull();
  });
  it('first stop: a majority field, or more school in the lead', () => {
    expect(firstStopSticker(firstStop(COMMERCE))).toBeNull();
    expect(firstStopSticker(firstStop(LINGUISTICS))).toBe('more school tops the list');
    expect(firstStopSticker(firstStop({ years: [pt(0, 100, [['teaching', 60], ['law', 20]])] }))).toBe('most start in teaching');
    expect(firstStopSticker(firstStop({ years: [pt(0, 100, [['smaller_groups', 70], ['law', 20]])] }))).toBeNull();
  });
  it('stays put only when a majority are still in their first field around year 10', () => {
    expect(staySticker(COMMERCE_2010_FIN)).toBe('most of finance stays put');
    expect(staySticker(COMMERCE)).toBeNull();
    expect(staySticker({ ...COMMERCE_FIN, years: [pt(0, 50, [['finance_accounting', 50]]), pt(10, 40, [['finance_accounting', 20]])] })).toBeNull();
  });
});

// ── Alumni headline, seniority, managers ─────────────────────────────────────

describe('headlineStats', () => {
  it('leads with "still in the field they started in" and keeps every denominator', () => {
    const s = headlineStats(COMMERCE_2010_FIN);
    expect(s.map((x) => x.id)).toEqual(['stayed', 'pivoted', 'manager', 'abroad']);
    expect(s[0]).toEqual({ id: 'stayed', value: '53%', text: 'still work in finance & accounting today', detail: '64 of 120 twins' });
    expect(s[2]).toMatchObject({ value: 'Half', detail: '60 of the 120 twins who are 5+ years out' });
    expect(s[3]).toMatchObject({ value: '1 in 5', detail: '24 of 119 twins with a known location, 9 in the US' });
  });
  it('copes with null pivoted and located, and calls a widened group alumni', () => {
    const s = headlineStats(LINGUISTICS, 'alumni');
    expect(s).toEqual([{ id: 'topField', value: '24%', text: 'work in teaching today, the most common field', detail: '8 of 34 alumni' }]);
  });
});

describe('seniorityRows & managerPoints', () => {
  it('orders seniority by the ladder, as shares of the whole group', () => {
    const rows = seniorityRows(COMMERCE_2010_FIN);
    expect(rows.map((r) => r.id)).toEqual(['mid', 'manager', 'director']);
    expect(rows[2]).toMatchObject({ share: 30 / 120, managerPlus: true });
  });
  it('keeps suppressed manager points as null', () => {
    const g: TwinGroup = { ...COMMERCE, managerBy: [{ years: 3, n: null, of: 50 }, { years: 1, n: 9, of: 60 }, { years: 5, n: 1, of: 0 }] };
    expect(managerPoints(g)).toEqual([{ years: 1, of: 60, n: 9, share: 0.15 }, { years: 3, of: 50, n: null, share: null }]);
  });
});

// ── Links & layout ───────────────────────────────────────────────────────────

describe('links', () => {
  it('writes only the current mode’s parameters, in a stable order', () => {
    expect(twinQuery({ mode: 'student', level: 'undergrad', program: 'Commerce', job: 'tech', recent: true, first: 'law' }))
      .toBe('?level=undergrad&program=Commerce&job=tech&recent=1');
    expect(twinQuery({ mode: 'student', level: 'undergrad', program: 'Commerce', job: '*' })).toBe('?level=undergrad&program=Commerce');
    expect(twinQuery({ mode: 'alum', level: 'undergrad', program: 'Commerce', year: 2012, first: '*', job: 'tech', recent: true }))
      .toBe('?mode=alum&level=undergrad&program=Commerce&year=2012&first=any');
    expect(twinQuery({ mode: 'student' })).toBe('');
  });
  it('builds an absolute share URL under any base path', () => {
    expect(shareUrl('https://x.org', '/atlas', { mode: 'alum', level: 'mba', program: 'MBA' })).toBe('https://x.org/atlas/twin?mode=alum&level=mba&program=MBA');
  });
  it('links to the program’s River only when it has one', () => {
    expect(riverLink(META.programs, { level: 'undergrad', program: 'Commerce' }))
      .toEqual({ href: '/river?level=undergrad&program=Commerce', label: 'Follow Commerce in the River', own: true });
    expect(riverLink(META.programs, { level: 'undergrad', program: 'Linguistics' }))
      .toEqual({ href: '/river?level=undergrad', label: 'See all undergrads in the River', own: false });
    expect(riverLink(META.programs, { level: null, program: null }).href).toBe('/river');
    expect(riverHref({ level: 'law', program: null })).toBe('/river?level=law');
  });
  it('pairs half sections and widens an orphan', () => {
    expect(pairSections([true, false, false, true, false])).toEqual([true, false, false, true, true]);
    expect(pairSections([false, false, false])).toEqual([false, false, true]);
  });
});
