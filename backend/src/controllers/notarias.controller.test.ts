import { beforeEach, describe, expect, it, vi } from 'vitest';

const service = vi.hoisted(() => ({ listPortfolio: vi.fn(), detail: vi.fn(), listCases: vi.fn() }));
const db = vi.hoisted(() => ({ notaria: { findFirst: vi.fn() }, $transaction: vi.fn() }));
vi.mock('../services/notarias.service', () => ({ NotariasService: class { listPortfolio = service.listPortfolio; detail = service.detail; listCases = service.listCases; } }));
vi.mock('../config/prisma', () => ({ default: db }));

import { addNotariaContacto, createNotaria, getNotariaById, getNotariaExpedientes, getNotarias } from './notarias.controller';

const response = () => { const res: any = {}; res.status = vi.fn(() => res); res.json = vi.fn(() => res); return res; };
const user = { id: 'user-1', rol: 'ABOGADO', permissions: ['notarias.read'], email: 'a@b.mx', nombre: 'Ana', apellido: 'Ruiz', sessionId: 's', requiresPasswordChange: false };

describe('Notarías endpoints', () => {
  beforeEach(() => vi.clearAllMocks());

  it('propaga paginación, búsqueda, filtros, sort y alcance de expedientes al portafolio', async () => {
    service.listPortfolio.mockResolvedValue({ data: [], metrics: {}, distribution: {}, meta: {} });
    const req: any = { query: { portfolio: 'true', page: '2', pageSize: '10', search: '12', estado: 'Nayarit', ciudad: 'Tepic', estatus: 'ACTIVA', con_expedientes_activos: 'true', sort: 'titular:desc' }, user };
    const res = response(); await getNotarias(req, res);
    expect(service.listPortfolio).toHaveBeenCalledWith(expect.objectContaining({ page: 2, pageSize: 10, search: '12', estado: 'Nayarit', ciudad: 'Tepic', estatus: 'ACTIVA', conExpedientesActivos: true, sort: 'titular:desc', expedienteScope: { OR: [{ abogado_id: 'user-1' }, { creado_por_id: 'user-1' }] } }));
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('carga detalle y expedientes relacionados con el alcance real del usuario', async () => {
    service.detail.mockResolvedValue({ id: 'notaria-1' });
    const detailReq: any = { params: { id: 'notaria-1' }, user }; const detailRes = response(); await getNotariaById(detailReq, detailRes);
    expect(service.detail).toHaveBeenCalledWith('notaria-1', { OR: [{ abogado_id: 'user-1' }, { creado_por_id: 'user-1' }] });
    db.notaria.findFirst.mockResolvedValue({ id: 'notaria-1' }); service.listCases.mockResolvedValue({ data: [], meta: {} });
    const listReq: any = { params: { id: 'notaria-1' }, query: { page: '2', pageSize: '8' }, user }; const listRes = response(); await getNotariaExpedientes(listReq, listRes);
    expect(service.listCases).toHaveBeenCalledWith('notaria-1', expect.objectContaining({ page: 2, pageSize: 8, expedienteScope: { OR: [{ abogado_id: 'user-1' }, { creado_por_id: 'user-1' }] } }));
  });

  it('impide duplicar número dentro de la misma entidad y demarcación', async () => {
    db.notaria.findFirst.mockResolvedValue({ id: 'existing' });
    const req: any = { body: { numero_notaria: '12', nombre: 'Notaría Pública 12', entidad_federativa: 'Nayarit', demarcacion: 'Tepic' }, user };
    const res = response(); await createNotaria(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ error: expect.stringContaining('Ya existe') }));
    expect(db.$transaction).not.toHaveBeenCalled();
  });

  it('agrega un contacto auditable sin inventar su cargo', async () => {
    db.notaria.findFirst.mockResolvedValue({ id: 'notaria-1' });
    const tx = { notariaContacto: { create: vi.fn().mockResolvedValue({ id: 'contact-1', nombre: 'Recepción', cargo: 'Recepción' }) }, auditLog: { create: vi.fn().mockResolvedValue({}) } };
    db.$transaction.mockImplementation(async (callback: any) => callback(tx));
    const req: any = { params: { id: 'notaria-1' }, body: { nombre: 'Recepción', cargo: 'Recepción', correo: 'recepcion@notaria.mx' }, user, correlationId: '11111111-1111-4111-8111-111111111111' };
    const res = response(); await addNotariaContacto(req, res);
    expect(tx.notariaContacto.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ cargo: 'Recepción' }) }));
    expect(tx.auditLog.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ accion: 'AGREGAR_CONTACTO_NOTARIA', entidad: 'Notaria' }) }));
    expect(res.status).toHaveBeenCalledWith(201);
  });
});
