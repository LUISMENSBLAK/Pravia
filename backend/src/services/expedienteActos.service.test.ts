import { describe, expect, it, vi } from 'vitest';
import { ExpedienteActoError, ExpedienteActosService } from './expedienteActos.service';

const actor: any = { id: 'user-1', organizationId: 'org-1', sessionId: 'session-1', rol: 'ADMINISTRACION', permissions: ['expedientes.read', 'expedientes.write'], scope: 'ALL_OBJECTS' };
const now = new Date('2026-08-26T12:00:00.000Z');

function database(input: { acts?: any[]; count?: Record<string, number>; status?: string; expedienteFound?: boolean; prior?: any; partyRelations?: number; propertyRelations?: number } = {}) {
  const acts = input.acts || [];
  const expediente = input.expedienteFound === false ? null : { id: 'exp-1', organization_id: 'org-1', abogado_id: 'user-1', notaria_id: null, notaria: null, datos_operacion: null, predios: [], estatus: input.status || 'EN_PROCESO', version: 3, updated_at: now, actos: acts, _count: input.count || { etapas: 0, tareas: 0, expedienteDocumentos: 0, requisitos_docs: 0 } };
  const tx: any = {
    $executeRaw: vi.fn().mockResolvedValue(1),
    expediente: { findFirst: vi.fn().mockResolvedValueOnce(expediente ? { id: 'exp-1' } : null).mockResolvedValue(expediente), update: vi.fn().mockResolvedValue({ version: 4 }) },
    expedienteActo: {
      findFirst: vi.fn().mockImplementation(async ({ where }: any) => where.OR ? input.prior || null : acts.find((act) => act.id === where.id) || null),
      findMany: vi.fn().mockResolvedValue(acts),
      create: vi.fn().mockImplementation(async ({ data }: any) => ({ id: 'link-new', estatus: 'ACTIVO', created_at: now, tipo_acto: { id: data.tipo_acto_id, nombre: 'Compraventa' }, ...data })),
      update: vi.fn().mockImplementation(async ({ data }: any) => ({ ...acts[0], ...data })),
    },
    tipoActo: { findFirst: vi.fn().mockResolvedValue({ id: 'type-1', nombre: 'Compraventa' }) },
    configuracionActo: { findMany: vi.fn().mockResolvedValue([]) },
    catalogoArtefacto: { findMany: vi.fn().mockResolvedValue([]) },
    expedienteCompareciente: { count: vi.fn().mockResolvedValue(input.partyRelations || 0) },
    expedienteActoPredio: { count: vi.fn().mockResolvedValue(input.propertyRelations || 0) },
    expedienteSeguimientoActividad: { findMany: vi.fn().mockResolvedValue([]), update: vi.fn(), upsert: vi.fn() },
    expedienteSeguimientoOrigen: { findMany: vi.fn().mockResolvedValue([]), findFirst: vi.fn().mockResolvedValue(null), updateMany: vi.fn(), upsert: vi.fn() },
    expedienteSeguimientoDependencia: { findMany: vi.fn().mockResolvedValue([]), upsert: vi.fn() },
    expedienteSeguimientoHistorial: { count: vi.fn().mockResolvedValue(0), create: vi.fn() },
    expedienteComplianceState: { findFirst: vi.fn().mockResolvedValue(null) },
    organizationMembership: { findFirst: vi.fn().mockResolvedValue(null) },
    expedienteActividad: { create: vi.fn().mockResolvedValue({ id: 'activity-1' }) },
    auditLog: { create: vi.fn().mockResolvedValue({ id: 'audit-1' }) },
    domainEventOutbox: { create: vi.fn().mockResolvedValue({ id: 'event-1' }) },
  };
  const prisma: any = { ...tx, $transaction: vi.fn(async (callback: any) => callback(tx)) };
  return { prisma, tx };
}

describe('EXP-002 actos canónicos del expediente', () => {
  it('permite agregar dos instancias del mismo tipo porque no deduplica por tipo', async () => {
    const { prisma, tx } = database();
    const service = new ExpedienteActosService(prisma);
    const preview = await service.preview(actor, 'exp-1', { operation: 'ADD', tipo_acto_id: 'type-1' });
    await service.apply(actor, 'exp-1', { operation: 'ADD', tipo_acto_id: 'type-1', idempotency_key: 'request-1', preview_fingerprint: preview.fingerprint });
    expect(tx.expedienteActo.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ expediente_id: 'exp-1', tipo_acto_id: 'type-1' }) }));
  });

  it('devuelve el resultado anterior al repetir la misma clave idempotente', async () => {
    const prior = { id: 'link-prior', tipo_acto_id: 'type-1', tipo_acto: { id: 'type-1', nombre: 'Compraventa' } };
    const { prisma, tx } = database({ prior });
    const result = await new ExpedienteActosService(prisma).apply(actor, 'exp-1', { operation: 'ADD', tipo_acto_id: 'type-1', idempotency_key: 'same-request', preview_fingerprint: 'fingerprint' });
    expect(result).toMatchObject({ acto: prior, idempotent: true });
    expect(tx.expedienteActo.create).not.toHaveBeenCalled();
  });

  it('rechaza un preview obsoleto antes de cualquier mutación', async () => {
    const { prisma, tx } = database();
    await expect(new ExpedienteActosService(prisma).apply(actor, 'exp-1', { operation: 'ADD', tipo_acto_id: 'type-1', idempotency_key: 'request-stale', preview_fingerprint: 'obsolete' })).rejects.toMatchObject({ code: 'EXPEDIENTE_ACT_PREVIEW_STALE', status: 409 });
    expect(tx.expedienteActo.create).not.toHaveBeenCalled();
    expect(tx.auditLog.create).not.toHaveBeenCalled();
  });

  it('bloquea acceso cruzado de tenant aunque el identificador sea válido', async () => {
    const { prisma } = database({ expedienteFound: false });
    await expect(new ExpedienteActosService(prisma).preview(actor, 'foreign-exp', { operation: 'ADD', tipo_acto_id: 'type-1' })).rejects.toMatchObject({ code: 'EXPEDIENTE_ACCESS_DENIED', status: 403 });
  });

  it('exige confirmación para trabajo configurado que dejaría de aplicar', async () => {
    const act = { id: 'link-1', tipo_acto_id: 'type-old', updated_at: now };
    const { prisma, tx } = database({ acts: [act], count: { etapas: 1, tareas: 0, expedienteDocumentos: 0, requisitos_docs: 0 } });
    tx.tipoActo.findFirst.mockResolvedValue({ id: 'type-new', nombre: 'Donación' });
    tx.configuracionActo.findMany.mockImplementation(async ({ where }: any) => where.tipo_acto_id.in.includes('type-old') ? [{ tipo_acto_id: 'type-old', etapas: [{ id: 'stage-1', nombre: 'Integración', actividades: [] }] }] : []);
    const service = new ExpedienteActosService(prisma);
    const preview = await service.preview(actor, 'exp-1', { operation: 'CHANGE', expediente_acto_id: 'link-1', tipo_acto_id: 'type-new', reason: 'Cambio solicitado' });
    expect(preview.classification).toBe('REVIEW_REQUIRED');
    await expect(service.apply(actor, 'exp-1', { operation: 'CHANGE', expediente_acto_id: 'link-1', tipo_acto_id: 'type-new', reason: 'Cambio solicitado', idempotency_key: 'request-review', preview_fingerprint: preview.fingerprint })).rejects.toMatchObject({ code: 'EXPEDIENTE_ACT_CONFIRMATION_REQUIRED' });
  });

  it('desvincula lógicamente y registra actividad, auditoría y outbox', async () => {
    const act = { id: 'link-1', tipo_acto_id: 'type-1', tipo_acto: { id: 'type-1', nombre: 'Compraventa' }, updated_at: now };
    const { prisma, tx } = database({ acts: [act] });
    const service = new ExpedienteActosService(prisma);
    const preview = await service.preview(actor, 'exp-1', { operation: 'REMOVE', expediente_acto_id: 'link-1', reason: 'Acto cancelado' });
    await service.apply(actor, 'exp-1', { operation: 'REMOVE', expediente_acto_id: 'link-1', reason: 'Acto cancelado', idempotency_key: 'remove-1', preview_fingerprint: preview.fingerprint });
    expect(tx.expedienteActo.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ estatus: 'RETIRADO', removal_idempotency_key: 'remove-1' }) }));
    expect(tx.expedienteActo.delete).toBeUndefined();
    expect(tx.expedienteActividad.create).toHaveBeenCalled();
    expect(tx.auditLog.create).toHaveBeenCalled();
    expect(tx.domainEventOutbox.create).toHaveBeenCalled();
  });

  it('bloquea retirar un acto con relaciones operativas activas aunque no tenga configuración', async () => {
    const act = { id: 'link-1', tipo_acto_id: 'type-1', tipo_acto: { id: 'type-1', nombre: 'Compraventa' }, updated_at: now };
    const { prisma } = database({ acts: [act], partyRelations: 1, propertyRelations: 1 });
    const preview = await new ExpedienteActosService(prisma).preview(actor, 'exp-1', { operation: 'REMOVE', expediente_acto_id: 'link-1', reason: 'Acto cancelado' });
    expect(preview.classification).toBe('BLOCKED');
    expect(preview.impact.protected_work).toMatchObject({ count: 2, requires_human_confirmation: false });
  });

  it('guarda el porcentaje objeto con control de concurrencia y auditoría, sin inventar participaciones', async () => {
    const act = { id: 'link-1', organization_id: 'org-1', expediente_id: 'exp-1', tipo_acto_id: 'type-1', porcentaje_objeto: 100, estatus: 'ACTIVO', removed_at: null, updated_at: now, tipo_acto: { id: 'type-1', nombre: 'Compraventa' } };
    const { prisma, tx } = database({ acts: [act] });
    const result = await new ExpedienteActosService(prisma).setObjectPercentage(actor, 'exp-1', act.id, { porcentaje_objeto: 50, expected_updated_at: now.toISOString() });
    expect(result).toMatchObject({ idempotent: false });
    expect(tx.expedienteActo.update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: act.id }, data: { porcentaje_objeto: 50 } }));
    expect(tx.auditLog.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ accion: 'UPDATE_EXPEDIENTE_ACT_OBJECT_PERCENTAGE' }) }));
  });

  it('rechaza porcentaje objeto inválido o revisión obsoleta', async () => {
    const act = { id: 'link-1', organization_id: 'org-1', expediente_id: 'exp-1', tipo_acto_id: 'type-1', porcentaje_objeto: 100, estatus: 'ACTIVO', removed_at: null, updated_at: now };
    const db = database({ acts: [act] });
    await expect(new ExpedienteActosService(db.prisma).setObjectPercentage(actor, 'exp-1', act.id, { porcentaje_objeto: 0, expected_updated_at: now.toISOString() })).rejects.toMatchObject({ code: 'EXPEDIENTE_ACT_OBJECT_PERCENTAGE_INVALID' });
    await expect(new ExpedienteActosService(db.prisma).setObjectPercentage(actor, 'exp-1', act.id, { porcentaje_objeto: 50, expected_updated_at: new Date(now.getTime() - 1).toISOString() })).rejects.toMatchObject({ code: 'EXPEDIENTE_ACT_STALE' });
  });

  it('expone errores de dominio estables', () => {
    const error = new ExpedienteActoError(409, 'TEST_CODE', 'Mensaje humano');
    expect(error).toMatchObject({ status: 409, code: 'TEST_CODE', message: 'Mensaje humano' });
  });
});
