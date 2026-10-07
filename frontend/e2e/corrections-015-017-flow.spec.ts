import { expect, test } from '@playwright/test';

const qaEmail = process.env.PRAVIA_E2E_EMAIL || 'qa.correcciones@pravia.test';
const qaPassword = process.env.PRAVIA_E2E_PASSWORD || '';
const qaActName = 'QA MULTIACTO SEGUNDO';

test('corrección 015: los dos actos del prospecto llegan a la cotización canónica', async ({ page, request }, testInfo) => {
  const base = new URL(String(testInfo.project.use.baseURL || ''));
  if (base.hostname !== '127.0.0.1' || !qaPassword) throw new Error('LOCAL_MULTIACT_QA_SAFETY_GATE_FAILED');
  expect(await (await request.get('/api/health')).json()).toMatchObject({ database_mode: 'local', storage_mode: 'local' });
  const apiLogin = await request.post('/api/auth/login', { data: { email: qaEmail, password: qaPassword } });
  expect(apiLogin.status()).toBe(200);
  const headers = { Authorization: `Bearer ${String((await apiLogin.json()).access_token)}` };
  const catalog = await request.get(`/api/settings/catalogs/acts?search=${encodeURIComponent(qaActName)}`, { headers });
  expect(catalog.status()).toBe(200);
  const existing = (await catalog.json()).data.data.find((act: { nombre: string }) => act.nombre === qaActName);
  const fixture = existing
    ? await request.patch(`/api/settings/catalogs/acts/${existing.id}`, { headers, data: { activo: true } })
    : await request.post('/api/settings/catalogs/acts', { headers, data: { nombre: qaActName, clasificacion: 'NO TRASLATIVOS', familia: 'QA' } });
  expect(fixture.ok()).toBeTruthy();
  const fixtureId = existing?.id || (await fixture.json()).data.id;

  await page.goto('/login');
  const email = page.getByRole('textbox', { name: 'Correo electrónico' });
  await email.fill(qaEmail);
  await page.getByRole('textbox', { name: 'Contraseña', exact: true }).fill(qaPassword);
  await email.fill(qaEmail);
  await page.getByRole('button', { name: 'Iniciar sesión', exact: true }).click();
  await page.waitForURL('**/mi-dia');
  await page.goto('/prospectos');

  const name = `QA MULTIACTO ${Date.now()}`;
  await page.getByRole('button', { name: 'Nuevo prospecto' }).click();
  await page.getByLabel(/Nombre o razón social/).fill(name);
  await page.getByRole('button', { name: 'Crear prospecto' }).click();
  await expect(page.getByRole('heading', { name, exact: true })).toBeVisible();
  const prospectId = page.url().split('/').pop()!;

  const summary = page.getByRole('heading', { name: 'Resumen' }).locator('..').locator('..').locator('..');
  await summary.getByRole('button', { name: 'Editar datos' }).click();
  await summary.getByRole('checkbox', { name: 'Compraventa', exact: true }).check();
  await summary.getByRole('checkbox', { name: qaActName, exact: true }).check();
  await summary.getByRole('button', { name: 'Guardar' }).click();
  await expect(summary.getByRole('button', { name: 'Editar datos' })).toBeVisible();

  await page.getByRole('button', { name: 'Comenzar integración' }).click();
  await page.getByRole('group', { name: 'Confirmar acción' }).getByRole('button', { name: 'Confirmar' }).click();
  await page.getByRole('button', { name: 'Marcar listo para cotizar' }).click();
  const confirmation = page.getByRole('group', { name: 'Confirmar acción' });
  const assignee = confirmation.getByRole('combobox', { name: /Quién continuará con la cotización/i });
  const option = (await assignee.locator('option').allTextContents()).find((label) => label.includes('Hernández'));
  expect(option).toBeTruthy();
  await assignee.selectOption({ label: option });
  await confirmation.getByRole('button', { name: 'Confirmar' }).click();
  await page.getByRole('button', { name: 'Convertir en cotización' }).click();
  await page.getByRole('group', { name: 'Confirmar acción' }).getByRole('button', { name: 'Confirmar' }).click();
  await page.waitForURL(/\/cotizaciones\/[0-9a-f-]+$/);
  const quoteId = page.url().split('/').pop()!;
  await expect(page.getByText(/COT-\d{4}-\d{4}/).first()).toBeVisible();

  const prospect = await request.get(`/api/prospectos/${prospectId}`, { headers });
  expect(prospect.status()).toBe(200);
  expect((await prospect.json()).actos).toHaveLength(2);
  const quote = await request.get(`/api/cotizaciones/${quoteId}`, { headers });
  expect(quote.status()).toBe(200);
  expect((await quote.json()).actos).toHaveLength(2);
  await page.reload();
  await expect(page.getByText(/COT-\d{4}-\d{4}/).first()).toBeVisible();
  const deactivate = await request.patch(`/api/settings/catalogs/acts/${fixtureId}`, { headers, data: { activo: false } });
  expect(deactivate.ok()).toBeTruthy();
});
