import type { Meta } from '../../data/types';
import {
  MIN_SIZES, NOISE_ODDS, RIVER_COLUMNS, SECTIONS, TWIN_YEARS, classReach, costPerThousand, decodeBase36, floorsOf, fmtDay,
  fmtMonth, fmtPct1, fmtShortUtc, fmtUsd, fmtUtc, foldSmallGroups, labellingStats, monthAxis, msToSnowflake, parseUtc,
  presentSticker, riverColumns, snapshotBars, snowflakeToMs, timelineMarks, viewedMonth,
} from './model';

describe('dates', () => {
  it('formats months, short and long, and passes junk through', () => {
    expect(fmtMonth('2025-09')).toBe('Sep 2025');
    expect(fmtMonth('2025-09', true)).toBe('September 2025');
    expect(fmtMonth('2025-1')).toBe('Jan 2025');
    expect(fmtMonth('2025-00')).toBe('2025-00');
    expect(fmtMonth('soon')).toBe('soon');
  });

  it('parses the export’s minute-precision timestamps as UTC', () => {
    expect(parseUtc('2025-09-29T20:52Z')?.toISOString()).toBe('2025-09-29T20:52:00.000Z');
    expect(parseUtc('2025-09-30T02:26')?.toISOString()).toBe('2025-09-30T02:26:00.000Z');
    expect(parseUtc('2025-09-30')?.toISOString()).toBe('2025-09-30T00:00:00.000Z');
    expect(parseUtc('2025-09-30T02:26:31.464Z')?.getTime()).toBe(1759199191464);
    expect(parseUtc('')).toBeNull();
    expect(parseUtc(undefined)).toBeNull();
    expect(parseUtc('not a date')).toBeNull();
  });

  it('prints dates in UTC whatever the local zone', () => {
    const d = new Date(Date.UTC(2025, 8, 29, 20, 52));
    expect(fmtUtc(d)).toBe('2025-09-29 20:52 UTC');
    expect(fmtShortUtc(d)).toBe('Sep 29, 20:52 UTC');
    expect(fmtDay(d)).toBe('29 September 2025');
    expect(fmtDay(d, true)).toBe('29 Sep 2025');
    expect(fmtUtc(null)).toBe('—');
    expect(fmtDay(null)).toBe('—');
  });
});

describe('clue 1: “Present” arithmetic', () => {
  it('counts months inclusively', () => {
    expect(viewedMonth(2025, 1, 9)).toEqual({ year: 2025, month: 9 });
    expect(viewedMonth(2025, 9, 1)).toEqual({ year: 2025, month: 9 });
  });

  it('wraps across years and treats a zero duration as one month', () => {
    expect(viewedMonth(2024, 11, 3)).toEqual({ year: 2025, month: 1 });
    expect(viewedMonth(2010, 6, 12 * 15 + 4)).toEqual({ year: 2025, month: 9 });
    expect(viewedMonth(2025, 9, 0)).toEqual({ year: 2025, month: 9 });
  });

  it('orders the chart newest first and flags the mode', () => {
    const bars = snapshotBars([
      { month: '2025-07', pct: 1.8 }, { month: '2025-09', pct: 84.8 }, { month: '2025-08', pct: 12.1 },
    ]);
    expect(bars.map((b) => b.month)).toEqual(['2025-09', '2025-08', '2025-07']);
    expect(bars[0]).toMatchObject({ label: 'September 2025', width: 1, top: true });
    expect(bars[1].top).toBe(false);
    expect(bars[2].width).toBeCloseTo(1.8 / 84.8);
  });

  it('survives empty, zero and invalid rows', () => {
    expect(snapshotBars([])).toEqual([]);
    expect(snapshotBars(undefined)).toEqual([]);
    expect(snapshotBars([{ month: '2025-09', pct: 0 }])[0]).toMatchObject({ width: 0, top: false });
    expect(snapshotBars([{ month: '2025-09', pct: Number.NaN }, { month: '2025-08', pct: -1 }])).toEqual([]);
  });

  it('prints one decimal unless whole', () => {
    expect(fmtPct1(84.8)).toBe('84.8%');
    expect(fmtPct1(12)).toBe('12%');
    expect(fmtPct1(0.44)).toBe('0.4%');
    expect(fmtPct1(Number.NaN)).toBe('—');
  });
});

describe('clue 2: snowflakes', () => {
  it('round-trips a timestamp through the top 41 bits', () => {
    const ms = BigInt(Date.UTC(2025, 8, 29, 20, 52));
    const id = msToSnowflake(ms);
    expect(snowflakeToMs(id)).toBe(ms);
    expect(snowflakeToMs(id + 4_194_303n)).toBe(ms); // the low 22 bits never change the time
    expect(id.toString()).toHaveLength(19);
  });

  it('decodes a real-shaped ID', () => {
    expect(snowflakeToMs(7378532019732480000n)).toBe(1759179120000n);
    expect(snowflakeToMs(0n)).toBe(0n);
  });
});

describe('clue 3: base36', () => {
  it('decodes the export file prefix to the right minute', () => {
    const ms = decodeBase36('mg5xrzjc');
    expect(ms).toBe(1759199191464);
    expect(new Date(ms!).toISOString().slice(0, 16)).toBe('2025-09-30T02:26');
    expect(decodeBase36('MG5XRZJC')).toBe(1759199191464);
  });

  it('rejects anything that is not plain base36', () => {
    expect(decodeBase36('')).toBeNull();
    expect(decodeBase36('mg5x-rzjc')).toBeNull();
    expect(decodeBase36('zzzzzzzzzzzzz')).toBeNull(); // 13 chars: past safe integers
  });
});

describe('timeline', () => {
  const axis = monthAxis(parseUtc('2025-09-30'))!;

  it('spans the as-of month', () => {
    expect(axis.from.toISOString()).toBe('2025-09-01T00:00:00.000Z');
    expect(axis.to.toISOString()).toBe('2025-10-01T00:00:00.000Z');
    expect(monthAxis(null)).toBeNull();
    const dec = monthAxis(parseUtc('2025-12-15'))!;
    expect(dec.to.toISOString()).toBe('2026-01-01T00:00:00.000Z');
  });

  it('places marks as fractions, clamps outliers and drops missing dates', () => {
    const marks = timelineMarks([
      { id: 'mid', label: 'mid', date: parseUtc('2025-09-16') },
      { id: 'late', label: 'late', date: parseUtc('2025-11-01') },
      { id: 'early', label: 'early', date: parseUtc('2025-08-01') },
      { id: 'none', label: 'none', date: null },
    ], axis.from, axis.to);
    expect(marks.map((m) => m.id)).toEqual(['mid', 'late', 'early']);
    expect(marks[0].x).toBeCloseTo(0.5);
    expect(marks[1].x).toBe(1);
    expect(marks[2].x).toBe(0);
    expect(timelineMarks([{ id: 'a', label: 'a', date: axis.from }], axis.to, axis.from)).toEqual([]);
  });
});

describe('labelling', () => {
  const l = { titles: 189821, employers: 20350, fields: 12046, places: 8052, costUsd: 65.33, model: 'Claude Sonnet 5.5' };

  it('totals the labelled strings', () => {
    const { stats, total } = labellingStats(l);
    expect(stats.map((s) => s.id)).toEqual(['titles', 'employers', 'fields', 'places']);
    expect(total).toBe(230269);
    expect(labellingStats(undefined)).toEqual({ stats: [], total: 0 });
    expect(labellingStats({ ...l, places: 0 }).stats).toHaveLength(3);
  });

  it('prices it', () => {
    expect(fmtUsd(65.33)).toBe('$65.33');
    expect(fmtUsd(Number.NaN)).toBe('—');
    expect(costPerThousand(65.33, 230269)).toBe('$0.28');
    expect(costPerThousand(0.001, 1_000_000)).toBe('<$0.01');
    expect(costPerThousand(10, 0)).toBe('—');
  });
});

describe('privacy fold', () => {
  it('folds groups under k into one row that only shows once it reaches k', () => {
    const out = foldSmallGroups([{ label: 'A', n: 142 }, { label: 'B', n: 9 }, { label: 'C', n: 6 }, { label: 'D', n: 21 }], 10);
    expect(out.map((g) => [g.label, g.n])).toEqual([['A', 142], ['D', 21], ['Smaller groups', 15]]);
    expect(out[2]).toMatchObject({ folded: true, parts: 2 });
  });

  it('drops the folded row when it is itself under k, and ignores zeros', () => {
    const out = foldSmallGroups([{ label: 'A', n: 50 }, { label: 'B', n: 4 }, { label: 'C', n: 0 }], 10);
    expect(out.map((g) => g.label)).toEqual(['A']);
    expect(foldSmallGroups([], 10)).toEqual([]);
    expect(foldSmallGroups([{ label: 'A', n: 10 }], 10)[0].folded).toBe(false); // exactly k is shown
  });
});

describe('sections', () => {
  it('has unique ids for the table of contents', () => {
    expect(new Set(SECTIONS.map((s) => s.id)).size).toBe(SECTIONS.length);
  });

  it('keeps the anchors the footer links to', () => {
    expect(SECTIONS.map((s) => s.id)).toEqual(expect.arrayContaining(['data', 'privacy']));
    expect(SECTIONS.find((s) => s.id === 'dating')?.title).toBe('Dating the snapshot');
  });
});

describe('floors', () => {
  it('reads both floors from meta.k', () => {
    expect(floorsOf({ field: 5, named: 10 })).toEqual({ field: 5, named: 10 });
    expect(floorsOf({ field: 7, named: 14 })).toEqual({ field: 7, named: 14 });
  });

  it('reads an older single number as both floors, and falls back for junk', () => {
    expect(floorsOf(10)).toEqual({ field: 10, named: 10 });
    expect(floorsOf(undefined)).toEqual({ field: 5, named: 10 });
    expect(floorsOf(null)).toEqual({ field: 5, named: 10 });
    expect(floorsOf(Number.NaN)).toEqual({ field: 5, named: 10 });
    expect(floorsOf({ field: Number.NaN, named: 10 })).toEqual({ field: 5, named: 10 });
  });

  it('keeps the minimum sizes and the noise odds the pipeline uses', () => {
    expect(MIN_SIZES).toEqual({ riverClass: 30, twinGroup: 20, diasporaFilter: 50, yearPoint: 10, leaderboard: 100 });
    expect(NOISE_ODDS.reduce((a, o) => a + o.pct, 0)).toBe(100);
    expect(NOISE_ODDS.find((o) => o.delta === 0)?.pct).toBe(40);
    expect(NOISE_ODDS.filter((o) => Math.abs(o.delta) === 1).reduce((a, o) => a + o.pct, 0)).toBe(40);
    expect(Math.max(...NOISE_ODDS.map((o) => Math.abs(o.delta)))).toBe(2);
  });
});

describe('river columns by class', () => {
  it('lists the columns in order', () => {
    expect(RIVER_COLUMNS.map((c) => c.id)).toEqual(['s0', 'y3', 'y5', 'y10', 'y20', 'now']);
    expect(TWIN_YEARS).toEqual([0, 1, 2, 3, 5, 7, 10, 15, 20]);
  });

  it('gives a class only the years its last graduates have reached by the snapshot', () => {
    expect(riverColumns(1999, '2025-09')).toEqual(['s0', 'y3', 'y5', 'y10', 'y20', 'now']);
    expect(riverColumns(2004, '2025-09')).toEqual(['s0', 'y3', 'y5', 'y10', 'y20', 'now']);
    expect(riverColumns(2009, '2025-09')).toEqual(['s0', 'y3', 'y5', 'y10', 'now']);
    expect(riverColumns(2014, '2025-09')).toEqual(['s0', 'y3', 'y5', 'y10', 'now']);
    expect(riverColumns(2019, '2025-09')).toEqual(['s0', 'y3', 'y5', 'now']);
    expect(riverColumns(2024, '2025-09')).toEqual(['s0', 'now']);
  });

  it('counts a June only once the snapshot is past it', () => {
    expect(riverColumns(2020, '2025-06')).toEqual(['s0', 'y3', 'y5', 'now']);
    expect(riverColumns(2020, '2025-05')).toEqual(['s0', 'y3', 'now']);
    expect(riverColumns(2020, 'soon')).toEqual(['s0', 'now']);
  });

  it('builds one row per class, oldest first, then all classes', () => {
    const cohorts: Meta['cohorts'] = [
      { id: 'all', label: 'Classes of 1995–2024', from: 1995, to: 2024 },
      { id: '2015-2019', label: 'Class of 2015–2019', from: 2015, to: 2019 },
      { id: '1995-1999', label: 'Class of 1995–1999', from: 1995, to: 1999 },
    ];
    expect(classReach(cohorts, '2025-09')).toEqual([
      { id: '1995-1999', label: '1995–1999', columns: ['s0', 'y3', 'y5', 'y10', 'y20', 'now'] },
      { id: '2015-2019', label: '2015–2019', columns: ['s0', 'y3', 'y5', 'now'] },
      { id: 'all', label: 'All, 1995–2024', columns: ['s0', 'now'] },
    ]);
    expect(classReach(undefined, '2025-09')).toEqual([]);
  });
});

describe('present sticker', () => {
  it('names the month only when it holds a majority', () => {
    expect(presentSticker([{ month: '2025-09', pct: 83 }, { month: '2025-08', pct: 12 }])).toBe('most say september');
    expect(presentSticker([{ month: '2025-09', pct: 45 }, { month: '2025-08', pct: 40 }])).toBeNull();
    expect(presentSticker([])).toBeNull();
    expect(presentSticker(undefined)).toBeNull();
  });
});
