import { expect, test } from '@playwright/test';

const expedienteId = '7a139000-0000-4000-8000-000000000001';

test('Expediente distingue corte de red, retiene la selección y reintenta sin duplicar', async ({ page, request }, testInfo) => {
  const base = new URL(String(testInfo.project.use.baseURL || ''));
  const password = process.env.PRAVIA_E2E_PASSWORD;
  if (base.hostname !== '127.0.0.1' || !password) throw new Error('LOCAL_UPLOAD_RETRY_SAFETY_GATE_FAILED');
  const health = await request.get('/api/health');
  expect(await health.json()).toMatchObject({ database_mode: 'local', storage_mode: 'local' });
  await page.goto('/login');
  await page.getByRole('textbox', { name: 'Correo electrónico' }).fill('adrian.hernandez@pravia.test');
  await page.getByRole('textbox', { name: 'Contraseña', exact: true }).fill(password);
  await page.getByRole('button', { name: 'Iniciar sesión', exact: true }).click();
  await page.waitForURL('**/mi-dia');
  await page.goto(`/expedientes/${expedienteId}#documentos`);
  await expect(page.getByRole('heading', { name: 'Explorador documental' })).toBeVisible();

  let attempts = 0;
  await page.route(`**/api/expedientes/${expedienteId}/documentos/carga-lote`, async (route) => {
    attempts += 1;
    if (attempts === 1) await route.abort('internetdisconnected');
    else await route.continue();
  });
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLytQAAAABJRU5ErkJggg==', 'base64');
  const body = Buffer.concat([png, Buffer.alloc(100 * 1024 - png.length)]);
  const name = `qa-retry-${Date.now()}.png`;
  await page.locator('input[type="file"][multiple][accept*=".pdf"]').first().setInputFiles({ name, mimeType: 'image/png', buffer: body });
  await expect(page.getByRole('alert')).toContainText('Error de conexión');
  await expect(page.getByRole('button', { name: 'Reintentar carga' })).toBeVisible();
  const uploaded = page.waitForResponse((response) => response.url().endsWith(`/expedientes/${expedienteId}/documentos/carga-lote`) && response.request().method() === 'POST');
  await page.getByRole('button', { name: 'Reintentar carga' }).click();
  expect((await uploaded).status()).toBe(201);
  expect(attempts).toBe(2);
  await expect(page.getByText(name, { exact: true })).toHaveCount(1);
  await page.reload();
  await expect(page.getByText(name, { exact: true })).toHaveCount(1);
});
