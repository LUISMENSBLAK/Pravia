import { expect, test } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const expedienteId = '7a139000-0000-4000-8000-000000000001';

test('Expediente distingue corte de red, retiene la selección y reintenta sin duplicar', async ({ page, request }, testInfo) => {
  const base = new URL(String(testInfo.project.use.baseURL || ''));
  const password = process.env.PRAVIA_E2E_PASSWORD;
  if (base.hostname !== '127.0.0.1' || !password) throw new Error('LOCAL_UPLOAD_RETRY_SAFETY_GATE_FAILED');
  const health = await request.get('/api/health');
  expect(await health.json()).toMatchObject({ database_mode: 'local', storage_mode: 'local' });
  await page.goto('/login');
  await expect(page.getByRole('heading', { name: 'Bienvenido a PRAVIA OS' })).toBeVisible();
  const email = page.getByRole('textbox', { name: 'Correo electrónico' });
  await email.fill('adrian.hernandez@pravia.test');
  await page.getByRole('textbox', { name: 'Contraseña', exact: true }).fill(password);
  if (await email.inputValue() !== 'adrian.hernandez@pravia.test') await email.fill('adrian.hernandez@pravia.test');
  await expect(page.getByRole('button', { name: 'Iniciar sesión', exact: true })).toBeEnabled();
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
  body.write(randomUUID(), body.length - 36, 'utf8');
  const name = `qa-retry-${Date.now()}.png`;
  await page.locator('input[type="file"][multiple][accept*=".pdf"]').first().setInputFiles({ name, mimeType: 'image/png', buffer: body });
  await expect(page.getByRole('alert')).toContainText('Error de conexión');
  await expect(page.getByRole('button', { name: 'Reintentar carga' })).toBeVisible();
  const uploaded = page.waitForResponse((response) => response.url().endsWith(`/expedientes/${expedienteId}/documentos/carga-lote`) && response.request().method() === 'POST');
  await page.getByRole('button', { name: 'Reintentar carga' }).click();
  const uploadResponse = await uploaded;
  expect(uploadResponse.status()).toBe(201);
  expect(await uploadResponse.json()).toMatchObject({ created: 1, uploaded_blobs: 1 });
  expect(attempts).toBe(2);
  await expect(page.getByText(name, { exact: true })).toHaveCount(1);
  await page.reload();
  await expect(page.getByText(name, { exact: true })).toHaveCount(1);
  await page.getByText(name, { exact: true }).click();
  await page.getByRole('button', { name: 'Visualizar' }).click();
  const preview = page.getByRole('img', { name: `Vista previa de ${name}` });
  await expect(preview).toHaveAttribute('data-preview-loaded', 'true');
  expect(await preview.evaluate((image) => (image as HTMLImageElement).naturalWidth)).toBe(1);
});

test('Expediente acepta un archivo real en el límite de 50 MiB y conserva el vínculo tras reload', async ({ page, request }, testInfo) => {
  test.setTimeout(120_000);
  const base = new URL(String(testInfo.project.use.baseURL || ''));
  const password = process.env.PRAVIA_E2E_PASSWORD;
  if (base.hostname !== '127.0.0.1' || !password) throw new Error('LOCAL_UPLOAD_LIMIT_SAFETY_GATE_FAILED');
  const health = await request.get('/api/health');
  expect(await health.json()).toMatchObject({ database_mode: 'local', storage_mode: 'local' });
  await page.goto('/login');
  await expect(page.getByRole('heading', { name: 'Bienvenido a PRAVIA OS' })).toBeVisible();
  const email = page.getByRole('textbox', { name: 'Correo electrónico' });
  await email.fill('adrian.hernandez@pravia.test');
  await page.getByRole('textbox', { name: 'Contraseña', exact: true }).fill(password);
  if (await email.inputValue() !== 'adrian.hernandez@pravia.test') await email.fill('adrian.hernandez@pravia.test');
  await expect(page.getByRole('button', { name: 'Iniciar sesión', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Iniciar sesión', exact: true }).click();
  await page.waitForURL('**/mi-dia');
  await page.goto(`/expedientes/${expedienteId}#documentos`);
  await expect(page.getByRole('heading', { name: 'Explorador documental' })).toBeVisible();

  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLytQAAAABJRU5ErkJggg==', 'base64');
  const body = Buffer.concat([png, Buffer.alloc(50 * 1024 * 1024 - png.length)]);
  body.write(randomUUID(), body.length - 36, 'utf8');
  const name = `qa-50mib-${Date.now()}.png`;
  const temporaryDirectory = await mkdtemp(join(tmpdir(), 'pravia-upload-limit-'));
  try {
    const path = join(temporaryDirectory, name);
    await writeFile(path, body);
    const uploaded = page.waitForResponse((response) => response.url().endsWith(`/expedientes/${expedienteId}/documentos/carga-lote`) && response.request().method() === 'POST');
    await page.locator('input[type="file"][multiple][accept*=".pdf"]').first().setInputFiles(path);
    const uploadResponse = await uploaded;
    expect(uploadResponse.status()).toBe(201);
    expect(await uploadResponse.json()).toMatchObject({ created: 1, uploaded_blobs: 1 });
    await expect(page.getByText(name, { exact: true })).toHaveCount(1);
    await page.reload();
    await expect(page.getByText(name, { exact: true })).toHaveCount(1);
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
});
