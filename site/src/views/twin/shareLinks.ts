/**
 * Share links for programs, with no dependencies beyond the level labels: slugs, the share page and
 * card image paths, and the titles. Home's picked-program card and the Twin view import this (via
 * ShareProgram) without pulling in the Twin model; share.ts builds the full card entries on top.
 *
 *   slug          undergrad-commerce, graduate-computer-science, law, mba, medicine
 *   card image    /share/<slug>.jpg (1200x630)
 *   share page    /p/<slug>/  (its own title and preview, then straight on to /twin)
 */
import type { LevelId } from '../../data/types';

type Level = Exclude<LevelId, 'all'>;

/** Lowercase ASCII words joined by hyphens: accents dropped, "&" read as "and", brackets and apostrophes gone. */
export function slugify(s: string): string {
  return s
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * Stable slug for a program: "<level>-<program>" ("undergrad-commerce"), or just the level when
 * the program is the level's only one under the same name ("law", "mba", "medicine"). Unique
 * per level as long as no two programs in a level slugify alike; `shareEntries` checks that.
 */
export function programSlug(level: Level, program: string): string {
  const p = slugify(program) || 'program';
  return p === level ? level : `${level}-${p}`;
}

const base = () => {
  const b = import.meta.env?.BASE_URL ?? '/';
  return b.endsWith('/') ? b : `${b}/`;
};
/** In-app path of a program's share page: "/p/undergrad-commerce/". */
export const sharePagePath = (slug: string) => `${base()}p/${slug}/`;
/** In-app path of a program's card image: "/share/undergrad-commerce.jpg". */
export const cardImagePath = (slug: string) => `${base()}share/${slug}.jpg`;
/** The file name "Save image" suggests. */
export const cardFileName = (slug: string) => `atlas-${slug}.jpg`;

/** The level in a name that exists at several levels: "Computer Science (master’s & PhD)". */
export const LEVEL_WORDS: Record<Level, string> = {
  undergrad: 'undergrad',
  graduate: 'master’s & PhD',
  mba: 'MBA',
  law: 'JD',
  medicine: 'MD',
};

/** "Commerce at Queen’s", "Computer Science (master’s & PhD) at Queen’s" when the name exists at several levels. */
export function programTitle(level: Level, program: string, ambiguous: boolean): string {
  return `${program}${ambiguous ? ` (${LEVEL_WORDS[level]})` : ''} at Queen’s`;
}

/** Program names (lowercased) that exist at more than one level. */
export function ambiguousNames(programs: { level: string; program: string }[]): Set<string> {
  const levels = new Map<string, Set<string>>();
  for (const p of programs) {
    const k = p.program.trim().toLowerCase();
    levels.set(k, (levels.get(k) ?? new Set()).add(p.level));
  }
  return new Set([...levels].filter(([, l]) => l.size > 1).map(([k]) => k));
}
