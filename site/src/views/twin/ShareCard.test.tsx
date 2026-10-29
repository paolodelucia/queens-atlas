import { render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { __resetDataCache } from '../../data/load';
import { RouterProvider } from '../../lib/router';
import { ShareCard } from './ShareCard';
import { shareEntries } from './share';
import { LINGUISTICS, META, TWIN } from './testFixtures';
import TwinView from './TwinView';

const ok = (data: unknown) => ({ ok: true, status: 200, json: async () => data });
beforeEach(() => {
  __resetDataCache();
  vi.stubGlobal('fetch', vi.fn((url: string) => {
    const name = /data\/(\w+)\.json/.exec(String(url))?.[1];
    return Promise.resolve(name === 'twin' ? ok(TWIN) : ok(META));
  }));
});
afterEach(() => {
  vi.unstubAllGlobals();
});

const texts = (list: HTMLElement) => within(list).getAllByRole('listitem').map((li) => li.textContent);

/** The student hero's numbers, as the Twin page renders them. */
async function heroStats(level: string, program: string) {
  window.history.replaceState(null, '', `/twin?level=${level}&program=${encodeURIComponent(program)}`);
  const view = render(<RouterProvider><TwinView /></RouterProvider>);
  const hero = await screen.findByRole('article', { name: /grads$/ });
  const out = texts(within(hero).getByRole('list', { name: 'Headline numbers' }));
  view.unmount();
  return out;
}

describe('ShareCard', () => {
  const entries = shareEntries(TWIN, META);

  it.each(entries.map((e) => [e.slug, e] as const))('%s shows exactly the Twin hero’s numbers', async (_slug, entry) => {
    const expected = await heroStats(entry.level, entry.program);
    render(<ShareCard entry={entry} classes="Classes of 1995–2024" snapshot="Sep 2025" />);
    const card = screen.getByRole('article', { name: entry.title });
    expect(texts(within(card).getByRole('list', { name: 'Headline numbers' }))).toEqual(expected);
    expect(expected.length).toBe(entry.hero.stats.length);
  });

  it('names the program, its size and classes, and the privacy line; no placeholders for missing numbers', () => {
    const entry = entries.find((e) => e.program === LINGUISTICS.program)!;
    render(<ShareCard entry={entry} classes="Classes of 1995–2024" snapshot="Sep 2025" />);
    const card = screen.getByRole('article', { name: 'Linguistics at Queen’s' });
    expect(within(card).getByRole('heading', { level: 1 })).toHaveTextContent('Linguistics at Queen’s');
    expect(card).toHaveTextContent('34 grads · classes of 1995–2024');
    expect(card).toHaveTextContent('Small group: shares can jump a few points.');
    expect(card).toHaveTextContent('Groups only. Numbers lightly nudged. Not affiliated with Queen’s.');
    expect(within(card).getAllByRole('listitem')).toHaveLength(1);
    expect(card.textContent).not.toMatch(/—|NaN|undefined|null/);
  });

  it('shows the level pill only for a name at several levels', () => {
    const commerce = entries.find((e) => e.program === 'Commerce')!;
    const { unmount } = render(<ShareCard entry={commerce} classes="Classes of 1995–2024" snapshot="Sep 2025" />);
    expect(screen.queryByText('Undergraduate')).not.toBeInTheDocument();
    unmount();
    render(<ShareCard entry={{ ...commerce, levelPill: 'Undergraduate' }} classes="Classes of 1995–2024" snapshot="Sep 2025" />);
    expect(screen.getByText('Undergraduate')).toBeInTheDocument();
  });
});
