import { test, expect } from '@playwright/test';

test('create, rename and switch workspaces with clean reports and independent integrations', async ({
  page,
  request,
}) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/');
  const selector = page.getByRole('combobox', { name: 'Selecionar operação' });
  await selector.selectOption('demo');
  await expect(page.locator('.metric-value').first()).not.toHaveText('R$ 0,00');
  await page.getByRole('button', { name: 'Novo workspace', exact: true }).click();
  const name = `Workspace novo ${Date.now()}`;
  await page.getByRole('textbox', { name: 'Nome do workspace', exact: true }).fill(name);
  await page.screenshot({ path: 'test-results/workspace-create.png', animations: 'disabled' });
  await page.getByRole('button', { name: 'Criar workspace', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.locator('.workspace-select strong')).toHaveText(name);
  await expect(page.getByRole('heading', { name: 'Seu workspace está pronto.' })).toBeVisible();
  await expect(page.locator('.metric-value').first()).toHaveText('R$ 0,00');
  await page.screenshot({
    path: 'test-results/workspace-clean.png',
    fullPage: true,
    animations: 'disabled',
  });
  const id = await selector.inputValue();
  expect(id).toMatch(/^ws_/);
  await page.reload();
  await expect(selector).toHaveValue(id);
  await expect(page.locator('.workspace-select strong')).toHaveText(name);
  await page.getByRole('button', { name: 'Configurar integrações' }).click();
  await expect(page.getByRole('heading', { name: 'Conecte seu perfil do Facebook' })).toBeVisible();
  await page.getByRole('tab', { name: 'Pixel de rastreio' }).click();
  await expect(page.locator('.pixel-card')).toHaveCount(0);
  await page.getByRole('button', { name: 'Novo pixel', exact: true }).click();
  await page.getByRole('textbox', { name: 'Nome do pixel' }).fill('Pixel do workspace novo');
  await page
    .getByRole('textbox', { name: 'Domínio autorizado' })
    .fill('https://workspace.example.com');
  await page.getByRole('button', { name: 'Criar pixel', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Pixel do workspace novo', exact: true }),
  ).toBeVisible();
  await selector.selectOption('demo');
  await page.getByRole('tab', { name: 'Pixel de rastreio' }).click();
  await expect(page.getByRole('heading', { name: 'Pixel principal', exact: true })).toBeVisible();
  await expect(
    page.getByRole('heading', { name: 'Pixel do workspace novo', exact: true }),
  ).toHaveCount(0);
  await selector.selectOption(id);
  await page.getByRole('button', { name: 'Configurações', exact: true }).click();
  await page.getByRole('button', { name: 'Gerenciar workspaces' }).click();
  await page.getByRole('textbox', { name: 'Buscar workspaces' }).fill(name);
  await expect(page.locator('.workspace-directory-row')).toHaveCount(1);
  await page.getByRole('button', { name: `Renomear ${name}`, exact: true }).click();
  const renamed = `${name} renomeado`;
  await page.getByRole('textbox', { name: 'Nome do workspace', exact: true }).fill(renamed);
  await page.getByRole('button', { name: 'Salvar nome' }).click();
  await expect(page.locator('.workspace-select strong')).toHaveText(renamed);
  await page.reload();
  await expect(page.locator('.workspace-select strong')).toHaveText(renamed);
  await page.getByRole('button', { name: 'Novo workspace', exact: true }).click();
  await page
    .getByRole('textbox', { name: 'Nome do workspace', exact: true })
    .fill(renamed.toLocaleUpperCase('pt-BR'));
  await page.getByRole('button', { name: 'Criar workspace', exact: true }).click();
  await expect(page.getByRole('alert')).toHaveText('Já existe um workspace com esse nome.');
  await page.getByRole('button', { name: 'Cancelar', exact: true }).click();
  const persisted = await (await request.get(`/api/integrations?project=${id}`)).json();
  expect(persisted.pixels).toHaveLength(1);
  expect(errors).toEqual([]);
});

test('late dashboard responses cannot bring data back from a previous workspace', async ({
  page,
  request,
}) => {
  const created = await request.post('/api/projects', { data: { name: `Corrida ${Date.now()}` } });
  const { id } = await created.json();
  await page.goto('/');
  const selector = page.getByRole('combobox', { name: 'Selecionar operação' });
  await selector.selectOption('demo');
  await expect(page.locator('.metric-value').first()).not.toHaveText('R$ 0,00');
  let release;
  let captured;
  const pending = new Promise((resolve) => {
    captured = resolve;
  });
  const blocked = new Promise((resolve) => {
    release = resolve;
  });
  await page.route('**/api/dashboard?**', async (route) => {
    if (new URL(route.request().url()).searchParams.get('project') === 'demo') {
      const response = await route.fetch();
      captured();
      await blocked;
      await route.fulfill({ response });
    } else await route.continue();
  });
  await page.getByRole('button', { name: 'Atualizar dados', exact: true }).click();
  await pending;
  await selector.selectOption(id);
  await expect(page.locator('.metric-value').first()).toHaveText('R$ 0,00');
  const late = page.waitForResponse(
    (r) =>
      r.url().includes('/api/dashboard?') &&
      new URL(r.url()).searchParams.get('project') === 'demo',
  );
  release();
  await late;
  await expect(selector).toHaveValue(id);
  await expect(page.locator('.metric-value').first()).toHaveText('R$ 0,00');
  await expect(page.locator('.recent-sales tbody tr')).toHaveCount(0);
});

test('workspace creation fits a mobile viewport and keeps the active operation visible', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await page.getByRole('button', { name: 'Abrir navegação', exact: true }).click();
  await page.getByRole('button', { name: 'Novo workspace', exact: true }).click();
  const name = `Mobile ${Date.now()}`;
  await page.getByRole('textbox', { name: 'Nome do workspace', exact: true }).fill(name);
  await page.getByRole('button', { name: 'Criar workspace', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Seu workspace está pronto.' })).toBeVisible();
  await expect(page.locator('.workspace-breadcrumb')).toHaveText(name);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({
    path: 'test-results/workspace-mobile.png',
    fullPage: true,
    animations: 'disabled',
  });
});
