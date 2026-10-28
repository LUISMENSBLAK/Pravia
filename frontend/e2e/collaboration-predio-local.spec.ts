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

test('Predio QA local: ficha maestra creada por compañero, vinculada y editada sin duplicado', async ({ browser, request }, testInfo) => {
  const base = new URL(String(testInfo.project.use.baseURL));
  const dbUrl = process.env.PRAVIA_E2E_LOCAL_DATABASE_URL || '';
  if (base.hostname !== '127.0.0.1' || base.port !== '5176'
    || dbUrl !== 'postgresql://postgres@127.0.0.1:55439/postgres?schema=pravia_os'
    || !alejandro.password || !javier.password) throw new Error('COLLABORATION_PREDIO_LOCAL_SAFETY_GATE_FAILED');

  const db = new PrismaClient({ datasources: { db: { url: dbUrl } } });
  const ownerContext = await browser.newContext({ baseURL: base.toString() });
  const viewerContext = await browser.newContext({ baseURL: base.toString() });
  const owner = await ownerContext.newPage();
  const viewer = await viewerContext.newPage();
  const suffix = randomUUID().slice(0, 8).toUpperCase();
  const apodo = `PREDIO QA ${suffix}`;
  const caseId = randomUUID();
  let predioId = '';
  let actId = '';
  let relationId = '';
  let caseCreated = false;
  try {
    const [alejandroResponse, javierResponse] = await Promise.all([
      request.post('/api/auth/login', { data: alejandro }), request.post('/api/auth/login', { data: javier }),
    ]);
    expect(alejandroResponse.status()).toBe(200);
    expect(javierResponse.status()).toBe(200);
    const alejandroAuth = await alejandroResponse.json();
    const javierAuth = await javierResponse.json();
    const org = alejandroAuth.user.organization.id as string;
    expect(javierAuth.user.organization.id).toBe(org);
    const headers = (token: string) => ({ Authorization: `Bearer ${token}` });
    await login(owner, javier);
    await login(viewer, alejandro);

    const create = await request.post('/api/predios', { headers: headers(javierAuth.access_token),
      data: { apodo, ubicacion_texto: `Ubicación sintética ${suffix}` } });
    const created = await create.json();
    expect(create.status(), JSON.stringify(created)).toBe(201);
    predioId = created.data.id;
    expect((await db.predio.findUniqueOrThrow({ where: { id: predioId } })).organization_id).toBe(org);
    await viewer.goto(`/predios?search=${encodeURIComponent(apodo)}`);
    await expect(viewer.getByRole('link').filter({ hasText: apodo })).toBeVisible();
    await viewer.getByRole('link').filter({ hasText: apodo }).click();
    await expect(viewer).toHaveURL(new RegExp(`/predios/${predioId}$`));
    await expect(viewer.getByRole('heading', { name: apodo })).toBeVisible();

    const tipo = await db.tipoActo.findFirst({ where: { organization_id: org, nombre: 'ACTO SINTÉTICO COLABORACIÓN QA 20261027' }, select: { id: true } });
    expect(tipo).toBeTruthy();
    await db.expediente.create({ data: { id: caseId, organization_id: org, numero_pravia: `EXP-QA-PRED-${suffix}`, cliente_alias: 'Expediente sintético de predio QA', abogado_id: alejandroAuth.user.id, creador_id: alejandroAuth.user.id } });
    caseCreated = true;
    const act = await db.expedienteActo.create({ data: { organization_id: org, expediente_id: caseId, tipo_acto_id: tipo!.id, origen: 'ADICIONAL', created_by: alejandroAuth.user.id } });
    actId = act.id;
    const preview = await request.post(`/api/expedientes/${caseId}/predios/preview`, { headers: headers(alejandroAuth.access_token),
      data: { operation: 'LINK', predio_id: predioId, expediente_acto_ids: [actId] } });
    const previewBody = await preview.json();
    expect(preview.status(), JSON.stringify(previewBody)).toBe(200);
    expect(previewBody.classification).toBe('SAFE');
    const apply = await request.post(`/api/expedientes/${caseId}/predios/aplicar`, { headers: headers(alejandroAuth.access_token),
      data: { operation: 'LINK', predio_id: predioId, expediente_acto_ids: [actId], preview_fingerprint: previewBody.fingerprint, idempotency_key: randomUUID() } });
    const applied = await apply.json();
    expect(apply.status(), JSON.stringify(applied)).toBe(200);
    relationId = applied.relation.id;
    expect(applied.relation.predio_id).toBe(predioId);
    expect(await db.expedientePredio.count({ where: { organization_id: org, expediente_id: caseId, predio_id: predioId, estatus: 'ACTIVO' } })).toBe(1);
    expect((await request.get(`/api/expedientes/${caseId}/predios`, { headers: headers(alejandroAuth.access_token) })).status()).toBe(200);

    const newApodo = `${apodo} ACTUALIZADO`;
    const update = await request.patch(`/api/predios/${predioId}`, { headers: headers(alejandroAuth.access_token),
      data: { apodo: newApodo, ubicacion_texto: `Ubicación sintética ${suffix}`, expected_version: created.data.version } });
    expect(update.status(), JSON.stringify(await update.json())).toBe(200);
    expect((await db.predio.findUniqueOrThrow({ where: { id: predioId } })).apodo).toBe(newApodo);
    await owner.goto(`/predios/${predioId}`);
    await expect(owner.getByRole('heading', { name: newApodo })).toBeVisible();
    await owner.reload();
    await expect(owner.getByRole('heading', { name: newApodo })).toBeVisible();
    expect(await db.auditLog.count({ where: { organization_id: org, entidad_id: predioId, accion: 'UPDATE_PROPERTY_MASTER', user_id: alejandroAuth.user.id } })).toBe(1);
    expect(await db.predio.count({ where: { organization_id: org, apodo: newApodo, archived_at: null } })).toBe(1);
  } finally {
    if (relationId) {
      await db.expedienteActoPredio.deleteMany({ where: { expediente_predio_id: relationId } });
      await db.auditLog.deleteMany({ where: { entidad_id: relationId } });
      await db.expedientePredio.deleteMany({ where: { id: relationId } });
    }
    if (caseCreated) {
      const events = await db.domainEventOutbox.findMany({ where: { aggregate_type: 'Expediente', aggregate_id: caseId }, select: { id: true } });
      await db.domainEventProcessingLog.deleteMany({ where: { event_id: { in: events.map((event) => event.id) } } });
      await db.domainEventOutbox.deleteMany({ where: { aggregate_type: 'Expediente', aggregate_id: caseId } });
      await db.expedienteActividad.deleteMany({ where: { expediente_id: caseId } });
      if (actId) await db.expedienteActo.deleteMany({ where: { id: actId } });
      await db.auditLog.deleteMany({ where: { entidad_id: caseId } });
      await db.expediente.delete({ where: { id: caseId } });
    }
    if (predioId) {
      await db.auditLog.deleteMany({ where: { entidad_id: predioId } });
      await db.predio.delete({ where: { id: predioId } });
    }
    await ownerContext.close();
    await viewerContext.close();
    await db.$disconnect();
  }
});
