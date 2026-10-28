import { expect, test } from '@playwright/test';
import { PDFDocument, StandardFonts } from 'pdf-lib';

const qaEmail = process.env.PRAVIA_E2E_EMAIL;
const qaPassword = process.env.PRAVIA_E2E_PASSWORD;

async function syntheticCurpPdf() {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([612, 792]);
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const draw = (value: string, x: number, y: number) => page.drawText(value, { x, y, font, size: 10 });
  draw('Clave Unica de Registro de Poblacion - SINTETICO / SIN VALIDEZ', 20, 740);
  draw('Clave:', 170, 660); draw('GARA900101HDFRBC09', 170, 642);
  draw('Nombre', 170, 615); draw('PERSONA SINTETICA DE PRUEBA', 170, 596);
  draw('Fecha de inscripcion', 150, 545); draw('05/02/2026', 150, 529);
  draw('Folio', 290, 545); draw('12345678', 290, 529);
  draw('Entidad de registro', 380, 545); draw('NAYARIT', 380, 529);
  return Buffer.from(await pdf.save());
}

test('CURP sintética · carga categorizada, propuesta, revisión y reload en Chrome local', async ({ page }) => {
  const host = new URL(String(test.info().project.use.baseURL)).hostname;
  if (!['127.0.0.1', 'localhost'].includes(host)) throw new Error('CURP_QA_REQUIRES_LOCAL_HOST');
  if (!qaEmail || !qaPassword) throw new Error('CURP_QA_CREDENTIALS_REQUIRED');
  await page.goto('/login');
  const email = page.getByRole('textbox', { name: 'Correo electrónico' });
  await email.fill(qaEmail);
  await page.getByRole('textbox', { name: 'Contraseña', exact: true }).fill(qaPassword);
  if (await email.inputValue() !== qaEmail) await email.fill(qaEmail);
  await expect(page.getByRole('button', { name: 'Iniciar sesión', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Iniciar sesión', exact: true }).click();
  await expect(page).not.toHaveURL(/\/login$/);
  const request = page.waitForRequest(item => item.url().includes('/api/comparecientes?') &&
    item.headers().authorization?.startsWith('Bearer '));
  await page.goto('/comparecientes');
  const authorization = (await request).headers().authorization;
  const created = await page.request.post('/api/comparecientes/persona-fisica', {
    headers: { Authorization: authorization!, 'Content-Type': 'application/json' },
    data: { nombre: `QA CURP SINTETICA ${Date.now()}` },
  });
  expect(created.status(), await created.text()).toBe(201);
  const id = (await created.json()).data.compareciente.id as string;
  await page.goto(`/comparecientes/${id}`);
  await expect(page.getByRole('heading', { name: 'Documentación' })).toBeVisible();
  await page.getByRole('combobox', { name: 'Tipo de documento' }).selectOption('CURP');
  const uploaded = page.waitForResponse(item => item.url().endsWith(`/api/comparecientes/${id}/documentos`) &&
    item.request().method() === 'POST');
  await page.locator('input[type="file"]').setInputFiles({ name: 'CURP_SINTETICA_SIN_VALIDEZ.pdf',
    mimeType: 'application/pdf', buffer: await syntheticCurpPdf() });
  expect((await uploaded).status()).toBe(201);
  await expect(page.locator('article strong').filter({ hasText: 'CURP_SINTETICA_SIN_VALIDEZ.pdf' })).toBeVisible();
  const extracted = page.waitForResponse(item => item.url().endsWith(`/api/comparecientes/${id}/extraer-ia`) &&
    item.request().method() === 'POST');
  await page.getByRole('button', { name: 'Extraer información con IA' }).click();
  const result = await extracted;
  expect(result.status(), await result.text()).toBe(200);
  const review = page.getByRole('region', { name: 'Resultado de extracción documental' });
  await expect(review).toContainText('Constancia CURP · datos sin confirmar');
  await expect(review).toContainText('Folio documental: 12345678 · página 1');
  await expect(review).toContainText('Fecha de inscripción: 2026-02-05 · página 1');
  await page.reload();
  await expect(page.locator('article strong').filter({ hasText: 'CURP_SINTETICA_SIN_VALIDEZ.pdf' })).toBeVisible();
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 780 });
    const selector = page.getByRole('combobox', { name: 'Tipo de documento' });
    await expect(selector).toBeVisible();
    await selector.focus();
    expect(await selector.evaluate(element => document.activeElement === element)).toBe(true);
    const viewport = await page.evaluate(() => ({ width: document.documentElement.clientWidth,
      scrollWidth: document.documentElement.scrollWidth }));
    expect(viewport.scrollWidth, `desbordamiento horizontal a ${width}px`).toBeLessThanOrEqual(viewport.width);
  }
});

test('alta asistida · CURP sintética mantiene procedencia sin guardar datos maestros', async ({ page }) => {
  const host = new URL(String(test.info().project.use.baseURL)).hostname;
  if (!['127.0.0.1', 'localhost'].includes(host)) throw new Error('CURP_QA_REQUIRES_LOCAL_HOST');
  if (!qaEmail || !qaPassword) throw new Error('CURP_QA_CREDENTIALS_REQUIRED');
  await page.goto('/login');
  const email = page.getByRole('textbox', { name: 'Correo electrónico' });
  await email.fill(qaEmail);
  await page.getByRole('textbox', { name: 'Contraseña', exact: true }).fill(qaPassword);
  if (await email.inputValue() !== qaEmail) await email.fill(qaEmail);
  await expect(page.getByRole('button', { name: 'Iniciar sesión', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Iniciar sesión', exact: true }).click();
  await expect(page).not.toHaveURL(/\/login$/);
  await page.goto('/comparecientes/nuevo');
  await expect(page.getByRole('heading', { name: 'Documentación' })).toBeVisible();
  await page.getByRole('combobox', { name: 'Tipo de documento' }).selectOption('CURP');
  const uploaded = page.waitForResponse(item => /\/api\/comparecientes\/altas\/[\w-]+\/documentos$/.test(item.url()) &&
    item.request().method() === 'POST');
  await page.locator('input[type="file"]').setInputFiles({ name: 'CURP_ALTA_SINTETICA_SIN_VALIDEZ.pdf',
    mimeType: 'application/pdf', buffer: await syntheticCurpPdf() });
  const uploadResponse = await uploaded;
  expect(uploadResponse.status(), await uploadResponse.text()).toBe(201);
  const sessionId = uploadResponse.url().match(/altas\/([\w-]+)\/documentos$/)?.[1];
  expect(sessionId).toBeTruthy();
  const extracted = page.waitForResponse(item => item.url().endsWith(`/api/comparecientes/altas/${sessionId}/extraer`) &&
    item.request().method() === 'POST');
  await page.getByRole('button', { name: 'Extraer información con IA' }).click();
  const extractionResponse = await extracted;
  expect(extractionResponse.status(), await extractionResponse.text()).toBe(200);
  const payload = await extractionResponse.json();
  expect(payload.documentos_curp?.[0]?.fields.folio_documental?.normalized).toBe('12345678');
  expect(payload.resultado?.proveedor).toBe('LOCAL_DETERMINISTIC');
  await expect(page.getByRole('region', { name: 'Resultado de extracción documental' }))
    .toContainText('Folio documental: 12345678 · página 1');
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Nuevo compareciente' })).toBeVisible();
});
