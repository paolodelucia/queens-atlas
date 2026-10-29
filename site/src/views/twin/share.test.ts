import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Meta, TwinFile, TwinGroup } from '../../data/types';
import { buildIndex, programHero } from './model';
import type { Level } from './model';
import {
  ambiguousNames, cardFileName, cardImagePath, programSlug, programTitle, shareEntries, sharePagePath, slugify, statSentences,
} from './share';
import { COMMERCE, LINGUISTICS, META, TWIN, blank, pt } from './testFixtures';

describe('slugify', () => {
  it.each([
    ['Commerce', 'commerce'],
    ['Computer Science', 'computer-science'],
    ['Engineering (unspecified)', 'engineering-unspecified'],
    ['Languages, Literatures and Cultures', 'languages-literatures-and-cultures'],
    ['Arts & Science', 'arts-and-science'],
    ['Études françaises', 'etudes-francaises'],
    ['Women’s Studies', 'womens-studies'],
    ["Master's of Art", 'masters-of-art'],
    ['  --Physics--  ', 'physics'],
    ['MBA', 'mba'],
  ])('%s -> %s', (name, slug) => expect(slugify(name)).toBe(slug));
});

describe('programSlug', () => {
  it('prefixes the level, so a name at two levels gets two slugs', () => {
    expect(programSlug('undergrad', 'Commerce')).toBe('undergrad-commerce');
    expect(programSlug('undergrad', 'Computer Science')).toBe('undergrad-computer-science');
    expect(programSlug('graduate', 'Computer Science')).toBe('graduate-computer-science');
    expect(programSlug('graduate', 'Law')).toBe('graduate-law');
  });
  it('uses just the level when the program is named after it', () => {
    expect(programSlug('law', 'Law')).toBe('law');
    expect(programSlug('mba', 'MBA')).toBe('mba');
    expect(programSlug('medicine', 'Medicine')).toBe('medicine');
  });
  it('never returns an empty slug', () => {
    expect(programSlug('undergrad', '???')).toBe('undergrad-program');
  });
  it('builds the share paths from the slug', () => {
    expect(sharePagePath('undergrad-commerce')).toBe('/p/undergrad-commerce/');
    expect(cardImagePath('undergrad-commerce')).toBe('/share/undergrad-commerce.jpg');
    expect(cardFileName('law')).toBe('atlas-law.jpg');
  });
});

describe('titles', () => {
  it('names the level only when the name exists at several levels', () => {
    const amb = ambiguousNames([
      { level: 'undergrad', program: 'Computer Science' }, { level: 'graduate', program: 'Computer Science' },
      { level: 'undergrad', program: 'Commerce' },
    ]);
    expect([...amb]).toEqual(['computer science']);
    expect(programTitle('graduate', 'Computer Science', true)).toBe('Computer Science (master’s & PhD) at Queen’s');
    expect(programTitle('law', 'Law', true)).toBe('Law (JD) at Queen’s');
    expect(programTitle('undergrad', 'Commerce', false)).toBe('Commerce at Queen’s');
  });
  it('turns the hero’s stats into sentences, naming who in the first', () => {
    const stats = programHero(buildIndex(TWIN.groups), 'undergrad', 'Commerce')!.stats;
    expect(statSentences('Commerce grads', stats)).toEqual([
      '40% of Commerce grads started in finance & accounting.',
      '41% work in a different field today than their first job.',
      '1 in 6 live outside Canada today.',
    ]);
  });
});

describe('shareEntries', () => {
  it('has one entry per published program group, largest first, built from the hero', () => {
    const entries = shareEntries(TWIN, META);
    expect(entries.map((e) => e.slug)).toEqual(['undergrad-commerce', 'mba', 'undergrad-linguistics']);
    const commerce = entries[0];
    expect(commerce).toMatchObject({
      level: 'undergrad', program: 'Commerce', levelPill: null, title: 'Commerce at Queen’s',
      ogTitle: 'Commerce at Queen’s: where 1,000 grads went',
      href: '/twin?level=undergrad&program=Commerce',
    });
    expect(commerce.hero).toEqual(programHero(buildIndex(TWIN.groups), 'undergrad', 'Commerce'));
    expect(commerce.description).toBe(
      '40% of Commerce grads started in finance & accounting. 41% work in a different field today than their first job. '
      + '1 in 6 live outside Canada today. Groups only, from public LinkedIn profiles (Sep 2025).',
    );
    // A small program with suppressed numbers: they are simply absent.
    expect(entries[2].hero.stats.map((s) => s.id)).toEqual(['first']);
    expect(entries[2].description).toBe('18% of Linguistics grads went straight on to more school. Groups only, from public LinkedIn profiles (Sep 2025).');
  });
  it('adds a level pill for a name at several levels', () => {
    const grad: TwinGroup = { ...LINGUISTICS, level: 'graduate', n: 25 };
    const entries = shareEntries({ groups: [COMMERCE, LINGUISTICS, grad] }, META);
    expect(entries.find((e) => e.slug === 'graduate-linguistics')).toMatchObject({ levelPill: 'Master’s & PhD', title: 'Linguistics (master’s & PhD) at Queen’s' });
    expect(entries.find((e) => e.slug === 'undergrad-linguistics')!.levelPill).toBe('Undergraduate');
  });
  it('refuses two programs that would share a slug', () => {
    const a: TwinGroup = { ...blank, level: 'undergrad', program: 'Arts & Science', cohort: '*', s0: '*', n: 40, years: [pt(0, 40, [['tech', 20]])] };
    const b: TwinGroup = { ...a, program: 'Arts and Science', n: 30 };
    expect(() => shareEntries({ groups: [a, b] }, META)).toThrow(/would both be \/p\/undergrad-arts-and-science\//);
  });
});

// ── The committed cards (public/share) against the published data (public/data) ──────────────

const root = resolve(__dirname, '../../..');
const manifestFile = resolve(root, 'public/share/index.json');
const read = <T,>(p: string): T => JSON.parse(readFileSync(resolve(root, p), 'utf8')) as T;
const hasAll = existsSync(manifestFile) && existsSync(resolve(root, 'public/data/twin.json')) && existsSync(resolve(root, 'public/data/meta.json'));

describe.skipIf(!hasAll)('public/share (committed cards) matches public/data', () => {
  it('has a card for every program the hero can show, with the hero’s exact numbers', () => {
    const twin = read<TwinFile>('public/data/twin.json');
    const meta = read<Meta>('public/data/meta.json');
    const manifest = read<{ cards: { slug: string; level: Level; program: string; image: string; stats: string[] }[] }>('public/share/index.json');
    const entries = shareEntries(twin, meta);
    expect(manifest.cards.map((c) => c.slug)).toEqual(entries.map((e) => e.slug));
    const index = buildIndex(twin.groups);
    for (const c of manifest.cards) {
      const hero = programHero(index, c.level, c.program)!;
      // Stale cards fail here: run `npm run cards` after the data changes.
      expect(c.stats, c.slug).toEqual(hero.stats.map((s) => `${s.value} ${s.text} (${s.detail})`));
      expect(existsSync(resolve(root, `public${c.image}`)), c.image).toBe(true);
    }
    for (const p of meta.programs) expect(manifest.cards.some((c) => c.level === p.level && c.program === p.program), `${p.level} ${p.program}`).toBe(true);
  });
});
