import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

const ROUTES = [
  '/',
  '/?level=undergrad&program=Commerce',
  '/river',
  '/river?level=undergrad&program=Commerce&view=years',
  '/diaspora',
  '/twin?level=undergrad&program=Commerce',
  '/twin?level=undergrad&program=Commerce&year=2010&first=finance_accounting',
  '/method',
];

for (const scheme of ['light', 'dark'] as const) {
  for (const route of ROUTES) {
    test(`${route} has no serious accessibility violations (${scheme})`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: scheme, reducedMotion: 'reduce' });
      await page.goto(route);
      await page.waitForLoadState('networkidle');
      await expect(page.locator('.status--loading')).toHaveCount(0, { timeout: 15_000 });
      const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
      const serious = results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
      expect(serious.map((v) => `${v.id}: ${v.help} (${v.nodes.length}) e.g. ${v.nodes[0]?.target.join(' ')}`)).toEqual([]);
    });
  }
}
