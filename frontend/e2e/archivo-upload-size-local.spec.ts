import { expect, test } from '@playwright/test';

const expedienteId = '7a139000-0000-4000-8000-000000000001';

test('Archivo conserva un apéndice de 100 KB tras recarga y descarga exacta', async ({ page, request }, testInfo) => {
  const base = new URL(String(testInfo.project.use.baseURL || ''));
  const password = process.env.PRAVIA_E2E_PASSWORD;
  if (base.hostname !== '127.0.0.1' || !password) throw new Error('LOCAL_ARCHIVO_UPLOAD_SAFETY_GATE_FAILED');
  const health = await request.get('/api/health');
  expect(await health.json()).toMatchObject({ database_mode: 'local', storage_mode: 'local' });

  await page.goto('/login');
  const email = page.getByRole('textbox', { name: 'Correo electrónico' });
  const passwordInput = page.getByRole('textbox', { name: 'Contraseña', exact: true });
  await email.fill('adrian.hernandez@pravia.test');
  await passwordInput.fill(password);
  // La verificación inicial de sesión puede remontar el formulario entre ambos fills.
  if (await email.inputValue() !== 'adrian.hernandez@pravia.test') await email.fill('adrian.hernandez@pravia.test');
  if (await passwordInput.inputValue() !== password) await passwordInput.fill(password);
  await expect(page.getByRole('button', { name: 'Iniciar sesión', exact: true })).toBeEnabled();
  const loginResponse = page.waitForResponse((response) => response.url().endsWith('/api/auth/login') && response.request().method() === 'POST');
  await page.getByRole('button', { name: 'Iniciar sesión', exact: true }).click();
  const login = await loginResponse;
  expect(login.status()).toBe(200);
  expect((await login.json()).access_token).toBeTruthy();

  await page.goto(`/expedientes/${expedienteId}#archivo`);
  const appendix = page.getByRole('region', { name: 'Apéndice de la escritura' });
  await expect(appendix).toBeVisible();
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLytQAAAABJRU5ErkJggg==', 'base64');
  const body = Buffer.concat([png, Buffer.alloc(100 * 1024 - png.length)]);
  const name = `apendice-100kb-${Date.now()}.png`;
  const uploaded = page.waitForResponse((response) => response.url().endsWith(`/expedientes/${expedienteId}/archivo/apendice`) && response.request().method() === 'POST');
  await appendix.getByLabel('Agregar documentos').setInputFiles({ name, mimeType: 'image/png', buffer: body });
  expect((await uploaded).status()).toBe(201);
  await expect(appendix.getByText(name)).toBeVisible();

  await page.reload();
  await expect(page.getByRole('region', { name: 'Apéndice de la escritura' }).getByText(name)).toBeVisible();
  // Reload rotates the browser session; obtain a fresh token for the direct API check.
  const apiLogin = await request.post('/api/auth/login', { data: { email: 'adrian.hernandez@pravia.test', password } });
  expect(apiLogin.status()).toBe(200);
  const authorization = { Authorization: `Bearer ${(await apiLogin.json()).access_token}` };
  const archive = await request.get(`/api/expedientes/${expedienteId}/archivo`, { headers: authorization });
  expect(archive.status()).toBe(200);
  const item = (await archive.json()).appendix.find((entry: { documento: { nombre_original: string } }) => entry.documento.nombre_original === name);
  expect(item.documento.size_bytes).toBe(body.length);
  const downloaded = await request.get(`/api/expedientes/${expedienteId}/archivo/apendice/${item.id}/descargar`, { headers: authorization });
  expect(downloaded.status()).toBe(200);
  expect(Buffer.from(await downloaded.body())).toEqual(body);
});
