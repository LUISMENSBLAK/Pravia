import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NotariasService, NOTARIA_ACTIVE_EXPEDIENTE_STATUSES } from './notarias.service';

const now = new Date('2026-08-12T18:00:00.000Z');
const prisma = {
  notaria: { findMany: vi.fn(), findFirst: vi.fn(), count: vi.fn(), groupBy: vi.fn() },
  expediente: { findMany: vi.fn(), count: vi.fn(), groupBy: vi.fn() },
  auditLog: { findMany: vi.fn() },
  user: { findMany: vi.fn() },
};

const row = {
  id: 'notaria-1', numero_notaria: '12', nombre: 'Notaría Pública 12', notario_titular: 'Lic. Ana Pérez',
  ciudad: null, municipio: 'Tepic', entidad_federativa: 'Nayarit', demarcacion: 'Tepic', activa: true,
  predeterminada: false, updated_at: now, telefono: '311 123 4567', whatsapp: null, correo_general: 'contacto@notaria.mx',
  correo_proyectos: null, contacto_principal: 'Recepción', contactos: [{ nombre: 'Recepción', activo: true, telefono: '311 555 0000', correo: 'recepcion@notaria.mx' }],
  _count: { expedientes: 4, cotizaciones: 2 },
};

describe('NotariasService', () => {
  beforeEach(() => vi.clearAllMocks());

  it('pagina, busca, filtra y ordena con métricas y distribución geográfica reales', async () => {
    prisma.notaria.findMany.mockResolvedValueOnce([row]).mockResolvedValueOnce([{ municipio: 'Tepic', ciudad: null }]);
    prisma.notaria.count.mockResolvedValueOnce(1).mockResolvedValueOnce(3).mockResolvedValueOnce(2).mockResolvedValueOnce(1).mockResolvedValueOnce(1);
    prisma.notaria.groupBy.mockResolvedValue([{ entidad_federativa: 'Nayarit', _count: { _all: 3 } }]);
    const result = await new NotariasService(prisma as any).listPortfolio({ page: 2, pageSize: 20, search: 'Ana', estado: 'Nayarit', ciudad: 'Tepic', estatus: 'ACTIVA', conExpedientesActivos: true, sort: 'titular:asc', expedienteScope: { abogado_id: 'user-1' } });
    const call = prisma.notaria.findMany.mock.calls[0][0];
    expect(call).toMatchObject({ skip: 20, take: 20, orderBy: [{ notario_titular: 'asc' }, { nombre: 'asc' }] });
    expect(call.where.AND).toHaveLength(2);
    expect(call.where.expedientes.some).toMatchObject({ abogado_id: 'user-1', estatus: { in: NOTARIA_ACTIVE_EXPEDIENTE_STATUSES } });
    expect(result.data[0]).toMatchObject({ etiqueta: 'Notaría 12', titular: 'Lic. Ana Pérez', expedientes_activos: 4, estatus: 'ACTIVA', contacto: { nombre: 'Recepción', telefono: '311 555 0000' } });
    expect(result.metrics).toEqual({ total: 3, active: 2, inactive: 1, withActiveCases: 1 });
    expect(result.distribution).toMatchObject({ criterion: 'ENTIDAD_FEDERATIVA', total: 3, items: [{ label: 'Nayarit', value: 3, percentage: 100 }] });
    expect(result.meta).toMatchObject({ page: 2, pageSize: 20, hasPreviousPage: true });
  });

  it('agrega top cinco y Otros sin inventar regiones', async () => {
    prisma.notaria.findMany.mockResolvedValueOnce([]).mockResolvedValueOnce([]);
    prisma.notaria.count.mockResolvedValueOnce(0).mockResolvedValueOnce(10).mockResolvedValueOnce(8).mockResolvedValueOnce(2).mockResolvedValueOnce(0);
    prisma.notaria.groupBy.mockResolvedValue(['A','B','C','D','E','F'].map((state, index) => ({ entidad_federativa: state, _count: { _all: index === 5 ? 5 : 1 } })));
    const result = await new NotariasService(prisma as any).listPortfolio({ page: 1, pageSize: 20, sort: 'numero:asc' });
    expect(result.distribution.items.at(-1)).toMatchObject({ label: 'Otros', value: 5, percentage: 50 });
    expect(result.distribution.criterion).toBe('ENTIDAD_FEDERATIVA');
  });

  it('construye detalle con contactos, expedientes, responsables, firmas y actividad reales', async () => {
    prisma.notaria.findFirst.mockResolvedValue(row);
    prisma.expediente.count.mockResolvedValueOnce(4).mockResolvedValueOnce(9).mockResolvedValueOnce(7);
    prisma.expediente.findMany.mockResolvedValueOnce([{ id: 'exp-1', numero_pravia: 'EXP-1', updated_at: new Date('2026-08-13'), abogado: { id: 'user-1' }, gestor: null }]).mockResolvedValueOnce([{ id: 'exp-1', numero_pravia: 'EXP-1', fecha_estimada_firma: new Date('2026-08-20') }]);
    prisma.expediente.groupBy.mockResolvedValueOnce([{ abogado_id: 'user-1', _count: { _all: 4 } }]).mockResolvedValueOnce([]);
    prisma.auditLog.findMany.mockResolvedValue([{ id: 'audit-1', accion: 'EDITAR_NOTARIA', created_at: now, usuario: { nombre: 'Ana' } }]);
    prisma.user.findMany.mockResolvedValue([{ id: 'user-1', nombre: 'Ana', apellido: 'Ruiz', rol: 'ABOGADO' }]);
    const detail = await new NotariasService(prisma as any).detail('notaria-1', { abogado_id: 'user-1' });
    expect(detail).toMatchObject({ etiqueta: 'Notaría 12', estatus: 'ACTIVA', metrics: { activeCases: 4, historicalCases: 9, quotes: 2, upcomingSignatures: 7 }, responsables: [{ id: 'user-1', expedientes: 4 }] });
    expect(detail?.definitions).toMatchObject({
      upcomingSignatures: expect.stringContaining('fecha estimada'),
      lastActivity: expect.stringContaining('fecha más reciente'),
    });
    expect(prisma.expediente.findMany.mock.calls[0][0].where).toMatchObject({ notaria_id: 'notaria-1', abogado_id: 'user-1' });
  });

  it('pagina expedientes relacionados respetando el alcance recibido', async () => {
    prisma.expediente.findMany.mockResolvedValue([{ id: 'exp-1' }]); prisma.expediente.count.mockResolvedValue(1);
    const result = await new NotariasService(prisma as any).listCases('notaria-1', { page: 2, pageSize: 10, sort: 'updated_at:desc', expedienteScope: { gestor_id: 'user-2' } });
    expect(prisma.expediente.findMany).toHaveBeenCalledWith(expect.objectContaining({ skip: 10, take: 10, where: expect.objectContaining({ notaria_id: 'notaria-1', gestor_id: 'user-2' }) }));
    expect(result.meta).toMatchObject({ total: 1, page: 2, hasPreviousPage: true });
  });
});
