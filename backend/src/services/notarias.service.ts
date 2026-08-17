import { Prisma, PrismaClient, type ExpedienteEstatus } from '@prisma/client';

export const NOTARIA_ACTIVE_EXPEDIENTE_STATUSES: ExpedienteEstatus[] = [
  'ABIERTO', 'EN_INTEGRACION', 'EN_PROCESO', 'PENDIENTE_CLIENTE', 'PENDIENTE_NOTARIA',
  'FIRMA_PROGRAMADA', 'FIRMADO', 'POST_FIRMA', 'LISTO_ENTREGA', 'SUSPENDIDO',
];

export type NotariaPortfolioQuery = {
  page: number;
  pageSize: number;
  search?: string;
  estado?: string;
  sort: 'numero:asc' | 'numero:desc' | 'titular:asc' | 'titular:desc' | 'updated_at:asc' | 'updated_at:desc';
  expedienteScope?: Prisma.ExpedienteWhereInput;
};

const activeExpedientesWhere = (scope: Prisma.ExpedienteWhereInput = {}): Prisma.ExpedienteWhereInput => ({
  archived_at: null,
  estatus: { in: NOTARIA_ACTIVE_EXPEDIENTE_STATUSES },
  ...scope,
});

const allExpedientesWhere = (scope: Prisma.ExpedienteWhereInput = {}): Prisma.ExpedienteWhereInput => ({
  archived_at: null,
  ...scope,
});

const primaryContact = (record: any) => {
  const referenced = record.contacto_principal_ref?.activo ? record.contacto_principal_ref : null;
  const named = record.contactos?.find((contact: any) => contact.activo && record.contacto_principal
    && contact.nombre.localeCompare(record.contacto_principal, 'es', { sensitivity: 'base' }) === 0);
  const contact = referenced || named;
  return {
    id: contact?.id || null,
    nombre: contact?.nombre || record.contacto_principal || null,
    cargo: contact?.cargo || null,
    telefono: contact?.telefono || record.telefono || null,
    correo: contact?.correo || record.correo_general || record.correo_proyectos || null,
    es_principal: Boolean(referenced || named || record.contacto_principal),
  };
};

const label = (record: any) => record.numero_notaria ? `Notaría ${record.numero_notaria}` : record.nombre;

export class NotariasService {
  constructor(private readonly prisma: PrismaClient) {}

  async listPortfolio(query: NotariaPortfolioQuery) {
    const expedienteScope = query.expedienteScope || {};
    const filters: Prisma.NotariaWhereInput[] = [];
    if (query.search) filters.push({ OR: [
      { numero_notaria: { contains: query.search, mode: 'insensitive' } },
      { nombre: { contains: query.search, mode: 'insensitive' } },
      { notario_titular: { contains: query.search, mode: 'insensitive' } },
      { ciudad: { contains: query.search, mode: 'insensitive' } },
      { municipio: { contains: query.search, mode: 'insensitive' } },
      { entidad_federativa: { contains: query.search, mode: 'insensitive' } },
      { telefono: { contains: query.search, mode: 'insensitive' } },
      { correo_general: { contains: query.search, mode: 'insensitive' } },
      { correo_proyectos: { contains: query.search, mode: 'insensitive' } },
      { contactos: { some: { activo: true, OR: [
        { nombre: { contains: query.search, mode: 'insensitive' } },
        { telefono: { contains: query.search, mode: 'insensitive' } },
        { correo: { contains: query.search, mode: 'insensitive' } },
      ] } } },
    ] });
    const listWhere: Prisma.NotariaWhereInput = {
      archived_at: null,
      ...(filters.length ? { AND: filters } : {}),
      ...(query.estado ? { entidad_federativa: { equals: query.estado, mode: 'insensitive' } } : {}),
    };
    const baseWhere: Prisma.NotariaWhereInput = { archived_at: null };
    const [sortField, sortDirection] = query.sort.split(':') as [string, 'asc' | 'desc'];
    const orderBy: Prisma.NotariaOrderByWithRelationInput = sortField === 'numero'
      ? { numero_notaria: sortDirection }
      : sortField === 'titular'
        ? { notario_titular: sortDirection }
        : { updated_at: sortDirection };

    const [records, total, totalAll, nayarit, jalisco] = await Promise.all([
      this.prisma.notaria.findMany({
        where: listWhere,
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        orderBy: [orderBy, { nombre: 'asc' }],
        include: {
          contacto_principal_ref: true,
          contactos: { where: { activo: true }, orderBy: { created_at: 'asc' } },
          _count: { select: { expedientes: { where: activeExpedientesWhere(expedienteScope) } } },
        },
      }),
      this.prisma.notaria.count({ where: listWhere }),
      this.prisma.notaria.count({ where: baseWhere }),
      this.prisma.notaria.count({ where: { ...baseWhere, entidad_federativa: { equals: 'Nayarit', mode: 'insensitive' } } }),
      this.prisma.notaria.count({ where: { ...baseWhere, entidad_federativa: { equals: 'Jalisco', mode: 'insensitive' } } }),
    ]);

    return {
      data: records.map((record: any) => ({
        id: record.id,
        numero_notaria: record.numero_notaria,
        nombre: record.nombre,
        etiqueta: label(record),
        titular: record.notario_titular,
        ciudad: record.ciudad || record.municipio || null,
        municipio: record.municipio,
        entidad_federativa: record.entidad_federativa,
        demarcacion: record.demarcacion,
        contacto: primaryContact(record),
        expedientes_activos: record._count.expedientes,
        estatus: record.activa ? 'ACTIVA' : 'INACTIVA',
        predeterminada: record.predeterminada,
        updated_at: record.updated_at,
      })),
      metrics: { total: totalAll, nayarit, jalisco },
      facets: { states: ['Nayarit', 'Jalisco'] },
      meta: {
        total, page: query.page, limit: query.pageSize, pageSize: query.pageSize,
        totalPages: Math.max(1, Math.ceil(total / query.pageSize)),
        hasPreviousPage: query.page > 1,
        hasNextPage: query.page * query.pageSize < total,
      },
      definitions: {
        activeCases: 'Expedientes no archivados cuyo estatus no es Entregado ni Cancelado, dentro del alcance del usuario.',
        geography: 'Los conteos de Nayarit y Jalisco usan la entidad federativa registrada; Total conserva todas las notarías registradas, sin limitar la entidad federativa.',
      },
    };
  }

  async detail(id: string, expedienteScope: Prisma.ExpedienteWhereInput = {}) {
    const scope = allExpedientesWhere(expedienteScope);
    const activeScope = activeExpedientesWhere(expedienteScope);
    const now = new Date();
    const [record, activeCount, historicalCount, recentCases, upcomingSignatureCount, upcomingSignatures, lawyerGroups, managerGroups, activity] = await Promise.all([
      this.prisma.notaria.findFirst({
        where: { id, archived_at: null },
        include: { contacto_principal_ref: true, contactos: { orderBy: [{ activo: 'desc' }, { created_at: 'asc' }] }, _count: { select: { cotizaciones: true } } },
      }),
      this.prisma.expediente.count({ where: { notaria_id: id, ...activeScope } }),
      this.prisma.expediente.count({ where: { notaria_id: id, ...scope } }),
      this.prisma.expediente.findMany({
        where: { notaria_id: id, ...scope }, take: 8, orderBy: { updated_at: 'desc' },
        select: { id: true, numero_pravia: true, cliente_alias: true, estatus: true, etapa_actual_nombre: true, updated_at: true, tipo_acto: { select: { nombre: true } }, abogado: { select: { id: true, nombre: true, apellido: true } }, gestor: { select: { id: true, nombre: true, apellido: true } } },
      }),
      this.prisma.expediente.count({
        where: { notaria_id: id, ...activeScope, fecha_estimada_firma: { gte: now } },
      }),
      this.prisma.expediente.findMany({
        where: { notaria_id: id, ...activeScope, fecha_estimada_firma: { gte: now } }, take: 5, orderBy: { fecha_estimada_firma: 'asc' },
        select: { id: true, numero_pravia: true, fecha_estimada_firma: true, cliente_alias: true },
      }),
      this.prisma.expediente.groupBy({ by: ['abogado_id'], where: { notaria_id: id, ...scope }, _count: { _all: true } }),
      this.prisma.expediente.groupBy({ by: ['gestor_id'], where: { notaria_id: id, ...scope, gestor_id: { not: null } }, _count: { _all: true } }),
      this.prisma.auditLog.findMany({ where: { entidad: 'Notaria', entidad_id: id }, orderBy: { created_at: 'desc' }, take: 20, include: { usuario: { select: { id: true, nombre: true, apellido: true } } } }),
    ]);
    if (!record) return null;
    const userIds = Array.from(new Set([
      ...(lawyerGroups as any[]).map((item) => item.abogado_id),
      ...(managerGroups as any[]).map((item) => item.gestor_id),
    ].filter(Boolean)));
    const users = userIds.length ? await this.prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, nombre: true, apellido: true, rol: true } }) : [];
    const counts = new Map<string, number>();
    [...(lawyerGroups as any[]), ...(managerGroups as any[])].forEach((item) => {
      const userId = item.abogado_id || item.gestor_id;
      if (userId) counts.set(userId, (counts.get(userId) || 0) + item._count._all);
    });
    const lastCaseUpdate = recentCases[0]?.updated_at;
    const lastActivity = lastCaseUpdate && new Date(lastCaseUpdate) > new Date(record.updated_at) ? lastCaseUpdate : record.updated_at;
    return {
      ...record,
      _count: { cotizaciones: record._count.cotizaciones, expedientes: historicalCount },
      etiqueta: label(record),
      titular: record.notario_titular,
      estatus: record.activa ? 'ACTIVA' : 'INACTIVA',
      contacto: primaryContact(record),
      metrics: { activeCases: activeCount, historicalCases: historicalCount, quotes: record._count.cotizaciones, upcomingSignatures: upcomingSignatureCount, lastActivity },
      expedientes: recentCases,
      proximasFirmas: upcomingSignatures,
      responsables: users.map((user: any) => ({ ...user, expedientes: counts.get(user.id) || 0 })).sort((a: any, b: any) => b.expedientes - a.expedientes),
      actividad: activity,
      definitions: {
        activeCases: 'Expedientes no archivados cuyo estatus no es Entregado ni Cancelado, dentro del alcance del usuario.',
        historicalCases: 'Todos los expedientes no archivados vinculados a la notaría y dentro del alcance del usuario, sin importar su estatus.',
        upcomingSignatures: 'Expedientes activos con fecha estimada de firma igual o posterior al momento de consulta. Es una fecha programada, no una firma realizada.',
        lastActivity: 'La fecha más reciente entre la actualización de la ficha de la notaría y la actualización de sus expedientes visibles.',
      },
    };
  }

  async listCases(id: string, options: { page: number; pageSize: number; sort: 'updated_at:asc' | 'updated_at:desc'; expedienteScope?: Prisma.ExpedienteWhereInput }) {
    const where: Prisma.ExpedienteWhereInput = { notaria_id: id, ...allExpedientesWhere(options.expedienteScope || {}) };
    const direction = options.sort.endsWith(':asc') ? 'asc' : 'desc';
    const [data, total] = await Promise.all([
      this.prisma.expediente.findMany({
        where, skip: (options.page - 1) * options.pageSize, take: options.pageSize, orderBy: { updated_at: direction },
        select: { id: true, numero_pravia: true, cliente_alias: true, estatus: true, etapa_actual_nombre: true, updated_at: true, tipo_acto: { select: { nombre: true } }, abogado: { select: { id: true, nombre: true, apellido: true } }, gestor: { select: { id: true, nombre: true, apellido: true } } },
      }),
      this.prisma.expediente.count({ where }),
    ]);
    return { data, meta: { total, page: options.page, pageSize: options.pageSize, totalPages: Math.max(1, Math.ceil(total / options.pageSize)), hasPreviousPage: options.page > 1, hasNextPage: options.page * options.pageSize < total } };
  }
}
