import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./supabase.service', () => ({
  fileExists: vi.fn(async () => true),
  getSignedUrl: vi.fn(async (key: string) => `http://storage.local/${key}`),
  downloadFile: vi.fn(async () => Buffer.from('virtual-document')),
}));

import { ExpedienteDocumentAppendixService } from './expedienteDocumentAppendix.service';

const actor = {
  id: 'user-1',
  organizationId: 'org-1',
  sessionId: 'session-1',
  rol: 'DIRECCION',
  permissions: [],
};

describe('ExpedienteDocumentAppendixService virtual source files', () => {
  let prisma: any;
  let service: ExpedienteDocumentAppendixService;

  beforeEach(() => {
    prisma = {
      expediente: { findFirst: vi.fn(async () => ({ id: 'exp-1', estatus: 'BORRADOR', version: 1 })) },
      expedienteDocumentoSnapshot: { findFirst: vi.fn(async () => null) },
      expedienteDocumento: { findFirst: vi.fn(async () => null) },
    };
    service = new ExpedienteDocumentAppendixService(prisma);
    (service as any).buildCandidates = vi.fn(async () => [{
      sourceKey: 'COTIZACION:COTIZACION:quote-1:document-1:QA_COMPARTIDO',
      origin: 'COTIZACION',
      sourceEntityType: 'COTIZACION',
      sourceEntityId: 'quote-1',
      sourceContext: 'QA_COMPARTIDO',
      sourceName: 'Cotización',
      document: {
        id: 'document-1',
        nombre_original: 'cotizacion.docx',
        tipo: 'DOCUMENTO',
        categoria: 'COTIZACION',
        storage_key: 'org-1/cotizacion.docx',
        mime_type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        size_bytes: 16,
        fecha_carga: new Date('2026-09-22T00:00:00.000Z'),
        estatus: 'VIGENTE',
      },
      documentVersion: 'version-1',
      incorporatedAt: new Date('2026-09-22T00:00:00.000Z'),
      provenance: {},
    }]);
  });

  it('returns a signed URL for a live Cotización candidate without copying its blob', async () => {
    const result = await service.signedUrl(
      actor,
      'exp-1',
      'COTIZACION:COTIZACION:quote-1:document-1:QA_COMPARTIDO',
    );

    expect(result).toEqual(expect.objectContaining({
      url: 'http://storage.local/org-1/cotizacion.docx',
      file_name: 'cotizacion.docx',
    }));
    expect(prisma.expedienteDocumento.findFirst).not.toHaveBeenCalled();
    expect(prisma.expediente.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: 'exp-1', organization_id: 'org-1' }),
    }));
  });

  it('downloads the same canonical blob for a virtual Cotización candidate', async () => {
    const result = await service.file(
      actor,
      'exp-1',
      'COTIZACION:COTIZACION:quote-1:document-1:QA_COMPARTIDO',
    );

    expect(result.name).toBe('cotizacion.docx');
    expect(result.buffer.toString()).toBe('virtual-document');
  });
});
