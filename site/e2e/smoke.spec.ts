import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

const ROUTES = ['/', '/river', '/diaspora', '/twin', '/method'];

/** Collect console errors, page errors and failed requests while a test runs. */
function watch(page: Page) {
  const problems: string[] = [];
  page.on('console', (m) => { if (m.type() === 'error') problems.push(`console: ${m.text()}`); });
  page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
  page.on('requestfailed', (r) => problems.push(`requestfailed: ${r.url()} ${r.failure()?.errorText ?? ''}`));
  page.on('response', (r) => { if (r.status() >= 400) problems.push(`http ${r.status()}: ${r.url()}`); });
  return problems;
}

async function settle(page: Page) {
  await page.waitForLoadState('networkidle');
  await expect(page.locator('.status--loading')).toHaveCount(0, { timeout: 15_000 });
}

for (const route of ROUTES) {
  test(`${route} renders cleanly`, async ({ page }) => {
    const problems = watch(page);
    await page.goto(route);
    await settle(page);
    await expect(page.locator('main h1')).toBeVisible();
    await expect(page).toHaveTitle(/Atlas/);
    expect(problems).toEqual([]);
  });

  test(`${route} has no horizontal page scroll`, async ({ page }) => {
    await page.goto(route);
    await settle(page);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(1);
  });
}

test('unknown paths show the 404 page inside the app shell', async ({ page }) => {
  await page.goto('/no-such-page');
  await expect(page.getByRole('heading', { name: /isn’t on the map/ })).toBeVisible();
  await expect(page).toHaveTitle(/Not found/);
  await page.getByRole('link', { name: /Back to the Atlas/ }).click();
  await expect(page).toHaveURL(/\/$/);
});

test('main navigation reaches every tool and marks the current page', async ({ page, isMobile }) => {
  await page.goto('/');
  await settle(page);
  for (const [name, path] of [['River', '/river'], ['Diaspora', '/diaspora'], ['Career Twin', '/twin'], ['Method', '/method']]) {
    const link = page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name, exact: true });
    if (isMobile) await link.scrollIntoViewIfNeeded();
    await link.click();
    await expect(page).toHaveURL(new RegExp(`${path}$`));
    await expect(link).toHaveAttribute('aria-current', 'page');
    await settle(page);
  }
  await page.goBack();
  await expect(page).toHaveURL(/\/twin$/);
});

test('deep links keep their filters on reload', async ({ page }) => {
  await page.goto('/river?level=law&program=Law&cohort=2010-2014');
  await settle(page);
  await page.reload();
  await settle(page);
  await expect(page).toHaveURL(/level=law/);
  await expect(page).toHaveURL(/program=Law/);
  await expect(page.locator('main')).toContainText('Law');
});

test('garbage query params fall back to defaults instead of breaking', async ({ page }) => {
  const problems = watch(page);
  for (const route of ['/river?level=%3Cscript%3E&program=zzz&cohort=1066', '/diaspora?level=x&cohort=y',
    '/twin?level=x&program=y&year=abc&first=z']) {
    await page.goto(route);
    await settle(page);
    await expect(page.locator('main h1')).toBeVisible();
  }
  expect(problems).toEqual([]);
});

test('theme toggle switches and persists', async ({ page }) => {
  await page.goto('/');
  await settle(page);
  const toggle = page.getByRole('button', { name: /Switch to (dark|light) theme/ });
  const before = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  await toggle.click();
  const after = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  expect(after).not.toBe(before);
  await page.reload();
  expect(await page.evaluate(() => getComputedStyle(document.body).backgroundColor)).toBe(after);
});

test('skip link moves focus to the main content', async ({ page, isMobile }) => {
  test.skip(isMobile, 'keyboard-only check');
  await page.goto('/');
  await page.keyboard.press('Tab');
  await expect(page.getByRole('link', { name: 'Skip to content' })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/#main$/);
});

test('data files are served as JSON and the app survives a data outage', async ({ page }) => {
  const res = await page.request.get('/data/meta.json');
  expect(res.ok()).toBe(true);
  expect(res.headers()['content-type']).toContain('json');

  await page.route('**/data/*.json?*', (r) => r.fulfill({ status: 503, body: 'down' }));
  await page.goto('/river');
  await expect(page.getByRole('alert')).toContainText(/went wrong|Could not load/i);
  await expect(page.getByRole('button', { name: /Try again/ })).toBeVisible();
});

test('a program share page previews its card, then lands on the Twin view for that program', async ({ page, request }) => {
  const res = await request.get('/p/undergrad-commerce/');
  expect(res.status()).toBe(200);
  const html = await res.text();
  const image = /<meta property="og:image" content="([^"]+)"/.exec(html)?.[1];
  expect(image).toMatch(/\/share\/undergrad-commerce\.jpg$/);
  expect(html).toMatch(/<meta name="twitter:image" content="[^"]*\/share\/undergrad-commerce\.jpg"/);
  expect(html).toMatch(/<meta name="twitter:card" content="summary_large_image"/);
  expect(html).toMatch(/<title>Commerce at Queen’s: where [\d,]+ grads went · Atlas<\/title>/);
  expect(html).toMatch(/<link rel="canonical" href="[^"]*\/p\/undergrad-commerce\/"/);
  const card = await request.get(new URL(image!, res.url()).href);
  expect(card.status()).toBe(200);
  expect(card.headers()['content-type']).toMatch(/image\/jpeg/);

  const problems = watch(page);
  await page.goto('/p/undergrad-commerce/');
  await expect(page).toHaveURL(/\/twin\?level=undergrad&program=Commerce$/);
  await settle(page);
  await expect(page.getByRole('heading', { level: 2, name: /Commerce grads$/ })).toBeVisible();
  await expect(page.getByRole('group', { name: 'Share Commerce at Queen’s' })).toBeVisible();
  expect(problems).toEqual([]);
});
