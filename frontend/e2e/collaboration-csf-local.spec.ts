import { createHash, randomUUID } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { PrismaClient } from '../../backend/node_modules/@prisma/client/default.js';
import bcrypt from '../../backend/node_modules/bcryptjs/index.js';

const alejandro = { email: 'alejandro.abarca@pravia.test', password: process.env.PRAVIA_E2E_ALEJANDRO_PASSWORD || '' };
const javier = { email: 'javier.tapia@pravia.test', password: process.env.PRAVIA_E2E_JAVIER_PASSWORD || '' };
const rosa = { email: 'rosa.becerra@pravia.test', password: process.env.PRAVIA_E2E_ROSA_PASSWORD || '' };

async function login(page: Page, credentials: typeof alejandro) {
  await page.goto('/login');
  await page.getByRole('textbox', { name: 'Correo electrónico' }).fill(credentials.email);
  await page.getByRole('textbox', { name: 'Contraseña', exact: true }).fill(credentials.password);
  if (await page.getByRole('textbox', { name: 'Correo electrónico' }).inputValue() !== credentials.email) {
    await page.getByRole('textbox', { name: 'Correo electrónico' }).fill(credentials.email);
  }
  await expect(page.getByRole('button', { name: 'Iniciar sesión', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Iniciar sesión', exact: true }).click();
  await page.waitForURL('**/mi-dia');
}

async function syntheticCsf(regimes: Array<[string, string]> = [['901', 'REGIMEN SINTETICO A'], ['902', 'REGIMEN SINTETICO B']], rfc = 'QAFA010101QA1') {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([612, 792]);
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  [
    'CONSTANCIA DE SITUACION FISCAL - SINTETICA / SIN VALIDEZ FISCAL',
    `RFC: ${rfc}`, 'Nombre completo: PERSONA FISICA SINTETICA',
    'Codigo Postal: 63735', 'Domicilio Fiscal: CALLE DE PRUEBA 10',
    'Fecha de emision: 2026-10-26',
    ...regimes.map(([code, label]) => `Regimen Fiscal: ${code} ${label}`),
  ].forEach((line, index) => page.drawText(line, { x: 24, y: 740 - index * 23, font, size: 10 }));
  return Buffer.from(await pdf.save());
}

test('COL67 · CSF sintética compartida, procedencia persistida y cero doble extracción/cargo', async ({ browser, request }, testInfo) => {
  const base = new URL(String(testInfo.project.use.baseURL));
  const dbUrl = process.env.PRAVIA_E2E_LOCAL_DATABASE_URL || '';
  if (base.hostname !== '127.0.0.1' || base.port !== '5176' ||
    dbUrl !== 'postgresql://postgres@127.0.0.1:55439/postgres?schema=pravia_os' ||
    !alejandro.password || !javier.password || !rosa.password) throw new Error('COL67_LOCAL_SAFETY_GATE_FAILED');
  const db = new PrismaClient({ datasources: { db: { url: dbUrl } } });
  const aContext = await browser.newContext({ baseURL: base.toString() });
  const jContext = await browser.newContext({ baseURL: base.toString() });
  const a = await aContext.newPage();
  const j = await jContext.newPage();
  try {
    const aLogin = await request.post('/api/auth/login', { data: alejandro });
    const jLogin = await request.post('/api/auth/login', { data: javier });
    expect(aLogin.status()).toBe(200);
    expect(jLogin.status()).toBe(200);
    const aAuth = await aLogin.json();
    const jAuth = await jLogin.json();
    const orgId = aAuth.user.organization.id as string;
    expect(jAuth.user.organization.id).toBe(orgId);
    const authHeader = (token: string) => ({ Authorization: `Bearer ${token}` });
    await login(a, alejandro);
    const name = `COL67 CSF SINTETICA ${randomUUID().slice(0, 8).toUpperCase()}`;
    const syntheticRfc = `QAFA010101${randomUUID().replaceAll('-', '').slice(0, 3).toUpperCase()}`;
    const created = await request.post('/api/comparecientes/persona-fisica', {
      headers: authHeader(aAuth.access_token), data: { nombre: name },
    });
    expect(created.status(), await created.text()).toBe(201);
    const id = (await created.json()).data.compareciente.id as string;
    await a.goto(`/comparecientes/${id}`);
    await expect(a.getByRole('heading', { name })).toBeVisible();
    await a.getByRole('combobox', { name: 'Tipo de documento' }).selectOption('CONSTANCIA_FISCAL');
    const pdf = await syntheticCsf(undefined, syntheticRfc);
    const filename = 'CSF_COL67_SINTETICA_SIN_VALIDEZ.pdf';
    const uploaded = a.waitForResponse((response) => response.url().endsWith(`/api/comparecientes/${id}/documentos`) && response.request().method() === 'POST');
    await a.locator('input[type="file"]').setInputFiles({ name: filename, mimeType: 'application/pdf', buffer: pdf });
    const upload = await uploaded;
    expect(upload.status(), await upload.text()).toBe(201);
    const documentId = (await upload.json()).data.docMaster.id as string;
    const document = await db.documento.findUniqueOrThrow({ where: { id: documentId } });
    const sha = createHash('sha256').update(pdf).digest('hex');
    expect(document.checksum_sha256).toBe(sha);
    expect(document.storage_key).toContain(`organizations/${orgId}/`);
    const usageBefore = await db.aiUsageEvent.count({ where: { organization_id: orgId } });
    const walletBefore = await db.aiWalletTransaction.count({ where: { organization_id: orgId } });
    const extraction = a.waitForResponse((response) => response.url().endsWith(`/api/comparecientes/${id}/extraer-ia`) && response.request().method() === 'POST');
    await a.getByRole('button', { name: 'Extraer información con IA' }).click();
    const extracted = await extraction;
    expect(extracted.status(), await extracted.text()).toBe(200);
    const result = (await extracted.json()).data;
    expect(result.documentos_csf?.[0]?.sha256).toBe(sha);
    expect(result.documentos_csf?.[0]?.regimenes_fiscales.map((item: { clave: string }) => item.clave)).toEqual(['901', '902']);
    expect(await db.aiUsageEvent.count({ where: { organization_id: orgId } })).toBe(usageBefore);
    expect(await db.aiWalletTransaction.count({ where: { organization_id: orgId } })).toBe(walletBefore);
    await expect(a.getByRole('textbox', { name: /RFC Fuente: CSF local/ })).toHaveValue(syntheticRfc);
    await a.getByRole('button', { name: 'Guardar cambios' }).click();
    await expect(a.getByRole('status').filter({ hasText: 'Cambios guardados correctamente.' })).toBeVisible();
    const confirmedRfc = await db.comparecienteDatoFuente.findFirstOrThrow({ where: {
      organization_id: orgId, compareciente_id: id, documento_id: documentId, campo: 'rfc',
    } });
    expect(confirmedRfc.estado).toBe('CONFIRMADO');
    expect(confirmedRfc.valor_confirmado).toBe(syntheticRfc);
    expect(confirmedRfc.confirmado_por_id).toBe(aAuth.user.id);
    await a.getByRole('combobox', { name: 'Tipo de documento' }).selectOption('CONSTANCIA_FISCAL');
    await a.getByLabel('¿Sustituye un documento?').selectOption(documentId);
    await a.getByLabel('Tratamiento del anterior').selectOption('ARCHIVE_PRIOR');
    const replacementPdf = await syntheticCsf([['903', 'REGIMEN SINTETICO C']], syntheticRfc);
    const replaced = a.waitForResponse((response) => response.url().endsWith(`/api/comparecientes/${id}/documentos`) && response.request().method() === 'POST');
    await a.locator('input[type="file"]').setInputFiles({ name: 'CSF_COL67_REEMPLAZO_SINTETICA.pdf',
      mimeType: 'application/pdf', buffer: replacementPdf });
    const replacedResponse = await replaced;
    expect(replacedResponse.status(), await replacedResponse.text()).toBe(201);
    const replacementId = (await replacedResponse.json()).data.docMaster.id as string;
    await expect.poll(async () => (await db.comparecienteDocumento.findFirstOrThrow({ where: {
      compareciente_id: id, documento_id: documentId } })).vigencia).toBe('HISTORICO');
    expect((await db.comparecienteDocumento.findFirstOrThrow({ where: {
      compareciente_id: id, documento_id: replacementId } })).vigencia).toBe('VIGENTE');
    const newExtraction = a.waitForResponse((response) => response.url().endsWith(`/api/comparecientes/${id}/extraer-ia`) && response.request().method() === 'POST');
    await a.getByRole('button', { name: 'Extraer información con IA' }).click();
    const newResult = await newExtraction;
    expect(newResult.status(), await newResult.text()).toBe(200);
    expect((await newResult.json()).data.documentos_csf?.[0]?.regimenes_fiscales.map((item: { clave: string }) => item.clave)).toEqual(['903']);
    expect((await db.comparecienteDatoFuente.findMany({ where: { documento_id: documentId,
      campo: 'regimen_fiscal' } })).map((row) => row.valor_detectado).sort()).toEqual(['901', '902']);
    expect((await db.comparecienteDatoFuente.findUniqueOrThrow({ where: { id: confirmedRfc.id } })).estado).toBe('CONFIRMADO');
    expect((await db.comparecienteDatoFuente.findMany({ where: { documento_id: replacementId,
      campo: 'regimen_fiscal' } })).map((row) => row.valor_detectado)).toEqual(['903']);
    expect((await db.documento.findUniqueOrThrow({ where: { id: documentId } })).checksum_sha256).toBe(sha);
    expect((await db.documento.findUniqueOrThrow({ where: { id: replacementId } })).checksum_sha256)
      .toBe(createHash('sha256').update(replacementPdf).digest('hex'));
    expect(await db.aiUsageEvent.count({ where: { organization_id: orgId } })).toBe(usageBefore);
    expect(await db.aiWalletTransaction.count({ where: { organization_id: orgId } })).toBe(walletBefore);
    const rosaLogin = await request.post('/api/auth/login', { data: rosa });
    expect(rosaLogin.status()).toBe(200);
    const rosaAuth = await rosaLogin.json();
    const forbiddenRead = await request.get(`/api/comparecientes/${id}`, {
      headers: authHeader(rosaAuth.access_token),
    });
    expect(forbiddenRead.status()).toBe(403);
    const forbiddenExtract = await request.post(`/api/comparecientes/${id}/extraer-ia`, {
      headers: { ...authHeader(rosaAuth.access_token), 'Idempotency-Key': randomUUID() },
    });
    expect(forbiddenExtract.status()).toBe(403);
    expect(await db.auditLog.count({ where: { organization_id: orgId,
      entidad_id: id, accion: 'EXTRAER_DATOS_COMPARECIENTE_IA' } })).toBe(2);
    const sameKey = newResult.request().headers()['idempotency-key'];
    expect(sameKey).toBeTruthy();
    const retried = await request.post(`/api/comparecientes/${id}/extraer-ia`, {
      headers: { ...authHeader(aAuth.access_token), 'Idempotency-Key': sameKey },
    });
    expect(retried.status(), await retried.text()).toBe(200);
    expect(await db.auditLog.count({ where: { organization_id: orgId, entidad_id: id,
      accion: 'EXTRAER_DATOS_COMPARECIENTE_IA' } })).toBe(2);
    expect(await db.aiUsageEvent.count({ where: { organization_id: orgId } })).toBe(usageBefore);
    expect(await db.aiWalletTransaction.count({ where: { organization_id: orgId } })).toBe(walletBefore);
    const otherOrg = await db.organization.create({ data: { name: `COL67 TENANT B ${randomUUID()}` } });
    const otherPassword = `Qa!${randomUUID()}Aa1`;
    const otherUser = await db.user.create({ data: { email: `col67-tenant-${randomUUID()}@pravia.test`,
      password_hash: await bcrypt.hash(otherPassword, 10), nombre: 'TENANT', apellido: 'B',
      rol: 'DIRECCION', requires_password_change: false } });
    try {
      await db.organizationMembership.create({ data: { organization_id: otherOrg.id,
        user_id: otherUser.id, rol: 'DIRECCION' } });
      const otherLogin = await request.post('/api/auth/login', { data: {
        email: otherUser.email, password: otherPassword,
      } });
      expect(otherLogin.status()).toBe(200);
      const otherAuth = await otherLogin.json();
      const crossRead = await request.get(`/api/comparecientes/${id}`, {
        headers: authHeader(otherAuth.access_token),
      });
      expect(crossRead.status()).toBe(403);
      const crossDocument = await request.get(`/api/comparecientes/${id}/documentos/${documentId}/visualizar`, {
        headers: authHeader(otherAuth.access_token),
      });
      expect(crossDocument.status()).toBe(403);
    } finally {
      await db.authSession.deleteMany({ where: { user_id: otherUser.id } });
      await db.auditLog.deleteMany({ where: { user_id: otherUser.id } });
      await db.organizationMembership.deleteMany({ where: { user_id: otherUser.id } });
      await db.user.delete({ where: { id: otherUser.id } });
      await db.organization.delete({ where: { id: otherOrg.id } });
    }
    const sourceRows = await db.comparecienteDatoFuente.findMany({ where: { organization_id: orgId,
      compareciente_id: id, documento_id: documentId, campo: 'regimen_fiscal' } });
    expect(sourceRows.map((row) => row.valor_detectado).sort()).toEqual(['901', '902']);
    await a.reload();
    await expect(a.getByRole('region', { name: 'Regímenes fiscales detectados' })).toContainText('901');
    await login(j, javier);
    await j.goto(`/comparecientes/${id}`);
    await expect(j.getByRole('heading', { name })).toBeVisible();
    await expect(j.locator('article strong').filter({ hasText: filename })).toBeVisible();
    await expect(j.getByRole('region', { name: 'Regímenes fiscales detectados' })).toContainText('902');
    const view = await request.get(`/api/comparecientes/${id}/documentos/${documentId}/visualizar`, {
      headers: authHeader(jAuth.access_token),
    });
    expect(view.status(), await view.text()).toBe(200);
    expect(createHash('sha256').update(Buffer.from(await view.body())).digest('hex')).toBe(sha);
    const edit = await request.patch(`/api/comparecientes/${id}`, { headers: authHeader(jAuth.access_token),
      data: { observaciones: 'COL67 CONFIRMACION COMPARTIDA QA' } });
    expect(edit.status(), await edit.text()).toBe(200);
    const audit = await db.auditLog.findFirst({ where: { organization_id: orgId, entidad_id: id,
      accion: 'EDITAR_COMPARECIENTE', user_id: jAuth.user.id }, orderBy: { created_at: 'desc' } });
    expect(audit?.session_id).toBeTruthy();
    await a.reload();
    await expect(a.getByRole('region', { name: 'Regímenes fiscales detectados' })).toContainText('901');
    const extractionAudits = await db.auditLog.count({ where: { organization_id: orgId,
      entidad_id: id, accion: 'EXTRAER_DATOS_COMPARECIENTE_IA' } });
    expect(extractionAudits).toBe(2);
    expect(await db.documento.count({ where: { organization_id: orgId, compareciente_id: id } })).toBe(2);
    expect(await db.aiUsageEvent.count({ where: { organization_id: orgId } })).toBe(usageBefore);
    expect(await db.aiWalletTransaction.count({ where: { organization_id: orgId } })).toBe(walletBefore);
  } finally {
    await aContext.close();
    await jContext.close();
    await db.$disconnect();
  }
});
