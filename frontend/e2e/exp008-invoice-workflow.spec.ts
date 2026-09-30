import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';

const credentials = {
  email: 'qa.correcciones@pravia.test',
  password: (process.env.PRAVIA_E2E_PASSWORD ?? ''),
};
const expedienteId = '7a139000-0000-4000-8000-000000000001';
const receipt = {
  name: 'exp008-ingreso.png',
  mimeType: 'image/png',
  buffer: readFileSync('public/icons/favicon-32.png'),
};
const invoicePdf = {
  name: 'factura-exp008.pdf',
  mimeType: 'application/pdf',
  buffer: Buffer.from('%PDF-1.4\n% PRAVIA QA EXP-008\n%%EOF\n'),
};
const invoiceXml = {
  name: 'factura-exp008.xml',
  mimeType: 'application/xml',
  buffer: Buffer.from('<?xml version="1.0" encoding="UTF-8"?><Comprobante Version="4.0" Total="20000.00"/>'),
};

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

async function openFinances(page: Page) {
  await page.goto(`/expedientes/${expedienteId}#finanzas`, { waitUntil: 'networkidle' });
  await expect(page.getByRole('tabpanel', { name: 'Finanzas' })).toBeVisible();
}

async function fillIncomeBase(page: Page, concept: string, amount: string) {
  await page.getByRole('button', { name: 'Reportar ingreso', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Reportar ingreso' });
  await expect(dialog).toBeVisible();
  await dialog.getByLabel('Concepto o contexto').fill(concept);
  await dialog.getByLabel('Monto reportado (opcional)').fill(amount);
  await dialog.getByLabel('¿A quién se va a facturar?').selectOption({ index: 1 });
  await dialog.getByLabel('Forma de pago').selectOption('TRANSFERENCIA');
  await dialog.getByLabel('Comprobante del ingreso').setInputFiles(receipt);
  return dialog;
}

test('EXP-008 · cinco casos de pago y facturación con fuente única', async ({ page }, testInfo) => {
  test.setTimeout(180_000);
  const suffix = Date.now();
  const completeConcept = `QA EXP008 factura completa ${suffix}`;
  const pendingConcept = `QA EXP008 factura pendiente ${suffix}`;
  const pendingAmount = (9_000 + (suffix % 800) + 0.54).toFixed(2);
  const pendingAmountLabel = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(Number(pendingAmount));

  await login(page);
  await page.setViewportSize({ width: 1366, height: 900 });
  await openFinances(page);

  // CASO 1 · registro completo con compareciente, transferencia, PDF y XML.
  let dialog = await fillIncomeBase(page, completeConcept, '20000.00');
  await dialog.getByLabel('Factura pendiente').uncheck();
  await dialog.getByLabel('Factura PDF').setInputFiles(invoicePdf);
  await dialog.getByLabel('Factura XML').setInputFiles(invoiceXml);
  const completeResponse = page.waitForResponse((response) => response.request().method() === 'POST'
    && response.url().includes(`/api/expedientes/${expedienteId}/finanzas-operativas/ingresos`));
  await dialog.getByRole('button', { name: 'Registrar ingreso' }).click();
  expect((await completeResponse).status()).toBe(201);
  let completeCard = page.locator('article').filter({ hasText: completeConcept });
  await expect(completeCard).toContainText('Factura cargada');
  await expect(completeCard).toContainText('transferencia');
  await expect(completeCard.getByText('factura-exp008.pdf')).toBeVisible();
  await expect(completeCard.getByText('factura-exp008.xml')).toBeVisible();

  // CASO 2 · registro válido sin factura.
  dialog = await fillIncomeBase(page, pendingConcept, pendingAmount);
  await expect(dialog.getByLabel('Factura pendiente')).toBeChecked();
  const pendingResponse = page.waitForResponse((response) => response.request().method() === 'POST'
    && response.url().includes(`/api/expedientes/${expedienteId}/finanzas-operativas/ingresos`));
  await dialog.getByRole('button', { name: 'Registrar ingreso' }).click();
  expect((await pendingResponse).status()).toBe(201);
  let pendingCard = page.locator('article').filter({ hasText: pendingConcept });
  await expect(pendingCard).toContainText('Factura pendiente');
  await expect(pendingCard.getByRole('button', { name: 'Agregar factura' })).toBeVisible();

  // CASO 4 · Finanzas Central lee el registro del expediente y permite regresar a él.
  await page.goto('/finanzas?view=facturacion', { waitUntil: 'networkidle' });
  const centralRow = page.getByRole('row')
    .filter({ hasText: 'EXP-0139-2026' })
    .filter({ hasText: pendingAmountLabel })
    .filter({ has: page.getByRole('link', { name: 'Completar factura' }) })
    .first();
  await expect(centralRow).toContainText('Factura pendiente');
  await page.screenshot({ path: testInfo.outputPath('case4-central-pending.png'), fullPage: true });
  await centralRow.getByRole('link', { name: 'Completar factura' }).click();
  await page.waitForURL(`**/expedientes/${expedienteId}#finanzas`);

  // CASO 3 · Administración completa posteriormente PDF + XML.
  pendingCard = page.locator('article').filter({ hasText: pendingConcept });
  await pendingCard.getByRole('button', { name: 'Agregar factura' }).click();
  dialog = page.getByRole('dialog', { name: 'Agregar factura' });
  await expect(dialog).toBeVisible();
  await dialog.getByLabel('Factura PDF').setInputFiles(invoicePdf);
  await dialog.getByLabel('Factura XML').setInputFiles(invoiceXml);
  const invoiceResponse = page.waitForResponse((response) => response.request().method() === 'POST'
    && response.url().includes('/factura'));
  await dialog.getByRole('button', { name: 'Agregar factura' }).click();
  expect((await invoiceResponse).status()).toBe(200);
  pendingCard = page.locator('article').filter({ hasText: pendingConcept });
  await expect(pendingCard).toContainText('Factura cargada');
  await expect(pendingCard.getByRole('button', { name: 'Agregar factura' })).toHaveCount(0);

  // CASO 5 · persistencia por reload y controles responsive sin overflow de página.
  await page.reload({ waitUntil: 'networkidle' });
  completeCard = page.locator('article').filter({ hasText: completeConcept });
  pendingCard = page.locator('article').filter({ hasText: pendingConcept });
  await expect(completeCard).toContainText('Factura cargada');
  await expect(pendingCard).toContainText('Factura cargada');
  for (const width of [1440, 1366, 1024, 768, 390, 320]) {
    await page.setViewportSize({ width, height: width <= 390 ? 844 : 900 });
    await page.evaluate(() => window.scrollTo(0, 0));
    await expect(page.getByRole('tabpanel', { name: 'Finanzas' })).toBeVisible();
    expect(await page.evaluate(() => Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) <= window.innerWidth + 1), `overflow at ${width}px`).toBe(true);
    if (width === 390) await page.screenshot({ path: testInfo.outputPath('case5-mobile-390.png'), fullPage: true });
  }

  // El catálogo no admite texto libre y "Otro" revela su detalle obligatorio.
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: 'Reportar ingreso', exact: true }).click();
  dialog = page.getByRole('dialog', { name: 'Reportar ingreso' });
  await dialog.getByLabel('Forma de pago').selectOption('OTRO');
  const otherDetail = dialog.getByLabel('Especificar forma de pago');
  await expect(otherDetail).toBeVisible();
  await expect(otherDetail).toHaveAttribute('required', '');
  await dialog.getByRole('button', { name: 'Cerrar' }).click();
});
