import { beforeEach, describe, expect, it, vi } from 'vitest';

const storage = vi.hoisted(() => ({ uploadFile: vi.fn(), getSignedUrl: vi.fn(), deleteFile: vi.fn() }));
const access = vi.hoisted(() => ({ canAttachDocumento: vi.fn() }));
const audit = vi.hoisted(() => ({ logAudit: vi.fn() }));
const db = vi.hoisted(() => ({ $transaction: vi.fn(), prospectoDocumento: { findMany: vi.fn() }, documento: { findMany: vi.fn() } }));
vi.mock('../config/prisma', () => ({ default: db }));
vi.mock('../services/supabase.service', () => storage);
vi.mock('../services/objectAccess.service', () => access);
vi.mock('../utils/auditLogger', () => audit);

import { getProspectoDocumentos, uploadDocumento } from './documentos.controller';

const response = () => { const res: any = {}; res.status = vi.fn(() => res); res.json = vi.fn(() => res); return res; };
const user = { id: 'user-1', rol: 'ABOGADO', permissions: ['documentos.write'] };

describe('documentos de Prospectos', () => {
  beforeEach(() => { vi.clearAllMocks(); storage.uploadFile.mockResolvedValue('private/object.pdf'); access.canAttachDocumento.mockResolvedValue(true); audit.logAudit.mockResolvedValue(undefined); });

  it.each([
    ['PREDIAL', { tiene_predial: true }],
    ['ANTECEDENTE', { tiene_antecedente: true }],
  ])('vincula %s al prospecto y actualiza su indicador en la misma transacción', async (tipo, expectedFlag) => {
    const tx = {
      documento: { create: vi.fn().mockResolvedValue({ id: 'doc-1' }), findUniqueOrThrow: vi.fn().mockResolvedValue({ id: 'doc-1', nombre_original: 'archivo.pdf' }) },
      prospectoDocumento: { create: vi.fn().mockResolvedValue({}) },
      prospecto: { update: vi.fn().mockResolvedValue({}) },
      cotizacionDocumento: { create: vi.fn() }, expedienteDocumento: { create: vi.fn() }, comparecienteDocumento: { create: vi.fn() },
    };
    db.$transaction.mockImplementation(async (callback: any) => callback(tx));
    const req: any = { user, file: { originalname: 'archivo.pdf', buffer: Buffer.from('pdf'), mimetype: 'application/pdf', size: 3 }, body: { tipo, prospecto_id: 'prospect-1' } };
    const res = response();
    await uploadDocumento(req, res);
    expect(tx.prospectoDocumento.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ prospecto_id: 'prospect-1', tipo_vinculo: tipo }) }));
    expect(tx.prospecto.update).toHaveBeenCalledWith({ where: { id: 'prospect-1' }, data: expectedFlag });
    expect(audit.logAudit).toHaveBeenCalledWith('user-1', 'UPLOAD', 'Documento', 'doc-1', expect.objectContaining({ prospecto_id: 'prospect-1', tipo }));
    expect(res.status).toHaveBeenCalledWith(201);
  });

  it('rechaza el vínculo antes de tocar Storage cuando falla object access', async () => {
    access.canAttachDocumento.mockResolvedValue(false);
    const req: any = { user, file: { originalname: 'archivo.pdf', buffer: Buffer.from('pdf'), mimetype: 'application/pdf', size: 3 }, body: { tipo: 'PREDIAL', prospecto_id: 'otro-prospecto' } };
    const res = response();
    await uploadDocumento(req, res);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(storage.uploadFile).not.toHaveBeenCalled();
  });

  it('lista vínculos activos y conserva documentos directos legacy sin duplicarlos', async () => {
    const date = new Date('2026-08-16T12:00:00Z');
    db.prospectoDocumento.findMany.mockResolvedValue([{ tipo_vinculo: 'PREDIAL', documento: { id: 'doc-1', tipo: 'OTRO', fecha_carga: date } }]);
    db.documento.findMany.mockResolvedValue([{ id: 'doc-1', tipo: 'OTRO', fecha_carga: date }, { id: 'legacy-doc', tipo: 'ANTECEDENTE', fecha_carga: new Date('2026-08-15T12:00:00Z') }]);
    const res = response();
    await getProspectoDocumentos({ params: { id: 'prospect-1' } } as any, res);
    const payload = res.json.mock.calls[0][0];
    expect(payload).toHaveLength(2);
    expect(payload[0]).toMatchObject({ id: 'doc-1', tipo: 'PREDIAL' });
    expect(payload[1]).toMatchObject({ id: 'legacy-doc' });
  });
});
