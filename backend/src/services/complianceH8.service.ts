import { Prisma, type PrismaClient } from '@prisma/client';
import type { Request } from 'express';
import prisma from '../config/prisma';
import { expedienteAccessWhere } from '../middleware/auth.middleware';

type User = NonNullable<Request['user']>;
export const H8_FILTERS = ['TODOS', 'INCOMPLETOS', 'AVISOS_PENDIENTES', 'POR_VENCER', 'VENCIDOS', 'PRESENTADOS', 'COMPLETOS'] as const;
export type H8Filter = typeof H8_FILTERS[number];

export type H8PanelQuery = {
  filter: H8Filter;
  search: string;
  lawyerId: string;
  actId: string;
  notaryId: string;
  from: Date | null;
  toExclusive: Date | null;
  page: number;
  pageSize: number;
};

type PanelSqlRow = {
  state_id: string;
  expediente_id: string;
  current_review_id: string | null;
  urgency_bucket: string;
  next_due: Date | null;
  notice_count: bigint | number;
  notice_pending_count: bigint | number;
  notice_presented_count: bigint | number;
  notice_fulfilled_count: bigint | number;
  notice_overdue_count: bigint | number;
  vulnerable: boolean;
};

const asNumber = (value: bigint | number | null | undefined) => Number(value || 0);
const dateParam = (value: unknown, endExclusive = false) => {
  const text = String(value || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return null;
  const date = new Date(`${text}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) return null;
  if (endExclusive) date.setUTCDate(date.getUTCDate() + 1);
  return date;
};

export function parseH8PanelQuery(input: Record<string, unknown>): H8PanelQuery {
  const candidate = String(input.filter || 'TODOS').toUpperCase();
  return {
    filter: (H8_FILTERS as readonly string[]).includes(candidate) ? candidate as H8Filter : 'TODOS',
    search: String(input.search || '').trim().slice(0, 160),
    lawyerId: String(input.lawyer_id || '').trim(),
    actId: String(input.act_id || '').trim(),
    notaryId: String(input.notaria_id || '').trim(),
    from: dateParam(input.from),
    toExclusive: dateParam(input.to, true),
    page: Math.max(1, Math.min(10_000, Number(input.page) || 1)),
    pageSize: Math.max(10, Math.min(100, Number(input.page_size) || 25)),
  };
}

const accessSql = (user: User) => {
  if (['DIRECCION', 'ADMINISTRACION', 'CONSULTA'].includes(user.rol)) return Prisma.empty;
  if (user.rol === 'ABOGADO') return Prisma.sql`AND (e.abogado_id = ${user.id}::uuid OR e.creador_id = ${user.id}::uuid)`;
  if (user.rol === 'GESTORIA') return Prisma.sql`AND (
    e.gestor_id = ${user.id}::uuid
    OR EXISTS (SELECT 1 FROM tareas t WHERE t.expediente_id = e.id AND t.asignado_a_id = ${user.id}::uuid AND t.estatus <> 'CANCELADA')
    OR EXISTS (SELECT 1 FROM tareas_externas te WHERE te.expediente_id = e.id AND te.gestionado_por_id = ${user.id}::uuid)
  )`;
  if (user.rol === 'RECEPCION') return Prisma.sql`AND e.estatus IN ('LISTO_ENTREGA', 'ENTREGADO')`;
  return Prisma.sql`AND false`;
};

const filterSql = (filter: H8Filter) => ({
  TODOS: Prisma.empty,
  INCOMPLETOS: Prisma.sql`AND compliance_state IN ('PENDIENTE', 'EN_PROCESO', 'LISTO', 'VENCIDO')`,
  AVISOS_PENDIENTES: Prisma.sql`AND notice_pending_count > 0`,
  POR_VENCER: Prisma.sql`AND urgency_bucket = 'POR_VENCER'`,
  VENCIDOS: Prisma.sql`AND urgency_bucket = 'VENCIDO'`,
  PRESENTADOS: Prisma.sql`AND notice_presented_count > 0`,
  COMPLETOS: Prisma.sql`AND compliance_state IN ('CUMPLIMIENTO_COMPLETO', 'NO_APLICA')`,
}[filter]);

const panelCte = (user: User, query: H8PanelQuery, now: Date) => {
  const dayStart = new Date(now); dayStart.setUTCHours(0, 0, 0, 0);
  const nextDay = new Date(dayStart); nextDay.setUTCDate(nextDay.getUTCDate() + 1);
  const search = query.search ? `%${query.search.replace(/[\\%_]/g, '\\$&')}%` : '';
  return Prisma.sql`
    WITH panel_base AS (
      SELECT s.id AS state_id, s.expediente_id, s.current_review_id,
        s.state::text AS compliance_state, s.pending_count,
        EXISTS (
          SELECT 1 FROM compliance_rule_results rr
          WHERE rr.organization_id = ${user.organizationId}::uuid
            AND rr.review_id = s.current_review_id
            AND rr.vulnerable_activity = true
        ) AS vulnerable,
        LEAST(s.next_deadline, notices.next_notice_due) AS next_due,
        notices.notice_count, notices.notice_pending_count, notices.notice_presented_count,
        notices.notice_fulfilled_count, notices.notice_overdue_count,
        COALESCE(alerts.has_critical, false) AS has_critical,
        COALESCE(alerts.has_warning, false) AS has_warning
      FROM expediente_compliance_states s
      JOIN expedientes e ON e.id = s.expediente_id
      LEFT JOIN LATERAL (
        SELECT
          COUNT(*) FILTER (WHERE o.avi_state <> 'NO_APLICA') AS notice_count,
          COUNT(*) FILTER (WHERE o.avi_state IN ('PENDIENTE','INFORMACION_INCOMPLETA','VALIDADO','LISTO_PARA_PRESENTAR','PRESENTADO','ACUSE_CARGADO')) AS notice_pending_count,
          COUNT(*) FILTER (WHERE o.avi_state = 'PRESENTADO') AS notice_presented_count,
          COUNT(*) FILTER (WHERE o.avi_state = 'CUMPLIDO') AS notice_fulfilled_count,
          COUNT(*) FILTER (WHERE o.due_at < ${dayStart} AND o.avi_state IN ('PENDIENTE','INFORMACION_INCOMPLETA','VALIDADO','LISTO_PARA_PRESENTAR','PRESENTADO','ACUSE_CARGADO')) AS notice_overdue_count,
          MIN(o.due_at) FILTER (WHERE o.avi_state NOT IN ('NO_APLICA','CUMPLIDO')) AS next_notice_due
        FROM compliance_obligations o
        WHERE o.organization_id = ${user.organizationId}::uuid
          AND o.review_id = s.current_review_id AND o.freshness = 'CURRENT'
      ) notices ON true
      LEFT JOIN LATERAL (
        SELECT
          BOOL_OR(a.level = 'CRITICA') AS has_critical,
          BOOL_OR(a.level = 'ADVERTENCIA') AS has_warning
        FROM compliance_alerts a
        WHERE a.organization_id = ${user.organizationId}::uuid AND a.review_id = s.current_review_id
          AND a.status = 'ABIERTA' AND (a.opens_at IS NULL OR a.opens_at <= ${now})
      ) alerts ON true
      WHERE s.organization_id = ${user.organizationId}::uuid
        AND e.organization_id = ${user.organizationId}::uuid
        AND e.archived_at IS NULL
        ${accessSql(user)}
        ${query.lawyerId ? Prisma.sql`AND e.abogado_id = ${query.lawyerId}::uuid` : Prisma.empty}
        ${query.notaryId ? Prisma.sql`AND e.notaria_id = ${query.notaryId}::uuid` : Prisma.empty}
        ${query.actId ? Prisma.sql`AND EXISTS (SELECT 1 FROM expediente_actos ea WHERE ea.expediente_id = e.id AND ea.organization_id = ${user.organizationId}::uuid AND ea.estatus = 'ACTIVO' AND ea.removed_at IS NULL AND ea.tipo_acto_id = ${query.actId}::uuid)` : Prisma.empty}
        ${query.search ? Prisma.sql`AND (
          e.numero_pravia ILIKE ${search} ESCAPE '\\' OR COALESCE(e.numero_notaria, '') ILIKE ${search} ESCAPE '\\'
          OR COALESCE(e.datos_operacion->>'numero_escritura', '') ILIKE ${search} ESCAPE '\\'
          OR EXISTS (SELECT 1 FROM expediente_comparecientes ec JOIN comparecientes c ON c.id = ec.compareciente_id
            WHERE ec.expediente_id = e.id AND ec.organization_id = ${user.organizationId}::uuid
              AND ec.archived_at IS NULL AND ec.estatus = 'ACTIVO' AND c.nombre_busqueda ILIKE ${search} ESCAPE '\\')
        )` : Prisma.empty}
    ), classified AS (
      SELECT *, CASE
        WHEN compliance_state IN ('CUMPLIMIENTO_COMPLETO','NO_APLICA') THEN 'COMPLETO'
        WHEN compliance_state = 'VENCIDO' OR notice_overdue_count > 0 OR (next_due IS NOT NULL AND next_due < ${dayStart}) THEN 'VENCIDO'
        WHEN next_due >= ${dayStart} AND next_due < ${nextDay} THEN 'VENCE_HOY'
        WHEN has_critical THEN 'URGENTE'
        WHEN has_warning THEN 'POR_VENCER'
        ELSE 'PENDIENTE'
      END AS urgency_bucket
      FROM panel_base
    ), ranged AS (
      SELECT * FROM classified WHERE true
        ${query.from ? Prisma.sql`AND next_due >= ${query.from}` : Prisma.empty}
        ${query.toExclusive ? Prisma.sql`AND next_due < ${query.toExclusive}` : Prisma.empty}
    )`;
};

const noticeSummary = (row: PanelSqlRow) => {
  const count = asNumber(row.notice_count);
  const pending = asNumber(row.notice_pending_count);
  const presented = asNumber(row.notice_presented_count);
  const fulfilled = asNumber(row.notice_fulfilled_count);
  const overdue = asNumber(row.notice_overdue_count);
  if (!count) return { code: 'NO_APLICA', label: 'Sin aviso aplicable', count, pending };
  if (overdue) return { code: 'VENCIDO', label: overdue > 1 ? `${overdue} avisos vencidos` : 'Aviso vencido', count, pending };
  const notPresented = Math.max(0, pending - presented);
  if (notPresented) return {
    code: 'PENDIENTE',
    label: presented
      ? `${notPresented} ${notPresented === 1 ? 'pendiente' : 'pendientes'} · ${presented} ${presented === 1 ? 'presentado' : 'presentados'}`
      : notPresented > 1 ? `${notPresented} avisos pendientes` : 'Aviso pendiente',
    count,
    pending,
  };
  if (presented) return { code: 'PRESENTADO', label: presented > 1 ? `${presented} avisos presentados` : 'Aviso presentado', count, pending };
  if (fulfilled === count) return { code: 'CUMPLIDO', label: count > 1 ? `${count} avisos cumplidos` : 'Aviso cumplido', count, pending };
  return { code: 'EN_PROCESO', label: 'Aviso en proceso', count, pending };
};

export class ComplianceH8Service {
  constructor(private readonly db: PrismaClient = prisma) {}

  async panel(user: User, query: H8PanelQuery, now = new Date()) {
    const cte = panelCte(user, query, now);
    const selectedFilter = filterSql(query.filter);
    const offset = (query.page - 1) * query.pageSize;
    const [summaryRows, ordered] = await Promise.all([
      this.db.$queryRaw<Array<{ total: bigint; pending: bigint; notices: bigint; approaching: bigint; expired: bigint }>>(Prisma.sql`${cte}
        SELECT
          COUNT(*) FILTER (WHERE true ${selectedFilter}) AS total,
          COUNT(*) FILTER (WHERE compliance_state IN ('PENDIENTE','EN_PROCESO','LISTO','VENCIDO')) AS pending,
          COUNT(*) FILTER (WHERE notice_pending_count > 0) AS notices,
          COUNT(*) FILTER (WHERE urgency_bucket = 'POR_VENCER') AS approaching,
          COUNT(*) FILTER (WHERE urgency_bucket = 'VENCIDO') AS expired
        FROM ranged`),
      this.db.$queryRaw<PanelSqlRow[]>(Prisma.sql`${cte}
        SELECT state_id, expediente_id, current_review_id, urgency_bucket, next_due, vulnerable,
          notice_count, notice_pending_count, notice_presented_count, notice_fulfilled_count, notice_overdue_count
        FROM ranged WHERE true ${selectedFilter}
        ORDER BY CASE urgency_bucket WHEN 'VENCIDO' THEN 1 WHEN 'VENCE_HOY' THEN 2 WHEN 'URGENTE' THEN 3 WHEN 'POR_VENCER' THEN 4 WHEN 'PENDIENTE' THEN 5 ELSE 6 END,
          next_due ASC NULLS LAST, expediente_id ASC
        LIMIT ${query.pageSize} OFFSET ${offset}`),
    ]);
    const ids = ordered.map((item) => item.state_id);
    const states = ids.length ? await this.db.expedienteComplianceState.findMany({
      where: { id: { in: ids }, organization_id: user.organizationId },
      include: { expediente: {
        include: {
          abogado: { select: { id: true, nombre: true, apellido: true } },
          notaria: { select: { id: true, nombre: true, numero_notaria: true } },
          actos: { where: { estatus: 'ACTIVO', removed_at: null }, orderBy: [{ created_at: 'asc' }, { id: 'asc' }], include: { tipo_acto: { select: { id: true, nombre: true } } } },
          comparecientes: { where: { archived_at: null, estatus: 'ACTIVO' }, orderBy: [{ es_principal: 'desc' }, { orden_comparecencia: 'asc' }, { created_at: 'asc' }], include: { compareciente: { select: { id: true, nombre_busqueda: true } } } },
        },
      } },
    }) : [];
    const stateById = new Map(states.map((item) => [item.id, item]));
    const rows = ordered.flatMap((sqlRow) => {
      const state = stateById.get(sqlRow.state_id);
      if (!state) return [];
      const expediente = state.expediente;
      const main = expediente.comparecientes.find((item) => item.es_principal) || expediente.comparecientes[0] || null;
      return [{
        id: state.id,
        expediente_id: expediente.id,
        expediente: expediente.numero_pravia,
        escritura: expediente.numero_notaria || ((expediente.datos_operacion as any)?.numero_escritura ?? null),
        compareciente_principal: main ? { id: main.compareciente.id, nombre: main.compareciente.nombre_busqueda } : null,
        abogado: expediente.abogado ? { id: expediente.abogado.id, nombre: `${expediente.abogado.nombre} ${expediente.abogado.apellido}`.trim() } : null,
        notaria: expediente.notaria,
        actos: expediente.actos.map((item) => ({ id: item.tipo_acto.id, nombre: item.tipo_acto.nombre })),
        cumplimiento: { code: state.state, pending_count: state.pending_count },
        aviso: noticeSummary(sqlRow),
        urgency: sqlRow.urgency_bucket,
        next_deadline: sqlRow.next_due,
        operational_status: expediente.estatus,
        vulnerable: sqlRow.vulnerable,
      }];
    });
    const summary = summaryRows[0] || { total: 0n, pending: 0n, notices: 0n, approaching: 0n, expired: 0n };
    const total = asNumber(summary.total);
    const optionsScope = { organization_id: user.organizationId, archived_at: null, ...expedienteAccessWhere(user) };
    const [lawyers, acts, notaries] = await Promise.all([
      this.db.expediente.findMany({ where: optionsScope, distinct: ['abogado_id'], select: { abogado: { select: { id: true, nombre: true, apellido: true } } }, orderBy: { abogado_id: 'asc' } }),
      this.db.tipoActo.findMany({ where: { archived_at: null, activo: true, expedienteActos: { some: { organization_id: user.organizationId, estatus: 'ACTIVO', removed_at: null, expediente: optionsScope } } }, select: { id: true, nombre: true }, orderBy: { nombre: 'asc' } }),
      this.db.expediente.findMany({ where: { ...optionsScope, notaria_id: { not: null } }, distinct: ['notaria_id'], select: { notaria: { select: { id: true, nombre: true, numero_notaria: true } } }, orderBy: { notaria_id: 'asc' } }),
    ]);
    return {
      rows,
      metrics: { pendientes: asNumber(summary.pending), avisos_pendientes: asNumber(summary.notices), por_vencer: asNumber(summary.approaching), vencidos: asNumber(summary.expired) },
      meta: { page: query.page, page_size: query.pageSize, total, total_pages: Math.max(1, Math.ceil(total / query.pageSize)) },
      filters: {
        lawyers: lawyers.map((item) => ({ id: item.abogado.id, nombre: `${item.abogado.nombre} ${item.abogado.apellido}`.trim() })),
        acts,
        notaries: notaries.flatMap((item) => item.notaria ? [item.notaria] : []),
        show_notaria: notaries.length > 1,
      },
    };
  }
}

export const complianceH8Service = new ComplianceH8Service();
