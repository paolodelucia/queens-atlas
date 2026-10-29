import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Loadable } from '../../data/load';
import type { DiasporaFile } from '../../data/types';
import { RouterProvider } from '../../lib/router';
import { SITE } from '../../site.config';
import { fmtInt } from '../../lib/format';
import { makeFrame, project, regionTransform, shareText } from './model';
import { PLACES_PHONE, PLACES_WIDE } from './Panels';
import { METROS, makeFile } from './testFixture';

vi.mock('../../data/load', () => ({ useData: vi.fn() }));
vi.mock('./land', () => ({
  loadLand: vi.fn(() => Promise.resolve({
    land: { type: 'FeatureCollection', features: [] },
    borders: { type: 'MultiLineString', coordinates: [] },
  })),
}));

const { useData } = await import('../../data/load');
const { default: DiasporaView } = await import('./DiasporaView');
const mockedUseData = vi.mocked(useData);

/** diaspora.json's state, and meta.json's (loading unless given: the view then uses the default floors). */
function setData(state: Loadable<DiasporaFile>, meta: Loadable<unknown> = { status: 'loading' }) {
  mockedUseData.mockImplementation(((key: string) => (key === 'meta' ? meta : state)) as unknown as typeof useData);
}

function renderAt(search = '') {
  window.history.replaceState(null, '', `/diaspora${search}`);
  return render(<RouterProvider><DiasporaView /></RouterProvider>);
}

const params = () => new URLSearchParams(window.location.search);
const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 40)); });

/** The map's current transform, read from the land layer. */
function mapTransform(container: HTMLElement) {
  const g = container.querySelector('.dsp-land-layer')!;
  const m = /translate\(([-\d.e]+),([-\d.e]+)\) scale\(([-\d.e]+)\)/.exec(g.getAttribute('transform') ?? '')!;
  return { x: Number(m[1]), y: Number(m[2]), k: Number(m[3]) };
}

const regionChip = (name: RegExp) => within(screen.getByRole('group', { name: 'Zoom to region' })).getByRole('button', { name });

/** A phone-width viewport: every max-width query matches (the list-first layout, short labels). */
function phone() {
  vi.stubGlobal('matchMedia', (q: string) => ({
    matches: q.includes('max-width'), media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {},
  }));
}

/** Reduced motion: zooms apply at once instead of animating (d3 transitions don't run in jsdom). */
function reduceMotion() {
  vi.stubGlobal('matchMedia', (q: string) => ({
    matches: q.includes('reduce'), media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {},
  }));
}

/** A ResizeObserver the test drives by hand. */
class FakeResizeObserver {
  static all: FakeResizeObserver[] = [];
  constructor(public cb: ResizeObserverCallback) { FakeResizeObserver.all.push(this); }
  observe() {}
  unobserve() {}
  disconnect() {}
}
async function resizeTo(width: number) {
  await act(async () => {
    for (const o of FakeResizeObserver.all) o.cb([{ contentRect: { width } } as ResizeObserverEntry], o as unknown as ResizeObserver);
  });
  await settle();
}

beforeEach(() => {
  setData({ status: 'ready', data: makeFile() });
});
afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
  FakeResizeObserver.all = [];
});

describe('DiasporaView', () => {
  it('shows a loading state under the tool-page header', () => {
    setData({ status: 'loading' });
    renderAt();
    expect(screen.getByRole('status')).toHaveTextContent('Loading the map…');
    expect(screen.getByRole('heading', { level: 1, name: 'Where do Queen’s alumni live now?' })).toBeInTheDocument();
    expect(screen.getByText('The Diaspora')).toBeInTheDocument();
  });

  it('shows an error with a working retry', () => {
    const retry = vi.fn();
    setData({ status: 'error', error: new Error('Could not load diaspora data (500)'), retry });
    renderAt();
    expect(screen.getByRole('alert')).toHaveTextContent('Could not load diaspora data (500)');
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(retry).toHaveBeenCalledTimes(1);
  });

  it('renders the map with one bubble per known metro, the summary and the headline stats', async () => {
    const { container } = renderAt();
    await act(async () => {});
    // 11 metros in the all-alumni view resolve; the unknown "atlantis" id is skipped.
    expect(container.querySelectorAll('circle.dsp-bubble')).toHaveLength(11);
    expect(screen.getAllByRole('button', { name: /^Toronto, Ontario, Canada: 30,120 people/ })).toHaveLength(1);
    const stats = screen.getByLabelText(/Headline numbers/);
    expect(within(stats).getByText('92,830')).toBeInTheDocument();
    expect(within(stats).getByText('13%')).toBeInTheDocument(); // 12,259 / 92,830 from the published abroad row
    expect(within(stats).getByText('New York')).toBeInTheDocument();
    expect(container.querySelector('.dsp-summary__text')).toHaveTextContent('87% of alumni live in Canada, 32% in Toronto alone.');
  });

  it('uses whole-number shares and the shared privacy line, with no absolute claims', async () => {
    const { container } = renderAt();
    await act(async () => {});
    const text = container.textContent ?? '';
    expect(text).toContain(SITE.privacyLine);
    expect(text).toMatch(/Places with fewer than 10 people aren’t shown/);
    expect(text).not.toMatch(/singled out|at least 10 people|\d\.\d%/);
  });

  it('applies a program filter from the URL', async () => {
    const { container } = renderAt('?level=undergrad&program=Computer+Science');
    await act(async () => {});
    expect(container.querySelectorAll('circle.dsp-bubble')).toHaveLength(4);
    expect(screen.getByRole('combobox', { name: 'Program' })).toHaveValue('Computer Science');
    expect(screen.getByRole('heading', { name: 'Where Computer Science alumni (Undergrad) live' })).toBeInTheDocument();
    expect(screen.queryByText(/Too few people/)).not.toBeInTheDocument();
  });

  it('explains a missing combination, still draws a map, and offers one-click alternatives', async () => {
    const { container } = renderAt('?level=undergrad&program=Computer+Science&cohort=pre-1995');
    await act(async () => {});
    expect(screen.getByText(/Too few people to map Computer Science \(Undergrad\), classes before 1995/)).toBeInTheDocument();
    // Falls back to the program's all-classes view rather than an empty map.
    expect(container.querySelectorAll('circle.dsp-bubble')).toHaveLength(4);
    // Classes without a map are disabled in the Class control.
    expect(screen.getByRole('radio', { name: 'Classes of 2005–2009' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Computer Science (Undergrad), all classes' }));
    expect(params().get('cohort')).toBeNull();
    expect(params().get('program')).toBe('Computer Science');
    expect(screen.queryByText(/Too few people/)).not.toBeInTheDocument();
    // The chip removed itself: focus lands on the summary above the map, not <body>.
    expect(document.activeElement).toBe(container.querySelector('.dsp-summary'));
  });

  it('Clear filters hands focus to the Degree "All" option', async () => {
    renderAt('?level=undergrad&cohort=2020-2024');
    await act(async () => {});
    fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }));
    expect(params().toString()).toBe('');
    expect(screen.queryByRole('button', { name: 'Clear filters' })).not.toBeInTheDocument();
    expect(document.activeElement).toBe(screen.getByRole('radio', { name: 'All alumni' }));
  });

  it('explains an empty map when nobody reaches 10 in any one city', async () => {
    const { container } = renderAt('?level=graduate&program=Art+Conservation');
    await act(async () => {});
    expect(container.querySelectorAll('circle.dsp-bubble')).toHaveLength(0);
    expect(screen.getByRole('note')).toHaveTextContent('No single city has 10 or more Art Conservation alumni (Master’s/PhD)');
    expect(screen.getByText(/No country outside Canada has 10 or more of them/)).toBeInTheDocument();
  });

  it('ignores unknown URL values instead of breaking', async () => {
    const { container } = renderAt('?level=bogus&program=Nope&cohort=1066&metro=atlantis&moves=maybe');
    await act(async () => {});
    expect(screen.queryByText(/Too few people/)).not.toBeInTheDocument();
    expect(container.querySelectorAll('circle.dsp-bubble')).toHaveLength(11);
    expect(screen.getByRole('heading', { name: 'Where alumni live' })).toBeInTheDocument();
  });

  it('changing degree resets a program that level does not have', async () => {
    renderAt('?level=graduate&program=Art+Conservation');
    await act(async () => {});
    fireEvent.click(screen.getByRole('radio', { name: 'Undergrad' }));
    expect(params().get('level')).toBe('undergrad');
    expect(params().get('program')).toBeNull();
  });

  it('names the degrees in full where the name can contain the visible label, with a disabled picker until one is chosen', async () => {
    renderAt();
    await act(async () => {});
    const degree = screen.getByRole('group', { name: 'Degree' });
    expect(within(degree).getAllByRole('radio').map((r) => r.getAttribute('aria-label')))
      .toEqual(['All alumni', 'Undergrad', 'Master’s/PhD', 'MBA', 'JD (law)', 'MD (medicine)']);
    // "Undergraduate" doesn't contain "Undergrad" as a word, so it is read as the description (WCAG 2.5.3)
    expect(within(degree).getByRole('radio', { name: 'Undergrad' })).toHaveAccessibleDescription('Undergraduate');
    expect(within(degree).getByText('MD').closest('label')).toHaveAttribute('title', 'Medicine (MD)');
    expect(screen.getByRole('combobox', { name: 'Program' })).toBeDisabled();
  });

  it('selects a metro from the keyboard, shows its detail, and Escape clears it', async () => {
    renderAt();
    await act(async () => {});
    const toronto = screen.getByRole('button', { name: /^Toronto, Ontario, Canada/ });
    fireEvent.keyDown(toronto, { key: 'Enter' });
    expect(params().get('metro')).toBe('toronto');
    const panel = screen.getByRole('complementary', { name: 'Details for Toronto' });
    expect(within(panel).getByRole('heading', { name: 'Toronto' })).toBeInTheDocument();
    expect(within(panel).getByText('Finance & accounting')).toBeInTheDocument();
    expect(within(panel).getByText('RBC')).toBeInTheDocument();
    expect(within(panel).getByText('Commerce')).toBeInTheDocument();
    expect(toronto).toHaveAttribute('aria-pressed', 'true');

    fireEvent.keyDown(toronto, { key: 'Escape' });
    expect(params().get('metro')).toBeNull();
    expect(screen.getByRole('complementary', { name: 'Places' })).toBeInTheDocument();
  });

  it('gives the bubbles one Tab stop; arrow keys move between them, largest first', async () => {
    const { container } = renderAt();
    await act(async () => {});
    const stops = [...container.querySelectorAll('circle.dsp-bubble')].filter((c) => c.getAttribute('tabindex') === '0');
    expect(stops.map((c) => (c as SVGElement).dataset.metro)).toEqual(['toronto']);
    const toronto = stops[0] as SVGCircleElement;
    act(() => toronto.focus());
    fireEvent.keyDown(toronto, { key: 'ArrowRight' });
    const kingston = container.querySelector<SVGCircleElement>('circle[data-metro="kingston"]')!;
    expect(document.activeElement).toBe(kingston);
    expect(kingston).toHaveAttribute('tabindex', '0');
    expect(toronto).toHaveAttribute('tabindex', '-1');
    fireEvent.keyDown(kingston, { key: 'End' });
    expect((document.activeElement as SVGElement).dataset.metro).toBe('nodetail');
    fireEvent.keyDown(document.activeElement!, { key: 'Home' });
    expect(document.activeElement).toBe(toronto);
  });

  it('handles metros with an empty or missing profile', async () => {
    renderAt('?metro=nodetail');
    await act(async () => {});
    const panel = screen.getByRole('complementary', { name: 'Details for Long Sault' });
    expect(within(panel).getByText(/No group here reaches 10 people/)).toBeInTheDocument();
    fireEvent.click(within(panel).getByRole('button', { name: 'Close details for Long Sault' }));
    expect(params().get('metro')).toBeNull();
  });

  it('closing the detail returns focus to its bubble', async () => {
    const { container } = renderAt('?metro=ottawa');
    await act(async () => {});
    fireEvent.click(screen.getByRole('button', { name: 'Close details for Ottawa' }));
    expect(document.activeElement).toBe(container.querySelector('circle[data-metro="ottawa"]'));
  });

  it('closing the detail of a place not on the map returns focus to the Top places heading', async () => {
    renderAt('?level=undergrad&program=Computer+Science&metro=new-york');
    await act(async () => {});
    fireEvent.click(screen.getByRole('button', { name: 'Close details for New York' }));
    expect(document.activeElement).toBe(screen.getByRole('heading', { name: 'Where Computer Science alumni (Undergrad) live' }));
  });

  it('selecting from the top-places list opens the detail panel; Escape inside it closes', async () => {
    renderAt();
    await act(async () => {});
    const list = screen.getByRole('complementary', { name: 'Places' });
    fireEvent.click(within(list).getByRole('button', { name: /Kingston/ }));
    const panel = screen.getByRole('complementary', { name: 'Details for Kingston' });
    // Kingston's profile is empty in the fixture, but its moves are listed.
    expect(within(panel).getByText(/No group here reaches 10 people/)).toBeInTheDocument();
    expect(within(panel).getByRole('button', { name: '→ Toronto' })).toBeInTheDocument();
    fireEvent.keyDown(within(panel).getByRole('button', { name: /Close details/ }), { key: 'Escape' });
    expect(params().get('metro')).toBeNull();
  });

  it('a Moves link in the detail panel keeps focus in the panel', async () => {
    renderAt('?metro=kingston');
    await act(async () => {});
    const panel = screen.getByRole('complementary', { name: 'Details for Kingston' });
    fireEvent.click(within(panel).getByRole('button', { name: '→ Toronto' }));
    expect(params().get('metro')).toBe('toronto');
    expect(document.activeElement).toBe(screen.getByRole('heading', { level: 2, name: 'Toronto' }));
  });

  it('lists places in Canada and abroad, ranked, then opens the table for the rest', async () => {
    renderAt();
    await act(async () => {});
    const list = screen.getByRole('complementary', { name: 'Places' });
    const canada = within(list).getByRole('list', { name: /^In Canada/ });
    const abroad = within(list).getByRole('list', { name: /^Abroad/ });
    // Base names (the list qualifies same-named places: "London, UK").
    const names = (ol: HTMLElement) => within(ol).getAllByRole('button').map((b) => b.querySelector('.dsp-rank__name')!.firstChild!.textContent!.split(',')[0]);
    const file = makeFile();
    const view = file.views.find((v) => v.level === 'all' && v.program === 'all' && v.cohort === 'all')!;
    const known = view.metros.map(([id, n]) => ({ m: METROS.find((x) => x.id === id), n })).filter((r) => r.m);
    const ca = known.filter((r) => r.m!.country === 'CA').sort((a, b) => b.n - a.n).slice(0, PLACES_WIDE).map((r) => r.m!.name);
    const ab = known.filter((r) => r.m!.country !== 'CA').sort((a, b) => b.n - a.n).slice(0, PLACES_WIDE).map((r) => r.m!.name);
    expect(names(canada)).toEqual(ca);
    expect(names(abroad)).toEqual(ab);
    // The line beside a place: province or country, unless the shown name already says it.
    expect(within(canada).getByRole('button', { name: /Toronto/ })).toHaveTextContent('Ontario');
    expect(within(abroad).getByRole('button', { name: /New York/ })).toHaveTextContent('United States');
    expect(within(abroad).getByRole('button', { name: /London, UK/ })).not.toHaveTextContent('United Kingdom');
    // Headings carry each side's share: Canada from the published CA count, abroad from the published row.
    const caCount = view.countries.find(([c]) => c === 'CA')![1];
    expect(within(list).getByRole('heading', { name: /^In Canada/ })).toHaveTextContent(`In Canada · ${shareText(caCount, view.n)}`);
    const row = file.abroad.byCohort.find((r) => r.cohort === 'all')!;
    expect(within(list).getByRole('heading', { name: /^Abroad/ })).toHaveTextContent(`Abroad · ${shareText(row.abroad, row.n)}`);
    // Single-series bars.
    expect((list.querySelector('.dsp-bar__fill') as HTMLElement).style.background).toBe('var(--data-mono)');
    fireEvent.click(within(list).getByRole('button', { name: `All ${known.length} places` }));
    const tables = screen.getByRole('region', { name: 'Tables' });
    expect(within(tables).getAllByRole('row')).toHaveLength(known.length + 1);
    expect(document.activeElement).toBe(tables);
  });

  describe('the Kingston card', () => {
    const k = makeFile().kingston;
    const card = () => screen.getByRole('region', { name: 'You got your first job in Kingston. Then what?' });

    it('opens the page, above the filters, with the stayed share from the two published counts', async () => {
      renderAt();
      await act(async () => {});
      const c = card();
      expect(c.compareDocumentPosition(screen.getByRole('region', { name: 'Filters' })) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      const pct = shareText(k.stillInKingston, k.firstJobInKingston);
      expect(within(c).getByText(pct)).toHaveClass('ui-hl');
      expect(c).toHaveTextContent(`${pct} still live in Kingston`);
      expect(c).toHaveTextContent(`${fmtInt(k.stillInKingston!)} of the ${fmtInt(k.firstJobInKingston!)} alumni whose first job was there.`);
      const top = [...k.nowElsewhere].sort((a, b) => b.n - a.n)[0];
      expect(c).toHaveTextContent(`The most common move: ${top.name}, ${fmtInt(top.n)} people (${shareText(top.n, k.firstJobInKingston)}).`);
    });

    it('draws one labelled ribbon per published outcome, widths proportional to people', async () => {
      const { container } = renderAt();
      await act(async () => {});
      const bands = [...container.querySelectorAll<SVGPathElement>('.dsp-kflow__band')];
      // Stayed + each destination + the unlisted rest.
      expect(bands).toHaveLength(1 + k.nowElsewhere.length + 1);
      expect(bands.filter((b) => b.classList.contains('is-rest'))).toHaveLength(1);
      const labels = [...container.querySelectorAll('.dsp-kflow__label')].map((t) => t.textContent);
      const sorted = [...k.nowElsewhere].sort((a, b) => b.n - a.n);
      expect(labels).toEqual([
        `Still in Kingston${fmtInt(k.stillInKingston!)}`,
        ...sorted.map((r) => `${r.name}${fmtInt(r.n)}`),
        'Other places',
      ]);
      // The same numbers for screen readers (the SVG is hidden from them).
      const figure = container.querySelector('figure.dsp-kflow')!;
      expect(within(figure as HTMLElement).getByText(`Still in Kingston: ${fmtInt(k.stillInKingston!)} people, ${shareText(k.stillInKingston, k.firstJobInKingston)}`)).toBeInTheDocument();
    });

    it('shows the "401" sticker only when the moves data backs it', async () => {
      renderAt();
      await act(async () => {});
      expect(within(card()).getByText('the 401 runs mostly one way')).toHaveClass('ui-sticker');
      cleanup();
      const f = makeFile();
      setData({ status: 'ready', data: { ...f, flows: f.flows.map((x) => (x.from === 'toronto' && x.to === 'kingston' ? { ...x, n: 600 } : x)) } });
      renderAt();
      await act(async () => {});
      expect(within(card()).queryByText('the 401 runs mostly one way')).not.toBeInTheDocument();
    });

    it('without a published total, shows no percentage and no remainder', async () => {
      setData({ status: 'ready', data: { ...makeFile(), kingston: { ...k, firstJobInKingston: null } } });
      const { container } = renderAt();
      await act(async () => {});
      expect(card()).not.toHaveTextContent('%');
      expect(card().querySelector('.ui-stat')).toBeNull();
      expect(container.querySelector('.dsp-kflow__band.is-rest')).toBeNull();
      expect(container.querySelectorAll('.dsp-kflow__band.is-stay')).toHaveLength(1);
    });

    it('without a published stayer count, leads with the total and draws no stayed ribbon', async () => {
      setData({ status: 'ready', data: { ...makeFile(), kingston: { ...k, stillInKingston: null } } });
      const { container } = renderAt();
      await act(async () => {});
      expect(card()).not.toHaveTextContent('still live in Kingston');
      expect(card()).toHaveTextContent(`${fmtInt(k.firstJobInKingston!)} alumni had their first job in Kingston`);
      expect(container.querySelector('.dsp-kflow__band.is-stay')).toBeNull();
    });

    it('is left out when there is nothing to tell', async () => {
      setData({ status: 'ready', data: { ...makeFile(), kingston: { firstJobInKingston: null, stillInKingston: null, nowElsewhere: [] } } });
      renderAt();
      await act(async () => {});
      expect(screen.queryByRole('region', { name: /first job in Kingston/ })).not.toBeInTheDocument();
      expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument();
    });

    it('its button turns on moves, selects Kingston and frames Ontario & Québec', async () => {
      reduceMotion();
      renderAt();
      await settle();
      fireEvent.click(within(card()).getByRole('button', { name: 'Show Kingston’s moves on the map' }));
      await settle();
      expect(params().get('moves')).toBe('1');
      expect(params().get('metro')).toBe('kingston');
      expect(screen.getByRole('complementary', { name: 'Details for Kingston' })).toBeInTheDocument();
      expect(regionChip(/^Ontario & Québec/)).toHaveAttribute('aria-pressed', 'true');
    });
  });

  describe('on phones (list-first)', () => {
    beforeEach(() => phone());

    it('puts the Canada and Abroad lists before the map, with more rows', async () => {
      const { container } = renderAt();
      await act(async () => {});
      const list = screen.getByRole('complementary', { name: 'Places' });
      const map = container.querySelector('svg.dsp-svg')!;
      expect(list.compareDocumentPosition(map) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      expect(screen.getByRole('region', { name: 'Places and map' })).toBeInTheDocument();
      const canada = within(list).getByRole('list', { name: /^In Canada/ });
      const caCount = METROS.filter((m) => m.country === 'CA' && makeFile().views[0].metros.some(([id]) => id === m.id)).length;
      expect(within(canada).getAllByRole('listitem')).toHaveLength(Math.min(PLACES_PHONE, caCount));
      // The map and its controls are still there, below.
      expect(container.querySelectorAll('circle.dsp-bubble').length).toBeGreaterThan(0);
      expect(screen.getByRole('switch', { name: 'Moves' })).toBeInTheDocument();
    });

    it('tapping a place opens its detail in place; closing goes back to the list', async () => {
      renderAt();
      await act(async () => {});
      const list = screen.getByRole('complementary', { name: 'Places' });
      fireEvent.click(within(list).getByRole('button', { name: /Ottawa/ }));
      const panel = screen.getByRole('complementary', { name: 'Details for Ottawa' });
      expect(document.activeElement).toBe(within(panel).getByRole('heading', { level: 2, name: 'Ottawa' }));
      fireEvent.click(within(panel).getByRole('button', { name: 'Close details for Ottawa' }));
      expect(params().get('metro')).toBeNull();
      expect(document.activeElement).toBe(screen.getByRole('heading', { name: 'Where alumni live' }));
    });

    it('tapping a bubble brings the detail above the map into view', async () => {
      // jsdom has no scrollIntoView: record the elements asked to scroll.
      const scrolled: Element[] = [];
      const proto = Element.prototype as { scrollIntoView?: Element['scrollIntoView'] };
      const original = proto.scrollIntoView;
      proto.scrollIntoView = function (this: Element) { scrolled.push(this); };
      try {
        const { container } = renderAt();
        await act(async () => {});
        const ottawa = container.querySelector<SVGCircleElement>('circle[data-metro="ottawa"]')!;
        fireEvent.keyDown(ottawa, { key: 'Enter' });
        expect(params().get('metro')).toBe('ottawa');
        expect(scrolled).toContain(container.querySelector('.dsp-sidecol'));
      } finally {
        if (original) proto.scrollIntoView = original;
        else delete proto.scrollIntoView;
      }
    });
  });

  it('takes the suppression floors from meta.json for its small-number copy', async () => {
    setData({ status: 'ready', data: makeFile() }, { status: 'ready', data: { k: { field: 7, named: 12 }, snapshot: '2025-09' } });
    const { container } = renderAt('?level=graduate&program=Art+Conservation');
    await act(async () => {});
    // The abroad count is a count of people (k.field); places are named (k.named).
    expect(within(screen.getByLabelText(/Headline numbers/)).getByText('< 7')).toBeInTheDocument();
    const text = container.textContent ?? '';
    expect(text).toContain('No single city has 12 or more Art Conservation alumni');
    expect(text).toContain('Places with fewer than 12 people aren’t shown');
    expect(text).toContain('snapshot September 2025');
  });

  it('toggles the accessible table view, with same-named places told apart', async () => {
    setData({ status: 'ready', data: { ...makeFile(), views: makeFile().views.map((v) => (v.level === 'all' && v.cohort === 'all' ? { ...v, metros: [...v.metros, ['london-on', 763]] } : v)) } });
    renderAt();
    await act(async () => {});
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    const toggle = screen.getByRole('switch', { name: 'Table' });
    // aria-controls only while the tables exist
    expect(toggle).not.toHaveAttribute('aria-controls');
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-checked', 'true');
    expect(toggle).toHaveAttribute('aria-controls', 'dsp-tables');
    expect(document.getElementById('dsp-tables')).toBeInTheDocument();
    const table = screen.getByRole('table', { name: /Metro areas where alumni live now \(12 places\)/ });
    expect(within(table).getAllByRole('row')).toHaveLength(13); // header + 12
    expect(within(table).getByRole('button', { name: 'London, UK' })).toBeInTheDocument();
    expect(within(table).getByRole('button', { name: 'London, Ont.' })).toBeInTheDocument();
    fireEvent.click(within(table).getByRole('button', { name: 'Ottawa' }));
    expect(params().get('metro')).toBe('ottawa');
    fireEvent.click(toggle);
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    expect(toggle).not.toHaveAttribute('aria-controls');
  });

  it('draws flow arcs when Moves is on and lists them in the table', async () => {
    const { container } = renderAt('?moves=1');
    await act(async () => {});
    expect(screen.getByRole('switch', { name: 'Moves' })).toHaveAttribute('aria-checked', 'true');
    expect(container.querySelectorAll('.dsp-flow__line').length).toBeGreaterThan(0);
    expect(container.querySelector('[data-flow="atlantis>toronto"]')).toBeNull();
    fireEvent.click(screen.getByRole('switch', { name: 'Table' }));
    const flows = screen.getByRole('table', { name: /Moves between metro areas/ });
    expect(within(flows).getAllByRole('row')).toHaveLength(6); // header + 5 valid moves
  });

  it('the abroad ranking maps a program in one click, and its heading claims no false peak', async () => {
    renderAt();
    await act(async () => {});
    expect(screen.getByRole('heading', { name: 'About 1 in 6 alumni from 1995–1999 live abroad; recent grads haven’t left yet' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Computer Science\s*Master’s\/PhD · 469 located/ })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Commerce\s*Undergrad.*Map this program/ }));
    expect(params().get('level')).toBe('undergrad');
    expect(params().get('program')).toBe('Commerce');
  });

  describe('map view', () => {
    it('opens on North America and labels the top five places', async () => {
      const { container } = renderAt();
      await act(async () => {});
      expect(regionChip(/^North America/)).toHaveAttribute('aria-pressed', 'true');
      const labelled = [...container.querySelectorAll('.dsp-label')].map((l) => (l as SVGElement).dataset.label);
      // Top five by people; London (6th) is off-screen at this zoom anyway.
      expect(labelled).toEqual(expect.arrayContaining(['toronto', 'kingston', 'ottawa', 'vancouver', 'new-york']));
    });

    it('opens on Ontario & Québec when moves are on, or a metro there is selected', async () => {
      renderAt('?moves=1');
      await act(async () => {});
      expect(regionChip(/^Ontario & Québec/)).toHaveAttribute('aria-pressed', 'true');
    });

    it('opens on Ontario & Québec for a selected metro there', async () => {
      const { container } = renderAt('?metro=kingston');
      await act(async () => {});
      expect(regionChip(/^Ontario & Québec/)).toHaveAttribute('aria-pressed', 'true');
      expect(mapTransform(container).k).toBeCloseTo(regionTransform(makeFrame(960), 'ontario-quebec').k, 3);
    });

    it('fits a filter whose places are all in one country', async () => {
      const { container } = renderAt('?level=undergrad&program=Computer+Science');
      await act(async () => {});
      for (const name of [/^World/, /^North America/, /^Ontario/, /^Europe/]) expect(regionChip(name)).toHaveAttribute('aria-pressed', 'false');
      const t = mapTransform(container);
      expect(t.k).toBeGreaterThan(regionTransform(makeFrame(960), 'north-america').k);
      const svg = container.querySelector('svg.dsp-svg')!;
      const w = Number(svg.getAttribute('width'));
      const h = Number(svg.getAttribute('height'));
      for (const c of container.querySelectorAll('circle.dsp-bubble')) {
        expect(Number(c.getAttribute('cx'))).toBeGreaterThan(0);
        expect(Number(c.getAttribute('cx'))).toBeLessThan(w);
        expect(Number(c.getAttribute('cy'))).toBeGreaterThan(0);
        expect(Number(c.getAttribute('cy'))).toBeLessThan(h);
      }
    });

    it('a resize re-fits the chosen region and keeps its chip pressed', async () => {
      vi.stubGlobal('ResizeObserver', FakeResizeObserver);
      const { container } = renderAt();
      await settle();
      await resizeTo(600);
      expect(Number(container.querySelector('svg.dsp-svg')!.getAttribute('width'))).toBe(600);
      expect(mapTransform(container).k).toBeCloseTo(regionTransform(makeFrame(600), 'north-america').k, 3);
      expect(regionChip(/^North America/)).toHaveAttribute('aria-pressed', 'true');
    });

    it('a resize of a hand-zoomed map keeps the same place in the middle', async () => {
      reduceMotion();
      vi.stubGlobal('ResizeObserver', FakeResizeObserver);
      const { container } = renderAt();
      await resizeTo(900);
      fireEvent.click(screen.getByRole('button', { name: 'Zoom in' }));
      await settle();
      expect(regionChip(/^North America/)).toHaveAttribute('aria-pressed', 'false');
      const centre = (width: number) => {
        const fr = makeFrame(width);
        const t = mapTransform(container);
        return fr.projection.invert!([(fr.width / 2 - t.x) / t.k, (fr.height / 2 - t.y) / t.k])!;
      };
      const before = centre(900);
      const kBefore = mapTransform(container).k;
      await resizeTo(640);
      const after = centre(640);
      expect(mapTransform(container).k).toBeCloseTo(kBefore, 3);
      expect(after[0]).toBeCloseTo(before[0], 0);
      expect(after[1]).toBeCloseTo(before[1], 0);
    });

    it('focusing an off-screen bubble pans to it, un-presses the region, and anchors its tooltip to it', async () => {
      reduceMotion();
      const { container } = renderAt('?moves=1');
      await settle();
      expect(regionChip(/^Ontario & Québec/)).toHaveAttribute('aria-pressed', 'true');
      const sydney = container.querySelector<SVGCircleElement>('circle[data-metro="sydney"]')!;
      const w = Number(container.querySelector('svg.dsp-svg')!.getAttribute('width'));
      expect(Number(sydney.getAttribute('cx')) < 0 || Number(sydney.getAttribute('cx')) > w).toBe(true);
      act(() => sydney.focus());
      await settle();
      expect(regionChip(/^Ontario & Québec/)).toHaveAttribute('aria-pressed', 'false');
      const cx = Number(sydney.getAttribute('cx'));
      const cy = Number(sydney.getAttribute('cy'));
      const r = Number(sydney.getAttribute('r'));
      expect(cx).toBeGreaterThan(0);
      expect(cx).toBeLessThan(w);
      const tip = container.querySelector<HTMLElement>('.dsp-tip')!;
      expect(tip).toHaveTextContent('Sydney');
      expect(parseFloat(tip.style.left)).toBeCloseTo(cx, 1);
      expect(parseFloat(tip.style.top)).toBeCloseTo(cy - r, 1);
    });

    it('selecting an Ontario place from the list zooms a continent-wide map to Ontario & Québec', async () => {
      reduceMotion();
      renderAt();
      await settle();
      const list = screen.getByRole('complementary', { name: 'Places' });
      fireEvent.click(within(list).getByRole('button', { name: /Ottawa/ }));
      await settle();
      expect(regionChip(/^Ontario & Québec/)).toHaveAttribute('aria-pressed', 'true');
    });

    it('turning moves on re-frames the map to Ontario & Québec, and off again to North America', async () => {
      reduceMotion();
      renderAt();
      await settle();
      fireEvent.click(screen.getByRole('switch', { name: 'Moves' }));
      await settle();
      expect(regionChip(/^Ontario & Québec/)).toHaveAttribute('aria-pressed', 'true');
      fireEvent.click(screen.getByRole('switch', { name: 'Moves' }));
      await settle();
      expect(regionChip(/^North America/)).toHaveAttribute('aria-pressed', 'true');
    });

    it('keeps a region the visitor chose when a filter change only implies the default', async () => {
      reduceMotion();
      renderAt();
      await settle();
      fireEvent.click(regionChip(/^Europe/));
      fireEvent.click(screen.getByRole('radio', { name: 'Undergrad' }));
      await settle();
      expect(regionChip(/^Europe/)).toHaveAttribute('aria-pressed', 'true');
    });
  });
});

// Keep the fixture's geography honest for the tests above.
it('fixture places Sydney outside Ontario & Québec', () => {
  const frame = makeFrame(960);
  const t = regionTransform(frame, 'ontario-quebec');
  const s = project(frame, METROS.find((m) => m.id === 'sydney')!.lon, METROS.find((m) => m.id === 'sydney')!.lat)!;
  expect(s.x * t.k + t.x).toBeGreaterThan(frame.width);
});
