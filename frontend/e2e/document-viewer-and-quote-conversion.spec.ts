import { expect, test, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

const expedienteId = '770a40da-3ba5-4d24-a293-75fa8d064c05';
const evidenceDir = resolve(process.cwd(), 'artifacts/document-viewer-final');

async function login(page: Page) {
  await page.goto('/login', { waitUntil: 'domcontentloaded' });
  await page.getByRole('textbox', { name: 'Correo electrónico' }).fill('qa.correcciones@pravia.test');
  await page.getByRole('textbox', { name: 'Contraseña', exact: true }).fill('Pravia!QA-Release-2026');
  await page.getByRole('button', { name: 'Iniciar sesión', exact: true }).click();
  await page.waitForURL('**/mi-dia');
}

async function openDocument(page: Page, name: string) {
  await page.goto(`/expedientes/${expedienteId}#documentos`, { waitUntil: 'domcontentloaded' });
  const documentName = page.getByText(name, { exact: true }).first();
  await expect(documentName).toBeVisible({ timeout: 30_000 });
  await documentName.click();
  await page.getByRole('button', { name: 'Visualizar', exact: true }).click();
  const dialog = page.getByRole('dialog', { name });
  await expect(dialog).toBeVisible();
  await expect(dialog.locator('[data-preview-loaded="true"]').first()).toBeVisible({ timeout: 30_000 });
  return dialog;
}

async function expectViewerInsideViewport(page: Page, name: string) {
  const dialog = page.getByRole('dialog', { name });
  const box = await dialog.boundingBox();
  const viewport = page.viewportSize();
  expect(box).not.toBeNull();
  expect(viewport).not.toBeNull();
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.y).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(viewport!.width + 1);
  expect(box!.y + box!.height).toBeLessThanOrEqual(viewport!.height + 1);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
}

test('visor canónico carga documentos completos y permanece dentro del viewport en Chrome real', async ({ page }) => {
  test.setTimeout(600_000);
  mkdirSync(evidenceDir, { recursive: true });
  const consoleErrors: string[] = [];
  const networkErrors: string[] = [];
  page.on('console', (message) => { if (message.type() === 'error') consoleErrors.push(message.text()); });
  page.on('response', (response) => { if (response.status() >= 500) networkErrors.push(`${response.status()} ${response.url()}`); });

  await page.setViewportSize({ width: 1440, height: 900 });
  await login(page);
  consoleErrors.length = 0;
  networkErrors.length = 0;

  const pdf = await openDocument(page, 'QA-PREVIEW-PDF.pdf');
  await expectViewerInsideViewport(page, 'QA-PREVIEW-PDF.pdf');
  const canvas = pdf.locator('canvas[data-preview-loaded="true"]').first();
  expect(await canvas.evaluate((element) => ({ width: element.width, height: element.height }))).toEqual(expect.objectContaining({ width: expect.any(Number), height: expect.any(Number) }));
  const pdfScroller = pdf.locator('[aria-label="Vista previa de QA-PREVIEW-PDF.pdf"]');
  await pdfScroller.evaluate((element) => { element.scrollTop = element.scrollHeight; });
  await expect(pdf.locator('figcaption').last()).toBeVisible();
  await page.screenshot({ path: `${evidenceDir}/pdf-1440.png` });
  await pdf.getByRole('button', { name: 'Cerrar vista previa' }).click();

  const docx = await openDocument(page, 'COT-QA-003V2.docx');
  await expectViewerInsideViewport(page, 'COT-QA-003V2.docx');
  const docxPage = docx.locator('[data-preview-loaded="true"]');
  expect((await docxPage.innerText()).trim().length).toBeGreaterThan(20);
  const docxScroller = docx.locator('[aria-label="Vista previa de COT-QA-003V2.docx"]');
  await docxScroller.evaluate((element) => { element.scrollTop = element.scrollHeight; });
  const docxReachability = await docxScroller.evaluate((element) => ({
    remaining: element.scrollHeight - element.clientHeight - element.scrollTop,
    hasScrollableContent: element.scrollHeight >= element.clientHeight,
  }));
  expect(docxReachability.hasScrollableContent).toBeTruthy();
  expect(docxReachability.remaining).toBeLessThanOrEqual(2);
  await page.screenshot({ path: `${evidenceDir}/docx-bottom-1440.png` });
  await docx.getByRole('button', { name: 'Cerrar vista previa' }).click();

  for (const [width, height] of [[1440, 900], [1366, 900], [1024, 768], [768, 900], [390, 844], [320, 700]] as const) {
    await page.setViewportSize({ width, height });
    const image = await openDocument(page, 'QA-PREVIEW-PNG.png');
    await expectViewerInsideViewport(page, 'QA-PREVIEW-PNG.png');
    const preview = image.getByRole('img', { name: 'Vista previa de QA-PREVIEW-PNG.png' });
    const initial = await preview.boundingBox();
    const imageScroller = preview.locator('..').locator('..');
    const scrollerBox = await imageScroller.boundingBox();
    expect(initial).not.toBeNull();
    expect(scrollerBox).not.toBeNull();
    expect(initial!.width).toBeGreaterThan(0);
    expect(initial!.height).toBeGreaterThan(0);
    expect(initial!.x).toBeGreaterThanOrEqual(scrollerBox!.x - 1);
    expect(initial!.y).toBeGreaterThanOrEqual(scrollerBox!.y - 1);
    expect(initial!.x + initial!.width).toBeLessThanOrEqual(scrollerBox!.x + scrollerBox!.width + 1);
    expect(initial!.y + initial!.height).toBeLessThanOrEqual(scrollerBox!.y + scrollerBox!.height + 1);
    for (let click = 0; click < 10; click += 1) await image.getByRole('button', { name: 'Aumentar zoom' }).click();
    const dimensions = await imageScroller.evaluate((element) => ({
      clientWidth: element.clientWidth,
      clientHeight: element.clientHeight,
      scrollWidth: element.scrollWidth,
      scrollHeight: element.scrollHeight,
    }));
    expect(dimensions.scrollWidth).toBeGreaterThanOrEqual(dimensions.clientWidth);
    expect(dimensions.scrollHeight).toBeGreaterThanOrEqual(dimensions.clientHeight);
    await page.screenshot({ path: `${evidenceDir}/image-${width}.png` });
    await image.getByRole('button', { name: 'Cerrar vista previa' }).click();
  }

  expect(networkErrors).toEqual([]);
  expect(consoleErrors.filter((message) => !message.includes('favicon'))).toEqual([]);
});

test('cotización sin acto exige selección canónica y envía el acto elegido', async ({ page }) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1366, height: 900 });
  await login(page);
  let conversionPayload: Record<string, unknown> | null = null;
  const quote = {
    id: 'quote-act-missing', numero_solicitud: 'SOL-QA-ACTO', numero_cotizacion: 'COT-QA-ACTO', version_actual: 1,
    prospecto_id: 'prospect-qa', user_id: 'user-qa', notaria_id: null, estado: 'ACEPTADA',
    fecha_solicitud_notaria: null, fecha_presupuesto_recibido: null, fecha_enviada_cliente: '2026-09-22T20:00:00.000Z',
    total_notaria: 1000, honorarios_pravia: 0, total_cliente: 1000,
    created_at: '2026-09-22T20:00:00.000Z', updated_at: '2026-09-22T20:00:00.000Z',
    prospecto: { id: 'prospect-qa', nombre: 'Cliente QA sin acto', tipo_acto: null, email: 'qa@pravia.test' },
    notaria: null, creada_por: { id: 'user-qa', nombre: 'QA', apellido: 'Correcciones' }, versiones: [], seguimientos: [], documentos: [], pagos: [], expediente: null,
    presupuesto: { concepts: [{ id: 'concept-qa', concepto: 'Honorarios', categoria: 'HONORARIOS', importe: 1000, orden: 0, origen: 'MANUAL' }], totals: { honorarios: '1000.00', iva_honorarios: '0.00', subtotal_honorarios: '1000.00', impuestos_derechos: '0.00', total: '1000.00' } },
    transiciones_permitidas: [],
    workflow: { stage: 'ACEPTADA', stageLabel: 'Aceptada', stageEnteredAt: '2026-09-22T20:00:00.000Z', knowledge: 'KNOWN', version: 3, actions: ['CONVERTIR'], events: [], firstSentAt: '2026-09-22T20:00:00.000Z', acceptedAdvanceAt: null },
    conversion: { eligible: true, accepted: true, approvedVersion: true, validatedAdvance: false, validatedAdvanceTotal: 0, notConverted: true, linkedProspect: true, failures: [] },
  };
  await page.route('**/api/cotizaciones/quote-act-missing/seguimientos', (route) => route.fulfill({ json: [] }));
  await page.route('**/api/cotizaciones/quote-act-missing/documentos', (route) => route.fulfill({ json: [] }));
  await page.route('**/api/cotizaciones/quote-act-missing/convertir', async (route) => {
    conversionPayload = route.request().postDataJSON() as Record<string, unknown>;
    await route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({ id: 'exp-qa', numero_pravia: 'EXP-QA-2026', idempotent: false }) });
  });
  await page.route('**/api/cotizaciones/quote-act-missing', (route) => route.fulfill({ json: quote }));
  await page.route('**/api/expedientes/tipos-acto', (route) => route.fulfill({ json: [{ id: 'act-compraventa', nombre: 'Compraventa' }, { id: 'act-donacion', nombre: 'Donación' }] }));

  await page.goto('/cotizaciones/quote-act-missing', { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('heading', { name: 'COT-QA-ACTO' })).toBeVisible();
  await page.getByRole('button', { name: 'Convertir en expediente' }).click();
  const dialog = page.getByRole('dialog', { name: 'Convertir a expediente' });
  const select = dialog.getByLabel('Tipo de acto del expediente');
  const submit = dialog.getByRole('button', { name: 'Convertir en expediente' });
  await expect(select).toBeEnabled();
  await expect(submit).toBeDisabled();
  await expect(dialog.getByText('Sin especificar')).toBeVisible();
  await select.selectOption('act-donacion');
  await expect(dialog.getByRole('definition').filter({ hasText: 'Donación' })).toBeVisible();
  await expect(submit).toBeEnabled();
  await submit.click();
  await expect.poll(() => conversionPayload).not.toBeNull();
  expect(conversionPayload).toMatchObject({ expectedVersion: 3, confirm: true, tipo_acto_id: 'act-donacion' });
  await expect(page).toHaveURL(/\/expedientes\/exp-qa$/);
});
