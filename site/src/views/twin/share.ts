/**
 * Share cards and link previews for programs: the entries the card page (scripts/share-card.html,
 * rendered by scripts/cards.mjs) draws, and the manifest it writes (public/share/index.json) for
 * the build-time /p/<slug>/ pages. Slugs, paths and titles live in shareLinks.ts.
 */
import { LEVEL } from '../../data/taxonomy';
import type { Meta, TwinFile } from '../../data/types';
import { fmtInt } from '../../lib/format';
import { buildIndex, programHero, snapshotLabel, whoPhrase } from './model';
import type { Level, ProgramHero, Stat } from './model';
import { ambiguousNames, programSlug, programTitle } from './shareLinks';

export {
  LEVEL_WORDS, ambiguousNames, cardFileName, cardImagePath, programSlug, programTitle, sharePagePath, slugify,
} from './shareLinks';

/** One sentence per stat, the first naming who: "40% of Commerce grads started in finance & accounting." */
export function statSentences(who: string, stats: Stat[]): string[] {
  return stats.map((s, i) => `${s.value}${i === 0 ? ` of ${who}` : ''} ${s.text}.`);
}

/** Everything a program's card, share page and Share button need. */
export interface ShareEntry {
  slug: string;
  level: Level;
  program: string;
  /** The level label for the card's pill, when the name exists at several levels ("Master’s & PhD"); else null. */
  levelPill: string | null;
  /** "Commerce at Queen’s" (with the level when ambiguous). */
  title: string;
  /** Link-preview title: "Commerce at Queen’s: where 3,525 grads went". */
  ogTitle: string;
  /** Link-preview description: the hero's numbers as sentences, then the source. */
  description: string;
  /** Alt text for the card image. */
  alt: string;
  /** Where the share page sends people: the student view for this program. */
  href: string;
  hero: ProgramHero;
}

/** "Classes of 1995–2024" from meta.counts (falls back to the five-year bands' span). */
export function classesLabel(meta: Pick<Meta, 'counts'> | null | undefined): string {
  const from = meta?.counts?.firstYear ?? 1995;
  const to = meta?.counts?.lastYear ?? 2024;
  return `Classes of ${from}–${to}`;
}

/**
 * One entry per program with a published Twin program group (level, program, all classes, any
 * first job), largest first. Throws if two programs would share a slug, so a card can never
 * overwrite another.
 */
export function shareEntries(twin: Pick<TwinFile, 'groups'>, meta: Pick<Meta, 'snapshot'>): ShareEntry[] {
  const index = buildIndex(twin.groups);
  const programs = twin.groups
    .filter((g) => g.level !== '*' && g.program !== '*' && g.cohort === '*' && g.s0 === '*')
    .sort((a, b) => b.n - a.n || a.program.localeCompare(b.program));
  const ambiguous = ambiguousNames(programs.map((g) => ({ level: g.level, program: g.program })));
  const snapshot = snapshotLabel(meta.snapshot);
  const seen = new Map<string, string>();
  const out: ShareEntry[] = [];
  for (const g of programs) {
    const level = g.level as Level;
    const hero = programHero(index, level, g.program);
    if (!hero) continue;
    const slug = programSlug(level, g.program);
    const clash = seen.get(slug);
    if (clash) throw new Error(`share: "${clash}" and "${level} ${g.program}" would both be /p/${slug}/`);
    seen.set(slug, `${level} ${g.program}`);
    const amb = ambiguous.has(g.program.trim().toLowerCase());
    const title = programTitle(level, g.program, amb);
    const who = whoPhrase(level, g.program);
    const sentences = statSentences(who, hero.stats);
    const params = new URLSearchParams([['level', level], ['program', g.program]]);
    out.push({
      slug, level, program: g.program,
      levelPill: amb ? LEVEL[level].label : null,
      title,
      ogTitle: `${title}: where ${fmtInt(hero.group.n)} grads went`,
      description: [...sentences, `Groups only, from public LinkedIn profiles${snapshot ? ` (${snapshot})` : ''}.`].join(' '),
      alt: `${title}. ${fmtInt(hero.group.n)} grads. ${sentences.join(' ')}`.trim(),
      href: `/twin?${params.toString()}`,
      hero,
    });
  }
  return out;
}
