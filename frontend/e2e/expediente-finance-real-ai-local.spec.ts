import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { basename } from 'node:path';

const caseId = '7a139000-0000-4000-8000-000000000001';
const receipt = '/tmp/pravia-pre-release-income-qa-20261005.pdf';

test('OpenAI real: comprobante QA propone monto editable y conserva decisión humana', async ({ page }, testInfo) => {
  const base = new URL(String(testInfo.project.use.baseURL || ''));
  const password = process.env.PRAVIA_E2E_PASSWORD;
  if (base.hostname !== '127.0.0.1' || !password) throw new Error('LOCAL_AI_QA_SAFETY_GATE_FAILED');
  const health = await page.request.get('/api/health');
  expect(health.status()).toBe(200);
  const runtime = await health.json();
  expect(runtime).toMatchObject({ database_mode: 'local', database_primary: 'local', storage_mode: 'local', storage_primary: 'local' });

  await page.goto('/login');
  const email = page.getByRole('textbox', { name: 'Correo electrónico' });
  await email.fill('adrian.hernandez@pravia.test');
  await page.getByRole('textbox', { name: 'Contraseña', exact: true }).fill(password);
  if (await email.inputValue() !== 'adrian.hernandez@pravia.test') await email.fill('adrian.hernandez@pravia.test');
  await expect(page.getByRole('button', { name: 'Iniciar sesión', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Iniciar sesión', exact: true }).click();
  await page.waitForURL('**/mi-dia');
  await page.goto(`/expedientes/${caseId}#finanzas`);
  await page.getByRole('button', { name: 'Reportar ingreso' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Comprobante del ingreso').setInputFiles(receipt);
  const extraction = page.waitForResponse((response) => response.url().includes('/finanzas-operativas/ingresos/ia/vista-previa') && response.request().method() === 'POST', { timeout: 180_000 });
  await dialog.getByRole('button', { name: 'Llenar con IA' }).click();
  const response = await extraction;
  expect(response.status(), await response.text()).toBe(200);
  const proposal = await response.json();
  expect(proposal.monto_reportado, JSON.stringify(proposal)).toBe('12345.67');
  await expect(dialog.getByLabel('Monto reportado (opcional)')).toHaveValue('12345.67');
  await expect(dialog.getByRole('status')).toContainText('Revisa y corrige');

  const concept = `QA proveedor real IA ${Date.now()}`;
  await dialog.getByLabel('Concepto o contexto').fill(concept);
  await dialog.getByLabel('Monto reportado (opcional)').fill('12300.67');
  await dialog.locator('select[name="facturar_a_vinculo_id"]').selectOption({ index: 1 });
  await dialog.locator('select[name="forma_pago"]').selectOption('TRANSFERENCIA');
  const report = page.waitForResponse((item) => item.url().endsWith('/finanzas-operativas/ingresos') && item.request().method() === 'POST');
  await dialog.getByRole('button', { name: 'Registrar ingreso' }).click();
  const saved = await report;
  expect(saved.status(), await saved.text()).toBe(201);
  await page.reload();
  const row = page.locator('article').filter({ hasText: concept });
  // The restored finance read model can take longer than the default UI assertion timeout.
  await expect(row).toContainText('$12,300.67', { timeout: 60_000 });
  await expect(row).toContainText('Pendiente de aplicación');
});

test('OpenAI real: 10 lecturas independientes y tres formatos QA adicionales no ofrecen importe incorrecto', async ({ page }, testInfo) => {
  test.setTimeout(180_000);
  const base = new URL(String(testInfo.project.use.baseURL || ''));
  const password = process.env.PRAVIA_E2E_PASSWORD;
  if (base.hostname !== '127.0.0.1' || !password) throw new Error('LOCAL_AI_QA_SAFETY_GATE_FAILED');
  const health = await page.request.get('/api/health');
  expect(health.status()).toBe(200);
  expect(await health.json()).toMatchObject({ database_mode: 'local', database_primary: 'local', storage_mode: 'local', storage_primary: 'local' });
  await page.goto('/login');
  await page.getByRole('textbox', { name: 'Correo electrónico' }).fill('adrian.hernandez@pravia.test');
  await page.getByRole('textbox', { name: 'Contraseña', exact: true }).fill(password);
  const login = page.waitForResponse((response) => response.url().endsWith('/api/auth/login') && response.request().method() === 'POST');
  await page.getByRole('button', { name: 'Iniciar sesión', exact: true }).click();
  expect((await (await login).json()).access_token).toBeTruthy();
  await page.waitForURL('**/mi-dia');
  await page.goto(`/expedientes/${caseId}#finanzas`);
  await expect(page.getByRole('button', { name: 'Reportar ingreso' })).toBeVisible();
  const refreshed = await page.request.post('/api/auth/refresh');
  expect(refreshed.status()).toBe(200);
  let token = (await refreshed.json()).access_token;
  expect(token).toBeTruthy();
  const samples = [
    ...Array.from({ length: 10 }, () => ({ file: receipt, expected: '12345.67' })),
    { file: '/tmp/pravia-pre-release-income-multi-qa-20261006.pdf', expected: '11600.00' },
    { file: '/tmp/pravia-pre-release-income-visual-qa-20261006.pdf', expected: '789.40' },
    { file: '/tmp/pravia-pre-release-income-unreadable-qa-20261006.pdf', expected: null },
  ];
  for (const [index, sample] of samples.entries()) {
    if (index) {
      const nextSession = await page.request.post('/api/auth/refresh');
      expect(nextSession.status(), `Renovación de sesión antes de lectura ${index + 1}`).toBe(200);
      token = (await nextSession.json()).access_token;
    }
    const response = await page.request.post(`/api/expedientes/${caseId}/finanzas-operativas/ingresos/ia/vista-previa`, {
      headers: { Authorization: `Bearer ${token}` },
      multipart: { file: { name: basename(sample.file), mimeType: 'application/pdf', buffer: readFileSync(sample.file) } },
      timeout: 30_000,
    });
    expect(response.status(), `Lectura ${index + 1}: ${await response.text()}`).toBe(200);
    const proposal = await response.json();
    expect(sample.expected === null ? [null] : [sample.expected, null], `Lectura ${index + 1}: ${JSON.stringify(proposal)}`).toContain(proposal.monto_reportado);
    if (index < 10) expect(proposal.monto_reportado, `Lectura clara ${index + 1}: ${JSON.stringify(proposal)}`).toBe(sample.expected);
  }
});

test('Chrome local: fallo de proveedor no bloquea la captura manual ni la persistencia', async ({ page }, testInfo) => {
  const base = new URL(String(testInfo.project.use.baseURL || ''));
  const password = process.env.PRAVIA_E2E_PASSWORD;
  if (base.hostname !== '127.0.0.1' || !password) throw new Error('LOCAL_AI_QA_SAFETY_GATE_FAILED');
  const health = await page.request.get('/api/health');
  expect(await health.json()).toMatchObject({ database_mode: 'local', database_primary: 'local', storage_mode: 'local', storage_primary: 'local' });
  await page.goto('/login');
  await page.getByRole('textbox', { name: 'Correo electrónico' }).fill('adrian.hernandez@pravia.test');
  await page.getByRole('textbox', { name: 'Contraseña', exact: true }).fill(password);
  await page.getByRole('button', { name: 'Iniciar sesión', exact: true }).click();
  await page.waitForURL('**/mi-dia');
  await page.goto(`/expedientes/${caseId}#finanzas`);
  await page.getByRole('button', { name: 'Reportar ingreso' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Comprobante del ingreso').setInputFiles(receipt);
  await page.route('**/finanzas-operativas/ingresos/ia/vista-previa', async (route) => route.fulfill({
    status: 502, contentType: 'application/json', body: JSON.stringify({ code: 'EXP008_AI_PREFILL_FAILED', error: 'No pudimos leer el comprobante con IA. Puedes completar el ingreso manualmente.' }),
  }));
  await dialog.getByRole('button', { name: 'Llenar con IA' }).click();
  await expect(dialog.getByRole('alert')).toContainText('Puedes completar el ingreso manualmente');
  const concept = `QA ingreso manual tras fallo simulado ${Date.now()}`;
  await dialog.getByLabel('Concepto o contexto').fill(concept);
  await dialog.getByLabel('Monto reportado (opcional)').fill('120.50');
  await dialog.locator('select[name="facturar_a_vinculo_id"]').selectOption({ index: 1 });
  await dialog.locator('select[name="forma_pago"]').selectOption('TRANSFERENCIA');
  const report = page.waitForResponse((response) => response.url().endsWith('/finanzas-operativas/ingresos') && response.request().method() === 'POST');
  await dialog.getByRole('button', { name: 'Registrar ingreso' }).click();
  const saved = await report;
  expect(saved.status(), await saved.text()).toBe(201);
  await page.reload();
  const row = page.locator('article').filter({ hasText: concept });
  await expect(row).toContainText('$120.50');
  await expect(row).toContainText('Pendiente de aplicación');
});
