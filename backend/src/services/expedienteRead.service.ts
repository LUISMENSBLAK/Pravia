import { Prisma, PrismaClient, type ExpedienteEstatus } from '@prisma/client';
import type { Request } from 'express';
import { activeOrganizationMembershipWhere, organizationMembershipRoleSelect, usersWithEffectiveMembershipRoles } from '../auth/organizationMembership';
import { expedienteAccessWhere } from '../middleware/auth.middleware';
import { resolveCurrentOperationalActivity } from '../domain/expedienteOperationalStage';
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
    if (query.folio) AND.push({ numero_pravia: { contains: query.folio, mode: 'insensitive' } });
    if (query.status) AND.push({ estatus: query.status });
    else if (query.macrophase) AND.push({ estatus: { in: EXPEDIENTE_MACROPHASE_STATUSES[query.macrophase] } });
    if (query.responsibleId) AND.push({ abogado_id: query.responsibleId });
    if (query.notaryId) AND.push({ notaria_id: query.notaryId });
    if (query.actTypeId) AND.push({ actos: { some: { tipo_acto_id: query.actTypeId, estatus: 'ACTIVO', removed_at: null } } });
    if (query.client) AND.push({ OR: [
      { cliente_alias: { contains: query.client, mode: 'insensitive' } },
      { comparecientes: { some: { archived_at: null, estatus: 'ACTIVO', compareciente: { nombre_busqueda: { contains: query.client, mode: 'insensitive' } } } } },
    ] });
    if (query.updatedFrom || query.updatedTo) AND.push({ updated_at: { gte: query.updatedFrom, lte: query.updatedTo } });
    if (query.deedNumber) AND.push({ numero_escritura: { contains: query.deedNumber, mode: 'insensitive' } });
    if (query.deedDateFrom || query.deedDateTo) AND.push({ fecha_escritura: { gte: query.deedDateFrom, lte: query.deedDateTo } });
    if (query.risk === 'UNEVALUATED') AND.push({ complianceReviews: { none: { resultado_json: { not: Prisma.JsonNull } } } });
    if (query.risk === 'EVALUATED') AND.push({ complianceReviews: { some: { resultado_json: { not: Prisma.JsonNull } } } });
    if (query.risk === 'ATTENTION') AND.push({ complianceReviews: { some: { OR: [
      { resultado_json: { path: ['clasificacion'], equals: 'REQUIERE_AVISO' } },
      { resultado_json: { path: ['clasificacion'], equals: 'INCOMPLETO' } },
      { resultado_json: { path: ['clasificacion'], equals: 'INSUMOS_INCOMPLETOS' } },
    ] } } });
    if (query.compliance === 'UNEVALUATED') AND.push({ complianceStates: { none: {} } });
    if (query.compliance === 'COMPLETE') AND.push({ complianceStates: { some: { state: 'CUMPLIMIENTO_COMPLETO' } } });
    if (query.compliance === 'OVERDUE') AND.push({ complianceStates: { some: { state: 'VENCIDO' } } });
    if (query.compliance === 'PENDING') AND.push({ complianceStates: { some: { state: { in: ['PENDIENTE', 'EN_PROCESO', 'LISTO'] } } } });
    if (query.search) {
      const term = query.search;
      AND.push({ OR: [
        { numero_pravia: { contains: term, mode: 'insensitive' } },
        { numero_notaria: { contains: term, mode: 'insensitive' } },
        { cliente_alias: { contains: term, mode: 'insensitive' } },
        { actos: { some: { estatus: 'ACTIVO', removed_at: null, tipo_acto: { nombre: { contains: term, mode: 'insensitive' } } } } },
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
    const [sortField, sortDirection] = query.sort.split(':') as ['numero_pravia' | 'updated_at' | 'numero_escritura' | 'fecha_escritura', 'asc' | 'desc'];
    const baseScope = scopeWhere(user);
    const [records, total, grouped, actTypes, responsibles, notaries] = await Promise.all([
      this.prisma.expediente.findMany({
        where,
        skip: query.stage ? 0 : (query.page - 1) * query.pageSize,
        take: query.stage ? undefined : query.pageSize,
        orderBy: { [sortField]: sortDirection },
        include: {
          actos: { where: { estatus: 'ACTIVO', removed_at: null }, include: { tipo_acto: { select: { id: true, nombre: true } } }, orderBy: { created_at: 'asc' } },
          abogado: { select: { id: true, nombre: true, apellido: true } },
          notaria: { select: { id: true, nombre: true, numero_notaria: true, municipio: true } },
          etapaActual: { select: { id: true, clave_snapshot: true, nombre_snapshot: true, orden_snapshot: true, fecha_inicio: true } },
          comparecientes: {
            where: { archived_at: null, estatus: 'ACTIVO' },
            orderBy: [{ es_principal: 'desc' }, { orden_comparecencia: 'asc' }],
            include: { compareciente: { include: { personaFisica: true, personaMoral: true } }, caracter: true },
          },
          complianceReviews: { where: { resultado_json: { not: Prisma.JsonNull } }, orderBy: { updated_at: 'desc' }, take: 1, select: { id: true, tipo: true, estatus: true, resultado_json: true, updated_at: true } },
          complianceStates: { orderBy: { updated_at: 'desc' }, take: 1, select: {
            state: true, pending_count: true,
            currentReview: { select: { legalRuleResults: { where: { vulnerable_activity: true }, take: 1, select: { id: true } } } },
          } },
          _count: { select: { requisitos_docs: true, tareas: true, tareas_externas: true } },
        },
      }),
      this.prisma.expediente.count({ where }),
      this.prisma.expediente.groupBy({ by: ['estatus'], where: baseScope, _count: { _all: true } }),
      this.prisma.tipoActo.findMany({ where: { activo: true, archived_at: null, OR: [{ organization_id: null }, { organization_id: user.organizationId }], configuracionesOperativas: { some: { organization_id: user.organizationId, activa: true } } }, select: { id: true, nombre: true, descripcion: true }, orderBy: { nombre: 'asc' } }),
      this.prisma.user.findMany({
        where: { activo: true, organizationMemberships: { some: activeOrganizationMembershipWhere(user.organizationId, ['DIRECCION', 'ADMINISTRACION', 'ABOGADO']) } },
        select: { id: true, nombre: true, apellido: true, ...organizationMembershipRoleSelect(user.organizationId) },
        orderBy: [{ nombre: 'asc' }, { apellido: 'asc' }],
      }),
      this.prisma.notaria.findMany({ where: { organization_id: user.organizationId, activa: true, archived_at: null }, select: { id: true, nombre: true, numero_notaria: true, municipio: true }, orderBy: [{ predeterminada: 'desc' }, { nombre: 'asc' }], take: 150 }),
    ]);
    const tracking = records.length ? await this.prisma.expedienteSeguimientoActividad.findMany({
      where: { organization_id: user.organizationId, expediente_id: { in: records.map((record) => record.id) }, en_alcance: true },
      orderBy: [{ etapa_orden_snapshot: 'asc' }, { orden_operativo: 'asc' }, { created_at: 'asc' }],
    }) : [];
    const dependencies = records.length ? await this.prisma.expedienteSeguimientoDependencia.findMany({
      where: { organization_id: user.organizationId, expediente_id: { in: records.map((record) => record.id) }, bloqueante: true },
    }) : [];
    const trackingByExpediente = new Map<string, typeof tracking>();
    tracking.forEach((item) => trackingByExpediente.set(item.expediente_id, [...(trackingByExpediente.get(item.expediente_id) || []), item]));
    const dependencyByActivity = new Map<string, typeof dependencies>();
    dependencies.forEach((item) => dependencyByActivity.set(item.actividad_id, [...(dependencyByActivity.get(item.actividad_id) || []), item]));
    const operationalStage = (expedienteId: string) => {
      const rows = trackingByExpediente.get(expedienteId) || [];
      const current = resolveCurrentOperationalActivity(rows, rows.flatMap((item) => dependencyByActivity.get(item.id) || []));
      return current ? { id: current.id, nombre: current.actividad_nombre_snapshot, etapa: current.etapa_nombre_snapshot, estado: current.estado } : null;
    };
    const counts = new Map<ExpedienteEstatus, number>(grouped.map((item) => [item.estatus, item._count._all]));
    const macroCount = (key: keyof typeof EXPEDIENTE_MACROPHASE_STATUSES) => EXPEDIENTE_MACROPHASE_STATUSES[key].reduce((sum, status) => sum + (counts.get(status) || 0), 0);
    const totalRecords = grouped.reduce((sum, item) => sum + item._count._all, 0);
    const mapped = records.map((record) => {
      const principal = record.comparecientes[0];
      const review = record.complianceReviews[0];
      const complianceState = record.complianceStates[0];
      const primaryAct = record.actos[0]?.tipo_acto || { id: '', nombre: 'Sin acto activo' };
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
        fecha_estimada_entrega: record.fecha_estimada_entrega,
        fecha_escritura: record.fecha_escritura,
        created_at: record.created_at,
        updated_at: record.updated_at,
        numero_escritura: record.numero_escritura,
        folio_desde: record.folio_desde,
        folio_hasta: record.folio_hasta,
        tipo_acto: primaryAct,
        actos: record.actos,
        abogado: record.abogado,
        notaria: record.notaria,
        etapaActual: record.etapaActual,
        counts: record._count,
        macrofase: macrophaseForStatus(record.estatus),
        cliente_principal: partyName(principal) || record.cliente_alias || 'Sin cliente',
        comparecientes_adicionales: Math.max(0, record.comparecientes.length - 1),
        riesgo: { label: complianceLabel(review?.resultado_json), requires_attention: complianceAttention(review?.resultado_json), review_id: review?.id || null },
        vulnerable: user.permissions.includes('compliance.read')
          ? { value: complianceState ? Boolean(complianceState.currentReview?.legalRuleResults.length) : null, label: complianceState ? (complianceState.currentReview?.legalRuleResults.length ? 'Sí' : 'No') : 'Sin evaluar' }
          : { value: null, label: 'Restringido' },
        cumplimiento: user.permissions.includes('compliance.read')
          ? { state: complianceState?.state || null, label: complianceState?.state === 'CUMPLIMIENTO_COMPLETO' ? 'Completo' : complianceState?.state === 'VENCIDO' ? 'Vencido' : complianceState ? 'Pendiente' : 'Sin evaluar', pending_count: complianceState?.pending_count || 0 }
          : { state: null, label: 'Restringido', pending_count: 0 },
        etapa_operativa: operationalStage(record.id),
      };
    });
    const filteredMapped = query.stage
      ? mapped.filter((item) => item.etapa_operativa?.nombre.localeCompare(query.stage!, 'es-MX', { sensitivity: 'base' }) === 0)
      : mapped;
    const visibleMapped = query.stage
      ? filteredMapped.slice((query.page - 1) * query.pageSize, query.page * query.pageSize)
      : filteredMapped;
    const effectiveTotal = query.stage ? filteredMapped.length : total;
    return {
      data: visibleMapped,
      meta: { total: effectiveTotal, page: query.page, limit: query.pageSize, pageSize: query.pageSize, totalPages: Math.max(1, Math.ceil(effectiveTotal / query.pageSize)), hasPreviousPage: query.page > 1, hasNextPage: query.page * query.pageSize < effectiveTotal },
      metrics: [
        { key: 'INTEGRACION', label: 'Integración', value: macroCount('INTEGRACION') },
        { key: 'PROYECTO', label: 'Proyecto', value: macroCount('PROYECTO') },
        { key: 'FIRMA', label: 'Firma', value: macroCount('FIRMA') },
        { key: 'POSTFIRMA', label: 'Postfirma', value: macroCount('POSTFIRMA') },
        { key: 'ENTREGADO', label: 'Entregado', value: macroCount('ENTREGADO') },
        { key: 'TOTAL', label: 'Total expedientes', value: totalRecords },
      ].map((metric) => ({ ...metric, percentage: totalRecords > 0 && metric.key !== 'TOTAL' ? Math.round((metric.value / totalRecords) * 100) : null })),
      facets: { actTypes, responsibles: usersWithEffectiveMembershipRoles(responsibles), notaries, stages: [...new Set(tracking.map((item) => item.actividad_nombre_snapshot))].sort((a, b) => a.localeCompare(b, 'es-MX')) },
    };
  }
}
