import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { __resetDataCache } from '../../data/load';
import type { Fact, InsightsFile, Meta, RiverFile } from '../../data/types';
import { fmtInt } from '../../lib/format';
import { RouterProvider } from '../../lib/router';
import { SITE } from '../../site.config';
import HomeView from './HomeView';

// Made-up numbers throughout: the tests check what the page does with the data, not the data.
const meta: Meta = {
  generated: '2026-01-01', snapshot: '2025-09', k: { field: 5, named: 10 },
  counts: { profiles: 5000, alumni: 4321, roles: 20000, employers: 120, countries: 12, metros: 34, paths: 3000, firstYear: 1995, lastYear: 2024 },
  programs: [
    { level: 'undergrad', program: 'Commerce', discipline: 'business_commerce', n: 900, river: true },
    { level: 'law', program: 'Law', discipline: 'law', n: 700, river: true },
    { level: 'undergrad', program: 'Computer Science', discipline: 'computing', n: 400, river: true },
    { level: 'undergrad', program: 'Film and Media', discipline: 'fine_performing_arts', n: 300, river: true },
    { level: 'graduate', program: 'Computer Science', discipline: 'computing', n: 200, river: true },
    { level: 'undergrad', program: 'History', discipline: 'humanities', n: 150, river: true },
    { level: 'undergrad', program: 'Drama', discipline: 'fine_performing_arts', n: 120, river: true },
    { level: 'graduate', program: 'Law', discipline: 'law', n: 25, river: false },
  ],
  cohorts: [],
};

const facts: Fact[] = [
  { id: 'abroad', value: '20%', text: 'of alumni live outside Canada.', link: '/diaspora' },
  { id: 'consulting_exit', value: '60%', text: 'of consultants had moved on by year 10.', detail: '60 of 100.', link: '/twin' },
  { id: 'top_metro', value: '1 in 4', text: 'alumni live in one city.', detail: '25 of 100 alumni.', link: '/diaspora' },
  { id: 'law_stays', value: '70%', text: 'of Law grads still work in law ten years out.', detail: '70 of 100.', link: '/river?level=law&program=Law' },
  {
    id: 'top_first_employer', value: "Queen's University", text: 'is the most common first employer.',
    detail: '120 grads started there, mostly in research and teaching roles (55%).',
  },
];

const insights: InsightsFile = {
  firstEmployers: [{ name: 'Bank A', n: 40 }, { name: "Queen's University", n: 120 }],
  topEmployers: [],
  rankings: [
    {
      id: 'tech_now', label: 'Working in tech today', rows: [
        { level: 'undergrad', program: 'Computer Science', n: 400, hits: 200, pct: 50 },
        { level: 'graduate', program: 'Computer Science', n: 200, hits: 90, pct: 45 },
      ],
    },
    { id: 'finance_now', label: 'In finance & accounting today', rows: [{ level: 'undergrad', program: 'Commerce', n: 900, hits: 300, pct: 33.3 }] },
    { id: 'us_now', label: 'Living in the United States', rows: [{ level: 'graduate', program: 'Chemistry', n: 150, hits: 20, pct: 13.3 }] },
    { id: 'empty', label: 'Nothing here', rows: [] },
  ],
  facts,
  snapshot: { currentRolesImplying: [], currentRolesSample: 0, newestActivity: '2025-09-29T20:52Z', exportFileTimestamp: '2025-09-30T02:26Z', asOf: '2025-09-30' },
  labelling: { titles: 1, employers: 1, fields: 1, places: 1, costUsd: 1, model: 'x' },
};

const river: RiverFile = {
  meta: {
    generated: '', snapshot: '2025-09', k: { field: 5, named: 10 }, min_slice: 30, min_year: 10, note: '',
    stages: { s0: 'First destination', y3: 'Year 3', y5: 'Year 5', y10: 'Year 10', y20: 'Year 20', now: 'Today' },
  },
  slices: [{
    level: 'all', program: 'all', cohort: '2010-2014', n: 1700, stages: ['s0', 'y5', 'now'], suppressed: null, details: {}, years: [],
    // Management & ventures: 150 of 1,650 at the first job (9.1%), 250 of 1,700 at year 5, 400 of 1,900 today (21%).
    totals: {
      s0: { tech: 600, finance_accounting: 900, operations_management: 150 },
      y5: { tech: 700, finance_accounting: 750, operations_management: 250 },
      now: { tech: 800, finance_accounting: 700, operations_management: 300, founder: 100 },
    },
    links: [
      { from_stage: 's0', from: 'tech', to_stage: 'y5', to: 'tech', n: 600 },
      { from_stage: 's0', from: 'finance_accounting', to_stage: 'y5', to: 'finance_accounting', n: 750 },
      { from_stage: 's0', from: 'finance_accounting', to_stage: 'y5', to: 'operations_management', n: 100 },
      { from_stage: 's0', from: 'operations_management', to_stage: 'y5', to: 'operations_management', n: 150 },
      { from_stage: 'y5', from: 'tech', to_stage: 'now', to: 'tech', n: 700 },
      { from_stage: 'y5', from: 'finance_accounting', to_stage: 'now', to: 'finance_accounting', n: 650 },
      { from_stage: 'y5', from: 'finance_accounting', to_stage: 'now', to: 'founder', n: 50 },
      { from_stage: 'y5', from: 'operations_management', to_stage: 'now', to: 'operations_management', n: 250 },
    ],
  }],
};

const files: Record<string, unknown> = { meta, insights, river };
const ok = (body: unknown) => Promise.resolve(new Response(JSON.stringify(body), { status: 200 }));

function mockFetch(overrides: Record<string, () => Promise<Response>> = {}) {
  return vi.spyOn(globalThis, 'fetch').mockImplementation((input) => {
    const name = /data\/(\w+)\.json/.exec(String(input))?.[1] ?? '';
    if (overrides[name]) return overrides[name]();
    return name in files ? ok(files[name]) : Promise.resolve(new Response('missing', { status: 404 }));
  });
}

function renderHome() {
  return render(<RouterProvider><HomeView /></RouterProvider>);
}

const search = () => screen.getByRole('combobox', { name: 'Your program' });

/** Type into the search and click the option whose accessible name matches. */
function pickFromSearch(typed: string, option: RegExp) {
  fireEvent.change(search(), { target: { value: typed } });
  fireEvent.click(within(screen.getByRole('listbox', { name: 'Programs' })).getByRole('option', { name: option }));
}

describe('HomeView', () => {
  beforeEach(() => {
    __resetDataCache();
    window.history.replaceState(null, '', '/');
  });
  afterEach(() => vi.restoreAllMocks());

  it('shows a loading state first', async () => {
    mockFetch();
    renderHome();
    expect(screen.getByRole('status')).toHaveTextContent('Loading Atlas');
    await screen.findByRole('heading', { level: 1 });
  });

  it('shows an error with a working retry', async () => {
    let fail = true;
    mockFetch({ insights: () => (fail ? Promise.reject(new TypeError('Failed to fetch')) : ok(insights)) });
    renderHome();
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Failed to fetch');
    fail = false;
    await act(async () => within(alert).getByRole('button', { name: 'Try again' }).click());
    expect(await screen.findByRole('heading', { level: 1 })).toBeInTheDocument();
  });

  it('asks the question, with the alumni count from meta and a search over every program', async () => {
    mockFetch();
    renderHome();
    expect(await screen.findByRole('heading', { level: 1 })).toHaveTextContent('What are you studying?');
    expect(screen.getByText(`${fmtInt(meta.counts.alumni)} Queen’s alumni, followed job by job`)).toBeInTheDocument();
    expect(search()).toHaveAttribute('placeholder', `Search ${meta.programs.length} programs`);
    expect(search()).toHaveAttribute('aria-expanded', 'false');
    // Nothing picked yet: no links to the River or Twin from the search.
    expect(screen.queryByRole('link', { name: 'See where this class went' })).toBeNull();
    expect(screen.queryByRole('link', { name: 'Where it can take you' })).toBeNull();
    // Floors are an object now; nothing on the page prints one by accident.
    expect(document.body.textContent).not.toMatch(/\[object Object\]|NaN|undefined/);
  });

  it('turns a picked program into the two links, and keeps it in the URL', async () => {
    mockFetch();
    renderHome();
    await screen.findByRole('heading', { level: 1 });

    fireEvent.change(search(), { target: { value: 'comm' } });
    expect(search()).toHaveAttribute('aria-expanded', 'true');
    const list = screen.getByRole('listbox', { name: 'Programs' });
    expect(within(list).getAllByRole('option')).toHaveLength(1);
    expect(within(list).getByRole('option')).toHaveTextContent('Undergraduate');
    fireEvent.click(within(list).getByRole('option', { name: /Commerce/ }));

    expect(search()).toHaveValue('Commerce');
    expect(search()).toHaveAttribute('aria-expanded', 'false');
    const card = screen.getByRole('region', { name: 'Commerce' });
    expect(card).toHaveTextContent(`${fmtInt(900)} grads in the data, classes of 1995–2024`);
    expect(within(card).getByRole('link', { name: /See where this class went/ }))
      .toHaveAttribute('href', '/river?level=undergrad&program=Commerce');
    expect(within(card).getByRole('link', { name: 'Where it can take you' }))
      .toHaveAttribute('href', '/twin?mode=student&level=undergrad&program=Commerce');
    // Share it: the program's share card and link.
    const share = within(card).getByRole('group', { name: 'Share Commerce at Queen’s' });
    expect(within(share).getByRole('link', { name: 'Save image of the Commerce at Queen’s card' }))
      .toHaveAttribute('download', 'atlas-undergrad-commerce.jpg');
    // Where it ranks, from the leaderboards.
    expect(within(card).getByRole('list', { name: 'On the leaderboards' })).toHaveTextContent('1stIn finance & accounting today: 33%');
    expect(window.location.search).toBe('?level=undergrad&program=Commerce');
  });

  it('picks with the keyboard, and shows the level for a name that exists at two levels', async () => {
    mockFetch();
    renderHome();
    await screen.findByRole('heading', { level: 1 });
    const input = search();
    fireEvent.change(input, { target: { value: 'computer science' } });
    const options = within(screen.getByRole('listbox')).getAllByRole('option');
    expect(options.map((o) => o.textContent)).toEqual([
      `Computer ScienceUndergraduate${fmtInt(400)} grads`,
      `Computer ScienceMaster’s & PhD${fmtInt(200)} grads`,
    ]);
    expect(input).toHaveAttribute('aria-activedescendant', options[0].id);
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    expect(input).toHaveAttribute('aria-activedescendant', options[1].id);
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(input).toHaveValue('Computer Science (master’s/PhD)');
    expect(screen.getByRole('link', { name: /See where this class went/ }))
      .toHaveAttribute('href', '/river?level=graduate&program=Computer+Science');

    // Escape closes without changing the pick.
    fireEvent.change(input, { target: { value: 'dra' } });
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(input).toHaveValue('Computer Science (master’s/PhD)');
    expect(input).toHaveAttribute('aria-expanded', 'false');

    // No match: a polite empty row, and Enter does nothing.
    fireEvent.change(input, { target: { value: 'zzz' } });
    expect(screen.getByRole('listbox')).toHaveTextContent('No program matches “zzz”');
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(window.location.search).toBe('?level=graduate&program=Computer+Science');
  });

  it('sends a program too small for a River to its level’s River, and says so', async () => {
    mockFetch();
    renderHome();
    await screen.findByRole('heading', { level: 1 });
    pickFromSearch('law', /Law.*Master’s & PhD/);
    const card = screen.getByRole('region', { name: 'Law' });
    expect(card).toHaveTextContent('too few for a River of its own');
    expect(card).toHaveTextContent('The River shows all master’s and PhD grads instead.');
    expect(within(card).queryByRole('link', { name: /See where this class went/ })).toBeNull();
    expect(within(card).getByRole('link', { name: /See all master’s and PhD grads/ })).toHaveAttribute('href', '/river?level=graduate');
    expect(within(card).getByRole('link', { name: 'Where it can take you' }))
      .toHaveAttribute('href', '/twin?mode=student&level=graduate&program=Law');
    expect(search()).toHaveValue('Law (master’s/PhD)');
  });

  it('offers the largest programs as chips, one per name, that pick on click', async () => {
    mockFetch();
    renderHome();
    await screen.findByRole('heading', { level: 1 });
    const chips = within(screen.getByRole('group', { name: 'Popular' })).getAllByRole('button');
    expect(chips.map((c) => c.textContent)).toEqual(['Commerce', 'LawJD', 'Computer Scienceundergrad', 'Film and Media', 'History']);
    for (const c of chips) expect(c).toHaveAttribute('aria-pressed', 'false');

    fireEvent.click(chips[1]);
    expect(chips[1]).toHaveAttribute('aria-pressed', 'true');
    expect(search()).toHaveValue('Law (JD)');
    expect(screen.getByRole('link', { name: /See where this class went/ })).toHaveAttribute('href', '/river?level=law&program=Law');
    expect(screen.getByRole('link', { name: 'Where it can take you' })).toHaveAttribute('href', '/twin?mode=student&level=law&program=Law');
  });

  it('restores a pick from the URL, and ignores one it doesn’t know', async () => {
    window.history.replaceState(null, '', '/?level=undergrad&program=film%20and%20media');
    mockFetch();
    const { unmount } = renderHome();
    await screen.findByRole('heading', { level: 1 });
    expect(search()).toHaveValue('Film and Media');
    expect(screen.getByRole('link', { name: /See where this class went/ })).toHaveAttribute('href', '/river?level=undergrad&program=Film+and+Media');
    unmount();

    window.history.replaceState(null, '', '/?level=mba&program=Nope');
    renderHome();
    await screen.findByRole('heading', { level: 1 });
    expect(search()).toHaveValue('');
    expect(screen.queryByRole('link', { name: 'Where it can take you' })).toBeNull();
  });

  it('shows three findings, preferring the strongest ones, each with its source and link', async () => {
    mockFetch();
    renderHome();
    await screen.findByRole('heading', { name: 'Some things it found' });
    const cards = screen.getAllByRole('article');
    expect(cards.map((a) => a.id)).toEqual(['fact-top_metro', 'fact-law_stays', 'fact-consulting_exit']);
    const law = screen.getByRole('article', { name: /70% of Law grads still work in law/ });
    expect(within(law).getByRole('link', { name: /See it in the River/ })).toHaveAttribute('href', '/river?level=law&program=Law');
    expect(within(law).getByText(`${SITE.name} · public LinkedIn profiles, Sep 2025`)).toBeInTheDocument();
    // The sticker is backed by the card's own majority.
    expect(within(law).getByText('most lawyers are still lawyers')).toBeInTheDocument();
    expect(screen.getAllByText('most lawyers are still lawyers')).toHaveLength(1);
    // The first card's number is the page's one highlight.
    expect(within(cards[0]).getByText('1 in 4')).toHaveClass('ui-hl');
  });

  it('falls back to other findings, in file order, when the preferred ones are missing', async () => {
    files.insights = {
      ...insights,
      facts: [
        { id: 'a', value: '10%', text: 'Finding a.' }, { id: 'law_stays', value: '40%', text: 'of Law grads stay.' },
        { id: 'b', value: '1 in 50', text: 'Finding b.' }, { id: 'c', value: '5%', text: 'Finding c.' },
      ],
    };
    try {
      mockFetch();
      renderHome();
      await screen.findByRole('heading', { name: 'Some things it found' });
      expect(screen.getAllByRole('article').map((a) => a.id)).toEqual(['fact-law_stays', 'fact-a', 'fact-b']);
      // 40% isn't "most": no sticker.
      expect(screen.queryByText('most lawyers are still lawyers')).toBeNull();
    } finally {
      files.insights = insights;
    }
  });

  it('links the three tools, with hooks from the data', async () => {
    mockFetch();
    renderHome();
    await screen.findByRole('heading', { level: 1 });
    expect(screen.getByRole('link', { name: 'The River' })).toHaveAttribute('href', '/river');
    expect(screen.getByRole('link', { name: 'The Diaspora' })).toHaveAttribute('href', '/diaspora');
    expect(screen.getByRole('link', { name: 'Career Twin' })).toHaveAttribute('href', '/twin');
    expect(screen.getByText(`Where alumni live now: ${meta.counts.metros} metro areas in ${meta.counts.countries} countries.`)).toBeInTheDocument();
  });

  it('labels the same program at two levels apart on the leaderboards', async () => {
    mockFetch();
    renderHome();
    const panel = await screen.findByRole('tabpanel');
    const rows = within(panel).getAllByRole('listitem');
    expect(rows[0]).toHaveTextContent('Computer Science (undergrad)');
    expect(rows[0]).toHaveTextContent('50%');
    expect(rows[0]).toHaveTextContent('200 of 400');
    expect(rows[1]).toHaveTextContent('Computer Science (master’s/PhD)');
  });

  it('drives the leaderboard tabs from the keyboard', async () => {
    mockFetch();
    renderHome();
    const tabs = await screen.findAllByRole('tab');
    expect(tabs.map((t) => t.textContent)).toEqual(['Tech', 'Finance', 'In the US']); // empty ranking dropped
    expect(tabs[0]).toHaveAttribute('aria-selected', 'true');
    expect(tabs[1]).toHaveAttribute('tabindex', '-1');

    tabs[0].focus();
    fireEvent.keyDown(tabs[0], { key: 'ArrowRight' });
    expect(screen.getByRole('tab', { name: 'Finance' })).toHaveFocus();
    expect(screen.getByRole('tabpanel')).toHaveAccessibleName('Finance');
    fireEvent.keyDown(screen.getByRole('tab', { name: 'Finance' }), { key: 'End' });
    expect(screen.getByRole('tab', { name: 'In the US' })).toHaveFocus();
    expect(screen.getByRole('tabpanel')).toHaveTextContent('with a known location');
    fireEvent.keyDown(screen.getByRole('tab', { name: 'In the US' }), { key: 'ArrowRight' });
    expect(screen.getByRole('tab', { name: 'Tech' })).toHaveFocus();
    fireEvent.keyDown(screen.getByRole('tab', { name: 'Tech' }), { key: 'Home' });
    expect(screen.getByRole('tab', { name: 'Tech' })).toHaveAttribute('aria-selected', 'true');
  });

  it('lists first employers, explaining a university at the top from its fact', async () => {
    mockFetch();
    renderHome();
    await screen.findByRole('heading', { level: 1 });
    const first = screen.getByRole('heading', { name: 'First employers' }).parentElement!;
    expect(within(first).getAllByRole('listitem')[0]).toHaveTextContent("Queen's University");
    expect(first).toHaveTextContent("Queen's University: 120 grads started there, mostly in research and teaching roles (55%).");
  });

  it('draws the river card for the classes of 2010–2014, with its story computed from the slice', async () => {
    const fetchMock = mockFetch();
    renderHome();
    await screen.findByRole('heading', { level: 1 });
    expect(await screen.findByText(new RegExp(`${fmtInt(1700)} grads from the classes of 2010–2014`))).toBeInTheDocument();
    expect(fetchMock.mock.calls.some(([u]) => String(u).includes('data/river.json'))).toBe(true);

    const figure = screen.getByRole('figure');
    expect(figure).toHaveAccessibleName(/Careers drift into management\. 9\.1% at the first job.*21% today/);
    expect([...figure.querySelectorAll('.hero-river__mark')].map((m) => m.textContent)).toEqual(['9.1%', '21%']);
    // Share rises at every column (9.1% -> 15% -> 21%): the sticker may say so.
    expect(within(figure).getByText('management keeps growing')).toBeInTheDocument();
    const nodes = [...figure.querySelectorAll('.hero-river__nodes rect')];
    expect(nodes.filter((n) => n.classList.contains('is-hi'))).toHaveLength(3);
    expect(within(figure).getByRole('link', { name: /Open this class in the River/ })).toHaveAttribute('href', '/river?cohort=2010-2014');
    // Columns are named by year, not the old stage names.
    expect(figure.querySelector('.hero-river__stages')).toHaveTextContent(/First job.*Year 5.*Today/);
  });

  it('drops the sticker when the share dips along the way', async () => {
    const dip: RiverFile = {
      ...river,
      slices: [{ ...river.slices[0], totals: { ...river.slices[0].totals, y5: { tech: 700, finance_accounting: 750, operations_management: 60 } } }],
    };
    files.river = dip;
    try {
      mockFetch();
      renderHome();
      await screen.findByRole('heading', { level: 1 });
      expect(await screen.findByText('Careers drift into management.')).toBeInTheDocument();
      expect(screen.queryByText('management keeps growing')).toBeNull();
    } finally {
      files.river = river;
    }
  });

  it('drops the river card quietly if its file fails', async () => {
    mockFetch({ river: () => Promise.resolve(new Response('nope', { status: 500 })) });
    renderHome();
    await screen.findByRole('heading', { level: 1 });
    await waitFor(() => expect(document.querySelector('.hero-river')).toBeNull());
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('hides sections that have no data, but keeps the search and the about strip', async () => {
    files.insights = { ...insights, facts: [], rankings: [], firstEmployers: [] };
    try {
      mockFetch();
      renderHome();
      await screen.findByRole('heading', { level: 1 });
      expect(screen.queryByRole('tablist')).toBeNull();
      expect(screen.queryByRole('heading', { name: 'Some things it found' })).toBeNull();
      expect(screen.queryByRole('heading', { name: 'Which programs lead where' })).toBeNull();
      expect(search()).toBeInTheDocument();
      expect(screen.getByRole('complementary', { name: 'About' })).toBeInTheDocument();
    } finally {
      files.insights = insights;
    }
  });

  it('ends with who made it, the privacy line and the way to the method', async () => {
    mockFetch();
    renderHome();
    await screen.findByRole('heading', { level: 1 });
    const about = screen.getByRole('complementary', { name: 'About' });
    expect(about).toHaveTextContent(`A student project by ${SITE.author.name}.`);
    expect(about).toHaveTextContent(SITE.privacyLine);
    expect(about).toHaveTextContent('Not career advice.');
    expect(within(about).getByRole('link', { name: 'How it was made' })).toHaveAttribute('href', '/method');
    expect(within(about).getByRole('link', { name: 'How privacy works' })).toHaveAttribute('href', '/method#privacy');
  });
});
