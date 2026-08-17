import { beforeEach, describe, expect, it, vi } from 'vitest';

const service = vi.hoisted(() => ({ listPortfolio: vi.fn(), detail: vi.fn(), listCases: vi.fn() }));
const db = vi.hoisted(() => ({ notaria: { findFirst: vi.fn(), findUnique: vi.fn() }, notariaContacto: { findFirst: vi.fn() }, $transaction: vi.fn() }));
vi.mock('../services/notarias.service', () => ({ NotariasService: class { listPortfolio = service.listPortfolio; detail = service.detail; listCases = service.listCases; } }));
vi.mock('../config/prisma', () => ({ default: db }));

import { addNotariaContacto, createNotaria, getNotariaById, getNotariaExpedientes, getNotarias, setNotariaContactoPrincipal, updateNotaria } from './notarias.controller';

const response = () => { const res: any = {}; res.status = vi.fn(() => res); res.json = vi.fn(() => res); return res; };
const user = { id: 'user-1', rol: 'ABOGADO', permissions: ['notarias.read'], email: 'a@b.mx', nombre: 'Ana', apellido: 'Ruiz', sessionId: 's', requiresPasswordChange: false };

describe('Notarías endpoints', () => {
  beforeEach(() => vi.clearAllMocks());

  it('propaga solo paginación, búsqueda, estado y alcance al portafolio', async () => {
    service.listPortfolio.mockResolvedValue({ data: [], metrics: {}, meta: {} });
    const req: any = { query: { portfolio: 'true', page: '2', pageSize: '10', search: '12', estado: 'Nayarit', ciudad: 'Tepic', estatus: 'ACTIVA', con_expedientes_activos: 'true', sort: 'titular:desc' }, user };
    const res = response(); await getNotarias(req, res);
    expect(service.listPortfolio).toHaveBeenCalledWith({ page: 2, pageSize: 10, search: '12', estado: 'Nayarit', sort: 'numero:asc', expedienteScope: { OR: [{ abogado_id: 'user-1' }, { creador_id: 'user-1' }] } });
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('carga detalle y expedientes relacionados con el alcance real del usuario', async () => {
    service.detail.mockResolvedValue({ id: 'notaria-1' });
    const detailReq: any = { params: { id: 'notaria-1' }, user }; const detailRes = response(); await getNotariaById(detailReq, detailRes);
    expect(service.detail).toHaveBeenCalledWith('notaria-1', { OR: [{ abogado_id: 'user-1' }, { creador_id: 'user-1' }] });
    db.notaria.findFirst.mockResolvedValue({ id: 'notaria-1' }); service.listCases.mockResolvedValue({ data: [], meta: {} });
    const listReq: any = { params: { id: 'notaria-1' }, query: { page: '2', pageSize: '8' }, user }; const listRes = response(); await getNotariaExpedientes(listReq, listRes);
    expect(service.listCases).toHaveBeenCalledWith('notaria-1', expect.objectContaining({ page: 2, pageSize: 8, expedienteScope: { OR: [{ abogado_id: 'user-1' }, { creador_id: 'user-1' }] } }));
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

  it('permite contacto sin cargo y lo establece como principal de forma auditable', async () => {
    db.notaria.findFirst.mockResolvedValue({ id: 'notaria-1' });
    const tx = { notariaContacto: { create: vi.fn().mockResolvedValue({ id: 'contact-1', nombre: 'Ana', cargo: null }) }, notaria: { update: vi.fn().mockResolvedValue({}) }, auditLog: { create: vi.fn().mockResolvedValue({}) } };
    db.$transaction.mockImplementation(async (callback: any) => callback(tx));
    const req: any = { params: { id: 'notaria-1' }, body: { nombre: 'Ana', principal: true }, user, correlationId: '11111111-1111-4111-8111-111111111111' };
    const res = response(); await addNotariaContacto(req, res);
    expect(tx.notariaContacto.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ cargo: null }) }));
    expect(tx.notaria.update).toHaveBeenCalledWith(expect.objectContaining({ data: { contacto_principal_id: 'contact-1', contacto_principal: 'Ana' } }));
    expect(tx.auditLog.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ accion: 'CAMBIAR_CONTACTO_PRINCIPAL_NOTARIA' }) }));
  });

  it('rechaza asignar como principal un contacto de otra notaría', async () => {
    db.notariaContacto.findFirst.mockResolvedValue(null);
    const req: any = { params: { id: 'notaria-1', contactId: 'contact-other' }, user, correlationId: '11111111-1111-4111-8111-111111111111' };
    const res = response(); await setNotariaContactoPrincipal(req, res);
    expect(res.status).toHaveBeenCalledWith(404);
    expect(db.$transaction).not.toHaveBeenCalled();
  });

  it('audita por separado cambios de horario y tiempos operativos', async () => {
    const existing = {
      id: 'notaria-1', numero_notaria: null, nombre: 'Notaría 12', notario_titular: null, entidad_federativa: 'Nayarit', municipio: 'Tepic', demarcacion: null,
      direccion: null, codigo_postal: null, telefono: null, whatsapp: null, correo_general: null, correo_proyectos: null, pagina_web: null,
      contacto_principal: null, contacto_principal_id: null, horario: null, horario_semanal: null, dias_atencion: null,
      dias_respuesta_estimados: 5, dias_presupuesto_estimados: null, dias_firma_estimados: null, tiempo_respuesta: null, tiempo_presupuesto: null, tiempo_firma: null,
      instrucciones_especiales: null, observaciones_generales: null, requisitos_frecuentes: null, activa: true, predeterminada: false,
      color_identificador: '#D4AF37', tipos_acto_json: [], instituciones_json: [], municipios_atendidos_json: [], archived_at: null, updated_at: new Date(),
    };
    db.notaria.findUnique.mockResolvedValueOnce(existing).mockResolvedValueOnce({ ...existing, dias_respuesta_estimados: 7 });
    const tx = { notaria: { update: vi.fn().mockResolvedValue({ ...existing, dias_respuesta_estimados: 7 }) }, auditLog: { create: vi.fn().mockResolvedValue({}) } };
    db.$transaction.mockImplementation(async (callback: any) => callback(tx));
    const req: any = { params: { id: 'notaria-1' }, body: { horario_semanal: { lunes: { cerrado: false, apertura: '09:00', cierre: '17:00' } }, dias_respuesta_estimados: 7, dias_presupuesto_estimados: 3 }, user, correlationId: '11111111-1111-4111-8111-111111111111' };
    const res = response(); await updateNotaria(req, res);
    const actions = tx.auditLog.create.mock.calls.map(([entry]: any[]) => entry.data.accion);
    expect(actions).toEqual(expect.arrayContaining(['EDITAR_NOTARIA', 'CONFIGURAR_HORARIO_NOTARIA', 'CONFIGURAR_TIEMPOS_NOTARIA']));
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ dias_respuesta_estimados: 7 }));
  });
});
