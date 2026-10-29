import type { Fact, ProgramInfo, ProgramRanking, RiverSlice } from '../../data/types';
import {
  FEATURED_FACTS, HERO_SLICE, LEVEL_GRADS, STAGE_PHRASE, employerBars, factLinkLabel, factSticker, factVisual, featuredFacts,
  findChoice, firstEmployerNote, fmtShare, fmtSnapshot, headlineNumber, heroStory, homeHref, isNumericValue, layoutFlows,
  nextTabIndex, ordinal, popularChoices, programChoices, programLabel, programRanks, rankingNote, rankingTab, rankRows,
  riverHref, sectorFlows, twinHref, usableRankings,
} from './model';
import type { FlowData } from './model';

describe('numbers', () => {
  it('rounds the headline to thousands, keeps small numbers exact', () => {
    expect(headlineNumber(12_345)).toBe('12,000');
    expect(headlineNumber(1_234_567)).toBe('1,235,000');
    expect(headlineNumber(999)).toBe('999');
    expect(headlineNumber(1499)).toBe('1,000');
    expect(headlineNumber(0)).toBe('0');
    expect(headlineNumber(-5)).toBe('0');
    expect(headlineNumber(Number.NaN)).toBe('0');
  });

  it('formats the snapshot month', () => {
    expect(fmtSnapshot('2025-09')).toBe('September 2025');
    expect(fmtSnapshot('2025-09', 'short')).toBe('Sep 2025');
    expect(fmtSnapshot('2026-01', 'short')).toBe('Jan 2026');
    expect(fmtSnapshot('2025-13')).toBe('2025-13');
    expect(fmtSnapshot('Sept')).toBe('Sept');
  });

  it('formats shares: whole from 10%, one decimal below, <1% for tiny', () => {
    expect(fmtShare(53.5)).toBe('54%');
    expect(fmtShare(9.5)).toBe('9.5%');
    expect(fmtShare(5)).toBe('5%');
    expect(fmtShare(4.04)).toBe('4%');
    expect(fmtShare(0.3)).toBe('<1%');
    expect(fmtShare(0)).toBe('0%');
    expect(fmtShare(100)).toBe('100%');
    expect(fmtShare(Number.NaN)).toBe('—');
  });

  it('writes ordinals', () => {
    expect([1, 2, 3, 4, 10, 11, 12, 13, 21, 22, 23, 101, 111].map(ordinal))
      .toEqual(['1st', '2nd', '3rd', '4th', '10th', '11th', '12th', '13th', '21st', '22nd', '23rd', '101st', '111th']);
  });
});

describe('program labels', () => {
  it('tags every program with its level, so a list never mixes tagged and bare names', () => {
    expect(programLabel('undergrad', 'Computer Science').text).toBe('Computer Science (undergrad)');
    expect(programLabel('graduate', 'Computer Science').text).toBe('Computer Science (master’s/PhD)');
    expect(programLabel('graduate', 'Finance')).toEqual({ name: 'Finance', tag: 'master’s/PhD', text: 'Finance (master’s/PhD)' });
    expect(programLabel('undergrad', '  Commerce ')).toEqual({ name: 'Commerce', tag: 'undergrad', text: 'Commerce (undergrad)' });
  });

  it('never repeats a level the name already says', () => {
    expect(programLabel('mba', 'MBA').text).toBe('MBA');
    expect(programLabel('law', 'Law').text).toBe('Law');
    expect(programLabel('medicine', 'Medicine').text).toBe('Medicine');
    expect(programLabel('graduate', 'MBA').text).toBe('MBA (master’s/PhD)');
    expect(programLabel('all', 'all').tag).toBeNull();
  });
});

// ── Program search ───────────────────────────────────────────────────────────

const programs: ProgramInfo[] = [
  { level: 'graduate', program: 'Computer Science', discipline: 'computing', n: 200, river: true },
  { level: 'undergrad', program: 'Commerce', discipline: 'business_commerce', n: 900, river: true },
  { level: 'law', program: 'Law', discipline: 'law', n: 700, river: true },
  { level: 'undergrad', program: 'Computer Science', discipline: 'computing', n: 400, river: true },
  { level: 'graduate', program: 'Law', discipline: 'law', n: 25, river: false },
  { level: 'graduate', program: 'Art Conservation', discipline: 'fine_performing_arts', n: 60 },   // older file: no flag
  { level: 'undergrad', program: 'Film and Media', discipline: 'fine_performing_arts', n: 300, river: true },
  { level: 'undergrad', program: 'Commerce', discipline: 'business_commerce', n: 900, river: true },  // duplicate
];

describe('program choices', () => {
  const choices = programChoices(programs);

  it('lists every program once, largest first, with the level shown only for shared names', () => {
    expect(choices.map((c) => c.text)).toEqual([
      'Commerce', 'Law (JD)', 'Computer Science (undergrad)', 'Film and Media', 'Computer Science (master’s/PhD)',
      'Art Conservation', 'Law (master’s/PhD)',
    ]);
    const cs = choices.find((c) => c.key === 'graduate|Computer Science')!;
    expect(cs).toMatchObject({ level: 'graduate', program: 'Computer Science', tag: 'master’s/PhD', levelLabel: 'Master’s & PhD', n: 200 });
    expect(choices.find((c) => c.program === 'Commerce')).toMatchObject({ tag: null, levelLabel: 'Undergraduate' });
  });

  it('reads the river flag, assuming a River when an older file leaves it out', () => {
    expect(choices.find((c) => c.key === 'graduate|Law')!.river).toBe(false);
    expect(choices.find((c) => c.key === 'graduate|Art Conservation')!.river).toBe(true);
    expect(programChoices(undefined)).toEqual([]);
    expect(programChoices([{ level: 'all' as 'undergrad', program: 'all', discipline: '', n: 5 }])).toEqual([]);
  });

  it('finds a choice from URL values, tolerating case, and nothing for junk', () => {
    expect(findChoice(choices, 'law', 'Law')?.key).toBe('law|Law');
    expect(findChoice(choices, 'undergrad', 'film AND media')?.key).toBe('undergrad|Film and Media');
    expect(findChoice(choices, 'mba', 'Law')).toBeNull();
    expect(findChoice(choices, 'undergrad', null)).toBeNull();
    expect(findChoice(choices, null, 'Commerce')).toBeNull();
  });

  it('picks popular chips by size, one per name', () => {
    expect(popularChoices(choices, 4).map((c) => c.key)).toEqual(['undergrad|Commerce', 'law|Law', 'undergrad|Computer Science', 'undergrad|Film and Media']);
    expect(popularChoices([], 4)).toEqual([]);
  });

  it('links a program to its River and to Career Twin in student mode', () => {
    const film = findChoice(choices, 'undergrad', 'Film and Media')!;
    expect(riverHref(film)).toBe('/river?level=undergrad&program=Film+and+Media');
    expect(twinHref(film)).toBe('/twin?mode=student&level=undergrad&program=Film+and+Media');
    expect(homeHref(film)).toBe('/?level=undergrad&program=Film+and+Media');
    expect(homeHref(null)).toBe('/');
  });

  it('sends a program too small for a River to its level’s River, but still to Twin', () => {
    const law = findChoice(choices, 'graduate', 'Law')!;
    expect(riverHref(law)).toBe('/river?level=graduate');
    expect(twinHref(law)).toBe('/twin?mode=student&level=graduate&program=Law');
    expect(LEVEL_GRADS.graduate).toBe('master’s and PhD grads');
  });

  it('finds where a program sits on the leaderboards, best rank first, matching the level', () => {
    const rankings: ProgramRanking[] = [
      { id: 'finance_now', label: 'In finance & accounting today', rows: [
        { level: 'graduate', program: 'Finance', n: 500, hits: 270, pct: 54 },
        { level: 'undergrad', program: 'Commerce', n: 900, hits: 290, pct: 32 },
      ] },
      { id: 'consulting_now', label: 'In consulting today', rows: [
        { level: 'undergrad', program: 'Commerce', n: 900, hits: 100, pct: 11 },
        { level: 'graduate', program: 'Commerce', n: 300, hits: 20, pct: 7 },
      ] },
      { id: 'empty', label: 'Nothing', rows: [] },
    ];
    const commerce = findChoice(choices, 'undergrad', 'Commerce');
    expect(programRanks(rankings, commerce)).toEqual([
      { id: 'consulting_now', label: 'In consulting today', rank: 1, share: '11%' },
      { id: 'finance_now', label: 'In finance & accounting today', rank: 2, share: '32%' },
    ]);
    expect(programRanks(rankings, findChoice(choices, 'law', 'Law'))).toEqual([]);
    expect(programRanks(undefined, commerce)).toEqual([]);
    expect(programRanks(rankings, null)).toEqual([]);
  });
});

// ── Leaderboards ─────────────────────────────────────────────────────────────

const ranking: ProgramRanking = {
  id: 'tech_now', label: 'Working in tech today',
  rows: [
    { level: 'undergrad', program: 'Computer Science', n: 605, hits: 316, pct: 52.2 },
    { level: 'undergrad', program: 'Computer Engineering', n: 507, hits: 271, pct: 53.5 },
    { level: 'graduate', program: 'Computer Science', n: 274, hits: 137, pct: 50 },
  ],
};

describe('leaderboards', () => {
  it('sorts by share, ranks from 1 and scales bars to the top row', () => {
    const rows = rankRows(ranking);
    expect(rows.map((r) => r.rank)).toEqual([1, 2, 3]);
    expect(rows[0].label.text).toBe('Computer Engineering (undergrad)');
    expect(rows[0].width).toBe(1);
    expect(rows[2].label.text).toBe('Computer Science (master’s/PhD)');
    expect(rows[2].width).toBeCloseTo(50 / 53.5);
    expect(new Set(rows.map((r) => r.key)).size).toBe(3); // same name, different level -> different keys
  });

  it('handles empty and all-zero rankings', () => {
    expect(rankRows({ ...ranking, rows: [] })).toEqual([]);
    const zero = rankRows({ ...ranking, rows: [{ level: 'undergrad', program: 'X', n: 100, hits: 0, pct: 0 }] });
    expect(zero[0].width).toBe(0);
  });

  it('keeps only rankings with rows', () => {
    expect(usableRankings(undefined)).toEqual([]);
    expect(usableRankings([ranking, { id: 'x', label: 'X', rows: [] }]).map((r) => r.id)).toEqual(['tech_now']);
  });

  it('names tabs, with a fallback for new rankings', () => {
    expect(rankingTab(ranking)).toBe('Tech');
    expect(rankingTab({ id: 'us_now', label: 'Living in the United States', rows: [] })).toBe('In the US');
    expect(rankingTab({ id: 'new_metric', label: 'Something new', rows: [] })).toBe('Something new');
  });

  it('describes who is counted', () => {
    expect(rankingNote(ranking, { from: 1995, to: 2024 }, 100)).toBe(
      'Top 3 programs by share of grads, classes of 1995–2024. Programs with at least 100 grads.');
    expect(rankingNote({ ...ranking, id: 'us_now', rows: ranking.rows.slice(0, 1) }, { from: 1995, to: 2024 }, 1000))
      .toBe('The one program by share of grads with a known location, classes of 1995–2024. Programs with at least 1,000 grads.');
  });

  it('moves between tabs with arrows, Home and End, wrapping around', () => {
    expect(nextTabIndex(0, 'ArrowRight', 3)).toBe(1);
    expect(nextTabIndex(2, 'ArrowRight', 3)).toBe(0);
    expect(nextTabIndex(0, 'ArrowLeft', 3)).toBe(2);
    expect(nextTabIndex(1, 'Home', 3)).toBe(0);
    expect(nextTabIndex(1, 'End', 3)).toBe(2);
    expect(nextTabIndex(1, 'Enter', 3)).toBeNull();
    expect(nextTabIndex(0, 'ArrowRight', 0)).toBeNull();
  });
});

describe('employers', () => {
  it('sorts, limits and scales', () => {
    const rows = employerBars([{ name: 'B', n: 50 }, { name: 'A', n: 200 }, { name: 'C', n: 0 }], 5);
    expect(rows.map((r) => r.name)).toEqual(['A', 'B']);
    expect(rows[1].width).toBe(0.25);
    expect(rows[1].rank).toBe(2);
    expect(employerBars(undefined)).toEqual([]);
    expect(employerBars([{ name: 'A', n: 1 }], 0)).toEqual([]);
  });
});

// ── Facts ────────────────────────────────────────────────────────────────────

describe('fact cards', () => {
  it('picks an honest visual from the display value', () => {
    expect(factVisual('39%')).toEqual({ kind: 'share', share: 0.39 });
    expect(factVisual('12.5 %')).toEqual({ kind: 'share', share: 0.125 });
    expect(factVisual('1 in 34')).toEqual({ kind: 'oneIn', of: 34 });
    expect(factVisual('1 in 1,200')).toEqual({ kind: 'share', share: 1 / 1200 });
    expect(factVisual('1 in 1')).toEqual({ kind: 'none' });
    expect(factVisual('0%')).toEqual({ kind: 'none' });
    expect(factVisual('140%')).toEqual({ kind: 'none' });
    expect(factVisual("Queen's University")).toEqual({ kind: 'none' });
    expect(factVisual('4,212')).toEqual({ kind: 'none' });
    expect(factVisual('')).toEqual({ kind: 'none' });
  });

  it('tells numbers from words', () => {
    expect(isNumericValue('13%')).toBe(true);
    expect(isNumericValue('1 in 34')).toBe(true);
    expect(isNumericValue('4,212')).toBe(true);
    expect(isNumericValue("Queen's University")).toBe(false);
    expect(isNumericValue('%')).toBe(false);
  });

  it('labels links by destination and drops missing or external ones', () => {
    expect(factLinkLabel('/river?level=law&program=Law')).toBe('See it in the River');
    expect(factLinkLabel('/diaspora')).toBe('See it on the map');
    expect(factLinkLabel('/twin#x')).toBe('Find your career twin');
    expect(factLinkLabel('/method')).toBe('How it was measured');
    expect(factLinkLabel('/somewhere')).toBe('Open it');
    expect(factLinkLabel(undefined)).toBeNull();
    expect(factLinkLabel('')).toBeNull();
    expect(factLinkLabel('https://example.com')).toBeNull();
  });

  const fact = (id: string, extra: Partial<Fact> = {}): Fact => ({ id, value: '1%', text: id, ...extra });

  it('features the chosen three in order', () => {
    expect(FEATURED_FACTS).toEqual(['top_metro', 'law_stays', 'consulting_exit']);
    const facts = ['abroad', 'kingston', ...FEATURED_FACTS].reverse().map((id) => fact(id));
    const { featured, rest } = featuredFacts(facts);
    expect(featured.map((f) => f.id)).toEqual(['top_metro', 'law_stays', 'consulting_exit']);
    expect(rest.map((f) => f.id)).toEqual(['kingston', 'abroad']);
  });

  it('fills gaps left by missing ids from the remaining facts, in file order', () => {
    const facts = ['x1', 'law_stays', 'x2', 'x3'].map((id) => fact(id));
    expect(featuredFacts(facts).featured.map((f) => f.id)).toEqual(['law_stays', 'x1', 'x2']);
    expect(featuredFacts([fact('a'), fact('b')])).toEqual({ featured: [fact('a'), fact('b')], rest: [] });
    expect(featuredFacts(undefined)).toEqual({ featured: [], rest: [] });
    expect(featuredFacts([fact('a'), fact('b')], ['b'], 1).featured.map((f) => f.id)).toEqual(['b']);
  });

  it('adds a sticker only where the fact’s own number backs it', () => {
    expect(factSticker(fact('law_stays', { value: '71%' }))).toBe('most lawyers are still lawyers');
    expect(factSticker(fact('law_stays', { value: '49%' }))).toBeNull();
    expect(factSticker(fact('law_stays', { value: 'most' }))).toBeNull();
    expect(factSticker(fact('top_metro', { value: '80%' }))).toBeNull();
  });

  it('explains a university topping the first-employer list, from the fact that says so', () => {
    const facts = [fact('top_first_employer', { value: "Queen's University", detail: 'Mostly research and teaching roles.' })];
    expect(firstEmployerNote(facts, { name: 'Queen’s University' })).toBe('Queen’s University: Mostly research and teaching roles.');
    expect(firstEmployerNote(facts, { name: 'RBC' })).toBeNull(); // the fact no longer names the top row
    expect(firstEmployerNote([fact('top_first_employer', { value: "Queen's University" })], { name: "Queen's University" })).toBeNull();
    expect(firstEmployerNote(undefined, { name: 'RBC' })).toBeNull();
    expect(firstEmployerNote(facts, undefined)).toBeNull();
  });
});

// ── River card ───────────────────────────────────────────────────────────────

describe('river card', () => {
  const slice: RiverSlice = {
    level: 'all', program: 'all', cohort: '2010-2014', n: 100, stages: ['s0', 'now'], suppressed: null, details: {}, years: [],
    totals: {
      s0: { tech: 30, finance_accounting: 40, consulting: 20, no_role_listed: 10 },
      now: { tech: 50, finance_accounting: 30, founder: 20 },
    },
    links: [
      { from_stage: 's0', from: 'tech', to_stage: 'now', to: 'tech', n: 30 },
      { from_stage: 's0', from: 'finance_accounting', to_stage: 'now', to: 'finance_accounting', n: 30 },
      { from_stage: 's0', from: 'consulting', to_stage: 'now', to: 'finance_accounting', n: 10 }, // same sector
      { from_stage: 's0', from: 'consulting', to_stage: 'now', to: 'founder', n: 10 },
      { from_stage: 's0', from: 'finance_accounting', to_stage: 'now', to: 'tech', n: 10 },
    ],
  };

  it('draws the classes of 2010–2014, every program', () => {
    expect(HERO_SLICE).toEqual({ level: 'all', program: 'all', cohort: '2010-2014' });
  });

  it('rolls families up to sectors, summing nodes and links', () => {
    const f = sectorFlows(slice);
    expect(f.stages).toEqual(['s0', 'now']);
    expect(f.nodes.find((n) => n.stage === 's0' && n.sector === 'finance')?.value).toBe(60); // finance + consulting
    expect(f.nodes.find((n) => n.stage === 's0' && n.sector === 'neutral')?.value).toBe(10);
    expect(f.links.find((l) => l.fromSector === 'finance' && l.toSector === 'finance')?.value).toBe(40);
    expect(f.links.reduce((a, l) => a + l.value, 0)).toBe(90);
    expect(f.nodes.filter((n) => n.stage === 's0').map((n) => n.sector)).toEqual(['tech', 'finance', 'neutral']); // palette order
  });

  it('returns an empty flow for a missing slice', () => {
    expect(sectorFlows(undefined)).toEqual({ stages: [], nodes: [], links: [], n: 0 });
  });

  it('lays nodes out inside the box and keeps ribbons within their nodes', () => {
    const L = layoutFlows(sectorFlows(slice), { width: 400, height: 200, nodeWidth: 6, gap: 8 });
    for (const n of L.nodes) {
      expect(n.y).toBeGreaterThanOrEqual(-1e-9);
      expect(n.y + n.h).toBeLessThanOrEqual(200 + 1e-9);
    }
    expect(L.nodes.filter((n) => n.stage === 's0').every((n) => n.x === 0)).toBe(true);
    expect(L.nodes.filter((n) => n.stage === 'now').every((n) => n.x === 394)).toBe(true);
    for (const n of L.nodes) {
      const out = L.links.filter((l) => l.from === n.stage && l.fromSector === n.sector).reduce((a, l) => a + l.w, 0);
      const inn = L.links.filter((l) => l.to === n.stage && l.toSector === n.sector).reduce((a, l) => a + l.w, 0);
      expect(out).toBeLessThanOrEqual(n.h + 1e-9);
      expect(inn).toBeLessThanOrEqual(n.h + 1e-9);
    }
    for (const l of L.links) expect(l.d).toMatch(/^M[\d.]+,[\d.]+C/);
  });

  it('computes the story from the slice: management & ventures at every column', () => {
    // s0: 0 of 100 in management -> no story; now: founders 20 of 100.
    expect(heroStory(sectorFlows(slice))).toBeNull();
    const withMgmt: RiverSlice = {
      ...slice,
      totals: {
        s0: { ...slice.totals.s0, operations_management: 10 },                 // 10 of 110
        now: { tech: 50, finance_accounting: 30, operations_management: 15, founder: 20 }, // 35 of 115
      },
    };
    const story = heroStory(sectorFlows(withMgmt))!;
    expect(story.from).toMatchObject({ stage: 's0', share: '9.1%' });
    expect(story.from.pct).toBeCloseTo(100 * 10 / 110);
    expect(story.to).toMatchObject({ stage: 'now', share: '30%' });
    expect(story.path.map((p) => p.stage)).toEqual(['s0', 'now']);
    expect(story.rising).toBe(true);
    expect(story.steady).toBe(true);
    const falling = heroStory(sectorFlows({ ...withMgmt, totals: { s0: { operations_management: 40, tech: 60 }, now: { operations_management: 30, tech: 70 } } }))!;
    expect(falling.rising).toBe(false);
    expect(falling.steady).toBe(false);
    expect(heroStory(sectorFlows(undefined))).toBeNull();
    expect(heroStory({ stages: ['now'], nodes: [{ stage: 'now', sector: 'management', value: 5 }], links: [], n: 5 })).toBeNull();
  });

  it('calls growth steady only when no column dips', () => {
    const node = (stage: 's0' | 'y5' | 'y10' | 'now', mgmt: number) => [
      { stage, sector: 'management' as const, value: mgmt }, { stage, sector: 'tech' as const, value: 100 - mgmt },
    ];
    const flows = (a: number, b: number, c: number, d: number): FlowData => ({
      stages: ['s0', 'y5', 'y10', 'now'], n: 100, links: [],
      nodes: [...node('s0', a), ...node('y5', b), ...node('y10', c), ...node('now', d)],
    });
    expect(heroStory(flows(10, 12, 15, 19))!.steady).toBe(true);
    const dip = heroStory(flows(10, 16, 13, 19))!;
    expect(dip.rising).toBe(true);
    expect(dip.steady).toBe(false);
  });

  it('phrases every stage id, years included', () => {
    expect(STAGE_PHRASE).toEqual({
      s0: 'at the first job', y3: 'at year 3', y5: 'at year 5', y10: 'at year 10', y20: 'at year 20', now: 'today',
    });
  });

  it('degrades to nothing for empty data or a zero-size box', () => {
    expect(layoutFlows(sectorFlows(undefined), { width: 400, height: 200 }).nodes).toEqual([]);
    expect(layoutFlows(sectorFlows(slice), { width: 0, height: 200 }).links).toEqual([]);
    const one = layoutFlows({ stages: ['now'], nodes: [{ stage: 'now', sector: 'tech', value: 5 }], links: [], n: 5 }, { width: 100, height: 50 });
    expect(one.nodes).toHaveLength(1);
    expect(one.nodes[0].h).toBe(50);
  });
});
