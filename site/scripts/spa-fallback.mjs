#!/usr/bin/env node
/**
 * After `vite build`:
 *  1. dist/404.html = the app, so GitHub Pages serves deep links (and unknown paths get the
 *     in-app 404 page). Netlify reads public/_redirects; Vercel reads vercel.json.
 *  2. dist/<route>/index.html for each tool page, with that page's own <title> and share
 *     tags, so a link to /river or /twin posted on X previews as that page. Static hosts serve
 *     these files directly; the app boots from them exactly as from index.html.
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';

const ROUTES = {
  river: {
    title: 'The River · Atlas',
    description: 'Where does a graduating class end up? Every year from the first job to today, for 100+ Queen’s programs and five-year classes.',
  },
  diaspora: {
    title: 'The Diaspora · Atlas',
    description: 'Where do Queen’s alumni live now? A world map of 92,000 alumni and the moves from first job to home.',
  },
  twin: {
    title: 'Career Twin · Atlas',
    description: 'Pick your program and see where its grads went, from first job to today. Graduated? Find the 20+ alumni who started like you.',
  },
  method: {
    title: 'Method · Atlas',
    description: 'How 95,020 public LinkedIn profiles became an aggregate-only atlas: dating the snapshot, labelling, privacy.',
  },
};

if (!existsSync('dist/index.html')) {
  console.error('spa-fallback: dist/index.html missing; run vite build first');
  process.exit(1);
}
copyFileSync('dist/index.html', 'dist/404.html');

const html = readFileSync('dist/index.html', 'utf8');
const escape = (s) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

/** Replace the content of one tag/attribute, failing loudly if index.html changed shape. */
function swap(doc, pattern, replacement, what) {
  if (!pattern.test(doc)) throw new Error(`spa-fallback: ${what} not found in dist/index.html`);
  return doc.replace(pattern, replacement);
}

for (const [route, meta] of Object.entries(ROUTES)) {
  const t = escape(meta.title);
  const d = escape(meta.description);
  let doc = html;
  doc = swap(doc, /<title>[^<]*<\/title>/, `<title>${t}</title>`, '<title>');
  doc = swap(doc, /(<meta name="description" content=")[^"]*(")/, `$1${d}$2`, 'meta description');
  doc = swap(doc, /(<meta property="og:title" content=")[^"]*(")/, `$1${t}$2`, 'og:title');
  doc = swap(doc, /(<meta property="og:description" content=")[^"]*(")/, `$1${d}$2`, 'og:description');
  doc = swap(doc, /(<meta name="twitter:title" content=")[^"]*(")/, `$1${t}$2`, 'twitter:title');
  doc = swap(doc, /(<meta name="twitter:description" content=")[^"]*(")/, `$1${d}$2`, 'twitter:description');
  // Absolute canonical/og:url (only present when SITE_URL was set at build time).
  doc = doc.replace(/(<link rel="canonical" href=")([^"]*?)\/?(")/, `$1$2/${route}$3`);
  doc = doc.replace(/(<meta property="og:url" content=")([^"]*?)\/?(")/, `$1$2/${route}$3`);
  mkdirSync(`dist/${route}`, { recursive: true });
  writeFileSync(`dist/${route}/index.html`, doc);
}
console.log(`spa-fallback: dist/404.html + ${Object.keys(ROUTES).length} route pages written`);
