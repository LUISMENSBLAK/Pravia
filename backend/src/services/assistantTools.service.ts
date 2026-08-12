import type { Request } from 'express';
import type { PrismaClient } from '@prisma/client';
import prisma from '../config/prisma';
import type { Permission } from '../auth/permissions';
import { expedienteAccessWhere } from '../middleware/auth.middleware';
import { comparecienteObjectWhere } from './objectAccess.service';
import { calculateFinancialPosition } from '../domain/financialLedger';

type AuthUser = NonNullable<Request['user']>;
export type AssistantToolName =
  | 'searchExpedientes' | 'getExpedienteSummary' | 'getExpedientePendingItems'
  | 'searchComparecientes' | 'getComparecienteSummary' | 'getExpedienteDocuments'
  | 'getAgenda' | 'getUpcomingEvents' | 'getFinancialSummary' | 'getOutstandingBalances'
  | 'getComplianceSummary' | 'getCurrentUserWork' | 'globalSearch'
  | 'navigateToEntity' | 'prepareTask' | 'prepareAppointment' | 'prepareFollowUp';

export type AssistantContextInput = {
  route?: string;
  module?: string;
  entity_type?: 'expediente' | 'compareciente' | 'cotizacion' | 'notaria';
  entity_id?: string;
  selected_ids?: string[];
};

type ToolInput = {
  tool: AssistantToolName;
  args?: Record<string, unknown>;
  context?: AssistantContextInput;
  user: AuthUser;
  correlationId: string;
};

export class AssistantToolError extends Error {
  constructor(message: string, readonly code: string, readonly status = 400) { super(message); }
}

type ToolMode = 'READ' | 'NAVIGATE' | 'PREPARE_ONLY';
type ToolSensitivity = 'INTERNAL' | 'PERSONAL' | 'FINANCIAL' | 'COMPLIANCE';
type ToolDefinition = {
  capability: Permission;
  systemPermissions?: Permission[];
  anySystemPermission?: Permission[];
  objectScope: 'EXPEDIENTE' | 'COMPARECIENTE' | 'USER' | 'DYNAMIC';
  resultType: 'COLLECTION' | 'SUMMARY' | 'NAVIGATION' | 'PREPARED_ACTION';
  maxResults: number;
  sensitivity: ToolSensitivity;
  mode: ToolMode;
};

export const ASSISTANT_TOOL_REGISTRY: Record<AssistantToolName, ToolDefinition> = {
  searchExpedientes: { capability: 'ai.expedientes.read', systemPermissions: ['expedientes.read'], objectScope: 'EXPEDIENTE', resultType: 'COLLECTION', maxResults: 25, sensitivity: 'INTERNAL', mode: 'READ' },
  getExpedienteSummary: { capability: 'ai.expedientes.read', systemPermissions: ['expedientes.read'], objectScope: 'EXPEDIENTE', resultType: 'SUMMARY', maxResults: 1, sensitivity: 'INTERNAL', mode: 'READ' },
  getExpedientePendingItems: { capability: 'ai.expedientes.read', systemPermissions: ['expedientes.read'], objectScope: 'EXPEDIENTE', resultType: 'SUMMARY', maxResults: 25, sensitivity: 'INTERNAL', mode: 'READ' },
  searchComparecientes: { capability: 'ai.comparecientes.read', systemPermissions: ['comparecientes.read'], objectScope: 'COMPARECIENTE', resultType: 'COLLECTION', maxResults: 25, sensitivity: 'PERSONAL', mode: 'READ' },
  getComparecienteSummary: { capability: 'ai.comparecientes.read', systemPermissions: ['comparecientes.read'], objectScope: 'COMPARECIENTE', resultType: 'SUMMARY', maxResults: 10, sensitivity: 'PERSONAL', mode: 'READ' },
  getExpedienteDocuments: { capability: 'ai.documentos.read', systemPermissions: ['documentos.read', 'expedientes.read'], objectScope: 'EXPEDIENTE', resultType: 'COLLECTION', maxResults: 25, sensitivity: 'PERSONAL', mode: 'READ' },
  getAgenda: { capability: 'ai.agenda.read', systemPermissions: ['agenda.read'], objectScope: 'USER', resultType: 'COLLECTION', maxResults: 25, sensitivity: 'INTERNAL', mode: 'READ' },
  getUpcomingEvents: { capability: 'ai.agenda.read', systemPermissions: ['agenda.read'], objectScope: 'USER', resultType: 'COLLECTION', maxResults: 25, sensitivity: 'INTERNAL', mode: 'READ' },
  getFinancialSummary: { capability: 'ai.finanzas.read', systemPermissions: ['finanzas.read', 'expedientes.read'], objectScope: 'EXPEDIENTE', resultType: 'SUMMARY', maxResults: 1, sensitivity: 'FINANCIAL', mode: 'READ' },
  getOutstandingBalances: { capability: 'ai.finanzas.read', systemPermissions: ['finanzas.read', 'expedientes.read'], objectScope: 'EXPEDIENTE', resultType: 'COLLECTION', maxResults: 25, sensitivity: 'FINANCIAL', mode: 'READ' },
  getComplianceSummary: { capability: 'ai.cumplimiento.read', systemPermissions: ['cumplimiento.read', 'expedientes.read'], objectScope: 'EXPEDIENTE', resultType: 'SUMMARY', maxResults: 25, sensitivity: 'COMPLIANCE', mode: 'READ' },
  getCurrentUserWork: { capability: 'ai.work.read', systemPermissions: ['mi_dia.read'], objectScope: 'USER', resultType: 'SUMMARY', maxResults: 25, sensitivity: 'INTERNAL', mode: 'READ' },
  globalSearch: { capability: 'ai.search', anySystemPermission: ['expedientes.read', 'comparecientes.read', 'notarias.read'], objectScope: 'DYNAMIC', resultType: 'COLLECTION', maxResults: 25, sensitivity: 'PERSONAL', mode: 'READ' },
  navigateToEntity: { capability: 'ai.navigate', anySystemPermission: ['expedientes.read', 'comparecientes.read', 'cotizaciones.read', 'notarias.read'], objectScope: 'DYNAMIC', resultType: 'NAVIGATION', maxResults: 1, sensitivity: 'INTERNAL', mode: 'NAVIGATE' },
  prepareTask: { capability: 'ai.actions.prepare', systemPermissions: ['agenda.write'], objectScope: 'USER', resultType: 'PREPARED_ACTION', maxResults: 1, sensitivity: 'INTERNAL', mode: 'PREPARE_ONLY' },
  prepareAppointment: { capability: 'ai.actions.prepare', systemPermissions: ['agenda.write'], objectScope: 'USER', resultType: 'PREPARED_ACTION', maxResults: 1, sensitivity: 'INTERNAL', mode: 'PREPARE_ONLY' },
  prepareFollowUp: { capability: 'ai.actions.prepare', systemPermissions: ['agenda.write'], objectScope: 'USER', resultType: 'PREPARED_ACTION', maxResults: 1, sensitivity: 'INTERNAL', mode: 'PREPARE_ONLY' },
};

const boundedLimit = (value: unknown, fallback = 10) => Math.min(Math.max(Number(value) || fallback, 1), 25);
const textArg = (value: unknown, max = 180) => String(value || '').trim().slice(0, max);
const source = (entity: string, id: string, label: string, path: string) => ({ entity, id, label, path });

export function canUseAssistantTool(user: AuthUser, tool: AssistantToolName) {
  const definition = ASSISTANT_TOOL_REGISTRY[tool];
  if (!definition || !user.permissions.includes('ai.use') || !user.permissions.includes(definition.capability)) return false;
  if (definition.systemPermissions?.some((permission) => !user.permissions.includes(permission))) return false;
  if (definition.anySystemPermission && !definition.anySystemPermission.some((permission) => user.permissions.includes(permission))) return false;
  return true;
}

function ensureToolPermission(user: AuthUser, tool: AssistantToolName) {
  if (!canUseAssistantTool(user, tool)) {
    throw new AssistantToolError('No tienes autorización para usar esta consulta en tu función actual.', 'AI_TOOL_PERMISSION_DENIED', 403);
  }
}

function resolveContextId(args: Record<string, unknown>, context: AssistantContextInput | undefined, key: string, entityType: AssistantContextInput['entity_type']) {
  const requested = textArg(args[key], 64);
  const contextual = context?.entity_type === entityType ? textArg(context?.entity_id, 64) : '';
  if (requested && contextual && requested !== contextual) {
    throw new AssistantToolError('El objeto solicitado no coincide con el contexto autenticado de la pantalla.', 'AI_CONTEXT_OBJECT_MISMATCH', 409);
  }
  const id = requested || contextual;
  if (!id) throw new AssistantToolError(`Falta ${key} y no hay un objeto compatible en el contexto actual.`, 'AI_CONTEXT_OBJECT_REQUIRED');
  return id;
}

function financialBudget(exp: any) {
  const data = exp.datos_operacion && typeof exp.datos_operacion === 'object' ? exp.datos_operacion.presupuesto : null;
  return {
    totalCliente: Number(data?.total_cliente ?? exp.cotizacion?.total_cliente ?? 0),
    participacionPravia: Number(data?.honorarios_pravia ?? exp.cotizacion?.honorarios_pravia ?? 0),
  };
}

async function findScopedExpediente(db: PrismaClient, user: AuthUser, id: string, include?: Record<string, unknown>) {
  const record = await db.expediente.findFirst({ where: { id, archived_at: null, ...expedienteAccessWhere(user) }, include: include as any });
  if (!record) throw new AssistantToolError('El expediente no existe o está fuera de tu alcance.', 'AI_EXPEDIENTE_SCOPE_DENIED', 403);
  return record as any;
}

type ToolExecutor = (db: PrismaClient, input: ToolInput) => Promise<any>;

const readAgenda: ToolExecutor = async (db, input) => {
  const args = input.args || {}; const limit = boundedLimit(args.limit); const now = new Date();
  const from = args.from ? new Date(String(args.from)) : now;
  const to = args.to ? new Date(String(args.to)) : new Date(now.getTime() + 14 * 86_400_000);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || to < from || to.getTime() - from.getTime() > 93 * 86_400_000) throw new AssistantToolError('El rango de agenda no es válido o supera 93 días.', 'AI_AGENDA_RANGE_INVALID');
  const expId = args.expediente_id ? textArg(args.expediente_id, 64) : input.context?.entity_type === 'expediente' ? input.context.entity_id : undefined;
  if (expId) await findScopedExpediente(db, input.user, expId);
  const data = await db.eventoAgenda.findMany({ where: { estatus: 'ACTIVO', fecha_inicio: { gte: from, lte: to }, ...(!['DIRECCION', 'ADMINISTRACION'].includes(input.user.rol) ? { user_id: input.user.id } : {}), ...(expId ? { expediente_id: expId } : {}) }, select: { id: true, titulo: true, tipo: true, fecha_inicio: true, fecha_fin: true, todo_el_dia: true, expediente: { select: { id: true, numero_pravia: true } }, usuario: { select: { id: true, nombre: true, apellido: true } } }, orderBy: { fecha_inicio: 'asc' }, take: limit });
  return { data, provenance: data.map((event) => source('EventoAgenda', event.id, event.titulo, '/agenda')), truncated: data.length === limit };
};

const readFinancial: ToolExecutor = async (db, input) => {
  const args = input.args || {}; const limit = boundedLimit(args.limit); const expScope = expedienteAccessWhere(input.user);
  const id = input.tool === 'getFinancialSummary' ? resolveContextId(args, input.context, 'expediente_id', 'expediente') : '';
  const records = await db.expediente.findMany({ where: { archived_at: null, ...expScope, ...(id ? { id } : {}) }, include: { cotizacion: true, movimientosFinancieros: { where: { estatus: { in: ['VALIDADO', 'RECIBIDO'] } } } }, orderBy: { updated_at: 'desc' }, take: id ? 1 : 100 });
  if (id && !records.length) throw new AssistantToolError('El expediente no existe o está fuera de tu alcance.', 'AI_EXPEDIENTE_SCOPE_DENIED', 403);
  const positions = records.map((exp) => { const budget = financialBudget(exp); const position = calculateFinancialPosition({ ...budget, movements: exp.movimientosFinancieros.map((movement) => ({ ...movement, monto: Number(movement.monto) })) }); return { expediente_id: exp.id, folio: exp.numero_pravia, presupuesto_cliente: budget.totalCliente, honorarios_pravia: budget.participacionPravia, recibido_cliente_neto: position.recibido_cliente_neto, saldo_cliente: position.saldo_cliente, fondos_retenidos: position.fondos_retenidos }; }).filter((item) => input.tool !== 'getOutstandingBalances' || item.saldo_cliente > 0).slice(0, limit);
  return { data: id ? positions[0] : positions, provenance: positions.map((item) => source('MovimientoFinanciero', item.expediente_id, item.folio, `/expedientes/${item.expediente_id}`)), truncated: !id && positions.length === limit };
};

const READ_TOOL_HANDLERS: Partial<Record<AssistantToolName, ToolExecutor>> = {
  searchExpedientes: async (db, input) => { const args = input.args || {}; const limit = boundedLimit(args.limit); const query = textArg(args.query, 120); const data = await db.expediente.findMany({ where: { archived_at: null, ...expedienteAccessWhere(input.user), ...(query ? { OR: [{ numero_pravia: { contains: query, mode: 'insensitive' } }, { cliente_alias: { contains: query, mode: 'insensitive' } }] } : {}) }, select: { id: true, numero_pravia: true, cliente_alias: true, estatus: true, etapa_actual_nombre: true, updated_at: true }, orderBy: { updated_at: 'desc' }, take: limit }); return { data, provenance: data.map((item) => source('Expediente', item.id, item.numero_pravia, `/expedientes/${item.id}`)), truncated: data.length === limit }; },
  getExpedienteSummary: async (db, input) => { const args = input.args || {}; const id = resolveContextId(args, input.context, 'expediente_id', 'expediente'); const exp = await findScopedExpediente(db, input.user, id, { tipo_acto: true, abogado: { select: { nombre: true, apellido: true } }, gestor: { select: { nombre: true, apellido: true } }, notaria: { select: { nombre: true } } }); const data = { id: exp.id, folio: exp.numero_pravia, cliente: exp.cliente_alias, estado: exp.estatus, etapa: exp.etapa_actual_nombre, tipo_acto: exp.tipo_acto?.nombre, abogado: exp.abogado ? `${exp.abogado.nombre} ${exp.abogado.apellido}`.trim() : null, gestor: exp.gestor ? `${exp.gestor.nombre} ${exp.gestor.apellido}`.trim() : null, notaria: exp.notaria?.nombre, fechas: { apertura: exp.fecha_apertura, firma_estimada: exp.fecha_estimada_firma, firma_real: exp.fecha_real_firma, entrega: exp.fecha_entrega_cliente }, avance: { general: exp.avance_general, documental: exp.avance_documental, operativo: exp.avance_operativo, ...(input.user.permissions.includes('finanzas.read') ? { financiero: exp.avance_financiero } : {}) } }; return { data, provenance: [source('Expediente', exp.id, exp.numero_pravia, `/expedientes/${exp.id}`)], truncated: false }; },
  getExpedientePendingItems: async (db, input) => { const args = input.args || {}; const limit = boundedLimit(args.limit); const id = resolveContextId(args, input.context, 'expediente_id', 'expediente'); const exp = await findScopedExpediente(db, input.user, id, { requisitos_docs: { where: { obligatorio: true, estatus: { in: ['PENDIENTE', 'EN_REVISION', 'RECHAZADO', 'VENCIDO'] } }, select: { id: true, nombre: true, categoria: true, estatus: true, fecha_vencimiento: true } }, tareas: { where: { estatus: { in: ['PENDIENTE', 'EN_PROCESO'] } }, select: { id: true, titulo: true, prioridad: true, estatus: true, fecha_limite: true } }, tareas_externas: { where: { estatus: { not: 'COMPLETADA' } }, select: { id: true, tipo: true, descripcion: true, institucion: true, estatus: true, fecha_limite: true } } }); const data = { expediente_id: exp.id, folio: exp.numero_pravia, requisitos_documentales: exp.requisitos_docs.slice(0, limit), tareas: exp.tareas.slice(0, limit), gestiones_externas: exp.tareas_externas.slice(0, limit), total_pendientes: exp.requisitos_docs.length + exp.tareas.length + exp.tareas_externas.length }; return { data, provenance: [source('Expediente', exp.id, exp.numero_pravia, `/expedientes/${exp.id}`)], truncated: [exp.requisitos_docs, exp.tareas, exp.tareas_externas].some((items) => items.length > limit) }; },
  searchComparecientes: async (db, input) => { const args = input.args || {}; const limit = boundedLimit(args.limit); const query = textArg(args.query, 120); const data = await db.compareciente.findMany({ where: { archived_at: null, ...comparecienteObjectWhere(input.user), ...(query ? { OR: [{ nombre_busqueda: { contains: query, mode: 'insensitive' } }, { personaFisica: { is: { OR: [{ curp: { contains: query, mode: 'insensitive' } }, { rfc: { contains: query, mode: 'insensitive' } }] } } }, { personaMoral: { is: { rfc: { contains: query, mode: 'insensitive' } } } }] } : {}) }, select: { id: true, tipo_persona: true, nombre_busqueda: true, estatus: true, personaFisica: { select: { nombre_completo_calculado: true, rfc: true, curp: true } }, personaMoral: { select: { razon_social: true, rfc: true } } }, orderBy: { updated_at: 'desc' }, take: limit }); const serialized = data.map((item) => ({ id: item.id, tipo: item.tipo_persona, nombre: item.personaFisica?.nombre_completo_calculado || item.personaMoral?.razon_social || item.nombre_busqueda, rfc: item.personaFisica?.rfc || item.personaMoral?.rfc || null, curp: item.personaFisica?.curp || null, estatus: item.estatus })); return { data: serialized, provenance: serialized.map((item) => source('Compareciente', item.id, item.nombre, `/comparecientes/${item.id}`)), truncated: data.length === limit }; },
  getComparecienteSummary: async (db, input) => { const args = input.args || {}; const id = resolveContextId(args, input.context, 'compareciente_id', 'compareciente'); const item = await db.compareciente.findFirst({ where: { id, archived_at: null, ...comparecienteObjectWhere(input.user) }, include: { personaFisica: true, personaMoral: true, documentos: { where: { estatus: 'ACTIVO' }, select: { id: true } }, expedientes: { where: { expediente: { archived_at: null, ...expedienteAccessWhere(input.user) } }, select: { expediente: { select: { id: true, numero_pravia: true, estatus: true } } }, take: 10 } } }); if (!item) throw new AssistantToolError('El compareciente no existe o está fuera de tu alcance.', 'AI_COMPARECIENTE_SCOPE_DENIED', 403); const name = item.personaFisica?.nombre_completo_calculado || item.personaMoral?.razon_social || item.nombre_busqueda; const data = { id: item.id, tipo: item.tipo_persona, nombre: name, rfc: item.personaFisica?.rfc || item.personaMoral?.rfc, curp: item.personaFisica?.curp, estado: item.estatus, documentos_activos: item.documentos.length, expedientes: item.expedientes.map((link) => link.expediente) }; return { data, provenance: [source('Compareciente', item.id, name, `/comparecientes/${item.id}`)], truncated: item.expedientes.length === 10 }; },
  getExpedienteDocuments: async (db, input) => { const args = input.args || {}; const limit = boundedLimit(args.limit); const id = resolveContextId(args, input.context, 'expediente_id', 'expediente'); const exp = await findScopedExpediente(db, input.user, id, { expedienteDocumentos: { where: { estatus: 'ACTIVO' }, include: { documento: { select: { id: true, nombre_original: true, tipo: true, categoria: true, estatus: true, fecha_vigencia: true } } }, orderBy: { fecha_vinculo: 'desc' } } }); const data = exp.expedienteDocumentos.slice(0, limit).map((link: any) => ({ ...link.documento, tipo_vinculo: link.tipo_vinculo, fecha_vinculo: link.fecha_vinculo })); return { data, provenance: data.map((doc: any) => source('Documento', doc.id, doc.nombre_original, `/expedientes/${exp.id}`)), truncated: exp.expedienteDocumentos.length > limit }; },
  getAgenda: readAgenda,
  getUpcomingEvents: readAgenda,
  getFinancialSummary: readFinancial,
  getOutstandingBalances: readFinancial,
  getComplianceSummary: async (db, input) => { const args = input.args || {}; const limit = boundedLimit(args.limit); const id = resolveContextId(args, input.context, 'expediente_id', 'expediente'); const exp = await findScopedExpediente(db, input.user, id); const reviews = await db.complianceReview.findMany({ where: { expediente_id: id }, select: { id: true, tipo: true, estatus: true, rule_version_snapshot: true, resultado_json: true, explicacion: true, updated_at: true }, orderBy: { updated_at: 'desc' }, take: limit }); return { data: { expediente_id: id, folio: exp.numero_pravia, revisiones: reviews }, provenance: reviews.length ? reviews.map((review) => source('ComplianceReview', review.id, `${review.tipo} · ${review.estatus}`, '/riesgos')) : [source('Expediente', exp.id, exp.numero_pravia, `/expedientes/${exp.id}`)], truncated: reviews.length === limit }; },
  getCurrentUserWork: async (db, input) => { const limit = boundedLimit(input.args?.limit); const [tasks, events] = await Promise.all([db.tarea.findMany({ where: { asignado_a_id: input.user.id, estatus: { in: ['PENDIENTE', 'EN_PROCESO'] } }, select: { id: true, titulo: true, prioridad: true, fecha_limite: true, expediente: { select: { id: true, numero_pravia: true } } }, orderBy: { fecha_limite: 'asc' }, take: limit }), db.eventoAgenda.findMany({ where: { user_id: input.user.id, estatus: 'ACTIVO', fecha_inicio: { gte: new Date(), lte: new Date(Date.now() + 7 * 86_400_000) } }, select: { id: true, titulo: true, tipo: true, fecha_inicio: true, expediente: { select: { id: true, numero_pravia: true } } }, orderBy: { fecha_inicio: 'asc' }, take: limit })]); return { data: { tareas: tasks, proximos_eventos: events }, provenance: [source('User', input.user.id, 'Trabajo del usuario autenticado', '/mi-dia')], truncated: tasks.length === limit || events.length === limit }; },
  globalSearch: async (db, input) => { const args = input.args || {}; const limit = boundedLimit(args.limit); const query = textArg(args.query, 120); if (query.length < 2) throw new AssistantToolError('Escribe al menos dos caracteres para buscar.', 'AI_SEARCH_QUERY_TOO_SHORT'); const expScope = expedienteAccessWhere(input.user); const [expedientes, comparecientes, notarias] = await Promise.all([input.user.permissions.includes('expedientes.read') ? db.expediente.findMany({ where: { archived_at: null, ...expScope, OR: [{ numero_pravia: { contains: query, mode: 'insensitive' } }, { cliente_alias: { contains: query, mode: 'insensitive' } }] }, select: { id: true, numero_pravia: true, cliente_alias: true }, take: limit }) : [], input.user.permissions.includes('comparecientes.read') ? db.compareciente.findMany({ where: { archived_at: null, ...comparecienteObjectWhere(input.user), nombre_busqueda: { contains: query, mode: 'insensitive' } }, select: { id: true, nombre_busqueda: true }, take: limit }) : [], input.user.permissions.includes('notarias.read') ? db.notaria.findMany({ where: { activa: true, OR: [{ nombre: { contains: query, mode: 'insensitive' } }, { numero_notaria: { contains: query, mode: 'insensitive' } }] }, select: { id: true, nombre: true, numero_notaria: true }, take: limit }) : []]); const data = { expedientes, comparecientes, notarias }; return { data, provenance: [...expedientes.map((item) => source('Expediente', item.id, item.numero_pravia, `/expedientes/${item.id}`)), ...comparecientes.map((item) => source('Compareciente', item.id, item.nombre_busqueda, `/comparecientes/${item.id}`)), ...notarias.map((item) => source('Notaria', item.id, item.nombre, '/notarias'))], truncated: [expedientes, comparecientes, notarias].some((items) => items.length === limit) }; },
};

async function executePreparedTool(db: PrismaClient, input: ToolInput) {
  const args = input.args || {};
  if (input.tool === 'navigateToEntity') {
    const entity = textArg(args.entity_type, 30) || input.context?.entity_type || '';
    const id = textArg(args.entity_id, 64) || input.context?.entity_id || '';
    const prefixes: Record<string, string> = { expediente: '/expedientes', compareciente: '/comparecientes', cotizacion: '/cotizaciones', notaria: '/notarias' };
    if (!prefixes[entity] || !id) throw new AssistantToolError('La entidad de navegación no es válida.', 'AI_NAVIGATION_INVALID');
    if (entity === 'expediente') await findScopedExpediente(db, input.user, id);
    if (entity === 'compareciente') {
      const record = await db.compareciente.findFirst({ where: { id, archived_at: null, ...comparecienteObjectWhere(input.user) }, select: { id: true } });
      if (!record) throw new AssistantToolError('El objeto está fuera de tu alcance.', 'AI_OBJECT_SCOPE_DENIED', 403);
    }
    return { data: { kind: 'NAVIGATION', to: `${prefixes[entity]}/${id}` }, provenance: [], truncated: false };
  }
  const title = textArg(args.title || args.titulo, 180);
  if (title.length < 3) throw new AssistantToolError('La propuesta necesita un título de al menos tres caracteres.', 'AI_PREPARE_TITLE_INVALID');
  const expedienteId = args.expediente_id || input.context?.entity_type === 'expediente'
    ? textArg(args.expediente_id || input.context?.entity_id, 64)
    : '';
  if (expedienteId) await findScopedExpediente(db, input.user, expedienteId);
  const responsibleId = textArg(args.responsable_id, 64) || input.user.id;
  if (!['DIRECCION', 'ADMINISTRACION'].includes(input.user.rol) && responsibleId !== input.user.id) throw new AssistantToolError('Solo puedes preparar una asignación para ti mismo.', 'AI_PREPARE_ASSIGNMENT_DENIED', 403);
  const responsible = await db.user.findFirst({ where: { id: responsibleId, activo: true }, select: { id: true, nombre: true, apellido: true } });
  if (!responsible) throw new AssistantToolError('El responsable propuesto no está activo.', 'AI_PREPARE_RESPONSIBLE_INVALID');
  const due = args.fecha || args.fecha_limite || args.fecha_inicio;
  const date = due ? new Date(String(due)) : null;
  if (date && Number.isNaN(date.getTime())) throw new AssistantToolError('La fecha propuesta no es válida.', 'AI_PREPARE_DATE_INVALID');
  const isAppointment = input.tool === 'prepareAppointment';
  const endpoint = isAppointment ? '/agenda' : '/agenda/tareas';
  const payload = isAppointment
    ? { titulo: title, tipo: textArg(args.tipo, 30) || 'CITA', fecha_inicio: date?.toISOString(), responsable_id: responsible.id, expediente_id: expedienteId || null, descripcion: textArg(args.descripcion, 800) || null }
    : { titulo: title, prioridad: textArg(args.prioridad, 20) || 'MEDIA', fecha_limite: date?.toISOString() || null, responsable_id: responsible.id, expediente_id: expedienteId || null, descripcion: textArg(args.descripcion, 800) || null };
  return { data: { kind: 'PREPARED_ACTION', action: input.tool, status: 'AWAITING_CONFIRMATION', payload, responsible, confirmation: { method: 'POST', endpoint, requires_explicit_confirmation: true }, controls: ['CONFIRMAR', 'EDITAR', 'CANCELAR'] }, provenance: expedienteId ? [source('Expediente', expedienteId, 'Expediente contextual', `/expedientes/${expedienteId}`)] : [], truncated: false };
}

async function writeToolAudit(db: PrismaClient, input: ToolInput, action: string, details: Record<string, unknown>) {
  await db.auditLog.create({ data: {
    user_id: input.user.id,
    accion: action,
    entidad: 'User',
    entidad_id: input.user.id,
    correlation_id: input.correlationId,
    session_id: input.user.sessionId,
    detalles: {
      tool: input.tool,
      context_entity_type: input.context?.entity_type || null,
      context_entity_id: input.context?.entity_id || null,
      ...details,
    },
  } });
}

export async function executeAssistantTool(input: ToolInput, db: PrismaClient = prisma) {
  if (!Object.prototype.hasOwnProperty.call(ASSISTANT_TOOL_REGISTRY, input.tool)) {
    throw new AssistantToolError('La herramienta solicitada no está disponible.', 'AI_TOOL_UNKNOWN', 404);
  }
  if (JSON.stringify({ args: input.args, context: input.context }).length > 8_192) throw new AssistantToolError('La solicitud supera el tamaño permitido.', 'AI_TOOL_PAYLOAD_TOO_LARGE', 413);
  const startedAt = Date.now();
  await writeToolAudit(db, input, 'AI_TOOL_STARTED', { argument_keys: Object.keys(input.args || {}) });
  try {
    ensureToolPermission(input.user, input.tool);
    const handler = READ_TOOL_HANDLERS[input.tool] || executePreparedTool;
    const result = await handler(db, input);
    const prepared = result.data?.kind === 'PREPARED_ACTION';
    await writeToolAudit(db, input, prepared ? 'AI_TOOL_PREPARED' : 'AI_TOOL_COMPLETED', {
      success: true,
      duration_ms: Date.now() - startedAt,
      provenance_count: result.provenance.length,
      truncated: result.truncated,
    });
    return { success: true, tool: input.tool, correlation_id: input.correlationId, limit: boundedLimit(input.args?.limit), ...result };
  } catch (error: any) {
    await writeToolAudit(db, input, 'AI_TOOL_FAILED', {
      success: false,
      duration_ms: Date.now() - startedAt,
      error_code: error?.code || 'AI_TOOL_FAILED',
    });
    throw error;
  }
}

export const assistantToolCatalog = (user: AuthUser) => Object.entries(ASSISTANT_TOOL_REGISTRY)
  .filter(([name]) => canUseAssistantTool(user, name as AssistantToolName))
  .map(([name, definition]) => ({
    name,
    mode: definition.mode,
    object_scope: definition.objectScope,
    result_type: definition.resultType,
    max_results: definition.maxResults,
    sensitivity: definition.sensitivity,
  }));
