#!/usr/bin/env node
/**
 * After `vite build` (and spa-fallback): one static page per program at dist/p/<slug>/index.html,
 * so a link posted in a group chat or on X previews as that program's share card. Each page has
 * its own title, description, og/twitter tags and canonical URL, then sends the visitor straight
 * on to the Career Twin student view for the program (meta refresh + location.replace, with a
 * visible link for anyone whose browser does neither).
 *
 * Input: dist/share/index.json, the manifest scripts/cards.mjs writes next to the card images
 * (public/share, committed; Vercel can't run Chromium). Absolute URLs come from SITE_URL or
 * Vercel's production domain, the same rule as vite.config.ts; without either they stay
 * root-relative.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';

const DIST = 'dist';
const manifestPath = `${DIST}/share/index.json`;
if (!existsSync(`${DIST}/index.html`)) {
  console.error('share-pages: dist/index.html missing; run vite build first');
  process.exit(1);
}
if (!existsSync(manifestPath)) {
  console.warn('share-pages: no dist/share/index.json (run `npm run cards`); no /p/ pages written');
  process.exit(0);
}

const vercel = process.env.VERCEL_PROJECT_PRODUCTION_URL;
const SITE = (process.env.SITE_URL ?? (vercel ? `https://${vercel}` : '')).replace(/\/$/, '');
const abs = (path) => `${SITE}${path}`;
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const { cards } = JSON.parse(readFileSync(manifestPath, 'utf8'));
if (!Array.isArray(cards)) throw new Error('share-pages: dist/share/index.json has no cards list');

// Theme colours for the brief moment the page is visible (tokens.css, light and dark).
const tokens = readFileSync('src/styles/tokens.css', 'utf8');
const tok = (name, fallback) => new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{3,8})`).exec(tokens)?.[1] ?? fallback;
const C = { page: tok('page', '#fff6e5'), ink: tok('ink-1', '#1a1a1a'), lime: tok('lime', '#d7f36b') };

const missingImages = [];
for (const c of cards) {
  if (!/^[a-z0-9-]+$/.test(c.slug)) throw new Error(`share-pages: bad slug "${c.slug}"`);
  if (!existsSync(`${DIST}${c.image}`)) missingImages.push(c.image);
  const page = `/p/${c.slug}/`;
  const title = `${c.ogTitle} · Atlas`;
  const target = c.href; // root-relative: /twin?level=…&program=…
  const doc = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(c.description)}">
<link rel="canonical" href="${esc(abs(page))}">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<meta property="og:type" content="website">
<meta property="og:site_name" content="Atlas">
<meta property="og:title" content="${esc(c.ogTitle)}">
<meta property="og:description" content="${esc(c.description)}">
<meta property="og:url" content="${esc(abs(page))}">
<meta property="og:image" content="${esc(abs(c.image))}">
<meta property="og:image:type" content="image/jpeg">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:image:alt" content="${esc(c.alt)}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${esc(c.ogTitle)}">
<meta name="twitter:description" content="${esc(c.description)}">
<meta name="twitter:image" content="${esc(abs(c.image))}">
<meta name="twitter:image:alt" content="${esc(c.alt)}">
<meta http-equiv="refresh" content="0; url=${esc(target)}">
<script>location.replace(${JSON.stringify(target).replace(/</g, '\\u003c')});</script>
<style>
  body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: ${C.page}; color: ${C.ink};
    font: 600 18px/1.5 system-ui, -apple-system, 'Segoe UI', sans-serif; }
  a { color: inherit; text-decoration-thickness: 2px; text-underline-offset: 3px; background: linear-gradient(${C.lime}, ${C.lime}) 0 92% / 100% 0.42em no-repeat; }
  @media (prefers-color-scheme: dark) { body { background: #141312; color: #fff6e5; } a { background: none; } }
</style>
</head>
<body>
<main>
<p>Opening <a href="${esc(target)}">${esc(c.title)} on Atlas</a>…</p>
</main>
</body>
</html>
`;
  mkdirSync(`${DIST}/p/${c.slug}`, { recursive: true });
  writeFileSync(`${DIST}/p/${c.slug}/index.html`, doc);
}

// Programs the site lists that have no card yet (cards are stale: run `npm run cards`).
try {
  const meta = JSON.parse(readFileSync(`${DIST}/data/meta.json`, 'utf8'));
  const have = new Set(cards.map((c) => `${c.level}|${c.program}`));
  const missing = (meta.programs ?? []).filter((p) => !have.has(`${p.level}|${p.program}`));
  if (missing.length) {
    console.warn(`share-pages: ${missing.length} program(s) have no share card (run \`npm run cards\`): `
      + missing.slice(0, 5).map((p) => `${p.level} ${p.program}`).join(', ') + (missing.length > 5 ? ', …' : ''));
  }
} catch { /* no meta: nothing to compare */ }
if (missingImages.length) console.warn(`share-pages: ${missingImages.length} card image(s) missing, e.g. ${missingImages[0]}`);

console.log(`share-pages: ${cards.length} program pages under dist/p/ (${SITE ? `absolute URLs on ${SITE}` : 'root-relative URLs; set SITE_URL for absolute ones'})`);
