import { test, expect } from '@playwright/test';

test('configure gateway and optional tax, persist after reload and keep operations separate', async ({
  page,
}) => {
  await page.goto('/app');
  await page.getByRole('combobox', { name: 'Selecionar operação' }).selectOption('demo');
  await page.getByRole('button', { name: 'Configurar taxas', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await dialog.getByLabel('Taxa do gateway (%)', { exact: true }).fill('4.99');
  await dialog.getByLabel('Taxa fixa do gateway (R$) · opcional', { exact: true }).fill('1.49');
  await dialog.getByLabel('Taxa de cartão de crédito (%) · opcional', { exact: true }).fill('3.99');
  await dialog.getByLabel('Taxa de Pix (%) · opcional', { exact: true }).fill('0.99');
  await dialog.getByLabel('Imposto (%) · opcional', { exact: true }).fill('6');
  await expect(dialog.getByText('Lucro estimado', { exact: true })).toBeVisible();
  const expectedProfit = await dialog.locator('.fee-preview-total dd').innerText();
  await page.route('**/api/fees', (route) =>
    route.fulfill({
      status: 500,
      contentType: 'application/json',
      body: JSON.stringify({ error: 'Falha ao salvar taxas.' }),
    }),
  );
  await dialog.getByRole('button', { name: 'Salvar taxas', exact: true }).click();
  await expect(dialog.getByRole('alert')).toHaveText('Falha ao salvar taxas.');
  await expect(dialog.getByLabel('Taxa do gateway (%)', { exact: true })).toHaveValue('4.99');
  await page.unroute('**/api/fees');
  const saved = page.waitForResponse(
    (response) => response.url().includes('/api/fees') && response.request().method() === 'PUT',
  );
  await dialog.getByRole('button', { name: 'Salvar taxas', exact: true }).click();
  expect((await saved).ok()).toBeTruthy();
  await expect(dialog).toHaveCount(0);
  await expect(page.locator('.metric-profit .metric-value')).toHaveText(expectedProfit);
  await page.screenshot({ path: 'test-results/fees-desktop.png', fullPage: true });
  await page.reload();
  await page.getByRole('button', { name: 'Configurar taxas', exact: true }).click();
  await expect(dialog.getByLabel('Taxa do gateway (%)', { exact: true })).toHaveValue('4.99');
  await expect(dialog.getByLabel('Imposto (%) · opcional', { exact: true })).toHaveValue('6');
  await expect(
    dialog.getByLabel('Taxa fixa do gateway (R$) · opcional', { exact: true }),
  ).toHaveValue('1.49');
  await expect(
    dialog.getByLabel('Taxa de cartão de crédito (%) · opcional', { exact: true }),
  ).toHaveValue('3.99');
  await expect(dialog.getByLabel('Taxa de Pix (%) · opcional', { exact: true })).toHaveValue(
    '0.99',
  );
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(dialog.getByRole('button', { name: 'Salvar taxas', exact: true })).toBeVisible();
  await expect(dialog).toHaveJSProperty(
    'scrollWidth',
    await dialog.evaluate((element) => element.clientWidth),
  );
  await page.screenshot({ path: 'test-results/fees-mobile.png', fullPage: true });
  await dialog.getByLabel('Imposto (%) · opcional', { exact: true }).fill('');
  await dialog.getByRole('button', { name: 'Salvar taxas', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await page.getByRole('button', { name: 'Configurar taxas', exact: true }).click();
  await expect(dialog.getByLabel('Imposto (%) · opcional', { exact: true })).toHaveValue('0');
  await page.keyboard.press('Escape');
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.getByRole('combobox', { name: 'Selecionar operação' }).selectOption('workspace');
  await page.getByRole('button', { name: 'Configurar taxas', exact: true }).click();
  await expect(dialog.getByLabel('Taxa do gateway (%)', { exact: true })).toHaveValue('0');
  await expect(dialog.getByLabel('Imposto (%) · opcional', { exact: true })).toHaveValue('0');
  await expect(
    dialog.getByLabel('Taxa fixa do gateway (R$) · opcional', { exact: true }),
  ).toHaveValue('0');
  await expect(
    dialog.getByLabel('Taxa de cartão de crédito (%) · opcional', { exact: true }),
  ).toHaveValue('0');
  await expect(dialog.getByLabel('Taxa de Pix (%) · opcional', { exact: true })).toHaveValue('0');
});
