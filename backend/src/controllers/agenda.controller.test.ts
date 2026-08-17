import { beforeEach, describe, expect, it, vi } from 'vitest';

const db = vi.hoisted(() => ({
  user: { findFirst: vi.fn(), findMany: vi.fn() },
  eventoAgenda: { findMany: vi.fn(), findFirst: vi.fn() },
  expediente: { findMany: vi.fn(), findFirst: vi.fn() },
  compareciente: { findMany: vi.fn(), findFirst: vi.fn() },
  auditLog: { findMany: vi.fn() },
  $transaction: vi.fn(),
}));
vi.mock('../config/prisma', () => ({ default: db }));

import { AgendaController } from './agenda.controller';

const response = () => { const res: any = {}; res.status = vi.fn(() => res); res.json = vi.fn(() => res); return res; };
const baseUser = {
  id: 'user-1', rol: 'ABOGADO', permissions: ['agenda.read', 'agenda.write', 'expedientes.read', 'comparecientes.read'],
  email: 'ana@pravia.mx', nombre: 'Ana', apellido: 'Ruiz', sessionId: 'session-1', requiresPasswordChange: false,
  organizationId: '00000000-0000-4000-8000-000000000010', membershipId: 'membership-1', scope: 'ASSIGNED_OBJECTS',
};
const event = {
  id: 'event-1', titulo: 'Firma de escritura', descripcion: null, tipo: 'FIRMA', estatus: 'ACTIVO',
  fecha_inicio: new Date('2026-08-19T15:00:00.000Z'), fecha_fin: new Date('2026-08-19T16:00:00.000Z'),
  todo_el_dia: false, user_id: 'user-1', expediente_id: 'exp-1', compareciente_id: null,
  recordatorios: [15], usuario: { id: 'user-1', nombre: 'Ana', apellido: 'Ruiz' }, compareciente: null,
  expediente: { id: 'exp-1', numero_pravia: 'EXP-1', cliente_alias: 'Cliente', estatus: 'FIRMA_PROGRAMADA', fecha_estimada_firma: new Date('2026-08-19T15:00:00.000Z'), fecha_real_firma: null, tipo_acto: { id: 'act-1', nombre: 'Compraventa' }, notaria: { id: 'notaria-1', numero_notaria: '12', nombre: 'Notaría 12', ciudad: 'Tepic', municipio: 'Tepic', entidad_federativa: 'Nayarit' } },
  created_at: new Date(), updated_at: new Date(),
};

describe('Agenda endpoints', () => {
  beforeEach(() => vi.clearAllMocks());

  it('limita la agenda de un abogado a su usuario y a expedientes visibles', async () => {
    db.eventoAgenda.findMany.mockResolvedValue([event]);
    const req: any = { query: { desde: '2026-08-18T06:00:00.000Z', hasta: '2026-08-25T05:59:59.999Z', estatus: 'TODOS' }, user: baseUser };
    const res = response(); await AgendaController.list(req, res);
    expect(db.eventoAgenda.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ user_id: 'user-1', AND: expect.any(Array) }) }));
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ eventos: [expect.objectContaining({ id: 'event-1', notaria: expect.objectContaining({ id: 'notaria-1' }), firma: expect.objectContaining({ efectiva: null }) })], meta: expect.objectContaining({ timezone: 'America/Mexico_City' }) }));
  });

  it('detecta conflictos reales sin bloquear automáticamente', async () => {
    db.user.findFirst.mockResolvedValue({ id: 'user-1' });
    db.eventoAgenda.findMany.mockResolvedValue([event]);
    const req: any = { query: { responsable_id: 'user-1', desde: '2026-08-19T15:30:00.000Z', hasta: '2026-08-19T16:30:00.000Z' }, user: baseUser };
    const res = response(); await AgendaController.conflicts(req, res);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ conflictos: [expect.objectContaining({ id: 'event-1' })], meta: expect.objectContaining({ total: 1, blocking: false }) }));
  });

  it('aplica scope de comparecientes y expone catálogos operativos sin nombres hardcodeados', async () => {
    db.user.findMany.mockResolvedValue([{ id: 'user-1', nombre: 'Ana', apellido: 'Ruiz', organizationMemberships: [{ rol: 'ABOGADO' }] }]);
    db.expediente.findMany.mockResolvedValue([]); db.compareciente.findMany.mockResolvedValue([]);
    const req: any = { query: {}, user: baseUser }; const res = response(); await AgendaController.catalogs(req, res);
    expect(db.user.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ activo: true, id: 'user-1', organizationMemberships: { some: expect.objectContaining({ organization_id: baseUser.organizationId }) } }) }));
    expect(db.compareciente.findMany.mock.calls[0][0].where.OR).toBeDefined();
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ catalogos: expect.objectContaining({ timezone: 'America/Mexico_City', permisos: { gestionar_equipo: false, escribir: true } }) }));
  });

  it('exige expediente para una firma programada y conserva fecha efectiva separada', async () => {
    db.user.findFirst.mockResolvedValue({ id: 'user-1' });
    const req: any = { body: { titulo: 'Firma de escritura', tipo: 'FIRMA', fecha_inicio: '2026-08-19T15:00:00.000Z', fecha_fin: '2026-08-19T16:00:00.000Z' }, user: baseUser };
    const res = response(); await AgendaController.create(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ code: 'AGENDA_SIGNATURE_CASE_REQUIRED' }));
    expect(db.$transaction).not.toHaveBeenCalled();
  });
});
