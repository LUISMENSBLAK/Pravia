import { createHash, randomUUID } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';
import { PrismaClient } from '../../backend/node_modules/@prisma/client/default.js';
import bcrypt from '../../backend/node_modules/bcryptjs/index.js';
import { PDFDocument } from '../../backend/node_modules/pdf-lib/cjs/index.js';
import { TrackedStorageService } from '../../backend/src/platform/trackedStorage.service';
import { LocalStorageProvider } from '../../backend/src/storage/localStorage.provider';

const users = {
  alejandro: { email: 'alejandro.abarca@pravia.test', password: process.env.PRAVIA_E2E_ALEJANDRO_PASSWORD || '' },
  javier: { email: 'javier.tapia@pravia.test', password: process.env.PRAVIA_E2E_JAVIER_PASSWORD || '' },
  adrian: { email: 'adrian.hernandez@pravia.test', password: process.env.PRAVIA_E2E_PASSWORD || '' },
  rosa: { email: 'rosa.becerra@pravia.test', password: process.env.PRAVIA_E2E_ROSA_PASSWORD || '' },
};
const maria = { email: 'maria.careaga@pravia.test', password: process.env.PRAVIA_E2E_MARIA_PASSWORD || '' };

async function login(page: Page, credentials: { email: string; password: string }) {
  await page.goto('/login');
  await expect(page.getByRole('heading', { name: 'Bienvenido a PRAVIA OS' })).toBeVisible();
  await page.getByRole('textbox', { name: 'Correo electrónico' }).fill(credentials.email);
  await page.getByRole('textbox', { name: 'Contraseña', exact: true }).fill(credentials.password);
  if (await page.getByRole('textbox', { name: 'Contraseña', exact: true }).inputValue() !== credentials.password) {
    await page.getByRole('textbox', { name: 'Contraseña', exact: true }).fill(credentials.password);
  }
  await page.getByRole('textbox', { name: 'Correo electrónico' }).fill(credentials.email);
  await expect(page.getByRole('button', { name: 'Iniciar sesión', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Iniciar sesión', exact: true }).click();
  await page.waitForURL('**/mi-dia');
}

test('Expediente QA local: lectura organizacional y escritura revocable entre sesiones Chrome', async ({ browser, request }, testInfo) => {
  const base = new URL(String(testInfo.project.use.baseURL));
  const dbUrl = process.env.PRAVIA_E2E_LOCAL_DATABASE_URL || '';
  if (base.hostname !== '127.0.0.1' || base.port !== '5176'
    || !/^postgresql:\/\/postgres@127\.0\.0\.1:55439\/postgres\?schema=pravia_os$/.test(dbUrl)
    || Object.values(users).some((item) => !item.password) || !maria.password) {
    throw new Error('COLLABORATION_CASE_LOCAL_SAFETY_GATE_FAILED');
  }
  const db = new PrismaClient({ datasources: { db: { url: dbUrl } } });
  const contexts = await Promise.all(Array.from({ length: 4 }, () => browser.newContext({ baseURL: base.toString() })));
  const [owner, viewer, manager, finance] = await Promise.all(contexts.map((context) => context.newPage()));
  const id = randomUUID();
  const folio = `EXP-QA-COL-${Date.now()}`;
  let created = false;
  let foreignOrgId = '';
  let foreignUserId = '';
  let uploadedDocumentId = '';
  let uploadedStorageKey = '';
  let comparecienteId = '';
  let originalObservaciones: string | null = null;
  let comparecienteTouched = false;
  try {
    const auth = await Promise.all(Object.values(users).map((credentials) => request.post('/api/auth/login', { data: credentials })));
    auth.forEach((response) => expect(response.status()).toBe(200));
    const [alejandroAuth, javierAuth, adrianAuth, rosaAuth] = await Promise.all(auth.map((response) => response.json()));
    const org = alejandroAuth.user.organization.id as string;
    expect(org).toBe(javierAuth.user.organization.id);
    expect(org).toBe(adrianAuth.user.organization.id);
    expect(org).toBe(rosaAuth.user.organization.id);
    const headers = (payload: any) => ({ Authorization: `Bearer ${payload.access_token}` });

    // Fixture de autorización: no afirma que se haya ejecutado la conversión comercial.
    await db.expediente.create({ data: {
      id, organization_id: org, numero_pravia: folio, cliente_alias: 'Expediente sintético de colaboración QA',
      abogado_id: alejandroAuth.user.id, creador_id: alejandroAuth.user.id,
    } });
    created = true;
    expect((await db.expediente.findUniqueOrThrow({ where: { id } })).abogado_id).toBe(alejandroAuth.user.id);

    const foreignOrg = await db.organization.create({ data: { name: `QA tenant aislado ${id}` } });
    foreignOrgId = foreignOrg.id;
    const foreignPassword = `Pravia-QA-${randomUUID()}!`;
    const foreignUser = await db.user.create({ data: { email: `col-${id}@pravia.test`, nombre: 'QA', apellido: 'Otro tenant', rol: 'ABOGADO',
      password_hash: await bcrypt.hash(foreignPassword, 12), requires_password_change: false } });
    foreignUserId = foreignUser.id;
    await db.organizationMembership.create({ data: { organization_id: foreignOrg.id, user_id: foreignUser.id, rol: 'ABOGADO' } });
    const foreignLogin = await request.post('/api/auth/login', { data: { email: foreignUser.email, password: foreignPassword } });
    expect(foreignLogin.status()).toBe(200);
    const foreignAuth = await foreignLogin.json();
    const foreignHeaders = { Authorization: `Bearer ${foreignAuth.access_token}` };
    const blockedCase = await request.get(`/api/expedientes/${id}`, { headers: foreignHeaders });
    expect([403, 404]).toContain(blockedCase.status());
    expect((await request.patch(`/api/expedientes/${id}`, { headers: foreignHeaders, data: { organization_id: org, cliente_alias: 'Intrusión QA' } })).status()).toBe(403);
    const sharedProspect = await db.prospecto.findFirst({ where: { organization_id: org, nombre: { startsWith: 'COT-COLLAB-QA-' } }, orderBy: { created_at: 'desc' } });
    expect(sharedProspect).toBeTruthy();
    const sharedQuote = await db.cotizacion.findFirst({ where: { organization_id: org, prospecto_id: sharedProspect!.id } });
    expect(sharedQuote).toBeTruthy();
    for (const path of [`/api/prospectos/${sharedProspect!.id}`, `/api/cotizaciones/${sharedQuote!.id}`]) {
      expect([403, 404]).toContain((await request.get(path, { headers: foreignHeaders })).status());
    }
    expect((await request.post(`/api/collaboration/expediente/${id}/asistentes`, { headers: headers(javierAuth), data: { user_id: javierAuth.user.id } })).status()).toBe(403);
    const foreignAssignment = await request.post(`/api/collaboration/expediente/${id}/asistentes`, { headers: headers(adrianAuth), data: { user_id: foreignUser.id } });
    expect(foreignAssignment.status()).toBe(400);
    expect((await foreignAssignment.json()).code).toBe('COLLAB_MEMBER_INELIGIBLE');
    expect(await db.recordCollaboration.count({ where: { expediente_id: id, user_id: foreignUser.id } })).toBe(0);

    await login(owner, users.alejandro);
    await login(viewer, users.javier);
    await login(manager, users.adrian);
    await login(finance, users.rosa);
    await viewer.goto(`/expedientes?search=${encodeURIComponent(folio)}`);
    await expect(viewer.getByText(folio).first()).toBeVisible();
    await viewer.goto(`/expedientes/${id}`);
    await expect(viewer.getByRole('textbox', { name: 'Número de expediente' })).toHaveValue(folio);
    for (const section of ['actos', 'comparecientes', 'predios', 'seguimiento', 'documentos/apendice', 'plantillas-formatos', 'finanzas-operativas', 'archivo']) {
      const response = await request.get(`/api/expedientes/${id}/${section}`, { headers: headers(javierAuth) });
      expect(response.status(), `Lectura compartida de ${section}`).toBe(200);
    }
    await expect(viewer.getByRole('tabpanel', { name: 'Actos' })).not.toContainText('No tienes permiso');
    await viewer.getByRole('tab', { name: 'Actividad' }).click();
    await expect(viewer.getByRole('tabpanel', { name: 'Actividad' })).toBeVisible();
    expect((await request.get(`/api/expedientes/${id}/actividad`, { headers: headers(javierAuth) })).status()).toBe(200);
    expect((await request.post(`/api/expedientes/${id}/presupuesto/vista-previa`, { headers: headers(javierAuth),
      data: { concepts: [{ concepto: 'Honorarios QA', categoria: 'HONORARIOS', importe: '100.00' }] } })).status()).toBe(200);

    const denied = await request.patch(`/api/expedientes/${id}`, { headers: headers(javierAuth), data: { cliente_alias: 'No autorizado' } });
    expect(denied.status()).toBe(403);
    expect((await db.expediente.findUniqueOrThrow({ where: { id } })).cliente_alias).toBe('Expediente sintético de colaboración QA');
    expect((await request.patch(`/api/expedientes/${id}`, { headers: headers(alejandroAuth), data: { cliente_alias: 'Actualizado por Alejandro QA' } })).status()).toBe(200);
    const headerAudit = await db.auditLog.findFirst({ where: { organization_id: org, entidad_id: id, accion: 'UPDATE_EXPEDIENTE_HEADER', user_id: alejandroAuth.user.id }, orderBy: { created_at: 'desc' } });
    expect(headerAudit).toMatchObject({ organization_id: org, user_id: alejandroAuth.user.id, entidad: 'Expediente', entidad_id: id });
    expect(headerAudit?.session_id).toBeTruthy();
    expect(headerAudit?.correlation_id).toBeTruthy();
    await viewer.reload();
    await expect(viewer.getByRole('textbox', { name: 'Cliente' })).toHaveValue('Actualizado por Alejandro QA');

    await manager.goto(`/expedientes/${id}`);
    const selector = manager.getByLabel('Asignar colaborador');
    await expect(selector).toBeVisible();
    await selector.selectOption(javierAuth.user.id);
    await manager.getByRole('button', { name: 'Asignar', exact: true }).click();
    await expect(manager.getByRole('region', { name: 'Colaboradores autorizados' }).getByText('Javier Tapia', { exact: true })).toBeVisible();
    expect((await request.patch(`/api/expedientes/${id}`, { headers: headers(javierAuth), data: { cliente_alias: 'Actualizado por Javier QA' } })).status()).toBe(200);
    expect((await db.expediente.findUniqueOrThrow({ where: { id } })).cliente_alias).toBe('Actualizado por Javier QA');
    await manager.getByRole('button', { name: 'Retirar a Javier Tapia' }).click();
    await expect(manager.getByRole('region', { name: 'Colaboradores autorizados' }).getByText('Javier Tapia', { exact: true })).toHaveCount(0);
    expect((await request.patch(`/api/expedientes/${id}`, { headers: headers(javierAuth), data: { cliente_alias: 'Intento revocado QA' } })).status()).toBe(403);
    expect((await request.get(`/api/expedientes/${id}`, { headers: headers(javierAuth) })).status()).toBe(200);
    expect((await request.get(`/api/expedientes/${id}`, { headers: headers(rosaAuth) })).status()).toBe(200);
    expect((await request.patch(`/api/expedientes/${id}`, { headers: headers(rosaAuth), data: { cliente_alias: 'Intento financiero QA' } })).status()).toBe(403);
    expect(await db.auditLog.count({ where: { entidad_id: id, accion: { in: ['COLLABORATOR_ASSIGNED', 'COLLABORATOR_REVOKED'] } } })).toBe(2);

    const qaPdf = await PDFDocument.create();
    qaPdf.addPage([595, 842]).drawText(`PRAVIA OS - documento sintetico de colaboracion ${id}`, { x: 40, y: 790, size: 12 });
    const documentBytes = Buffer.from(await qaPdf.save());
    const upload = await request.post(`/api/expedientes/${id}/documentos`, { headers: headers(alejandroAuth), multipart: {
      file: { name: 'colaboracion-qa.pdf', mimeType: 'application/pdf', buffer: documentBytes }, categoria: 'OTROS', carpeta: 'QA',
    } });
    const uploadBody = await upload.json();
    expect(upload.status(), JSON.stringify(uploadBody)).toBe(201);
    const uploaded = uploadBody.documento;
    uploadedDocumentId = uploaded.id;
    uploadedStorageKey = uploaded.storage_key;
    expect(uploadedStorageKey).toContain(`organizations/${org}/documentos/expedientes/${id}/`);
    const physical = await db.documento.findUniqueOrThrow({ where: { id: uploadedDocumentId } });
    expect(physical.checksum_sha256).toBe(createHash('sha256').update(documentBytes).digest('hex'));
    const viewerFile = await request.get(`/api/expedientes/${id}/documentos/${uploadedDocumentId}/visualizar`, { headers: headers(javierAuth) });
    expect(viewerFile.status()).toBe(200);
    expect(createHash('sha256').update(await viewerFile.body()).digest('hex')).toBe(physical.checksum_sha256);
    expect((await request.get(`/api/expedientes/${id}/documentos/${uploadedDocumentId}/visualizar`, { headers: foreignHeaders })).status()).toBe(403);
    const appendix = await request.get(`/api/expedientes/${id}/documentos/apendice`, { headers: headers(javierAuth) });
    expect(appendix.status()).toBe(200);
    const appendixPayload = await appendix.json();
    expect(JSON.stringify(appendixPayload)).toContain(uploadedDocumentId);
    const signed = await request.get(`/api/expedientes/${id}/documentos/apendice/${uploaded.expediente_documento_id}/url`, { headers: headers(javierAuth) });
    expect(signed.status()).toBe(200);
    expect((await request.get(`/api/expedientes/${id}/documentos/apendice/${uploaded.expediente_documento_id}/url`, { headers: foreignHeaders })).status()).toBe(403);
    const signedFile = await request.get((await signed.json()).url);
    expect(signedFile.status()).toBe(200);
    expect(createHash('sha256').update(await signedFile.body()).digest('hex')).toBe(physical.checksum_sha256);
    expect((await request.delete(`/api/expedientes/${id}/documentos/${uploadedDocumentId}`, { headers: headers(javierAuth) })).status()).toBe(403);
    await viewer.getByRole('tab', { name: 'Documentos' }).click();
    await expect(viewer.getByRole('tabpanel', { name: 'Documentos' })).toContainText('colaboracion-qa.pdf');
    await viewer.getByRole('tabpanel', { name: 'Documentos' }).getByText('colaboracion-qa.pdf', { exact: true }).first().click();
    await viewer.getByRole('button', { name: 'Visualizar', exact: true }).click();
    const documentViewer = viewer.getByRole('dialog', { name: 'colaboracion-qa.pdf' });
    await expect(documentViewer).toBeVisible();
    await expect(documentViewer.locator('canvas[data-preview-loaded="true"]')).toBeVisible();

    const sharedParty = await db.compareciente.findFirst({ where: { organization_id: org, nombre_busqueda: 'COLABORACION QA SINTETICA LOCAL', archived_at: null } });
    expect(sharedParty).toBeTruthy();
    comparecienteId = sharedParty!.id;
    originalObservaciones = sharedParty!.observaciones;
    expect((await request.get(`/api/comparecientes/${comparecienteId}`, { headers: headers(javierAuth) })).status()).toBe(200);
    expect((await request.get(`/api/comparecientes/${comparecienteId}`, { headers: foreignHeaders })).status()).toBe(403);
    await viewer.goto(`/comparecientes/${comparecienteId}`);
    await expect(viewer.getByRole('heading', { name: 'COLABORACIÓN QA SINTÉTICA LOCAL' })).toBeVisible();
    const mariaLogin = await request.post('/api/auth/login', { data: maria });
    expect(mariaLogin.status()).toBe(200);
    const mariaAuth = await mariaLogin.json();
    const updatedObservaciones = `Edición compartida de María QA ${id}`;
    const updatedParty = await request.patch(`/api/comparecientes/${comparecienteId}`, { headers: headers(mariaAuth), data: { observaciones: updatedObservaciones } });
    expect(updatedParty.status(), JSON.stringify(await updatedParty.json())).toBe(200);
    comparecienteTouched = true;
    expect((await db.compareciente.findUniqueOrThrow({ where: { id: comparecienteId } })).observaciones).toBe(updatedObservaciones.toLocaleUpperCase('es-MX'));
    await viewer.reload();
    expect((await request.get(`/api/comparecientes/${comparecienteId}`, { headers: headers(javierAuth) })).status()).toBe(200);
  } finally {
    if (comparecienteTouched && comparecienteId) await db.compareciente.update({ where: { id: comparecienteId }, data: { observaciones: originalObservaciones } });
    if (created) {
      if (uploadedDocumentId) {
        await db.expedienteDocumento.deleteMany({ where: { documento_id: uploadedDocumentId } });
        await db.auditLog.deleteMany({ where: { entidad_id: uploadedDocumentId } });
        await db.documento.deleteMany({ where: { id: uploadedDocumentId } });
      }
      await db.recordCollaboration.deleteMany({ where: { expediente_id: id } });
      await db.expedienteActividad.deleteMany({ where: { expediente_id: id } });
      await db.auditLog.deleteMany({ where: { entidad_id: id } });
      await db.expediente.deleteMany({ where: { id } });
    }
    if (uploadedStorageKey) {
      const root = '/tmp/pravia-billing-qa-20261026-storage';
      if (uploadedStorageKey.startsWith('organizations/') && uploadedStorageKey.includes(`/documentos/expedientes/${id}/`)) {
        process.env.LOCAL_STORAGE_PATH = root;
        await new TrackedStorageService(new LocalStorageProvider(), db).delete(uploadedStorageKey);
      }
    }
    if (foreignUserId) {
      await db.authSession.deleteMany({ where: { user_id: foreignUserId } });
      await db.auditLog.deleteMany({ where: { user_id: foreignUserId } });
      await db.organizationMembership.deleteMany({ where: { user_id: foreignUserId } });
      await db.user.delete({ where: { id: foreignUserId } });
    }
    if (foreignOrgId) await db.organization.delete({ where: { id: foreignOrgId } });
    await Promise.all(contexts.map((context) => context.close()));
    await db.$disconnect();
  }
});
