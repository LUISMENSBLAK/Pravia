import { execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { readFile, rename, stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { expect, test } from '@playwright/test';
import { PrismaClient } from '../../backend/node_modules/@prisma/client/default.js';
import bcrypt from '../../backend/node_modules/bcryptjs/index.js';

const alternativeTemplate = () => execFileSync(
  '/Users/15indicado/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin/python3',
  ['-c', `from docx import Document\nfrom io import BytesIO\nimport sys\nd=Document()\nd.add_heading('COTIZACIÓN QA EN FORMATO ALTERNATIVO', 0)\nd.add_paragraph('Folio: {{cotizacion.folio}}')\nd.add_paragraph('Cliente: {{cliente.nombre}}')\nt=d.add_table(rows=4, cols=2)\nfor row, values in zip(t.rows,[('Concepto','Importe'),('Nota conservada',''),('PARTIDA MODELO','0.00'),('TOTAL DEL FORMATO','0.00')]):\n for cell, value in zip(row.cells, values): cell.text=value\nd.add_paragraph('NOTA FINAL DEL MACHOTE QA')\nb=BytesIO(); d.save(b); sys.stdout.buffer.write(b.getvalue())`],
);

test('NOV-ADM: configura ADM-001 original en CFG-002 y lo usa en una cotización QA', async ({ page }, testInfo) => {
  const base = new URL(String(testInfo.project.use.baseURL || ''));
  const password = process.env.PRAVIA_E2E_PASSWORD;
  const dbUrl = process.env.PRAVIA_E2E_LOCAL_DATABASE_URL;
  if (base.hostname !== '127.0.0.1' || base.port !== '5176' || !password ||
    dbUrl !== 'postgresql://postgres@127.0.0.1:55439/postgres?schema=pravia_os') throw new Error('NOV_ADM_LOCAL_QA_ONLY');
  expect(await (await page.request.get('/api/health')).json()).toMatchObject({ database_mode: 'local', storage_mode: 'local' });
  const fixtureName = `ADM-001 QA ${testInfo.workerIndex}-${Date.now()}`;
  let originalWord = '';
  await page.goto('/login');
  await expect(page.getByRole('button', { name: 'Iniciar sesión', exact: true })).toBeVisible();
  const loginButton = page.getByRole('button', { name: 'Iniciar sesión', exact: true });
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await page.getByRole('textbox', { name: 'Correo electrónico' }).fill('adrian.hernandez@pravia.test');
    await page.getByRole('textbox', { name: 'Contraseña', exact: true }).fill(password);
    if (await loginButton.isEnabled()) break;
  }
  await expect(loginButton).toBeEnabled();
  const authResponse = page.waitForResponse(response => response.url().endsWith('/api/auth/login') && response.request().method() === 'POST');
  await page.getByRole('button', { name: 'Iniciar sesión', exact: true }).click();
  await expect(page).toHaveURL(/\/mi-dia$/);
  const auth = await (await authResponse).json();
  const organizationId = auth.user.organization.id as string;
  const db = new PrismaClient({ datasources: { db: { url: dbUrl } } });
  let previousDefaults: string[] = [];
  let otherOrgId: string | undefined;
  let otherUserId: string | undefined;
  try {
  previousDefaults = (await db.catalogoArtefactoDestino.findMany({ where: { organization_id: organizationId, destino: 'COTIZACION_SERVICIOS', activo: true, predeterminado: true }, select: { id: true } })).map(row => row.id);
  await db.catalogoArtefactoDestino.updateMany({ where: { organization_id: organizationId, id: { in: previousDefaults } }, data: { activo: false } });

  await page.goto('/configuracion/plantillas-formatos');
  await page.getByRole('button', { name: /Organización/ }).last().click();
  const explorerLoaded = page.waitForResponse(response => response.url().includes('/settings/catalogs/explorer?') && response.url().includes('type=FORMATO') && response.ok());
  await page.getByRole('button', { name: /DOCUMENTO PARA LLENADO.*Formatos/ }).click();
  await explorerLoaded;
  {
    await page.getByRole('button', { name: 'Nuevo formato' }).click();
    const dialog = page.getByRole('dialog', { name: 'Nuevo formato' });
    await dialog.getByLabel('Nombre').fill(fixtureName);
    const zip = '../backend/resources/cfg002/PRAVIA_OS_CFG-002_Biblioteca_Estandar_v2_LEGAL.zip';
    const entry = 'PRAVIA_OS_CFG-002_Biblioteca_Estandar_v2_LEGAL/NOTARIA/Formatos/Administrativos/ADM-001_Cotizacion_Servicios_Notariales.docx';
    const buffer = execFileSync('unzip', ['-p', zip, entry], { cwd: process.cwd() });
    await dialog.locator('input[type="file"]').setInputFiles({ name: 'ADM-001_Cotizacion_Servicios_Notariales.docx', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', buffer });
    await dialog.getByLabel('Destino funcional').selectOption('COTIZACION_SERVICIOS');
    await dialog.getByRole('button', { name: 'Guardar' }).click();
    await expect(page.getByRole('heading', { name: new RegExp(`^${fixtureName}$`, 'i') })).toBeVisible();
  }

  const card = page.getByRole('heading', { name: new RegExp(`^${fixtureName}$`, 'i') }).locator('xpath=ancestor::article[1]');
  {
    await page.goto('/cotizaciones');
    await page.getByPlaceholder(/Buscar/).fill('COT-0072-2026');
    await page.getByRole('button', { name: 'COT-0072-2026', exact: true }).click();
    const generation = page.waitForResponse(response => response.url().endsWith('/generar-documento') && response.request().method() === 'POST');
    await page.getByRole('button', { name: 'Generar cotización' }).click();
    const result = await generation;
    expect(result.status(), await result.text()).toBe(201);
    const name = (await result.json()).nombre_original as string;
    originalWord = name;
    await expect(page.getByText(name, { exact: true })).toBeVisible();
    await page.getByRole('button', { name: `Ver ${name}` }).click();
    const preview = page.getByRole('dialog', { name });
    await expect(preview.getByText('Vista maquetada')).toBeVisible();
    await expect(preview.getByText('HONORARIOS SINTÉTICOS DE ACEPTACIÓN')).toBeVisible();
    await preview.getByRole('button', { name: 'Cerrar vista previa' }).click();
    const download = page.waitForEvent('download');
    await page.getByRole('button', { name: `Descargar ${name}` }).click();
    expect((await download).suggestedFilename()).toBe(name);

    await page.goto('/configuracion/plantillas-formatos');
    await page.getByRole('button', { name: /Organización/ }).last().click();
    await page.getByRole('button', { name: /DOCUMENTO PARA LLENADO.*Formatos/ }).click();
    await card.getByRole('button', { name: 'Nueva versión' }).click();
    const versionDialog = page.getByRole('dialog', { name: /Nueva versión/ });
    await versionDialog.locator('input[type="file"]').setInputFiles({ name: 'ADM-001-QA-Alternativo.docx', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', buffer: alternativeTemplate() });
    await versionDialog.getByRole('button', { name: 'Guardar nueva versión' }).click();
    await expect(card.getByText('v2', { exact: true })).toBeVisible();
  }
  await card.getByRole('button', { name: 'Conectar a módulos' }).click();
  const mappingDialog = page.getByRole('dialog', { name: /Destinos funcionales/ });
  const configureMapping = mappingDialog.getByRole('button', { name: 'Configurar correspondencia de esta versión' });
  if (await configureMapping.count()) await configureMapping.click();
  await mappingDialog.getByLabel('Fila modelo de partidas').fill('3');
  await mappingDialog.getByLabel('Fila del total').fill('4');
  await mappingDialog.getByRole('button', { name: 'Guardar conexiones' }).click();
  await expect(mappingDialog).not.toBeVisible();

  await page.goto('/cotizaciones');
  await page.getByPlaceholder(/Buscar/).fill('COT-0072-2026');
  await page.getByRole('button', { name: 'COT-0072-2026', exact: true }).click();
  const originalPdf = originalWord.replace(/\.docx$/, '.pdf');
  await expect(page.getByText(originalWord, { exact: true })).toBeVisible();
  const originalRetry = page.getByRole('button', { name: `Reintentar PDF de ${originalWord}` });
  if (await originalRetry.count()) {
    const originalConversion = page.waitForResponse(response => response.url().includes('/documentos/') && response.url().endsWith('/generar-pdf') && response.request().method() === 'POST');
    await originalRetry.click();
    const converted = await originalConversion;
    expect(converted.status(), await converted.text()).toBe(201);
  }
  await expect(page.getByText(originalPdf, { exact: true })).toBeVisible();
  const originalView = page.waitForResponse(response => response.url().endsWith('/ver') && response.request().method() === 'GET' && response.headers()['content-type']?.includes('pdf'));
  await page.getByRole('button', { name: `Ver ${originalPdf}` }).click();
  const originalResponse = await originalView;
  const originalAuthorization = originalResponse.request().headers().authorization;
  if (!originalAuthorization) throw new Error('ORIGINAL_PDF_AUTH_MISSING');
  const originalFresh = await page.request.get(originalResponse.url(), { headers: { Authorization: originalAuthorization, 'Cache-Control': 'no-cache' } });
  expect(originalFresh.status()).toBe(200);
  const originalBytes = await originalFresh.body();
  expect(originalBytes.subarray(0, 5).toString()).toBe('%PDF-');
  await expect(page.getByRole('dialog', { name: originalPdf }).locator('canvas[data-preview-loaded="true"]').first()).toBeVisible();
  await page.getByRole('dialog', { name: originalPdf }).getByRole('button', { name: 'Cerrar vista previa' }).click();
  const originalDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: `Descargar ${originalPdf}` }).click();
  const savedOriginal = await (await originalDownload).path();
  if (!savedOriginal) throw new Error('ORIGINAL_PDF_DOWNLOAD_MISSING');
  expect(createHash('sha256').update(await readFile(savedOriginal)).digest('hex'))
    .toBe(createHash('sha256').update(originalBytes).digest('hex'));
  const quoteId = new URL(page.url()).pathname.split('/').at(-1);
  const originalInventory = await page.request.get(`/api/cotizaciones/${quoteId}/documentos`, { headers: { Authorization: originalAuthorization } });
  expect(originalInventory.status()).toBe(200);
  const originalRecord = (await originalInventory.json()).find((item: { nombre_original: string }) => item.nombre_original === originalPdf);
  expect(originalRecord?.checksum_sha256).toBe(createHash('sha256').update(originalBytes).digest('hex'));
  const root = '/tmp/pravia-nov-qa-20261110-storage';
  const wordRecord = (await (await page.request.get(`/api/cotizaciones/${quoteId}/documentos`, { headers: { Authorization: originalAuthorization } })).json())
    .find((item: { nombre_original: string }) => item.nombre_original === originalWord);
  const blob = resolve(root, originalRecord.storage_key);
  expect(blob.startsWith(`${root}/organizations/`)).toBe(true);
  expect((await stat(blob)).size).toBe(originalBytes.length);
  const held = `${blob}.qa-held`;
  await rename(blob, held);
  try {
    const recovered = page.waitForResponse(response => response.url().endsWith('/generar-pdf') && response.request().method() === 'POST');
    await page.getByRole('button', { name: `Verificar PDF de ${originalWord}` }).click();
    const recovery = await recovered;
    expect(recovery.status(), await recovery.text()).toBe(201);
    const successor = await recovery.json();
    expect(successor.id).not.toBe(originalRecord.id);
    expect(successor.datos_extraidos.generation).toMatchObject({ source_document_id: wordRecord.id, pdf_version: 2, replaces_missing_pdf_document_id: originalRecord.id });
    expect(createHash('sha256').update(await readFile(resolve(root, successor.storage_key))).digest('hex')).toBe(successor.checksum_sha256);
    const replay = await page.request.post(recovery.url(), { headers: { Authorization: originalAuthorization } });
    expect(replay.status()).toBe(201);
    expect((await replay.json()).id).toBe(successor.id);
    await expect(page.getByText(successor.nombre_original, { exact: true })).toBeVisible();
  } finally { await rename(held, blob); }
  const alternateGeneration = page.waitForResponse(response => response.url().endsWith('/generar-documento') && response.request().method() === 'POST');
  const alternateConversion = page.waitForResponse(response => response.url().includes('/documentos/') && response.url().endsWith('/generar-pdf') && response.request().method() === 'POST');
  await page.getByRole('button', { name: 'Generar cotización' }).click();
  const alternateResult = await alternateGeneration;
  expect(alternateResult.status(), await alternateResult.text()).toBe(201);
  const convertedAlternate = await alternateConversion;
  expect(convertedAlternate.status(), await convertedAlternate.text()).toBe(201);
  const alternateName = (await alternateResult.json()).nombre_original as string;
  const alternatePdf = (await convertedAlternate.json()).nombre_original as string;
  expect(alternatePdf).toBe(alternateName.replace(/\.docx$/, '.pdf'));
  await expect(page.getByText(alternateName, { exact: true })).toBeVisible();
  await page.getByRole('button', { name: `Ver ${alternateName}` }).click();
  const alternatePreview = page.getByRole('dialog', { name: alternateName });
  await expect(alternatePreview.getByText('Vista maquetada')).toBeVisible();
  await expect(alternatePreview.getByText('COTIZACIÓN QA EN FORMATO ALTERNATIVO')).toBeVisible();
  await expect(alternatePreview.getByText('HONORARIOS SINTÉTICOS DE ACEPTACIÓN')).toBeVisible();
  await expect(alternatePreview.getByText('NOTA FINAL DEL MACHOTE QA')).toBeVisible();
  await alternatePreview.getByRole('button', { name: 'Cerrar vista previa' }).click();
  await expect(page.getByText(alternatePdf, { exact: true })).toBeVisible();
  const alternateView = page.waitForResponse(response => response.url().endsWith('/ver') && response.request().method() === 'GET' && response.headers()['content-type']?.includes('pdf'));
  await page.getByRole('button', { name: `Ver ${alternatePdf}` }).click();
  const alternateResponse = await alternateView;
  const alternateAuthorization = alternateResponse.request().headers().authorization;
  if (!alternateAuthorization) throw new Error('ALTERNATE_PDF_AUTH_MISSING');
  const alternateFresh = await page.request.get(alternateResponse.url(), { headers: { Authorization: alternateAuthorization, 'Cache-Control': 'no-cache' } });
  expect(alternateFresh.status()).toBe(200);
  const alternateBytes = await alternateFresh.body();
  expect(alternateBytes.subarray(0, 5).toString()).toBe('%PDF-');
  const pdfPreview = page.getByRole('dialog', { name: alternatePdf });
  await expect(pdfPreview.locator('canvas[data-preview-loaded="true"]').first()).toBeVisible();
  await pdfPreview.getByRole('button', { name: 'Cerrar vista previa' }).click();
  const pdfDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: `Descargar ${alternatePdf}` }).click();
  const alternateDownloaded = await pdfDownload;
  expect(alternateDownloaded.suggestedFilename()).toBe(alternatePdf);
  const savedAlternate = await alternateDownloaded.path();
  if (!savedAlternate) throw new Error('ALTERNATE_PDF_DOWNLOAD_MISSING');
  expect(createHash('sha256').update(await readFile(savedAlternate)).digest('hex'))
    .toBe(createHash('sha256').update(alternateBytes).digest('hex'));
  const alternateInventory = await page.request.get(`/api/cotizaciones/${quoteId}/documentos`, { headers: { Authorization: alternateAuthorization } });
  expect(alternateInventory.status()).toBe(200);
  const alternateRecord = (await alternateInventory.json()).find((item: { nombre_original: string }) => item.nombre_original === alternatePdf);
  expect(alternateRecord?.checksum_sha256).toBe(createHash('sha256').update(alternateBytes).digest('hex'));
  await page.reload();
  await expect(page.getByText(originalPdf, { exact: true })).toBeVisible();
  await expect(page.getByText(alternatePdf, { exact: true })).toBeVisible();
  for (const name of [originalPdf, alternatePdf]) {
    await page.getByRole('button', { name: `Ver ${name}` }).click();
    const viewer = page.getByRole('dialog', { name });
    await expect(viewer.locator('canvas[data-preview-loaded="true"]').first()).toBeVisible();
    await viewer.getByRole('button', { name: 'Cerrar vista previa' }).click();
  }
  const other = await db.organization.create({ data: { name: `QA ADM aislamiento ${randomUUID()}` } });
  otherOrgId = other.id;
  const otherPassword = `Qa!${randomUUID()}Aa1`;
  const user = await db.user.create({ data: { email: `qa-adm-${randomUUID()}@pravia.test`,
    password_hash: await bcrypt.hash(otherPassword, 10), nombre: 'QA', apellido: 'ADM TENANT B',
    rol: 'DIRECCION', requires_password_change: false } });
  otherUserId = user.id;
  await db.organizationMembership.create({ data: { organization_id: other.id, user_id: user.id, rol: 'DIRECCION' } });
  const otherLogin = await page.request.post('/api/auth/login', { data: { email: user.email, password: otherPassword } });
  expect(otherLogin.status()).toBe(200);
  const otherHeaders = { Authorization: `Bearer ${(await otherLogin.json()).access_token}` };
  expect([403, 404]).toContain((await page.request.get(originalResponse.url(), { headers: otherHeaders })).status());
  expect([403, 404]).toContain((await page.request.post(`/api/cotizaciones/${quoteId}/documentos/${wordRecord.id}/generar-pdf`, { headers: otherHeaders })).status());
  } finally {
    try {
      await db.$transaction(async tx => {
        const artifact = await tx.catalogoArtefacto.findFirst({ where: { organization_id: organizationId, nombre: { equals: fixtureName, mode: 'insensitive' } }, select: { id: true } });
        if (artifact) await tx.catalogoArtefactoDestino.updateMany({ where: { organization_id: organizationId, artefacto_id: artifact.id }, data: { activo: false } });
        await tx.catalogoArtefactoDestino.updateMany({ where: { organization_id: organizationId, id: { in: previousDefaults } }, data: { activo: true } });
      });
      if (otherUserId) {
        await db.authSession.deleteMany({ where: { user_id: otherUserId } });
        await db.auditLog.deleteMany({ where: { user_id: otherUserId } });
        await db.organizationMembership.deleteMany({ where: { user_id: otherUserId } });
        await db.user.delete({ where: { id: otherUserId } });
      }
      if (otherOrgId) await db.organization.delete({ where: { id: otherOrgId } });
    } finally { await db.$disconnect(); }
  }
});
