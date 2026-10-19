import { test, expect } from '@playwright/test';

test('installed head pixel records checkout return, time and scrolling in the visitor journey', async ({
  page,
  request,
  baseURL,
}) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const origin = new URL(baseURL).origin;
  const response = await request.post('/api/pixels', {
    data: {
      project_id: 'workspace',
      name: 'Jornada completa',
      domain: origin,
      checkout_url: origin + '/journey-checkout',
    },
  });
  expect(response.ok()).toBeTruthy();
  const pixel = await response.json();
  const html = `<html><head><title>Oferta jornada</title><script async src="${origin}/pixel.js" data-pixel="${pixel.id}" data-checkout-url="${origin}/journey-checkout"></script></head><body style="margin:0;min-height:3600px"><h1>Oferta jornada</h1><a href="/journey-checkout" style="position:fixed;top:12px;right:12px">Ir para o checkout</a></body></html>`;
  await page.route('**/journey-fixture**', (route) =>
    route.fulfill({ contentType: 'text/html', body: html }),
  );
  await page.route('**/journey-checkout**', (route) =>
    route.fulfill({ contentType: 'text/html', body: '<h1>Checkout de teste</h1>' }),
  );
  await page.clock.install();
  await page.goto('/journey-fixture?utm_source=facebook&utm_campaign=campanha_jornada');
  await page.waitForFunction(() => Boolean(window.WeTrack));
  const visitor = await page.evaluate(() => window.WeTrack.visitorId);
  const journey = async () =>
    (await request.get(`/api/visitors/${visitor}?project=workspace`)).json();
  await page.clock.fastForward(16000);
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  await page.clock.runFor(100);
  await expect
    .poll(async () => {
      const data = await journey();
      return data.events?.find((e) => e.event_name === 'PageView')?.scroll_depth;
    })
    .toBe(100);
  await page.getByRole('link', { name: 'Ir para o checkout' }).click();
  await expect(page.getByRole('heading', { name: 'Checkout de teste' })).toBeVisible();
  await page.clock.fastForward(30000);
  await page.goBack();
  await page.waitForFunction(() => Boolean(window.WeTrack));
  expect(await page.evaluate(() => window.WeTrack.visitorId)).toBe(visitor);
  await expect
    .poll(
      async () => (await journey()).events?.filter((e) => e.event_name === 'CheckoutReturn').length,
    )
    .toBe(1);
  const data = await journey();
  const first = data.events.find((e) => e.event_name === 'PageView');
  expect(first.duration_ms).toBeGreaterThanOrEqual(16000);
  expect(first.duration_ms).toBeLessThan(20000);
  expect(first.active_ms).toBeLessThanOrEqual(first.duration_ms);
  expect(data.events.some((e) => e.event_name === 'InitiateCheckout')).toBeTruthy();
  expect(data.events.some((e) => e.event_name === 'PageExit')).toBeTruthy();
  expect(data.events.filter((e) => e.event_name === 'PageEngagement')).toHaveLength(0);
  expect(data.events.find((e) => e.event_name === 'CheckoutReturn').away_ms).toBeGreaterThanOrEqual(
    30000,
  );
  await page.clock.resume();
  await page.goto('/');
  await page.getByRole('combobox', { name: 'Selecionar operação' }).selectOption('workspace');
  await page.getByRole('button', { name: 'Visitas e atribuição', exact: true }).click();
  await page.getByRole('textbox', { name: 'Buscar visitante, página ou origem…' }).fill(visitor);
  await expect(page.locator('.visitor-table tbody tr')).toHaveCount(1);
  await page.getByRole('button', { name: 'Ver trajeto' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByText('Voltou após clique no checkout', { exact: true })).toBeVisible();
  await expect(
    dialog.getByText('Clicou para iniciar checkout (IC)', { exact: true }),
  ).toBeVisible();
  await expect(dialog.getByText(/Tempo visível:.*Rolagem: 100%/)).toBeVisible();
  await page.screenshot({
    path: 'test-results/visitor-journey.png',
    fullPage: true,
    animations: 'disabled',
  });
  expect(errors).toEqual([]);
});
