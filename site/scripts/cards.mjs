#!/usr/bin/env node
/**
 * Share cards: one 1200x630 JPEG per program with a published Career Twin program group.
 *
 *   node scripts/cards.mjs                      -> public/share/<slug>.jpg + public/share/index.json
 *   node scripts/cards.mjs --only a,b --out dir -> just those slugs, into another folder (no manifest)
 *
 * The cards are drawn by the app's own code: this starts a Vite dev server, opens
 * scripts/share-card.html (src/views/twin/shareCardPage.tsx) in headless Chromium, and that page
 * reads only public/data through the app's loader and renders each card with the same
 * programHero() the Twin student hero uses. Then each card is screenshotted as a JPEG, lowering
 * the quality step by step until it fits the size budget.
 *
 * public/share/index.json is the manifest scripts/share-pages.mjs turns into /p/<slug>/ pages at
 * build time (Vercel can't run Chromium, so the images and manifest are committed).
 */
import { chromium } from '@playwright/test';
import { mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const opt = (name) => { const i = args.indexOf(`--${name}`); return i === -1 ? null : args[i + 1]; };
const only = opt('only')?.split(',').map((s) => s.trim()).filter(Boolean) ?? null;
const OUT = resolve(ROOT, opt('out') ?? 'public/share');
const BUDGET = 70 * 1024;         // bytes per image
const QUALITIES = [86, 80, 74, 68, 62, 56];

const server = await createServer({
  root: ROOT,
  logLevel: 'warn',
  clearScreen: false,
  server: { port: 5194, strictPort: false },
});
await server.listen();
const base = server.resolvedUrls?.local?.[0] ?? 'http://localhost:5194/';

const browser = await chromium.launch();
let failed = false;
try {
  const page = await browser.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1, colorScheme: 'light' });
  const problems = [];
  page.on('console', (m) => { if (m.type() === 'error') problems.push(m.text()); });
  page.on('pageerror', (e) => problems.push(e.message));
  await page.goto(new URL('scripts/share-card.html', base).href, { waitUntil: 'load' });
  const rows = await page.evaluate(() => window.__shareCards);
  if (!Array.isArray(rows) || rows.length === 0) throw new Error(`cards: no programs found (${problems.join('; ') || 'no errors'})`);

  const todo = only ? rows.filter((r) => only.includes(r.slug)) : rows;
  if (only && todo.length !== only.length) {
    const missing = only.filter((s) => !rows.some((r) => r.slug === s));
    throw new Error(`cards: unknown slug(s): ${missing.join(', ')}`);
  }
  mkdirSync(OUT, { recursive: true });

  let total = 0;
  let largest = { slug: '', bytes: 0 };
  for (const r of todo) {
    const shown = await page.evaluate((slug) => window.__showShareCard(slug), r.slug);
    if (!shown) throw new Error(`cards: could not render ${r.slug}`);
    // Layout checks: nothing may spill off the card or run into the stats.
    const issue = await page.evaluate(() => {
      const card = document.querySelector('.share-card')?.getBoundingClientRect();
      const head = document.querySelector('.share-card__head')?.getBoundingClientRect();
      const stats = document.querySelector('.share-card__stats')?.getBoundingClientRect();
      const title = document.querySelector('.share-card__title');
      if (!card || !head) return 'card did not render';
      if (title) {
        const size = parseFloat(getComputedStyle(title).fontSize);
        if (title.getBoundingClientRect().height > size * 0.98 * 2 + 6) return 'title needs more than two lines';
      }
      if (stats && head.bottom > stats.top - 12) return 'title block runs into the stats';
      const over = [...document.querySelectorAll('.share-card *')].find((el) => {
        const b = el.getBoundingClientRect();
        return !el.closest('.share-card__blob, .share-card__dots') && (b.right > card.right + 0.5 || b.bottom > card.bottom + 0.5);
      });
      return over ? `${over.className || over.tagName} spills off the card` : null;
    });
    if (issue) { console.error(`cards: ${r.slug}: ${issue}`); failed = true; }

    let buf;
    for (const quality of QUALITIES) {
      buf = await page.screenshot({ type: 'jpeg', quality, clip: { x: 0, y: 0, width: 1200, height: 630 } });
      if (buf.length <= BUDGET) break;
    }
    if (buf.length > BUDGET) console.warn(`cards: ${r.slug} is ${Math.round(buf.length / 1024)} KB, over the ${BUDGET / 1024} KB budget`);
    writeFileSync(join(OUT, `${r.slug}.jpg`), buf);
    total += buf.length;
    if (buf.length > largest.bytes) largest = { slug: r.slug, bytes: buf.length };
  }

  if (!only) {
    // The manifest, then drop cards for programs that are no longer published.
    writeFileSync(join(OUT, 'index.json'), `${JSON.stringify({ generated: new Date().toISOString().slice(0, 10), cards: rows }, null, 1)}\n`);
    const keep = new Set(rows.map((r) => `${r.slug}.jpg`));
    for (const f of readdirSync(OUT)) {
      if (f.endsWith('.jpg') && !keep.has(f)) { rmSync(join(OUT, f)); console.log(`cards: removed stale ${f}`); }
    }
  }
  if (problems.length) { console.error(`cards: page errors:\n  ${problems.join('\n  ')}`); failed = true; }
  const dirTotal = readdirSync(OUT).reduce((a, f) => a + statSync(join(OUT, f)).size, 0);
  console.log(`cards: ${todo.length} card(s) -> ${OUT.replace(ROOT, '.').replace(/\\/g, '/')} `
    + `(${Math.round(total / 1024)} KB written, average ${Math.round(total / todo.length / 1024)} KB, `
    + `largest ${largest.slug} ${Math.round(largest.bytes / 1024)} KB; folder ${Math.round(dirTotal / 1024)} KB)`);
} finally {
  await browser.close();
  await server.close();
}
if (failed) process.exit(1);
