import { randomUUID } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';
import { PrismaClient } from '../../backend/node_modules/@prisma/client/default.js';

const alejandro = { email: 'alejandro.abarca@pravia.test', password: process.env.PRAVIA_E2E_ALEJANDRO_PASSWORD || '' };
const javier = { email: 'javier.tapia@pravia.test', password: process.env.PRAVIA_E2E_JAVIER_PASSWORD || '' };

async function login(page: Page, credentials: { email: string; password: string }) {
  await page.goto('/login');
  await page.getByRole('textbox', { name: 'Correo electrónico' }).fill(credentials.email);
  await page.getByRole('textbox', { name: 'Contraseña', exact: true }).fill(credentials.password);
  await page.getByRole('button', { name: 'Iniciar sesión', exact: true }).click();
  await page.waitForURL('**/mi-dia');
}

test('Compareciente QA local: creación, búsqueda y edición compartida sin duplicado', async ({ browser, request }, testInfo) => {
  const base = new URL(String(testInfo.project.use.baseURL));
  const dbUrl = process.env.PRAVIA_E2E_LOCAL_DATABASE_URL || '';
  if (base.hostname !== '127.0.0.1' || base.port !== '5176'
    || dbUrl !== 'postgresql://postgres@127.0.0.1:55439/postgres?schema=pravia_os'
    || !alejandro.password || !javier.password) throw new Error('COLLABORATION_COMPARECIENTE_LOCAL_SAFETY_GATE_FAILED');

  const db = new PrismaClient({ datasources: { db: { url: dbUrl } } });
  const ownerContext = await browser.newContext({ baseURL: base.toString() });
  const viewerContext = await browser.newContext({ baseURL: base.toString() });
  const owner = await ownerContext.newPage();
  const viewer = await viewerContext.newPage();
  const suffix = randomUUID().slice(0, 8).toUpperCase();
  const name = `COLABORACION QA ${suffix}`;
  let comparecienteId = '';
  try {
    const [ownerResponse, viewerResponse] = await Promise.all([
      request.post('/api/auth/login', { data: alejandro }),
      request.post('/api/auth/login', { data: javier }),
    ]);
    expect(ownerResponse.status()).toBe(200);
    expect(viewerResponse.status()).toBe(200);
    const ownerAuth = await ownerResponse.json();
    const viewerAuth = await viewerResponse.json();
    const org = ownerAuth.user.organization.id as string;
    expect(viewerAuth.user.organization.id).toBe(org);
    const authHeader = (token: string) => ({ Authorization: `Bearer ${token}` });

    await login(owner, alejandro);
    await login(viewer, javier);
    const create = await request.post('/api/comparecientes/persona-fisica', {
      headers: authHeader(ownerAuth.access_token), data: { nombre: name },
    });
    const created = await create.json();
    expect(create.status(), JSON.stringify(created)).toBe(201);
    comparecienteId = created.data.compareciente.id;
    expect((await db.compareciente.findUniqueOrThrow({ where: { id: comparecienteId } })).organization_id).toBe(org);

    await viewer.goto(`/comparecientes?search=${encodeURIComponent(name)}`);
    await expect(viewer.getByRole('link', { name: `Abrir ficha de ${name}` }).first()).toBeVisible();
    await viewer.getByRole('link', { name: `Abrir ficha de ${name}` }).first().click();
    await expect(viewer).toHaveURL(new RegExp(`/comparecientes/${comparecienteId}$`));
    await expect(viewer.getByRole('heading', { name })).toBeVisible();

    const note = `Edición de Javier en QA ${suffix}`;
    const update = await request.patch(`/api/comparecientes/${comparecienteId}`, {
      headers: authHeader(viewerAuth.access_token), data: { observaciones: note },
    });
    expect(update.status(), JSON.stringify(await update.json())).toBe(200);
    expect((await db.compareciente.findUniqueOrThrow({ where: { id: comparecienteId } })).observaciones)
      .toBe(note.toLocaleUpperCase('es-MX'));
    await owner.goto(`/comparecientes/${comparecienteId}`);
    await expect(owner.getByRole('heading', { name })).toBeVisible();
    await owner.reload();
    await expect(owner.getByRole('heading', { name })).toBeVisible();
    const ownerRead = await request.get(`/api/comparecientes/${comparecienteId}`, {
      headers: authHeader(ownerAuth.access_token),
    });
    expect(ownerRead.status()).toBe(200);
    expect(JSON.stringify(await ownerRead.json())).toContain(note.toLocaleUpperCase('es-MX'));
    const editAudits = await db.auditLog.findMany({ where: {
      organization_id: org, entidad_id: comparecienteId, accion: 'EDITAR_COMPARECIENTE', user_id: viewerAuth.user.id,
    } });
    expect(editAudits).toHaveLength(1);
    expect(editAudits[0]).toMatchObject({ organization_id: org, user_id: viewerAuth.user.id, entidad: 'Compareciente', entidad_id: comparecienteId });
    expect(editAudits[0].session_id).toBeTruthy();
    expect(editAudits[0].correlation_id).toBeTruthy();
    expect(await db.compareciente.count({ where: { organization_id: org, nombre_busqueda: name, archived_at: null } })).toBe(1);
  } finally {
    if (comparecienteId) {
      await db.personaFisica.deleteMany({ where: { compareciente_id: comparecienteId } });
      await db.auditLog.deleteMany({ where: { entidad_id: comparecienteId } });
      const events = await db.domainEventOutbox.findMany({ where: { aggregate_type: 'Compareciente', aggregate_id: comparecienteId }, select: { id: true } });
      await db.domainEventProcessingLog.deleteMany({ where: { event_id: { in: events.map((event) => event.id) } } });
      await db.domainEventOutbox.deleteMany({ where: { aggregate_type: 'Compareciente', aggregate_id: comparecienteId } });
      await db.compareciente.delete({ where: { id: comparecienteId } });
    }
    await ownerContext.close();
    await viewerContext.close();
    await db.$disconnect();
  }
});
