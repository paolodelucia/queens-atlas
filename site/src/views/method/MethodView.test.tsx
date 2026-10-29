import { act, render, screen, within } from '@testing-library/react';
import { __resetDataCache } from '../../data/load';
import type { InsightsFile, Meta } from '../../data/types';
import { fmtInt } from '../../lib/format';
import { RouterProvider } from '../../lib/router';
import { SITE } from '../../site.config';
import MethodView from './MethodView';

// Made-up numbers: the tests check what the page does with the data, not the data.
const meta: Meta = {
  generated: '2026-01-01', snapshot: '2025-09', k: { field: 6, named: 12 },
  counts: { profiles: 5000, alumni: 4321, roles: 20000, employers: 120, countries: 12, metros: 34, paths: 3000, firstYear: 1995, lastYear: 2024 },
  programs: [],
  cohorts: [
    { id: '1995-1999', label: 'Class of 1995–1999', from: 1995, to: 1999 },
    { id: '2000-2004', label: 'Class of 2000–2004', from: 2000, to: 2004 },
    { id: '2005-2009', label: 'Class of 2005–2009', from: 2005, to: 2009 },
    { id: '2010-2014', label: 'Class of 2010–2014', from: 2010, to: 2014 },
    { id: '2015-2019', label: 'Class of 2015–2019', from: 2015, to: 2019 },
    { id: '2020-2024', label: 'Class of 2020–2024', from: 2020, to: 2024 },
    { id: 'all', label: 'Classes of 1995–2024', from: 1995, to: 2024 },
  ],
};

const insights: InsightsFile = {
  firstEmployers: [], topEmployers: [], rankings: [], facts: [],
  snapshot: {
    currentRolesSample: 1234,
    currentRolesImplying: [
      { month: '2025-09', pct: 70.5 }, { month: '2025-08', pct: 20 }, { month: '2025-07', pct: 5 }, { month: '2025-06', pct: 2 },
    ],
    newestActivity: '2025-09-28T10:15Z',
    exportFileTimestamp: '2025-09-30T02:26Z',
    asOf: '2025-09-30',
  },
  labelling: { titles: 1000, employers: 300, fields: 200, places: 100, costUsd: 4.8, model: 'Claude Sonnet 5.5' },
};

const files: Record<string, unknown> = { meta, insights };
const ok = (body: unknown) => Promise.resolve(new Response(JSON.stringify(body), { status: 200 }));

function mockFetch(overrides: Record<string, () => Promise<Response>> = {}) {
  return vi.spyOn(globalThis, 'fetch').mockImplementation((input) => {
    const name = /data\/(\w+)\.json/.exec(String(input))?.[1] ?? '';
    if (overrides[name]) return overrides[name]();
    return name in files ? ok(files[name]) : Promise.resolve(new Response('missing', { status: 404 }));
  });
}

const renderMethod = () => render(<RouterProvider><MethodView /></RouterProvider>);
const section = (id: string) => document.getElementById(id)!;

describe('MethodView', () => {
  beforeEach(() => {
    __resetDataCache();
    window.history.replaceState(null, '', '/method');
  });
  afterEach(() => vi.restoreAllMocks());

  it('shows a loading state first', async () => {
    mockFetch();
    renderMethod();
    expect(screen.getByRole('status')).toHaveTextContent('Loading the method');
    await screen.findByRole('heading', { level: 1, name: 'How Atlas was made' });
  });

  it('shows an error with a working retry', async () => {
    let fail = true;
    mockFetch({ meta: () => (fail ? Promise.resolve(new Response('x', { status: 503 })) : ok(meta)) });
    renderMethod();
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Could not load meta data (503)');
    fail = false;
    await act(async () => within(alert).getByRole('button', { name: 'Try again' }).click());
    expect(await screen.findByRole('heading', { level: 1 })).toBeInTheDocument();
  });

  it('renders seven sections with a table of contents, and the anchors the footer links to', async () => {
    mockFetch();
    renderMethod();
    await screen.findByRole('heading', { level: 1 });
    const toc = screen.getByRole('navigation', { name: 'On this page' });
    const links = within(toc).getAllByRole('link');
    expect(links).toHaveLength(7);
    for (const a of links) expect(document.getElementById(a.getAttribute('href')!.slice(1))).not.toBeNull();
    for (const name of ['The data', 'Dating the snapshot', 'Teaching a model to read job titles', 'From jobs to careers',
      'Privacy', 'Where the numbers bend', 'Credits']) {
      expect(screen.getByRole('heading', { level: 2, name })).toBeInTheDocument();
    }
    // The footer's "About the data" and "Privacy" links land here.
    expect(section('data').tagName).toBe('SECTION');
    expect(section('privacy').tagName).toBe('SECTION');
    expect(section('privacy')).toHaveAccessibleName('Privacy');
    expect(document.getElementById('noise')).not.toBeNull();
  });

  it('describes the source honestly, with the opt-out', async () => {
    mockFetch();
    renderMethod();
    await screen.findByRole('heading', { level: 1 });
    const data = section('data');
    expect(data).toHaveTextContent(
      'A third-party dataset of public LinkedIn profiles of people who list Queen’s University, compiled by a commercial '
      + 'data provider in September 2025. I didn’t scrape LinkedIn myself and don’t redistribute the raw data');
    expect(data).toHaveTextContent('Want your profile excluded? Email');
    expect(within(data).getAllByRole('link', { name: SITE.contactEmail })[0]).toHaveAttribute('href', `mailto:${SITE.contactEmail}`);
  });

  it('uses the numbers from meta and insights', async () => {
    mockFetch();
    renderMethod();
    await screen.findByRole('heading', { level: 1 });
    expect(screen.getByText('30 Sep 2025')).toBeInTheDocument();
    expect(screen.getAllByText(fmtInt(meta.counts.profiles)).length).toBeGreaterThan(0);
    // Key fact: titles + employers only, so the number matches its label.
    const l = insights.labelling;
    expect(screen.getByText('titles and employers labelled').previousElementSibling).toHaveTextContent(fmtInt(l.titles + l.employers));
    const strings = l.titles + l.employers + l.fields + l.places;
    expect(screen.getByText(new RegExp(`One model pass read ${fmtInt(strings)} strings`))).toBeInTheDocument();
    for (const v of [l.titles, l.employers, l.fields, l.places]) expect(screen.getByText(fmtInt(v))).toBeInTheDocument();
    expect(screen.getAllByText(/\$4\.80/).length).toBeGreaterThan(0);
    expect(screen.getByText(/about \$3\.00 per thousand strings/)).toBeInTheDocument();
    expect(section('data')).toHaveTextContent(`${fmtInt(meta.counts.paths)} career paths`);
  });

  it('renders the floors from meta.k as two numbers, never as an object', async () => {
    mockFetch();
    renderMethod();
    await screen.findByRole('heading', { level: 1 });
    expect(document.body.textContent).not.toMatch(/\[object Object\]|NaN|undefined/);
    // Header key fact: both floors.
    expect(screen.getByText('smallest group shown').previousElementSibling).toHaveTextContent('6 / 12');
    expect(screen.getByText('12 when it names an employer, job or place')).toBeInTheDocument();
    // Privacy: one card per floor.
    const privacy = section('privacy');
    expect(within(privacy).getByText('6+')).toBeInTheDocument();
    expect(within(privacy).getByText('12+')).toBeInTheDocument();
    // The fold illustration uses the career-field floor.
    expect(within(privacy).getByText(/Any career field under 6 people is folded/)).toBeInTheDocument();
  });

  it('reads an older single-number k as both floors', async () => {
    files.meta = { ...meta, k: 10 as unknown as Meta['k'] };
    try {
      mockFetch();
      renderMethod();
      await screen.findByRole('heading', { level: 1 });
      expect(screen.getByText('smallest group shown').previousElementSibling).toHaveTextContent('10 / 10');
      expect(document.body.textContent).not.toMatch(/\[object Object\]/);
    } finally {
      files.meta = meta;
    }
  });

  it('states both privacy floors, the minimum sizes and the published files', async () => {
    mockFetch();
    renderMethod();
    await screen.findByRole('heading', { level: 1 });
    const privacy = section('privacy');
    expect(privacy).toHaveTextContent(SITE.privacyLine);
    expect(privacy).toHaveTextContent('people for any count by career field');
    expect(privacy).toHaveTextContent('Groups under 6 are hidden');
    expect(privacy).toHaveTextContent('people for anything that names an employer, a job title or a place');
    expect(privacy).toHaveTextContent('Groups under 12 are hidden');
    expect(privacy).toHaveTextContent('named only when at least 12 people share it');
    expect(privacy).toHaveTextContent(
      'A River class needs 30 people, a Career Twin group 20, a Diaspora filter 50, a point on a year-by-year chart 10 members');
    for (const f of ['meta', 'insights', 'river', 'diaspora', 'twin']) {
      expect(within(privacy).getByRole('link', { name: `${f}.json` })).toHaveAttribute('href', `/data/${f}.json`);
    }
  });

  it('explains the noise, and makes no absolute claims the noise would contradict', async () => {
    mockFetch();
    renderMethod();
    await screen.findByRole('heading', { level: 1 });
    const privacy = section('privacy');
    expect(within(privacy).getByRole('heading', { level: 3, name: 'Why numbers don’t add up exactly' })).toBeInTheDocument();
    expect(privacy).toHaveTextContent(/differencing attack/);
    expect(privacy).toHaveTextContent(/between −2 and \+2/);
    expect(privacy).toHaveTextContent(/same set of people always gets the same nudge, in every file/);
    // The odds: 40% exact, 20% each way by one, 10% each way by two.
    const odds = within(privacy).getByRole('list', { name: /How often a published count is moved/ });
    expect(within(odds).getAllByRole('listitem').map((li) => li.textContent)).toEqual([
      '10%moved by −2', '20%moved by −1', '40%moved by 0', '20%moved by +1', '10%moved by +2',
    ]);
    expect(privacy).toHaveTextContent('40% are published exactly, 40% move by one person, 20% by two. A count never moves below its floor.');
    // The worked example: exact counts leak a small group; perturbed ones only bound it.
    expect(privacy).toHaveTextContent(/A group of 7, too small to publish, recovered exactly/);
    expect(privacy).toHaveTextContent(/anywhere from 5 to 13/);
    const page = document.body.textContent ?? '';
    for (const claim of [/never zero/i, /narrow down to one person/i, /counts at least/i]) expect(page).not.toMatch(claim);
    expect(section('stack')).toHaveTextContent('Statistical disclosure control: cell-key perturbation (as used by the Australian Bureau of Statistics)');
  });

  it('explains year-by-year careers and which River columns each class gets', async () => {
    mockFetch();
    renderMethod();
    await screen.findByRole('heading', { level: 1 });
    const careers = section('careers');
    expect(within(careers).getByRole('img', { name: /each June from year 1 to year 20, and today \(September 2025\)/ })).toBeInTheDocument();
    expect(careers).toHaveTextContent('First job (year 0)');
    expect(careers).toHaveTextContent('Year 1 to year 20');
    expect(careers).toHaveTextContent('five-year classes, 1995–1999 to 2020–2024');
    expect(careers).toHaveTextContent('Career Twin keeps years 0, 1, 2, 3, 5, 7, 10, 15, 20 and today');

    const table = within(careers).getByRole('table');
    const row = (label: string) => within(table).getByRole('row', { name: new RegExp(`^${label}`) });
    const marks = (label: string) => within(row(label)).getAllByRole('cell').map((c) => c.textContent);
    expect(within(table).getAllByRole('columnheader').map((h) => h.textContent))
      .toEqual(['Class', 'First job', 'Year 3', 'Year 5', 'Year 10', 'Year 20', 'Today']);
    expect(marks('1995–1999')).toEqual(['yes', 'yes', 'yes', 'yes', 'yes', 'yes']);
    expect(marks('2010–2014')).toEqual(['yes', 'yes', 'yes', 'yes', 'not yet', 'yes']);
    expect(marks('2015–2019')).toEqual(['yes', 'yes', 'yes', 'not yet', 'not yet', 'yes']);
    expect(marks('2020–2024')).toEqual(['yes', 'not yet', 'not yet', 'not yet', 'not yet', 'yes']);
    expect(marks('All, 1995–2024')).toEqual(['yes', 'not yet', 'not yet', 'not yet', 'not yet', 'yes']);
  });

  it('tells the dating story with live decodes, and a sticker only for a clear majority', async () => {
    mockFetch();
    const { unmount } = renderMethod();
    await screen.findByRole('heading', { level: 1 });
    const chart = screen.getByRole('list', { name: /Share of current roles/ });
    const rows = within(chart).getAllByRole('listitem');
    expect(rows[0]).toHaveTextContent('September 2025');
    expect(rows[0]).toHaveTextContent('70.5%');
    expect(rows).toHaveLength(4);
    expect(screen.getByText('most say september')).toBeInTheDocument();
    expect(screen.getByRole('group', { name: /Jan 2025 plus 9 months minus one equals Sep 2025/ })).toBeInTheDocument();
    expect(screen.getByLabelText('Decoding a LinkedIn activity ID')).toHaveTextContent('= 2025-09-28 10:15 UTC');
    expect(screen.getByLabelText('Decoding the export file name')).toHaveTextContent('parseInt("mg5xrzjc", 36)');
    expect(screen.getByRole('img', { name: /Timeline of Sep 2025/ })).toHaveAccessibleName(/as-of date Sep 30, 2025/);
    unmount();

    files.insights = { ...insights, snapshot: { ...insights.snapshot, currentRolesImplying: [{ month: '2025-09', pct: 45 }, { month: '2025-08', pct: 40 }] } };
    try {
      __resetDataCache();
      renderMethod();
      await screen.findByRole('heading', { level: 1 });
      expect(screen.queryByText(/^most say/)).toBeNull();
    } finally {
      files.insights = insights;
    }
  });

  it('says it is not career advice', async () => {
    mockFetch();
    renderMethod();
    await screen.findByRole('heading', { level: 1 });
    const limits = section('limits');
    expect(within(limits).getByRole('heading', { level: 3, name: 'Not career advice' })).toBeInTheDocument();
    expect(limits).toHaveTextContent('It isn’t a prediction, and it isn’t career advice.');
  });

  it('credits the author, the type and the tools, in the first person and without old fonts', async () => {
    mockFetch();
    renderMethod();
    await screen.findByRole('heading', { level: 1 });
    const stack = section('stack');
    expect(within(stack).getByRole('link', { name: SITE.author.name })).toHaveAttribute('href', SITE.author.url);
    expect(stack).toHaveTextContent('Bricolage Grotesque');
    expect(stack).toHaveTextContent(/Python and DuckDB.*React and D3/);
    expect(stack).toHaveTextContent('Job titles labelled with Claude Sonnet 5.5');
    expect(stack).toHaveTextContent('Not affiliated with or endorsed by Queen’s University or LinkedIn.');
    const page = document.body.textContent ?? '';
    expect(page).not.toMatch(/\bInter\b|Fraunces/);
    expect(page).not.toMatch(/\bwe\b|\bour\b/i);
    expect(page).not.toMatch(/Queen’s Career Atlas/);
  });

  it('credits the author only when one is configured', async () => {
    const author = SITE.author as { name: string; url: string };
    const saved = { ...author };
    try {
      author.name = '';
      mockFetch();
      const { unmount } = renderMethod();
      await screen.findByRole('heading', { level: 1 });
      expect(screen.queryByText('Made by')).toBeNull();
      unmount();

      author.name = 'Jane Doe';
      author.url = 'https://example.com/jane';
      __resetDataCache();
      renderMethod();
      await screen.findByRole('heading', { level: 1 });
      expect(within(section('stack')).getByRole('link', { name: 'Jane Doe' })).toHaveAttribute('href', 'https://example.com/jane');
    } finally {
      Object.assign(author, saved);
    }
  });

  it('still renders when the snapshot evidence is missing', async () => {
    files.insights = {
      ...insights,
      snapshot: { currentRolesImplying: [], currentRolesSample: 0, newestActivity: '', exportFileTimestamp: '', asOf: '' },
    };
    try {
      mockFetch();
      renderMethod();
      await screen.findByRole('heading', { level: 1 });
      expect(screen.queryByRole('list', { name: /Share of current roles/ })).toBeNull();
      expect(screen.queryByLabelText('Decoding a LinkedIn activity ID')).toBeNull();
      expect(screen.queryByRole('img', { name: /Timeline/ })).toBeNull();
      expect(screen.getByRole('heading', { level: 2, name: 'Dating the snapshot' })).toBeInTheDocument();
    } finally {
      files.insights = insights;
    }
  });
});
