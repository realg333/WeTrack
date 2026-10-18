import { test, expect } from '@playwright/test';

test('dashboard, filters, navigation, details, theme and export', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/');
  await page.getByRole('combobox', { name: 'Selecionar operação' }).selectOption('demo');
  await expect(page.getByRole('heading', { name: 'Sua operação em foco.' })).toBeVisible();
  await expect(page.locator('.metric-value').first()).not.toHaveText('R$ 0,00');
  await expect(page.locator('.revenue-chart')).toBeVisible();
  const lastWeek = await page.locator('.metric-value').first().innerText();
  await page.getByRole('button', { name: 'Hoje', exact: true }).click();
  await expect(page.locator('.metric-value').first()).not.toHaveText(lastWeek);
  await page.getByRole('button', { name: '7 dias', exact: true }).click();
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Exportar relatório' }).click();
  expect((await download).suggestedFilename()).toMatch(/wetrack-/);
  await page.locator('.recent-sales tbody tr').first().click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Detalhes da venda' })).toBeVisible();
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Campanhas', exact: true }).click();
  await expect(page.locator('.campaign-table')).toBeVisible();
  await page.getByRole('textbox', { name: 'Buscar em campanhas…' }).fill('REMARKETING');
  await expect(page.locator('.campaign-table tbody tr')).toHaveCount(1);
  await page.locator('.campaign-table tbody .entity-link').first().click();
  await expect(page.getByRole('tab', { name: /Conjuntos de anúncios/ })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await expect(page.locator('.campaign-table tbody tr')).toHaveCount(2);
  await page.locator('.campaign-table tbody .entity-link').first().click();
  await expect(page.getByRole('tab', { name: /Anúncios/ })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await expect(page.locator('.campaign-table tbody tr')).toHaveCount(2);
  await page.locator('.campaign-table tbody .entity-link').first().click();
  await expect(page.getByRole('heading', { name: /Anúncio/ })).toBeVisible();
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Vendas', exact: true }).click();
  await page.getByRole('button', { name: 'Pendentes', exact: true }).click();
  await expect(page.locator('tbody .badge').first()).toHaveText('Pendente');
  await page
    .getByRole('textbox', { name: 'Buscar por produto, cliente ou pedido…' })
    .fill('nada-encontrado-123');
  await expect(page.getByRole('heading', { name: 'Nenhuma venda encontrada' })).toBeVisible();
  await page.getByRole('button', { name: 'Alternar tema' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await page.getByRole('button', { name: 'Alternar tema' }).click();
  await page.getByRole('button', { name: 'Visão geral', exact: true }).click();
  await page.setViewportSize({ width: 1440, height: 1080 });
  if (await page.locator('.toast').count())
    await page.getByRole('button', { name: 'Dispensar aviso' }).click();
  await page.mouse.move(1430, 10);
  await page.screenshot({
    path: 'test-results/dashboard-desktop.png',
    fullPage: true,
    animations: 'disabled',
  });
  expect(errors).toEqual([]);
});

test('real workspace: pixel, token, webhook sale, UTM builder and rules', async ({
  page,
  request,
}) => {
  await page.goto('/');
  await page.getByRole('combobox', { name: 'Selecionar operação' }).selectOption('workspace');
  await expect(page.getByRole('button', { name: 'Conectar minha operação' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Integrações', exact: true }).click();
  await page.getByRole('tab', { name: 'Pixel de rastreio' }).click();
  await page.getByRole('button', { name: 'Novo pixel', exact: true }).click();
  await page.getByRole('textbox', { name: 'Nome do pixel' }).fill('Pixel e2e');
  await page.getByRole('textbox', { name: 'Domínio autorizado' }).fill('https://teste.example.com');
  await page.getByRole('button', { name: 'Criar pixel', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Pixel e2e', exact: true })).toBeVisible();
  await page.getByRole('tab', { name: 'UTMs', exact: true }).click();
  await page.getByRole('textbox', { name: 'Campanha utm_campaign' }).fill('Campanha teste');
  await expect(page.locator('.utm-result code')).toContainText('utm_campaign=Campanha+teste');
  await page.getByRole('tab', { name: 'Webhook API' }).click();
  await page.getByRole('button', { name: 'Conectar plataforma', exact: true }).click();
  await page.getByRole('button', { name: /API personalizada Conectar agora/ }).click();
  await page.getByRole('textbox', { name: 'Nome da integração' }).fill('Checkout e2e');
  await page.getByRole('button', { name: 'Gerar conexão' }).click();
  await expect(page.getByRole('heading', { name: 'Sua conexão está pronta.' })).toBeVisible();
  const webhook = await page.locator('.token-url code').innerText();
  const response = await request.post(webhook, {
    data: {
      order_id: `e2e-${Date.now()}`,
      status: 'approved',
      amount: 197,
      product: 'Produto e2e',
      customer_name: 'Cliente e2e',
      utm_source: 'facebook',
    },
  });
  expect(response.ok()).toBeTruthy();
  await page.getByRole('button', { name: 'Já guardei, continuar' }).click();
  await page.getByRole('button', { name: 'Vendas', exact: true }).click();
  await expect(page.getByText('Produto e2e').first()).toBeVisible();
  await page.getByRole('button', { name: 'Campanhas', exact: true }).click();
  await page.getByRole('button', { name: 'Nova campanha', exact: true }).click();
  await page.getByRole('textbox', { name: 'Nome da campanha' }).fill('Campanha e2e');
  await page.getByRole('spinbutton', { name: 'Orçamento diário (R$)' }).fill('100');
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'Criar campanha', exact: true })
    .click();
  await expect(page.getByText('Campanha e2e', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Investimento', exact: true }).click();
  await page.getByRole('spinbutton', { name: 'Valor investido (R$)' }).fill('50');
  await page.getByRole('button', { name: 'Salvar investimento', exact: true }).click();
  await expect(page.locator('.metric-spend .metric-value')).toHaveText('R$ 50,00');
  await page.getByRole('button', { name: 'Regras e alertas', exact: true }).click();
  await page.getByRole('button', { name: 'Nova regra', exact: true }).click();
  await page.getByRole('textbox', { name: 'Nome da regra' }).fill('CPA de teste');
  await page.getByRole('spinbutton', { name: 'Valor limite' }).fill('30');
  await page.getByRole('button', { name: 'Criar regra', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'CPA de teste' }).first()).toBeVisible();
  await page.getByRole('button', { name: 'Integrações', exact: true }).click();
  await page.setViewportSize({ width: 1440, height: 1000 });
  if (await page.locator('.toast').count())
    await page.getByRole('button', { name: 'Dispensar aviso' }).click();
  await page.mouse.move(1430, 10);
  await page.screenshot({
    path: 'test-results/integrations-desktop.png',
    fullPage: true,
    animations: 'disabled',
  });
});

test('installed pixel tracks visits, keeps attribution and propagates UTMs to links', async ({
  page,
  request,
}) => {
  const domain = 'http://127.0.0.1:5174';
  const response = await request.post('/api/pixels', {
    data: { name: 'Pixel instalado', domain, project_id: 'workspace' },
  });
  expect(response.ok()).toBeTruthy();
  const pixel = await response.json();
  const html = `<html><head><script async src="${domain}/pixel.js" data-pixel="${pixel.id}"></script></head><body><h1>Loja teste</h1><a href="/pixel-next">Continuar</a></body></html>`;
  await page.route('**/pixel-fixture**', (route) =>
    route.fulfill({ contentType: 'text/html', body: html }),
  );
  await page.route('**/pixel-next**', (route) =>
    route.fulfill({ contentType: 'text/html', body: '<h1>Checkout</h1>' }),
  );
  await page.goto('/pixel-fixture?utm_source=facebook&utm_campaign=campanha_teste');
  await page.waitForFunction(() => Boolean(window.WeTrack));
  const visitor = await page.evaluate(() => window.WeTrack.visitorId);
  await expect
    .poll(async () => (await (await request.get(`/api/pixels/${pixel.id}/events`)).json()).length)
    .toBe(1);
  await page.getByRole('link', { name: 'Continuar' }).click();
  await expect(page).toHaveURL(/utm_campaign=campanha_teste/);
  await page.goto('/pixel-fixture');
  await page.waitForFunction(() => Boolean(window.WeTrack));
  expect(await page.evaluate(() => window.WeTrack.visitorId)).toBe(visitor);
  await expect
    .poll(async () => (await (await request.get(`/api/pixels/${pixel.id}/events`)).json()).length)
    .toBe(3); // two PageViews and the outbound click.
  const events = await (await request.get(`/api/pixels/${pixel.id}/events`)).json();
  expect(events.every((e) => e.utm_source === 'facebook')).toBeTruthy();
});

test('mobile menu, dashboard and overflow', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await expect(page.locator('.metric-value').first()).toBeVisible();
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
  ).toBeTruthy();
  await page.getByRole('button', { name: 'Abrir navegação' }).click();
  await page.getByRole('button', { name: 'Integrações', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Menos abas. Mais clareza.' })).toBeVisible();
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
  ).toBeTruthy();
  await page.screenshot({
    path: 'test-results/integrations-mobile.png',
    fullPage: true,
    animations: 'disabled',
  });
  await page.getByRole('button', { name: 'Abrir navegação' }).click();
  await page.getByRole('button', { name: 'Visão geral', exact: true }).click();
  await page.screenshot({
    path: 'test-results/dashboard-mobile.png',
    fullPage: true,
    animations: 'disabled',
  });
});
