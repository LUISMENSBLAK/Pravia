import { Prisma, PrismaClient, type ExpedienteEstatus } from '@prisma/client';
import type { Request } from 'express';
import { activeOrganizationMembershipWhere, organizationMembershipRoleSelect, usersWithEffectiveMembershipRoles } from '../auth/organizationMembership';
import { expedienteAccessWhere } from '../middleware/auth.middleware';
import {
  complianceAttention,
  complianceLabel,
  EXPEDIENTE_MACROPHASE_STATUSES,
  macrophaseForStatus,
  type ParsedExpedienteQuery,
} from '../domain/expedienteReadModel';

type AuthUser = NonNullable<Request['user']>;

const partyName = (link: any) => link?.compareciente?.personaFisica?.nombre_completo_calculado
  || link?.compareciente?.personaMoral?.razon_social
  || link?.compareciente?.nombre_busqueda
  || null;

const scopeWhere = (user: AuthUser): Prisma.ExpedienteWhereInput => ({ archived_at: null, ...expedienteAccessWhere(user) });

export class ExpedienteReadService {
  constructor(private readonly prisma: PrismaClient) {}

  private where(user: AuthUser, query: ParsedExpedienteQuery): Prisma.ExpedienteWhereInput {
    const AND: Prisma.ExpedienteWhereInput[] = [scopeWhere(user)];
    if (query.status) AND.push({ estatus: query.status });
    else if (query.macrophase) AND.push({ estatus: { in: EXPEDIENTE_MACROPHASE_STATUSES[query.macrophase] } });
    if (query.stage) AND.push({ etapaActual: { is: { nombre_snapshot: { equals: query.stage, mode: 'insensitive' } } } });
    if (query.responsibleId) AND.push({ abogado_id: query.responsibleId });
    if (query.notaryId) AND.push({ notaria_id: query.notaryId });
    if (query.actTypeId) AND.push({ tipo_acto_id: query.actTypeId });
    if (query.client) AND.push({ OR: [
      { cliente_alias: { contains: query.client, mode: 'insensitive' } },
      { comparecientes: { some: { archived_at: null, estatus: 'ACTIVO', compareciente: { nombre_busqueda: { contains: query.client, mode: 'insensitive' } } } } },
    ] });
    if (query.updatedFrom || query.updatedTo) AND.push({ updated_at: { gte: query.updatedFrom, lte: query.updatedTo } });
    if (query.risk === 'UNEVALUATED') AND.push({ complianceReviews: { none: { resultado_json: { not: Prisma.JsonNull } } } });
    if (query.risk === 'EVALUATED') AND.push({ complianceReviews: { some: { resultado_json: { not: Prisma.JsonNull } } } });
    if (query.risk === 'ATTENTION') AND.push({ complianceReviews: { some: { OR: [
      { resultado_json: { path: ['clasificacion'], equals: 'REQUIERE_AVISO' } },
      { resultado_json: { path: ['clasificacion'], equals: 'INCOMPLETO' } },
      { resultado_json: { path: ['clasificacion'], equals: 'INSUMOS_INCOMPLETOS' } },
    ] } } });
    if (query.search) {
      const term = query.search;
      AND.push({ OR: [
        { numero_pravia: { contains: term, mode: 'insensitive' } },
        { numero_notaria: { contains: term, mode: 'insensitive' } },
        { cliente_alias: { contains: term, mode: 'insensitive' } },
        { tipo_acto: { nombre: { contains: term, mode: 'insensitive' } } },
        { notaria: { is: { OR: [
          { numero_notaria: { contains: term, mode: 'insensitive' } },
          { nombre: { contains: term, mode: 'insensitive' } },
          { notario_titular: { contains: term, mode: 'insensitive' } },
        ] } } },
        { comparecientes: { some: { archived_at: null, estatus: 'ACTIVO', compareciente: { OR: [
          { nombre_busqueda: { contains: term, mode: 'insensitive' } },
          { personaFisica: { is: { OR: [
            { nombre_completo_calculado: { contains: term, mode: 'insensitive' } },
            { rfc: { contains: term, mode: 'insensitive' } },
            { curp: { contains: term, mode: 'insensitive' } },
          ] } } },
          { personaMoral: { is: { OR: [
            { razon_social: { contains: term, mode: 'insensitive' } },
            { rfc: { contains: term, mode: 'insensitive' } },
          ] } } },
        ] } } } },
      ] });
    }
    return { AND };
  }

  async list(user: AuthUser, query: ParsedExpedienteQuery) {
    const where = this.where(user, query);
    const [sortField, sortDirection] = query.sort.split(':') as ['numero_pravia' | 'updated_at', 'asc' | 'desc'];
    const baseScope = scopeWhere(user);
    const [records, total, grouped, actTypes, responsibles, notaries, stageRows] = await Promise.all([
      this.prisma.expediente.findMany({
        where,
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        orderBy: { [sortField]: sortDirection },
        include: {
          tipo_acto: { select: { id: true, nombre: true } },
          abogado: { select: { id: true, nombre: true, apellido: true } },
          notaria: { select: { id: true, nombre: true, numero_notaria: true, municipio: true } },
          etapaActual: { select: { id: true, clave_snapshot: true, nombre_snapshot: true, orden_snapshot: true, fecha_inicio: true } },
          comparecientes: {
            where: { archived_at: null, estatus: 'ACTIVO' },
            orderBy: [{ es_principal: 'desc' }, { orden_comparecencia: 'asc' }],
            include: { compareciente: { include: { personaFisica: true, personaMoral: true } }, caracter: true },
          },
          complianceReviews: { where: { resultado_json: { not: Prisma.JsonNull } }, orderBy: { updated_at: 'desc' }, take: 1, select: { id: true, tipo: true, estatus: true, resultado_json: true, updated_at: true } },
          _count: { select: { requisitos_docs: true, tareas: true, tareas_externas: true } },
        },
      }),
      this.prisma.expediente.count({ where }),
      this.prisma.expediente.groupBy({ by: ['estatus'], where: baseScope, _count: { _all: true } }),
      this.prisma.tipoActo.findMany({ where: { activo: true, archived_at: null }, select: { id: true, nombre: true, descripcion: true }, orderBy: { nombre: 'asc' } }),
      this.prisma.user.findMany({
        where: { activo: true, organizationMemberships: { some: activeOrganizationMembershipWhere(user.organizationId, ['DIRECCION', 'ADMINISTRACION', 'ABOGADO']) } },
        select: { id: true, nombre: true, apellido: true, ...organizationMembershipRoleSelect(user.organizationId) },
        orderBy: [{ nombre: 'asc' }, { apellido: 'asc' }],
      }),
      this.prisma.notaria.findMany({ where: { activa: true, archived_at: null }, select: { id: true, nombre: true, numero_notaria: true, municipio: true }, orderBy: [{ predeterminada: 'desc' }, { nombre: 'asc' }], take: 150 }),
      this.prisma.expedienteEtapa.findMany({ where: { expediente: baseScope }, distinct: ['nombre_snapshot'], select: { nombre_snapshot: true }, orderBy: { nombre_snapshot: 'asc' }, take: 100 }),
    ]);
    const counts = new Map<ExpedienteEstatus, number>(grouped.map((item) => [item.estatus, item._count._all]));
    const macroCount = (key: keyof typeof EXPEDIENTE_MACROPHASE_STATUSES) => EXPEDIENTE_MACROPHASE_STATUSES[key].reduce((sum, status) => sum + (counts.get(status) || 0), 0);
    const totalRecords = grouped.reduce((sum, item) => sum + item._count._all, 0);
    const mapped = records.map((record) => {
      const principal = record.comparecientes[0];
      const review = record.complianceReviews[0];
      return {
        id: record.id,
        numero_pravia: record.numero_pravia,
        numero_notaria: record.numero_notaria,
        cliente_alias: record.cliente_alias,
        estatus: record.estatus,
        version: record.version,
        etapa_actual_nombre: record.etapa_actual_nombre,
        proxima_accion: record.proxima_accion,
        fecha_limite_accion: record.fecha_limite_accion,
        fecha_estimada_firma: record.fecha_estimada_firma,
        fecha_real_firma: record.fecha_real_firma,
        fecha_entrega_cliente: record.fecha_entrega_cliente,
        created_at: record.created_at,
        updated_at: record.updated_at,
        tipo_acto: record.tipo_acto,
        abogado: record.abogado,
        notaria: record.notaria,
        etapaActual: record.etapaActual,
        counts: record._count,
        macrofase: macrophaseForStatus(record.estatus),
        cliente_principal: partyName(principal) || record.cliente_alias || 'Sin cliente',
        comparecientes_adicionales: Math.max(0, record.comparecientes.length - 1),
        riesgo: { label: complianceLabel(review?.resultado_json), requires_attention: complianceAttention(review?.resultado_json), review_id: review?.id || null },
      };
    });
    return {
      data: mapped,
      meta: { total, page: query.page, limit: query.pageSize, pageSize: query.pageSize, totalPages: Math.max(1, Math.ceil(total / query.pageSize)), hasPreviousPage: query.page > 1, hasNextPage: query.page * query.pageSize < total },
      metrics: [
        { key: 'INTEGRACION', label: 'Integración', value: macroCount('INTEGRACION') },
        { key: 'PROYECTO', label: 'Proyecto', value: macroCount('PROYECTO') },
        { key: 'FIRMA', label: 'Firma', value: macroCount('FIRMA') },
        { key: 'POSTFIRMA', label: 'Postfirma', value: macroCount('POSTFIRMA') },
        { key: 'ENTREGADO', label: 'Entregado', value: macroCount('ENTREGADO') },
        { key: 'TOTAL', label: 'Total expedientes', value: totalRecords },
      ].map((metric) => ({ ...metric, percentage: totalRecords > 0 && metric.key !== 'TOTAL' ? Math.round((metric.value / totalRecords) * 100) : null })),
      facets: { actTypes, responsibles: usersWithEffectiveMembershipRoles(responsibles), notaries, stages: stageRows.map((item) => item.nombre_snapshot) },
    };
  }
}
