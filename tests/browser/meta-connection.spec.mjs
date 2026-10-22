import { test, expect } from '@playwright/test';

test.beforeEach(async ({ request }) => {
  await expect
    .poll(async () => {
      try {
        const response = await request.get('/api/health');
        return response.ok() && (await response.json()).status;
      } catch {
        return false;
      }
    })
    .toBe('ok');
});

test('Meta connection uses OAuth from the default tab and overview, with a clipboard fallback', async ({
  page,
}) => {
  const requests = [];
  await page.addInitScript(() => {
    window.__wtClipboard = '';
    window.__wtClipboardReject = false;
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: async (text) => {
          if (window.__wtClipboardReject) throw new Error('Clipboard denied');
          window.__wtClipboard = text;
        },
      },
    });
  });
  await page.route(/\/api\/integrations\?/, async (route) => {
    const response = await route.fetch();
    const data = await response.json();
    data.meta.connected = false;
    data.meta.accounts = [];
    data.meta.oauth.configured = true;
    await route.fulfill({ response, json: data });
  });
  await page.route('**/api/meta/oauth/links', async (route) => {
    requests.push(route.request().postDataJSON());
    await route.fulfill({
      status: 201,
      json: {
        url: `https://wetrack.example/api/meta/oauth/start/ticket-${requests.length}`,
        expires_at: new Date(Date.now() + 900000).toISOString(),
      },
    });
  });
  await page.goto('/app');
  await page.getByRole('combobox', { name: 'Selecionar operação' }).selectOption('workspace');
  await page.getByRole('button', { name: 'Integrações', exact: true }).click();
  await expect(page.getByRole('tab', { name: 'Meta Ads', exact: true })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await expect(
    page.getByRole('button', { name: 'Conectar com Facebook', exact: true }),
  ).toBeVisible();
  await expect(page.locator('input[name="access_token"]')).toHaveCount(0);

  await page.getByRole('button', { name: 'Copiar link de conexão', exact: true }).click();
  const dialog = page.getByRole('dialog');
  const firstLink = 'https://wetrack.example/api/meta/oauth/start/ticket-1';
  await expect(dialog.getByRole('textbox', { name: 'Link de autorização' })).toHaveValue(firstLink);
  await expect.poll(() => page.evaluate(() => window.__wtClipboard)).toBe(firstLink);
  await expect(dialog.getByRole('link', { name: 'Conectar com Facebook' })).toHaveAttribute(
    'href',
    firstLink,
  );
  await expect(dialog.locator('input[name="access_token"]')).toHaveCount(0);
  expect(requests).toEqual([{ project_id: 'workspace' }]);

  await dialog.getByRole('button', { name: 'Fechar', exact: true }).click();
  await page.getByRole('tab', { name: 'Visão geral', exact: true }).click();
  await page.getByRole('button', { name: 'Conectar com Facebook', exact: true }).click();
  const secondLink = 'https://wetrack.example/api/meta/oauth/start/ticket-2';
  await expect(dialog.getByRole('textbox', { name: 'Link de autorização' })).toHaveValue(
    secondLink,
  );
  await expect(dialog.locator('input[name="access_token"]')).toHaveCount(0);
  expect(requests).toEqual([{ project_id: 'workspace' }, { project_id: 'workspace' }]);

  await page.evaluate(() => {
    window.__wtClipboardReject = true;
  });
  await dialog.getByRole('button', { name: 'Copiar link de conexão', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Selecione o texto e copie manualmente');
  await expect(dialog.getByRole('textbox', { name: 'Link de autorização' })).toHaveValue(
    secondLink,
  );
  await dialog.getByText('Conexão manual · avançado', { exact: true }).click();
  await dialog.getByRole('button', { name: 'Informar token de anúncios' }).click();
  await expect(page.getByRole('heading', { name: 'Conectar Meta Ads por token' })).toBeVisible();
});

test('closing a pending Meta connection prevents a late link from appearing', async ({ page }) => {
  let finish;
  let started = false;
  await page.route(/\/api\/integrations\?/, async (route) => {
    const response = await route.fetch();
    const data = await response.json();
    data.meta.oauth.configured = true;
    await route.fulfill({ response, json: data });
  });
  await page.route('**/api/meta/oauth/links', async (route) => {
    started = true;
    await new Promise((resolve) => {
      finish = resolve;
    });
    await route.fulfill({
      status: 201,
      json: {
        url: 'https://wetrack.example/api/meta/oauth/start/closed-ticket',
        expires_at: new Date(Date.now() + 900000).toISOString(),
      },
    });
  });
  await page.goto('/app');
  await page.getByRole('button', { name: 'Integrações', exact: true }).click();
  await page.getByRole('button', { name: 'Conectar com Facebook', exact: true }).click();
  await expect.poll(() => started).toBe(true);
  await page.getByRole('dialog').getByRole('button', { name: 'Fechar', exact: true }).click();
  const response = page.waitForResponse((r) => r.url().endsWith('/api/meta/oauth/links'));
  finish();
  await (await response).finished();
  await page.getByRole('tab', { name: 'Visão geral', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(
    page.getByRole('button', { name: 'Conectar com Facebook', exact: true }),
  ).toBeEnabled();
});
