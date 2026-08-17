import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NotariasService, NOTARIA_ACTIVE_EXPEDIENTE_STATUSES } from './notarias.service';
import { runWithActorContext, TEST_ORGANIZATION_ID } from '../auth/actorContext';

const actorContext = { userId: 'user-1', organizationId: TEST_ORGANIZATION_ID, membershipId: 'membership-1', role: 'ABOGADO' as const, permissions: [], scope: 'ASSIGNED_OBJECTS' as const, sessionId: 'session-1' };

const now = new Date('2026-08-12T18:00:00.000Z');
const prisma = {
  notaria: { findMany: vi.fn(), findFirst: vi.fn(), count: vi.fn() },
  expediente: { findMany: vi.fn(), count: vi.fn(), groupBy: vi.fn() },
  auditLog: { findMany: vi.fn() },
  user: { findMany: vi.fn() },
};

const row = {
  id: 'notaria-1', numero_notaria: '12', nombre: 'Notaría Pública 12', notario_titular: 'Lic. Ana Pérez',
  ciudad: null, municipio: 'Tepic', entidad_federativa: 'Nayarit', demarcacion: 'Tepic', activa: true,
  predeterminada: false, updated_at: now, telefono: '311 123 4567', whatsapp: '311 999 9999', correo_general: 'contacto@notaria.mx',
  correo_proyectos: null, contacto_principal: 'Recepción', contacto_principal_ref: null,
  contactos: [{ id: 'contact-1', nombre: 'Recepción', cargo: null, activo: true, telefono: '311 555 0000', whatsapp: '311 888 8888', correo: 'recepcion@notaria.mx' }],
  _count: { expedientes: 4, cotizaciones: 2 },
};

describe('NotariasService', () => {
  beforeEach(() => vi.clearAllMocks());

  it('pagina, busca y filtra por estado con los tres KPIs oficiales', async () => {
    prisma.notaria.findMany.mockResolvedValue([row]);
    prisma.notaria.count.mockResolvedValueOnce(1).mockResolvedValueOnce(6).mockResolvedValueOnce(2).mockResolvedValueOnce(3);
    const result = await new NotariasService(prisma as any).listPortfolio({ page: 2, pageSize: 20, search: 'Ana', estado: 'Nayarit', sort: 'numero:asc', expedienteScope: { abogado_id: 'user-1' } });
    const call = prisma.notaria.findMany.mock.calls[0][0];
    expect(call).toMatchObject({ skip: 20, take: 20, orderBy: [{ numero_notaria: 'asc' }, { nombre: 'asc' }] });
    expect(call.where.AND[0].OR).toEqual(expect.arrayContaining([
      expect.objectContaining({ numero_notaria: expect.any(Object) }),
      expect.objectContaining({ notario_titular: expect.any(Object) }),
      expect.objectContaining({ telefono: expect.any(Object) }),
      expect.objectContaining({ correo_general: expect.any(Object) }),
    ]));
    expect(result.data[0]).toMatchObject({ etiqueta: 'Notaría 12', titular: 'Lic. Ana Pérez', expedientes_activos: 4, contacto: { nombre: 'Recepción', telefono: '311 555 0000' } });
    expect(result.metrics).toEqual({ total: 6, nayarit: 2, jalisco: 3 });
    expect(result.facets).toEqual({ states: ['Nayarit', 'Jalisco'] });
    expect(result.meta).toMatchObject({ page: 2, pageSize: 20, hasPreviousPage: true });
  });

  it('conserva notarías legacy de otros estados solo dentro del total', async () => {
    const legacy = { ...row, id: 'legacy-1', entidad_federativa: 'Sonora', _count: { expedientes: 0, cotizaciones: 0 } };
    prisma.notaria.findMany.mockResolvedValue([legacy]);
    prisma.notaria.count.mockResolvedValueOnce(1).mockResolvedValueOnce(9).mockResolvedValueOnce(4).mockResolvedValueOnce(3);
    const result = await new NotariasService(prisma as any).listPortfolio({ page: 1, pageSize: 20, sort: 'numero:asc' });
    expect(result.metrics).toEqual({ total: 9, nayarit: 4, jalisco: 3 });
    expect(result.data[0].entidad_federativa).toBe('Sonora');
    expect(result.definitions.geography).toContain('todas las notarías registradas');
  });

  it('no convierte WhatsApp legacy en teléfono principal', async () => {
    prisma.notaria.findMany.mockResolvedValue([{ ...row, contacto_principal: null, telefono: null, contactos: [{ ...row.contactos[0], telefono: null }] }]);
    prisma.notaria.count.mockResolvedValueOnce(1).mockResolvedValueOnce(1).mockResolvedValueOnce(1).mockResolvedValueOnce(0);
    const result = await new NotariasService(prisma as any).listPortfolio({ page: 1, pageSize: 20, sort: 'numero:asc' });
    expect(result.data[0].contacto.telefono).toBeNull();
    expect(result.data[0].contacto).toMatchObject({ nombre: null, es_principal: false });
  });

  it('construye detalle con contactos, expedientes, responsables, firmas y actividad reales', async () => {
    prisma.notaria.findFirst.mockResolvedValue(row);
    prisma.expediente.count.mockResolvedValueOnce(4).mockResolvedValueOnce(9).mockResolvedValueOnce(7);
    prisma.expediente.findMany.mockResolvedValueOnce([{ id: 'exp-1', numero_pravia: 'EXP-1', updated_at: new Date('2026-08-13'), abogado: { id: 'user-1' }, gestor: null }]).mockResolvedValueOnce([{ id: 'exp-1', numero_pravia: 'EXP-1', fecha_estimada_firma: new Date('2026-08-20') }]);
    prisma.expediente.groupBy.mockResolvedValueOnce([{ abogado_id: 'user-1', _count: { _all: 4 } }]).mockResolvedValueOnce([]);
    prisma.auditLog.findMany.mockResolvedValue([{ id: 'audit-1', accion: 'EDITAR_NOTARIA', created_at: now, usuario: { nombre: 'Ana' } }]);
    prisma.user.findMany.mockResolvedValue([{ id: 'user-1', nombre: 'Ana', apellido: 'Ruiz', organizationMemberships: [{ rol: 'ABOGADO' }] }]);
    const detail = await runWithActorContext(actorContext, () => new NotariasService(prisma as any).detail('notaria-1', { abogado_id: 'user-1' }));
    expect(detail).toMatchObject({ etiqueta: 'Notaría 12', metrics: { activeCases: 4, historicalCases: 9, quotes: 2, upcomingSignatures: 7 }, responsables: [{ id: 'user-1', expedientes: 4 }] });
    expect(detail?.definitions).toMatchObject({ upcomingSignatures: expect.stringContaining('fecha estimada'), lastActivity: expect.stringContaining('fecha más reciente') });
    expect(prisma.expediente.findMany.mock.calls[0][0].where).toMatchObject({ notaria_id: 'notaria-1', abogado_id: 'user-1' });
    expect(prisma.expediente.count.mock.calls[0][0].where.estatus.in).toEqual(NOTARIA_ACTIVE_EXPEDIENTE_STATUSES);
  });

  it('pagina expedientes relacionados respetando el alcance recibido', async () => {
    prisma.expediente.findMany.mockResolvedValue([{ id: 'exp-1' }]); prisma.expediente.count.mockResolvedValue(1);
    const result = await new NotariasService(prisma as any).listCases('notaria-1', { page: 2, pageSize: 10, sort: 'updated_at:desc', expedienteScope: { gestor_id: 'user-2' } });
    expect(prisma.expediente.findMany).toHaveBeenCalledWith(expect.objectContaining({ skip: 10, take: 10, where: expect.objectContaining({ notaria_id: 'notaria-1', gestor_id: 'user-2' }) }));
    expect(result.meta).toMatchObject({ total: 1, page: 2, hasPreviousPage: true });
  });
});
