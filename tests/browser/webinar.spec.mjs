import { test, expect } from '@playwright/test';

test('webinar connection, email history and mobile layout are usable in the selected operation', async ({
  page,
  request,
}) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/app#webinar');
  await page.getByRole('combobox', { name: 'Selecionar operação' }).selectOption('workspace');
  await expect(page.getByRole('heading', { name: 'Webinar Meet', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Criar conexão', exact: true }).click();
  const dialog = page.getByRole('dialog');
  const token = await dialog.getByLabel('WETRACK_TOKEN', { exact: true }).inputValue();
  expect(token).toMatch(/^wtw_/);
  await dialog.getByRole('button', { name: 'Fechar', exact: true }).click();
  const at = new Date().toISOString();
  const payload = {
    version: 1,
    id: 'browser-joined',
    event: 'joined',
    occurredAt: at,
    webinarId: 'powerayuno',
    lead: { name: 'María Webinar', email: 'maria.webinar@example.com', phone: '573101234567' },
    session: {
      id: 'browser-session',
      startsAt: at,
      watchedSec: 305,
      maxSec: 320,
      status: 'watching',
    },
  };
  const send = await request.post('/api/webhooks/webinar', {
    headers: { Authorization: `Bearer ${token}` },
    data: payload,
  });
  expect(send.ok()).toBeTruthy();
  await request.post('/api/webhooks/webinar', {
    headers: { Authorization: `Bearer ${token}` },
    data: { ...payload, id: 'browser-return', event: 'rejoined' },
  });
  await page.getByRole('button', { name: 'Atualizar', exact: true }).click();
  await expect(page.getByText('maria.webinar@example.com', { exact: true })).toBeVisible();
  await expect(page.getByRole('cell', { name: '5min 5s', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'María Webinar', exact: true }).click();
  await expect(dialog.getByText('Voltou à aula', { exact: true })).toBeVisible();
  await page.screenshot({
    path: 'test-results/webinar-history.png',
    fullPage: true,
    animations: 'disabled',
  });
  await dialog.getByRole('button', { name: 'Fechar', exact: true }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
  ).toBeTruthy();
  await page.screenshot({
    path: 'test-results/webinar-mobile.png',
    fullPage: true,
    animations: 'disabled',
  });
  expect(errors).toEqual([]);
});
