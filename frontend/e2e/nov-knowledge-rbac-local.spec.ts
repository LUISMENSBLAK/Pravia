import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { PrismaClient } from '../../backend/node_modules/@prisma/client/default.js';
import bcrypt from '../../backend/node_modules/bcryptjs/index.js';

test('NOV-SEG-01 · criterios privados por Organization y mutación sólo con permiso', async ({ browser, request }, testInfo) => {
  const base = new URL(String(testInfo.project.use.baseURL || ''));
  const dbUrl = process.env.PRAVIA_E2E_LOCAL_DATABASE_URL || '';
  const directorPassword = process.env.PRAVIA_E2E_PASSWORD || '';
  const lawyerPassword = process.env.PRAVIA_E2E_JAVIER_PASSWORD || '';
  const financialPassword = process.env.PRAVIA_E2E_ROSA_PASSWORD || '';
  if (base.origin !== 'http://127.0.0.1:5176' || !directorPassword || !lawyerPassword || !financialPassword
    || dbUrl !== 'postgresql://postgres@127.0.0.1:55439/postgres?schema=pravia_os') throw new Error('NOV_RBAC_LOCAL_ONLY');
  expect(await (await request.get('/api/health')).json()).toMatchObject({ database_mode: 'local', storage_mode: 'local' });
  const db = new PrismaClient({ datasources: { db: { url: dbUrl } } });
  const page = await browser.newPage({ baseURL: base.origin });
  let otherOrgId = '';
  let otherUserId = '';
  let createdCriterionId = '';
  try {
    const auth = async (email: string, password: string) => {
      const response = await request.post('/api/auth/login', { data: { email, password } });
      expect(response.status()).toBe(200);
      return response.json();
    };
    const director = await auth('adrian.hernandez@pravia.test', directorPassword);
    const lawyer = await auth('javier.tapia@pravia.test', lawyerPassword);
    const finance = await auth('rosa.becerra@pravia.test', financialPassword);
    expect(lawyer.user.organization.id).toBe(director.user.organization.id);
    expect(finance.user.organization.id).toBe(director.user.organization.id);
    const headers = (actor: { access_token: string }) => ({ Authorization: `Bearer ${actor.access_token}` });
    const code = `QA-RBAC-${randomUUID()}`.toUpperCase();
    const input = { code, title: 'Criterio privado sintético de control de acceso', content: 'Sólo una prueba local, no norma.',
      scope: { kind: 'CRITERIO_INTERNO', jurisdiction: 'NAYARIT', source: 'QA LOCAL', author: 'DIRECCION QA',
        review_status: 'PENDIENTE', approval_status: 'BORRADOR' } };
    const created = await request.post('/api/settings/knowledge/criteria', { headers: headers(director), data: input });
    expect(created.status()).toBe(201);
    const criterion = (await created.json()).data;
    createdCriterionId = criterion.id;
    const before = await db.knowledgeCriterion.findUniqueOrThrow({ where: { id: criterion.id } });
    for (const actor of [lawyer, finance]) {
      expect((await request.post('/api/settings/knowledge/criteria', { headers: headers(actor), data: input })).status()).toBe(403);
      expect((await request.patch(`/api/settings/knowledge/criteria/${criterion.id}`, {
        headers: headers(actor), data: { title: 'Intento rechazado' },
      })).status()).toBe(403);
    }
    const lawyerRead = await request.get('/api/settings/knowledge/criteria', { headers: headers(lawyer) });
    expect(lawyerRead.status()).toBe(200);
    expect((await lawyerRead.json()).data).toContainEqual(expect.objectContaining({ id: criterion.id }));
    expect((await request.get('/api/settings/knowledge/criteria', { headers: headers(finance) })).status()).toBe(403);
    expect(await db.knowledgeCriterion.findUniqueOrThrow({ where: { id: criterion.id } })).toEqual(before);

    await page.goto('/login');
    await page.getByLabel('Correo electrónico').fill('javier.tapia@pravia.test');
    await page.getByLabel('Contraseña', { exact: true }).fill(lawyerPassword);
    await page.getByRole('button', { name: 'Iniciar sesión', exact: true }).click();
    await expect(page).toHaveURL(/\/mi-dia$/);
    await page.goto('/configuracion/biblioteca-conocimiento');
    await page.getByRole('button', { name: 'CRITERIOS INTERNOS', exact: true }).click();
    await page.getByRole('button', { name: new RegExp(code) }).click();
    await expect(page.getByRole('article').getByText(criterion.title, { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Registrar criterio o arancel propio' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Editar y crear nueva versión' })).toHaveCount(0);
    await page.reload();
    await page.getByRole('button', { name: 'CRITERIOS INTERNOS', exact: true }).click();
    await expect(page.getByRole('button', { name: new RegExp(code) })).toBeVisible();

    const otherOrg = await db.organization.create({ data: { name: `QA NOV RBAC ${randomUUID()}` } });
    otherOrgId = otherOrg.id;
    const otherPassword = `Qa!${randomUUID()}Aa1`;
    const otherUser = await db.user.create({ data: { email: `qa-nov-${randomUUID()}@pravia.test`,
      password_hash: await bcrypt.hash(otherPassword, 10), nombre: 'QA', apellido: 'OTRA ORGANIZACION',
      rol: 'DIRECCION', requires_password_change: false } });
    otherUserId = otherUser.id;
    await db.organizationMembership.create({ data: { organization_id: otherOrg.id, user_id: otherUser.id, rol: 'DIRECCION' } });
    const other = await auth(otherUser.email, otherPassword);
    const otherRead = await request.get('/api/settings/knowledge/criteria', { headers: headers(other) });
    expect(otherRead.status()).toBe(200);
    expect((await otherRead.json()).data).not.toContainEqual(expect.objectContaining({ id: criterion.id }));
    const crossWrite = await request.patch(`/api/settings/knowledge/criteria/${criterion.id}`, {
      headers: headers(other), data: input,
    });
    expect(crossWrite.status()).toBe(404);
    expect(await db.knowledgeCriterion.findUniqueOrThrow({ where: { id: criterion.id } })).toEqual(before);
    expect(await db.auditLog.findFirst({ where: { organization_id: director.user.organization.id, entidad_id: criterion.id,
      accion: 'CREAR_CRITERIO_INTERNO_CONOCIMIENTO', user_id: director.user.id } })).toBeTruthy();
  } finally {
    try {
      if (createdCriterionId) await db.knowledgeCriterion.updateMany({ where: { id: createdCriterionId, code: { startsWith: 'QA-RBAC-' } }, data: { active: false } });
      if (otherUserId) {
        await db.authSession.deleteMany({ where: { user_id: otherUserId } });
        await db.auditLog.deleteMany({ where: { user_id: otherUserId } });
        await db.organizationMembership.deleteMany({ where: { user_id: otherUserId } });
        await db.user.delete({ where: { id: otherUserId } });
      }
      if (otherOrgId) await db.organization.delete({ where: { id: otherOrgId } });
    } finally { await page.close(); await db.$disconnect(); }
  }
});
