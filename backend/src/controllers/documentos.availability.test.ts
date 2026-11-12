import { beforeEach, describe, expect, it, vi } from 'vitest';
const mock = vi.hoisted(() => ({ find: vi.fn(), head: vi.fn(), signed: vi.fn() }));
vi.mock('../config/prisma', () => ({ default: { documento: { findFirst: mock.find } } }));
vi.mock('../storage/storage.service', () => ({ headFile: mock.head }));
vi.mock('../services/supabase.service', () => ({ getSignedUrl: mock.signed }));
import { getDocumentoUrl } from './documentos.controller';
const req: any = { params: { id: 'document-qa' }, user: { organizationId: 'organization-qa' } };
const response = (): any => { const res: any = {}; res.status = vi.fn(() => res); res.json = vi.fn(() => res); return res; };
describe('disponibilidad física de documentos · sin ocultar referencias', () => {
  beforeEach(() => { vi.resetAllMocks(); mock.find.mockResolvedValue({ id: 'document-qa', storage_key: 'private/qa.pdf' }); });
  it('no publica un enlace de éxito si falta el objeto; no altera ni borra registros', async () => {
    mock.head.mockResolvedValue(null); const res = response(); await getDocumentoUrl(req, res);
    expect(mock.find).toHaveBeenCalledWith({ where: { id: 'document-qa', organization_id: 'organization-qa' } });
    expect(res.status).toHaveBeenCalledWith(404); expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ code: 'DOCUMENT_FILE_UNAVAILABLE' }));
    expect(mock.signed).not.toHaveBeenCalled();
  });
  it('distingue indisponibilidad del proveedor de ausencia física sin exponer detalles', async () => {
    mock.head.mockRejectedValue(new Error('private-provider-secret')); const res = response(); await getDocumentoUrl(req, res);
    expect(res.status).toHaveBeenCalledWith(503); expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ code: 'DOCUMENT_STORAGE_UNAVAILABLE' }));
    expect(JSON.stringify(res.json.mock.calls)).not.toContain('private-provider-secret'); expect(mock.signed).not.toHaveBeenCalled();
  });
  it('devuelve la URL privada del objeto existente', async () => {
    mock.head.mockResolvedValue({ size: 100 }); mock.signed.mockResolvedValue('https://private.example.test/qa'); const res = response();
    await getDocumentoUrl(req, res); expect(res.json).toHaveBeenCalledWith({ url: 'https://private.example.test/qa' });
  });
  it('no consulta el objeto si no existe un documento autorizado', async () => {
    mock.find.mockResolvedValue(null); const res = response(); await getDocumentoUrl(req, res);
    expect(res.status).toHaveBeenCalledWith(404); expect(mock.head).not.toHaveBeenCalled();
  });
});
