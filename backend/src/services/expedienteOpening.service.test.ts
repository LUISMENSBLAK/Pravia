import { describe, expect, it, vi } from 'vitest';
import { ExpedienteOpeningService } from './expedienteOpening.service';
import { runWithActorContext, TEST_ORGANIZATION_ID } from '../auth/actorContext';

const actorContext = { userId: 'actor-1', organizationId: TEST_ORGANIZATION_ID, membershipId: 'membership-1', role: 'ABOGADO' as const, permissions: [], scope: 'ASSIGNED_OBJECTS' as const, sessionId: 'session-1' };

describe('motor único de apertura de expedientes', () => {
  it('reserva folio, congela versiones e inicializa exclusivamente desde cotización', async () => {
    const tx: any = {
      $executeRaw: vi.fn().mockResolvedValue(1),
      tipoActo: { findFirst: vi.fn().mockResolvedValue({ id: 'act-1', tipoActoCaracteresCompareciente: [{ caracter_id: 'char-1', caracter: { id: 'char-1' } }] }) },
      user: { findFirst: vi.fn().mockResolvedValueOnce({ id: 'actor-1' }).mockResolvedValueOnce({ id: 'lawyer-1', organizationMemberships: [{ rol: 'ABOGADO' }] }) },
      formularioVersion: { findFirst: vi.fn().mockResolvedValue({ id: 'form-v1' }) },
      flujoVersion: { findFirst: vi.fn().mockResolvedValue({ id: 'flow-v1', etapas_json: [{ clave: 'APERTURA', nombre: 'Apertura', orden: 1, estado: 'ABIERTO' }] }) },
      plantillaDocumentalVersion: { findFirst: vi.fn().mockResolvedValue({ id: 'docs-v1', requisitos_json: [{ nombre: 'Identificación', categoria: 'FIRMA', obligatorio: true }] }) },
      compareciente: { findFirst: vi.fn().mockResolvedValue({ id: 'party-1' }) },
      expediente: {
        findMany: vi.fn().mockResolvedValue([{ numero_pravia: 'EXP-2026-0040' }]),
        findFirst: vi.fn().mockResolvedValue({ id: 'exp-1', organization_id: TEST_ORGANIZATION_ID, abogado_id: 'lawyer-1', notaria_id: null, notaria: null, datos_operacion: null, predios: [], actos: [{ id: 'exp-act-1', tipo_acto_id: 'act-1' }] }),
        create: vi.fn().mockImplementation(async ({ data }) => ({ id: 'exp-1', version: 1, ...data })),
        update: vi.fn().mockImplementation(async ({ data }) => ({ id: 'exp-1', numero_pravia: 'EXP-0041-2026', version: 1, ...data })),
      },
      expedienteEtapa: { create: vi.fn().mockResolvedValue({ id: 'stage-1', nombre_snapshot: 'Apertura' }) },
      expedienteRequisitoDoc: { createMany: vi.fn().mockResolvedValue({ count: 1 }) },
      expedienteCompareciente: { create: vi.fn().mockResolvedValue({ id: 'link-1' }) },
      expedienteActividad: { create: vi.fn().mockResolvedValue({ id: 'activity-1' }) },
      expedienteActo: { create: vi.fn().mockResolvedValue({ id: 'exp-act-1' }) },
      configuracionActo: { findMany: vi.fn().mockResolvedValue([]) },
      expedienteSeguimientoActividad: { findMany: vi.fn().mockResolvedValue([]), upsert: vi.fn(), update: vi.fn() },
      expedienteSeguimientoDependencia: { findMany: vi.fn().mockResolvedValue([]), upsert: vi.fn() },
      expedienteSeguimientoHistorial: { create: vi.fn(), count: vi.fn().mockResolvedValue(0) },
      expedienteComplianceState: { findFirst: vi.fn().mockResolvedValue(null) },
      organizationMembership: { findFirst: vi.fn().mockResolvedValue(null) },
      auditLog: { create: vi.fn().mockResolvedValue({ id: 'audit-1' }) },
    };
    const service = new ExpedienteOpeningService({} as any);
    const result = await runWithActorContext(actorContext, () => service.openInTransaction(tx, { tipoActoId: 'act-1', abogadoId: 'lawyer-1', actorUserId: 'actor-1', clienteAlias: 'Cliente Real', comparecienteId: 'party-1', cotizacionId: 'quote-1' }));
    expect(result.numero_pravia).toBe('EXP-0041-2026');
    expect(tx.$executeRaw).toHaveBeenCalledTimes(1);
    expect(tx.expediente.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ flujo_version_id: 'flow-v1', formulario_version_id: 'form-v1', plantilla_doc_version_id: 'docs-v1' }) }));
    expect(tx.expedienteCompareciente.create).toHaveBeenCalled();
    expect(tx.expedienteActividad.create).toHaveBeenCalled();
    expect(tx.expediente.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ cotizacion_id: 'quote-1' }) }));
    expect(tx.expedienteActo.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ expediente_id: 'exp-1', tipo_acto_id: 'act-1', source_cotizacion_id: 'quote-1', origen: 'COTIZACION' }) }));
    expect(tx.expedienteCompareciente.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ organization_id: TEST_ORGANIZATION_ID, expediente_id: 'exp-1', expediente_acto_id: 'exp-act-1', compareciente_id: 'party-1' }) }));
    expect(tx.expediente.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.not.objectContaining({ tipo_acto_id: expect.anything() }) }));
  });

  it('bloquea una apertura huérfana antes de cualquier consulta o escritura', async () => {
    const service = new ExpedienteOpeningService({} as any);
    const tx: any = { tipoActo: { findFirst: vi.fn() }, expediente: { create: vi.fn() } };
    await expect(runWithActorContext(actorContext, () => service.openInTransaction(tx, {
      tipoActoId: 'act-1', abogadoId: 'lawyer-1', actorUserId: 'actor-1', clienteAlias: 'Cliente', cotizacionId: '',
    }))).rejects.toMatchObject({ code: 'EXPEDIENTE_QUOTE_ORIGIN_REQUIRED', status: 409 });
    expect(tx.tipoActo.findFirst).not.toHaveBeenCalled();
    expect(tx.expediente.create).not.toHaveBeenCalled();
  });
});
