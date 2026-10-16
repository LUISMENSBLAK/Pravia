import { randomBytes } from 'node:crypto';
import { expect, test } from '@playwright/test';

test('CFDI guarda una CSF de proveedor de 100 KB desde Chrome y la conserva tras recarga', async ({ page, request }, testInfo) => {
  const base = new URL(String(testInfo.project.use.baseURL || ''));
  const password = process.env.PRAVIA_E2E_PASSWORD;
  if (base.hostname !== '127.0.0.1' || !password) throw new Error('LOCAL_CSF_UPLOAD_SAFETY_GATE_FAILED');
  const health = await request.get('/api/health');
  expect(await health.json()).toMatchObject({ database_mode: 'local', storage_mode: 'local' });

  await page.goto('/login');
  await page.getByRole('textbox', { name: 'Correo electrónico' }).fill('adrian.hernandez@pravia.test');
  await page.getByRole('textbox', { name: 'Contraseña', exact: true }).fill(password);
  await page.getByRole('button', { name: 'Iniciar sesión', exact: true }).click();
  await page.waitForURL('**/mi-dia');
  await page.goto('/finanzas?view=facturacion');
  await page.getByRole('tab', { name: 'CFDI y cuentas' }).click();
  await page.getByRole('button', { name: 'Proveedores', exact: true }).click();
  await page.getByRole('button', { name: 'Agregar proveedor' }).click();
  const dialog = page.getByRole('dialog', { name: 'Agregar proveedor' });

  const suffix = randomBytes(2).toString('hex').slice(0, 3).toUpperCase();
  const rfc = `QAA260101${suffix}`;
  const supplierName = `Proveedor QA CSF 100 KB ${suffix}`;
  const content = Buffer.from(`RFC: ${rfc}\nDenominación/Razón Social: ${supplierName}\nCódigo Postal: 63735\nRégimen Fiscal: 601\n`);
  const file = Buffer.concat([content, Buffer.alloc(100 * 1024 - content.length, 0x20)]);
  const extracted = page.waitForResponse((response) => response.url().endsWith('/facturacion/proveedores/csf/extraer') && response.request().method() === 'POST');
  await dialog.getByLabel('Constancia de situación fiscal').setInputFiles({ name: `csf-${suffix}.txt`, mimeType: 'text/plain', buffer: file });
  expect((await extracted).status()).toBe(200);
  await dialog.getByLabel('Razón social').fill(supplierName);
  await dialog.getByLabel('RFC').fill(rfc);
  await dialog.getByLabel('Código postal fiscal').fill('63735');
  await dialog.getByLabel('Régimen fiscal').fill('601');
  await dialog.getByRole('checkbox', { name: 'Confirmé los datos fiscales con el documento' }).check();

  const saved = page.waitForResponse((response) => response.url().endsWith('/facturacion/proveedores') && response.request().method() === 'POST');
  await dialog.getByRole('button', { name: 'Guardar proveedor' }).click();
  const response = await saved;
  expect(response.status(), await response.text()).toBe(201);
  const supplier = (await response.json()).data.supplier;
  expect(supplier.csf_documento_id).toBeTruthy();
  await expect(page.getByText(supplierName, { exact: true })).toBeVisible();

  await page.reload();
  await page.getByRole('tab', { name: 'CFDI y cuentas' }).click();
  await page.getByRole('button', { name: 'Proveedores', exact: true }).click();
  await expect(page.getByText(supplierName, { exact: true })).toBeVisible();
  const apiLogin = await request.post('/api/auth/login', { data: { email: 'adrian.hernandez@pravia.test', password } });
  expect(apiLogin.status()).toBe(200);
  const authorization = { Authorization: `Bearer ${(await apiLogin.json()).access_token}` };
  const document = await request.get(`/api/documentos/${supplier.csf_documento_id}/url`, { headers: authorization });
  expect(document.status()).toBe(200);
  const downloadUrl = new URL((await document.json()).url, base);
  expect(['localhost', '127.0.0.1']).toContain(downloadUrl.hostname);
  const downloaded = await request.get(downloadUrl.toString());
  expect(downloaded.status()).toBe(200);
  expect(Buffer.from(await downloaded.body())).toEqual(file);
});
