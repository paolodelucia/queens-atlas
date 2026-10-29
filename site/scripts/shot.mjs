#!/usr/bin/env node
/**
 * Screenshot a page so you can look at what you built.
 *
 *   node scripts/shot.mjs <url> <out.png> [--width 1280] [--height 900] [--dark] [--full]
 *                          [--wait <ms>] [--click "<css selector>"] [--hover "<css selector>"]
 *
 * Prints console errors and failed requests from the page, so a blank screenshot comes
 * with a reason.
 */
import { chromium } from '@playwright/test';

const args = process.argv.slice(2);
const [url, out] = args;
if (!url || !out) {
  console.error('usage: node scripts/shot.mjs <url> <out.png> [--width N] [--height N] [--dark] [--full] [--wait ms] [--click sel] [--hover sel]');
  process.exit(2);
}
const opt = (name, dflt) => {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? dflt : args[i + 1];
};
const flag = (name) => args.includes(`--${name}`);

const browser = await chromium.launch();
const page = await browser.newPage({
  viewport: { width: Number(opt('width', 1280)), height: Number(opt('height', 900)) },
  colorScheme: flag('dark') ? 'dark' : 'light',
  deviceScaleFactor: 1,
});
const problems = [];
page.on('console', (m) => m.type() === 'error' && problems.push(`console: ${m.text()}`));
page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
page.on('requestfailed', (r) => problems.push(`requestfailed: ${r.url()} ${r.failure()?.errorText}`));

await page.goto(url, { waitUntil: 'networkidle' });
const click = opt('click');
if (click) await page.click(click);
const hover = opt('hover');
if (hover) await page.hover(hover);
await page.waitForTimeout(Number(opt('wait', 600)));
await page.screenshot({ path: out, fullPage: flag('full') });
await browser.close();

console.log(`saved ${out}`);
if (problems.length) console.log(problems.join('\n'));
