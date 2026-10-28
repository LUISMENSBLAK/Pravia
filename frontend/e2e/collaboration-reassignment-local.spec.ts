import { randomUUID } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';
import { PrismaClient } from '../../backend/node_modules/@prisma/client/default.js';
import bcrypt from '../../backend/node_modules/bcryptjs/index.js';

const orgId = '7577aa7b-8149-4ba4-a07d-adca779a1d03';
const caseId = 'ac62cbf6-a7bc-43b9-8242-041a6629fc5c';
const documentId = '364ba764-9ce4-43dd-a7cd-9785bb3578f4';
const users = {
  alejandro: { email: 'alejandro.abarca@pravia.test', password: process.env.PRAVIA_E2E_ALEJANDRO_PASSWORD || '' },
  javier: { email: 'javier.tapia@pravia.test', password: process.env.PRAVIA_E2E_JAVIER_PASSWORD || '' },
  maria: { email: 'maria.careaga@pravia.test', password: process.env.PRAVIA_E2E_MARIA_PASSWORD || '' },
  adrian: { email: 'adrian.hernandez@pravia.test', password: process.env.PRAVIA_E2E_PASSWORD || '' },
};

async function login(page: Page, credentials: { email: string; password: string }) {
  await page.goto('/login');
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

test('COL04/COL24/COL28–30/COL34 · María lee; Dirección reasigna y la escritura sigue al responsable', async ({ browser, request }, testInfo) => {
  test.setTimeout(180_000);
  const base = new URL(String(testInfo.project.use.baseURL));
  const dbUrl = process.env.PRAVIA_E2E_LOCAL_DATABASE_URL || '';
  if (base.hostname !== '127.0.0.1' || base.port !== '5176'
    || dbUrl !== 'postgresql://postgres@127.0.0.1:55439/postgres?schema=pravia_os'
    || Object.values(users).some((user) => !user.password)) throw new Error('COLLAB_REASSIGNMENT_LOCAL_SAFETY_GATE_FAILED');
  const db = new PrismaClient({ datasources: { db: { url: dbUrl } } });
  const contexts = await Promise.all(Array.from({ length: 2 }, () => browser.newContext({ baseURL: base.toString() })));
  const [mariaPage, directorPage] = await Promise.all(contexts.map((context) => context.newPage()));
  const authResponses = await Promise.all(Object.values(users).map((credentials) => request.post('/api/auth/login', { data: credentials })));
  authResponses.forEach((response) => expect(response.status()).toBe(200));
  const [alejandro, javier, maria, adrian] = await Promise.all(authResponses.map((response) => response.json()));
  const headers = (auth: any) => ({ Authorization: `Bearer ${auth.access_token}` });
  for (const auth of [alejandro, javier, maria, adrian]) expect(auth.user.organization.id).toBe(orgId);
  const before = await db.expediente.findUniqueOrThrow({ where: { id: caseId } });
  expect(before.abogado_id).toBe(alejandro.user.id);
  const originalAlias = before.cliente_alias;
  try {
    await login(mariaPage, users.maria);
    await mariaPage.goto(`/expedientes/${caseId}`);
    await expect(mariaPage.getByRole('textbox', { name: 'Número de expediente' })).toHaveValue('EXP-0007-2026');
    await mariaPage.reload();
    await expect(mariaPage.getByRole('textbox', { name: 'Número de expediente' })).toHaveValue('EXP-0007-2026');
    await mariaPage.getByRole('tab', { name: 'Documentos' }).click();
    await expect(mariaPage.getByRole('tabpanel', { name: 'Documentos' })).toContainText('colaboracion-comercial-qa.pdf');
    await mariaPage.getByRole('tabpanel', { name: 'Documentos' }).getByText('colaboracion-comercial-qa.pdf', { exact: true }).first().click();
    await mariaPage.getByRole('button', { name: 'Visualizar', exact: true }).click();
    await expect(mariaPage.getByRole('dialog', { name: 'colaboracion-comercial-qa.pdf' }).locator('canvas[data-preview-loaded="true"]')).toBeVisible();
    expect((await request.get(`/api/documentos/${documentId}/url`, { headers: headers(maria) })).status()).toBe(200);
    expect((await request.patch(`/api/expedientes/${caseId}`, { headers: headers(maria), data: { cliente_alias: 'Intento María QA' } })).status()).toBe(403);

    await login(directorPage, users.adrian);
    await directorPage.goto(`/expedientes/${caseId}`);
    await expect(directorPage.getByRole('textbox', { name: 'Número de expediente' })).toHaveValue('EXP-0007-2026');
    const directorAlias = `COL-DIRECCION-QA-${randomUUID().slice(0, 8)}`;
    const directorEdit = await request.patch(`/api/expedientes/${caseId}`, { headers: headers(adrian), data: { cliente_alias: directorAlias } });
    expect(directorEdit.status(), await directorEdit.text()).toBe(200);
    expect((await db.expediente.findUniqueOrThrow({ where: { id: caseId } })).cliente_alias).toBe(directorAlias);
    await directorPage.reload();
    await expect(directorPage.getByRole('textbox', { name: 'Cliente' })).toHaveValue(directorAlias);

    const assignSelf = await request.patch(`/api/expedientes/${caseId}`, { headers: headers(javier), data: { abogado_id: javier.user.id } });
    expect(assignSelf.status()).toBe(403);
    const reassigned = await request.patch(`/api/expedientes/${caseId}`, { headers: headers(adrian), data: { abogado_id: javier.user.id } });
    expect(reassigned.status(), await reassigned.text()).toBe(200);
    expect((await db.expediente.findUniqueOrThrow({ where: { id: caseId } })).abogado_id).toBe(javier.user.id);
    expect((await request.patch(`/api/expedientes/${caseId}`, { headers: headers(alejandro), data: { cliente_alias: 'Intento exresponsable QA' } })).status()).toBe(403);
    const newOwnerAlias = `COL-JAVIER-QA-${randomUUID().slice(0, 8)}`;
    const newOwnerEdit = await request.patch(`/api/expedientes/${caseId}`, { headers: headers(javier), data: { cliente_alias: newOwnerAlias } });
    expect(newOwnerEdit.status(), await newOwnerEdit.text()).toBe(200);
    expect((await db.expediente.findUniqueOrThrow({ where: { id: caseId } })).cliente_alias).toBe(newOwnerAlias);
    const ownerSpoof = await request.patch(`/api/expedientes/${caseId}`, { headers: headers(javier), data: { abogado_id: alejandro.user.id } });
    expect(ownerSpoof.status()).toBe(403);
    expect((await db.expediente.findUniqueOrThrow({ where: { id: caseId } })).abogado_id).toBe(javier.user.id);
    expect((await request.get(`/api/expedientes/${caseId}`, { headers: headers(alejandro) })).status()).toBe(200);

    const audit = await db.auditLog.findMany({ where: { entidad: 'Expediente', entidad_id: caseId, accion: 'UPDATE_EXPEDIENTE_HEADER' }, orderBy: { created_at: 'desc' }, take: 4 });
    expect(audit.some((row) => row.user_id === adrian.user.id)).toBe(true);
    expect(audit.some((row) => row.user_id === javier.user.id)).toBe(true);
  } finally {
    const restored = await request.patch(`/api/expedientes/${caseId}`, { headers: headers(adrian), data: { abogado_id: alejandro.user.id, cliente_alias: originalAlias } });
    expect(restored.status(), await restored.text()).toBe(200);
    const after = await db.expediente.findUniqueOrThrow({ where: { id: caseId } });
    expect(after.abogado_id).toBe(before.abogado_id);
    expect(after.cliente_alias).toBe(originalAlias);
    await Promise.all(contexts.map((context) => context.close()));
    await db.$disconnect();
  }
});

test('COL52 · perfil CONSULTA auténticamente sólo lectura', async ({ browser, request }, testInfo) => {
  const base = new URL(String(testInfo.project.use.baseURL));
  const dbUrl = process.env.PRAVIA_E2E_LOCAL_DATABASE_URL || '';
  if (base.hostname !== '127.0.0.1' || base.port !== '5176'
    || dbUrl !== 'postgresql://postgres@127.0.0.1:55439/postgres?schema=pravia_os') {
    throw new Error('COLLAB_READONLY_LOCAL_SAFETY_GATE_FAILED');
  }
  const db = new PrismaClient({ datasources: { db: { url: dbUrl } } });
  const password = `Pravia-QA-${randomUUID()}!`;
  const account = await db.user.create({ data: {
    email: `consulta-col-${randomUUID()}@pravia.test`, nombre: 'Consulta', apellido: 'QA sintética', rol: 'CONSULTA',
    password_hash: await bcrypt.hash(password, 12), requires_password_change: false,
  } });
  const context = await browser.newContext({ baseURL: base.toString() });
  try {
    await db.organizationMembership.create({ data: { organization_id: orgId, user_id: account.id, rol: 'CONSULTA' } });
    const response = await request.post('/api/auth/login', { data: { email: account.email, password } });
    expect(response.status(), await response.text()).toBe(200);
    const auth = await response.json();
    expect(auth.user.rol).toBe('CONSULTA');
    const headers = { Authorization: `Bearer ${auth.access_token}` };
    const page = await context.newPage();
    await login(page, { email: account.email, password });
    await page.goto(`/expedientes/${caseId}`);
    await expect(page.getByRole('textbox', { name: 'Número de expediente' })).toHaveValue('EXP-0007-2026');
    expect((await request.get(`/api/expedientes/${caseId}`, { headers })).status()).toBe(200);
    expect((await request.get(`/api/documentos/${documentId}/url`, { headers })).status()).toBe(200);
    expect((await request.patch(`/api/expedientes/${caseId}`, { headers, data: { cliente_alias: 'Intrusión CONSULTA QA' } })).status()).toBe(403);
    expect((await request.post(`/api/collaboration/expediente/${caseId}/asistentes`, { headers, data: { user_id: account.id } })).status()).toBe(403);
    expect((await request.post('/api/prospectos', { headers: { ...headers, 'Idempotency-Key': randomUUID() }, data: { nombre: 'Intrusión CONSULTA QA' } })).status()).toBe(403);
    await page.reload();
    await expect(page.getByRole('textbox', { name: 'Número de expediente' })).toHaveValue('EXP-0007-2026');
    expect(await db.recordCollaboration.count({ where: { expediente_id: caseId, user_id: account.id } })).toBe(0);
  } finally {
    await context.close();
    await db.authSession.deleteMany({ where: { user_id: account.id } });
    await db.auditLog.deleteMany({ where: { user_id: account.id } });
    await db.organizationMembership.deleteMany({ where: { user_id: account.id } });
    await db.user.delete({ where: { id: account.id } });
    await db.$disconnect();
  }
});

test('COL51/COL54 · predio y expediente no cruzan tenant aunque el cliente falsifique organization/tenant', async ({ request }, testInfo) => {
  const base = new URL(String(testInfo.project.use.baseURL));
  const dbUrl = process.env.PRAVIA_E2E_LOCAL_DATABASE_URL || '';
  if (base.hostname !== '127.0.0.1' || base.port !== '5176'
    || dbUrl !== 'postgresql://postgres@127.0.0.1:55439/postgres?schema=pravia_os'
    || !users.javier.password) throw new Error('COLLAB_TENANT_LOCAL_SAFETY_GATE_FAILED');
  const db = new PrismaClient({ datasources: { db: { url: dbUrl } } });
  const foreignOrg = await db.organization.create({ data: { name: `QA tenant aislado ${randomUUID()}` } });
  const password = `Pravia-QA-${randomUUID()}!`;
  const foreignUser = await db.user.create({ data: {
    email: `tenant-col-${randomUUID()}@pravia.test`, nombre: 'Tenant', apellido: 'QA sintético', rol: 'ABOGADO',
    password_hash: await bcrypt.hash(password, 12), requires_password_change: false,
  } });
  let propertyId = '';
  try {
    await db.organizationMembership.create({ data: { organization_id: foreignOrg.id, user_id: foreignUser.id, rol: 'ABOGADO' } });
    const [ownerLogin, foreignLogin] = await Promise.all([
      request.post('/api/auth/login', { data: users.javier }),
      request.post('/api/auth/login', { data: { email: foreignUser.email, password } }),
    ]);
    expect(ownerLogin.status()).toBe(200);
    expect(foreignLogin.status()).toBe(200);
    const [owner, intruder] = await Promise.all([ownerLogin.json(), foreignLogin.json()]);
    expect(owner.user.organization.id).toBe(orgId);
    expect(intruder.user.organization.id).toBe(foreignOrg.id);
    const ownerHeaders = { Authorization: `Bearer ${owner.access_token}` };
    const foreignHeaders = { Authorization: `Bearer ${intruder.access_token}` };
    const marker = `PREDIO-TENANT-QA-${randomUUID().slice(0, 8).toUpperCase()}`;
    const created = await request.post('/api/predios', { headers: ownerHeaders, data: {
      apodo: marker, ubicacion_texto: 'Ubicación sintética QA',
      tenantId: foreignOrg.id, organizationId: foreignOrg.id, organization_id: foreignOrg.id,
    } });
    expect(created.status(), await created.text()).toBe(201);
    propertyId = (await created.json()).data.id;
    expect((await db.predio.findUniqueOrThrow({ where: { id: propertyId } })).organization_id).toBe(orgId);
    expect((await request.get(`/api/predios/${propertyId}`, { headers: ownerHeaders })).status()).toBe(200);
    for (const query of [
      `tenantId=${orgId}`, `organizationId=${orgId}`, `organization_id=${orgId}`,
    ]) {
      const foreignProperty = await request.get(`/api/predios/${propertyId}?${query}`, { headers: foreignHeaders });
      expect([403, 404]).toContain(foreignProperty.status());
      const foreignCase = await request.get(`/api/expedientes/${caseId}?${query}`, { headers: foreignHeaders });
      expect([403, 404]).toContain(foreignCase.status());
    }
    const listing = await request.get(`/api/predios?search=${encodeURIComponent(marker)}&organizationId=${orgId}`, { headers: foreignHeaders });
    expect(listing.status()).toBe(200);
    expect(JSON.stringify(await listing.json())).not.toContain(propertyId);
    const attack = await request.patch(`/api/predios/${propertyId}`, { headers: foreignHeaders, data: {
      apodo: 'Intrusión QA', tenantId: orgId, organizationId: orgId, organization_id: orgId,
    } });
    expect([403, 404]).toContain(attack.status());
    expect((await db.predio.findUniqueOrThrow({ where: { id: propertyId } })).apodo).toBe(marker);
    expect((await request.patch(`/api/expedientes/${caseId}`, { headers: foreignHeaders, data: {
      cliente_alias: 'Intrusión QA', tenantId: orgId, organizationId: orgId, organization_id: orgId,
    } })).status()).toBe(403);
  } finally {
    if (propertyId) {
      await db.auditLog.deleteMany({ where: { entidad_id: propertyId } });
      await db.predio.delete({ where: { id: propertyId } });
    }
    await db.authSession.deleteMany({ where: { user_id: foreignUser.id } });
    await db.auditLog.deleteMany({ where: { user_id: foreignUser.id } });
    await db.organizationMembership.deleteMany({ where: { user_id: foreignUser.id } });
    await db.user.delete({ where: { id: foreignUser.id } });
    await db.organization.delete({ where: { id: foreignOrg.id } });
    await db.$disconnect();
  }
});

test('COL53 · campos de asignación falsificados no conceden titularidad', async ({ request }, testInfo) => {
  const base = new URL(String(testInfo.project.use.baseURL));
  const dbUrl = process.env.PRAVIA_E2E_LOCAL_DATABASE_URL || '';
  if (base.hostname !== '127.0.0.1' || base.port !== '5176'
    || dbUrl !== 'postgresql://postgres@127.0.0.1:55439/postgres?schema=pravia_os'
    || !users.alejandro.password || !users.javier.password) throw new Error('COLLAB_ASSIGNEE_LOCAL_SAFETY_GATE_FAILED');
  const db = new PrismaClient({ datasources: { db: { url: dbUrl } } });
  try {
    const [ownerLogin, colleagueLogin] = await Promise.all([
      request.post('/api/auth/login', { data: users.alejandro }), request.post('/api/auth/login', { data: users.javier }),
    ]);
    expect(ownerLogin.status()).toBe(200);
    expect(colleagueLogin.status()).toBe(200);
    const [owner, colleague] = await Promise.all([ownerLogin.json(), colleagueLogin.json()]);
    const headers = { Authorization: `Bearer ${owner.access_token}` };
    const marker = `COL-ASSIGNEE-QA-${randomUUID()}`;
    for (const injected of [
      { assignedUserId: colleague.user.id }, { user_id: colleague.user.id }, { responsable_id: colleague.user.id },
    ]) {
      const response = await request.post('/api/prospectos', { headers: { ...headers, 'Idempotency-Key': randomUUID() },
        data: { nombre: marker, ...injected } });
      expect(response.status(), await response.text()).toBe(400);
    }
    expect(await db.prospecto.count({ where: { organization_id: orgId, nombre: marker } })).toBe(0);
    const prospectId = '57ec986e-8751-424d-8871-14574464c638';
    const before = await db.prospecto.findUniqueOrThrow({ where: { id: prospectId } });
    expect(before.user_id).toBe(owner.user.id);
    for (const injected of [
      { assignedUserId: colleague.user.id }, { user_id: colleague.user.id },
    ]) {
      const response = await request.put(`/api/prospectos/${prospectId}`, { headers, data: injected });
      expect(response.status(), await response.text()).toBe(400);
    }
    const reassignment = await request.put(`/api/prospectos/${prospectId}`, { headers,
      data: { responsable_id: colleague.user.id, expectedVersion: before.version_operativa } });
    expect(reassignment.status(), await reassignment.text()).toBe(403);
    const after = await db.prospecto.findUniqueOrThrow({ where: { id: prospectId } });
    expect(after.user_id).toBe(before.user_id);
    expect(after.version_operativa).toBe(before.version_operativa);
    expect(await db.recordCollaboration.count({ where: { prospecto_id: prospectId, user_id: colleague.user.id } })).toBe(0);
  } finally {
    await db.$disconnect();
  }
});
