import { test, expect } from '@playwright/test';

test('Hotmart native setup validates a test, keeps test data out of revenue and counts approval plus completion once', async ({
  page,
  request,
}) => {
  await page.goto('/app');
  await page.getByRole('combobox', { name: 'Selecionar operação' }).selectOption('workspace');
  await page.getByRole('button', { name: 'Integrações', exact: true }).click();
  await page.getByRole('tab', { name: 'Webhook API', exact: true }).click();
  await page.getByRole('button', { name: 'Conectar plataforma', exact: true }).click();
  await page.getByRole('button', { name: /Hotmart Conectar agora/ }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('heading', { name: 'Hotmart · Conexão de vendas' })).toBeVisible();
  await dialog.getByRole('tab', { name: 'Tutorial', exact: true }).click();
  await expect(
    dialog.getByText(/A Hotmart não entrega as UTMs estruturadas no webhook/),
  ).toBeVisible();
  await expect(dialog.getByText(/a WeTrack não presume compatibilidade/)).toBeVisible();
  await dialog.getByRole('tab', { name: 'Configuração', exact: true }).click();
  await dialog.getByRole('textbox', { name: 'Nome da conexão' }).fill('Hotmart navegador teste');
  await dialog.getByRole('button', { name: 'Gerar URL de conexão' }).click();
  const input = dialog.getByRole('textbox', { name: 'URL do webhook da plataforma' });
  await expect(input).toHaveValue(/\/api\/webhooks\/wt_/);
  const url = await input.inputValue();
  await dialog.getByLabel('Hottok da Hotmart').fill('browser-hottok-only-test');
  await expect(dialog.getByRole('checkbox', { name: /Modo de teste/ })).toBeChecked();
  await expect(
    dialog.getByRole('combobox', { name: 'Responsável pelo Purchase na Meta' }),
  ).toHaveValue('checkout');
  await dialog.getByRole('button', { name: 'Salvar configuração' }).click();
  await expect(page.getByRole('status')).toContainText('Configuração salva em modo de teste.');
  const payload = {
    id: 'browser-test-evt',
    event: 'PURCHASE_APPROVED',
    creation_date: Date.now(),
    version: '2.0.0',
    data: {
      product: { name: 'Produto Hotmart navegador' },
      buyer: { name: 'Comprador local', email: 'test@example.com' },
      purchase: {
        transaction: 'HP-BROWSER-TEST',
        price: { value: 97.35, currency_value: 'BRL' },
        order_date: Date.now(),
        approved_date: Date.now(),
        payment: { type: 'PIX' },
        status: 'APPROVED',
      },
    },
  };
  const headers = { 'X-HOTMART-HOTTOK': 'browser-hottok-only-test' };
  const before = await (await request.get('/api/dashboard?project=workspace')).json();
  expect((await request.post(url, { headers, data: payload })).status()).toBe(200);
  await dialog.getByRole('tab', { name: 'Entregas', exact: true }).click();
  await expect(dialog.getByText('Teste validado', { exact: true })).toBeVisible();
  const afterTest = await (await request.get('/api/dashboard?project=workspace')).json();
  expect(afterTest.metrics.revenue).toBe(before.metrics.revenue);
  await dialog.getByRole('tab', { name: 'Configuração', exact: true }).click();
  await dialog.getByRole('checkbox', { name: /Modo de teste/ }).uncheck();
  await dialog.getByRole('checkbox', { name: /Conferi uma entrega de teste/ }).check();
  await dialog.getByRole('button', { name: 'Salvar configuração' }).click();
  await expect(page.getByRole('status')).toContainText('Recebimento de vendas reais liberado.');
  const live = {
    ...payload,
    id: 'browser-live-approved',
    data: {
      ...payload.data,
      purchase: { ...payload.data.purchase, transaction: 'HP-BROWSER-LIVE' },
    },
  };
  await request.post(url, { headers, data: live });
  await request.post(url, {
    headers,
    data: {
      ...live,
      id: 'browser-live-complete',
      event: 'PURCHASE_COMPLETE',
      creation_date: Date.now() + 1,
    },
  });
  await expect
    .poll(async () => {
      const d = await (await request.get('/api/dashboard?project=workspace')).json();
      return d.sales.filter((s) => s.external_id === 'HP-BROWSER-LIVE').length;
    })
    .toBe(1);
  const after = await (await request.get('/api/dashboard?project=workspace')).json();
  expect(Math.round((after.metrics.revenue - before.metrics.revenue) * 100)).toBe(9735);
  await dialog.getByRole('button', { name: 'Fechar', exact: true }).click();
  await expect(page.getByText('Hotmart navegador teste', { exact: true })).toBeVisible();
});

test('Cakto and Blackcat expose their own tutorials, credential fields and mobile layout', async ({
  page,
}) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/app');
  await page.getByRole('button', { name: 'Integrações', exact: true }).click();
  await page.getByRole('tab', { name: 'Webhook API', exact: true }).click();
  for (const name of ['Cakto', 'Blackcat']) {
    await page.getByRole('button', { name: 'Conectar plataforma', exact: true }).click();
    await page.getByRole('button', { name: new RegExp(name + ' Conectar agora') }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByRole('tab', { name: 'Tutorial', exact: true }).click();
    await expect(dialog.getByRole('heading', { name: 'Documentação oficial' })).toBeVisible();
    if (name === 'Cakto') await expect(dialog.getByText(/V1 e V2 são aceitas/)).toBeVisible();
    else
      await expect(
        dialog.getByText(/a alternativa é informar a URL em postbackUrl/),
      ).toBeVisible();
    await page.setViewportSize({ width: 390, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await dialog.getByRole('tab', { name: 'Configuração', exact: true }).click();
    await dialog.getByRole('button', { name: 'Gerar URL de conexão' }).click();
    await expect(
      dialog.getByLabel(name === 'Cakto' ? 'Secret do webhook Cakto' : 'API Key da Blackcat'),
    ).toBeVisible();
    await dialog.getByRole('button', { name: 'Fechar', exact: true }).click();
    await page.setViewportSize({ width: 1280, height: 900 });
  }
  expect(errors).toEqual([]);
});
