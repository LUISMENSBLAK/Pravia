import { expect, test } from '@playwright/test';
import { signInLocalControlPlane } from './helpers/controlPlaneLogin';

test('platform administrator sees operational metadata and an anonymous caller is denied', async ({ page, request }) => {
  const base = new URL(process.env.PRAVIA_E2E_BASE_URL || 'http://invalid.invalid');
  const database = new URL(process.env.DATABASE_URL || 'http://invalid.invalid');
  if (base.hostname !== '127.0.0.1' || base.port !== '4176'
    || database.hostname !== '127.0.0.1' || process.env.STORAGE_MODE !== 'local'
    || !process.env.PRAVIA_E2E_PASSWORD) throw new Error('CONTROL_PLANE_BROWSER_QA_LOCAL_ONLY');

  await signInLocalControlPlane(page, process.env.PRAVIA_E2E_PASSWORD);

  await page.goto('/plataforma');
  await expect(page.getByRole('heading', { name: 'Operación de plataforma' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Jobs fallidos' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Migraciones con atención' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Backups con atención' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Webhooks de facturación' })).toBeVisible();

  for (const width of [1440, 390, 320]) {
    await page.setViewportSize({ width, height: 820 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  }
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Operación de plataforma' })).toBeVisible();

  const unauthenticated = await request.get('/api/platform/admin/dashboard');
  expect(unauthenticated.status()).toBe(401);
});
