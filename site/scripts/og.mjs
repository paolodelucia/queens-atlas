#!/usr/bin/env node
/**
 * Social share image + home-screen icon in the "Campus zine" style, rendered with headless
 * Chromium so they use the site's own font and palette.
 *
 *   node scripts/og.mjs            -> public/og.png (1200x630) and public/apple-touch-icon.png (180x180)
 *
 * Inputs: public/data/meta.json (headline numbers; if it doesn't parse, e.g. mid-rebuild, the
 * committed copy from git HEAD is used), src/styles/tokens.css (light-theme colours) and
 * src/site.config.ts (site name and author credit, read by regex rather than compiled).
 * The font comes straight from node_modules/@fontsource-variable as a file:// URL.
 */
import { chromium } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');
const fontUrl = (pkg, file) => pathToFileURL(join(ROOT, 'node_modules/@fontsource-variable', pkg, 'files', file)).href;

function loadMeta() {
  try {
    return JSON.parse(read('public/data/meta.json'));
  } catch (err) {
    console.warn(`public/data/meta.json did not parse (${err.message}); using the committed copy from git HEAD`);
    return JSON.parse(execFileSync('git', ['show', 'HEAD:./public/data/meta.json'], { cwd: ROOT, encoding: 'utf8' }));
  }
}
const meta = loadMeta();

const config = read('src/site.config.ts');
const field = (re) => re.exec(config)?.[2]?.trim() ?? '';
const siteName = field(/\bname:\s*(['"`])(.*?)\1/) || 'Atlas';
const authorName = field(/author:\s*\{[^}]*?\bname:\s*(['"`])(.*?)\1/);

// ── Palette: light-theme tokens ───────────────────────────────────────────
const tokens = read('src/styles/tokens.css');
const lightBlock = tokens.slice(0, tokens.indexOf('@media'));
const tok = (name, fallback) => (new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{3,8})`).exec(lightBlock)?.[1]) ?? fallback;
const C = {
  page: tok('page', '#fff6e5'),
  card: tok('surface-1', '#ffffff'),
  ink: tok('ink-1', '#1a1a1a'),
  ink2: tok('ink-2', '#4a443b'),
  lime: tok('lime', '#d7f36b'),
  lilac: tok('lilac', '#b9a6ff'),
};

const fmt = (n) => new Intl.NumberFormat('en-CA').format(n);
const roundK = (n) => fmt(Math.round(n / 1000) * 1000);
const c = meta.counts;
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const [snapY, snapM] = String(meta.snapshot).split('-').map(Number);
const month = MONTHS[snapM - 1] ? `${MONTHS[snapM - 1]} ${snapY}` : String(meta.snapshot);
const esc = (t) => String(t).replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch]);

const fontFace = `@font-face { font-family: 'Bricolage Grotesque Variable'; font-weight: 200 800;
  src: url(${fontUrl('bricolage-grotesque', 'bricolage-grotesque-latin-opsz-normal.woff2')}) format('woff2'); }`;

/** The brand mark (same drawing as public/favicon.svg). */
function brandMark(size) {
  return `<svg class="mark" width="${size}" height="${size}" viewBox="0 0 32 32">`
    + `<rect x="5" y="5" width="25" height="25" rx="7" fill="${C.lilac}"/>`
    + `<rect x="2" y="2" width="25" height="25" rx="7" fill="${C.lime}" stroke="${C.ink}" stroke-width="2.5"/>`
    + `<path fill="${C.ink}" fill-rule="evenodd" d="M12.6 7h3.8L22 22h-3.8l-1.1-3h-5.2l-1.1 3H7zM14.5 12.05l1.55 4.15h-3.1z"/></svg>`;
}

const stickers = [
  { tone: C.lime, tilt: -5, html: `<b>${fmt(c.roles)}</b> jobs traced` },
  { tone: C.lilac, tilt: 4, html: `<b>${fmt(c.countries)}</b> countries` },
  { tone: C.card, tilt: -3, html: `classes of <b>${c.firstYear}–${c.lastYear}</b>` },
];

const ogHtml = `<!doctype html><html><head><meta charset="utf-8"><style>
${fontFace}
* { box-sizing: border-box; margin: 0; padding: 0; }
html, body { width: 1200px; height: 630px; }
body {
  position: relative; overflow: hidden; background: ${C.page}; color: ${C.ink};
  font-family: 'Bricolage Grotesque Variable', sans-serif; -webkit-font-smoothing: antialiased;
}
.blob { position: absolute; right: -90px; top: -120px; width: 360px; height: 360px; border-radius: 50%;
  background: ${C.lilac}; border: 3px solid ${C.ink}; }
.dots { position: absolute; right: 64px; top: 346px; width: 162px; height: 72px;
  background-image: radial-gradient(${C.ink} 2.2px, transparent 2.6px); background-size: 18px 18px; opacity: .55; }
.top { position: absolute; left: 64px; top: 50px; right: 64px; display: flex; align-items: center; gap: 14px; }
.brand { display: flex; align-items: center; gap: 12px; font-size: 40px; font-weight: 800; letter-spacing: -0.045em; line-height: 1; }
.mark { transform: rotate(-6deg); }
.by { margin-left: 8px; padding: 6px 14px 5px; border: 2.5px solid ${C.ink}; border-radius: 999px; background: ${C.card};
  font-size: 18px; font-weight: 700; letter-spacing: -0.005em; }
h1 { position: absolute; left: 64px; top: 128px; width: 1010px;
  font-size: 104px; font-weight: 800; line-height: .92; letter-spacing: -0.05em; }
.hl { background: ${C.lime}; padding: 0 .08em; border-radius: .1em; -webkit-box-decoration-break: clone; box-decoration-break: clone; }
.stickers { position: absolute; left: 64px; bottom: 100px; display: flex; gap: 26px; align-items: center; }
.st { padding: 12px 20px 11px; border: 3px solid ${C.ink}; border-radius: 16px; box-shadow: 5px 5px 0 ${C.ink};
  font-size: 30px; font-weight: 600; letter-spacing: -0.02em; line-height: 1; white-space: nowrap; transform: rotate(var(--r)); }
.st b { font-weight: 800; }
.foot { position: absolute; left: 64px; right: 64px; bottom: 38px; font-size: 19px; font-weight: 500; color: ${C.ink2}; }
.foot b { font-weight: 700; color: ${C.ink}; }
</style></head><body>
<div class="blob"></div><div class="dots"></div>
<div class="top">
  <div class="brand">${brandMark(44)}<span>${esc(siteName)}</span></div>
  ${authorName ? `<div class="by">by ${esc(authorName)}</div>` : ''}
</div>
<h1>Where do <span class="hl">${roundK(c.alumni)}</span> Queen’s grads actually end&nbsp;up?</h1>
<div class="stickers">
  ${stickers.map((s) => `<div class="st" style="background:${s.tone};--r:${s.tilt}deg">${s.html}</div>`).join('\n  ')}
</div>
<div class="foot"><b>Not affiliated with Queen’s University.</b> Groups only, from public LinkedIn profiles (${month}).</div>
</body></html>`;

const iconHtml = `<!doctype html><html><head><meta charset="utf-8"><style>
* { margin: 0; padding: 0; }
html, body { width: 180px; height: 180px; }
body { display: grid; place-items: center; overflow: hidden; background: ${C.page}; }
.mark { width: 150px; height: 150px; margin: 6px 0 0 6px; }
</style></head><body>${brandMark(150)}</body></html>`;

const dir = mkdtempSync(join(tmpdir(), 'atlas-og-'));
const browser = await chromium.launch();
try {
  const render = async (html, w, h, out) => {
    const file = join(dir, `${w}x${h}.html`);
    writeFileSync(file, html);
    const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
    await page.goto(pathToFileURL(file).href, { waitUntil: 'load' });
    await page.evaluate(() => document.fonts.ready);
    const fonts = await page.evaluate(() => [...document.fonts].filter((f) => f.status === 'loaded').map((f) => f.family));
    // Fail loudly if the headline would spill off the card.
    const overflow = await page.evaluate(() => {
      const h1 = document.querySelector('h1');
      const st = document.querySelector('.stickers');
      if (!h1 || !st) return null;
      return h1.getBoundingClientRect().bottom > st.getBoundingClientRect().top - 12 ? 'headline overlaps the stickers' : null;
    });
    if (overflow) console.warn(`warning: ${out}: ${overflow}`);
    await page.screenshot({ path: join(ROOT, out), type: 'png' });
    await page.close();
    console.log(`saved ${out} (${w}x${h}; fonts: ${[...new Set(fonts)].join(', ') || 'none loaded'})`);
  };
  await render(ogHtml, 1200, 630, 'public/og.png');
  await render(iconHtml, 180, 180, 'public/apple-touch-icon.png');
} finally {
  await browser.close();
  rmSync(dir, { recursive: true, force: true });
}
