import { createHash, randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { PrismaClient } from '../../backend/node_modules/@prisma/client/default.js';
import { PDFParse } from '../../backend/node_modules/pdf-parse/dist/pdf-parse/esm/index.js';
import bcrypt from '../../backend/node_modules/bcryptjs/index.js';

const databaseUrl = 'postgresql://postgres@127.0.0.1:55439/postgres?schema=pravia_os';
const credentials = {
  email: 'adrian.hernandez@pravia.test',
  password: process.env.PRAVIA_E2E_ADRIAN_PASSWORD || '',
};

async function syntheticCsf(rfc: string, regimes = ['605 Sueldos y Salarios e Ingresos Asimilados a Salarios']) {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([612, 792]);
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  [
    'CONSTANCIA DE SITUACION FISCAL - SINTETICA / SIN VALIDEZ FISCAL',
    `RFC: ${rfc}`,
    'Nombre completo: PERSONA FISICA SINTETICA',
    'Codigo Postal: 63735',
    'Domicilio Fiscal: CALLE DE PRUEBA 10',
    'Fecha de emision: 2026-10-29',
    ...regimes.map(regime => `Regimen Fiscal: ${regime}`),
  ].forEach((line, index) => page.drawText(line, { x: 24, y: 740 - index * 23, font, size: 10 }));
  return Buffer.from(await pdf.save());
}

test('P0 entidad fiscal: CSF privada, extracción real, confirmación, persistencia y ficha', async ({ page, request }, testInfo) => {
  const base = new URL(String(testInfo.project.use.baseURL));
  if (base.hostname !== '127.0.0.1' || !['5176','5177'].includes(base.port) ||
    process.env.PRAVIA_E2E_LOCAL_DATABASE_URL !== databaseUrl || !credentials.password) {
    throw new Error('FISCAL_ENTITY_LOCAL_SAFETY_GATE_FAILED');
  }
  const db = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
  try {
    const rfc = `QAFA010101${randomUUID().replaceAll('-', '').slice(0, 3).toUpperCase()}`;
    const pdf = await syntheticCsf(rfc);
    const sha = createHash('sha256').update(pdf).digest('hex');
    await page.goto('/login');
    await page.getByRole('textbox', { name: 'Correo electrónico' }).fill(credentials.email);
    await page.getByRole('textbox', { name: 'Contraseña', exact: true }).fill(credentials.password);
    if (await page.getByRole('textbox', { name: 'Correo electrónico' }).inputValue() !== credentials.email) {
      await page.getByRole('textbox', { name: 'Correo electrónico' }).fill(credentials.email);
    }
    await expect(page.getByRole('button', { name: 'Iniciar sesión', exact: true })).toBeEnabled();
    await page.getByRole('button', { name: 'Iniciar sesión', exact: true }).click();
    await page.waitForURL('**/mi-dia');
    await page.goto('/finanzas?view=facturacion');
    await page.getByRole('tab', { name: 'CFDI y cuentas' }).click();
    await page.getByRole('button', { name: 'Entidades fiscales' }).click();
    await page.getByRole('button', { name: 'Agregar entidad fiscal' }).click();
    const dialog = page.getByRole('dialog', { name: 'Agregar entidad fiscal' });
    await expect(dialog.getByRole('button', { name: 'Guardar entidad fiscal' })).toBeDisabled();
    await page.route('**/api/finanzas/facturacion/entidades/csf', async route => {
      await new Promise(resolve => setTimeout(resolve, 300));
      await route.continue();
    });
    const uploaded = page.waitForResponse((response) => response.url().endsWith('/api/finanzas/facturacion/entidades/csf') && response.request().method() === 'POST');
    await dialog.getByLabel('Cargar Constancia de Situación Fiscal').setInputFiles({ name: 'CSF_SINTETICA_SIN_VALIDEZ.pdf', mimeType: 'application/pdf', buffer: pdf });
    await expect(dialog.getByRole('status')).toContainText('Subiendo constancia');
    const uploadResponse = await uploaded;
    expect(uploadResponse.status(), await uploadResponse.text()).toBe(201);
    const uploadedData = (await uploadResponse.json()).data as { id: string; sha256: string };
    expect(uploadedData.sha256).toBe(sha);
    const extracted = page.waitForResponse((response) => response.url().endsWith(`/api/finanzas/facturacion/entidades/csf/${uploadedData.id}/extraer`));
    const extractResponse = await extracted;
    expect(extractResponse.status(), await extractResponse.text()).toBe(200);
    const extraction = (await extractResponse.json()).data;
    expect(extraction.rfc).toBe(rfc);
    expect(extraction.regimenes_fiscales.map((item: { clave: string }) => item.clave)).toContain('605');
    await expect(dialog.getByRole('textbox', { name: 'RFC' })).toHaveValue(rfc);
    await expect(dialog.getByRole('textbox', { name: 'Nombre o razón social' })).toHaveValue('PERSONA FISICA SINTETICA');
    await expect(dialog.getByRole('textbox', { name: 'Código postal fiscal' })).toHaveValue('63735');
    await expect(dialog.getByRole('textbox', { name: 'Domicilio fiscal detectado' })).toHaveValue('CALLE DE PRUEBA 10');
    await expect(dialog.getByLabel('Régimen principal para la emisión')).toHaveValue('605');
    await dialog.getByRole('button', { name: 'Cerrar' }).last().click();
    await page.getByRole('button', { name: 'Agregar entidad fiscal' }).click();
    await expect(dialog.getByRole('textbox', { name: 'RFC' })).toHaveValue(rfc);
    await expect(dialog.getByRole('textbox', { name: 'Código postal fiscal' })).toHaveValue('63735');
    await dialog.getByLabel('Revisé la constancia y confirmo los datos fiscales.').check();
    const created = page.waitForResponse((response) => response.url().endsWith('/api/finanzas/facturacion/entidades') && response.request().method() === 'POST');
    await dialog.getByRole('button', { name: 'Guardar entidad fiscal' }).click();
    const createResponse = await created;
    expect(createResponse.status(), await createResponse.text()).toBe(201);
    const entity = (await createResponse.json()).data as { id: string };
    await expect(page.locator('article').filter({ hasText: rfc }).getByRole('heading', { name: 'PERSONA FISICA SINTETICA' })).toBeVisible();
    const document = await db.documento.findUniqueOrThrow({ where: { id: uploadedData.id } });
    expect(document.checksum_sha256).toBe(sha);
    expect(document.storage_key).toContain(`/fiscal/entity-csf/`);
    const persisted = await db.entidadFiscalCfdi.findUniqueOrThrow({ where: { id: entity.id } });
    expect(persisted.csf_documento_id).toBe(uploadedData.id);
    expect(persisted.regimen_fiscal).toBe('605');
    expect(persisted.regimenes_fiscales).toEqual([{ clave: '605', descripcion: expect.any(String) }]);
    expect(persisted.rfc).toBe(rfc);
    await page.reload();
    await page.getByRole('tab', { name: 'CFDI y cuentas' }).click();
    await page.getByRole('button', { name: 'Entidades fiscales' }).click();
    const card = page.locator('article').filter({ hasText: rfc });
    await card.getByRole('button', { name: 'Abrir ficha' }).click();
    await expect(page.getByRole('dialog', { name: 'Ficha de entidad fiscal' })).toContainText(rfc);
    await expect(page.getByRole('button', { name: 'Ver CSF original' })).toBeVisible();
    const csfPreview = page.waitForEvent('popup');
    await page.getByRole('button', { name: 'Ver CSF original' }).click();
    const csfPopup = await csfPreview;
    await csfPopup.waitForURL(/\/api\/storage\/local\?/);
    await csfPopup.close();
    expect(await db.auditLog.count({ where: { entidad_id: entity.id, accion: 'CREATE_FISCAL_ENTITY' } })).toBe(1);
    const auth = await request.post('/api/auth/login', { data: credentials });
    expect(auth.status()).toBe(200);
    const token = (await auth.json()).access_token as string;
    const originalLink = await request.get(`/api/finanzas/facturacion/entidades/${entity.id}/csf`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(originalLink.status(), await originalLink.text()).toBe(200);
    const original = await request.get((await originalLink.json()).data.url);
    expect(original.status()).toBe(200);
    expect(createHash('sha256').update(Buffer.from(await original.body())).digest('hex')).toBe(sha);
    const originalDownload = page.waitForEvent('download');
    await page.getByRole('dialog', { name: 'Ficha de entidad fiscal' }).getByRole('button', { name: 'Descargar CSF' }).click();
    expect((await originalDownload).suggestedFilename()).toBe('CSF_SINTETICA_SIN_VALIDEZ.pdf');
    const repeated = await request.post('/api/finanzas/facturacion/entidades', { headers: { Authorization: `Bearer ${token}` }, data: {
      rfc, razon_social: 'PERSONA FISICA SINTETICA', codigo_postal: '63735', regimen_fiscal: '605',
      regimenes_fiscales: [{ clave: '605' }], csf_documento_id: uploadedData.id,
      csf_sha256: sha, csf_reviewed: true,
    } });
    expect(repeated.status(), await repeated.text()).toBe(201);
    expect(await db.entidadFiscalCfdi.count({ where: { organization_id: persisted.organization_id, rfc } })).toBe(1);
    await page.getByRole('dialog', { name: 'Ficha de entidad fiscal' }).getByRole('button', { name: 'Cerrar' }).last().click();
    await page.getByRole('button', { name: 'Conceptos fiscales' }).click();
    await page.getByRole('button', { name: 'Configurar concepto' }).click();
    const conceptDialog = page.getByRole('dialog', { name: 'Configurar concepto fiscal' });
    await conceptDialog.getByLabel('Entidad emisora').selectOption(entity.id);
    await conceptDialog.getByLabel('Descripción').fill('SERVICIO QA SINTETICO SIN VALIDEZ FISCAL');
    await conceptDialog.getByLabel('Clave SAT producto/servicio').fill('84111506');
    await conceptDialog.getByLabel('Clave SAT unidad').fill('E48');
    await conceptDialog.getByLabel('Objeto de impuesto').selectOption('01');
    await conceptDialog.getByLabel('Tasa IVA (0 a 1)').fill('0');
    await conceptDialog.getByLabel('Tasa retención IVA (0 a 1)').fill('0');
    await conceptDialog.getByLabel('Tasa retención ISR (0 a 1)').fill('0');
    const conceptCreated = page.waitForResponse(response => response.url().endsWith('/api/finanzas/facturacion/conceptos') && response.request().method() === 'POST');
    await conceptDialog.getByRole('button', { name: 'Guardar concepto' }).click();
    const conceptResponse = await conceptCreated;
    expect(conceptResponse.status(), await conceptResponse.text()).toBe(201);
    const configuredConceptId = (await conceptResponse.json()).data.id as string;
    await page.getByRole('button', { name: 'Nueva factura' }).click();
    const draftDialog = page.getByRole('dialog', { name: 'Nueva factura' });
    await draftDialog.getByLabel('Entidad fiscal').selectOption(entity.id);
    await expect(draftDialog.getByLabel('Lugar de expedición')).toHaveValue('63735');
    await draftDialog.getByLabel('RFC receptor').fill('QAFB010101ABC');
    await draftDialog.getByLabel('Nombre o razón social').fill('RECEPTOR SINTETICO QA');
    await draftDialog.getByLabel('Régimen receptor').selectOption('612');
    await draftDialog.getByLabel('Código postal fiscal').fill('63735');
    await draftDialog.getByLabel('Uso CFDI').selectOption('G03');
    await draftDialog.getByLabel('Método de pago').selectOption('PUE');
    await draftDialog.getByLabel('Forma de pago').fill('01');
    await draftDialog.getByLabel('Concepto fiscal configurado').selectOption(configuredConceptId);
    await draftDialog.getByLabel('Valor unitario').fill('100.00');
    const draftCreated = page.waitForResponse(response => response.url().endsWith('/api/finanzas/facturacion/borradores') && response.request().method() === 'POST');
    await draftDialog.getByRole('button', { name: 'Guardar borrador' }).click();
    const draftResponse = await draftCreated;
    expect(draftResponse.status(), await draftResponse.text()).toBe(201);
    const draft = (await draftResponse.json()).data.cfdi as { id: string };
    await page.getByRole('button', { name: 'CFDI', exact: true }).click();
    const persistedDraft = await db.documentoCfdi.findUniqueOrThrow({ where: { id: draft.id } });
    expect(persistedDraft.entidad_fiscal_id).toBe(entity.id);
    expect(persistedDraft.emisor_rfc).toBe(rfc);
    expect(persistedDraft.emisor_nombre).toBe('PERSONA FISICA SINTETICA');
    await page.locator(`article#cfdi-${draft.id}`).getByRole('button', { name: 'Abrir borrador' }).click();
    const reopenedDraft = page.getByRole('dialog', { name: /Borrador FAC-BOR-/ });
    await expect(reopenedDraft.getByLabel('Entidad fiscal')).toHaveValue(entity.id);
    await expect(reopenedDraft.getByLabel('RFC receptor')).toHaveValue('QAFB010101ABC');
    await reopenedDraft.getByRole('button', { name: 'Cerrar sin guardar' }).click();
    const pdfArea = page.locator(`article#cfdi-${draft.id} section[aria-label^="Prefactura PDF"]`);
    await expect(pdfArea).toBeVisible();
    const generated = page.waitForResponse(response => response.url().endsWith(`/api/finanzas/facturacion/borradores/${draft.id}/prefacturas`) && response.request().method() === 'POST');
    await pdfArea.getByRole('button', { name: 'Generar nueva versión PDF' }).click();
    const pdfResponse = await generated;
    expect(pdfResponse.status(), await pdfResponse.text()).toBe(201);
    const version = await db.prefacturaRepresentacion.findFirstOrThrow({ where: { cfdi_id: draft.id }, orderBy: { version: 'desc' } });
    expect(version.pdf_sha256).toMatch(/^[0-9a-f]{64}$/);
    const pdfLink = await request.get(`/api/finanzas/facturacion/borradores/${draft.id}/prefacturas/${version.version}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(pdfLink.status(), await pdfLink.text()).toBe(200);
    const pdfDownload = await request.get((await pdfLink.json()).data.url);
    expect(pdfDownload.status()).toBe(200);
    const pdfBuffer = Buffer.from(await pdfDownload.body());
    expect(pdfBuffer.subarray(0, 5).toString('latin1')).toBe('%PDF-');
    expect(createHash('sha256').update(pdfBuffer).digest('hex')).toBe(version.pdf_sha256);
    const parsed = new PDFParse({ data: pdfBuffer });
    try {
      const text = (await parsed.getText()).text;
      expect(text).toContain(rfc);
      expect(text).toContain('63735');
      expect(text).toContain('605');
      expect(text).toContain('100.00');
      expect(text).toContain('Subtotal');
      expect(text).toContain('Impuestos trasladados');
      expect(text).toContain('Impuestos retenidos');
      expect(text).toContain('TOTAL');
    } finally { await parsed.destroy(); }
    await pdfArea.getByRole('button', { name: 'Versiones PDF' }).click();
    await pdfArea.getByRole('button', { name: 'Ver', exact: true }).first().click();
    await expect(page.locator('canvas[data-preview-loaded="true"]')).toBeVisible();
    const prefacturaDownload = page.waitForEvent('download');
    await page.getByRole('dialog', { name: /FAC-BOR-.*\.pdf/ }).getByRole('button', { name: /Descargar FAC-BOR-/ }).click();
    expect((await prefacturaDownload).suggestedFilename()).toMatch(/\.pdf$/i);
    await page.getByRole('button', { name: 'Cerrar vista previa' }).click();
    await expect(pdfArea.getByRole('button', { name: 'Timbrar CFDI' })).toBeDisabled();
    expect(persistedDraft.uuid_fiscal).toBeNull();
    await page.getByRole('button', { name: 'Entidades fiscales' }).click();
    await page.locator('article').filter({ hasText: rfc }).getByRole('button', { name: 'Abrir ficha' }).click();
    await expect(page.getByRole('region', { name: 'Historial de constancias fiscales' })).toContainText('v1');
    await page.getByRole('button', { name: 'Sustituir CSF' }).click();
    const replacementDialog = page.getByRole('dialog', { name: 'Sustituir CSF' });
    const replacementPdf = await syntheticCsf(rfc, [
      '605 Sueldos y Salarios e Ingresos Asimilados a Salarios',
      '612 Personas Fisicas con Actividades Empresariales y Profesionales',
    ]);
    const replacementSha = createHash('sha256').update(replacementPdf).digest('hex');
    const replacementUploaded = page.waitForResponse(response => response.url().endsWith('/api/finanzas/facturacion/entidades/csf') && response.request().method() === 'POST');
    await replacementDialog.getByLabel('Cargar Constancia de Situación Fiscal').setInputFiles({ name: 'CSF_SINTETICA_VERSION2.pdf', mimeType: 'application/pdf', buffer: replacementPdf });
    const replacementUploadResponse = await replacementUploaded;
    expect(replacementUploadResponse.status(), await replacementUploadResponse.text()).toBe(201);
    const replacementId = (await replacementUploadResponse.json()).data.id as string;
    await expect(replacementDialog.getByRole('textbox', { name: 'RFC' })).toHaveValue(rfc);
    await replacementDialog.getByLabel('Régimen principal para la emisión').selectOption('605');
    await replacementDialog.getByLabel('Revisé la constancia y confirmo los datos fiscales.').check();
    const replacementSaved = page.waitForResponse(response => response.url().endsWith(`/api/finanzas/facturacion/entidades/${entity.id}/csf`) && response.request().method() === 'PATCH');
    await replacementDialog.getByRole('button', { name: 'Guardar nueva versión' }).click();
    const replacementSaveResponse = await replacementSaved;
    expect(replacementSaveResponse.status(), await replacementSaveResponse.text()).toBe(200);
    expect((await db.entidadFiscalCfdi.findUniqueOrThrow({ where: { id: entity.id } })).csf_documento_id).toBe(replacementId);
    const history = await db.entidadFiscalCsfVersion.findMany({ where: { entidad_fiscal_id: entity.id }, orderBy: { version: 'asc' } });
    expect(history.map(item => item.version)).toEqual([1, 2]);
    expect(history.map(item => item.documento_id)).toEqual([uploadedData.id, replacementId]);
    expect((await db.entidadFiscalCfdi.findUniqueOrThrow({ where: { id: entity.id } })).regimenes_fiscales)
      .toEqual([{ clave: '605', descripcion: expect.any(String) }, { clave: '612', descripcion: expect.any(String) }]);
    expect((await db.documento.findUniqueOrThrow({ where: { id: uploadedData.id } })).checksum_sha256).toBe(sha);
    expect((await db.documento.findUniqueOrThrow({ where: { id: replacementId } })).checksum_sha256).toBe(replacementSha);
    await page.locator('article').filter({ hasText: rfc }).getByRole('button', { name: 'Abrir ficha' }).click();
    await expect(page.getByRole('dialog', { name: 'Ficha de entidad fiscal' })).toContainText('v2');
    await expect(page.getByRole('dialog', { name: 'Ficha de entidad fiscal' })).toContainText('v1');
    expect(await db.auditLog.count({ where: { entidad_id: entity.id, accion: 'REPLACE_FISCAL_ENTITY_CSF' } })).toBe(1);
    await page.getByRole('dialog', { name: 'Ficha de entidad fiscal' }).getByRole('button', { name: 'Cerrar' }).last().click();
    await page.getByRole('button', { name: 'Nueva factura' }).click();
    const secondDraftDialog = page.getByRole('dialog', { name: 'Nueva factura' });
    await secondDraftDialog.getByLabel('Entidad fiscal').selectOption(entity.id);
    await expect(secondDraftDialog.getByLabel('Régimen emisor para esta factura').locator('option')).toHaveCount(3);
    await secondDraftDialog.getByLabel('Régimen emisor para esta factura').selectOption('612');
    await secondDraftDialog.getByLabel('RFC receptor').fill('QAFB010101ABC');
    await secondDraftDialog.getByLabel('Nombre o razón social').fill('RECEPTOR SINTETICO QA');
    await secondDraftDialog.getByLabel('Régimen receptor').selectOption('612');
    await secondDraftDialog.getByLabel('Código postal fiscal').fill('63735');
    await secondDraftDialog.getByLabel('Uso CFDI').selectOption('G03');
    await secondDraftDialog.getByLabel('Método de pago').selectOption('PUE');
    await secondDraftDialog.getByLabel('Forma de pago').fill('01');
    await secondDraftDialog.getByLabel('Concepto fiscal configurado').selectOption(configuredConceptId);
    await secondDraftDialog.getByLabel('Valor unitario').fill('100.00');
    const secondCreated = page.waitForResponse(response => response.url().endsWith('/api/finanzas/facturacion/borradores') && response.request().method() === 'POST');
    await secondDraftDialog.getByRole('button', { name: 'Guardar borrador' }).click();
    const secondResponse = await secondCreated;
    expect(secondResponse.status(), await secondResponse.text()).toBe(201);
    const secondDraftId = (await secondResponse.json()).data.cfdi.id as string;
    const secondRow = await db.documentoCfdi.findUniqueOrThrow({ where: { id: secondDraftId } });
    expect((secondRow.draft_payload as { fiscal_comprobante: { regimen_emisor: string } }).fiscal_comprobante.regimen_emisor).toBe('612');
    await page.getByRole('button', { name: 'CFDI', exact: true }).click();
    const secondPdfArea = page.locator(`article#cfdi-${secondDraftId} section[aria-label^="Prefactura PDF"]`);
    const secondGenerated = page.waitForResponse(response => response.url().endsWith(`/api/finanzas/facturacion/borradores/${secondDraftId}/prefacturas`) && response.request().method() === 'POST');
    await secondPdfArea.getByRole('button', { name: 'Generar nueva versión PDF' }).click();
    const secondPdfResponse = await secondGenerated;
    expect(secondPdfResponse.status(), await secondPdfResponse.text()).toBe(201);
    const secondVersion = await db.prefacturaRepresentacion.findFirstOrThrow({ where: { cfdi_id: secondDraftId } });
    const secondLink = await request.get(`/api/finanzas/facturacion/borradores/${secondDraftId}/prefacturas/${secondVersion.version}`, { headers: { Authorization: `Bearer ${token}` } });
    const secondPdf = await request.get((await secondLink.json()).data.url);
    const secondParser = new PDFParse({ data: Buffer.from(await secondPdf.body()) });
    try { expect((await secondParser.getText()).text).toContain('612'); }
    finally { await secondParser.destroy(); }
  } finally {
    await db.$disconnect();
  }
});

test('P0 entidad fiscal: rechazos, permisos, aislamiento y concurrencia sin duplicados', async ({ request }, testInfo) => {
  const base = new URL(String(testInfo.project.use.baseURL));
  if (base.hostname !== '127.0.0.1' || !['5176','5177'].includes(base.port) ||
    process.env.PRAVIA_E2E_LOCAL_DATABASE_URL !== databaseUrl || !credentials.password) {
    throw new Error('FISCAL_ENTITY_LOCAL_SAFETY_GATE_FAILED');
  }
  const db = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
  const auth = await request.post('/api/auth/login', { data: credentials });
  expect(auth.status()).toBe(200);
  const admin = (await auth.json()).access_token as string;
  const headers = { Authorization: `Bearer ${admin}` };
  const baseEntity = { razon_social: 'PERSONA FISICA SINTETICA', codigo_postal: '63735',
    regimen_fiscal: '605', regimenes_fiscales: [{ clave: '605' }],
    manual_exception_reason: 'Revisión manual sintética exclusivamente para prueba de rechazo.' };
  const prospectiveRfc = `QAFA010101${randomUUID().replaceAll('-', '').slice(0, 3).toUpperCase()}`;
  try {
    const withoutCsf = await request.post('/api/finanzas/facturacion/entidades', {
      headers, data: { ...baseEntity, rfc: prospectiveRfc, manual_exception_reason: '' },
    });
    expect(withoutCsf.status()).toBe(400);
    const invalidRfc = await request.post('/api/finanzas/facturacion/entidades', {
      headers, data: { ...baseEntity, rfc: 'NO-RFC' },
    });
    expect(invalidRfc.status()).toBe(422);
    expect((await invalidRfc.json()).correlation_id).toMatch(/^[0-9a-f-]{36}$/i);
    const inventedRegime = await request.post('/api/finanzas/facturacion/entidades', {
      headers, data: { ...baseEntity, rfc: prospectiveRfc, regimen_fiscal: '999', regimenes_fiscales: [{ clave: '999' }] },
    });
    expect(inventedRegime.status()).toBe(422);
    expect(await db.entidadFiscalCfdi.count({ where: { rfc: prospectiveRfc } })).toBe(0);
    const lawyerLogin = await request.post('/api/auth/login', { data: {
      email: 'alejandro.abarca@pravia.test', password: process.env.PRAVIA_E2E_ALEJANDRO_PASSWORD || '',
    } });
    expect(lawyerLogin.status()).toBe(200);
    const lawyerToken = (await lawyerLogin.json()).access_token as string;
    const forbidden = await request.post('/api/finanzas/facturacion/entidades', {
      headers: { Authorization: `Bearer ${lawyerToken}` }, data: { ...baseEntity, rfc: prospectiveRfc },
    });
    expect(forbidden.status()).toBe(403);

    const rfc = `QAFA010101${randomUUID().replaceAll('-', '').slice(0, 3).toUpperCase()}`;
    const pdf = await syntheticCsf(rfc);
    const uploadInput = { multipart: { file: { name: 'CSF_RETRY_SINTETICA.pdf', mimeType: 'application/pdf', buffer: pdf } }, headers };
    const uploaded = await request.post('/api/finanzas/facturacion/entidades/csf', uploadInput);
    expect(uploaded.status()).toBe(201);
    const documentId = (await uploaded.json()).data.id as string;
    const retriedUpload = await request.post('/api/finanzas/facturacion/entidades/csf', uploadInput);
    expect(retriedUpload.status()).toBe(200);
    expect((await retriedUpload.json()).data.id).toBe(documentId);
    const extracted = await request.post(`/api/finanzas/facturacion/entidades/csf/${documentId}/extraer`, { headers });
    expect(extracted.status(), await extracted.text()).toBe(200);
    const createInput = { ...baseEntity, rfc, csf_documento_id: documentId,
      csf_sha256: createHash('sha256').update(pdf).digest('hex'), csf_reviewed: true, manual_exception_reason: '' };
    const [first, second] = await Promise.all([
      request.post('/api/finanzas/facturacion/entidades', { headers, data: createInput }),
      request.post('/api/finanzas/facturacion/entidades', { headers, data: createInput }),
    ]);
    expect([first.status(), second.status()].sort()).toEqual([201, 201]);
    const createdId = (await first.json()).data.id as string;
    expect((await second.json()).data.id).toBe(createdId);
    expect(await db.entidadFiscalCfdi.count({ where: { rfc } })).toBe(1);
    expect(await db.entidadFiscalCsfVersion.count({ where: { entidad_fiscal_id: createdId } })).toBe(1);
    expect(await db.documento.count({ where: { id: documentId } })).toBe(1);
    const listing = await request.get('/api/finanzas/facturacion/entidades', { headers });
    const listed = ((await listing.json()).data as Array<{ id: string; csf_extraction: Record<string, unknown> }>)
      .find(item => item.id === createdId);
    expect(listed?.csf_extraction?.detected).toBeUndefined();
    const conflictingPdf = await syntheticCsf(rfc, [
      '605 Sueldos y Salarios e Ingresos Asimilados a Salarios',
      '612 Personas Fisicas con Actividades Empresariales y Profesionales',
    ]);
    const conflictingUpload = await request.post('/api/finanzas/facturacion/entidades/csf', { headers,
      multipart: { file: { name: 'CSF_MISMO_RFC_OTRA_VERSION.pdf', mimeType: 'application/pdf', buffer: conflictingPdf } } });
    expect(conflictingUpload.status()).toBe(201);
    const conflictingId = (await conflictingUpload.json()).data.id as string;
    expect((await request.post(`/api/finanzas/facturacion/entidades/csf/${conflictingId}/extraer`, { headers })).status()).toBe(200);
    const conflictingCreate = await request.post('/api/finanzas/facturacion/entidades', { headers, data: {
      ...createInput, csf_documento_id: conflictingId, csf_sha256: createHash('sha256').update(conflictingPdf).digest('hex'),
      regimenes_fiscales: [{ clave: '605' }, { clave: '612' }],
    } });
    expect(conflictingCreate.status()).toBe(409);
    expect(await db.entidadFiscalCfdi.count({ where: { rfc } })).toBe(1);

    const tenant = await db.organization.create({ data: { name: `CSF TENANT QA ${randomUUID()}` } });
    const tenantPassword = `Qa!${randomUUID()}Aa1`;
    const tenantUser = await db.user.create({ data: { email: `csf-tenant-${randomUUID()}@pravia.test`,
      password_hash: await bcrypt.hash(tenantPassword, 10), nombre: 'TENANT', apellido: 'QA',
      rol: 'DIRECCION', requires_password_change: false } });
    try {
      await db.organizationMembership.create({ data: { organization_id: tenant.id, user_id: tenantUser.id, rol: 'DIRECCION' } });
      const login = await request.post('/api/auth/login', { data: { email: tenantUser.email, password: tenantPassword } });
      expect(login.status()).toBe(200);
      const tenantHeaders = { Authorization: `Bearer ${(await login.json()).access_token}` };
      const visible = await request.get('/api/finanzas/facturacion/entidades', { headers: tenantHeaders });
      expect(visible.status()).toBe(200);
      expect(JSON.stringify((await visible.json()).data)).not.toContain(createdId);
      const crossRead = await request.get(`/api/finanzas/facturacion/entidades/${createdId}/csf/versiones`, { headers: tenantHeaders });
      expect(crossRead.status()).toBe(404);
      const crossReplace = await request.patch(`/api/finanzas/facturacion/entidades/${createdId}/csf`, {
        headers: tenantHeaders, data: createInput,
      });
      expect(crossReplace.status()).toBe(404);
    } finally {
      await db.authSession.deleteMany({ where: { user_id: tenantUser.id } });
      await db.auditLog.deleteMany({ where: { user_id: tenantUser.id } });
      await db.organizationMembership.deleteMany({ where: { user_id: tenantUser.id } });
      await db.user.delete({ where: { id: tenantUser.id } });
      await db.organization.delete({ where: { id: tenant.id } });
    }
  } finally {
    await db.$disconnect();
  }
});

test('P0 entidad fiscal: OCR real de PDF escaneado y rechazo de no-CSF sin falso éxito', async ({ page, request }, testInfo) => {
  const base = new URL(String(testInfo.project.use.baseURL));
  if (base.hostname !== '127.0.0.1' || !['5176','5177'].includes(base.port) ||
    process.env.PRAVIA_E2E_LOCAL_DATABASE_URL !== databaseUrl || !credentials.password) {
    throw new Error('FISCAL_ENTITY_LOCAL_SAFETY_GATE_FAILED');
  }
  const auth = await request.post('/api/auth/login', { data: credentials });
  expect(auth.status()).toBe(200);
  const headers = { Authorization: `Bearer ${(await auth.json()).access_token}` };
  const rfc = `QAFA010101${randomUUID().replaceAll('-', '').slice(0, 3).toUpperCase()}`;
  await page.setViewportSize({ width: 1200, height: 800 });
  await page.setContent(`<main id="csf" style="width:950px;height:600px;padding:36px;background:white;color:black;font:26px/2 Arial">
    <div>CONSTANCIA DE SITUACION FISCAL</div><div>SINTETICA - SIN VALIDEZ FISCAL</div>
    <div>RFC: ${rfc}</div><div>Nombre completo: PERSONA FISICA SINTETICA</div>
    <div>Codigo Postal: 63735</div><div>Regimen Fiscal: 605 Sueldos y Salarios</div></main>`);
  const image = await page.locator('#csf').screenshot();
  const scanned = await PDFDocument.create();
  const embedded = await scanned.embedPng(image);
  scanned.addPage([embedded.width, embedded.height]).drawImage(embedded, { x: 0, y: 0, width: embedded.width, height: embedded.height });
  const scannedPdf = Buffer.from(await scanned.save());
  const uploaded = await request.post('/api/finanzas/facturacion/entidades/csf', { headers,
    multipart: { file: { name: 'CSF_ESCANEADA_SINTETICA.pdf', mimeType: 'application/pdf', buffer: scannedPdf } } });
  expect(uploaded.status(), await uploaded.text()).toBe(201);
  const documentId = (await uploaded.json()).data.id as string;
  const extraction = await request.post(`/api/finanzas/facturacion/entidades/csf/${documentId}/extraer`, { headers, timeout: 90_000 });
  expect(extraction.status(), await extraction.text()).toBe(200);
  const result = (await extraction.json()).data;
  expect(result.source).toBe('LOCAL_OCR_PDF');
  expect(result.rfc).toBe(rfc);
  expect(result.regimenes_fiscales.map((item: { clave: string }) => item.clave)).toContain('605');

  const notCsf = await PDFDocument.create();
  const notCsfPage = notCsf.addPage();
  notCsfPage.drawText('ARCHIVO SINTETICO QUE NO ES CONSTANCIA FISCAL');
  const rejectedUpload = await request.post('/api/finanzas/facturacion/entidades/csf', { headers,
    multipart: { file: { name: 'NO_ES_CSF.pdf', mimeType: 'application/pdf', buffer: Buffer.from(await notCsf.save()) } } });
  expect(rejectedUpload.status(), await rejectedUpload.text()).toBe(201);
  const rejectedId = (await rejectedUpload.json()).data.id as string;
  const rejected = await request.post(`/api/finanzas/facturacion/entidades/csf/${rejectedId}/extraer`, { headers, timeout: 90_000 });
  expect(rejected.status()).toBe(422);
  const db = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
  try {
    expect((await db.documento.findUniqueOrThrow({ where: { id: rejectedId } })).estatus).toBe('VIGENTE');
    expect(await db.entidadFiscalCfdi.count({ where: { csf_documento_id: rejectedId } })).toBe(0);
  } finally { await db.$disconnect(); }
});

test('P0 entidad fiscal: CSF parcial solicita sólo datos ausentes y registra corrección humana', async ({ page }, testInfo) => {
  const base = new URL(String(testInfo.project.use.baseURL));
  if (base.hostname !== '127.0.0.1' || !['5176','5177'].includes(base.port) ||
    process.env.PRAVIA_E2E_LOCAL_DATABASE_URL !== databaseUrl || !credentials.password) {
    throw new Error('FISCAL_ENTITY_LOCAL_SAFETY_GATE_FAILED');
  }
  const db = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
  try {
    const rfc = `QAFA010101${randomUUID().replaceAll('-', '').slice(0, 3).toUpperCase()}`;
    const pdf = await PDFDocument.create();
    const pagePdf = pdf.addPage();
    pagePdf.drawText('CONSTANCIA DE SITUACION FISCAL - SINTETICA / SIN VALIDEZ FISCAL', { x: 32, y: 750 });
    pagePdf.drawText(`RFC: ${rfc}`, { x: 32, y: 725 });
    pagePdf.drawText('Nombre completo: PERSONA FISICA PARCIAL', { x: 32, y: 700 });
    await page.goto('/login');
    await page.getByRole('textbox', { name: 'Correo electrónico' }).fill(credentials.email);
    await page.getByRole('textbox', { name: 'Contraseña', exact: true }).fill(credentials.password);
    if (await page.getByRole('textbox', { name: 'Correo electrónico' }).inputValue() !== credentials.email) {
      await page.getByRole('textbox', { name: 'Correo electrónico' }).fill(credentials.email);
    }
    await expect(page.getByRole('button', { name: 'Iniciar sesión', exact: true })).toBeEnabled();
    await page.getByRole('button', { name: 'Iniciar sesión', exact: true }).click();
    await page.waitForURL('**/mi-dia');
    await page.goto('/finanzas?view=facturacion');
    await page.getByRole('tab', { name: 'CFDI y cuentas' }).click();
    await page.getByRole('button', { name: 'Entidades fiscales' }).click();
    await page.getByRole('button', { name: 'Agregar entidad fiscal' }).click();
    const dialog = page.getByRole('dialog', { name: 'Agregar entidad fiscal' });
    await dialog.getByLabel('Cargar Constancia de Situación Fiscal').setInputFiles({
      name: 'CSF_PARCIAL_SINTETICA.pdf', mimeType: 'application/pdf', buffer: Buffer.from(await pdf.save()),
    });
    await expect(dialog.getByRole('textbox', { name: 'RFC' })).toHaveValue(rfc);
    await expect(dialog.getByRole('textbox', { name: 'Nombre o razón social' })).toHaveValue('PERSONA FISICA PARCIAL');
    await expect(dialog.getByRole('textbox', { name: 'Código postal fiscal' })).toHaveValue('');
    await expect(dialog.getByLabel('Régimen confirmado por revisión humana')).toBeVisible();
    await dialog.getByRole('textbox', { name: 'Código postal fiscal' }).fill('63735');
    await dialog.getByLabel('Régimen confirmado por revisión humana').selectOption('605');
    await dialog.getByLabel('Motivo de correspondencia o corrección manual')
      .fill('CSF sintética parcial: CP y régimen confirmados manualmente para QA.');
    await dialog.getByLabel('Revisé la constancia y confirmo los datos fiscales.').check();
    const created = page.waitForResponse(response => response.url().endsWith('/api/finanzas/facturacion/entidades') && response.request().method() === 'POST');
    await dialog.getByRole('button', { name: 'Guardar entidad fiscal' }).click();
    const response = await created;
    expect(response.status(), await response.text()).toBe(201);
    const entity = (await response.json()).data as { id: string };
    const persisted = await db.entidadFiscalCfdi.findUniqueOrThrow({ where: { id: entity.id } });
    expect(persisted.codigo_postal).toBe('63735');
    expect(persisted.regimen_fiscal).toBe('605');
    expect((persisted.csf_extraction as { confirmation_status: string }).confirmation_status).toBe('CORRECTED');
    expect(await db.auditLog.count({ where: { entidad_id: entity.id, accion: 'CREATE_FISCAL_ENTITY' } })).toBe(1);
  } finally { await db.$disconnect(); }
});

test('P0 entidad fiscal: modal CSF accesible sin overflow horizontal a 390 y 320 px', async ({ page }, testInfo) => {
  const base = new URL(String(testInfo.project.use.baseURL));
  if (base.hostname !== '127.0.0.1' || !['5176','5177'].includes(base.port) ||
    process.env.PRAVIA_E2E_LOCAL_DATABASE_URL !== databaseUrl || !credentials.password) {
    throw new Error('FISCAL_ENTITY_LOCAL_SAFETY_GATE_FAILED');
  }
  await page.goto('/login');
  await page.getByRole('textbox', { name: 'Correo electrónico' }).fill(credentials.email);
  await page.getByRole('textbox', { name: 'Contraseña', exact: true }).fill(credentials.password);
  if (await page.getByRole('textbox', { name: 'Correo electrónico' }).inputValue() !== credentials.email) {
    await page.getByRole('textbox', { name: 'Correo electrónico' }).fill(credentials.email);
  }
  await expect(page.getByRole('button', { name: 'Iniciar sesión', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Iniciar sesión', exact: true }).click();
  await page.waitForURL('**/mi-dia');
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 760 });
    await page.goto('/finanzas?view=facturacion');
    await page.getByRole('tab', { name: 'CFDI y cuentas' }).click();
    await page.getByRole('button', { name: 'Entidades fiscales' }).click();
    await page.getByRole('button', { name: 'Agregar entidad fiscal' }).click();
    const dialog = page.getByRole('dialog', { name: 'Agregar entidad fiscal' });
    await expect(dialog.getByLabel('Cargar Constancia de Situación Fiscal')).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Cerrar' }).last()).toBeVisible();
    const widths = await page.evaluate(() => ({ page: document.documentElement.scrollWidth,
      viewport: window.innerWidth, dialog: document.querySelector('[role="dialog"]')?.getBoundingClientRect().width || 0 }));
    expect(widths.page, `overflow global a ${width}px`).toBeLessThanOrEqual(width + 1);
    expect(widths.dialog, `modal fuera del viewport a ${width}px`).toBeLessThanOrEqual(width + 1);
    await dialog.getByRole('button', { name: 'Cerrar' }).last().click();
  }
});
