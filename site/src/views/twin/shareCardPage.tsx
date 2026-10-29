/**
 * The card page: scripts/share-card.html loads this through Vite (scripts/cards.mjs runs a Vite
 * server and drives it with Playwright). It reads only the published JSON (public/data, through
 * the app's own loader), builds every program's entry with the same code as the Twin hero, and
 * exposes two hooks for the script:
 *
 *   window.__shareCards        Promise of the manifest rows (slug, title, description, …)
 *   window.__showShareCard(s)  render one card and resolve once it is laid out
 *
 * It isn't part of the app bundle (index.html never references it).
 */
import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
import '../../styles/base.css';
import { loadData } from '../../data/load';
import { snapshotLabel } from './model';
import { ShareCard } from './ShareCard';
import { cardImagePath, classesLabel, shareEntries } from './share';
import type { ShareEntry } from './share';

/** One row of public/share/index.json (read by scripts/share-pages.mjs at build time). */
export interface ShareManifestRow {
  slug: string;
  level: string;
  program: string;
  title: string;
  ogTitle: string;
  description: string;
  alt: string;
  href: string;
  image: string;
  /** The stats as printed on the card, for checks: "40% started in finance & accounting (400 of 1,000 grads, …)". */
  stats: string[];
}

declare global {
  interface Window {
    __shareCards?: Promise<ShareManifestRow[]>;
    __showShareCard?: (slug: string) => Promise<boolean>;
  }
}

document.documentElement.dataset.theme = 'light';
const root = createRoot(document.getElementById('root')!);

const ready = (async () => {
  const [meta, twin] = await Promise.all([loadData('meta'), loadData('twin')]);
  const entries = shareEntries(twin, meta);
  // Measure titles with the real font.
  await document.fonts.load('800 96px "Bricolage Grotesque Variable"');
  await document.fonts.ready;
  return { meta, entries, bySlug: new Map(entries.map((e) => [e.slug, e])) };
})();

const row = (e: ShareEntry): ShareManifestRow => ({
  slug: e.slug, level: e.level, program: e.program, title: e.title, ogTitle: e.ogTitle,
  description: e.description, alt: e.alt, href: e.href, image: cardImagePath(e.slug),
  stats: e.hero.stats.map((s) => `${s.value} ${s.text} (${s.detail})`),
});

window.__shareCards = ready.then(({ entries }) => entries.map(row));
window.__showShareCard = async (slug: string) => {
  const { meta, bySlug } = await ready;
  const entry = bySlug.get(slug);
  if (!entry) return false;
  flushSync(() => {
    root.render(<ShareCard key={slug} entry={entry} classes={classesLabel(meta)} snapshot={snapshotLabel(meta.snapshot)} />);
  });
  await document.fonts.ready;
  await new Promise((r) => requestAnimationFrame(() => r(null)));
  return true;
};
