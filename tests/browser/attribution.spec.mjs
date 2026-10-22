import { test, expect } from '@playwright/test';

test('sales can be assigned through the complete hierarchy and retain original UTMs after reload', async ({
  page,
  request,
}) => {
  const options = await (await request.get('/api/sale-attribution-options?project=demo')).json();
  const campaign = options.campaigns.find((c) =>
    options.adsets.some(
      (a) => a.campaign_id === c.id && options.ads.some((ad) => ad.adset_id === a.id),
    ),
  );
  const set = options.adsets.find((a) => a.campaign_id === campaign.id);
  const ad = options.ads.find((a) => a.adset_id === set.id);
  const alternate = options.campaigns.find((c) => c.id !== campaign.id);
  const token = await (
    await request.post('/api/tokens', {
      data: { project_id: 'demo', name: 'Atribuição navegador', platform: 'API personalizada' },
    })
  ).json();
  const orderId = 'MANUAL-E2E-' + Date.now();
  const received = await (
    await request.post(`/api/webhooks/${token.token}`, {
      data: {
        order_id: orderId,
        status: 'approved',
        amount: 97,
        product: 'Produto atribuição navegador',
        utm_source: 'facebook',
        utm_medium: 'paid',
        utm_campaign: 'campanha-a-conferir',
        utm_term: 'conjunto-a-conferir',
        utm_content: 'anuncio-a-conferir',
      },
    })
  ).json();
  await page.goto('/app#sales');
  await page.getByRole('combobox', { name: 'Selecionar operação' }).selectOption('demo');
  await page.getByRole('textbox', { name: 'Buscar por produto, cliente ou pedido…' }).fill(orderId);
  await page.getByRole('combobox', { name: 'Filtrar atribuição' }).selectOption('unattributed');
  await page.getByRole('button', { name: `Ver pedido ${orderId}` }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByText('conjunto-a-conferir', { exact: true }).first()).toBeVisible();
  await expect(dialog.getByText('anuncio-a-conferir', { exact: true }).first()).toBeVisible();
  const campaignSelect = dialog.getByRole('combobox', { name: 'Campanha', exact: true });
  const setSelect = dialog.getByRole('combobox', { name: 'Conjunto de anúncios', exact: true });
  const adSelect = dialog.getByRole('combobox', { name: 'Anúncio', exact: true });
  await campaignSelect.selectOption(campaign.id);
  await setSelect.selectOption(set.id);
  await adSelect.selectOption(ad.id);
  await campaignSelect.selectOption(alternate.id);
  await expect(setSelect).toHaveValue('');
  await expect(adSelect).toHaveValue('');
  await expect(adSelect).toBeDisabled();
  await campaignSelect.selectOption(campaign.id);
  await setSelect.selectOption(set.id);
  await adSelect.selectOption(ad.id);
  await setSelect.selectOption('');
  await expect(adSelect).toHaveValue('');
  await setSelect.selectOption(set.id);
  await adSelect.selectOption(ad.id);
  await dialog.getByRole('button', { name: 'Salvar atribuição', exact: true }).click();
  await expect(dialog.getByText('Manual', { exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: `Ver pedido ${orderId}` })).toHaveCount(0);
  await page.getByRole('combobox', { name: 'Filtrar atribuição' }).selectOption('manual');
  const row = page
    .locator('.sales-table tbody tr')
    .filter({ hasText: 'Produto atribuição navegador' });
  await expect(row).toContainText(campaign.name);
  await expect(row).toContainText(set.name);
  await expect(row).toContainText(ad.name);
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Exportar CSV', exact: true }).click();
  expect((await downloadPromise).suggestedFilename()).toBe('wetrack-vendas-BRL.csv');
  await page.reload();
  await page.getByRole('textbox', { name: 'Buscar por produto, cliente ou pedido…' }).fill(orderId);
  await page.getByRole('button', { name: `Ver pedido ${orderId}` }).click();
  await expect(campaignSelect).toHaveValue(campaign.id);
  await expect(setSelect).toHaveValue(set.id);
  await expect(adSelect).toHaveValue(ad.id);
  await expect(dialog.getByText('conjunto-a-conferir', { exact: true }).first()).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(dialog.getByRole('button', { name: 'Salvar atribuição' })).toBeVisible();
  await dialog.getByRole('button', { name: 'Salvar atribuição' }).scrollIntoViewIfNeeded();
  await page.screenshot({
    path: 'test-results/sale-attribution-mobile.png',
    fullPage: true,
    animations: 'disabled',
  });
  const report = await (await request.get('/api/dashboard?project=demo')).json();
  expect(report.sales.find((s) => s.id === received.id).utm_campaign).toBe('campanha-a-conferir');
});

test('Facebook UTM template is ready to copy and stays available on every visit', async ({
  page,
  context,
}) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.goto('/app#integrations');
  await page.getByRole('tab', { name: 'UTMs', exact: true }).click();
  const template =
    'utm_source=facebook&utm_medium=paid&utm_campaign={{campaign.id}}&utm_term={{adset.id}}&utm_content={{ad.id}}';
  await expect(page.locator('.meta-utm-template code')).toHaveText(template);
  await page.getByRole('button', { name: 'Copiar padrão Facebook', exact: true }).click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(template);
  await page.reload();
  await page.getByRole('tab', { name: 'UTMs', exact: true }).click();
  await expect(page.locator('.meta-utm-template code')).toHaveText(template);
  await expect(page.getByText('Parâmetros de URL', { exact: true })).toBeVisible();
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.screenshot({
    path: 'test-results/facebook-utm-template.png',
    fullPage: true,
    animations: 'disabled',
  });
});
