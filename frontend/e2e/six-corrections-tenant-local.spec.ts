import { expect, test } from '@playwright/test';

test('una organización por tenant: módulo legacy inaccesible y ficha institucional real', async ({ page, request }, testInfo) => {
  const base = new URL(String(testInfo.project.use.baseURL || ''));
  const password = process.env.PRAVIA_E2E_PASSWORD;
  if (base.hostname !== '127.0.0.1' || base.port !== '5176' || !password) {
    throw new Error('SIX_CORRECTIONS_LOCAL_BROWSER_ONLY');
  }
  const health = await request.get('/api/health');
  expect(await health.json()).toMatchObject({ database: 'ok', storage: 'ok', database_mode: 'local', storage_mode: 'local' });

  await page.goto('/login');
  await expect(page.getByRole('heading', { name: 'Bienvenido a PRAVIA OS' })).toBeVisible();
  const email = page.getByRole('textbox', { name: 'Correo electrónico' });
  await email.fill('adrian.hernandez@pravia.test');
  await page.getByRole('textbox', { name: 'Contraseña', exact: true }).fill(password);
  if (await email.inputValue() !== 'adrian.hernandez@pravia.test') await email.fill('adrian.hernandez@pravia.test');
  await expect(page.getByRole('button', { name: 'Iniciar sesión', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Iniciar sesión', exact: true }).click();
  await page.waitForURL('**/mi-dia');
  await expect(page.getByRole('link', { name: 'Notarías', exact: true })).toHaveCount(0);

  await page.goto('/notarias');
  await expect(page).toHaveURL(/\/configuracion\/organizacion$/);
  await expect(page.getByRole('heading', { name: 'Ficha de la organización' })).toBeVisible();
  await expect(page.getByLabel('Número notarial')).toBeVisible();
  await expect(page.getByLabel('Titular')).toBeVisible();
  await expect(page.getByLabel('Domicilio institucional')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Editar organización' })).toBeVisible();

  await page.goto('/notarias/legacy-uuid');
  await expect(page).toHaveURL(/\/configuracion\/organizacion$/);

  await page.goto('/cumplimiento?notaria_id=legacy-uuid');
  await expect(page.getByRole('heading', { name: 'CUMPLIMIENTO' })).toBeVisible();
  await page.getByText('Más filtros').click();
  await expect(page.getByLabel('Notaría', { exact: true })).toHaveCount(0);
});
