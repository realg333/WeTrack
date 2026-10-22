import { test, expect } from '@playwright/test';
import { createHmac } from 'node:crypto';

test('WhatsApp CRM stages and checkout links preserve revenue and work on mobile', async ({
  page,
  request,
}) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const token = await (
    await request.post('/api/tokens', {
      data: {
        project_id: 'workspace',
        name: 'Pedidos WhatsApp navegador',
        platform: 'API personalizada',
      },
    })
  ).json();
  const order = {
    order_id: 'wa-browser-order',
    product: 'Produto WhatsApp navegador',
    status: 'pending',
    amount: 123,
    customer_name: 'Ana WhatsApp navegador',
  };
  expect((await request.post(`/api/webhooks/${token.token}`, { data: order })).ok()).toBeTruthy();
  await page.goto('/app');
  await page.getByRole('combobox', { name: 'Selecionar operação' }).selectOption('workspace');
  await page.getByRole('button', { name: 'WhatsApp', exact: true }).click();
  await page.getByRole('button', { name: 'Adicionar contato', exact: true }).click();
  let dialog = page.getByRole('dialog');
  await dialog.getByLabel('Nome', { exact: true }).fill('Ana WhatsApp navegador');
  await dialog.getByLabel('Telefone com DDI').fill('5511666666666');
  await dialog.getByRole('button', { name: 'Salvar', exact: true }).click();
  const row = page
    .locator('.wa-contact-table tbody tr')
    .filter({ hasText: 'Ana WhatsApp navegador' });
  await expect(row).toBeVisible();
  await row.getByRole('combobox').selectOption('qualified');
  await expect(row.getByRole('combobox')).toHaveValue('qualified');
  await row.getByRole('button', { name: 'Ver contato' }).click();
  dialog = page.getByRole('dialog');
  await expect(
    dialog.getByText('Contato manual: nenhuma conversa recebida pela conexão oficial.'),
  ).toBeVisible();
  await dialog.getByText('Vincular um pedido existente', { exact: true }).click();
  await dialog
    .getByRole('textbox', { name: 'Buscar pedido, cliente ou e-mail…' })
    .fill('wa-browser-order');
  await dialog.getByRole('button', { name: 'Vincular pedido', exact: true }).click();
  await expect(dialog.locator('.wa-order').first()).toContainText('Pendente');
  await request.post(`/api/webhooks/${token.token}`, { data: { ...order, status: 'approved' } });
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Atualizar WhatsApp', exact: true }).click();
  await expect(row).toContainText('1 compra(s)');
  await row.getByRole('combobox').selectOption('negotiating');
  await expect(row.getByRole('combobox')).toHaveValue('negotiating');
  const report = await (await request.get('/api/whatsapp?project=workspace')).json();
  expect(report.metrics.wa_conversations).toBe(0);
  expect(report.contacts.find((c) => c.name === order.customer_name).revenue).toBe(123);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({
    path: 'test-results/whatsapp-desktop.png',
    fullPage: true,
    animations: 'disabled',
  });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
  ).toBeTruthy();
  await expect
    .poll(async () => {
      const rect = await page.locator('.sidebar').boundingBox();
      return rect.x + rect.width;
    })
    .toBeLessThanOrEqual(0);
  await page.screenshot({
    path: 'test-results/whatsapp-mobile.png',
    fullPage: true,
    animations: 'disabled',
  });
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.getByRole('button', { name: 'Campanhas', exact: true }).click();
  await page.getByRole('button', { name: 'Colunas', exact: true }).click();
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'Conversas e vendas', exact: true })
    .click();
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'Aplicar colunas', exact: true })
    .click();
  await expect(page.locator('.campaign-table thead')).toContainText(
    'Custo por conversa · WhatsApp',
  );
  const preferences = await (await request.get('/api/report-columns?project=workspace')).json();
  expect(preferences.selected).toContain('wa_conversations');
  expect(errors).toEqual([]);
});

test('WhatsApp setup explains coexistence, validates signed test receipts and gates real collection', async ({
  page,
  request,
  baseURL,
}) => {
  const pixel = await (
    await request.post('/api/pixels', {
      data: {
        project_id: 'workspace',
        name: 'Pixel WhatsApp navegador',
        domain: new URL(baseURL).origin,
      },
    })
  ).json();
  await page.goto('/app');
  await page.getByRole('combobox', { name: 'Selecionar operação' }).selectOption('workspace');
  await page.getByRole('button', { name: 'WhatsApp', exact: true }).click();
  await page.getByRole('tab', { name: /Conexões/ }).click();
  await expect(page.getByText(/Habilite o número Business/)).toBeVisible();
  await page.getByRole('button', { name: 'Configurar API oficial', exact: true }).click();
  let dialog = page.getByRole('dialog');
  await dialog.getByLabel('Nome', { exact: true }).fill('Business celular teste');
  await dialog.getByRole('combobox', { name: 'Pixel da operação' }).selectOption(pixel.id);
  await dialog.getByLabel('ID da conta WhatsApp (WABA)').fill('98765430');
  await dialog.getByLabel('ID do número (Phone Number ID)').fill('12345670');
  await dialog.getByLabel('Token de acesso', { exact: true }).fill('only-test-token-browser');
  const secret = 'only-test-app-secret-browser';
  await dialog.getByLabel('Segredo do aplicativo Meta', { exact: true }).fill(secret);
  await dialog.getByRole('button', { name: 'Salvar', exact: true }).click();
  const card = page.locator('.wa-connection').filter({ hasText: 'Business celular teste' });
  await expect(card).toContainText('Modo de teste');
  await card.getByRole('button', { name: 'Configuração e entregas' }).click();
  dialog = page.getByRole('dialog');
  const real = dialog.getByRole('checkbox', { name: 'Ativar coleta real de contatos e conversas' });
  await expect(real).toBeDisabled();
  await expect(
    dialog.getByRole('button', { name: 'Conectar entregas deste número' }),
  ).toBeDisabled();
  const conn = (
    await (await request.get('/api/whatsapp?project=workspace')).json()
  ).connections.find((c) => c.name === 'Business celular teste');
  const setup = await (
    await request.get(`/api/whatsapp/connections/${conn.id}/setup?project=workspace`)
  ).json();
  const qs = new URLSearchParams({
    'hub.mode': 'subscribe',
    'hub.verify_token': setup.verify_token,
    'hub.challenge': 'browser-challenge',
  });
  expect(await (await request.get(`/api/whatsapp/webhook/${conn.id}?${qs}`)).text()).toBe(
    'browser-challenge',
  );
  const raw = JSON.stringify({
    object: 'whatsapp_business_account',
    entry: [
      {
        id: '98765430',
        changes: [
          {
            field: 'messages',
            value: {
              messaging_product: 'whatsapp',
              metadata: { phone_number_id: '12345670' },
              messages: [
                {
                  id: 'wamid.browser-test',
                  from: '5511777777777',
                  type: 'text',
                  text: { body: 'Conteúdo privado de teste' },
                  timestamp: String(Math.floor(Date.now() / 1000)),
                },
              ],
            },
          },
        ],
      },
    ],
  });
  expect(
    (
      await request.post(`/api/whatsapp/webhook/${conn.id}`, {
        data: raw,
        headers: {
          'Content-Type': 'application/json',
          'x-hub-signature-256': 'sha256=' + createHmac('sha256', secret).update(raw).digest('hex'),
        },
      })
    ).ok(),
  ).toBeTruthy();
  await dialog.getByRole('button', { name: 'Atualizar entregas', exact: true }).click();
  await expect(dialog.getByText('URL verificada pela Meta', { exact: true })).toBeVisible();
  await expect(dialog.locator('tbody tr')).toHaveCount(1);
  await expect(dialog.locator('tbody tr')).toContainText('Teste');
  await expect(real).toBeDisabled();
  expect(
    (await (await request.get('/api/whatsapp?project=workspace')).json()).contacts.some(
      (c) => c.wa_id === '5511777777777',
    ),
  ).toBeFalsy();
  await page.screenshot({ path: 'test-results/whatsapp-setup.png', fullPage: true });
});
