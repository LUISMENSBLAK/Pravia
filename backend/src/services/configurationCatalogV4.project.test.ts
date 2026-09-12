import { beforeEach, describe, expect, it, vi } from 'vitest';

const db = vi.hoisted(() => ({
  catalogoArtefacto: { findFirst: vi.fn() }, documento: { findFirst: vi.fn() }, notaria: { findMany: vi.fn() },
  $transaction: vi.fn(),
}));
const storage = vi.hoisted(() => ({ downloadFile: vi.fn(), uploadFile: vi.fn(), deleteFile: vi.fn() }));
vi.mock('../config/prisma', () => ({ default: db }));
vi.mock('./supabase.service', () => storage);

import { configurationCatalogV4Service } from './configurationCatalogV4.service';

const actor: any = { id: 'user-1', organizationId: 'org-1', sessionId: 'session-1' };

describe('CFG-002 integración explícita con EXP-010', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    db.catalogoArtefacto.findFirst.mockResolvedValue(null);
    db.documento.findFirst.mockResolvedValue({ id: 'project-v1', organization_id: 'org-1', expediente_id: 'case-1', tipo: 'PROYECTO_ESCRITURA', estatus: 'VIGENTE', storage_key: 'private/project.docx', nombre_original: 'Proyecto compraventa.docx', mime_type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', checksum_sha256: 'source-sha' });
    db.notaria.findMany.mockResolvedValue([{ id: 'notary-1', nombre: 'Notaría', numero_notaria: '1', activa: true, predeterminada: true, created_at: new Date() }]);
    storage.downloadFile.mockResolvedValue(Buffer.from('project'));
    storage.uploadFile.mockResolvedValue(undefined);
    storage.deleteFile.mockResolvedValue(undefined);
  });

  it('no crea nada por consultar y sólo promueve tras la acción explícita', async () => {
    expect(db.$transaction).not.toHaveBeenCalled();
    const tx: any = {
      $executeRaw: vi.fn(), catalogoArtefacto: { findFirst: vi.fn().mockResolvedValue(null), create: vi.fn().mockResolvedValue({ id: 'artifact-1' }) },
      catalogoArtefactoVersion: { create: vi.fn().mockResolvedValue({ id: 'version-1' }) }, auditLog: { create: vi.fn() },
    };
    db.$transaction.mockImplementation((callback: any) => callback(tx));
    const result = await configurationCatalogV4Service.saveProjectAsNotaryTemplate(actor, 'case-1', 'project-v1');
    expect(result).toEqual({ artifact_id: 'artifact-1', version_id: 'version-1', idempotent: false });
    expect(tx.catalogoArtefacto.create).toHaveBeenCalledWith({ data: expect.objectContaining({ tipo: 'PLANTILLA', propietario_tipo: 'NOTARIA', notaria_id: 'notary-1', codigo_biblioteca: 'EXP010:project-v1' }) });
    expect(tx.catalogoArtefactoVersion.create).toHaveBeenCalledWith({ data: expect.objectContaining({ origen: 'EXP010_PROJECT_PROMOTION', checksum_sha256: 'source-sha' }) });
    expect(tx.auditLog.create).toHaveBeenCalled();
  });

  it('rechaza un proyecto de otra organización sin leer ni copiar el blob', async () => {
    db.documento.findFirst.mockResolvedValue(null);
    await expect(configurationCatalogV4Service.saveProjectAsNotaryTemplate(actor, 'case-1', 'foreign')).rejects.toMatchObject({ code: 'CFG002_PROJECT_ACCESS_DENIED' });
    expect(storage.downloadFile).not.toHaveBeenCalled();
    expect(storage.uploadFile).not.toHaveBeenCalled();
  });

  it('es idempotente para la misma versión de proyecto', async () => {
    db.catalogoArtefacto.findFirst.mockResolvedValue({ id: 'artifact-existing', versiones: [{ id: 'version-existing' }] });
    await expect(configurationCatalogV4Service.saveProjectAsNotaryTemplate(actor, 'case-1', 'project-v1')).resolves.toEqual({ artifact_id: 'artifact-existing', version_id: 'version-existing', idempotent: true });
    expect(storage.uploadFile).not.toHaveBeenCalled();
  });
});
