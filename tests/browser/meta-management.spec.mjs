import { test, expect } from '@playwright/test';

test.beforeEach(async ({ request }) => {
  await expect
    .poll(async () => {
      try {
        return (await request.get('/api/health')).ok();
      } catch {
        return false;
      }
    })
    .toBe(true);
});

async function fixture(page, options = {}) {
  const writes = [];
  const entity = {
    name: 'Campanha de avaliação',
    account_id: 'act_123',
    account_name: 'Conta de avaliação',
    external_id: '100',
    status: 'ACTIVE',
    effective_status: 'ACTIVE',
    active: true,
    editable: true,
    budget_type: 'daily',
    budget: 50,
    can_edit_budget: true,
    currency: 'BRL',
    revision: 'a'.repeat(64),
    ...options.entity,
  };
  await page.route(/\/api\/ad-hierarchy\?/, (route) =>
    route.fulfill({
      json: {
        rows: [
          {
            id: 'managed',
            external_id: entity.external_id,
            account_id: entity.account_id,
            name: entity.name,
            source: 'facebook',
            budget: entity.budget,
            active: Number(entity.active),
            currency: entity.currency,
            revenue: 0,
            spend: 0,
            roas: 0,
            sales: 0,
            cpa: 0,
            clicks: 0,
          },
        ],
      },
    }),
  );
  await page.route(/\/api\/meta\/entities\/campaigns\/managed(?:\?|$)/, async (route) => {
    if (route.request().method() === 'GET') return route.fulfill({ json: entity });
    writes.push(route.request().postDataJSON());
    return route.fulfill(
      options.reject
        ? { status: 409, json: { error: 'Este item mudou na Meta. Reabra a edição.' } }
        : { json: { confirmed: true } },
    );
  });
  await page.goto('/app');
  await page.getByRole('combobox', { name: 'Selecionar operação' }).selectOption('workspace');
  await page.getByRole('button', { name: 'Campanhas', exact: true }).click();
  return { writes, entity, dialog: page.getByRole('dialog') };
}

test('Meta editor requires account confirmation and sends the displayed revision and changed fields', async ({
  page,
}) => {
  const f = await fixture(page);
  await page.getByRole('button', { name: 'Editar Campanha de avaliação na Meta' }).click();
  await expect(f.dialog.getByText('Conta de avaliação', { exact: true })).toBeVisible();
  await expect(f.dialog.getByRole('button', { name: 'Salvar na Meta' })).toBeDisabled();
  await f.dialog.getByRole('textbox', { name: 'Nome', exact: true }).fill('Campanha renomeada');
  await f.dialog.getByRole('spinbutton', { name: /Orçamento diário/ }).fill('67.15');
  await f.dialog.getByRole('button', { name: 'Salvar na Meta' }).click();
  expect(f.writes).toHaveLength(0);
  await expect(f.dialog.getByRole('checkbox')).not.toBeChecked();
  await f.dialog.getByRole('checkbox').check();
  await f.dialog.getByRole('button', { name: 'Salvar na Meta' }).click();
  await expect(page.getByRole('status')).toContainText('Alteração confirmada na Meta.');
  await expect(f.dialog).toHaveCount(0);
  expect(f.writes).toEqual([
    {
      project_id: 'workspace',
      expected_revision: f.entity.revision,
      name: 'Campanha renomeada',
      budget: 67.15,
    },
  ]);
});

test('Meta status switch opens a confirmation and keeps conflicts visible without local success', async ({
  page,
}) => {
  const f = await fixture(page, { reject: true });
  await page.getByRole('switch', { name: 'Pausar Campanha de avaliação na Meta' }).click();
  await expect(f.dialog.getByRole('combobox', { name: 'Status', exact: true })).toHaveValue(
    'false',
  );
  expect(f.writes).toHaveLength(0);
  await f.dialog.getByRole('checkbox').check();
  await f.dialog.getByRole('button', { name: 'Salvar na Meta' }).click();
  await expect(f.dialog.getByRole('alert')).toContainText('Este item mudou na Meta');
  await expect(
    page.getByRole('switch', { name: 'Pausar Campanha de avaliação na Meta' }),
  ).toBeChecked();
  expect(f.writes).toEqual([
    { project_id: 'workspace', expected_revision: f.entity.revision, active: false },
  ]);
  f.entity.active = false;
  f.entity.status = 'PAUSED';
  f.entity.revision = 'b'.repeat(64);
  await f.dialog.getByRole('button', { name: 'Consultar valores atuais novamente' }).click();
  await expect(f.dialog.getByRole('button', { name: 'Salvar na Meta' })).toBeDisabled();
  await expect(f.dialog.getByRole('checkbox')).not.toBeChecked();
});

test('Meta editor distinguishes lifetime and inherited budgets', async ({ page }) => {
  const f = await fixture(page, { entity: { budget_type: 'lifetime', budget: 300 } });
  await page.getByRole('button', { name: 'Editar Campanha de avaliação na Meta' }).click();
  await expect(f.dialog.getByRole('spinbutton', { name: /Orçamento total/ })).toHaveValue('300');
  await expect(f.dialog.getByRole('spinbutton', { name: /Orçamento diário/ })).toHaveCount(0);
  await f.dialog.getByRole('button', { name: 'Cancelar', exact: true }).click();
  f.entity.budget_type = 'inherited';
  f.entity.can_edit_budget = false;
  await page.getByRole('button', { name: 'Editar Campanha de avaliação na Meta' }).click();
  await expect(f.dialog.getByText(/Esta campanha utiliza orçamento nos conjuntos/)).toBeVisible();
  await expect(f.dialog.getByRole('spinbutton')).toHaveCount(0);
  expect(f.writes).toHaveLength(0);
});

test('USD editor labels and submits dollar budgets', async ({ page }) => {
  const f = await fixture(page, { entity: { currency: 'USD', budget: 12.5 } });
  await page.getByRole('button', { name: 'Editar Campanha de avaliação na Meta' }).click();
  await expect(f.dialog.getByRole('spinbutton', { name: 'Orçamento diário (US$)' })).toHaveValue(
    '12.5',
  );
  await expect(f.dialog.getByText(/Atual: US/)).toContainText('12,50');
  await f.dialog.getByRole('spinbutton').fill('17.23');
  await f.dialog.getByRole('checkbox').check();
  await f.dialog.getByRole('button', { name: 'Salvar na Meta' }).click();
  await expect(page.getByRole('status')).toContainText('Alteração confirmada na Meta.');
  expect(f.writes[0].budget).toBe(17.23);
});
