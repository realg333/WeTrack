import { test, expect } from '@playwright/test';
import fs from 'node:fs';
const languages = ['en', 'es', 'fr', 'de', 'zh-CN', 'ja', 'hi', 'ar'];
for (const language of languages) {
  test(`language ${language} loads on landing and dashboard without runtime errors`, async ({
    page,
  }) => {
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    const dict = JSON.parse(fs.readFileSync(`src/locales/${language}.json`, 'utf8'));
    await page.goto(`/?lang=${language}`);
    await expect(page.locator('html')).toHaveAttribute('lang', language);
    await expect(page.getByRole('combobox', { name: 'Language / Idioma' })).toHaveValue(language);
    await expect(page.locator('html')).toHaveAttribute('dir', language === 'ar' ? 'rtl' : 'ltr');
    await page.goto(`/app?lang=${language}`);
    await expect(
      page.getByRole('heading', { name: dict['Sua operação em foco.'], exact: true }),
    ).toBeVisible();
    await page.getByRole('button', { name: dict['Integrações'], exact: true }).first().click();
    await expect(
      page.getByRole('heading', { name: dict['Integrações'], exact: true }),
    ).toBeVisible();
    expect(errors).toEqual([]);
  });
}
test('language selection persists across navigation and Portuguese can be restored', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('combobox', { name: 'Language / Idioma' }).selectOption('en');
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await page.goto('/app');
  await expect(
    page.getByRole('heading', { name: 'Your operation in focus.', exact: true }),
  ).toBeVisible();
  await page.getByRole('combobox', { name: 'Language / Idioma' }).selectOption('pt-BR');
  await expect(
    page.getByRole('heading', { name: 'Sua operação em foco.', exact: true }),
  ).toBeVisible();
});

test('translated layouts fit desktop and mobile', async ({ page }) => {
  for (const lang of ['en', 'de', 'ar', 'zh-CN']) {
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: 950 });
      await page.goto(`/?lang=${lang}`);
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
      ).toBe(true);
      await page.goto(`/app?lang=${lang}`);
      await expect(page.locator('main h1')).toBeVisible();
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
      ).toBe(true);
      if (lang === 'en' || lang === 'ar')
        await page.screenshot({ path: `test-results/language-${lang}-${width}.png` });
    }
  }
});
