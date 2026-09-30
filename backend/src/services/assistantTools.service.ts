import type { Request } from 'express';
import type { ExpedienteEstatus, PrismaClient } from '@prisma/client';
import prisma from '../config/prisma';
import type { Permission } from '../auth/permissions';
import { expedienteAccessWhere } from '../middleware/auth.middleware';
import { canAccessDocumento, comparecienteObjectWhere, cotizacionObjectWhere, predioObjectWhere, prospectoObjectWhere } from './objectAccess.service';
import { calculateFinancialPosition } from '../domain/financialLedger';
import { ReportingService } from './reporting.service';
import { resolveAssistantTimeRange, safeAssistantTimezone } from './assistantTime';
import { isrObjectWhere } from './isr.service';
import { ProjectGenerationService } from './projectGeneration.service';
import { ProjectRepository } from './projectRepository.service';
import { actsAndTimesService } from './configurationCatalog.service';
import { functionalDestinationService } from './functionalDestination.service';
import { KnowledgeService } from './knowledge.service';
import { EXPEDIENTE_STATUS_LABELS } from '../domain/expedienteWorkflow';

type AuthUser = NonNullable<Request['user']>;
export type AssistantToolName =
  | 'getProspectFollowUps'
  | 'searchExpedientes' | 'getExpedienteSummary' | 'getExpedientePendingItems' | 'getExpedientesRequiringAttention'
  | 'searchComparecientes' | 'getComparecienteSummary' | 'getExpedienteDocuments'
  | 'searchPredios' | 'getPredioSummary' | 'getQuotation' | 'getBudget'
  | 'getProjectContext' | 'getProjectObservations' | 'getQuestionnaires' | 'getCFG001' | 'getCFG002Resolution' | 'getDocumentMetadata'
  | 'getAgenda' | 'getUpcomingEvents' | 'getFinancialSummary' | 'getOutstandingBalances'
  | 'getReportingSummary'
  | 'getISRCalculation' | 'getComplianceSummary' | 'getCurrentUserWork' | 'globalSearch'
  | 'searchLegalKnowledge'
  | 'navigateToEntity' | 'prepareTask' | 'prepareAppointment' | 'prepareFollowUp';

export type AssistantContextInput = {
  route?: string;
  module?: string;
  entity_type?: 'expediente' | 'compareciente' | 'cotizacion' | 'notaria' | 'prospecto' | 'evento' | 'predio' | 'documento' | 'proyecto' | 'cfg001Activity' | 'cfg002Artifact' | 'isrCalculation' | 'complianceReview';
  entity_id?: string;
  selected_ids?: string[];
  expediente_id?: string;
  expediente_acto_id?: string;
  proceso_id?: string;
  actividad_id?: string;
  compareciente_id?: string;
  predio_id?: string;
  documento_id?: string;
  cotizacion_id?: string;
  presupuesto_id?: string;
  isr_calculation_id?: string;
  compliance_review_id?: string;
  selected_date?: string;
  selected_from?: string;
  selected_to?: string;
  active_document_id?: string;
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
export type AssistantActionLevel = 'R' | 'P' | 'E' | 'S' | 'A';
type BaseToolDefinition = {
  capability: Permission;
  systemPermissions?: Permission[];
  anySystemPermission?: Permission[];
  objectScope: 'EXPEDIENTE' | 'COMPARECIENTE' | 'PREDIO' | 'DOCUMENTO' | 'USER' | 'DYNAMIC';
  resultType: 'COLLECTION' | 'SUMMARY' | 'NAVIGATION' | 'PREPARED_ACTION';
  maxResults: number;
  sensitivity: ToolSensitivity;
  mode: ToolMode;
};

export type AssistantToolDefinition = BaseToolDefinition & {
  name: AssistantToolName;
  domain: string;
  description: string;
  inputSchema: { type: 'object'; additionalProperties: boolean };
  outputSchema: { type: 'object'; resultType: BaseToolDefinition['resultType'] };
  level: AssistantActionLevel;
  risk: 'READ_ONLY' | 'PREPARATION_ONLY';
  requiredPermission: Permission;
  tenantPolicy: 'CURRENT_ORGANIZATION';
  objectAccessPolicy: BaseToolDefinition['objectScope'];
  confirmationPolicy: 'NONE';
  idempotencyPolicy: 'NOT_APPLICABLE';
  canonicalService: string;
  auditPolicy: 'READ_TRACE' | 'PREPARE_TRACE';
};

const BASE_ASSISTANT_TOOL_REGISTRY: Record<AssistantToolName, BaseToolDefinition> = {
  getProspectFollowUps: { capability: 'ai.prospectos.read', systemPermissions: ['prospectos.read'], objectScope: 'USER', resultType: 'COLLECTION', maxResults: 25, sensitivity: 'PERSONAL', mode: 'READ' },
  searchExpedientes: { capability: 'ai.expedientes.read', systemPermissions: ['expedientes.read'], objectScope: 'EXPEDIENTE', resultType: 'COLLECTION', maxResults: 25, sensitivity: 'INTERNAL', mode: 'READ' },
  getExpedienteSummary: { capability: 'ai.expedientes.read', systemPermissions: ['expedientes.read'], objectScope: 'EXPEDIENTE', resultType: 'SUMMARY', maxResults: 1, sensitivity: 'INTERNAL', mode: 'READ' },
  getExpedientePendingItems: { capability: 'ai.expedientes.read', systemPermissions: ['expedientes.read'], objectScope: 'EXPEDIENTE', resultType: 'SUMMARY', maxResults: 25, sensitivity: 'INTERNAL', mode: 'READ' },
  getExpedientesRequiringAttention: { capability: 'ai.expedientes.read', systemPermissions: ['expedientes.read'], objectScope: 'EXPEDIENTE', resultType: 'COLLECTION', maxResults: 25, sensitivity: 'INTERNAL', mode: 'READ' },
  searchComparecientes: { capability: 'ai.comparecientes.read', systemPermissions: ['comparecientes.read'], objectScope: 'COMPARECIENTE', resultType: 'COLLECTION', maxResults: 25, sensitivity: 'PERSONAL', mode: 'READ' },
  getComparecienteSummary: { capability: 'ai.comparecientes.read', systemPermissions: ['comparecientes.read'], objectScope: 'COMPARECIENTE', resultType: 'SUMMARY', maxResults: 10, sensitivity: 'PERSONAL', mode: 'READ' },
  getExpedienteDocuments: { capability: 'ai.documentos.read', systemPermissions: ['documentos.read', 'expedientes.read'], objectScope: 'EXPEDIENTE', resultType: 'COLLECTION', maxResults: 25, sensitivity: 'PERSONAL', mode: 'READ' },
  searchPredios: { capability: 'ai.expedientes.read', systemPermissions: ['expedientes.read'], objectScope: 'PREDIO', resultType: 'COLLECTION', maxResults: 25, sensitivity: 'PERSONAL', mode: 'READ' },
  getPredioSummary: { capability: 'ai.expedientes.read', systemPermissions: ['expedientes.read'], objectScope: 'PREDIO', resultType: 'SUMMARY', maxResults: 1, sensitivity: 'PERSONAL', mode: 'READ' },
  getQuotation: { capability: 'ai.prospectos.read', systemPermissions: ['cotizaciones.read'], objectScope: 'DYNAMIC', resultType: 'SUMMARY', maxResults: 1, sensitivity: 'FINANCIAL', mode: 'READ' },
  getBudget: { capability: 'ai.finanzas.read', systemPermissions: ['finanzas.read', 'expedientes.read'], objectScope: 'EXPEDIENTE', resultType: 'SUMMARY', maxResults: 1, sensitivity: 'FINANCIAL', mode: 'READ' },
  getProjectContext: { capability: 'ai.expedientes.read', systemPermissions: ['expedientes.read', 'expedientes.project.read'], objectScope: 'EXPEDIENTE', resultType: 'SUMMARY', maxResults: 25, sensitivity: 'PERSONAL', mode: 'READ' },
  getProjectObservations: { capability: 'ai.expedientes.read', systemPermissions: ['expedientes.read', 'expedientes.project.read'], objectScope: 'EXPEDIENTE', resultType: 'SUMMARY', maxResults: 25, sensitivity: 'PERSONAL', mode: 'READ' },
  getQuestionnaires: { capability: 'ai.expedientes.read', systemPermissions: ['expedientes.read'], objectScope: 'EXPEDIENTE', resultType: 'COLLECTION', maxResults: 25, sensitivity: 'COMPLIANCE', mode: 'READ' },
  getCFG001: { capability: 'ai.admin.read', systemPermissions: ['configuracion.catalogos.read'], objectScope: 'DYNAMIC', resultType: 'SUMMARY', maxResults: 25, sensitivity: 'INTERNAL', mode: 'READ' },
  getCFG002Resolution: { capability: 'ai.admin.read', systemPermissions: ['configuracion.catalogos.read'], objectScope: 'DYNAMIC', resultType: 'SUMMARY', maxResults: 1, sensitivity: 'INTERNAL', mode: 'READ' },
  getDocumentMetadata: { capability: 'ai.documentos.read', systemPermissions: ['documentos.read'], objectScope: 'DOCUMENTO', resultType: 'SUMMARY', maxResults: 1, sensitivity: 'PERSONAL', mode: 'READ' },
  getAgenda: { capability: 'ai.agenda.read', systemPermissions: ['agenda.read'], objectScope: 'USER', resultType: 'COLLECTION', maxResults: 25, sensitivity: 'INTERNAL', mode: 'READ' },
  getUpcomingEvents: { capability: 'ai.agenda.read', systemPermissions: ['agenda.read'], objectScope: 'USER', resultType: 'COLLECTION', maxResults: 25, sensitivity: 'INTERNAL', mode: 'READ' },
  getFinancialSummary: { capability: 'ai.finanzas.read', systemPermissions: ['finanzas.read'], objectScope: 'EXPEDIENTE', resultType: 'SUMMARY', maxResults: 1, sensitivity: 'FINANCIAL', mode: 'READ' },
  getOutstandingBalances: { capability: 'ai.finanzas.read', systemPermissions: ['finanzas.read'], objectScope: 'EXPEDIENTE', resultType: 'COLLECTION', maxResults: 25, sensitivity: 'FINANCIAL', mode: 'READ' },
  getReportingSummary: { capability: 'ai.reportes.read', systemPermissions: ['reportes.read'], objectScope: 'USER', resultType: 'SUMMARY', maxResults: 1, sensitivity: 'FINANCIAL', mode: 'READ' },
  getISRCalculation: { capability: 'ai.isr.read', systemPermissions: ['isr.read'], objectScope: 'DYNAMIC', resultType: 'SUMMARY', maxResults: 1, sensitivity: 'FINANCIAL', mode: 'READ' },
  getComplianceSummary: { capability: 'ai.cumplimiento.read', systemPermissions: ['expedientes.read'], anySystemPermission: ['compliance.read', 'cumplimiento.read'], objectScope: 'EXPEDIENTE', resultType: 'SUMMARY', maxResults: 25, sensitivity: 'COMPLIANCE', mode: 'READ' },
  getCurrentUserWork: { capability: 'ai.work.read', systemPermissions: ['mi_dia.read'], objectScope: 'USER', resultType: 'SUMMARY', maxResults: 25, sensitivity: 'INTERNAL', mode: 'READ' },
  globalSearch: { capability: 'ai.search', anySystemPermission: ['expedientes.read', 'comparecientes.read', 'notarias.read'], objectScope: 'DYNAMIC', resultType: 'COLLECTION', maxResults: 25, sensitivity: 'PERSONAL', mode: 'READ' },
  searchLegalKnowledge: { capability: 'ai.search', objectScope: 'DYNAMIC', resultType: 'COLLECTION', maxResults: 20, sensitivity: 'INTERNAL', mode: 'READ' },
  navigateToEntity: { capability: 'ai.navigate', anySystemPermission: ['expedientes.read', 'comparecientes.read', 'cotizaciones.read', 'notarias.read'], objectScope: 'DYNAMIC', resultType: 'NAVIGATION', maxResults: 1, sensitivity: 'INTERNAL', mode: 'NAVIGATE' },
  prepareTask: { capability: 'ai.actions.prepare', systemPermissions: ['agenda.write'], objectScope: 'USER', resultType: 'PREPARED_ACTION', maxResults: 1, sensitivity: 'INTERNAL', mode: 'PREPARE_ONLY' },
  prepareAppointment: { capability: 'ai.actions.prepare', systemPermissions: ['agenda.write'], objectScope: 'USER', resultType: 'PREPARED_ACTION', maxResults: 1, sensitivity: 'INTERNAL', mode: 'PREPARE_ONLY' },
  prepareFollowUp: { capability: 'ai.actions.prepare', systemPermissions: ['agenda.write'], objectScope: 'USER', resultType: 'PREPARED_ACTION', maxResults: 1, sensitivity: 'INTERNAL', mode: 'PREPARE_ONLY' },
};

const toolDomain = (name: AssistantToolName) => {
  if (/Financial|Outstanding|Budget|Reporting/.test(name)) return 'FINANZAS';
  if (/Compliance/.test(name)) return 'CUMPLIMIENTO';
  if (/ISR/.test(name)) return 'ISR';
  if (/Agenda|Event|Task|Appointment|FollowUp/.test(name)) return 'AGENDA';
  if (/Document/.test(name)) return 'DOCUMENTOS';
  if (/Compareciente/.test(name)) return 'COMPARECIENTES';
  if (/Predio/.test(name)) return 'PREDIOS';
  if (/Quotation|Prospect/.test(name)) return 'COTIZACIONES';
  if (/CFG/.test(name)) return 'CONFIGURACION';
  if (/LegalKnowledge/.test(name)) return 'CONOCIMIENTO';
  return 'EXPEDIENTES';
};

export const ASSISTANT_TOOL_REGISTRY = Object.fromEntries(
  (Object.entries(BASE_ASSISTANT_TOOL_REGISTRY) as Array<[AssistantToolName, BaseToolDefinition]>).map(([name, base]) => [name, {
    ...base,
    name,
    domain: toolDomain(name),
    description: `${base.mode === 'PREPARE_ONLY' ? 'Prepara' : base.mode === 'NAVIGATE' ? 'Navega a' : 'Consulta'} ${name} mediante la fuente canónica de PRAVIA.`,
    inputSchema: { type: 'object' as const, additionalProperties: false },
    outputSchema: { type: 'object' as const, resultType: base.resultType },
    level: (base.mode === 'PREPARE_ONLY' ? 'P' : 'R') as AssistantActionLevel,
    risk: base.mode === 'PREPARE_ONLY' ? 'PREPARATION_ONLY' as const : 'READ_ONLY' as const,
    requiredPermission: base.capability,
    tenantPolicy: 'CURRENT_ORGANIZATION' as const,
    objectAccessPolicy: base.objectScope,
    confirmationPolicy: 'NONE' as const,
    idempotencyPolicy: 'NOT_APPLICABLE' as const,
    canonicalService: `assistantTools.${name}`,
    auditPolicy: base.mode === 'PREPARE_ONLY' ? 'PREPARE_TRACE' as const : 'READ_TRACE' as const,
  }]),
) as Record<AssistantToolName, AssistantToolDefinition>;

const boundedLimit = (value: unknown, fallback = 10) => Math.min(Math.max(Number(value) || fallback, 1), 25);
const textArg = (value: unknown, max = 180) => String(value || '').trim().slice(0, max);
const source = (entity: string, id: string, label: string, path: string) => ({ entity, id, label, path });
const expedienteStatusLabel = (value: unknown) => EXPEDIENTE_STATUS_LABELS[value as ExpedienteEstatus] || String(value || 'Sin estado');

async function userTimezone(db: PrismaClient, userId: string) {
  const preferenceReader = (db as any).userPreference?.findUnique;
  if (typeof preferenceReader !== 'function') return safeAssistantTimezone(undefined);
  const preference = await preferenceReader.call((db as any).userPreference, {
    where: { user_id: userId },
    select: { timezone: true },
  });
  return safeAssistantTimezone(preference?.timezone);
}

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

async function resolveExpedienteReference(db: PrismaClient, input: ToolInput) {
  const args = input.args || {};
  const requested = textArg(args.expediente_id, 64);
  const contextual = input.context?.entity_type === 'expediente' ? textArg(input.context.entity_id, 64) : '';
  if (requested && contextual && requested !== contextual) {
    throw new AssistantToolError('El expediente solicitado no coincide con el contexto autenticado.', 'AI_CONTEXT_OBJECT_MISMATCH', 409);
  }
  if (requested || contextual) return requested || contextual;
  const folio = textArg(args.folio, 80);
  if (!folio) throw new AssistantToolError('Falta expediente_id o folio y no hay un expediente compatible en el contexto.', 'AI_CONTEXT_OBJECT_REQUIRED');
  const record = await db.expediente.findFirst({
    where: { numero_pravia: { equals: folio, mode: 'insensitive' }, archived_at: null, ...expedienteAccessWhere(input.user) },
    select: { id: true },
  });
  if (!record) throw new AssistantToolError('El expediente no existe o está fuera de tu alcance.', 'AI_EXPEDIENTE_SCOPE_DENIED', 403);
  return record.id;
}

async function resolveFinancialExpedienteReference(db: PrismaClient, input: ToolInput) {
  if (input.user.rol !== 'FINANCIERO') return resolveExpedienteReference(db, input);
  const args = input.args || {};
  const requested = textArg(args.expediente_id, 64);
  const contextual = input.context?.entity_type === 'expediente' ? textArg(input.context.entity_id, 64) : '';
  if (requested && contextual && requested !== contextual) {
    throw new AssistantToolError('El expediente solicitado no coincide con el contexto autenticado.', 'AI_CONTEXT_OBJECT_MISMATCH', 409);
  }
  const folio = textArg(args.folio, 80);
  if (!requested && !contextual && !folio) {
    throw new AssistantToolError('Falta expediente_id o folio y no hay un expediente compatible en el contexto.', 'AI_CONTEXT_OBJECT_REQUIRED');
  }
  const record = await db.expediente.findFirst({
    where: {
      organization_id: input.user.organizationId,
      archived_at: null,
      ...(requested || contextual
        ? { id: requested || contextual }
        : { numero_pravia: { equals: folio, mode: 'insensitive' } }),
    },
    select: { id: true },
  });
  if (!record) throw new AssistantToolError('El expediente no existe o está fuera de tu alcance.', 'AI_EXPEDIENTE_SCOPE_DENIED', 403);
  return record.id;
}

function financialBudget(exp: any) {
  if (exp.presupuesto) return {
    totalCliente: Number(exp.presupuesto.total ?? 0),
    participacionPravia: Number(exp.presupuesto.distribucion?.pravia_honorarios ?? 0) + Number(exp.presupuesto.distribucion?.pravia_iva ?? 0),
  };
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
  const timezone = await userTimezone(db, input.user.id);
  const period = resolveAssistantTimeRange(args.period || 'NEXT_7_DAYS', timezone, now);
  const from = args.from ? new Date(String(args.from)) : period.from;
  const to = args.to ? new Date(String(args.to)) : period.to;
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || to <= from || to.getTime() - from.getTime() > 93 * 86_400_000) throw new AssistantToolError('El rango de agenda no es válido o supera 93 días.', 'AI_AGENDA_RANGE_INVALID');
  const expId = args.expediente_id ? textArg(args.expediente_id, 64) : input.context?.entity_type === 'expediente' ? input.context.entity_id : undefined;
  if (expId) await findScopedExpediente(db, input.user, expId);
  const data = await db.eventoAgenda.findMany({ where: { organization_id: input.user.organizationId, estatus: 'ACTIVO', fecha_inicio: { gte: from, lt: to }, ...(!['DIRECCION', 'ADMINISTRACION'].includes(input.user.rol) ? { user_id: input.user.id } : {}), ...(expId ? { expediente_id: expId } : {}) }, select: { id: true, titulo: true, tipo: true, fecha_inicio: true, fecha_fin: true, todo_el_dia: true, expediente: { select: { id: true, numero_pravia: true } }, usuario: { select: { id: true, nombre: true, apellido: true } } }, orderBy: { fecha_inicio: 'asc' }, take: limit });
  return { data: { periodo: { key: period.period, timezone, from, to }, eventos: data }, provenance: data.map((event) => source('EventoAgenda', event.id, event.titulo, '/agenda')), truncated: data.length === limit };
};

const readFinancial: ToolExecutor = async (db, input) => {
  const args = input.args || {}; const limit = boundedLimit(args.limit);
  const expScope = input.user.rol === 'FINANCIERO' ? { organization_id: input.user.organizationId } : expedienteAccessWhere(input.user);
  const id = input.tool === 'getFinancialSummary' ? await resolveFinancialExpedienteReference(db, input) : '';
  const records = await db.expediente.findMany({ where: { archived_at: null, ...expScope, ...(id ? { id } : {}) }, include: { presupuesto: { include: { distribucion: true } }, cotizacion: true, movimientosFinancieros: { where: { estatus: { in: ['APLICADO', 'VALIDADO', 'RECIBIDO'] } } } }, orderBy: { updated_at: 'desc' }, take: id ? 1 : 100 });
  if (id && !records.length) throw new AssistantToolError('El expediente no existe o está fuera de tu alcance.', 'AI_EXPEDIENTE_SCOPE_DENIED', 403);
  const positions = records.map((exp) => { const budget = financialBudget(exp); const position = calculateFinancialPosition({ ...budget, movements: exp.movimientosFinancieros.map((movement) => ({ ...movement, monto: Number(movement.monto) })) }); return { expediente_id: exp.id, folio: exp.numero_pravia, presupuesto_cliente: budget.totalCliente, honorarios_pravia: budget.participacionPravia, recibido_cliente_neto: position.recibido_cliente_neto, saldo_cliente: position.saldo_cliente, fondos_retenidos: position.fondos_retenidos }; }).filter((item) => input.tool !== 'getOutstandingBalances' || item.saldo_cliente > 0).slice(0, limit);
  return { data: id ? positions[0] : positions, provenance: positions.map((item) => source('MovimientoFinanciero', item.expediente_id, item.folio, input.user.rol === 'FINANCIERO' ? '/finanzas' : `/expedientes/${item.expediente_id}`)), truncated: !id && positions.length === limit };
};

const READ_TOOL_HANDLERS: Partial<Record<AssistantToolName, ToolExecutor>> = {
  searchLegalKnowledge: async (db, input) => {
    const args = input.args || {};
    const packet = await new KnowledgeService(db).retrieve(input.user, {
      query: textArg(args.query, 500), jurisdiction: textArg(args.jurisdiction, 80), category: textArg(args.category, 120),
      legal_date: textArg(args.legal_date, 10), limit: boundedLimit(args.limit, 8),
    });
    return {
      data: packet,
      provenance: packet.evidence.map((item) => source('KnowledgeSource', item.source_id, `${item.inventory_code} · ${item.title} · ${item.label}`, '/configuracion/biblioteca-conocimiento')),
      truncated: packet.evidence.length >= boundedLimit(args.limit, 8),
    };
  },
  getISRCalculation: async (db, input) => {
    const id = resolveContextId(input.args || {}, input.context, 'calculo_id', 'isrCalculation');
    const record = await db.calculoISR.findFirst({ where: { id, archived_at: null, ...isrObjectWhere(input.user) }, select: { id: true, folio: true, tipo_operacion: true, estado: true, ejercicio: true, input_data: true, datos_modificados: true, ultima_version: true, expediente: { select: { id: true, numero_pravia: true } }, versiones: { orderBy: { version: 'desc' }, take: 1, select: { version: true, calculated_at: true, result: true, breakdown: true, ruleset_snapshot: true } }, propuestas: { where: { status: { in: ['PENDIENTE', 'CONFLICTO', 'ACEPTADA'] } }, select: { field_path: true, proposed_value: true, status: true, source_document_name: true, source_page: true } }, documentos: { where: { estatus: 'ACTIVO' }, select: { documento: { select: { id: true, nombre_original: true } } } } } });
    if (!record) throw new AssistantToolError('El cálculo ISR no existe o está fuera de tu alcance.', 'AI_ISR_SCOPE_DENIED', 403);
    return { data: { ...record, limitaciones: ['Solo lectura: la IA no modifica datos fiscales.', 'Las propuestas documentales requieren confirmación humana.', 'El resultado no constituye presentación ni acuse SAT.'] }, provenance: [source('CalculoISR', record.id, record.folio, `/calculo-isr/${record.id}`), ...record.documentos.map((link) => source('Documento', link.documento.id, link.documento.nombre_original, `/calculo-isr/${record.id}`))], truncated: false };
  },
  getProspectFollowUps: async (db, input) => {
    const limit = boundedLimit(input.args?.limit);
    const timezone = await userTimezone(db, input.user.id);
    const range = resolveAssistantTimeRange(input.args?.period || 'THIS_WEEK', timezone);
    const data = await db.prospectoSeguimiento.findMany({
      where: {
        fecha_proximo_seguimiento: { lt: range.to },
        prospecto: {
          archived_at: null,
          estado: { notIn: ['ACEPTADO', 'PERDIDO', 'CANCELADO', 'ARCHIVADO'] },
          ...prospectoObjectWhere(input.user),
        },
      },
      select: {
        id: true, tipo: true, proxima_accion: true, fecha_proximo_seguimiento: true,
        prospecto: { select: { id: true, nombre: true, estado: true, prioridad: true, tipo_acto: true } },
      },
      orderBy: { fecha_proximo_seguimiento: 'asc' },
      take: limit,
    });
    return {
      data: {
        periodo: { key: range.period, label: range.label, timezone, from: range.from, to: range.to },
        seguimientos_vencidos: data.filter((item) => item.fecha_proximo_seguimiento && item.fecha_proximo_seguimiento < range.from),
        seguimientos_del_periodo: data.filter((item) => item.fecha_proximo_seguimiento && item.fecha_proximo_seguimiento >= range.from),
      },
      provenance: data.map((item) => source('Prospecto', item.prospecto.id, item.prospecto.nombre, `/prospectos/${item.prospecto.id}`)),
      truncated: data.length === limit,
    };
  },
  searchExpedientes: async (db, input) => { const args = input.args || {}; const limit = boundedLimit(args.limit); const query = textArg(args.query, 120); const records = await db.expediente.findMany({ where: { archived_at: null, ...expedienteAccessWhere(input.user), ...(query ? { OR: [{ numero_pravia: { contains: query, mode: 'insensitive' } }, { cliente_alias: { contains: query, mode: 'insensitive' } }] } : {}) }, select: { id: true, numero_pravia: true, cliente_alias: true, estatus: true, etapa_actual_nombre: true, updated_at: true }, orderBy: { updated_at: 'desc' }, take: limit }); const data = records.map((item) => ({ ...item, estatus: expedienteStatusLabel(item.estatus) })); return { data, provenance: data.map((item) => source('Expediente', item.id, item.numero_pravia, `/expedientes/${item.id}`)), truncated: data.length === limit }; },
  getExpedientesRequiringAttention: async (db, input) => {
    const limit = boundedLimit(input.args?.limit);
    const now = new Date();
    const nextWeek = new Date(now.getTime() + 7 * 86_400_000);
    const canReadFinance = input.user.permissions.includes('finanzas.read');
    const records = await db.expediente.findMany({
      where: { archived_at: null, ...expedienteAccessWhere(input.user) },
      include: {
        cotizacion: canReadFinance,
        movimientosFinancieros: canReadFinance,
        requisitos_docs: {
          where: { obligatorio: true, estatus: { in: ['PENDIENTE', 'EN_REVISION', 'RECHAZADO', 'VENCIDO'] } },
          select: { id: true, nombre: true, estatus: true, fecha_vencimiento: true },
        },
        tareas: {
          where: { estatus: { in: ['PENDIENTE', 'EN_PROCESO'] } },
          select: { id: true, titulo: true, prioridad: true, estatus: true, fecha_limite: true },
        },
        tareas_externas: {
          where: { estatus: { not: 'COMPLETADA' } },
          select: { id: true, descripcion: true, institucion: true, estatus: true, fecha_limite: true },
        },
      },
      orderBy: { updated_at: 'desc' },
      take: 300,
    });

    const attention = records.map((exp: any) => {
      const reasons: Array<{ type: string; priority: 'ALTA' | 'MEDIA'; detail: string; due_at?: Date | null }> = [];
      if (exp.estatus === 'SUSPENDIDO') reasons.push({ type: 'EXPEDIENTE_BLOQUEADO', priority: 'ALTA', detail: 'El expediente está suspendido.' });
      if (exp.estatus === 'PENDIENTE_CLIENTE') reasons.push({ type: 'PENDIENTE_CLIENTE', priority: 'MEDIA', detail: 'Hay información o una acción pendiente del cliente.' });
      if (exp.estatus === 'PENDIENTE_NOTARIA') reasons.push({ type: 'PENDIENTE_NOTARIA', priority: 'MEDIA', detail: 'Hay información o una acción pendiente de la notaría.' });
      if (exp.fecha_estimada_firma && !exp.fecha_real_firma && exp.fecha_estimada_firma >= now && exp.fecha_estimada_firma <= nextWeek) {
        reasons.push({ type: 'FIRMA_PROXIMA', priority: 'ALTA', detail: 'La firma está programada dentro de los próximos 7 días.', due_at: exp.fecha_estimada_firma });
      }
      for (const task of exp.tareas) {
        const overdue = task.fecha_limite && task.fecha_limite < now;
        reasons.push({ type: overdue ? 'TAREA_VENCIDA' : 'TAREA_PENDIENTE', priority: overdue || task.prioridad === 'ALTA' ? 'ALTA' : 'MEDIA', detail: task.titulo, due_at: task.fecha_limite });
      }
      for (const external of exp.tareas_externas) {
        reasons.push({ type: external.estatus === 'BLOQUEADA' ? 'GESTION_BLOQUEADA' : 'GESTION_PENDIENTE', priority: external.estatus === 'BLOQUEADA' ? 'ALTA' : 'MEDIA', detail: external.descripcion || external.institucion || 'Gestión externa pendiente.', due_at: external.fecha_limite });
      }
      for (const requirement of exp.requisitos_docs) {
        reasons.push({ type: 'DOCUMENTO_PENDIENTE', priority: ['RECHAZADO', 'VENCIDO'].includes(requirement.estatus) ? 'ALTA' : 'MEDIA', detail: requirement.nombre, due_at: requirement.fecha_vencimiento });
      }
      if (canReadFinance) {
        const totals = financialBudget(exp);
        const position = calculateFinancialPosition({
          ...totals,
          movements: exp.movimientosFinancieros.map((movement: any) => ({ ...movement, monto: Number(movement.monto) })),
        });
        if (position.saldo_cliente > 0) reasons.push({ type: 'COBRO_PENDIENTE', priority: 'MEDIA', detail: `Saldo pendiente: ${position.saldo_cliente.toFixed(2)} MXN.` });
      }
      return {
        expediente_id: exp.id,
        folio: exp.numero_pravia,
        cliente: exp.cliente_alias,
        estado: expedienteStatusLabel(exp.estatus),
        etapa: exp.etapa_actual_nombre,
        reasons: reasons.sort((a, b) => a.priority === b.priority ? 0 : a.priority === 'ALTA' ? -1 : 1),
        updated_at: exp.updated_at,
      };
    }).filter((item) => item.reasons.length > 0)
      .sort((a, b) => Number(b.reasons.some((reason) => reason.priority === 'ALTA')) - Number(a.reasons.some((reason) => reason.priority === 'ALTA')) || new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime());

    const data = attention.slice(0, limit);
    return {
      data,
      provenance: data.map((item) => source('Expediente', item.expediente_id, item.folio, `/expedientes/${item.expediente_id}`)),
      truncated: attention.length > limit,
    };
  },
  getExpedienteSummary: async (db, input) => { const args = input.args || {}; const id = resolveContextId(args, input.context, 'expediente_id', 'expediente'); const exp = await findScopedExpediente(db, input.user, id, { actos: { where: { estatus: 'ACTIVO', removed_at: null }, include: { tipo_acto: true }, orderBy: { created_at: 'asc' } }, abogado: { select: { nombre: true, apellido: true } }, gestor: { select: { nombre: true, apellido: true } }, notaria: { select: { nombre: true } } }); const data = { id: exp.id, folio: exp.numero_pravia, cliente: exp.cliente_alias, estado: expedienteStatusLabel(exp.estatus), etapa: exp.etapa_actual_nombre, actos: exp.actos.map((item: any) => ({ id: item.id, tipo: item.tipo_acto.nombre, origen: item.origen })), abogado: exp.abogado ? `${exp.abogado.nombre} ${exp.abogado.apellido}`.trim() : null, gestor: exp.gestor ? `${exp.gestor.nombre} ${exp.gestor.apellido}`.trim() : null, notaria: exp.notaria?.nombre, fechas: { apertura: exp.fecha_apertura, firma_estimada: exp.fecha_estimada_firma, firma_real: exp.fecha_real_firma, entrega: exp.fecha_entrega_cliente }, avance: { general: exp.avance_general, documental: exp.avance_documental, operativo: exp.avance_operativo, ...(input.user.permissions.includes('finanzas.read') ? { financiero: exp.avance_financiero } : {}) } }; return { data, provenance: [source('Expediente', exp.id, exp.numero_pravia, `/expedientes/${exp.id}`)], truncated: false }; },
  getExpedientePendingItems: async (db, input) => { const args = input.args || {}; const limit = boundedLimit(args.limit); const id = await resolveExpedienteReference(db, input); const exp = await findScopedExpediente(db, input.user, id, { requisitos_docs: { where: { obligatorio: true, estatus: { in: ['PENDIENTE', 'EN_REVISION', 'RECHAZADO', 'VENCIDO'] } }, select: { id: true, nombre: true, categoria: true, estatus: true, fecha_vencimiento: true } }, tareas: { where: { estatus: { in: ['PENDIENTE', 'EN_PROCESO'] } }, select: { id: true, titulo: true, prioridad: true, estatus: true, fecha_limite: true } }, tareas_externas: { where: { estatus: { not: 'COMPLETADA' } }, select: { id: true, tipo: true, descripcion: true, institucion: true, estatus: true, fecha_limite: true } } }); const data = { expediente_id: exp.id, folio: exp.numero_pravia, requisitos_documentales: exp.requisitos_docs.slice(0, limit), tareas: exp.tareas.slice(0, limit), gestiones_externas: exp.tareas_externas.slice(0, limit), total_pendientes: exp.requisitos_docs.length + exp.tareas.length + exp.tareas_externas.length }; return { data, provenance: [source('Expediente', exp.id, exp.numero_pravia, `/expedientes/${exp.id}`)], truncated: [exp.requisitos_docs, exp.tareas, exp.tareas_externas].some((items) => items.length > limit) }; },
  searchComparecientes: async (db, input) => { const args = input.args || {}; const limit = boundedLimit(args.limit); const query = textArg(args.query, 120); const data = await db.compareciente.findMany({ where: { organization_id: input.user.organizationId, archived_at: null, ...comparecienteObjectWhere(input.user), ...(query ? { OR: [{ nombre_busqueda: { contains: query, mode: 'insensitive' } }, { personaFisica: { is: { OR: [{ curp: { contains: query, mode: 'insensitive' } }, { rfc: { contains: query, mode: 'insensitive' } }] } } }, { personaMoral: { is: { rfc: { contains: query, mode: 'insensitive' } } } }] } : {}) }, select: { id: true, tipo_persona: true, nombre_busqueda: true, estatus: true, personaFisica: { select: { nombre_completo_calculado: true, rfc: true, curp: true } }, personaMoral: { select: { razon_social: true, rfc: true } } }, orderBy: { updated_at: 'desc' }, take: limit }); const serialized = data.map((item) => ({ id: item.id, tipo: item.tipo_persona, nombre: item.personaFisica?.nombre_completo_calculado || item.personaMoral?.razon_social || item.nombre_busqueda, rfc: item.personaFisica?.rfc || item.personaMoral?.rfc || null, curp: item.personaFisica?.curp || null, estatus: item.estatus })); return { data: serialized, provenance: serialized.map((item) => source('Compareciente', item.id, item.nombre, `/comparecientes/${item.id}`)), truncated: data.length === limit }; },
  getComparecienteSummary: async (db, input) => { const args = input.args || {}; const id = resolveContextId(args, input.context, 'compareciente_id', 'compareciente'); const item = await db.compareciente.findFirst({ where: { id, organization_id: input.user.organizationId, archived_at: null, ...comparecienteObjectWhere(input.user) }, include: { personaFisica: true, personaMoral: true, documentos: { where: { estatus: 'ACTIVO' }, select: { id: true } }, expedientes: { where: { expediente: { archived_at: null, ...expedienteAccessWhere(input.user) } }, select: { expediente: { select: { id: true, numero_pravia: true, estatus: true } } }, take: 10 } } }); if (!item) throw new AssistantToolError('El compareciente no existe o está fuera de tu alcance.', 'AI_COMPARECIENTE_SCOPE_DENIED', 403); const name = item.personaFisica?.nombre_completo_calculado || item.personaMoral?.razon_social || item.nombre_busqueda; const data = { id: item.id, tipo: item.tipo_persona, nombre: name, rfc: item.personaFisica?.rfc || item.personaMoral?.rfc, curp: item.personaFisica?.curp, estado: item.estatus, documentos_activos: item.documentos.length, expedientes: item.expedientes.map((link) => link.expediente) }; return { data, provenance: [source('Compareciente', item.id, name, `/comparecientes/${item.id}`)], truncated: item.expedientes.length === 10 }; },
  getExpedienteDocuments: async (db, input) => { const args = input.args || {}; const limit = boundedLimit(args.limit); const id = resolveContextId(args, input.context, 'expediente_id', 'expediente'); const exp = await findScopedExpediente(db, input.user, id, { expedienteDocumentos: { where: { estatus: 'ACTIVO' }, include: { documento: { select: { id: true, nombre_original: true, tipo: true, categoria: true, estatus: true, fecha_vigencia: true } } }, orderBy: { fecha_vinculo: 'desc' } } }); const data = exp.expedienteDocumentos.slice(0, limit).map((link: any) => ({ ...link.documento, tipo_vinculo: link.tipo_vinculo, fecha_vinculo: link.fecha_vinculo })); return { data, provenance: data.map((doc: any) => source('Documento', doc.id, doc.nombre_original, `/expedientes/${exp.id}`)), truncated: exp.expedienteDocumentos.length > limit }; },
  searchPredios: async (db, input) => {
    const query = textArg(input.args?.query, 160); const limit = boundedLimit(input.args?.limit);
    const data = await db.predio.findMany({
      where: {
        organization_id: input.user.organizationId, archived_at: null, ...predioObjectWhere(input.user),
        ...(query ? { OR: [
          { apodo: { contains: query, mode: 'insensitive' } }, { clave_catastral: { contains: query, mode: 'insensitive' } },
          { cuenta_predial: { contains: query, mode: 'insensitive' } }, { folio_real: { contains: query, mode: 'insensitive' } },
          { ubicacion_texto: { contains: query, mode: 'insensitive' } },
        ] } : {}),
      },
      select: { id: true, apodo: true, clave_catastral: true, cuenta_predial: true, folio_real: true, ubicacion_texto: true, municipio: true, estado: true, updated_at: true },
      orderBy: { updated_at: 'desc' }, take: limit,
    });
    return { data, provenance: data.map((item) => source('Predio', item.id, item.apodo || item.clave_catastral || item.ubicacion_texto || 'Predio', `/predios/${item.id}`)), truncated: data.length === limit };
  },
  getPredioSummary: async (db, input) => {
    const id = resolveContextId(input.args || {}, input.context, 'predio_id', 'predio');
    const item = await db.predio.findFirst({
      where: { id, organization_id: input.user.organizationId, archived_at: null, ...predioObjectWhere(input.user) },
      include: {
        colindancias: { orderBy: { orden: 'asc' } },
        documentos: { where: { estatus: 'ACTIVO' }, select: { tipo_vinculo: true, vigencia: true, documento: { select: { id: true, nombre_original: true, mime_type: true, checksum_sha256: true } } } },
        expedientes: { where: { estatus: 'ACTIVO', expediente: { archived_at: null, ...expedienteAccessWhere(input.user) } }, select: { expediente: { select: { id: true, numero_pravia: true, estatus: true } } } },
      },
    });
    if (!item) throw new AssistantToolError('El predio no existe o está fuera de tu alcance.', 'AI_PREDIO_SCOPE_DENIED', 403);
    return { data: item, provenance: [source('Predio', item.id, item.apodo || item.clave_catastral || item.ubicacion_texto || 'Predio', `/predios/${item.id}`), ...item.documentos.map((link) => source('Documento', link.documento.id, link.documento.nombre_original, `/predios/${item.id}`))], truncated: false };
  },
  getQuotation: async (db, input) => {
    const id = resolveContextId(input.args || {}, input.context, 'quote_id', 'cotizacion');
    const item = await db.cotizacion.findFirst({
      where: { id, ...cotizacionObjectWhere(input.user) },
      include: {
        prospecto: { select: { id: true, folio: true, nombre: true, telefono: true, email: true } },
        creada_por: { select: { id: true, nombre: true, apellido: true } },
        conceptos: { orderBy: { orden: 'asc' } },
        versiones: { orderBy: { version: 'desc' }, take: 1, include: { conceptos: { orderBy: { orden: 'asc' } } } },
        expediente: { select: { id: true, numero_pravia: true } },
      },
    });
    if (!item) throw new AssistantToolError('La cotización no existe o está fuera de tu alcance.', 'AI_QUOTATION_SCOPE_DENIED', 403);
    return { data: item, provenance: [source('Cotizacion', item.id, item.numero_cotizacion || 'Cotización', `/cotizaciones/${item.id}`)], truncated: false };
  },
  getBudget: async (db, input) => {
    const id = await resolveExpedienteReference(db, input);
    const exp = await findScopedExpediente(db, input.user, id, { presupuesto: { include: { conceptos: { orderBy: { orden: 'asc' } }, distribucion: true, documentos: { include: { documento: { select: { id: true, nombre_original: true, mime_type: true, checksum_sha256: true } } } } } } });
    return { data: { expediente_id: exp.id, folio: exp.numero_pravia, presupuesto: exp.presupuesto || null }, provenance: [source('Expediente', exp.id, exp.numero_pravia, `/expedientes/${exp.id}#presupuesto`), ...((exp.presupuesto?.documentos || []).map((link: any) => source('Documento', link.documento.id, link.documento.nombre_original, `/expedientes/${exp.id}#presupuesto`)))], truncated: false };
  },
  getProjectContext: async (db, input) => {
    const id = await resolveExpedienteReference(db, input);
    await findScopedExpediente(db, input.user, id);
    const data = await new ProjectGenerationService().workspace(input.user, id);
    return { data, provenance: [source('Expediente', id, 'Contexto de proyecto', `/expedientes/${id}#proyecto`), ...data.sources.documents.map((link: any) => source('Documento', link.documento.id, link.documento.nombre_original, `/expedientes/${id}#proyecto`))], truncated: false };
  },
  getProjectObservations: async (db, input) => {
    const id = await resolveExpedienteReference(db, input);
    const exp = await findScopedExpediente(db, input.user, id);
    const repository = new ProjectRepository(db);
    const [versions, report] = await Promise.all([repository.listVersions(id), repository.latestReport(id)]);
    const current = versions.find((version) => version.es_vigente) || versions[0] || null;
    const observations = {
      generacion: current?.generation_observations || [],
      revision_ia: report?.record.observaciones || [],
      documentos_no_leidos: report?.record.documentos_no_leidos || [],
    };
    return {
      data: {
        expediente_id: id,
        folio: exp.numero_pravia,
        proyecto: current,
        reporte: report?.record || null,
        observaciones: observations,
        puede_aplicar_automaticamente: false,
        limitacion: 'Las observaciones son propuestas de revisión. PRAVIA no modifica el proyecto automáticamente sin una función canónica de aplicación y confirmación humana.',
      },
      provenance: [source('Expediente', id, exp.numero_pravia, `/expedientes/${id}#proyecto`), ...(current ? [source('Documento', current.id, current.nombre_original, `/expedientes/${id}#proyecto`)] : []), ...(report ? [source('Documento', report.record.id, report.record.nombre_reporte, `/expedientes/${id}#proyecto`)] : [])],
      truncated: observations.generacion.length + observations.revision_ia.length > 25,
    };
  },
  getQuestionnaires: async (db, input) => {
    const id = await resolveExpedienteReference(db, input); const limit = boundedLimit(input.args?.limit);
    const exp = await findScopedExpediente(db, input.user, id);
    const data = await db.expedienteCuestionarioRespuesta.findMany({ where: { organization_id: input.user.organizationId, expediente_id: id }, select: { id: true, scope: true, subject_key: true, revision: true, estado: true, completeness_json: true, finalized_at: true, created_at: true, artefactoVersion: { select: { id: true, version: true, artefacto: { select: { id: true, nombre: true, tipo: true } } } } }, orderBy: [{ created_at: 'desc' }, { revision: 'desc' }], take: limit });
    return { data: { expediente_id: id, folio: exp.numero_pravia, respuestas: data }, provenance: [source('Expediente', id, exp.numero_pravia, `/expedientes/${id}#cuestionarios`)], truncated: data.length === limit };
  },
  getCFG001: async (_db, input) => {
    const actId = textArg(input.args?.tipo_acto_id, 64);
    const data = actId ? await actsAndTimesService.get(input.user, actId) : await actsAndTimesService.list(input.user, textArg(input.args?.query, 120));
    const id = actId || 'catalogo';
    return { data, provenance: [source('CFG001', id, 'Actos y tiempos', '/configuracion/actos-tiempos')], truncated: !actId && Array.isArray((data as any).data) && (data as any).data.length >= boundedLimit(input.args?.limit, 25) };
  },
  getCFG002Resolution: async (_db, input) => {
    const destination = textArg(input.args?.destination, 80);
    if (!destination) throw new AssistantToolError('Falta el destino funcional que quieres resolver.', 'AI_CFG002_DESTINATION_REQUIRED');
    const resolved = await functionalDestinationService.resolve(input.user, destination, { tipoActoId: textArg(input.args?.tipo_acto_id, 64) || null });
    const data = { destination: resolved.destination, artifact: { id: resolved.artifact.id, nombre: resolved.artifact.nombre, tipo: resolved.artifact.tipo }, version: { id: resolved.version.id, version: resolved.version.version, nombre_original: resolved.version.nombre_original, checksum_sha256: resolved.version.checksum_sha256 }, rules: resolved.rules, data_mapping: resolved.data_mapping, provenance: resolved.provenance };
    return { data, provenance: [source('CatalogoArtefacto', resolved.artifact.id, resolved.artifact.nombre, '/configuracion/plantillas-formatos')], truncated: false };
  },
  getDocumentMetadata: async (db, input) => {
    const id = resolveContextId(input.args || {}, input.context, 'document_id', 'documento');
    if (!await canAccessDocumento(input.user, id)) throw new AssistantToolError('El documento no existe o está fuera de tu alcance.', 'AI_DOCUMENT_SCOPE_DENIED', 403);
    const item = await db.documento.findFirst({ where: { id, organization_id: input.user.organizationId }, select: { id: true, nombre_original: true, tipo: true, categoria: true, mime_type: true, size_bytes: true, checksum_sha256: true, fecha_carga: true, fecha_emision: true, fecha_vigencia: true, estatus: true, observaciones: true } });
    if (!item) throw new AssistantToolError('El documento no existe o está fuera de tu alcance.', 'AI_DOCUMENT_SCOPE_DENIED', 403);
    return { data: { ...item, preview_reference: `/documentos/${item.id}/preview`, download_reference: `/documentos/${item.id}/download`, permanent_public_url: false }, provenance: [source('Documento', item.id, item.nombre_original, input.context?.route || '/documentos')], truncated: false };
  },
  getAgenda: readAgenda,
  getUpcomingEvents: readAgenda,
  getFinancialSummary: readFinancial,
  getOutstandingBalances: readFinancial,
  getReportingSummary: async (db, input) => {
    const args = input.args || {};
    const report = await new ReportingService(db).summary(input.user, {
      periodo: textArg(args.periodo, 30) || 'ESTE_MES',
      fecha_desde: textArg(args.fecha_desde, 20) || undefined,
      fecha_hasta: textArg(args.fecha_hasta, 20) || undefined,
      abogado_id: textArg(args.abogado_id, 64) || undefined,
      notaria_id: textArg(args.notaria_id, 64) || undefined,
    });
    return { data: report, provenance: [source('Reporte', 'resumen', report.period.label, '/reportes')], truncated: false };
  },
  getComplianceSummary: async (db, input) => { const args = input.args || {}; const contextReviewId = input.context?.entity_type === 'complianceReview' ? input.context.entity_id : null; const contextual = contextReviewId ? await db.complianceReview.findFirst({ where: { id: contextReviewId }, select: { expediente_id: true } }) : null; const limit = boundedLimit(args.limit); const id = contextual?.expediente_id || resolveContextId(args, input.context, 'expediente_id', 'expediente'); const exp = await findScopedExpediente(db, input.user, id); const reviews = await db.complianceReview.findMany({ where: { expediente_id: id, tipo: 'UIF', ...(contextReviewId ? { id: contextReviewId } : {}) }, select: { id: true, tipo: true, estatus: true, rule_version_snapshot: true, rule_snapshot: true, master_snapshot: true, resultado_json: true, explicacion: true, snapshot_captured_at: true, updated_at: true, evidencias: { select: { id: true, tipo_evidencia: true, documento: { select: { id: true, nombre_original: true, tipo: true } } } } }, orderBy: { updated_at: 'desc' }, take: limit }); return { data: { expediente_id: id, folio: exp.numero_pravia, revisiones: reviews, limitaciones: ['La explicación asiste al revisor y no constituye dictamen legal.', 'La consulta oficial PEP no está configurada; no se simulan resultados.', 'Las propuestas automatizadas requieren confirmación humana y no presentan Avisos.'] }, provenance: reviews.length ? reviews.map((review) => source('ComplianceReview', review.id, `${review.tipo} · ${review.rule_version_snapshot}`, `/riesgos/revisiones/${review.id}`)) : [source('Expediente', exp.id, exp.numero_pravia, `/expedientes/${exp.id}`)], truncated: reviews.length === limit }; },
  getCurrentUserWork: async (db, input) => {
    const limit = boundedLimit(input.args?.limit);
    const timezone = await userTimezone(db, input.user.id);
    const range = resolveAssistantTimeRange(input.args?.period || 'NEXT_7_DAYS', timezone);
    const taskSelect = {
      id: true, titulo: true, prioridad: true, estatus: true,
      fecha_limite: true, fecha_completada: true,
      expediente: { select: { id: true, numero_pravia: true } },
    } as const;
    const [pendingTasks, completedTasks, events] = await Promise.all([
      db.tarea.findMany({
        where: {
          organization_id: input.user.organizationId, asignado_a_id: input.user.id,
          estatus: { in: ['PENDIENTE', 'EN_PROCESO'] },
          OR: [
            { fecha_limite: { gte: range.from, lt: range.to } },
            { fecha_limite: { lt: range.from } },
            { fecha_limite: null },
          ],
        },
        select: taskSelect,
        orderBy: { fecha_limite: 'asc' },
        take: limit,
      }),
      db.tarea.findMany({
        where: {
          organization_id: input.user.organizationId, asignado_a_id: input.user.id,
          estatus: 'COMPLETADA',
          fecha_completada: { gte: range.from, lt: range.to },
        },
        select: taskSelect,
        orderBy: { fecha_completada: 'desc' },
        take: limit,
      }),
      db.eventoAgenda.findMany({
        where: { organization_id: input.user.organizationId, user_id: input.user.id, estatus: 'ACTIVO', fecha_inicio: { gte: range.from, lt: range.to } },
        select: { id: true, titulo: true, tipo: true, fecha_inicio: true, fecha_fin: true, expediente: { select: { id: true, numero_pravia: true } } },
        orderBy: { fecha_inicio: 'asc' },
        take: limit,
      }),
    ]);
    const overdue = pendingTasks.filter((task) => task.fecha_limite && task.fecha_limite < range.from);
    const inPeriod = pendingTasks.filter((task) => task.fecha_limite && task.fecha_limite >= range.from && task.fecha_limite < range.to);
    const undated = pendingTasks.filter((task) => !task.fecha_limite);
    return {
      data: {
        periodo: { key: range.period, label: range.label, timezone, from: range.from, to: range.to },
        tareas_del_periodo: inPeriod,
        tareas_vencidas: overdue,
        tareas_sin_fecha: undated,
        tareas_completadas: completedTasks,
        proximos_eventos: events,
      },
      provenance: [source('User', input.user.id, `Trabajo del usuario · ${range.label}`, '/mi-dia')],
      truncated: pendingTasks.length === limit || completedTasks.length === limit || events.length === limit,
    };
  },
  globalSearch: async (db, input) => { const args = input.args || {}; const limit = boundedLimit(args.limit); const query = textArg(args.query, 120); if (query.length < 2) throw new AssistantToolError('Escribe al menos dos caracteres para buscar.', 'AI_SEARCH_QUERY_TOO_SHORT'); const expScope = expedienteAccessWhere(input.user); const [expedientes, comparecientes, notarias] = await Promise.all([input.user.permissions.includes('expedientes.read') ? db.expediente.findMany({ where: { archived_at: null, ...expScope, OR: [{ numero_pravia: { contains: query, mode: 'insensitive' } }, { cliente_alias: { contains: query, mode: 'insensitive' } }] }, select: { id: true, numero_pravia: true, cliente_alias: true }, take: limit }) : [], input.user.permissions.includes('comparecientes.read') ? db.compareciente.findMany({ where: { organization_id: input.user.organizationId, archived_at: null, ...comparecienteObjectWhere(input.user), nombre_busqueda: { contains: query, mode: 'insensitive' } }, select: { id: true, nombre_busqueda: true }, take: limit }) : [], input.user.permissions.includes('notarias.read') ? db.notaria.findMany({ where: { organization_id: input.user.organizationId, archived_at: null, activa: true, OR: [{ nombre: { contains: query, mode: 'insensitive' } }, { numero_notaria: { contains: query, mode: 'insensitive' } }] }, select: { id: true, nombre: true, numero_notaria: true }, take: limit }) : []]); const data = { expedientes, comparecientes, notarias }; return { data, provenance: [...expedientes.map((item) => source('Expediente', item.id, item.numero_pravia, `/expedientes/${item.id}`)), ...comparecientes.map((item) => source('Compareciente', item.id, item.nombre_busqueda, `/comparecientes/${item.id}`)), ...notarias.map((item) => source('Notaria', item.id, item.nombre, '/notarias'))], truncated: [expedientes, comparecientes, notarias].some((items) => items.length === limit) }; },
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
  const responsible = await db.user.findFirst({ where: { id: responsibleId, activo: true, organizationMemberships: { some: { organization_id: input.user.organizationId, status: 'ACTIVE' } } }, select: { id: true, nombre: true, apellido: true } });
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
    organization_id: input.user.organizationId,
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
    domain: definition.domain,
    description: definition.description,
    mode: definition.mode,
    level: definition.level,
    risk: definition.risk,
    object_scope: definition.objectScope,
    result_type: definition.resultType,
    max_results: definition.maxResults,
    sensitivity: definition.sensitivity,
    input_schema: definition.inputSchema,
    output_schema: definition.outputSchema,
    tenant_policy: definition.tenantPolicy,
    object_access_policy: definition.objectAccessPolicy,
    confirmation_policy: definition.confirmationPolicy,
    idempotency_policy: definition.idempotencyPolicy,
    canonical_service: definition.canonicalService,
    audit_policy: definition.auditPolicy,
  }));
