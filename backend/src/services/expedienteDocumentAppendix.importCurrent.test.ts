import { describe, expect, it, vi } from 'vitest';
import { ExpedienteDocumentAppendixService } from './expedienteDocumentAppendix.service';

const actor = {
  id: '30000000-0000-4000-8000-000000000002',
  organizationId: '30000000-0000-4000-8000-000000000001',
  sessionId: 'qa-document-import',
  rol: 'DIRECCION',
  permissions: [],
};
const expedienteId = '770a40da-3ba5-4d24-a293-75fa8d064c05';

function fixture() {
  const tx = {
    $executeRaw: vi.fn().mockResolvedValue(1),
    expedienteDocumento: {
      findFirst: vi.fn(),
      update: vi.fn().mockResolvedValue({}),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      create: vi.fn().mockResolvedValue({}),
    },
    auditLog: { create: vi.fn().mockResolvedValue({}) },
  };
  const prisma = { $transaction: vi.fn(async (callback: (db: typeof tx) => Promise<unknown>) => callback(tx)) };
  const service = new ExpedienteDocumentAppendixService(prisma as any);
  vi.spyOn(service as any, 'assertExpediente').mockResolvedValue({ id: expedienteId, estatus: 'ABIERTO' });
  vi.spyOn(service as any, 'ensureDestinationFolder').mockResolvedValue('folder-qa');
  vi.spyOn(service as any, 'buildCandidates').mockResolvedValue([]);
  vi.spyOn(service as any, 'liveResponse').mockResolvedValue({ history: [], groups: [] });
  return { service, tx };
}

describe('EXP-004 importación vigente con historial', () => {
  it('desactiva vínculos importados cuya fuente dejó de estar vigente sin borrar documentos', async () => {
    const { service, tx } = fixture();
    vi.spyOn(service as any, 'discoverCurrentSources').mockResolvedValue([]);

    const result = await service.importCurrent(actor, expedienteId, 'PREDIO');

    expect(tx.expedienteDocumento.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ estatus: 'ACTIVO', source_key: { startsWith: 'IMPORT:PREDIO:' } }),
      data: expect.objectContaining({ estatus: 'SUSTITUIDO' }),
    }));
    expect(tx.expedienteDocumento.create).not.toHaveBeenCalled();
    expect(result.import.moved_to_history).toBe(1);
  });

  it('conserva la versión anterior en historial al cambiar el documento de una misma fuente', async () => {
    const { service, tx } = fixture();
    const source = {
      sourceKey: 'IMPORT:COMPARECIENTE:source-qa', sourceEntityId: actor.id,
      sourceEntityType: 'COMPARECIENTE', sourceName: 'Persona QA', sourceContext: 'IDENTIFICACION',
      document: { id: 'new-doc-qa' }, documentVersion: 'new-version', provenance: { current_only: true },
    };
    vi.spyOn(service as any, 'discoverCurrentSources').mockResolvedValue([source]);
    tx.expedienteDocumento.findFirst.mockResolvedValue({
      id: 'old-link-qa', organization_id: actor.organizationId, expediente_id: expedienteId,
      documento_id: 'old-doc-qa', document_version: 'old-version', source_key: source.sourceKey,
      tipo_vinculo: 'IMPORT_COMPARECIENTE', creado_por_id: actor.id, fecha_vinculo: new Date('2026-01-01'),
      origen: 'COMPARECIENTE', source_entity_type: 'COMPARECIENTE', source_entity_id: actor.id,
      source_context: 'IDENTIFICACION', carpeta_id: null, nombre_visual: null, estatus: 'ACTIVO',
    });

    const result = await service.importCurrent(actor, expedienteId, 'COMPARECIENTE');

    expect(tx.expedienteDocumento.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'old-link-qa' }, data: expect.objectContaining({ documento_id: 'new-doc-qa' }),
    }));
    expect(tx.expedienteDocumento.create).toHaveBeenCalledWith({ data: expect.objectContaining({
      documento_id: 'old-doc-qa', document_version: 'old-version', estatus: 'SUSTITUIDO',
      motivo_inactivacion: expect.stringContaining('nueva versión'),
    }) });
    expect(result.import.updated).toBe(1);
  });
});
