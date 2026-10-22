import { test, expect } from '@playwright/test';

for (const order of ['code-first', 'session-first']) {
  test(`WhatsApp signup validates event origin and handles ${order}`, async ({ page, request }) => {
    const pixel = await (
      await request.post('/api/pixels', {
        data: {
          project_id: 'workspace',
          name: `Embedded ${order}`,
          domain: 'https://example.test',
        },
      })
    ).json();
    const connection = await (
      await request.post('/api/whatsapp/connections', {
        data: {
          project_id: 'workspace',
          name: `Embedded ${order}`,
          pixel_id: pixel.id,
          waba_id: order === 'code-first' ? '987654321' : '987654322',
          phone_number_id: order === 'code-first' ? '123456781' : '123456782',
          access_token: 'test-only-access-token',
          app_secret: 'test-only-secret-123456',
        },
      })
    ).json();
    let exchanges = 0,
      completions = 0;
    await page.route('**/api/whatsapp/onboarding/config', (route) =>
      route.fulfill({
        json: {
          configured: true,
          app_id: '123456',
          config_id: '654321',
          graph_version: 'v23.0',
          session_info_version: '3',
          feature_type: 'whatsapp_business_app_onboarding',
        },
      }),
    );
    await page.route('**/api/whatsapp/onboarding/session', (route) =>
      route.fulfill({
        json: {
          nonce: 'test-only-nonce',
          expires_at: new Date(Date.now() + 600000).toISOString(),
        },
      }),
    );
    await page.route('**/api/whatsapp/onboarding/exchange', async (route) => {
      expect(route.request().postDataJSON()).toMatchObject({
        project_id: 'workspace',
        nonce: 'test-only-nonce',
        code: 'test-code',
      });
      exchanges++;
      await route.fulfill({ json: { ok: true } });
    });
    await page.route('**/api/whatsapp/onboarding/complete', async (route) => {
      expect(route.request().postDataJSON()).toMatchObject({
        project_id: 'workspace',
        nonce: 'test-only-nonce',
        waba_id: '9876543',
        phone_number_id: '1234567',
      });
      completions++;
      await route.fulfill({ json: { id: connection.id } });
    });
    await page.addInitScript(() => {
      window.FB = {
        init: () => {},
        login: (callback, options) => {
          window.__waCallback = callback;
          window.__waOptions = options;
        },
      };
    });
    await page.goto('/app');
    await page.getByRole('combobox', { name: 'Selecionar operação' }).selectOption('workspace');
    await page.getByRole('button', { name: 'WhatsApp', exact: true }).click();
    await page.getByRole('tab', { name: /Conexões/ }).click();
    await page.getByRole('button', { name: 'Conectar com a Meta', exact: true }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('Nome da conexão').fill('Autorização de teste');
    await dialog.getByLabel('Pixel da operação').selectOption(pixel.id);
    await dialog.getByRole('button', { name: 'Preparar conexão' }).click();
    await dialog.getByRole('button', { name: 'Continuar com a Meta' }).click();
    expect(await page.evaluate(() => window.__waOptions)).toMatchObject({
      response_type: 'code',
      extras: { sessionInfoVersion: '3', featureType: 'whatsapp_business_app_onboarding' },
    });
    const sendSession = (origin) =>
      page.evaluate(
        (origin) =>
          window.dispatchEvent(
            new MessageEvent('message', {
              origin,
              data: JSON.stringify({
                type: 'WA_EMBEDDED_SIGNUP',
                event: 'FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING',
                data: { waba_id: '9876543', phone_number_id: '1234567' },
              }),
            }),
          ),
        origin,
      );
    await sendSession('https://www.facebook.com.attacker.test');
    if (order === 'code-first') {
      await page.evaluate(() => window.__waCallback({ authResponse: { code: 'test-code' } }));
      await expect.poll(() => exchanges).toBe(1);
      expect(completions).toBe(0);
      await sendSession('https://www.facebook.com');
    } else {
      await sendSession('https://web.facebook.com');
      expect(exchanges).toBe(0);
      expect(completions).toBe(0);
      await page.evaluate(() => window.__waCallback({ authResponse: { code: 'test-code' } }));
    }
    await expect.poll(() => completions).toBe(1);
    await expect(page.getByRole('dialog')).toContainText('Configuração e entregas do WhatsApp');
    expect(exchanges).toBe(1);
  });
}

test('WhatsApp signup reports missing Meta app activation without a dead login button', async ({
  page,
}) => {
  await page.route('**/api/whatsapp/onboarding/config', (route) =>
    route.fulfill({ json: { configured: false } }),
  );
  await page.goto('/app');
  await page.getByRole('button', { name: 'WhatsApp', exact: true }).click();
  await page.getByRole('tab', { name: /Conexões/ }).click();
  await expect(page.getByText(/O login guiado depende da habilitação/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Conectar com a Meta', exact: true })).toHaveCount(
    0,
  );
});

test('WhatsApp signup recovers a failed SDK download and handles canceled authorization', async ({
  page,
  request,
}) => {
  const pixel = await (
    await request.post('/api/pixels', {
      data: {
        project_id: 'workspace',
        name: 'SDK recovery',
        domain: 'https://example.test',
      },
    })
  ).json();
  await page.route('**/api/whatsapp/onboarding/config', (route) =>
    route.fulfill({
      json: {
        configured: true,
        app_id: '123456',
        config_id: '654321',
        graph_version: 'v23.0',
        session_info_version: '3',
        feature_type: 'whatsapp_business_app_onboarding',
      },
    }),
  );
  await page.route('**/api/whatsapp/onboarding/session', (route) =>
    route.fulfill({
      json: {
        nonce: 'test-retry-nonce',
        expires_at: new Date(Date.now() + 600000).toISOString(),
      },
    }),
  );
  let downloads = 0,
    exchanges = 0;
  await page.route('https://connect.facebook.net/pt_BR/sdk.js', async (route) => {
    downloads++;
    if (downloads === 1) await route.abort();
    else
      await route.fulfill({
        contentType: 'text/javascript',
        body: 'window.FB = {init(){}, login(cb){cb({});}};',
      });
  });
  await page.route('**/api/whatsapp/onboarding/exchange', async (route) => {
    exchanges++;
    await route.fulfill({ json: { ok: true } });
  });
  await page.goto('/app');
  await page.getByRole('combobox', { name: 'Selecionar operação' }).selectOption('workspace');
  await page.getByRole('button', { name: 'WhatsApp', exact: true }).click();
  await page.getByRole('tab', { name: /Conexões/ }).click();
  await page.getByRole('button', { name: 'Conectar com a Meta', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Nome da conexão').fill('SDK retry');
  await dialog.getByLabel('Pixel da operação').selectOption(pixel.id);
  await dialog.getByRole('button', { name: 'Preparar conexão' }).click();
  await expect(dialog.getByRole('alert')).toContainText('Não foi possível carregar a Meta');
  await dialog.getByRole('button', { name: 'Preparar conexão' }).click();
  await dialog.getByRole('button', { name: 'Continuar com a Meta' }).click();
  await expect(dialog.getByRole('alert')).toContainText('A Meta não autorizou a conexão');
  await expect(dialog.getByRole('button', { name: 'Preparar conexão' })).toBeEnabled();
  expect(downloads).toBe(2);
  expect(exchanges).toBe(0);
});
