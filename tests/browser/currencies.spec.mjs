import { test, expect } from '@playwright/test';

test('currency selector shows separate USD reports, preserves preference and exports currency', async ({
  page,
  request,
}) => {
  const response = await request.post('/api/campaigns', {
    data: {
      project_id: 'workspace',
      name: 'Campanha dólar navegador',
      source: 'Meta Ads',
      budget: 12.5,
      currency: 'USD',
    },
  });
  expect(response.ok()).toBe(true);
  const campaign = await response.json();
  const day = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(
    new Date(),
  );
  expect(
    (
      await request.put(`/api/campaigns/${campaign.id}/spend`, { data: { day, amount: 10.25 } })
    ).ok(),
  ).toBe(true);
  const tokenResponse = await request.post('/api/tokens', {
    data: { project_id: 'workspace', name: 'Teste moeda navegador', platform: 'API personalizada' },
  });
  const token = (await tokenResponse.json()).token;
  const order = `USD-${Date.now()}`;
  expect(
    (
      await request.post(`/api/webhooks/${token}`, {
        data: {
          order_id: order,
          amount: 40,
          currency: 'USD',
          status: 'approved',
          product: 'Produto dólar navegador',
          utm_campaign: campaign.id,
        },
      })
    ).ok(),
  ).toBe(true);
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');
  await page.getByRole('combobox', { name: 'Selecionar operação' }).selectOption('workspace');
  const currency = page.getByRole('combobox', { name: 'Moeda do relatório' });
  await expect(currency).toHaveValue('BRL');
  await currency.selectOption('USD');
  await expect(page.locator('.metric-revenue .metric-value')).toHaveText(/US\$\s*40,00/);
  await expect(page.locator('.metric-spend .metric-value')).toHaveText(/US\$\s*10,25/);
  await page.getByRole('button', { name: 'Campanhas', exact: true }).click();
  const row = page
    .locator('.campaign-table tbody tr')
    .filter({ hasText: 'Campanha dólar navegador' });
  await expect(row).toContainText(/US\$\s*10,25/);
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Exportar', exact: true }).click();
  const file = await download;
  expect(file.suggestedFilename()).toBe('wetrack-campaigns-USD.csv');
  const stream = await file.createReadStream();
  let csv = '';
  for await (const chunk of stream) csv += chunk.toString('utf8');
  expect(csv).toContain('"Moeda"');
  expect(csv).toContain('"USD"');
  await page.reload();
  await expect(currency).toHaveValue('USD');
  await expect(row).toBeVisible();
  await currency.selectOption('BRL');
  await expect(row).toHaveCount(0);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(currency).toBeVisible();
  await currency.selectOption('USD');
  await expect(row).toBeVisible();
  await page.screenshot({ path: 'test-results/usd-mobile.png', fullPage: true });
  expect(errors).toEqual([]);
});
