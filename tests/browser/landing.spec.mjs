import { test, expect } from '@playwright/test';

test('public landing explains one plan, switches billing and links to the workspace', async ({
  page,
}) => {
  const errors = [];
  const protectedRequests = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('request', (request) => {
    if (new URL(request.url()).pathname.startsWith('/api/')) protectedRequests.push(request.url());
  });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Seu lucro cresce.');
  await expect(
    page.getByRole('heading', { name: 'Dashboards ilimitados', exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole('heading', { name: 'Taxa por venda aprovada', exact: true }),
  ).toBeVisible();
  await expect(page.getByRole('link', { name: 'Entrar', exact: true })).toHaveAttribute(
    'href',
    '/app',
  );
  await expect(page.getByRole('link', { name: 'Acessar painel' })).toHaveAttribute('href', '/app');

  const pricing = page.locator('#plano');
  const billing = pricing.getByRole('group', { name: 'Período da assinatura' });
  await expect(billing.getByRole('button', { name: /^Anual/ })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(pricing.locator('.lp-price strong')).toHaveText('19,90');
  await expect(pricing.getByText('R$ 238,80 cobrados por ano. Economize R$ 120,00.')).toBeVisible();
  await billing.getByRole('button', { name: 'Mensal', exact: true }).click();
  await expect(billing.getByRole('button', { name: 'Mensal', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(pricing.locator('.lp-price strong')).toHaveText('29,90');
  await expect(pricing.getByText('R$ 29,90 cobrados por mês.', { exact: true })).toBeVisible();
  await billing.getByRole('button', { name: /^Anual/ }).click();
  await expect(pricing.locator('.lp-price strong')).toHaveText('19,90');

  const checkout = pricing.locator('.lp-subscribe');
  if (await checkout.evaluate((element) => element.tagName === 'A')) {
    await expect(checkout).toHaveAttribute('href', /^https:\/\/pay\.cakto\.com\.br\/[^/]+/);
  } else {
    await expect(checkout).toBeDisabled();
    await expect(checkout).toHaveText('Assinaturas em breve');
  }
  expect(protectedRequests).toEqual([]);
  expect(errors).toEqual([]);
});

test('FAQs expand with native keyboard controls and distinguish gateway fees', async ({ page }) => {
  await page.goto('/#duvidas');
  const fees = page.locator('details').filter({
    has: page.locator('summary', { hasText: 'Existe alguma taxa por venda aprovada?' }),
  });
  const question = fees.locator('summary');
  await expect(fees).not.toHaveAttribute('open', '');
  await question.focus();
  await page.keyboard.press('Enter');
  await expect(fees).toHaveAttribute('open', '');
  await expect(fees.getByText(/As taxas do seu gateway de pagamento/)).toBeVisible();
  await page.keyboard.press('Enter');
  await expect(fees).not.toHaveAttribute('open', '');
});

test('calculator updates monthly and annual fees while WeTrack stays at zero', async ({ page }) => {
  await page.goto('/#economia');
  const calculator = page.locator('.lp-calculator');
  const sales = calculator.getByRole('slider', { name: /Vendas aprovadas por mês/ });
  const fee = calculator.getByRole('combobox', {
    name: 'Taxa de tracking por venda que você paga hoje',
  });
  const comparison = calculator.locator('.lp-calculator-comparison');
  const monthly = comparison.locator('div').first().locator('strong');
  const weTrack = comparison.locator('div').last().locator('strong');
  const annual = calculator.locator('.lp-calculator-result strong');

  await expect(sales).toHaveValue('1000');
  await expect(fee).toHaveValue('0.15');
  await expect(monthly).toHaveText('R$ 150,00');
  await expect(annual).toContainText('R$ 1.800,00');
  await expect(weTrack).toHaveText('R$ 0,00');

  await sales.focus();
  for (let step = 0; step < 90; step++) await page.keyboard.press('ArrowRight');
  await expect(sales).toHaveValue('10000');
  await fee.selectOption('0.30');
  await expect(monthly).toHaveText('R$ 3.000,00');
  await expect(annual).toContainText('R$ 36.000,00');
  await expect(weTrack).toHaveText('R$ 0,00');
});

for (const width of [390, 1440]) {
  test(`landing fits ${width}px and keeps navigation usable`, async ({ page }) => {
    await page.setViewportSize({ width, height: 960 });
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);

    if (width === 390) {
      const pillars = await page.locator('.lp-pillars > div').evaluateAll((containers) =>
        containers.map((container) => {
          const heading = container.querySelector('h2');
          const bounds = container.getBoundingClientRect();
          const headingBounds = heading.getBoundingClientRect();
          return {
            text: heading.textContent,
            fontSize: Number.parseFloat(getComputedStyle(heading).fontSize),
            right: headingBounds.right,
            left: headingBounds.left,
            containerRight: bounds.right,
            containerLeft: bounds.left,
            scrollWidth: heading.scrollWidth,
            clientWidth: heading.clientWidth,
          };
        }),
      );
      expect(pillars).toHaveLength(3);
      for (const pillar of pillars) {
        expect(pillar.fontSize, pillar.text).toBeLessThanOrEqual(12);
        expect(pillar.right, pillar.text).toBeLessThanOrEqual(pillar.containerRight + 1);
        expect(pillar.left, pillar.text).toBeGreaterThanOrEqual(pillar.containerLeft - 1);
        expect(pillar.scrollWidth, pillar.text).toBeLessThanOrEqual(pillar.clientWidth + 1);
      }

      const toggle = page.getByRole('button', { name: 'Abrir menu', exact: true });
      await toggle.click();
      await expect(page.getByRole('button', { name: 'Fechar menu', exact: true })).toHaveAttribute(
        'aria-expanded',
        'true',
      );
      await page
        .getByRole('navigation', { name: 'Navegação principal' })
        .getByRole('link', { name: 'Plano único', exact: true })
        .click();
      await expect(page).toHaveURL(/\/#plano$/);
      await expect(page.getByRole('button', { name: 'Abrir menu', exact: true })).toHaveAttribute(
        'aria-expanded',
        'false',
      );
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
      ).toBe(true);
    }

    await page.screenshot({
      path: `test-results/landing-${width}.png`,
      fullPage: true,
      animations: 'disabled',
    });
  });
}

test('workspace paths and legacy dashboard hashes still open the dashboard', async ({ page }) => {
  for (const path of ['/app', '/login', '/#sales']) {
    await page.goto(path);
    await expect(page.getByRole('combobox', { name: 'Selecionar operação' })).toBeVisible();
    await expect(page.getByRole('heading', { level: 1, name: 'Seu lucro cresce.' })).toHaveCount(0);
  }
  await expect(page).toHaveURL(/\/app#sales$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Vendas', exact: true })).toBeVisible();
});
