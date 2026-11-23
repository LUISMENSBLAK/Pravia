import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Prisma } from '@prisma/client';
const mocks = vi.hoisted(() => ({ extract: vi.fn(), download: vi.fn() }));
vi.mock('./openaiDocument.service', () => ({ extraerMultiplesDocumentos: mocks.extract, missingApplicableComparecienteFields: () => [] }));
vi.mock('./supabase.service', () => ({ downloadFile: mocks.download }));
import { ComparecienteService } from './compareciente.service';

describe('Compareciente: persistencia tras extracción pagada', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.download.mockResolvedValue(Buffer.from('synthetic document'));
    mocks.extract.mockResolvedValue({ proveedor: 'QA', modelo: 'synthetic', campos: [{ campo: 'ocupacion', valor: 'ARQUITECTA', documento_id: 'doc', confianza: 'LECTURA_CLARA' }], alertas: [] });
  });
  const setup = () => {
    const tx = { $executeRaw: vi.fn(), comparecienteDatoFuente: { create: vi.fn() }, auditLog: { findFirst: vi.fn().mockResolvedValue(null), create: vi.fn() } };
    const db = { comparecienteDocumento: { findMany: vi.fn().mockResolvedValue([{ categoria: 'OTRO', documento: { id: 'doc', storage_key: 'local/source', mime_type: 'image/png', nombre_original: 'source.png' } }]) },
      compareciente: { findFirst: vi.fn().mockResolvedValue({ tipo_persona: 'FISICA' }) }, $transaction: vi.fn(async (callback) => callback(tx)) };
    return { db, tx, service: new ComparecienteService(db as any) };
  };
  const actor = { id: 'actor', organizationId: 'org', membershipId: 'member', rol: 'ADMINISTRACION', permissions: ['ia.execute'], scope: 'GLOBAL', sessionId: 'session' } as any;
  it('reintenta únicamente la persistencia revertida, sin otra llamada IA', async () => {
    const { db, tx, service } = setup();
    db.$transaction.mockRejectedValueOnce(new Prisma.PrismaClientKnownRequestError('expired', { code: 'P2028', clientVersion: '5.22.0' }));
    const result = await service.extraerDocumentosExistentesConIA('party', actor, 'request');
    expect(result.values.ocupacion).toBe('ARQUITECTA');
    expect(mocks.extract).toHaveBeenCalledTimes(1);
    expect(db.$transaction).toHaveBeenCalledTimes(2);
    expect(db.$transaction).toHaveBeenLastCalledWith(expect.any(Function), { maxWait: 10_000, timeout: 20_000 });
    expect(tx.comparecienteDatoFuente.create).toHaveBeenCalledTimes(1);
    expect(tx.auditLog.create).toHaveBeenCalledTimes(1);
  });
  it('no reintenta un defecto distinto ni modifica la ficha maestra', async () => {
    const { db, service } = setup();
    db.$transaction.mockRejectedValueOnce(new Error('unexpected'));
    await expect(service.extraerDocumentosExistentesConIA('party', actor, 'request')).rejects.toThrow('unexpected');
    expect(mocks.extract).toHaveBeenCalledTimes(1); expect(db.$transaction).toHaveBeenCalledTimes(1);
  });
});
