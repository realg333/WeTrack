import { test, expect } from '@playwright/test';

test('combined rules support templates, safe simulation, editing, activation and deletion', async ({
  page,
  request,
}) => {
  const created = await request.post('/api/campaigns', {
    data: {
      project_id: 'workspace',
      name: 'Campanha regras navegador',
      source: 'Meta Ads',
      budget: 100,
    },
  });
  const campaign = await created.json();
  const day = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(
    new Date(),
  );
  await request.put(`/api/campaigns/${campaign.id}/spend`, { data: { day, amount: 150 } });
  await page.goto('/#rules');
  await page.getByRole('combobox', { name: 'Selecionar operação' }).selectOption('workspace');
  await page.getByRole('button', { name: 'Nova regra', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('combobox', { name: 'Modelo', exact: true }).selectOption('stop');
  await expect(dialog.getByLabel(/Ativar ao salvar/)).not.toBeChecked();
  await dialog.getByLabel('Nome da regra', { exact: true }).fill('Corte navegador');
  await dialog.getByLabel('Valor limite 1', { exact: true }).fill('100');
  await dialog.getByLabel('Valor limite 2', { exact: true }).fill('2');
  await dialog.getByRole('button', { name: 'Simular regra' }).click();
  await expect(dialog.locator('.rule-preview')).toContainText('Campanha regras navegador');
  await expect(dialog.locator('.rule-preview')).toContainText('Campanha local');
  await expect(dialog.locator('.rule-preview')).toContainText('Nenhuma alteração foi enviada');
  await dialog.getByRole('button', { name: 'Criar regra', exact: true }).click();
  const card = page
    .locator('.rule-card')
    .filter({ has: page.getByRole('heading', { name: 'Corte navegador', exact: true }) });
  await expect(card).toContainText('Desativada');
  await card.getByRole('button', { name: 'Editar / simular' }).click();
  await dialog.getByLabel('Nome da regra', { exact: true }).fill('Corte navegador editado');
  await dialog
    .getByRole('combobox', { name: 'Período de análise', exact: true })
    .selectOption('7d');
  await dialog.getByRole('button', { name: 'Salvar regra' }).click();
  const edited = page
    .locator('.rule-card')
    .filter({ has: page.getByRole('heading', { name: 'Corte navegador editado', exact: true }) });
  await expect(edited).toContainText('Últimos 7 dias');
  await edited.getByRole('switch').click();
  await expect(edited.getByRole('switch')).toHaveAttribute('aria-checked', 'true');
  await edited.getByRole('switch').click();
  await edited.getByRole('button', { name: 'Editar / simular' }).click();
  await page.setViewportSize({ width: 1440, height: 1050 });
  await page.screenshot({ path: 'test-results/rules-editor-desktop.png', animations: 'disabled' });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(dialog).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.screenshot({ path: 'test-results/rules-editor-mobile.png', animations: 'disabled' });
  await page.keyboard.press('Escape');
  await page.setViewportSize({ width: 1440, height: 1050 });
  await page.screenshot({
    path: 'test-results/rules-desktop.png',
    fullPage: true,
    animations: 'disabled',
  });
  await edited.getByRole('button', { name: 'Excluir', exact: true }).click();
  await expect(edited).toHaveCount(0);
});

test('resume template offers a Brasília schedule and an empty condition list', async ({ page }) => {
  await page.goto('/#rules');
  await page.getByRole('button', { name: 'Nova regra', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('combobox', { name: 'Modelo', exact: true }).selectOption('resume');
  await expect(
    dialog.getByLabel('Horário diário (opcional, Brasília)', { exact: true }),
  ).toHaveValue('07:00');
  await expect(dialog.getByRole('combobox', { name: 'Ação', exact: true })).toHaveValue('resume');
  await expect(dialog.getByLabel(/Ativar ao salvar/)).not.toBeChecked();
  await expect(dialog.locator('.rule-condition-row')).toHaveCount(0);
  await dialog.getByRole('button', { name: 'Simular regra' }).click();
  await expect(dialog.locator('.rule-preview')).toBeVisible();
  await page.keyboard.press('Escape');
});

test('campaign rules choose an action and combine conditions in one sentence', async ({ page }) => {
  await page.goto('/#rules');
  await page.getByRole('button', { name: 'Nova regra', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('radio', { name: /Alerta no painel/ })).toBeChecked();
  await dialog.getByRole('radio', { name: /Regra de campanha/ }).check();
  await expect(dialog.getByRole('combobox', { name: 'Ação', exact: true })).toHaveValue('stop');
  await dialog.getByRole('combobox', { name: 'Ação', exact: true }).selectOption('increase_budget');
  await expect(dialog.getByLabel('Percentual', { exact: true })).toHaveValue('20');
  await dialog.getByRole('button', { name: 'Adicionar outra condição' }).click();
  await expect(dialog.locator('.rule-condition-row')).toHaveCount(2);
  await expect(dialog.locator('.rule-sentence')).toContainText('Subir orçamento 20%');
  await expect(dialog.locator('.rule-sentence')).toContainText('quando CPA');
  await expect(dialog.locator('.rule-sentence')).toContainText('quando Investimento');
  await page.keyboard.press('Escape');
});
