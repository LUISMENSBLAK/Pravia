import { expect, test } from '@playwright/test';

const caseId = '7a139000-0000-4000-8000-000000000001';

test('Finanzas local: carga ficha, pago y ambos adjuntos fiscales; persiste tras reload', async ({ page }, testInfo) => {
  const base = new URL(String(testInfo.project.use.baseURL || ''));
  const password = process.env.PRAVIA_E2E_PASSWORD;
  if (base.hostname !== '127.0.0.1' || !password) throw new Error('LOCAL_FINANCE_QA_SAFETY_GATE_FAILED');

  await page.goto('/login');
  const email = page.getByRole('textbox', { name: 'Correo electrónico' });
  await email.fill('adrian.hernandez@pravia.test');
  await page.getByRole('textbox', { name: 'Contraseña', exact: true }).fill(password);
  if (await email.inputValue() !== 'adrian.hernandez@pravia.test') await email.fill('adrian.hernandez@pravia.test');
  await expect(page.getByRole('button', { name: 'Iniciar sesión', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Iniciar sesión', exact: true }).click();
  await page.waitForURL('**/mi-dia');
  await page.goto(`/expedientes/${caseId}#finanzas`);
  await expect(page.getByRole('button', { name: 'Solicitar pago' })).toBeVisible();

  const concept = `QA carga dual ${Date.now()}`;
  await page.getByRole('button', { name: 'Solicitar pago' }).click();
  const requestDialog = page.getByRole('dialog');
  await requestDialog.getByLabel('Concepto', { exact: true }).fill(concept);
  await requestDialog.getByLabel('Importe').fill('23.50');
  await requestDialog.getByLabel(/Ficha externa/).setInputFiles({ name: 'ficha-qa.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4\nQA fixture\n') });
  const createResponse = page.waitForResponse((response) => response.url().includes('/finanzas-operativas/solicitudes/externa') && response.request().method() === 'POST');
  await requestDialog.getByRole('button', { name: 'Crear solicitud' }).click();
  const created = await createResponse;
  expect(created.status(), await created.text()).toBe(201);
  const requestId = (await created.json()).item.id as string;
  await expect(page.getByRole('dialog')).toHaveCount(0);

  const row = page.locator('article').filter({ hasText: concept });
  await expect(row).toBeVisible();
  await row.getByRole('button', { name: 'Registrar pago' }).click();
  const payDialog = page.getByRole('dialog');
  await payDialog.locator('select[name="cuenta_id"]').selectOption({ index: 1 });
  await payDialog.locator('select[name="categoria_id"]').selectOption({ index: 1 });
  await payDialog.locator('select[name="forma_pago"]').selectOption('TRANSFERENCIA');
  await payDialog.getByLabel('Comprobante de pago (opcional)').setInputFiles({ name: 'pago-qa.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4\nQA payment fixture\n') });
  await payDialog.getByLabel('XML fiscal').setInputFiles({ name: 'xml-qa.xml', mimeType: 'application/xml', buffer: Buffer.from('<?xml version="1.0"?><qa-fixture/>') });
  await payDialog.getByLabel('PDF fiscal').setInputFiles({ name: 'pdf-fiscal-qa.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4\nQA fiscal attachment fixture\n') });
  const paymentResponse = page.waitForResponse((response) => response.url().includes(`/finanzas-operativas/solicitudes/${requestId}/pagar`) && response.request().method() === 'POST');
  await payDialog.getByRole('button', { name: 'Confirmar pago' }).click();
  const paid = await paymentResponse;
  expect(paid.status(), await paid.text()).toBe(200);
  await expect(payDialog).toHaveCount(0);

  const readRequest = page.waitForRequest((request) => request.url().endsWith(`/api/expedientes/${caseId}/finanzas-operativas`));
  await page.reload();
  const authorization = (await readRequest).headers().authorization;
  if (!authorization?.startsWith('Bearer ')) throw new Error('LOCAL_FINANCE_AUTH_TOKEN_MISSING');
  await expect(page.locator('article').filter({ hasText: concept })).toContainText('Pagada');
  const response = await page.request.get(`/api/expedientes/${caseId}/finanzas-operativas`, { headers: { Authorization: authorization } });
  expect(response.status()).toBe(200);
  const request = (await response.json()).solicitudesPago.find((item: { id: string }) => item.id === requestId);
  expect(request.estado).toBe('PAGADA');
  expect(request.movimiento_id).toBeTruthy();
  expect(request.documentos.map((link: { documento: { nombre_original: string } }) => link.documento.nombre_original)).toEqual(expect.arrayContaining(['ficha-qa.pdf', 'pago-qa.pdf', 'xml-qa.xml', 'pdf-fiscal-qa.pdf']));
  for (const link of request.documentos as Array<{ id: string; documento: { nombre_original: string } }>) {
    const signed = await page.request.get(`/api/expedientes/${caseId}/finanzas-operativas/documentos/${link.id}/url`, { headers: { Authorization: authorization } });
    expect(signed.status()).toBe(200);
    const signedUrl = new URL((await signed.json()).url, base);
    expect(['127.0.0.1', 'localhost']).toContain(signedUrl.hostname);
    const file = await page.request.get(signedUrl.toString());
    expect(file.status()).toBe(200);
    expect((await file.body()).length).toBeGreaterThan(0);
  }
});

test('Finanzas local: Llenar con IA informa el resultado y conserva captura manual', async ({ page }, testInfo) => {
  const base = new URL(String(testInfo.project.use.baseURL || ''));
  const password = process.env.PRAVIA_E2E_PASSWORD;
  if (base.hostname !== '127.0.0.1' || !password) throw new Error('LOCAL_FINANCE_QA_SAFETY_GATE_FAILED');

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
  await expect(dialog.getByRole('button', { name: 'Llenar con IA' })).toBeVisible();
  await dialog.getByRole('button', { name: 'Llenar con IA' }).click();
  await expect(dialog.getByRole('alert')).toContainText('Selecciona primero el comprobante');
  await dialog.getByLabel('Comprobante del ingreso').setInputFiles({ name: 'anticipo-qa.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4\nQA de prellenado\n') });
  const aiResponse = page.waitForResponse((response) => response.url().includes('/finanzas-operativas/ingresos/ia/vista-previa') && response.request().method() === 'POST');
  await dialog.getByRole('button', { name: 'Llenar con IA' }).click();
  const response = await aiResponse;
  if (response.status() === 502) {
    await expect(dialog.getByRole('alert')).toContainText('Puedes completar el ingreso manualmente.');
    const concept = `Captura manual tras fallo de IA ${Date.now()}`;
    await dialog.getByLabel('Concepto o contexto').fill(concept);
    await dialog.getByLabel('Monto reportado (opcional)').fill('120.50');
    await dialog.locator('select[name="facturar_a_vinculo_id"]').selectOption({ index: 1 });
    await dialog.locator('select[name="forma_pago"]').selectOption('TRANSFERENCIA');
    await expect(dialog.getByRole('button', { name: 'Registrar ingreso' })).toBeEnabled();
    const saveResponse = page.waitForResponse((item) => item.url().endsWith('/finanzas-operativas/ingresos') && item.request().method() === 'POST');
    await dialog.getByRole('button', { name: 'Registrar ingreso' }).click();
    const saved = await saveResponse;
    expect(saved.status(), await saved.text()).toBe(201);
    await expect(dialog).toHaveCount(0);
    await page.reload();
    await expect(page.locator('article').filter({ hasText: concept })).toContainText('Pendiente de aplicación');
  } else {
    expect(response.status(), await response.text()).toBe(200);
    await expect(dialog.getByRole('status')).toBeVisible();
  }
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 820 });
    await page.goto(`/expedientes/${caseId}#finanzas`);
    await page.getByRole('button', { name: 'Reportar ingreso' }).click();
    const mobileDialog = page.getByRole('dialog');
    await expect(mobileDialog.getByRole('button', { name: 'Llenar con IA' })).toBeVisible();
    const bounds = await mobileDialog.boundingBox();
    expect(bounds).toBeTruthy();
    expect(bounds!.x).toBeGreaterThanOrEqual(-1);
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width + 1);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(1);
    await mobileDialog.getByRole('button', { name: 'Cerrar' }).click();
  }
});
