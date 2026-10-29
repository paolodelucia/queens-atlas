import { describe, expect, it } from 'vitest';
import { buildSankeyInput } from './model';
import type { SankeyInput } from './model';
import {
  easeOutCubic, interpolateLayout, layoutRiver, layoutYears, linkPath, minChartWidth, nearestPoint, placeLabels, textWidth,
  tooltipSlotX,
} from './layout';
import { chartOptions } from './RiverChart';
import { REST, familyShort, firstAndLast, rollUpSlice, yearSeries } from './model';
import { fmtPct } from '../../lib/format';
import type { LayoutOptions, RNode, YearsLayoutOptions } from './layout';
import { allAlumni, commerce, makeSlice, recent } from './testFixture';
import { yearsOptions } from './YearsChart';

const OPTS: LayoutOptions = {
  width: 1000, height: 500, nodeWidth: 12, nodePadding: 8,
  margin: { top: 50, right: 100, bottom: 10, left: 100 }, labelSpacing: 15, minGap: 130,
};

const finite = (...xs: number[]) => xs.every((x) => Number.isFinite(x));

describe('layoutRiver', () => {
  const layout = layoutRiver(buildSankeyInput(commerce), OPTS, 'commerce');

  it('pins one evenly spaced column per stage', () => {
    expect(layout.stages.map((s) => s.id)).toEqual(['s0', 'y3', 'y5', 'y10', 'now']);
    const xs = layout.stages.map((s) => s.x);
    expect(xs[0]).toBe(100);
    expect(xs[4]).toBe(1000 - 100 - 12);
    expect(xs[2] - xs[1]).toBeCloseTo(xs[1] - xs[0]);
    for (const d of layout.nodes) expect(d.x0).toBe(xs[d.stageIndex]);
  });

  it('sizes nodes from totals and keeps the input order top-to-bottom', () => {
    const s0 = layout.nodes.filter((d) => d.stage === 's0');
    expect(s0.map((d) => d.family)).toEqual(buildSankeyInput(commerce).nodes.filter((d) => d.stage === 's0').map((d) => d.family));
    for (let i = 1; i < s0.length; i++) expect(s0[i].y0).toBeGreaterThan(s0[i - 1].y1);
    const fin = s0.find((d) => d.family === 'finance_accounting')!;
    const sales = s0.find((d) => d.family === 'sales_marketing')!;
    expect((fin.y1 - fin.y0) / (sales.y1 - sales.y0)).toBeCloseTo(410 / 177, 3);
    expect(fin.share).toBeCloseTo(410 / 1060);
    for (const d of layout.nodes) {
      expect(d.y0).toBeGreaterThanOrEqual(50 - 1e-6);
      expect(d.y1).toBeLessThanOrEqual(490 + 1e-6);
    }
  });

  it('draws links from the source node edge to the target node edge, inside both nodes', () => {
    const byId = new Map(layout.nodes.map((d) => [d.id, d]));
    expect(layout.links).toHaveLength(commerce.links.length);
    for (const l of layout.links) {
      const s = byId.get(l.source)!;
      const t = byId.get(l.target)!;
      expect(l.x0).toBe(s.x1);
      expect(l.x1).toBe(t.x0);
      expect(l.y0 - l.width / 2).toBeGreaterThanOrEqual(s.y0 - 1e-6);
      expect(l.y0 + l.width / 2).toBeLessThanOrEqual(s.y1 + 1e-6);
      expect(l.y1 - l.width / 2).toBeGreaterThanOrEqual(t.y0 - 1e-6);
      expect(l.y1 + l.width / 2).toBeLessThanOrEqual(t.y1 + 1e-6);
    }
    // link width uses the same scale as node height
    const ff = layout.links.find((l) => l.id === 's0:finance_accounting>y3:finance_accounting')!;
    const fin = byId.get('s0:finance_accounting')!;
    expect(ff.width / (fin.y1 - fin.y0)).toBeCloseTo(300 / 410, 3);
  });

  it('centres a node’s published flows inside the node', () => {
    const fin = layout.nodes.find((d) => d.id === 's0:finance_accounting')!;
    const out = layout.links.filter((l) => l.source === fin.id);
    const top = Math.min(...out.map((l) => l.y0 - l.width / 2));
    const bottom = Math.max(...out.map((l) => l.y0 + l.width / 2));
    expect(top - fin.y0).toBeCloseTo(fin.y1 - bottom, 5);
  });

  it('lays out nodes that have no links, and slices with no links at all', () => {
    const other = layout.nodes.find((d) => d.id === 's0:other')!;
    expect(finite(other.x0, other.y0, other.y1)).toBe(true);
    const noLinks = layoutRiver(buildSankeyInput(makeSlice({
      totals: { s0: { tech: 50, law: 20 }, y3: { tech: 45 }, y5: { tech: 40 }, y10: { law: 30 }, now: { tech: 20 } }, links: [],
    })), OPTS);
    expect(noLinks.links).toEqual([]);
    expect(new Set(noLinks.nodes.map((d) => d.x0)).size).toBe(5); // still five columns
    for (const d of noLinks.nodes) expect(finite(d.x0, d.x1, d.y0, d.y1)).toBe(true);
  });

  it('handles two-stage slices, a single stage, and no nodes', () => {
    const two = layoutRiver(buildSankeyInput(recent), OPTS);
    expect(two.stages.map((s) => s.id)).toEqual(['s0', 'now']);
    expect(two.nodes.every((d) => d.labelSide === (d.stage === 's0' ? 'left' : 'right'))).toBe(true);
    const one = layoutRiver(buildSankeyInput(makeSlice({ stages: ['now'], totals: { now: { tech: 30, law: 20 } } })), OPTS);
    expect(one.nodes).toHaveLength(2);
    for (const d of one.nodes) expect(finite(d.x0, d.x1, d.y0, d.y1)).toBe(true);
    const none: SankeyInput = { n: 0, stages: [], nodes: [], links: [] };
    expect(layoutRiver(none, OPTS)).toMatchObject({ nodes: [], links: [], stages: [] });
  });

  it('sorts links big-first so thin ones paint on top', () => {
    const widths = layout.links.map((l) => l.width);
    expect([...widths].sort((a, b) => b - a)).toEqual(widths);
  });
});

describe('placeLabels', () => {
  const node = (id: string, value: number, y0: number, y1: number): RNode => ({
    id, family: 'tech', stage: 's0', stageIndex: 0, value, share: 0, x0: 0, x1: 10, y0, y1,
    labelSide: 'left', showLabel: false, opacity: 1, labelOpacity: 0,
  });

  it('keeps the biggest node’s label and hides crowded thin ones', () => {
    const nodes = [node('a', 100, 0, 100), node('b', 5, 104, 106), node('c', 4, 110, 111), node('d', 50, 130, 180)];
    placeLabels(nodes, 15);
    expect(nodes.map((d) => d.showLabel)).toEqual([true, true, false, true]);
    expect(nodes.map((d) => d.labelOpacity)).toEqual([1, 1, 0, 1]);
  });

  it('treats each column separately', () => {
    const a = node('a', 10, 0, 2);
    const b = { ...node('b', 10, 0, 2), stageIndex: 1 };
    placeLabels([a, b], 15);
    expect([a.showLabel, b.showLabel]).toEqual([true, true]);
  });
});

describe('interpolateLayout', () => {
  const a = layoutRiver(buildSankeyInput(commerce), OPTS, 'a');
  const b = layoutRiver(buildSankeyInput(recent), OPTS, 'b');

  it('starts at the old geometry and ends at the new layout', () => {
    expect(interpolateLayout(a, b, 1)).toBe(b);
    const f0 = interpolateLayout(a, b, 0);
    const shared = b.nodes.find((d) => a.nodes.some((x) => x.id === d.id))!;
    const was = a.nodes.find((d) => d.id === shared.id)!;
    const now = f0.nodes.find((d) => d.id === shared.id)!;
    expect([now.y0, now.y1]).toEqual([was.y0, was.y1]);
  });

  it('fades entering elements in and keeps exiting ones until the end', () => {
    const f0 = interpolateLayout(a, b, 0);
    const half = interpolateLayout(a, b, 0.5);
    const entering = b.nodes.find((d) => !a.nodes.some((x) => x.id === d.id))!;
    expect(f0.nodes.find((d) => d.id === entering.id)!.opacity).toBe(0);
    expect(half.nodes.find((d) => d.id === entering.id)!.opacity).toBeCloseTo(0.5);
    const exiting = a.nodes.find((d) => d.stage === 'y5')!;
    expect(half.nodes.find((d) => d.id === exiting.id)!.opacity).toBeCloseTo(0.5);
    expect(half.stages.map((s) => s.id).sort()).toEqual(['now', 's0', 'y10', 'y3', 'y5']);
    const goneLink = a.links.find((l) => l.fromStage === 'y5')!;
    expect(half.links.find((l) => l.id === goneLink.id)!.width).toBeCloseTo(goneLink.width / 2);
  });

  it('eases', () => {
    expect(easeOutCubic(0)).toBe(0);
    expect(easeOutCubic(1)).toBe(1);
    expect(easeOutCubic(0.5)).toBeGreaterThan(0.5);
    expect(easeOutCubic(2)).toBe(1);
  });
});

describe('helpers', () => {
  it('linkPath draws the sankey horizontal curve', () => {
    expect(linkPath({ x0: 0, y0: 10, x1: 100, y1: 50 })).toBe('M0,10C50,10 50,50 100,50');
  });

  it('minChartWidth reserves margins plus a minimum gap per column', () => {
    expect(minChartWidth(4, OPTS)).toBe(100 + 100 + 12 + 3 * 130);
    expect(minChartWidth(1, OPTS)).toBe(212);
  });

  it('tooltipSlotX parks node tooltips clear of the highlighted columns and their labels', () => {
    const layout = layoutRiver(buildSankeyInput(commerce), { ...OPTS, width: 1400 }, 'x');
    const xs = layout.stages.map((s) => s.x);
    // column 0 lights up columns 0-1: go right of column 1 and its labels
    expect(tooltipSlotX(layout, 0, 200, 90)).toBe(xs[1] + 12 + 90 + 10);
    // column 2 lights up columns 1-3: right of column 3 and its labels
    expect(tooltipSlotX(layout, 2, 200, 90)).toBe(xs[3] + 12 + 90 + 10);
    // column 3 lights up columns 2-4, no room right: go left of column 2
    expect(tooltipSlotX(layout, 3, 200, 90)).toBe(xs[2] - 10 - 200);
    // column 1 lights up columns 0-2: right of column 2 if it fits
    expect(tooltipSlotX(layout, 1, 200, 90)).toBe(xs[2] + 12 + 90 + 10);
    // no room anywhere -> null
    expect(tooltipSlotX(layout, 1, 600, 90)).toBeNull();
    // a two-column chart is all highlight
    expect(tooltipSlotX(layoutRiver(buildSankeyInput(recent), OPTS), 0, 100, 90)).toBeNull();
  });
});

describe('label margins', () => {
  it('estimates text width monotonically and in a plausible range', () => {
    expect(textWidth('', 12)).toBe(0);
    expect(textWidth('Engineering', 12)).toBeGreaterThan(55);
    expect(textWidth('Engineering', 12)).toBeLessThan(80);
    expect(textWidth('Engineering', 11)).toBeLessThan(textWidth('Engineering', 12));
    expect(textWidth('Mm', 12)).toBeGreaterThan(textWidth('il', 12));
  });

  it('leaves room for every first- and last-column label, so none is clipped (e.g. “Engineering” on a phone)', () => {
    const slice = makeSlice({
      n: 1000, stages: ['s0', 'now'],
      totals: { s0: { engineering: 140, smaller_groups: 30, tech: 20 }, now: { engineering: 100, no_role_listed: 90 } },
    });
    for (const width of [317, 560, 1100]) {
      const input = buildSankeyInput(slice);
      const o = chartOptions(width, input);
      const layout = layoutRiver(input, { ...o, width: Math.max(width, minChartWidth(2, o)) });
      expect(Math.max(width, minChartWidth(2, o))).toBe(width); // two columns fit without scrolling
      for (const d of layout.nodes) {
        const label = textWidth(familyShort(d.family), o.fontSize) + 4 + textWidth(fmtPct(d.value, input.n), o.fontSize);
        if (d.labelSide === 'left') expect(d.x0 - 7 - label).toBeGreaterThanOrEqual(0);
        else expect(d.x1 + 7 + label).toBeLessThanOrEqual(layout.width);
      }
    }
  });

  it('fits the grouped default view’s two phone columns in 317px', () => {
    const input = firstAndLast(buildSankeyInput(rollUpSlice(commerce)));
    const o = chartOptions(317, input);
    expect(minChartWidth(input.stages.length, o)).toBeLessThanOrEqual(317);
    expect(o.fontSize).toBe(11);
  });
});

describe('layoutYears (year by year)', () => {
  const YOPTS: YearsLayoutOptions = {
    width: 800, height: 380, margin: { top: 30, right: 4, bottom: 62, left: 42 }, todayGap: 22, barWidth: 30, fontSize: 12,
  };
  const series = yearSeries(commerce, false);
  const layout = layoutYears(series, YOPTS);

  it('spaces years evenly by year and sets today apart as its own column', () => {
    expect(layout.points.map((p) => p.year)).toEqual(series.rows.map((r) => r.year));
    const xs = layout.points.filter((p) => p.year !== 'now').map((p) => p.x);
    expect(xs[0]).toBe(42);
    for (let i = 2; i < xs.length; i++) expect(xs[i] - xs[i - 1]).toBeCloseTo(xs[1] - xs[0]);
    const now = layout.points[layout.points.length - 1];
    expect(now.bar).not.toBeNull();
    expect(now.bar!.x1).toBeCloseTo(800 - 4);
    expect(now.bar!.x0 - xs[xs.length - 1]).toBeCloseTo(22); // the gap: today isn't joined to the last year
    for (const p of layout.points.slice(0, -1)) expect(p.bar).toBeNull();
  });

  it('draws one path per band, bottom of the stack first, with the rest on top', () => {
    expect(layout.shapes.map((s) => s.key)).toEqual([...[...series.groups].reverse(), REST]);
    for (const s of layout.shapes) {
      // one area for the run of years, one rectangle for today
      expect(s.d.match(/Z/g)).toHaveLength(2);
      const nums = s.d.match(/-?\d+(\.\d+)?/g)!.map(Number);
      expect(nums.every(Number.isFinite)).toBe(true);
    }
    const ys = layout.shapes.flatMap((s) => [...s.d.matchAll(/[ ,](-?\d+(?:\.\d+)?)(?=[CHLVZ ]|$)/g)].map((m) => Number(m[1])));
    expect(Math.min(...ys)).toBeGreaterThanOrEqual(0);
  });

  it('leaves a gap for a missing year instead of bridging it', () => {
    const gappy = layoutYears(yearSeries(makeSlice({
      n: 100,
      years: [
        { year: 0, n: 100, fields: [['tech', 50]] },
        { year: 1, n: 100, fields: [['tech', 55]] },
        { year: 3, n: 90, fields: [['tech', 60]] },
        { year: 'now', n: 100, fields: [['tech', 70]] },
      ],
    }), false), YOPTS);
    const [y0, y1, y3, now] = gappy.points;
    expect(y3.x - y1.x).toBeCloseTo(2 * (y1.x - y0.x)); // year 2's slot stays empty
    expect(y3.bar).not.toBeNull(); // a year with no neighbours is drawn as a column
    expect(now.bar).not.toBeNull();
    const tech = gappy.shapes.find((s) => s.key === 'tech')!;
    expect(tech.d.match(/Z/g)).toHaveLength(3); // area for 0–1, column for 3, column for today
  });

  it('puts labels inside their bands, inside the plot, never overlapping', () => {
    expect(layout.labels.length).toBeGreaterThan(0);
    expect(layout.labels.map((l) => l.text)).toContain('Finance');
    for (const l of layout.labels) {
      expect(l.x).toBeGreaterThanOrEqual(layout.plot.x0);
      expect(l.x).toBeLessThanOrEqual(layout.plot.x1);
      expect(l.y).toBeGreaterThan(layout.plot.y0);
      expect(l.y).toBeLessThan(layout.plot.y1);
    }
    const boxes = layout.labels.map((l) => ({ x0: l.x - textWidth(l.text, 12) / 2, x1: l.x + textWidth(l.text, 12) / 2, y0: l.y - 8, y1: l.y + 8 }));
    for (let i = 0; i < boxes.length; i++) {
      for (let j = i + 1; j < boxes.length; j++) {
        const a = boxes[i];
        const b = boxes[j];
        expect(a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1).toBe(false);
      }
    }
  });

  it('labels the axis sparingly: first, every fifth year, today', () => {
    const labelled = layout.xTicks.filter((t) => t.label).map((t) => t.label);
    expect(labelled[0]).toBe('First');
    expect(labelled).toContain('5');
    expect(labelled).toContain('10');
    expect(labelled[labelled.length - 1]).toBe('Today');
    expect(layout.xTicks).toHaveLength(layout.points.length);
    // nothing crowds "Today"
    const today = layout.xTicks[layout.xTicks.length - 1];
    for (const t of layout.xTicks.slice(0, -1)) if (t.label) expect(today.x - t.x).toBeGreaterThanOrEqual(30);
    expect(layout.yTicks.map((t) => t.label)).toEqual(['0%', '25%', '50%', '75%', '100%']);
  });

  it('marks where later years cover only the earlier classes', () => {
    expect(layout.partial).toMatchObject({ year: 12, x: layout.points[12].x, x1: layout.points[13].x });
    expect(layoutYears(yearSeries(allAlumni, false), YOPTS).partial).toBeNull();
  });

  it('snaps the scrubber to the nearest point, and anywhere on the today column to today', () => {
    const p5 = layout.points[5];
    expect(nearestPoint(layout, p5.x + 3)).toBe(5);
    const now = layout.points[layout.points.length - 1];
    expect(nearestPoint(layout, now.bar!.x0 + 2)).toBe(now.index);
    expect(nearestPoint(layout, -50)).toBe(0);
    expect(nearestPoint(layout, 5000)).toBe(now.index);
  });

  it('copes with a single point and with no points', () => {
    const one = layoutYears(yearSeries(makeSlice({ years: [{ year: 'now', n: 50, fields: [['tech', 20]] }] }), false), YOPTS);
    expect(one.points).toHaveLength(1);
    expect(one.points[0].bar).not.toBeNull();
    const none = layoutYears(yearSeries(makeSlice({ years: [] }), false), YOPTS);
    expect(none.points).toEqual([]);
    expect(none.shapes).toEqual([]);
  });

  it('sizes itself for phones and desktops', () => {
    expect(yearsOptions(343).height).toBeLessThan(yearsOptions(900).height);
    expect(yearsOptions(343).fontSize).toBe(11);
    const phone = layoutYears(series, { ...yearsOptions(343), width: 343 });
    const today = phone.xTicks[phone.xTicks.length - 1];
    for (const t of phone.xTicks.slice(0, -1)) if (t.label) expect(today.x - t.x).toBeGreaterThanOrEqual(30);
  });
});
