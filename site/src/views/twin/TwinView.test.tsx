import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { __resetDataCache } from '../../data/load';
import { RouterProvider } from '../../lib/router';
import { SITE } from '../../site.config';
import { META, TWIN } from './testFixtures';
import TwinView from './TwinView';

// Fixtures are hand-made (testFixtures.ts); these tests never read the real export.

type Reply = { ok: boolean; status: number; json: () => Promise<unknown> };
const ok = (data: unknown): Reply => ({ ok: true, status: 200, json: async () => data });
const fail = (): Reply => ({ ok: false, status: 500, json: async () => ({}) });

function mockFetch(handler: (name: string) => Reply | Promise<Reply>) {
  const fn = vi.fn((url: string) => {
    const name = /data\/(\w+)\.json/.exec(String(url))?.[1] ?? '';
    return Promise.resolve(handler(name));
  });
  vi.stubGlobal('fetch', fn);
  return fn;
}
const serveAll = () => mockFetch((name) => (name === 'twin' ? ok(TWIN) : name === 'meta' ? ok(META) : fail()));

function renderAt(search = '') {
  window.history.replaceState(null, '', `/twin${search}`);
  return render(<RouterProvider><TwinView /></RouterProvider>);
}
const params = () => Object.fromEntries(new URLSearchParams(window.location.search));
const STUDENT = '?level=undergrad&program=Commerce';
const EXACT = '?mode=alum&level=undergrad&program=Commerce&year=2012&first=finance_accounting';
const WIDENED = '?mode=alum&level=undergrad&program=Linguistics&year=2022&first=tech';

const modeRadio = (name: RegExp) => screen.getByRole('radio', { name });

beforeEach(() => {
  __resetDataCache();
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

// ── Page & data states ───────────────────────────────────────────────────────

describe('Career Twin page', () => {
  it('shows the header and a loading state while data loads', () => {
    mockFetch(() => new Promise<Reply>(() => {}));
    renderAt();
    expect(screen.getByText('Career Twin', { selector: '.eyebrow' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1, name: 'Where can your program take you?' })).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent(/Gathering alumni careers/);
  });

  it('shows an error with a working retry', async () => {
    let broken = true;
    mockFetch((name) => (broken && name === 'twin' ? fail() : name === 'twin' ? ok(TWIN) : ok(META)));
    renderAt(STUDENT);
    expect(await screen.findByRole('alert')).toHaveTextContent(/Could not load twin data \(500\)/);
    broken = false;
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('heading', { level: 2, name: '1,000 Commerce grads' })).toBeInTheDocument();
  });
});

// ── Modes and the URL ────────────────────────────────────────────────────────

describe('mode switch', () => {
  it('opens in student mode, with nothing written to the URL', async () => {
    serveAll();
    renderAt();
    const group = await screen.findByRole('group', { name: 'Which are you?' });
    expect(within(group).getAllByRole('radio')).toHaveLength(2);
    expect(modeRadio(/I’m a student/)).toBeChecked();
    expect(modeRadio(/I’m a student/)).toHaveAccessibleDescription('See where your program leads');
    expect(modeRadio(/I’ve graduated/)).not.toBeChecked();
    expect(screen.getByRole('heading', { level: 2, name: 'What do you study?' })).toBeInTheDocument();
    expect(window.location.search).toBe('');
  });

  it('switches to alumni, keeping shared answers and dropping student-only ones, and back', { timeout: 20_000 }, async () => {
    serveAll();
    const user = userEvent.setup();
    renderAt(`${STUDENT}&year=2012&job=finance_accounting&recent=1`);
    await user.click(await screen.findByRole('radio', { name: /I’ve graduated/ }));
    expect(params()).toEqual({ mode: 'alum', level: 'undergrad', program: 'Commerce', year: '2012' });
    expect(screen.getByRole('heading', { level: 2, name: 'Where did you start?' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '1 more to go' })).toBeInTheDocument();

    await user.click(screen.getByRole('radio', { name: 'Finance & accounting' }));
    expect(screen.getByRole('heading', { level: 2, name: 'Your 120 career twins' })).toBeInTheDocument();

    await user.click(screen.getByRole('radio', { name: /I’m a student/ }));
    expect(params()).toEqual({ level: 'undergrad', program: 'Commerce', year: '2012' });
    expect(screen.getByRole('heading', { level: 2, name: '1,000 Commerce grads' })).toBeInTheDocument();
  });

  it('keeps old shared links (with a first job, no mode) on the alumni results', async () => {
    serveAll();
    renderAt('?level=undergrad&program=Commerce&year=2012&first=finance_accounting');
    expect(await screen.findByRole('heading', { level: 2, name: 'Your 120 career twins' })).toBeInTheDocument();
    expect(modeRadio(/I’ve graduated/)).toBeChecked();
  });

  it('ignores bad URL values with a gentle note', async () => {
    serveAll();
    renderAt('?mode=alum&level=wizard&year=abc&first=astronaut');
    const note = await screen.findByRole('note');
    expect(note).toHaveTextContent('“wizard” isn’t a degree level here');
    expect(note).toHaveTextContent('“abc” doesn’t look like a graduation year');
    expect(note).toHaveTextContent('“astronaut” isn’t a first job on the list');
    expect(screen.getByRole('heading', { name: 'Four quick questions, then meet your twins' })).toBeInTheDocument();
  });

  it('notes an unknown first job in the student view and shows all of them instead', async () => {
    serveAll();
    renderAt(`${STUDENT}&job=astronaut`);
    expect(await screen.findByRole('note')).toHaveTextContent('“astronaut” isn’t a first job on the list');
    expect(screen.getByRole('radio', { name: 'All of them' })).toBeChecked();
  });
});

// ── Student view ─────────────────────────────────────────────────────────────

describe('student view', () => {
  it('asks what you study, with examples, before a program is picked', async () => {
    serveAll();
    renderAt();
    expect(await screen.findByRole('heading', { name: 'Pick a degree and a program' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Try Commerce/ })).toBeInTheDocument();
    // Examples for programs this data doesn't have are hidden.
    expect(screen.queryByRole('button', { name: /Psychology/ })).not.toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Program' })).toBeDisabled();
    expect(screen.getByLabelText(/Graduating/)).toHaveAccessibleDescription('Optional. It doesn’t change the numbers.');
  });

  it('picks a program from the form and writes it to the URL', async () => {
    serveAll();
    const user = userEvent.setup();
    renderAt();
    await user.click(await screen.findByRole('radio', { name: 'Undergrad' }));
    expect(screen.getByRole('heading', { name: 'Now pick a program' })).toBeInTheDocument();
    const program = screen.getByRole('combobox', { name: 'Program' });
    await user.click(program);
    await user.type(program, 'comm');
    await user.click(within(screen.getByRole('listbox', { name: 'Programs' })).getByRole('option', { name: /Commerce/ }));
    expect(params()).toEqual({ level: 'undergrad', program: 'Commerce' });
    expect(screen.getByRole('heading', { level: 2, name: '1,000 Commerce grads' })).toBeInTheDocument();
    const live = document.querySelectorAll('[aria-live="polite"][aria-atomic="true"]');
    expect([...live].map((n) => n.textContent).join(' ')).toMatch(/1,000 Commerce grads: 40% started in finance & accounting\. Results are below\./);
  });

  it('a program example fills the form and moves focus to the results heading', async () => {
    serveAll();
    const user = userEvent.setup();
    renderAt();
    await user.click(await screen.findByRole('button', { name: /Try Commerce/ }));
    expect(params()).toEqual({ level: 'undergrad', program: 'Commerce' });
    const heading = screen.getByRole('heading', { level: 2, name: '1,000 Commerce grads' });
    expect(heading).toHaveFocus();
    expect(heading).toHaveAttribute('tabindex', '-1');
  });

  it('shows the program’s headline numbers with their denominators', async () => {
    serveAll();
    renderAt(STUDENT);
    const stats = await screen.findByRole('list', { name: 'Headline numbers' });
    const items = within(stats).getAllByRole('listitem').map((li) => li.textContent);
    expect(items[0]).toBe('40% started in finance & accounting400 of 1,000 grads, first job after graduating');
    expect(items[1]).toMatch(/^41% work in a different field today than their first job330 of 800 grads/);
    expect(items[2]).toMatch(/^1 in 6 live outside Canada today/);
    // The key number sits on a highlight.
    expect(within(stats).getByText('40%').closest('.ui-hl')).not.toBeNull();
  });

  it('ranks the first stops, more school included, and lists all of them on request', async () => {
    serveAll();
    const user = userEvent.setup();
    renderAt(STUDENT);
    const card = await screen.findByRole('region', { name: 'Their first stop after Queen’s' });
    const table = within(card).getByRole('table');
    const names = () => within(table).getAllByRole('rowheader').map((h) => h.textContent);
    expect(names()).toEqual([
      'Finance & accounting', 'Sales & marketing', 'Consulting & strategy', 'Tech', 'More school', 'Operations & management',
      'Founders', 'Smaller fields combined', 'No role listed',
    ]);
    expect(within(table).getByRole('row', { name: /More school/ })).toHaveTextContent('6%60');
    const all = within(card).getByRole('switch', { name: 'Show all 10 first stops' });
    expect(all).toHaveAttribute('aria-controls', 'twin-stop-bars');
    await user.click(all);
    expect(names()).toContain('Service, trades & sport');
    expect(names()).toContain('Teaching');
  });

  it('shows first employers as chips, with a sticker only when the data supports it', async () => {
    serveAll();
    renderAt(STUDENT);
    const card = await screen.findByRole('region', { name: 'Most common first employers' });
    const chips = within(card).getByRole('list', { name: 'Most common first employers' });
    expect(within(chips).getAllByRole('listitem').map((li) => li.textContent)).toEqual(['EY6%', 'Deloitte5%', 'KPMG5%', 'PwC4%', 'RBC2%', 'TD1%']);
    expect(within(card).getByText('the Big Four top the list')).toHaveClass('ui-sticker');
    expect(document.querySelectorAll('.ui-sticker')).toHaveLength(1);
  });

  it('“Recent classes only” switches the first stops and employers to the classes of 2015–2019', async () => {
    serveAll();
    const user = userEvent.setup();
    renderAt(STUDENT);
    const card = await screen.findByRole('region', { name: 'Their first stop after Queen’s' });
    const recent = within(card).getByRole('switch', { name: 'Recent classes only' });
    expect(recent).toHaveAttribute('aria-checked', 'false');
    await user.click(recent);
    expect(params().recent).toBe('1');
    expect(recent).toHaveAttribute('aria-checked', 'true');
    expect(card).toHaveTextContent('as a share of 300 grads from the classes of 2015–2019');
    expect(within(card).getByRole('row', { name: /Finance & accounting/ })).toHaveTextContent('47%140');
    // Four first stops: nothing worth hiding behind "Show all".
    expect(within(card).queryByRole('switch', { name: /Show all/ })).not.toBeInTheDocument();
    const emp = screen.getByRole('region', { name: 'Most common first employers' });
    expect(within(emp).getAllByRole('listitem')[0]).toHaveTextContent('RBC10%');
    expect(within(emp).getByText('the big banks top the list')).toBeInTheDocument();
    // The hero stays on every class, and the paths say why they don't follow.
    expect(screen.getByRole('heading', { level: 2, name: '1,000 Commerce grads' })).toBeInTheDocument();
    expect(screen.getByText('Paths use every class from 1995 to 2024: recent classes haven’t been out long enough.')).toBeInTheDocument();
  });

  it('starts the paths on all of them, then follows a first job you pick', async () => {
    serveAll();
    const user = userEvent.setup();
    renderAt(STUDENT);
    const card = await screen.findByRole('region', { name: 'Pick a first job, see where it leads' });
    const chips = within(card).getByRole('group', { name: 'First job' });
    expect(within(chips).getAllByRole('radio').map((r) => r.getAttribute('value'))).toEqual(['*', 'finance_accounting', 'tech', 'further_study']);
    expect(within(chips).getByRole('radio', { name: 'All of them' })).toBeChecked();
    expect(within(card).getByRole('heading', { level: 4, name: 'All 1,000 Commerce grads' })).toBeInTheDocument();
    expect(within(card).getByRole('group', { name: /Where all 1,000 Commerce grads were, year by year/ })).toBeInTheDocument();

    await user.click(within(chips).getByRole('radio', { name: 'Finance & accounting' }));
    expect(params()).toEqual({ level: 'undergrad', program: 'Commerce', job: 'finance_accounting' });
    expect(within(card).getByRole('heading', { level: 4, name: '400 Commerce grads who started in finance & accounting' })).toBeInTheDocument();
    const stats = within(card).getByRole('list', { name: 'Where it led' });
    expect(stats).toHaveTextContent('56% still in finance & accounting at year 1090 of the 160 people who are 10+ years out');
    expect(stats).toHaveTextContent('39% work in a different field today than their first job150 of 380 people with a job at both points');
    // The readout opens on year 10, with its own denominator.
    expect(within(card).getByText('Year 10')).toBeInTheDocument();
    expect(within(card).getByText('Only the classes 10+ years out.', { exact: false })).toBeInTheDocument();
  });

  it('follows the whole level, and says so, when the program has too few people in a first job', async () => {
    serveAll();
    renderAt(`${STUDENT}&job=tech`);
    const card = await screen.findByRole('region', { name: 'Pick a first job, see where it leads' });
    expect(within(card).getByRole('heading', { level: 4, name: '900 undergrads who started in tech' })).toBeInTheDocument();
    expect(card).toHaveTextContent('Fewer than 20 Commerce grads started in tech, so this follows every undergrad who did, from any program.');
  });

  it('shows no switched-fields number when it is suppressed (more school)', async () => {
    serveAll();
    renderAt(`${STUDENT}&job=further_study`);
    const card = await screen.findByRole('region', { name: 'Pick a first job, see where it leads' });
    const stats = within(card).getByRole('list', { name: 'Where it led' });
    expect(within(stats).getAllByRole('listitem')).toHaveLength(1);
    expect(stats).toHaveTextContent('50% in law at year 5, the most common field');
    expect(card.textContent).not.toMatch(/different field|NaN|undefined|null/);
  });

  it('links to the River only for programs that have one, and to the alumni view', async () => {
    serveAll();
    renderAt(`${STUDENT}&year=2027`);
    expect(await screen.findByRole('link', { name: /Follow Commerce in the River/ })).toHaveAttribute('href', '/river?level=undergrad&program=Commerce');
    expect(screen.getByRole('link', { name: /Find your exact twins/ })).toHaveAttribute('href', '/twin?mode=alum&level=undergrad&program=Commerce&year=2027');
    // Share this program: its card's link and the card itself.
    const share = screen.getByRole('group', { name: 'Share Commerce at Queen’s' });
    expect(within(share).getByRole('button', { name: 'Share Commerce at Queen’s: copy its link' })).toBeInTheDocument();
    expect(within(share).getByRole('link', { name: 'Save image of the Commerce at Queen’s card' })).toHaveAttribute('href', '/share/undergrad-commerce.jpg');
    expect(screen.getByLabelText(/Graduating/)).toHaveAccessibleDescription('The data runs to the class of 2024, so these are the people before you.');
  });

  it('“Find your exact twins” switches to the alumni questions and focuses the first one unanswered', async () => {
    serveAll();
    const user = userEvent.setup();
    renderAt(STUDENT);
    await user.click(await screen.findByRole('link', { name: /Find your exact twins/ }));
    expect(params()).toEqual({ mode: 'alum', level: 'undergrad', program: 'Commerce' });
    expect(modeRadio(/I’ve graduated/)).toBeChecked();
    expect(screen.getByLabelText('Graduation year')).toHaveFocus();
  });

  it('a small program: the small-group note, no River, nothing invented', async () => {
    serveAll();
    renderAt('?level=undergrad&program=Linguistics');
    const hero = await screen.findByRole('article', { name: '34 Linguistics grads' });
    expect(hero).toHaveTextContent('Small group: shares can jump a few points.');
    expect(screen.queryByRole('link', { name: /in the River/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('switch', { name: 'Recent classes only' })).not.toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Most common first employers' })).toHaveTextContent('No single employer was the first job of 10 or more of them.');
    expect(within(screen.getByRole('group', { name: 'First job' })).getAllByRole('radio')).toHaveLength(1);
    expect(screen.getByText('more school tops the list')).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/NaN|undefined|null/);
  });

  it('a big program has no small-group note', async () => {
    serveAll();
    renderAt(STUDENT);
    await screen.findByRole('article', { name: '1,000 Commerce grads' });
    expect(screen.queryByText(/Small group/)).not.toBeInTheDocument();
  });

  it('keeps the privacy copy honest', async () => {
    serveAll();
    renderAt(STUDENT);
    const hero = await screen.findByRole('article', { name: '1,000 Commerce grads' });
    expect(hero).toHaveTextContent('A group, not a person');
    expect(hero).toHaveTextContent(SITE.privacyLine);
    expect(screen.getByText(/Numbers are approximate: every count is nudged slightly to protect privacy\./)).toHaveTextContent(
      'Fields with fewer than 5 people, and employers, titles and places with fewer than 10, aren’t shown.',
    );
  });

  it('copies a link to this view', async () => {
    serveAll();
    const user = userEvent.setup();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    renderAt(`${STUDENT}&job=finance_accounting&utm=x`);
    await user.click(await screen.findByRole('button', { name: 'Copy link to this view' }));
    expect(writeText).toHaveBeenCalledWith(`${window.location.origin}/twin${STUDENT}&job=finance_accounting`);
  });

  it('steps through the years of a path with the keyboard', async () => {
    serveAll();
    const user = userEvent.setup();
    renderAt(`${STUDENT}&job=finance_accounting`);
    const chart = await screen.findByRole('group', { name: /Where 400 Commerce grads who started in finance & accounting were/ });
    act(() => chart.focus());
    const readout = chart.parentElement!.querySelector('.twin-readout')!;
    expect(readout).toHaveTextContent(/^Year 10 · 160 people/);
    await user.keyboard('{ArrowRight}');
    expect(readout).toHaveTextContent(/^Today \(Sep 2025\) · 400 people/);
    await user.keyboard('{Home}');
    expect(readout).toHaveTextContent(/^First destination · 400 people/);
    expect(readout).toHaveTextContent('Finance & accounting100% 400Operations & management0% 0');
    await user.keyboard('{ArrowRight}');
    expect(readout).toHaveTextContent(/^Year 1 · 400 people/);
    expect(within(readout as HTMLElement).getByText(/Year 1, 400 people: Finance & accounting 93%/)).toBeInTheDocument();
  });
});

// ── Alumni view ──────────────────────────────────────────────────────────────

describe('alumni view', () => {
  it('fills the four questions, writing each to the URL, and shows the exact twins', async () => {
    serveAll();
    const user = userEvent.setup();
    renderAt('?mode=alum');
    expect(await screen.findByRole('heading', { name: 'Four quick questions, then meet your twins' })).toBeInTheDocument();
    await user.click(screen.getByRole('radio', { name: 'Undergrad' }));
    expect(screen.getByRole('heading', { name: '3 more to go' })).toBeInTheDocument();
    const program = screen.getByRole('combobox', { name: 'Program' });
    await user.click(program);
    await user.type(program, 'comm{Enter}');
    expect(params().program).toBe('Commerce');
    await user.type(screen.getByLabelText('Graduation year'), '2012');
    expect(screen.getByText('You’re in the class of 2010–2014 group.')).toBeInTheDocument();
    await user.click(screen.getByRole('radio', { name: 'Finance & accounting' }));
    expect(params()).toEqual({ mode: 'alum', level: 'undergrad', program: 'Commerce', year: '2012', first: 'finance_accounting' });
    expect(screen.getByRole('heading', { level: 2, name: 'Your 120 career twins' })).toBeInTheDocument();
    const live = [...document.querySelectorAll('[aria-live="polite"][aria-atomic="true"]')].map((n) => n.textContent).join(' ');
    expect(live).toMatch(/These are the 120 Commerce grads from the classes of 2010–2014 whose first job was in finance & accounting\./);
  });

  it('renders the exact match: stats, year-by-year chart and every section', async () => {
    serveAll();
    renderAt(EXACT);
    const hero = await screen.findByRole('article', { name: 'Your 120 career twins' });
    expect(within(hero).queryByText(/^Widened/)).not.toBeInTheDocument();
    const stats = within(hero).getByRole('list', { name: 'Headline numbers' });
    expect(within(stats).getAllByRole('listitem')).toHaveLength(4);
    expect(stats).toHaveTextContent('53% still work in finance & accounting today64 of 120 twins');
    expect(hero).toHaveTextContent('Career Twin · Sep 2025 snapshot');

    const where = screen.getByRole('region', { name: 'Where they worked, year by year' });
    expect(within(where).getByRole('group', { name: /Where they worked, year by year\. Use the left and right arrow keys/ })).toBeInTheDocument();
    expect(within(where).getByText('most of finance stays put')).toHaveClass('ui-sticker');
    const table = within(where).getByRole('table');
    expect(within(table).getAllByRole('columnheader').map((h) => h.textContent)).toEqual([
      'Field', 'First120', 'Yr 1120', 'Yr 3120', 'Yr 5120', 'Yr 10120', 'Yr 1524', 'Today120',
    ]);
    expect(within(table).getByRole('row', { name: /^Finance & accounting/ })).toHaveTextContent('100%92%83%68%55%63%53%');
    expect(within(table).getByRole('row', { name: /^Consulting/ })).toHaveTextContent('fewer than 5');
    expect(where).toHaveTextContent('Each year counts only the people who had reached it: year 15 is the 24 who graduated at least 15 years before the snapshot.');
    expect(where).toHaveTextContent('Years 2, 7 and 20 aren’t shown');

    expect(screen.getByRole('region', { name: 'How senior they are today' })).toBeInTheDocument();
    expect(within(screen.getByRole('region', { name: 'How fast they became managers' })).getByText('90 of 120')).toBeInTheDocument();
    // Only first employers are published: a half-width card with its own title.
    const emp = screen.getByRole('region', { name: 'Most common first employers' });
    expect(emp).not.toHaveClass('twin-sec--wide');
    expect(within(emp).getByText('the Big Four top the list')).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Most common job titles today' })).not.toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Where they live now' })).toHaveTextContent(/1 in 5\s*live outside Canada/);
    expect(document.querySelectorAll('.ui-sticker')).toHaveLength(2);
    expect(screen.getByRole('link', { name: /Follow Commerce in the River/ })).toHaveAttribute('href', '/river?level=undergrad&program=Commerce');
    expect(document.body.textContent).not.toMatch(/famil/i);
  });

  it('calls a widened match “alumni close to your start”, never twins, with a specific badge and the small-group note', async () => {
    serveAll();
    renderAt(WIDENED);
    const hero = await screen.findByRole('article', { name: '34 alumni close to your start' });
    expect(screen.queryByRole('heading', { name: /career twins/ })).not.toBeInTheDocument();
    expect(within(hero).getByText('Widened: all classes, any first job')).toHaveClass('twin-badge');
    expect(hero).toHaveTextContent('Fewer than 20 alumni matched every answer, so this widens to all 34 Linguistics grads, from any class and first job.');
    expect(hero).toHaveTextContent('A group, not a person: these are 34 real alumni');
    expect(hero).toHaveTextContent('Small group: shares can jump a few points.');
    expect(hero.textContent).not.toMatch(/twins/);
    // Null pivoted and located: no stat, no section, nothing invented.
    expect(within(hero).getByRole('list', { name: 'Headline numbers' })).not.toHaveTextContent(/different field|outside Canada/);
    expect(screen.queryByRole('region', { name: 'Where they live now' })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: /See all undergrads in the River/ })).toHaveAttribute('href', '/river?level=undergrad');
    expect(screen.getByText(/Linguistics has no River of its own\./)).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/NaN|undefined|null/);
  });

  it.each([
    ['1994', '1,000', 'Your 1,000 career twins', true],
    ['1995', '90', 'Your 90 career twins', false],
    ['1999', '90', 'Your 90 career twins', false],
    ['2000', '110', 'Your 110 career twins', false],
    ['2024', '500', 'Your 500 career twins', false],
    ['2025', '1,000', 'Your 1,000 career twins', true],
  ])('class of %s matches its five-year group (%s people)', async (year, _n, heading, outOfRange) => {
    serveAll();
    renderAt(`?mode=alum&level=undergrad&program=Commerce&year=${year}&first=any`);
    expect(await screen.findByRole('heading', { level: 2, name: heading })).toBeInTheDocument();
    if (outOfRange) expect(screen.getByRole('note')).toHaveTextContent(`so for ${year} every class counts`);
    else expect(screen.queryByRole('note')).not.toBeInTheDocument();
  });

  it('widens to the class band’s neighbours honestly: a 2016 finance start uses every class', async () => {
    serveAll();
    renderAt('?mode=alum&level=undergrad&program=Commerce&year=2016&first=finance_accounting');
    expect(await screen.findByRole('heading', { level: 2, name: '400 alumni close to your start' })).toBeInTheDocument();
    expect(screen.getByText('Widened: all classes')).toBeInTheDocument();
  });

  it('an example fills every answer and moves focus to the results heading', async () => {
    serveAll();
    const user = userEvent.setup();
    renderAt('?mode=alum');
    await user.click(await screen.findByRole('button', { name: /Try Commerce · 2012 · Finance/ }));
    expect(params()).toEqual({ mode: 'alum', level: 'undergrad', program: 'Commerce', year: '2012', first: 'finance_accounting' });
    expect(screen.getByRole('heading', { level: 2, name: 'Your 120 career twins' })).toHaveFocus();
  });

  it('starts over and moves focus to the first Degree option', async () => {
    serveAll();
    const user = userEvent.setup();
    renderAt(EXACT);
    await user.click(await screen.findByRole('button', { name: 'Start over' }));
    await waitFor(() => expect(params()).toEqual({ mode: 'alum' }));
    expect(screen.getByRole('heading', { name: 'Four quick questions, then meet your twins' })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'Undergrad' })).toHaveFocus();
  });

  it('auto-selects the only program for single-program levels and clears stale programs', async () => {
    serveAll();
    const user = userEvent.setup();
    renderAt('?mode=alum&level=undergrad&program=Linguistics');
    await user.click(await screen.findByRole('radio', { name: 'MBA' }));
    expect(params()).toEqual({ mode: 'alum', level: 'mba', program: 'MBA' });
    expect(screen.getByRole('combobox', { name: 'Program' })).toHaveValue('MBA');
    await user.click(screen.getByRole('radio', { name: 'Undergrad' }));
    expect(params()).toEqual({ mode: 'alum', level: 'undergrad' });
  });

  it('copies a link to these results', async () => {
    serveAll();
    const user = userEvent.setup();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    renderAt(EXACT);
    await user.click(await screen.findByRole('button', { name: 'Copy link to these results' }));
    expect(writeText).toHaveBeenCalledWith(`${window.location.origin}/twin${EXACT}`);
    expect(await screen.findByText(/^Link copied/)).toBeInTheDocument();
  });
});
