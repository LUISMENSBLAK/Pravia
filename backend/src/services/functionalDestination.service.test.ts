import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CatalogoDestinoFuncional } from '@prisma/client';

const db = vi.hoisted(() => ({
  catalogoArtefacto: { findFirst: vi.fn() },
  catalogoArtefactoDestino: { findMany: vi.fn(), deleteMany: vi.fn(), createMany: vi.fn() },
  auditLog: { create: vi.fn() },
  $transaction: vi.fn(),
}));
vi.mock('../config/prisma', () => ({ default: db }));

import { functionalDestinationService } from './functionalDestination.service';

const actor: any = { id: 'user-1', organizationId: 'org-1', sessionId: 'session-1', permissions: ['configuracion.plantillas_formatos.manage'] };
const link = (id: string, predeterminado = false, acts: string[] = []) => ({
  id: `link-${id}`, artefacto_id: id, predeterminado, reglas_json: null, mapeo_datos_json: null,
  artefacto: { id, nombre: id, actos: acts.map((tipo_acto_id) => ({ tipo_acto_id })), versiones: [{ id: `version-${id}`, version: 1, checksum_sha256: id }] },
});

describe('CFG-002 · destinos funcionales', () => {
  beforeEach(() => { vi.clearAllMocks(); db.$transaction.mockImplementation((work: any) => work(db)); db.catalogoArtefactoDestino.deleteMany.mockResolvedValue({ count: 0 }); db.catalogoArtefactoDestino.createMany.mockResolvedValue({ count: 1 }); db.auditLog.create.mockResolvedValue({}); });

  it('resuelve la coincidencia exacta por acto antes del formato global', async () => {
    db.catalogoArtefactoDestino.findMany.mockResolvedValue([link('global', true), link('exact', false, ['act-1'])]);
    const result = await functionalDestinationService.resolve(actor, CatalogoDestinoFuncional.PROYECTO_MACHOTE, { tipoActoId: 'act-1' });
    expect(result.artifact.id).toBe('exact');
    expect(result.provenance).toMatchObject({ artifact_id: 'exact', version_id: 'version-exact' });
  });

  it('falla explícitamente ante ausencia o ambigüedad; nunca usa carpeta o nombre como fallback', async () => {
    db.catalogoArtefactoDestino.findMany.mockResolvedValueOnce([]).mockResolvedValueOnce([link('a'), link('b')]);
    await expect(functionalDestinationService.resolve(actor, CatalogoDestinoFuncional.CALCULO_ISR_MEMORIA)).rejects.toMatchObject({ code: 'FUNCTIONAL_DESTINATION_MISSING' });
    await expect(functionalDestinationService.resolve(actor, CatalogoDestinoFuncional.CALCULO_ISR_MEMORIA)).rejects.toMatchObject({ code: 'FUNCTIONAL_DESTINATION_AMBIGUOUS' });
  });

  it('permite varios destinos para un mismo artefacto y los audita', async () => {
    db.catalogoArtefacto.findFirst.mockResolvedValue({ id: 'artifact-1', tipo: 'FORMATO' });
    db.catalogoArtefactoDestino.findMany.mockResolvedValueOnce([]).mockResolvedValueOnce([{ destino: 'COTIZACION_SERVICIOS' }, { destino: 'EXPEDIENTE_PRESUPUESTO' }]);
    await functionalDestinationService.assign(actor, 'artifact-1', { destinos: [
      { destino: 'COTIZACION_SERVICIOS', predeterminado: true }, { destino: 'EXPEDIENTE_PRESUPUESTO', predeterminado: true },
    ] });
    expect(db.catalogoArtefactoDestino.createMany).toHaveBeenCalledWith(expect.objectContaining({ data: expect.arrayContaining([
      expect.objectContaining({ destino: 'COTIZACION_SERVICIOS' }), expect.objectContaining({ destino: 'EXPEDIENTE_PRESUPUESTO' }),
    ]) }));
    expect(db.auditLog.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ accion: 'CFG002_FUNCTIONAL_DESTINATIONS_UPDATED' }) }));
  });
});
