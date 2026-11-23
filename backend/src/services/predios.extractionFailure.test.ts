import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ extract: vi.fn(), access: vi.fn(), download: vi.fn() }));
vi.mock('./objectAccess.service', () => ({ predioObjectWhere: vi.fn(), canAccessDocumento: mocks.access }));
vi.mock('./supabase.service', () => ({ downloadFile: mocks.download }));
vi.mock('./openaiDocument.service', () => ({ extraerPredioDesdeDocumento: mocks.extract }));
import { PrediosService } from './predios.service';
import { PlatformDomainError } from '../platform/platform.errors';

const actor = { id: 'actor', organizationId: 'org', permissions: ['expedientes.write', 'ia.execute'] } as any;
const source = { documento_id: 'doc', estatus: 'ACTIVO', vigencia: 'VIGENTE', tipo_vinculo: 'TITULO',
  documento: { storage_key: 'private/title', mime_type: 'application/pdf', nombre_original: 'titulo.pdf' } };

describe('Predios: errores reales de extracción', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.access.mockResolvedValue(true);
    mocks.download.mockResolvedValue(Buffer.from('synthetic-document'));
  });
  const setup = () => {
    const prisma = { $transaction: vi.fn() };
    const service = new PrediosService(prisma as any);
    vi.spyOn(service, 'get').mockResolvedValue({ documentos: [source] } as any);
    return { service, prisma };
  };
  it.each(['AI_EXTERNAL_DISABLED', 'AI_BALANCE_EXHAUSTED', 'AI_OPERATION_DISABLED'])('no atribuye %s a un archivo corrupto', async (code) => {
    const { service, prisma } = setup();
    mocks.extract.mockRejectedValue(new PlatformDomainError(code, 'Revisa la configuración de IA.', 503));
    await expect(service.proposeFromDocument(actor, 'property', ['doc'], 'request')).rejects.toMatchObject({ code, status: 503 });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
  it('no devuelve éxito si ninguna fuente pudo leerse', async () => {
    const { service, prisma } = setup();
    mocks.extract.mockRejectedValue(new Error('Unreadable'));
    await expect(service.proposeFromDocument(actor, 'property', ['doc'], 'request')).rejects.toMatchObject({ code: 'PREDIO_AI_NO_READABLE_SOURCE', status: 422 });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
  it('deniega documentos sin acceso antes de descargar o invocar IA', async () => {
    const { service } = setup();
    mocks.access.mockResolvedValue(false);
    await expect(service.proposeFromDocument(actor, 'property', ['doc'], 'request')).rejects.toMatchObject({ code: 'PREDIO_AI_SOURCE_DENIED' });
    expect(mocks.download).not.toHaveBeenCalled();
    expect(mocks.extract).not.toHaveBeenCalled();
  });
});
