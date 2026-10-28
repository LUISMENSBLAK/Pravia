import { expect, test } from '@playwright/test';
import { PrismaClient } from '../../backend/node_modules/@prisma/client/default.js';

test('COL56 · rechazo de asignación queda auditado sin mutación ni secretos', async ({ request }, testInfo) => {
  const base = new URL(String(testInfo.project.use.baseURL));
  const dbUrl = process.env.PRAVIA_E2E_LOCAL_DATABASE_URL || '';
  const password = process.env.PRAVIA_E2E_JAVIER_PASSWORD || '';
  if (base.hostname !== '127.0.0.1' || base.port !== '5176' ||
    dbUrl !== 'postgresql://postgres@127.0.0.1:55439/postgres?schema=pravia_os' || !password) {
    throw new Error('COL56_LOCAL_SAFETY_GATE_FAILED');
  }
  const db = new PrismaClient({ datasources: { db: { url: dbUrl } } });
  try {
    const login = await request.post('/api/auth/login', { data: {
      email: 'javier.tapia@pravia.test', password,
    } });
    expect(login.status()).toBe(200);
    const auth = await login.json();
    const orgId = auth.user.organization.id as string;
    const actorId = auth.user.id as string;
    const target = await db.expediente.findFirst({ where: { organization_id: orgId, archived_at: null },
      select: { id: true } });
    expect(target).toBeTruthy();
    const before = await db.recordCollaboration.count({ where: { organization_id: orgId, expediente_id: target!.id } });
    const auditBefore = await db.auditLog.count({ where: { organization_id: orgId, user_id: actorId,
      entidad: 'collaboration', entidad_id: target!.id, accion: 'ACTION_DENIED' } });
    const attempt = await request.post(`/api/collaboration/expediente/${target!.id}/asistentes`, {
      headers: { Authorization: `Bearer ${auth.access_token}` },
      data: { user_id: actorId, password: 'MUST_NOT_APPEAR_IN_AUDIT' },
    });
    expect(attempt.status()).toBe(403);
    expect((await attempt.json()).code).toBe('COLLAB_ASSIGNMENT_DENIED');
    await expect.poll(() => db.auditLog.findMany({ where: { organization_id: orgId, user_id: actorId,
      entidad: 'collaboration', entidad_id: target!.id, accion: 'ACTION_DENIED' },
      orderBy: { created_at: 'desc' }, take: 1 })).toHaveLength(1);
    const audit = await db.auditLog.findFirstOrThrow({ where: { organization_id: orgId, user_id: actorId,
      entidad: 'collaboration', entidad_id: target!.id, accion: 'ACTION_DENIED' },
      orderBy: { created_at: 'desc' } });
    expect(audit.session_id).toBeTruthy();
    expect(audit.detalles).toMatchObject({ result: 'ACTION_DENIED', module: 'collaboration',
      object_id: target!.id, code: 'COLLAB_ASSIGNMENT_DENIED' });
    expect(JSON.stringify(audit)).not.toContain('MUST_NOT_APPEAR_IN_AUDIT');
    expect(await db.recordCollaboration.count({ where: { organization_id: orgId,
      expediente_id: target!.id } })).toBe(before);
    await db.auditLog.deleteMany({ where: { organization_id: orgId, user_id: actorId,
      entidad: 'collaboration', entidad_id: target!.id, accion: 'ACTION_DENIED',
      created_at: { gte: audit.created_at } } });
    expect(await db.auditLog.count({ where: { organization_id: orgId, user_id: actorId,
      entidad: 'collaboration', entidad_id: target!.id, accion: 'ACTION_DENIED' } })).toBe(auditBefore);
  } finally {
    await db.$disconnect();
  }
});
