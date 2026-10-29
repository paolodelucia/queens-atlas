import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { __resetDataCache } from '../../data/load';
import type { Meta } from '../../data/types';
import { RouterProvider } from '../../lib/router';
import { SITE } from '../../site.config';
import RiverView from './RiverView';
import { river } from './testFixture';

// Full-page renders with user-event typing: give them room on a busy machine.
vi.setConfig({ testTimeout: 20_000 });

const json = (body: unknown) => ({ ok: true, status: 200, json: async () => body }) as unknown as Response;
const ok = () => json(river);

/** meta.json knows a master's Computer Engineering program (a Career Twin group) that has no River. */
const meta = {
  programs: [
    { level: 'undergrad', program: 'Computer Engineering', discipline: 'engineering', n: 507, river: true },
    { level: 'graduate', program: 'Computer Engineering', discipline: 'engineering', n: 26, river: false },
  ],
} as unknown as Meta;
const byUrl = vi.fn(async (url: string) => json(String(url).includes('meta.json') ? meta : river));

function renderAt(url: string) {
  window.history.replaceState(null, '', url);
  return render(<RouterProvider><RiverView /></RouterProvider>);
}

const summaryText = (container: HTMLElement) => container.querySelector('.river-summary__text')?.textContent ?? '';
const params = () => new URLSearchParams(window.location.search);
const chartSvg = (container: HTMLElement) => container.querySelector('svg.river-svg') as unknown as HTMLElement;
const yearsSvg = (container: HTMLElement) => container.querySelector('svg.yrs-svg') as unknown as HTMLElement;
const readout = (container: HTMLElement) => container.querySelector('.yrs-readout') as HTMLElement;

/** jsdom has no layout: report a phone-width chart card to every ResizeObserver. */
function phoneWidth(width = 343) {
  vi.stubGlobal('ResizeObserver', class {
    constructor(private cb: ResizeObserverCallback) {}
    observe() { this.cb([{ contentRect: { width } } as ResizeObserverEntry], this as unknown as ResizeObserver); }
    unobserve() {}
    disconnect() {}
  });
}

beforeEach(() => {
  __resetDataCache();
  vi.stubGlobal('fetch', vi.fn(async () => ok()));
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe('RiverView', () => {
  it('shows the zine header (eyebrow pill + question) and a loading state while data loads', () => {
    vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})));
    renderAt('/river');
    expect(screen.getByText('The River')).toHaveClass('eyebrow');
    expect(screen.getByRole('heading', { level: 1, name: 'Where does a graduating class end up?' })).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Loading career paths…');
  });

  it('shows an error with a working retry', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: false, status: 500 } as Response)
      .mockResolvedValue(ok());
    vi.stubGlobal('fetch', fetchMock);
    const { container } = renderAt('/river');
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not load river data (500)');
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(summaryText(container)).toContain('Of about 13,440 Queen’s alumni'));
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('renders the default view: class of 2010–2014, related fields grouped, one highlighted number, honest notes', async () => {
    const { container } = renderAt('/river');
    await waitFor(() => expect(summaryText(container)).toBe(
      'Of about 13,440 Queen’s alumni from the class of 2010–2014, careers converge on management: '
      + 'Management & ventures grows from 10% right after graduating to 16% today.',
    ));
    // exactly one highlighted number
    const hl = container.querySelectorAll('.river-summary .ui-hl');
    expect(hl).toHaveLength(1);
    expect(hl[0]).toHaveTextContent('16%');
    expect(container.querySelector('.river-summary__meta')).toHaveTextContent('13,440 LinkedIn profiles · snapshot Sep 2025');
    expect(container.querySelector('.river-small')).toBeNull();
    expect(screen.getByRole('button', { name: 'Management & ventures, First destination: 1,409 people, 10% of the class' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Further study, First destination: 1,492 people/ })).toBeInTheDocument();
    const svg = chartSvg(container);
    expect(within(svg).getAllByText('Management').length).toBeGreaterThan(0);
    for (const stage of ['First destination', 'Year 3', 'Year 5', 'Year 10', 'Today']) expect(within(svg).getByText(stage)).toBeInTheDocument();
    expect(container.querySelector('.river-chart__hint')).toHaveTextContent('Related fields share a colour.');
    const detail = screen.getByRole('switch', { name: 'Show all fields' });
    expect(detail).toHaveAttribute('aria-checked', 'false');
    // the switch names the chart it changes
    expect(detail).toHaveAttribute('aria-controls', 'river-viz');
    expect(document.getElementById('river-viz')).toHaveClass('river-chart');
    // notes: the floors come from meta.k (5 for fields), perturbation, and the site's privacy line
    const notes = container.querySelector('.river-notes')!;
    expect(screen.getByText('Flows under 5 people are hidden.')).toBeInTheDocument();
    expect(notes).toHaveTextContent('add up to about 1,945 moves');
    expect(notes).toHaveTextContent('Related fields are grouped');
    expect(notes).toHaveTextContent('fewer than 5 people at a stage');
    expect(notes).toHaveTextContent(SITE.privacyLine);
    expect(notes).toHaveTextContent('close, not exact');
    expect(notes).not.toHaveTextContent(/under 10|famil/i);
    // defaults are reflected in the controls
    expect(screen.getByRole('radio', { name: 'All alumni' })).toBeChecked();
    expect(screen.getByRole('radio', { name: 'Class of 2010–2014' })).toBeChecked();
    expect(screen.getByRole('combobox', { name: 'Program' })).toBeDisabled();
    // the Flow tab is selected and its panel is labelled by it
    const flow = screen.getByRole('tab', { name: 'Flow' });
    expect(flow).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tabpanel', { name: 'Flow' })).toContainElement(svg);
    expect(params().get('view')).toBeNull();
  });

  it('puts a then-vs-now card under the chart, with a sticker only when the data backs it', async () => {
    const { container } = renderAt('/river?level=undergrad&program=Commerce');
    const card = await screen.findByRole('region', { name: 'Then vs now' });
    const rows = within(card).getAllByRole('listitem');
    expect(rows.map((r) => r.querySelector('.thennow__name')?.textContent)).toEqual(['Sales & marketing', 'Finance & accounting']);
    expect(rows[1]).toHaveTextContent('39% right after graduating, 33% today');
    expect(rows[1]).toHaveTextContent('−6 pts');
    expect(rows[0]).toHaveTextContent('−1 pt');
    // finance keeps 60%+ of its people at every published step
    expect(within(card).getByText('most of finance stays put')).toHaveClass('ui-sticker');
    expect(container.querySelectorAll('.ui-sticker')).toHaveLength(1);
  });

  it('shows no sticker when nothing clears the bar', async () => {
    const { container } = renderAt('/river?cohort=2020-2024');
    await screen.findByRole('region', { name: 'Then vs now' });
    expect(container.querySelector('.ui-sticker')).toBeNull();
  });

  it('shows every field with “Show all fields” and keeps the choice in the URL', async () => {
    const { container } = renderAt('/river');
    await userEvent.click(await screen.findByRole('switch', { name: 'Show all fields' }));
    expect(params().get('detail')).toBe('1');
    await waitFor(() => expect(summaryText(container)).toContain('Operations & management grows from 10% right after graduating to 16% today.'));
    expect(screen.getByRole('button', { name: /^Operations & management, First destination: 1,409 people/ })).toBeInTheDocument();
    await waitFor(() => expect(within(chartSvg(container)).getAllByText('Ops/Mgmt').length).toBeGreaterThan(0));
    expect(container.querySelector('.river-notes')).not.toHaveTextContent('Related fields are grouped');
    await userEvent.click(screen.getByRole('switch', { name: 'Show all fields' }));
    expect(params().get('detail')).toBeNull();
  });

  it('renders a program slice by field, with a node tooltip listing employers', async () => {
    const { container } = renderAt('/river?level=undergrad&program=Commerce');
    await waitFor(() => expect(summaryText(container)).toBe(
      'Of about 1,060 Commerce grads from the class of 2010–2014, careers move away from finance: '
      + 'Finance & accounting shrinks from 39% right after graduating to 33% today, though it is still the largest field.',
    ));
    expect(screen.queryByRole('switch', { name: 'Show all fields' })).toBeNull();
    const node = screen.getByRole('button', { name: /^Finance & accounting, First destination: 410 people, 39% of the class/ });
    fireEvent.pointerOver(node);
    const tip = screen.getByRole('tooltip');
    expect(tip).toBeVisible();
    expect(tip).toHaveTextContent('Top employers');
    expect(tip).toHaveTextContent('RBC');
    expect(tip).toHaveTextContent('Went on to (Year 3)');
    // a node with a total but no links still renders
    expect(screen.getByRole('button', { name: /^Other roles, First destination: 10 people/ })).toBeInTheDocument();
  });

  it('describes smaller groups with the field floor from the data', async () => {
    renderAt('/river?level=undergrad&program=Commerce');
    const node = await screen.findByRole('button', { name: /^Smaller groups, First destination/ });
    fireEvent.pointerOver(node);
    expect(screen.getByRole('tooltip')).toHaveTextContent('Fields with fewer than 5 people at this point, combined to protect privacy.');
  });

  it('lists the fields behind a grouped node in its tooltip', async () => {
    renderAt('/river');
    const node = await screen.findByRole('button', { name: /^Management & ventures, Year 5: 1,792 people/ });
    fireEvent.pointerOver(node);
    const tip = screen.getByRole('tooltip');
    expect(tip).toHaveTextContent('Fields in this group');
    expect(tip).toHaveTextContent('Operations & management1,792');
    expect(tip).not.toHaveTextContent('Top employers');
  });

  it('shows a flow tooltip on hover', async () => {
    const { container } = renderAt('/river?level=undergrad&program=Commerce');
    await screen.findByRole('button', { name: /^Finance & accounting, First destination/ });
    const hit = container.querySelector('[data-link="s0:sales_marketing>y3:sales_marketing"]')!;
    fireEvent.pointerOver(hit);
    const tip = screen.getByRole('tooltip');
    expect(tip).toHaveTextContent('120 people');
    expect(tip).toHaveTextContent('Sales/Mktg');
    expect(tip).toHaveTextContent('First destination');
    expect(tip).toHaveTextContent('Year 3');
  });

  it('pins a node with Enter and clears it with Escape', async () => {
    renderAt('/river?level=undergrad&program=Commerce');
    const node = await screen.findByRole('button', { name: /^Sales & marketing, First destination/ });
    expect(node).toHaveAttribute('aria-pressed', 'false');
    fireEvent.keyDown(node, { key: 'Enter' });
    expect(node).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('tooltip')).toHaveTextContent('Sales & marketing');
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(node).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByRole('tooltip', { hidden: true })).not.toBeVisible();
  });

  it('only shows first destination and today for a recent class', async () => {
    const { container } = renderAt('/river?cohort=2020-2024');
    await waitFor(() => expect(summaryText(container)).toContain('the mix of fields barely changes: Tech is the largest'));
    const svg = chartSvg(container);
    expect(within(svg).getByText('First destination')).toBeInTheDocument();
    expect(within(svg).getByText('Today')).toBeInTheDocument();
    expect(within(svg).queryByText('Year 3')).toBeNull();
  });

  it('draws six columns for the oldest classes', async () => {
    const { container } = renderAt('/river?cohort=1995-1999');
    await screen.findByRole('tab', { name: 'Flow' });
    const svg = chartSvg(container);
    for (const stage of ['First destination', 'Year 3', 'Year 5', 'Year 10', 'Year 20', 'Today']) expect(within(svg).getByText(stage)).toBeInTheDocument();
  });

  it('notes small classes (under 50 people)', async () => {
    const { container } = renderAt('/river?level=graduate&program=Analytics&cohort=all');
    await waitFor(() => expect(summaryText(container)).toContain('Of about 42 Analytics grads (master’s & PhD)'));
    expect(container.querySelector('.river-small')).toHaveTextContent('Small class: shares can jump a few points.');
  });

  it('explains a missing combo, offers alternatives, and keeps focus on the page after one is chosen', async () => {
    const { container } = renderAt('/river?level=undergrad&program=Art%20History&cohort=1995-1999');
    expect(await screen.findByRole('heading', { name: 'Not enough people to draw this river' })).toBeInTheDocument();
    expect(screen.getByText(/Fewer than 30 Art History grads from the class of 1995–1999/)).toBeInTheDocument();
    expect(container.querySelector('svg.river-svg')).toBeNull();
    expect(screen.queryByRole('tab')).toBeNull();
    expect(screen.queryByRole('region', { name: 'Then vs now' })).toBeNull();
    const alt = screen.getByRole('button', { name: /Art History, all classes/ });
    expect(alt).toHaveClass('btn');
    expect(screen.getByRole('button', { name: /Art History, class of 2010–2014/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /All undergrads, class of 1995–1999/ })).toBeInTheDocument();
    alt.focus();
    await userEvent.keyboard('{Enter}');
    expect(params().get('cohort')).toBe('all');
    await waitFor(() => expect(summaryText(container)).toContain('Of about 183 Art History grads from the classes of 1995–2024'));
    // the button that had focus is gone: focus lands on the summary, not <body> (WCAG 2.4.3)
    expect(document.activeElement).toBe(container.querySelector('.river-summary'));
  });

  it('disables classes that have no River for the chosen program, with the reason', async () => {
    renderAt('/river?level=undergrad&program=Art%20History');
    const old = await screen.findByRole('radio', { name: 'Class of 1995–1999' });
    expect(old).toBeDisabled();
    expect(old).toHaveAccessibleDescription('Fewer than 30 people');
    expect(old.closest('label')).toHaveAttribute('title', 'Class of 1995–1999: Fewer than 30 people');
    expect(screen.getByRole('radio', { name: 'Class of 2010–2014' })).toBeEnabled();
    // "All" is named by what it shows; the full span of classes is its description
    const all = screen.getByRole('radio', { name: 'All' });
    expect(all).toBeEnabled();
    expect(all).toHaveAccessibleDescription('Classes of 1995–2024');
  });

  it('moves to a class that has a River when a new program lacks the current one', async () => {
    const { container } = renderAt('/river?level=undergrad');
    const combo = await screen.findByRole('combobox', { name: 'Program' });
    await userEvent.clear(combo);
    await userEvent.type(combo, 'biology{Enter}');
    expect(params().get('program')).toBe('Biology');
    expect(params().get('cohort')).toBe('2015-2019');
    await waitFor(() => expect(summaryText(container)).toContain('Of about 120 Biology grads from the class of 2015–2019'));
  });

  it('toggles the flow tab to an accessible table view and back', async () => {
    const { container } = renderAt('/river?level=undergrad&program=Commerce');
    await screen.findByRole('button', { name: /^Finance & accounting, First destination/ });
    await userEvent.click(screen.getByRole('radio', { name: 'Table' }));
    expect(screen.getByRole('radio', { name: 'Table' })).toBeChecked();
    const table = screen.getByRole('table', { name: /People in each field at each stage: Commerce, class of 2010–2014/ });
    expect(within(table).getAllByRole('columnheader').map((th) => th.textContent))
      .toEqual(['Field', 'First destination', 'Year 3', 'Year 5', 'Year 10', 'Today']);
    expect(table.querySelector('caption')).toHaveTextContent('a dash means fewer than 5 people');
    const finRow = within(table).getByRole('row', { name: /Finance & accounting/ });
    expect(finRow).toHaveTextContent('410');
    expect(finRow).toHaveTextContent('39%');
    const opsRow = within(table).getByRole('row', { name: /Operations & management/ });
    expect(opsRow).toHaveTextContent('fewer than 5'); // unpublished at s0, never shown as 0
    expect(container.querySelector('svg.river-svg')).toBeNull();
    expect(screen.getByText(/All 9 published flows/)).toBeInTheDocument();
    expect(document.getElementById('river-viz')).toHaveClass('river-tables');
    await userEvent.click(screen.getByRole('radio', { name: 'Chart' }));
    expect(container.querySelector('svg.river-svg')).not.toBeNull();
  });

  it('resets the program when the new level does not have it, and keeps it when it does', async () => {
    renderAt('/river?level=undergrad&program=Economics&cohort=all');
    await screen.findByRole('button', { name: /^Finance & accounting, First destination/ });
    // abbreviated levels are named by what they show, with the full name as the description
    const grad = screen.getByRole('radio', { name: 'Grad' });
    expect(grad).toHaveAccessibleDescription('Master’s & PhD');
    await userEvent.click(grad);
    expect(params().get('program')).toBe('Economics');
    expect(params().get('level')).toBe('graduate');
    await userEvent.click(screen.getByRole('radio', { name: 'Law (JD)' }));
    expect(window.location.search).toBe('?level=law&cohort=all');
  });

  it('filters programs in the combobox and picks one with the keyboard', async () => {
    renderAt('/river?level=undergrad');
    const combo = await screen.findByRole('combobox', { name: 'Program' });
    expect(combo).toHaveValue('All programs');
    await userEvent.clear(combo);
    await userEvent.type(combo, 'art');
    const list = screen.getByRole('listbox', { name: 'Programs' });
    expect(within(list).getAllByRole('option').map((o) => o.textContent)).toEqual(['Art History183']);
    await userEvent.keyboard('{Enter}');
    expect(params().get('program')).toBe('Art History');
    await waitFor(() => expect(combo).toHaveValue('Art History'));
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('matches the program in the URL case-insensitively', async () => {
    const { container } = renderAt('/river?program=commerce');
    await waitFor(() => expect(summaryText(container)).toContain('Of about 1,060 Commerce grads'));
    expect(screen.getByRole('combobox', { name: 'Program' })).toHaveValue('Commerce');
    expect(screen.getByRole('radio', { name: 'Undergrad' })).toBeChecked();
    expect(container.querySelector('.river-notice')).toBeNull();
  });

  it('says so when the URL names a program without a River, with links to where it exists', async () => {
    vi.stubGlobal('fetch', byUrl);
    const { container } = renderAt('/river?level=graduate&program=Computer+Engineering&cohort=all');
    const notice = await screen.findByText(/There’s no River for Computer Engineering/);
    expect(notice.closest('.river-notice')).toHaveTextContent(
      'There’s no River for Computer Engineering (master’s & PhD): too few grads have a career path (a River needs 30). '
      + 'Showing all master’s & PhD grads.',
    );
    await waitFor(() => expect(summaryText(container)).toContain('Of about 9,845 master’s & PhD grads'));
    expect(screen.getByRole('combobox', { name: 'Program' })).toHaveValue('All programs');
    expect(screen.getByRole('link', { name: 'Computer Engineering in Career Twin' }))
      .toHaveAttribute('href', '/twin?level=graduate&program=Computer+Engineering');
    const link = screen.getByRole('link', { name: /River for Computer Engineering \(undergrad\)/ });
    expect(link).toHaveAttribute('href', '/river?level=undergrad&program=Computer+Engineering&cohort=all');
    await userEvent.click(link);
    await waitFor(() => expect(summaryText(container)).toContain('Of about 507 Computer Engineering grads'));
    expect(container.querySelector('.river-notice')).toBeNull();
    expect(document.activeElement).toBe(container.querySelector('.river-summary'));
  });

  it('treats unknown URL values (old ten-year classes too) as defaults and names the program it could not find', async () => {
    const { container } = renderAt('/river?level=nope&program=Foo&cohort=2005-2015&view=sideways');
    await waitFor(() => expect(summaryText(container)).toContain('Of about 13,440 Queen’s alumni from the class of 2010–2014'));
    expect(screen.getByRole('radio', { name: 'All alumni' })).toBeChecked();
    expect(screen.getByRole('radio', { name: 'Class of 2010–2014' })).toBeChecked();
    expect(screen.getByRole('tab', { name: 'Flow' })).toHaveAttribute('aria-selected', 'true');
    expect(await screen.findByText('There’s no River for “Foo”.')).toBeInTheDocument();
    expect(container.querySelector('.river-notice')).toHaveTextContent('Showing all Queen’s alumni.');
  });

  describe('inbound links from other pages', () => {
    it('opens a level’s all-programs view from ?level= alone', async () => {
      const { container } = renderAt('/river?level=undergrad');
      await waitFor(() => expect(summaryText(container)).toContain('Of about 9,000 undergrads from the class of 2010–2014'));
      expect(screen.getByRole('radio', { name: 'Undergrad' })).toBeChecked();
      expect(screen.getByRole('combobox', { name: 'Program' })).toHaveValue('All programs');
    });

    it('lands on all classes when the level has no River for the default class', async () => {
      const { container } = renderAt('/river?level=medicine');
      await waitFor(() => expect(summaryText(container)).toContain('Of about 640 medical grads from the classes of 1995–2024'));
      expect(screen.getByRole('radio', { name: 'All' })).toBeChecked();
      expect(container.querySelector('.river-missing')).toBeNull();
    });

    it('opens everyone in a class from ?cohort= alone', async () => {
      const { container } = renderAt('/river?cohort=2010-2014');
      await waitFor(() => expect(summaryText(container)).toContain('Of about 13,440 Queen’s alumni from the class of 2010–2014'));
      expect(screen.getByRole('radio', { name: 'All alumni' })).toBeChecked();
      expect(screen.getByRole('radio', { name: 'Class of 2010–2014' })).toBeChecked();
    });

    it('picks a class the program has when the link names none', async () => {
      const { container } = renderAt('/river?level=undergrad&program=Biology');
      await waitFor(() => expect(summaryText(container)).toContain('Of about 120 Biology grads from the class of 2015–2019'));
      expect(screen.getByRole('radio', { name: 'Class of 2015–2019' })).toBeChecked();
      expect(container.querySelector('.river-missing')).toBeNull();
    });
  });

  it('copies a canonical link to the view, tab included', async () => {
    const writeText = vi.fn(async () => {});
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } });
    renderAt('/river?program=commerce&cohort=all');
    const button = await screen.findByRole('button', { name: 'Copy link to this view' });
    await userEvent.click(button);
    expect(writeText).toHaveBeenCalledWith(`${window.location.origin}/river?level=undergrad&program=Commerce&cohort=all`);
    expect(await screen.findByText('Link copied')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('tab', { name: 'Year by year' }));
    await userEvent.click(screen.getByRole('button', { name: 'Copy link to this view' }));
    expect(writeText).toHaveBeenLastCalledWith(`${window.location.origin}/river?level=undergrad&program=Commerce&cohort=all&view=years`);
  });

  describe('Year by year tab', () => {
    it('switches tabs from the URL, by click and with the arrow keys', async () => {
      const { container } = renderAt('/river?level=undergrad&program=Commerce&view=years');
      const years = await screen.findByRole('tab', { name: 'Year by year' });
      expect(years).toHaveAttribute('aria-selected', 'true');
      expect(years).toHaveAttribute('aria-controls', 'river-panel-years');
      expect(screen.getByRole('tab', { name: 'Flow' })).toHaveAttribute('tabindex', '-1');
      expect(screen.getByRole('tabpanel', { name: 'Year by year' })).toContainElement(yearsSvg(container));
      expect(chartSvg(container)).toBeNull();
      // arrow keys move and select (the URL follows)
      years.focus();
      await userEvent.keyboard('{ArrowLeft}');
      expect(screen.getByRole('tab', { name: 'Flow' })).toHaveFocus();
      expect(screen.getByRole('tab', { name: 'Flow' })).toHaveAttribute('aria-selected', 'true');
      expect(params().get('view')).toBeNull();
      expect(chartSvg(container)).not.toBeNull();
      await userEvent.click(screen.getByRole('tab', { name: 'Year by year' }));
      expect(params().get('view')).toBe('years');
      // the summary, then-vs-now card and filters stay put across tabs
      expect(summaryText(container)).toContain('Of about 1,060 Commerce grads');
      expect(screen.getByRole('region', { name: 'Then vs now' })).toBeInTheDocument();
    });

    it('starts on year 10 and reads out shares of that year’s people, largest first', async () => {
      const { container } = renderAt('/river?level=undergrad&program=Commerce&view=years');
      const slider = await screen.findByRole('slider', { name: 'Year after graduating' });
      expect(slider).toHaveAttribute('aria-valuetext', 'Year 10: 1,060 people. Largest: Finance & accounting, 34%.');
      const out = readout(container);
      expect(out).toHaveTextContent('Year 10');
      expect(out).toHaveTextContent('1,060 people');
      const items = within(out).getAllByRole('listitem');
      expect(items[0]).toHaveTextContent('Finance & accounting');
      expect(items[0]).toHaveTextContent('359');
      expect(items[0]).toHaveTextContent('34%');
      // part of the 100% isn't published: drawn as a hatched band, named without a number
      const rest = out.querySelector('.yrs-readout__rest')!;
      expect(rest).toHaveTextContent('Not shown');
      expect(rest).toHaveTextContent('fields under 5 people');
      expect(rest).not.toHaveTextContent('%');
      expect(container.querySelector('.yrs-band--rest')).not.toBeNull();
      expect(container.querySelector('.yrs-hint')).toHaveTextContent('Each year adds up to 100% of the people who had reached it.');
    });

    it('moves year by year with the keys and says when fewer classes have reached a year', async () => {
      const { container } = renderAt('/river?level=undergrad&program=Commerce&view=years');
      const slider = await screen.findByRole('slider', { name: 'Year after graduating' });
      fireEvent.keyDown(slider, { key: 'ArrowRight' });
      expect(readout(container)).toHaveTextContent('Year 11');
      expect(readout(container)).not.toHaveTextContent('Only the');
      fireEvent.keyDown(slider, { key: 'ArrowRight' });
      // year 12: the class of 2014 hasn't got there yet (June 2026)
      expect(readout(container)).toHaveTextContent('830 people');
      expect(readout(container)).toHaveTextContent('Only the classes of 2010–2013 have reached year 12.');
      expect(slider).toHaveAttribute('aria-valuetext', expect.stringContaining('(the classes of 2010–2013)'));
      // shares are of the 830 who got there, not of the class
      expect(within(readout(container)).getAllByRole('listitem')[0]).toHaveTextContent('34%'); // 280 / 830
      fireEvent.keyDown(slider, { key: 'ArrowRight' });
      expect(readout(container)).toHaveTextContent('Small group: shares can jump a few points.');
      expect(readout(container)).toHaveTextContent('Shares add up to a bit more than 100% here');
      fireEvent.keyDown(slider, { key: 'End' });
      expect(readout(container)).toHaveTextContent('Today · Sep 2025');
      expect(readout(container)).not.toHaveTextContent('Only the');
      fireEvent.keyDown(slider, { key: 'Home' });
      expect(readout(container)).toHaveTextContent('First destination');
      expect(slider).toHaveAttribute('aria-valuenow', '0');
      // the chart marks where the later years start
      expect(container.querySelector('.yrs-partial__text')).toHaveTextContent('year 12 on: earlier classes only');
    });

    it('picks a year by pressing on the chart', async () => {
      const { container } = renderAt('/river?level=undergrad&program=Commerce&view=years');
      await screen.findByRole('slider', { name: 'Year after graduating' });
      const svg = yearsSvg(container) as unknown as SVGSVGElement;
      const w = Number(svg.getAttribute('width'));
      svg.getBoundingClientRect = () => ({ left: 0, top: 0, width: w, height: 380, right: w, bottom: 380, x: 0, y: 0, toJSON: () => ({}) });
      fireEvent.pointerDown(svg, { clientX: w - 2, clientY: 100, pointerId: 1 });
      fireEvent.pointerUp(svg, { pointerId: 1 });
      expect(readout(container)).toHaveTextContent('Today');
      fireEvent.pointerDown(svg, { clientX: 0, clientY: 100, pointerId: 1 });
      expect(readout(container)).toHaveTextContent('First destination');
    });

    it('starts on today for a class that hasn’t reached year 10, and rolls fields up like the flow', async () => {
      const { container } = renderAt('/river?cohort=2020-2024&view=years');
      await screen.findByRole('slider', { name: 'Year after graduating' });
      expect(readout(container)).toHaveTextContent('Today · Sep 2025');
      expect(within(readout(container)).getByText('Management & ventures')).toBeInTheDocument();
      await userEvent.click(screen.getByRole('switch', { name: 'Show all fields' }));
      expect(within(readout(container)).getByText('Operations & management')).toBeInTheDocument();
      expect(screen.getByRole('switch', { name: 'Show all fields' })).toHaveAttribute('aria-controls', 'river-viz');
      expect(document.getElementById('river-viz')).toHaveClass('yrs');
    });

    it('has a table twin with each year’s people and shares', async () => {
      renderAt('/river?level=undergrad&program=Commerce&view=years');
      await screen.findByRole('slider', { name: 'Year after graduating' });
      await userEvent.click(screen.getByRole('radio', { name: 'Table' }));
      const table = screen.getByRole('table', { name: /Share of people in each field, year by year: Commerce, class of 2010–2014/ });
      const heads = within(table).getAllByRole('columnheader').map((th) => th.textContent);
      expect(heads[0]).toBe('Field');
      expect(heads[1]).toBe('First');
      expect(heads[heads.length - 1]).toBe('Today');
      expect(within(table).getByRole('row', { name: /^People/ })).toHaveTextContent('830');
      const fin = within(table).getByRole('row', { name: /Finance & accounting/ });
      expect(fin).toHaveTextContent('39%');
      expect(within(table).getByRole('row', { name: /Operations & management/ })).toHaveTextContent('fewer than 5');
      expect(document.getElementById('river-viz')).toHaveClass('river-tables');
    });
  });

  describe('switching tabs morphs the chart', () => {
    let queue: FrameRequestCallback[] = [];
    let now = 0;
    /** Run animation frames `ms` apart until `total` ms have passed. */
    const frames = (total: number, ms = 16) => {
      for (let t = 0; t < total; t += ms) {
        now += ms;
        const run = queue;
        queue = [];
        act(() => { for (const cb of run) cb(now); });
      }
    };
    const stage = (c: HTMLElement) => c.querySelector('.river-morphstage') as HTMLElement;
    const progress = (c: HTMLElement) => Number(stage(c).dataset.progress);
    /** matchMedia that answers the reduced-motion query. */
    const motion = (reduce: boolean) => vi.stubGlobal('matchMedia', (q: string) => ({
      matches: reduce && q.includes('reduce'), media: q, onchange: null,
      addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent: () => false,
    }));

    beforeEach(() => {
      queue = [];
      now = 0;
      vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => { queue.push(cb); return queue.length; });
      vi.stubGlobal('cancelAnimationFrame', () => {});
    });

    it('swaps at once with reduced motion, exactly as before', async () => {
      motion(true);
      const { container } = renderAt('/river?level=undergrad&program=Commerce');
      await screen.findByRole('button', { name: /^Finance & accounting, First destination/ });
      await userEvent.click(screen.getByRole('tab', { name: 'Year by year' }));
      expect(yearsSvg(container)).not.toBeNull();
      expect(chartSvg(container)).toBeNull();
      expect(container.querySelector('.river-morph')).toBeNull();
      expect(stage(container)).not.toHaveClass('is-morphing');
      expect(queue).toHaveLength(0); // nothing scheduled
    });

    it('morphs the bars into the stack, then hands over to the real chart', async () => {
      motion(false);
      const { container } = renderAt('/river?level=undergrad&program=Commerce');
      await screen.findByRole('button', { name: /^Finance & accounting, First destination/ });
      const years = screen.getByRole('tab', { name: 'Year by year' });
      await userEvent.click(years);
      // the URL and the tab change at once; both charts are mounted, stacked, while the bands move
      expect(params().get('view')).toBe('years');
      expect(years).toHaveAttribute('aria-selected', 'true');
      expect(years).toHaveFocus();
      expect(stage(container)).toHaveClass('is-morphing');
      expect(chartSvg(container)).not.toBeNull();
      expect(yearsSvg(container)).not.toBeNull();
      for (const layer of container.querySelectorAll('.river-layer')) expect(layer).toHaveAttribute('inert');
      // the outgoing chart is hidden from assistive tech; the incoming one carries the chart's id
      expect(container.querySelector('[data-layer=flow]')).toHaveAttribute('aria-hidden', 'true');
      expect(document.getElementById('river-viz')).toHaveClass('yrs');

      frames(30 * 16); // jsdom never measures, so the morph waits its maximum, then plans
      frames(16 * 20);
      const p = progress(container);
      expect(p).toBeGreaterThan(0.2);
      expect(p).toBeLessThan(0.8);
      const bands = container.querySelectorAll('.river-morph__band');
      expect(bands.length).toBeGreaterThan(5);
      expect(bands[0].getAttribute('d')).toMatch(/^M.*Z$/);
      expect(container.querySelector('.river-morph__band[data-band="rest"]')).not.toBeNull();
      expect(container.querySelector('.river-morph__band[data-band="no_role_listed"]')).not.toBeNull();

      frames(800);
      expect(stage(container)).not.toHaveClass('is-morphing');
      expect(chartSvg(container)).toBeNull();
      expect(yearsSvg(container)).not.toBeNull();
      expect(container.querySelector('.river-morph')).toBeNull();
      expect(stage(container).getAttribute('style') ?? '').toBe('');
      expect(container.querySelector('.river-layer')).not.toHaveAttribute('inert');
      expect(years).toHaveFocus();
    });

    it('reverses from the current frame when the other tab is picked mid-way', async () => {
      motion(false);
      const { container } = renderAt('/river?level=undergrad&program=Commerce');
      await screen.findByRole('button', { name: /^Finance & accounting, First destination/ });
      await userEvent.click(screen.getByRole('tab', { name: 'Year by year' }));
      frames(30 * 16);
      frames(350);
      const mid = progress(container);
      expect(mid).toBeGreaterThan(0.3);
      await userEvent.click(screen.getByRole('tab', { name: 'Flow' }));
      expect(params().get('view')).toBeNull();
      frames(32);
      expect(progress(container)).toBeLessThan(mid); // heading back, from where it was
      expect(progress(container)).toBeGreaterThan(mid - 0.1);
      // the way back takes as long as the way there so far, not a whole morph
      frames(mid * 700 + 50);
      expect(stage(container)).not.toHaveClass('is-morphing');
      expect(chartSvg(container)).not.toBeNull();
      expect(yearsSvg(container)).toBeNull();
    });

    it('morphs on keyboard tab switching too, keeping focus on the tab', async () => {
      motion(false);
      const { container } = renderAt('/river?level=undergrad&program=Commerce&view=years');
      const years = await screen.findByRole('tab', { name: 'Year by year' });
      years.focus();
      await userEvent.keyboard('{ArrowLeft}');
      const flow = screen.getByRole('tab', { name: 'Flow' });
      expect(flow).toHaveFocus();
      expect(stage(container)).toHaveClass('is-morphing');
      frames(30 * 16 + 800);
      expect(chartSvg(container)).not.toBeNull();
      expect(yearsSvg(container)).toBeNull();
      expect(flow).toHaveFocus();
    });

    it('swaps at once in table view', async () => {
      motion(false);
      const { container } = renderAt('/river?level=undergrad&program=Commerce');
      await screen.findByRole('button', { name: /^Finance & accounting, First destination/ });
      await userEvent.click(screen.getByRole('radio', { name: 'Table' }));
      await userEvent.click(screen.getByRole('tab', { name: 'Year by year' }));
      expect(screen.getByRole('table', { name: /year by year/ })).toBeInTheDocument();
      expect(container.querySelector('.river-morph')).toBeNull();
    });
  });

  describe('on a phone-width card', () => {
    beforeEach(() => phoneWidth());

    it('shows first destination → today by default and adds years 3, 5 & 10 on request', async () => {
      const { container } = renderAt('/river');
      const add = await screen.findByRole('switch', { name: 'Add years 3, 5 & 10' });
      expect(document.getElementById(add.getAttribute('aria-controls')!)).toHaveClass('river-chart');
      const svg = chartSvg(container);
      expect(within(svg).getByText('First')).toBeInTheDocument(); // compact header: "First / destination"
      expect(within(svg).getByText('Today')).toBeInTheDocument();
      expect(within(svg).queryByText('Year 5')).toBeNull();
      expect(container.querySelectorAll('.river-link')).toHaveLength(0); // no flows are invented between the ends
      expect(container.querySelector('.river-chart__hint')).toHaveTextContent('Showing first destination and today only');
      await userEvent.click(add);
      expect(add).toHaveAttribute('aria-checked', 'true');
      await waitFor(() => expect(within(chartSvg(container)).getByText('Year 5')).toBeInTheDocument());
      expect(within(chartSvg(container)).getByText('Year 3')).toBeInTheDocument();
      expect(within(chartSvg(container)).getByText('Year 10')).toBeInTheDocument();
    });

    it('needs no switch when the class only has two stages', async () => {
      renderAt('/river?cohort=2020-2024');
      await screen.findByRole('switch', { name: 'Show all fields' });
      expect(screen.queryByRole('switch', { name: /Add year/ })).toBeNull();
    });

    it('puts the year readout under the chart', async () => {
      const { container } = renderAt('/river?view=years');
      await screen.findByRole('slider', { name: 'Year after graduating' });
      // The first render uses the wide fallback; the measured phone width arrives a moment later.
      await waitFor(() => expect(container.querySelector('.yrs')).not.toHaveClass('yrs--side'));
    });
  });
});
