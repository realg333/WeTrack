import { test, expect } from '@playwright/test';

test('rules show a stale external scheduler even if panel checks are recent', async ({
  page,
  request,
}) => {
  const report = await (await request.get('/api/rules?project=workspace')).json();
  await page.route('**/api/rules?**', (route) =>
    route.fulfill({
      json: {
        ...report,
        worker: { last_run: new Date().toISOString(), last_error: null },
        scheduler: {
          state: 'stale',
          interval_minutes: 5,
          source: 'github-actions',
          last_finished_at: new Date(Date.now() - 7200000).toISOString(),
          last_error: null,
        },
      },
    }),
  );
  await page.goto('/app#rules');
  await expect(page.getByText('Agendador atrasado', { exact: true })).toBeVisible();
  await expect(page.locator('.rules-worker')).toContainText(
    'GitHub Actions pode atrasar ou omitir execuções',
  );
  await expect(page.locator('.rules-worker')).toContainText('há mais de 15 minutos sem concluir');
});
