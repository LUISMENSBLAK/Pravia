import { describe, expect, it, vi } from 'vitest';
import { ExpedienteActivityError, ExpedienteActivityService } from './expedienteActivity.service';

const actor = { id: '00000000-0000-4000-8000-000000000001', organizationId: '00000000-0000-4000-8000-000000000010', sessionId: 'session', rol: 'ABOGADO', permissions: ['expedientes.read', 'expedientes.write'] } as any;
const expedienteId = '00000000-0000-4000-8000-000000000020';
const event = (overrides: Record<string, unknown> = {}) => ({ id: '00000000-0000-4000-8000-000000000030', organization_id: actor.organizationId, expediente_id: expedienteId, usuario_id: actor.id, tipo: 'CAMBIO_ESTATUS', categoria: 'OPERACION', titulo: 'Transición a firmado', descripcion: 'Firma registrada.', metadatos: { estado_anterior: 'EN_PROCESO', estado_nuevo: 'FIRMADO' }, valores_anteriores: null, valores_nuevos: null, seccion_relacionada: null, entidad_relacionada: null, entidad_relacionada_id: null, es_nota_manual: false, created_at: new Date('2026-08-29T18:00:00Z'), usuario: { id: actor.id, nombre: 'Andrea', apellido: 'Ruiz' }, ...overrides });

function database(rows = [event()]) {
  const db: any = {
    expediente: { findFirst: vi.fn().mockResolvedValue({ id: expedienteId }) },
    expedienteActividad: { findFirst: vi.fn().mockResolvedValue(null), findMany: vi.fn().mockResolvedValue(rows), create: vi.fn() },
    auditLog: { create: vi.fn() }, domainEventOutbox: { create: vi.fn() }, $executeRaw: vi.fn(),
  };
  db.$transaction = vi.fn(async (callback: any) => callback(db));
  return db;
}

describe('EXP-009 operational activity', () => {
  it('scopes every timeline read by tenant and expediente object access', async () => {
    const db = database(); const result = await new ExpedienteActivityService(db).list(actor, expedienteId, { category: 'TODO' });
    expect(db.expediente.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ id: expedienteId, organization_id: actor.organizationId }) }));
    expect(db.expedienteActividad.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ organization_id: actor.organizationId, expediente_id: expedienteId }) }));
    expect(result.data[0]).toMatchObject({ category: 'OPERACION', related_section: 'seguimiento' });
    expect(result.data[0]).not.toHaveProperty('technical');
    expect(result.technical_audit_source).toBe(false);
  });

  it('rejects a valid cursor owned by another tenant instead of leaking chronology', async () => {
    const db = database(); db.expedienteActividad.findFirst.mockResolvedValue(null);
    await expect(new ExpedienteActivityService(db).list(actor, expedienteId, { cursor: '00000000-0000-4000-8000-000000000099' })).rejects.toMatchObject({ status: 403, code: 'EXP009_CURSOR_ACCESS_DENIED' });
  });

  it('removes operational noise and technical identifiers from user-facing changes', async () => {
    const db = database([
      event({ id: '00000000-0000-4000-8000-000000000031', tipo: 'TAREA', titulo: 'Tarea abierta' }),
      event({ id: '00000000-0000-4000-8000-000000000032', tipo: 'DOCUMENTO', titulo: 'Descarga de expediente completo' }),
      event({ id: '00000000-0000-4000-8000-000000000033', valores_anteriores: { estado: 'A', user_id: actor.id }, valores_nuevos: { estado: 'B', correlation_id: actor.id } }),
    ]);
    const result = await new ExpedienteActivityService(db).list(actor, expedienteId, {});
    expect(result.data).toHaveLength(1); expect(result.data[0].previous_values).toEqual({ estado: 'A' }); expect(result.data[0].new_values).toEqual({ estado: 'B' });
  });

  it('stores an immutable manual note idempotently with audit and outbox correlation', async () => {
    const db = database(); const created = event({ tipo: 'NOTA', categoria: 'OPERACION', titulo: 'Nota operativa', descripcion: 'Cliente confirmó horario.', es_nota_manual: true }); db.expedienteActividad.create.mockResolvedValue(created);
    const result = await new ExpedienteActivityService(db).addNote(actor, expedienteId, { note: 'Cliente confirmó horario.', idempotency_key: 'note-operation-001' });
    expect(result.idempotent).toBe(false);
    expect(db.expedienteActividad.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ organization_id: actor.organizationId, expediente_id: expedienteId, tipo: 'NOTA', es_nota_manual: true, idempotency_key: 'note-operation-001' }) }));
    expect(db.auditLog.create).toHaveBeenCalledTimes(1); expect(db.domainEventOutbox.create).toHaveBeenCalledTimes(1);
    expect(db.tarea).toBeUndefined(); expect(db.expedienteSeguimientoActividad).toBeUndefined();
  });

  it('returns the existing note when the same idempotency key is retried', async () => {
    const db = database(); db.expedienteActividad.findFirst.mockResolvedValue(event({ tipo: 'NOTA', es_nota_manual: true }));
    const result = await new ExpedienteActivityService(db).addNote(actor, expedienteId, { note: 'Una nota', idempotency_key: 'note-operation-002' });
    expect(result.idempotent).toBe(true); expect(db.expedienteActividad.create).not.toHaveBeenCalled(); expect(db.auditLog.create).not.toHaveBeenCalled();
  });

  it('validates date/category/note boundaries without writing', async () => {
    const service = new ExpedienteActivityService(database());
    await expect(service.list(actor, expedienteId, { category: 'AUDIT_LOG' })).rejects.toBeInstanceOf(ExpedienteActivityError);
    await expect(service.list(actor, expedienteId, { from: '2026-09-02', to: '2026-09-01' })).rejects.toMatchObject({ code: 'EXP009_DATE_RANGE_INVALID' });
    await expect(service.addNote(actor, expedienteId, { note: 'x'.repeat(2001), idempotency_key: 'note-operation-003' })).rejects.toMatchObject({ code: 'EXP009_NOTE_TOO_LONG' });
  });
});
