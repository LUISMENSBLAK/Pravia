import { describe, expect, it, vi } from 'vitest';
import { ExpedienteOpeningService } from './expedienteOpening.service';

describe('motor único de apertura de expedientes', () => {
  it('reserva folio, congela versiones, inicializa etapa, requisitos, relación y auditoría', async () => {
    const tx: any = {
      $executeRaw: vi.fn().mockResolvedValue(1),
      tipoActo: { findFirst: vi.fn().mockResolvedValue({ id: 'act-1', tipoActoCaracteresCompareciente: [{ caracter_id: 'char-1', caracter: { id: 'char-1' } }] }) },
      user: { findFirst: vi.fn().mockResolvedValueOnce({ id: 'actor-1' }).mockResolvedValueOnce({ id: 'lawyer-1', rol: 'ABOGADO' }) },
      formularioVersion: { findFirst: vi.fn().mockResolvedValue({ id: 'form-v1' }) },
      flujoVersion: { findFirst: vi.fn().mockResolvedValue({ id: 'flow-v1', etapas_json: [{ clave: 'APERTURA', nombre: 'Apertura', orden: 1, estado: 'ABIERTO' }] }) },
      plantillaDocumentalVersion: { findFirst: vi.fn().mockResolvedValue({ id: 'docs-v1', requisitos_json: [{ nombre: 'Identificación', categoria: 'FIRMA', obligatorio: true }] }) },
      compareciente: { findFirst: vi.fn().mockResolvedValue({ id: 'party-1' }) },
      expediente: {
        findMany: vi.fn().mockResolvedValue([{ numero_pravia: 'EXP-2026-0040' }]),
        create: vi.fn().mockImplementation(async ({ data }) => ({ id: 'exp-1', version: 1, ...data })),
        update: vi.fn().mockImplementation(async ({ data }) => ({ id: 'exp-1', numero_pravia: 'EXP-2026-0041', version: 1, ...data })),
      },
      expedienteEtapa: { create: vi.fn().mockResolvedValue({ id: 'stage-1', nombre_snapshot: 'Apertura' }) },
      expedienteRequisitoDoc: { createMany: vi.fn().mockResolvedValue({ count: 1 }) },
      expedienteCompareciente: { create: vi.fn().mockResolvedValue({ id: 'link-1' }) },
      expedienteActividad: { create: vi.fn().mockResolvedValue({ id: 'activity-1' }) },
      auditLog: { create: vi.fn().mockResolvedValue({ id: 'audit-1' }) },
    };
    const service = new ExpedienteOpeningService({} as any);
    const result = await service.openInTransaction(tx, { tipoActoId: 'act-1', abogadoId: 'lawyer-1', actorUserId: 'actor-1', clienteAlias: 'Cliente Real', comparecienteId: 'party-1', source: 'DIRECTO' });
    expect(result.numero_pravia).toBe('EXP-2026-0041');
    expect(tx.$executeRaw).toHaveBeenCalledTimes(1);
    expect(tx.expediente.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ flujo_version_id: 'flow-v1', formulario_version_id: 'form-v1', plantilla_doc_version_id: 'docs-v1' }) }));
    expect(tx.expedienteCompareciente.create).toHaveBeenCalled();
    expect(tx.expedienteActividad.create).toHaveBeenCalled();
    expect(tx.auditLog.create).toHaveBeenCalled();
  });
});
