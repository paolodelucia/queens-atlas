import { describe, expect, it } from 'vitest';
import { layoutRiver, layoutYears } from './layout';
import type { LayoutOptions, YearsLayoutOptions } from './layout';
import { REST, buildSankeyInput, rollUpSlice, stackRow, yearSeries } from './model';
import {
  LANES_AT, MORPH_MS, alignKnots, bandAt, bandPath, easeInOut, framePath, morphOpacity, placeShape, planMorph, ramp,
  sankeyShape, yearsShape,
} from './morph';
import type { ChartShape } from './morph';
import { allAlumni, commerce, makeSlice } from './testFixture';

const FLOW: LayoutOptions = {
  width: 1000, height: 500, nodeWidth: 12, nodePadding: 8,
  margin: { top: 50, right: 100, bottom: 10, left: 100 }, labelSpacing: 15, minGap: 130,
};
const YEARS: YearsLayoutOptions = {
  width: 800, height: 380, margin: { top: 30, right: 4, bottom: 62, left: 42 }, todayGap: 22, barWidth: 30, fontSize: 12,
};

const flowLayout = layoutRiver(buildSankeyInput(commerce), FLOW, 'c');
const series = yearSeries(commerce, false);
const yearsLayout = layoutYears(series, YEARS);
const flow = sankeyShape(flowLayout);
const years = yearsShape(series, yearsLayout);

describe('sankeyShape', () => {
  it('gives every column four knots at its career time: open, bar left, bar right, close', () => {
    expect(flow.knots).toHaveLength(4 * flowLayout.stages.length);
    expect(flow.knots.slice(0, 4).map((k) => [k.tau, k.kind])).toEqual([[0, 'lead'], [0, 'full'], [0, 'full'], [0, 'trail']]);
    expect(flow.knots.slice(4, 8).every((k) => k.tau === 3)).toBe(true);
    expect(flow.knots.slice(-4).every((k) => k.tau === 'now')).toBe(true);
    const x0 = flowLayout.stages[0].x;
    expect(flow.knots.slice(0, 4).map((k) => k.x)).toEqual([x0, x0, x0 + 12, x0 + 12]);
  });

  it('reproduces each bar exactly, with zero-height knots either side', () => {
    const node = flowLayout.nodes.find((d) => d.id === 's0:finance_accounting')!;
    const fin = flow.bands.get('finance_accounting')!;
    expect([fin.top[1], fin.bottom[1], fin.top[2], fin.bottom[2]]).toEqual([node.y0, node.y1, node.y0, node.y1]);
    expect(fin.top[0]).toBe(fin.bottom[0]);
    expect(fin.top[0]).toBeCloseTo((node.y0 + node.y1) / 2);
  });

  it('parks an unpublished field between its neighbours, and REST on top of each column', () => {
    // operations & management isn't published at the first destination: it sits between sales and "other"
    const ops = flow.bands.get('operations_management')!;
    expect(ops.top[1]).toBe(ops.bottom[1]);
    const sales = flowLayout.nodes.find((d) => d.id === 's0:sales_marketing')!;
    const other = flowLayout.nodes.find((d) => d.id === 's0:other')!;
    expect(ops.top[1]).toBeGreaterThanOrEqual(sales.y1);
    expect(ops.top[1]).toBeLessThanOrEqual(other.y0);
    const rest = flow.bands.get(REST)!;
    const first = Math.min(...flowLayout.nodes.filter((d) => d.stage === 's0').map((d) => d.y0));
    expect(rest.top[1]).toBe(rest.bottom[1]);
    expect(rest.top[1]).toBeLessThan(first);
    expect([...flow.bands.keys()].pop()).toBe(REST); // painted last, like the stack's top band
  });
});

describe('yearsShape', () => {
  it('opens and closes each run of years with zero-height knots, and gives today four', () => {
    expect(years.knots[0]).toMatchObject({ tau: 0, kind: 'lead' });
    expect(years.knots[1]).toMatchObject({ tau: 0, kind: 'full' });
    const fulls = years.knots.filter((k) => k.kind === 'full' && k.tau !== 'now');
    expect(fulls.map((k) => k.tau)).toEqual(series.rows.filter((r) => r.year !== 'now').map((r) => r.year));
    const now = years.knots.filter((k) => k.tau === 'now');
    expect(now.map((k) => k.kind)).toEqual(['lead', 'full', 'full', 'trail']);
    const last = yearsLayout.points.find((p) => p.year === 'now')!;
    expect(now.map((k) => k.x)).toEqual([last.bar!.x0, last.bar!.x0, last.bar!.x1, last.bar!.x1]);
  });

  it('uses the stacked chart’s own numbers for every edge', () => {
    const { y0, y1 } = yearsLayout.plot;
    const stack = stackRow(series.rows[5], series.groups);
    const fin = stack.find((b) => b.key === 'finance_accounting')!;
    const i = years.knots.findIndex((k) => k.tau === 5 && k.kind === 'full');
    const band = years.bands.get('finance_accounting')!;
    expect(band.top[i]).toBeCloseTo(y1 - fin.y1 * (y1 - y0));
    expect(band.bottom[i]).toBeCloseTo(y1 - fin.y0 * (y1 - y0));
    expect(years.tone.get('finance_accounting')).toBe(1);
  });

  it('treats a missing year as a gap, and a year with no neighbours as a column', () => {
    const gappy = makeSlice({
      n: 100,
      years: [
        { year: 0, n: 100, fields: [['tech', 50]] },
        { year: 1, n: 100, fields: [['tech', 55]] },
        { year: 3, n: 90, fields: [['tech', 60]] },
        { year: 'now', n: 100, fields: [['tech', 70]] },
      ],
    });
    const s = yearSeries(gappy, false);
    const shape = yearsShape(s, layoutYears(s, YEARS));
    expect(shape.knots.map((k) => `${k.tau}:${k.kind}`)).toEqual([
      '0:lead', '0:full', '1:full', '1:trail',
      '3:lead', '3:full', '3:full', '3:trail',
      'now:lead', 'now:full', 'now:full', 'now:trail',
    ]);
  });
});

describe('placeShape', () => {
  it('scales, then shifts into the stage’s coordinates', () => {
    const placed = placeShape(flow, 10, 20, 0.5);
    expect(placed.knots[1].x).toBeCloseTo(10 + flow.knots[1].x * 0.5);
    expect(placed.bands.get('finance_accounting')!.top[1]).toBeCloseTo(20 + flow.bands.get('finance_accounting')!.top[1] * 0.5);
  });
});

describe('alignKnots', () => {
  const { a, b } = alignKnots(flow, years);

  it('pairs both charts knot for knot', () => {
    expect(a.length).toBe(b.length);
    expect(a.length).toBeGreaterThanOrEqual(Math.max(flow.knots.length, years.knots.length));
  });

  it('lines up career time: the Sankey’s year 5 column with the stack’s year 5', () => {
    const tauOf = (shape: ChartShape, s: (typeof a)[number]) => ('i' in s ? shape.knots[s.i].tau : null);
    const col5 = a.map((s, i) => ({ s, i })).filter(({ s }) => tauOf(flow, s) === 5).map(({ i }) => i);
    expect(col5).toHaveLength(4);
    for (const i of col5) expect(tauOf(years, b[i])).toBe(5);
    // years between columns have a point on the Sankey's invisible thread
    const y4 = b.findIndex((s) => tauOf(years, s) === 4);
    expect('i' in a[y4]).toBe(false);
  });

  it('pairs zero-height openers and closers with each other', () => {
    const first = a.findIndex((s) => 'i' in s && flow.knots[s.i].kind === 'lead');
    const bs = b[first];
    expect('i' in bs && years.knots[bs.i].kind).toBe('lead');
    const nowLead = a.findIndex((s) => 'i' in s && flow.knots[s.i].tau === 'now');
    const bn = b[nowLead];
    expect('i' in bn && years.knots[bn.i]).toMatchObject({ tau: 'now', kind: 'lead' });
  });
});

describe('planMorph', () => {
  const plan = planMorph(flow, years);
  const band = (key: string) => plan.bands.find((d) => d.key === key)!;

  it('morphs every field, no role listed and the "not shown" band', () => {
    const keys = plan.bands.map((d) => d.key);
    for (const k of ['finance_accounting', 'sales_marketing', 'no_role_listed', 'smaller_groups', REST]) expect(keys).toContain(k);
    expect(band(REST).hatch).toBe(true);
    expect(band('finance_accounting').color).toBe('var(--sector-2)');
    for (const d of plan.bands) {
      expect(d.xa.length).toBe(plan.knots);
      for (const arr of [d.xb, d.ta, d.ba, d.tb, d.bb, d.tm, d.bm]) expect(arr.length).toBe(plan.knots);
    }
  });

  it('starts exactly on the Sankey bars and ends exactly on the stacked bands', () => {
    const fin = band('finance_accounting');
    const start = bandAt(fin, 0);
    expect(start.x).toEqual(fin.xa);
    expect(start.top).toEqual(fin.ta);
    const end = bandAt(fin, 1);
    expect(end.x).toEqual(fin.xb);
    expect(end.top).toEqual(fin.tb);
    // every knot of the stacked chart is reached, with its edges
    const yb = years.bands.get('finance_accounting')!;
    years.knots.forEach((k, i) => {
      const j = end.x.findIndex((x, n) => x === k.x && end.top[n] === yb.top[i] && end.bottom[n] === yb.bottom[i]);
      expect(j, `knot ${i}`).toBeGreaterThanOrEqual(0);
    });
    // and every bar of the Sankey at the start
    const node = flowLayout.nodes.find((d) => d.id === 'y5:finance_accounting')!;
    expect(start.x.some((x, n) => x === node.x0 && start.top[n] === node.y0 && start.bottom[n] === node.y1)).toBe(true);
  });

  it('passes through lanes: in the middle a field present in every column has no gaps', () => {
    const fin = band('finance_accounting');
    const mid = bandAt(fin, LANES_AT);
    expect(mid.x).toEqual(fin.xa); // lanes form in place
    const firstX = flowLayout.stages[0].x;
    const lastX = flowLayout.stages[flowLayout.stages.length - 1].x + 12;
    mid.x.forEach((x, i) => {
      if (x >= firstX && x <= lastX) expect(mid.bottom[i] - mid.top[i], `x ${x}`).toBeGreaterThan(0);
    });
    // while at the start, between two bars, the band has no height (the flows show there)
    const start = bandAt(fin, 0);
    const between = start.x.findIndex((x) => x > firstX + 20 && x < flowLayout.stages[1].x - 5);
    expect(start.bottom[between] - start.top[between]).toBeCloseTo(0);
  });

  it('never turns a band inside out and keeps the tone of each end', () => {
    for (const d of plan.bands) {
      for (const e of [0, 0.1, 0.25, 0.4, 0.5, 0.75, 0.9, 1]) {
        const f = bandAt(d, e);
        f.top.forEach((t, i) => expect(f.bottom[i]).toBeGreaterThanOrEqual(t));
      }
    }
    expect(band('finance_accounting')).toMatchObject({ oa: 1, ob: years.tone.get('finance_accounting') });
  });

  it('splits a sector into its fields when only one chart is rolled up', () => {
    const sectors = yearSeries(allAlumni, true);
    const toSectors = planMorph(
      sankeyShape(layoutRiver(buildSankeyInput(allAlumni), FLOW)),
      yearsShape(sectors, layoutYears(sectors, YEARS)),
    );
    const keys = toSectors.bands.map((d) => d.key);
    expect(keys).toContain('operations_management');
    expect(keys).not.toContain('sector:management'); // drawn as its fields
    const ops = toSectors.bands.find((d) => d.key === 'operations_management')!;
    expect(ops.ob).toBeGreaterThan(0);
    // ops is the only field of its sector here, so it takes the whole sector band
    const shape = yearsShape(sectors, layoutYears(sectors, YEARS)).bands.get('sector:management')!;
    expect(Math.max(...ops.tb)).toBeCloseTo(Math.max(...shape.top), 5);
  });

  it('splits by thickness when a sector holds several fields', () => {
    const a: ChartShape = {
      knots: [{ tau: 0, x: 0, kind: 'full' }, { tau: 1, x: 10, kind: 'full' }],
      bands: new Map([['finance_accounting', { top: [0, 0], bottom: [30, 30] }], ['consulting', { top: [30, 30], bottom: [40, 40] }]]),
      tone: new Map([['finance_accounting', 1], ['consulting', 1]]),
    };
    const b: ChartShape = {
      knots: [{ tau: 0, x: 0, kind: 'full' }, { tau: 1, x: 10, kind: 'full' }],
      bands: new Map([['sector:finance', { top: [100, 100], bottom: [200, 200] }]]),
      tone: new Map([['sector:finance', 0.8]]),
    };
    const plan2 = planMorph(a, b);
    expect(plan2.bands.map((d) => d.key).sort()).toEqual(['consulting', 'finance_accounting']);
    const fin = plan2.bands.find((d) => d.key === 'finance_accounting')!;
    const con = plan2.bands.find((d) => d.key === 'consulting')!;
    expect(fin.tb).toEqual([100, 100]);
    expect(fin.bb).toEqual([175, 175]); // 30 of 40 → three quarters of the sector band
    expect(con.tb).toEqual([175, 175]);
    expect(con.bb).toEqual([200, 200]);
    expect(fin.ob).toBe(0.8);
  });

  it('fades a band that only one chart has, in place', () => {
    const a: ChartShape = {
      knots: [{ tau: 0, x: 0, kind: 'full' }],
      bands: new Map([['tech', { top: [0], bottom: [10] }]]),
      tone: new Map([['tech', 1]]),
    };
    const b: ChartShape = {
      knots: [{ tau: 0, x: 50, kind: 'full' }],
      bands: new Map([['tech', { top: [0], bottom: [10] }], ['law', { top: [10], bottom: [20] }]]),
      tone: new Map([['tech', 1], ['law', 0.6]]),
    };
    const law = planMorph(a, b).bands.find((d) => d.key === 'law')!;
    expect(law.xa).toEqual(law.xb);
    expect(law.ta).toEqual(law.tb);
    expect([law.oa, law.ob]).toEqual([0, 0.6]);
  });
});

describe('frames', () => {
  it('draws a band as one closed path: top edge out, bottom edge back', () => {
    const d = bandPath([0, 10, 20], [0, 1, 2], [5, 6, 7]);
    expect(d.startsWith('M0,0')).toBe(true);
    expect(d.endsWith('Z')).toBe(true);
    expect(d.match(/C/g)).toHaveLength(4);
    expect(d).toContain('L20,7');
    expect(bandPath([], [], [])).toBe('');
    const plan = planMorph(flow, years);
    for (const e of [0, 0.5, 1]) expect(framePath(plan.bands[0], e)).toMatch(/^M[\d.-]+,[\d.-]+C.*Z$/);
  });

  it('eases in and out, symmetrically', () => {
    expect(easeInOut(0)).toBe(0);
    expect(easeInOut(1)).toBe(1);
    expect(easeInOut(0.5)).toBeCloseTo(0.5);
    expect(easeInOut(0.25)).toBeCloseTo(1 - easeInOut(0.75));
    expect(easeInOut(0.1)).toBeLessThan(0.1);
    expect(easeInOut(-1)).toBe(0);
    expect(ramp(0.5, 0, 1)).toBeCloseTo(0.5);
    expect(ramp(-1, 0, 1)).toBe(0);
    expect(ramp(2, 0, 1)).toBe(1);
    expect(MORPH_MS).toBeGreaterThanOrEqual(600);
    expect(MORPH_MS).toBeLessThanOrEqual(700);
  });

  it('hands off cleanly: only the outgoing chart at the start, only the incoming one at the end', () => {
    expect(morphOpacity(0)).toEqual({ flow: 1, years: 0, overlay: 0 });
    expect(morphOpacity(1)).toEqual({ flow: 0, years: 1, overlay: 0 });
    expect(morphOpacity(0.5)).toEqual({ flow: 0, years: 0, overlay: 1 });
    // symmetric, so a reversal looks like the other direction
    const a = morphOpacity(0.2);
    const b = morphOpacity(0.8);
    expect(a.flow).toBeCloseTo(b.years);
    expect(a.overlay).toBeCloseTo(b.overlay);
  });

  it('morphs the rolled-up default view too', () => {
    const up = rollUpSlice(allAlumni);
    const s = yearSeries(allAlumni, true);
    const plan = planMorph(sankeyShape(layoutRiver(buildSankeyInput(up), FLOW)), yearsShape(s, layoutYears(s, YEARS)));
    expect(plan.bands.map((d) => d.key)).toEqual(expect.arrayContaining(['sector:management', 'sector:engineering', 'further_study', REST]));
  });
});
