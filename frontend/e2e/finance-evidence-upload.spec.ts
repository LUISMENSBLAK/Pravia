import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';

const credentials = {
  email: 'qa.correcciones@pravia.test',
  password: (process.env.PRAVIA_E2E_PASSWORD ?? ''),
};
const expedienteId = '7a139000-0000-4000-8000-000000000001';

async function login(page: Page) {
  await page.goto('/login', { waitUntil: 'domcontentloaded' });
  const email = page.getByRole('textbox', { name: 'Correo electrónico' });
  const password = page.getByRole('textbox', { name: 'Contraseña', exact: true });
  const submit = page.getByRole('button', { name: 'Iniciar sesión', exact: true });
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await email.fill(credentials.email);
    await password.fill(credentials.password);
    await page.waitForTimeout(100);
    if (await submit.isEnabled()) break;
  }
  await expect(submit).toBeEnabled();
  await submit.click();
  await page.waitForURL('**/mi-dia');
}

test('EXP-008 permite subir, persistir y volver a abrir un comprobante real', async ({ page }) => {
  test.setTimeout(90_000);
  const concept = `QA comprobante navegador ${Date.now()}`;

  await login(page);
  await page.setViewportSize({ width: 1366, height: 768 });
  await page.goto(`/expedientes/${expedienteId}#finanzas`, { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: 'Reportar ingreso' }).click();

  const dialog = page.getByRole('dialog', { name: 'Reportar ingreso' });
  await expect(dialog).toBeVisible();
  await dialog.getByLabel('Concepto o contexto').fill(concept);
  await dialog.getByLabel('Monto reportado (opcional)').fill('321.45');
  await dialog.getByLabel('¿A quién se va a facturar?').selectOption({ index: 1 });
  await dialog.getByLabel('Forma de pago').selectOption('TRANSFERENCIA');
  await dialog.getByLabel('Comprobante del ingreso').setInputFiles({
    name: '04 - ANTICIPO.jpeg',
    mimeType: 'image/jpeg',
    buffer: readFileSync('public/brand/pravia-ai/owl-master-reference.jpg'),
  });
  await expect(dialog.getByLabel('Comprobante del ingreso')).toHaveValue(/04 - ANTICIPO\.jpeg$/);

  const uploadResponse = page.waitForResponse((response) =>
    response.request().method() === 'POST'
      && response.url().includes(`/api/expedientes/${expedienteId}/finanzas-operativas/ingresos`),
  );
  await page.route(`**/api/expedientes/${expedienteId}/finanzas-operativas/ingresos`, async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 350));
    await route.continue();
  });
  await dialog.getByRole('button', { name: 'Registrar ingreso' }).click();
  await expect(dialog.getByRole('button', { name: 'Guardando ingreso…' })).toBeDisabled();
  const response = await uploadResponse;
  expect(response.status(), await response.text()).toBe(201);

  await expect(page.getByRole('status')).toContainText('Ingreso guardado con factura pendiente');
  let incomeCard = page.locator('article').filter({ hasText: concept });
  await expect(incomeCard).toBeVisible();
  await expect(incomeCard.getByRole('button', { name: /04[_ -]+ANTICIPO\.jpeg/ })).toBeVisible();

  await page.reload({ waitUntil: 'networkidle' });
  incomeCard = page.locator('article').filter({ hasText: concept });
  await expect(incomeCard).toBeVisible();
  await expect(incomeCard.getByRole('button', { name: /04[_ -]+ANTICIPO\.jpeg/ })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1)).toBe(true);
});

test('EXP-008 muestra el rechazo de carga dentro del panel', async ({ page }) => {
  await login(page);
  await page.goto(`/expedientes/${expedienteId}#finanzas`, { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: 'Reportar ingreso' }).click();
  const dialog = page.getByRole('dialog', { name: 'Reportar ingreso' });
  await dialog.getByLabel('Concepto o contexto').fill('QA rechazo visible');
  await dialog.getByLabel('¿A quién se va a facturar?').selectOption({ index: 1 });
  await dialog.getByLabel('Forma de pago').selectOption('EFECTIVO');
  await dialog.getByLabel('Comprobante del ingreso').setInputFiles('public/icons/favicon-32.png');
  await page.route(`**/api/expedientes/${expedienteId}/finanzas-operativas/ingresos`, async (route) => {
    await route.fulfill({
      status: 503,
      contentType: 'application/json',
      body: JSON.stringify({ code: 'STORAGE_UNAVAILABLE', error: 'Storage temporalmente no disponible.' }),
    });
  });
  await dialog.getByRole('button', { name: 'Registrar ingreso' }).click();
  await expect(dialog.getByRole('alert')).toHaveText('Storage temporalmente no disponible.');
  await expect(dialog).toBeVisible();
  await expect(dialog.getByLabel('Comprobante del ingreso')).toHaveValue(/favicon-32\.png$/);
});
