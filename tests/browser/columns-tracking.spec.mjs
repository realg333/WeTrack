import { test, expect } from '@playwright/test';

test('custom columns reorder, save models, export and persist per operation', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/app');
  await page.getByRole('combobox', { name: 'Selecionar operação' }).selectOption('demo');
  await page.getByRole('button', { name: 'Campanhas', exact: true }).click();
  await page.getByRole('button', { name: 'Colunas', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: 'Tráfego e conteúdo', exact: true }).click();
  await dialog.getByRole('button', { name: 'Mover CTR para cima', exact: true }).click();
  await dialog.getByLabel('Salvar como modelo').fill('Minha análise');
  await dialog.getByRole('button', { name: 'Salvar modelo', exact: true }).click();
  await page.screenshot({ path: 'test-results/column-picker.png', fullPage: true });
  await dialog.getByRole('button', { name: 'Aplicar colunas', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  const headers = () => page.locator('.campaign-table thead th');
  await expect(headers()).toHaveText([
    'Status configurado',
    'Campanhas',
    'Investimento',
    'Impressões',
    'CPM',
    'CTR',
    'Cliques',
    'CPC',
    'Visitantes únicos · Site',
    'Sessões · Site',
    'Tempo médio ativo',
    'Rolagem média máxima',
    'Ações',
  ]);
  await page
    .locator('.campaign-table thead')
    .getByRole('button', { name: 'Ordenar por CTR', exact: true })
    .click();
  await expect(page.locator('.campaign-table th[aria-sort="descending"]')).toContainText('CTR');
  const downloaded = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Exportar', exact: true }).click();
  const download = await downloaded;
  const stream = await download.createReadStream();
  let csv = '';
  for await (const chunk of stream) csv += chunk.toString();
  expect(csv).toContain('"CPM";"CTR";"Cliques";"CPC"');
  expect(csv).not.toContain('"ROAS"');
  await page.reload();
  await page.getByRole('button', { name: 'Campanhas', exact: true }).click();
  await expect(headers()).toContainText(['CTR']);
  await page.getByRole('button', { name: 'Colunas', exact: true }).click();
  await expect(dialog.getByRole('button', { name: 'Minha análise', exact: true })).toBeVisible();
  await dialog.getByRole('button', { name: 'Desempenho', exact: true }).click();
  await dialog.getByRole('button', { name: 'Aplicar colunas', exact: true }).click();
  await expect(
    page
      .locator('.campaign-table thead')
      .getByRole('button', { name: 'Ordenar por ROAS', exact: true }),
  ).toBeVisible();
  expect(errors).toEqual([]);
});

test('tracking center creates links and manual CRM events, and works on mobile', async ({
  page,
  request,
  baseURL,
}) => {
  const pixelResponse = await request.post('/api/pixels', {
    data: { project_id: 'workspace', name: 'Pixel central', domain: new URL(baseURL).origin },
  });
  const pixel = await pixelResponse.json();
  expect(pixelResponse.ok()).toBeTruthy();
  await page.goto('/app');
  await page.getByRole('combobox', { name: 'Selecionar operação' }).selectOption('workspace');
  await page.getByRole('button', { name: 'Integrações', exact: true }).click();
  await page.getByRole('tab', { name: 'Rastreamento', exact: true }).click();
  await page.getByRole('button', { name: 'Criar smart link', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('combobox', { name: 'Pixel', exact: true }).selectOption(pixel.id);
  await dialog.getByLabel('Nome', { exact: true }).fill('Atendimento teste');
  await dialog.getByLabel('URL de destino').fill('https://wa.me/5511999999999?text=Olá');
  await dialog.getByRole('button', { name: 'Salvar', exact: true }).click();
  await expect(page.locator('.tracking-links')).toContainText('Atendimento teste');
  await page.getByRole('button', { name: 'Registrar evento', exact: true }).click();
  await dialog.getByRole('combobox', { name: 'Pixel', exact: true }).selectOption(pixel.id);
  await dialog.getByLabel('ID original do visitante').fill('visitor-manual-e2e');
  await dialog.getByLabel('Campanha (ID ou nome único)').fill('Campanha central');
  await dialog.getByLabel('Origem', { exact: true }).fill('facebook');
  await dialog.getByLabel('Valor do evento em R$ (opcional)').fill('97');
  await dialog.getByRole('button', { name: 'Salvar', exact: true }).click();
  await expect(page.locator('.tracking-center table')).toContainText('Lead');
  await expect(page.locator('.tracking-center table')).toContainText('Manual');
  const dashboard = await (await request.get('/api/dashboard?project=workspace')).json();
  const lead = await (await request.get('/api/tracking?project=workspace')).json();
  expect(lead.events.some((e) => e.event_name === 'Lead' && e.channel === 'manual')).toBeTruthy();
  expect(dashboard.metrics.revenue).toBeGreaterThanOrEqual(0);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole('heading', { name: 'Central de rastreamento' })).toBeVisible();
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
  ).toBeTruthy();
  await page.screenshot({ path: 'test-results/tracking-mobile.png', fullPage: true });
});

test('installed pixel captures marked forms, HTML video, WhatsApp and custom ecommerce without form contents', async ({
  page,
  request,
  baseURL,
}) => {
  const origin = new URL(baseURL).origin;
  const pixel = await (
    await request.post('/api/pixels', {
      data: { project_id: 'workspace', name: 'Sinais no site', domain: origin },
    })
  ).json();
  await page.route('**/signals-fixture**', (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: `<html><head><script async src="${origin}/pixel.js" data-pixel="${pixel.id}"></script></head><body><form data-wetrack-form="cadastro"><input name="email" value="private@example.test"><button>Enviar</button></form><button data-wetrack-event="AddToCart" data-wetrack-value="97" data-wetrack-content-id="curso">Adicionar</button><a href="https://wa.me/5511999999999?text=Oi" target="_blank">WhatsApp</a><video data-wetrack-video="oferta"></video></body></html>`,
    }),
  );
  await page.goto('/signals-fixture?utm_source=tiktok&ttclid=click-test');
  await page.waitForFunction(() => Boolean(window.WeTrack));
  const visitor = await page.evaluate(() => window.WeTrack.visitorId);
  await page.getByRole('button', { name: 'Adicionar', exact: true }).click();
  await page.locator('form').evaluate((form) => {
    form.addEventListener('submit', (e) => e.preventDefault());
    form.requestSubmit();
  });
  await page.locator('video').evaluate((video) => {
    video.dispatchEvent(new Event('play'));
    video.dispatchEvent(new Event('ended'));
  });
  await page
    .getByRole('link', { name: 'WhatsApp', exact: true })
    .evaluate((a) => a.addEventListener('click', (e) => e.preventDefault()));
  await page.getByRole('link', { name: 'WhatsApp', exact: true }).click();
  await expect
    .poll(async () => {
      const r = await (await request.get(`/api/visitors/${visitor}?project=workspace`)).json();
      return r.events?.filter((e) =>
        ['AddToCart', 'FormSubmit', 'VideoPlay', 'VideoComplete', 'WhatsAppClick'].includes(
          e.event_name,
        ),
      ).length;
    })
    .toBe(5);
  const journey = await (await request.get(`/api/visitors/${visitor}?project=workspace`)).json();
  expect(JSON.stringify(journey)).not.toContain('private@example.test');
  expect(journey.events.find((e) => e.event_name === 'AddToCart').value).toBe(97);
  expect(journey.events[0].first_source).toBe('tiktok');
});
