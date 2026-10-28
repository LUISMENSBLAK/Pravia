import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import { securityDenialAudit } from './securityDenialAudit.middleware';

const objectId = '11111111-1111-4111-8111-111111111111';
const actorId = '22222222-2222-4222-8222-222222222222';
const orgId = '33333333-3333-4333-8333-333333333333';

function response() {
  const events = new EventEmitter() as EventEmitter & { statusCode: number; json: (body: unknown) => unknown };
  events.statusCode = 200;
  events.json = vi.fn((body) => body);
  return events;
}

describe('auditoría de rechazos autenticados', () => {
  it('registra 403 con actor, sesión, tenant y objeto sin payload sensible', async () => {
    const create = vi.fn().mockResolvedValue({ id: 'audit-1' });
    const middleware = securityDenialAudit({ auditLog: { create } } as any);
    const req = { path: `/expedientes/${objectId}`, originalUrl: `/api/expedientes/${objectId}?token=never-log-this`, method: 'PATCH',
      body: { password: 'never-log-this' }, headers: { authorization: 'Bearer never-log-this' },
      user: { id: actorId, organizationId: orgId, sessionId: 'session-qa' } } as any;
    const res = response();
    middleware(req, res as any, vi.fn());
    res.statusCode = 403;
    res.json({ code: 'EXPEDIENTE_ACCESS_DENIED', error: 'No autorizado' });
    res.emit('finish');
    await vi.waitFor(() => expect(create).toHaveBeenCalledOnce());
    const payload = create.mock.calls[0][0].data;
    expect(payload).toMatchObject({ accion: 'ACTION_DENIED', organization_id: orgId,
      user_id: actorId, session_id: 'session-qa', entidad: 'expedientes', entidad_id: objectId,
      detalles: { result: 'ACTION_DENIED', code: 'EXPEDIENTE_ACCESS_DENIED', object_id: objectId } });
    expect(JSON.stringify(payload)).not.toContain('never-log-this');
  });

  it('no registra éxito, lecturas 200 ni repetición inmediata del mismo rechazo', async () => {
    const create = vi.fn().mockResolvedValue({});
    const middleware = securityDenialAudit({ auditLog: { create } } as any);
    const req = { path: `/api/cotizaciones/${objectId}`, method: 'PATCH',
      user: { id: actorId, organizationId: orgId, sessionId: 'session-2' } } as any;
    const ok = response();
    middleware(req, ok as any, vi.fn());
    ok.json({ success: true });
    ok.emit('finish');
    expect(create).not.toHaveBeenCalled();
    for (let i = 0; i < 2; i++) {
      const denied = response();
      middleware(req, denied as any, vi.fn());
      denied.statusCode = 403;
      denied.json({ code: 'COTIZACION_ACCESS_DENIED' });
      denied.emit('finish');
    }
    await vi.waitFor(() => expect(create).toHaveBeenCalledOnce());
  });
});
