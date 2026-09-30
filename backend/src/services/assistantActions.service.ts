import { createHash, randomUUID } from 'crypto';
import type { Request, Response } from 'express';
import prisma from '../config/prisma';
import { AgendaController } from '../controllers/agenda.controller';
import { analizarProyectoConIA } from '../controllers/proyectos.controller';
import { expedienteAccessWhere } from '../middleware/auth.middleware';
import { canAccessCompareciente, prospectoObjectWhere, cotizacionObjectWhere } from './objectAccess.service';
import { assistantConversationService, type AssistantActionState, type AssistantCollection } from './assistantConversation.service';
import { ProspectWorkflowService } from './prospectWorkflow.service';
import { CotizacionWorkflowService } from './cotizacionWorkflow.service';
import { CotizacionConversionService } from './cotizacionConversion.service';
import { ExpedienteActivityService } from './expedienteActivity.service';
import { ExpedienteActosService } from './expedienteActos.service';
import { ExpedientePartiesService } from './expedienteParties.service';
import { ExpedientePrediosService } from './expedientePredios.service';
import { ExpedienteSeguimientoService } from './expedienteSeguimiento.service';
import { ExpedienteBudgetService } from './expedienteBudget.service';
import { ExpedienteFinanceService } from './expedienteFinance.service';
import { ExpedienteArtifactsService } from './expedienteArtifacts.service';
import { complianceH9Service } from './complianceH9.service';
import { actsAndTimesService } from './configurationCatalog.service';
import { functionalDestinationService } from './functionalDestination.service';
import { ProjectGenerationError, ProjectGenerationService } from './projectGeneration.service';
import { ProjectRepository } from './projectRepository.service';
import { QuoteBudgetService, quoteBudgetPayload } from './quoteBudget.service';
import { quoteDocumentService } from './quoteDocument.service';
import { ExpedienteDocumentAppendixService } from './expedienteDocumentAppendix.service';
import { ISRService } from './isr.service';
import { budgetTotals, normalizeBudgetConcepts } from '../domain/expedienteBudget';
import { ProspectWorkflowError } from '../domain/prospectWorkflow';
import { ComparecienteService } from './compareciente.service';
import { PrediosService } from './predios.service';
import type { AssistantActionLevel } from './assistantTools.service';

type Actor = NonNullable<Request['user']>;
export type AssistantActionRisk = 'READ' | 'SAFE_WRITE' | 'SENSITIVE_WRITE' | 'DESTRUCTIVE';
export type AssistantActionContext = {
  entityType?: string;
  entityId?: string;
  module?: string;
  route?: string;
  projectDraft?: { instructions?: string; templateVersionId?: string; sourceDocumentIds?: string[] };
  requestMessage?: string;
  attachmentIds?: string[];
  attachmentFacts?: Array<{ field: string; value: string; confidence?: string; attachmentId: string }>;
};

type FieldType = 'string' | 'number' | 'boolean' | 'string[]' | 'object';
type Field = { type: FieldType; required?: boolean; enum?: readonly string[]; max?: number };
type ActionResult = { entityType: string; entityId?: string; message: string; refresh: string; details?: Array<{ label: string; value: string }> };
type ActionPreview = {
  object?: { type: string; id?: string; label?: string };
  before?: unknown;
  after?: unknown;
  impact?: string;
  guard?: { kind: string; id: string; version: string | number };
};
type ExecuteInput = { actor: Actor; conversationId: string; args: Record<string, any>; invocationId: string; correlationId: string; preview?: ActionPreview };
type Definition = {
  key: string;
  domain: string;
  description: string;
  permissions: string[];
  risk: AssistantActionRisk;
  confirmation: 'NONE' | 'REQUIRED' | 'REINFORCED';
  level?: AssistantActionLevel;
  confirmLabel?: string;
  fields: Record<string, Field>;
  contextField?: string;
  contextTypes?: string[];
  prepare?(input: Omit<ExecuteInput, 'invocationId' | 'correlationId' | 'conversationId'>): Promise<ActionPreview>;
  assertFresh?(input: ExecuteInput): Promise<void>;
  execute(input: ExecuteInput): Promise<ActionResult>;
};

const actionLevel = (definition: Definition): AssistantActionLevel => definition.level
  || (definition.domain.startsWith('CFG-') ? 'A'
    : definition.risk === 'SAFE_WRITE' ? 'E'
      : definition.risk === 'SENSITIVE_WRITE' || definition.risk === 'DESTRUCTIVE' ? 'S'
        : 'R');

const effectiveConfirmation = (definition: Definition, origin: 'USER_COMMAND' | 'PROACTIVE' = 'PROACTIVE') => {
  const level = actionLevel(definition);
  if (level === 'S' || level === 'A') return 'REINFORCED' as const;
  if (level === 'E' && origin === 'USER_COMMAND') return 'NONE' as const;
  if (level === 'E') return 'REQUIRED' as const;
  return definition.confirmation;
};

export class AssistantActionError extends Error {
  constructor(message: string, readonly code: string, readonly status = 400, readonly candidates?: string[]) {
    super(message);
    this.name = 'AssistantActionError';
  }
}

const safeText = (value: unknown, max = 2_000) => String(value ?? '').trim().slice(0, max);
const actionId = (parts: string[]) => createHash('sha256').update(parts.join(':')).digest('hex');
const displayValue = (value: unknown) => {
  if (Array.isArray(value)) return `${value.length} elemento(s)`;
  if (typeof value === 'object' && value) {
    const serialized = JSON.stringify(value, (_key, nested) => typeof nested === 'bigint' ? nested.toString() : nested);
    return serialized.length > 180 ? `${serialized.slice(0, 177)}…` : serialized;
  }
  return safeText(value, 120);
};
const visibleTotals = (concepts: unknown) => {
  const totals = budgetTotals(normalizeBudgetConcepts(concepts));
  return { honorarios: totals.honorarios, iva_honorarios: totals.iva_honorarios, subtotal_honorarios: totals.subtotal_honorarios, subtotal_impuestos_derechos: totals.subtotal_impuestos_derechos, total: totals.total };
};

const previewVersion = (input: ExecuteInput, fallback: number) => {
  const value = input.preview?.guard?.version;
  return typeof value === 'number' && Number.isInteger(value) ? value : fallback;
};

function hasPermissions(actor: Actor, permissions: string[]) {
  return actor.permissions.includes('ai.use') && actor.permissions.includes('ai.actions.prepare')
    && permissions.every((permission) => actor.permissions.includes(permission as any));
}

async function invokeAgenda(handler: (req: Request, res: Response) => Promise<any>, input: ExecuteInput, params: Record<string, string> = {}) {
  let status = 200;
  let payload: any;
  const req = { user: input.actor, body: input.args, params, query: {}, correlationId: input.correlationId } as unknown as Request;
  const res = {
    status(code: number) { status = code; return this; },
    json(value: unknown) { payload = value; return this; },
  } as unknown as Response;
  await handler(req, res);
  if (status >= 400 || !payload?.success) throw new AssistantActionError(
    status >= 500 ? 'No pude completar la acción. No hice cambios adicionales.' : safeText(payload?.error, 300) || 'No fue posible completar la acción.',
    safeText(payload?.code, 80) || 'AI_ACTION_FAILED', status,
  );
  return payload;
}

async function invokeProjectReview(input: ExecuteInput) {
  let status = 200;
  let payload: any;
  const req = { user: input.actor, body: { idempotency_key: input.invocationId }, params: { id: input.args.expediente_id }, query: {}, correlationId: input.correlationId, get: () => undefined } as unknown as Request;
  const res = {
    status(code: number) { status = code; return this; },
    json(value: unknown) { payload = value; return this; },
  } as unknown as Response;
  await analizarProyectoConIA(req, res);
  if (status >= 400 || !payload?.id) throw new AssistantActionError(
    status >= 500 ? 'No pude completar la revisión del proyecto. No hice cambios adicionales.' : safeText(payload?.error, 300) || 'No fue posible revisar el proyecto.',
    safeText(payload?.code, 80) || 'AI_PROJECT_REVIEW_FAILED', status,
  );
  return payload;
}

const definitions: Definition[] = [
  {
    key: 'agenda.event.create', domain: 'Agenda', description: 'Crear una cita o evento en Agenda.',
    permissions: ['agenda.write'], risk: 'SAFE_WRITE', confirmation: 'REQUIRED',
    fields: {
      titulo: { type: 'string', required: true, max: 180 }, tipo: { type: 'string', enum: ['PERSONAL','DESPACHO','FIRMA','AUDIENCIA','VENCIMIENTO','CITA','NOTARIA','SEGUIMIENTO','OTRO'] },
      fecha_inicio: { type: 'string', required: true, max: 50 }, fecha_fin: { type: 'string', max: 50 }, todo_el_dia: { type: 'boolean' }, descripcion: { type: 'string', max: 2_000 },
      responsable_id: { type: 'string', max: 80 }, expediente_id: { type: 'string', max: 80 }, expediente_query: { type: 'string', max: 120 }, compareciente_id: { type: 'string', max: 80 }, recordatorios: { type: 'object' },
    }, contextField: 'expediente_id', contextTypes: ['expediente'],
    async execute(input) {
      if (!input.args.tipo) input.args.tipo = 'CITA';
      input.args.idempotency_key = input.invocationId;
      const payload = await invokeAgenda(AgendaController.create, input);
      return { entityType: 'EventoAgenda', entityId: payload.evento?.id, message: 'Listo, el evento quedó creado en Agenda.', refresh: 'agenda', details: [{ label: 'Evento', value: safeText(payload.evento?.titulo || input.args.titulo, 180) }, { label: 'Fecha', value: safeText(payload.evento?.fecha_inicio || input.args.fecha_inicio, 80) }] };
    },
  },
  {
    key: 'agenda.event.update', domain: 'Agenda', description: 'Actualizar un evento accesible de Agenda.',
    permissions: ['agenda.write'], risk: 'SAFE_WRITE', confirmation: 'REQUIRED',
    fields: { event_id: { type: 'string', required: true, max: 80 }, titulo: { type: 'string', max: 180 }, tipo: { type: 'string', enum: ['PERSONAL','DESPACHO','FIRMA','AUDIENCIA','VENCIMIENTO','CITA','NOTARIA','SEGUIMIENTO','OTRO'] }, fecha_inicio: { type: 'string', max: 50 }, fecha_fin: { type: 'string', max: 50 }, todo_el_dia: { type: 'boolean' }, descripcion: { type: 'string', max: 2_000 }, responsable_id: { type: 'string', max: 80 }, expediente_id: { type: 'string', max: 80 }, compareciente_id: { type: 'string', max: 80 }, estatus: { type: 'string', enum: ['ACTIVO','COMPLETADO'] }, recordatorios: { type: 'object' } },
    contextField: 'event_id', contextTypes: ['evento'],
    async prepare({ actor, args }) {
      const event = await prisma.eventoAgenda.findFirst({ where: { id: args.event_id, organization_id: actor.organizationId, ...(!['DIRECCION', 'ADMINISTRACION'].includes(actor.rol) ? { user_id: actor.id } : {}) } });
      if (!event) throw new AssistantActionError('No tienes acceso a ese evento.', 'AI_ACTION_TARGET_DENIED', 403);
      const { event_id: _id, ...changes } = args;
      return { object: { type: 'EventoAgenda', id: event.id, label: event.titulo }, before: { titulo: event.titulo, tipo: event.tipo, fecha_inicio: event.fecha_inicio, fecha_fin: event.fecha_fin, estatus: event.estatus }, after: changes, impact: 'Actualizará el evento indicado en la Agenda.', guard: { kind: 'EVENT_UPDATED_AT', id: event.id, version: event.updated_at.toISOString() } };
    },
    async assertFresh(input) {
      const guard = input.preview?.guard;
      if (!guard) return;
      const current = await prisma.eventoAgenda.findFirst({ where: { id: guard.id, organization_id: input.actor.organizationId }, select: { updated_at: true } });
      if (!current || current.updated_at.toISOString() !== guard.version) throw new AssistantActionError('El evento cambió desde que preparé la acción. Revísalo y vuelve a confirmar.', 'AI_ACTION_STALE', 409);
    },
    async execute(input) {
      const payload = await invokeAgenda(AgendaController.update, input, { id: input.args.event_id });
      return { entityType: 'EventoAgenda', entityId: payload.evento?.id, message: 'Listo, el evento quedó actualizado.', refresh: 'agenda' };
    },
  },
  {
    key: 'agenda.event.cancel', domain: 'Agenda', description: 'Cancelar un evento de Agenda conservando su trazabilidad.',
    permissions: ['agenda.write'], risk: 'DESTRUCTIVE', confirmation: 'REQUIRED',
    fields: { event_id: { type: 'string', required: true, max: 80 }, motivo_cancelacion: { type: 'string', required: true, max: 500 } },
    contextField: 'event_id', contextTypes: ['evento'],
    async prepare({ actor, args }) {
      const event = await prisma.eventoAgenda.findFirst({ where: { id: args.event_id, organization_id: actor.organizationId, ...(!['DIRECCION', 'ADMINISTRACION'].includes(actor.rol) ? { user_id: actor.id } : {}) } });
      if (!event) throw new AssistantActionError('No tienes acceso a ese evento.', 'AI_ACTION_TARGET_DENIED', 403);
      return { object: { type: 'EventoAgenda', id: event.id, label: event.titulo }, before: { estatus: event.estatus }, after: { estatus: 'CANCELADO', motivo: args.motivo_cancelacion }, impact: 'Cancelará el evento y conservará su trazabilidad.', guard: { kind: 'EVENT_UPDATED_AT', id: event.id, version: event.updated_at.toISOString() } };
    },
    async assertFresh(input) {
      const guard = input.preview?.guard;
      if (!guard) return;
      const current = await prisma.eventoAgenda.findFirst({ where: { id: guard.id, organization_id: input.actor.organizationId }, select: { updated_at: true } });
      if (!current || current.updated_at.toISOString() !== guard.version) throw new AssistantActionError('El evento cambió desde que preparé la acción. Revísalo y vuelve a confirmar.', 'AI_ACTION_STALE', 409);
    },
    async execute(input) {
      const payload = await invokeAgenda(AgendaController.cancel, input, { id: input.args.event_id });
      return { entityType: 'EventoAgenda', entityId: payload.evento?.id, message: 'El evento quedó cancelado y conserva su historial.', refresh: 'agenda' };
    },
  },
  {
    key: 'prospect.create', domain: 'Prospectos', description: 'Crear un prospecto en la etapa inicial canónica.',
    permissions: ['prospectos.write'], risk: 'SAFE_WRITE', confirmation: 'REQUIRED',
    fields: { nombre: { type: 'string', required: true, max: 300 }, telefono: { type: 'string', max: 80 }, email: { type: 'string', max: 320 }, necesidad: { type: 'string', max: 2_000 }, prioridad: { type: 'string', enum: ['BAJA','MEDIA','ALTA'] }, servicio_catalogo_codigo: { type: 'string', max: 80 }, tiene_predial: { type: 'boolean' }, tiene_antecedente: { type: 'boolean' } },
    async execute(input) {
      const result = await new ProspectWorkflowService(prisma).create(input.actor, input.args, input.invocationId);
      return { entityType: 'Prospecto', entityId: result.prospecto.id, message: 'Listo, el prospecto quedó creado en la etapa inicial.', refresh: 'prospectos', details: [{ label: 'Prospecto', value: result.prospecto.nombre }] };
    },
  },
  {
    key: 'prospect.update', domain: 'Prospectos', description: 'Actualizar datos permitidos de un prospecto accesible.',
    permissions: ['prospectos.write'], risk: 'SAFE_WRITE', confirmation: 'REQUIRED',
    fields: { prospect_id: { type: 'string', required: true, max: 80 }, prospect_query: { type: 'string', max: 120 }, nombre: { type: 'string', max: 300 }, telefono: { type: 'string', max: 80 }, email: { type: 'string', max: 320 }, necesidad: { type: 'string', max: 2_000 }, prioridad: { type: 'string', enum: ['BAJA','MEDIA','ALTA'] }, servicio_catalogo_codigo: { type: 'string', max: 80 }, tiene_predial: { type: 'boolean' }, tiene_antecedente: { type: 'boolean' }, responsable_id: { type: 'string', max: 80 }, notaria_id: { type: 'string', max: 80 } },
    contextField: 'prospect_id', contextTypes: ['prospecto'],
    async prepare({ actor, args }) {
      const current = await new ProspectWorkflowService(prisma).read(actor, args.prospect_id);
      const { prospect_id: _id, prospect_query: _query, ...changes } = args;
      return { object: { type: 'Prospecto', id: args.prospect_id, label: current.folio || args.prospect_id }, before: { version: current.version, etapa: current.stage, estado_legacy: current.legacy.substate }, after: changes, impact: 'Actualizará únicamente los campos mostrados de la ficha del prospecto.', guard: { kind: 'PROSPECT_VERSION', id: args.prospect_id, version: current.version } };
    },
    async execute(input) {
      const service = new ProspectWorkflowService(prisma); const current = await service.read(input.actor, input.args.prospect_id);
      const { prospect_id: _id, prospect_query: _query, ...changes } = input.args;
      const result = await service.update(input.actor, input.args.prospect_id, { ...changes, expectedVersion: previewVersion(input, current.version) });
      return { entityType: 'Prospecto', entityId: result.id, message: 'Listo, la ficha del prospecto quedó actualizada.', refresh: 'prospectos' };
    },
  },
  {
    key: 'prospect.transition', domain: 'Prospectos', description: 'Ejecutar una transición contractual válida del prospecto.',
    permissions: ['prospectos.write'], risk: 'SENSITIVE_WRITE', confirmation: 'REQUIRED',
    fields: { prospect_id: { type: 'string', required: true, max: 80 }, prospect_query: { type: 'string', max: 120 }, action: { type: 'string', required: true, max: 80 }, effectiveAt: { type: 'string', max: 50 }, channel: { type: 'string', max: 100 }, recipient: { type: 'string', max: 320 }, evidence: { type: 'string', max: 2_000 }, reason: { type: 'string', max: 500 }, attachmentIds: { type: 'string[]' }, documentId: { type: 'string', max: 80 } },
    contextField: 'prospect_id', contextTypes: ['prospecto'],
    async prepare({ actor, args }) {
      const current = await new ProspectWorkflowService(prisma).read(actor, args.prospect_id);
      return { object: { type: 'Prospecto', id: args.prospect_id, label: current.folio || args.prospect_id }, before: { etapa: current.stage, version: current.version }, after: { action: args.action, effectiveAt: args.effectiveAt }, impact: 'Aplicará una transición contractual del flujo Prospecto → Cotización.', guard: { kind: 'PROSPECT_VERSION', id: args.prospect_id, version: current.version } };
    },
    async execute(input) {
      const service = new ProspectWorkflowService(prisma); const current = await service.read(input.actor, input.args.prospect_id);
      const { prospect_id: _id, prospect_query: _query, ...command } = input.args;
      const result = await service.act(input.actor, input.args.prospect_id, { ...command, expectedVersion: previewVersion(input, current.version), idempotencyKey: input.invocationId, confirm: true });
      return { entityType: 'Prospecto', entityId: input.args.prospect_id, message: 'La transición del prospecto quedó registrada.', refresh: 'prospectos', details: result.quoteId ? [{ label: 'Resultado', value: 'Cotización creada mediante el flujo canónico' }] : undefined };
    },
  },
  {
    key: 'quote.transition', domain: 'Cotizaciones', description: 'Registrar un hito o transición válida de una cotización.',
    permissions: ['cotizaciones.write'], risk: 'SENSITIVE_WRITE', confirmation: 'REQUIRED',
    fields: { quote_id: { type: 'string', required: true, max: 80 }, quote_query: { type: 'string', max: 120 }, action: { type: 'string', required: true, max: 80 }, effectiveAt: { type: 'string', max: 50 }, channel: { type: 'string', max: 100 }, recipient: { type: 'string', max: 320 }, evidence: { type: 'string', max: 2_000 }, reason: { type: 'string', max: 500 }, versionId: { type: 'string', max: 80 } },
    contextField: 'quote_id', contextTypes: ['cotizacion'],
    async prepare({ actor, args }) {
      const current = await new CotizacionWorkflowService(prisma).read(actor, args.quote_id);
      return { object: { type: 'Cotizacion', id: args.quote_id, label: current.originProspect?.nombre || args.quote_id }, before: { etapa: current.stage, version: current.version }, after: { action: args.action, effectiveAt: args.effectiveAt }, impact: 'Registrará un hito contractual de la cotización.', guard: { kind: 'QUOTE_VERSION', id: args.quote_id, version: current.version } };
    },
    async execute(input) {
      const service = new CotizacionWorkflowService(prisma); const current = await service.read(input.actor, input.args.quote_id);
      const { quote_id: _id, quote_query: _query, ...command } = input.args;
      await service.act(input.actor, input.args.quote_id, { ...command, expectedVersion: previewVersion(input, current.version), idempotencyKey: input.invocationId, confirm: true });
      return { entityType: 'Cotizacion', entityId: input.args.quote_id, message: 'La transición de la cotización quedó registrada.', refresh: 'cotizaciones' };
    },
  },
  {
    key: 'quote.convert_to_case', domain: 'Cotizaciones', description: 'Convertir una cotización elegible en expediente.',
    permissions: ['cotizaciones.write', 'expedientes.write'], risk: 'SENSITIVE_WRITE', confirmation: 'REQUIRED',
    fields: { quote_id: { type: 'string', required: true, max: 80 }, quote_query: { type: 'string', max: 120 }, abogado_id: { type: 'string', max: 80 }, tipo_acto_id: { type: 'string', max: 80 }, effectiveAt: { type: 'string', required: true, max: 50 } },
    contextField: 'quote_id', contextTypes: ['cotizacion'],
    async prepare({ actor, args }) {
      const current = await new CotizacionWorkflowService(prisma).read(actor, args.quote_id);
      return { object: { type: 'Cotizacion', id: args.quote_id, label: current.originProspect?.nombre || args.quote_id }, before: { etapa: current.stage, version: current.version }, after: { resultado: 'Expediente vinculado' }, impact: 'Creará como máximo un expediente mediante la conversión canónica e idempotente.', guard: { kind: 'QUOTE_VERSION', id: args.quote_id, version: current.version } };
    },
    async execute(input) {
      const current = await new CotizacionWorkflowService(prisma).read(input.actor, input.args.quote_id);
      const result = await new CotizacionConversionService(prisma).convert({ cotizacionId: input.args.quote_id, actor: input.actor, actorUserId: input.actor.id, actorOrganizationId: input.actor.organizationId, actorSessionId: input.actor.sessionId, abogadoId: input.args.abogado_id, tipoActoId: input.args.tipo_acto_id, effectiveAt: input.args.effectiveAt, expectedVersion: previewVersion(input, current.version), idempotencyKey: input.invocationId, confirm: true, correlationId: input.correlationId });
      return { entityType: 'Expediente', entityId: result.expediente.id, message: result.alreadyConverted ? 'La cotización ya estaba vinculada a su expediente.' : 'Listo, la cotización quedó convertida mediante el flujo canónico.', refresh: 'expedientes', details: [{ label: 'Expediente', value: result.expediente.numero_pravia }] };
    },
  },
  {
    key: 'quote.budget.add_concept', domain: 'Cotizaciones', description: 'Agregar un concepto al presupuesto estructurado de una cotización.',
    permissions: ['cotizaciones.write'], risk: 'SENSITIVE_WRITE', confirmation: 'REQUIRED',
    fields: {
      quote_id: { type: 'string', required: true, max: 80 }, quote_query: { type: 'string', max: 120 },
      concepto: { type: 'string', required: true, max: 240 }, categoria: { type: 'string', required: true, enum: ['HONORARIOS','IVA_HONORARIOS','IMPUESTOS_DERECHOS'] },
      importe: { type: 'string', required: true, max: 30 },
    },
    contextField: 'quote_id', contextTypes: ['cotizacion'],
    async prepare({ actor, args }) {
      const quote = await prisma.cotizacion.findFirst({ where: { id: args.quote_id, ...cotizacionObjectWhere(actor) }, include: { conceptos: { orderBy: { orden: 'asc' } } } });
      if (!quote) throw new AssistantActionError('No tienes acceso a esa cotización.', 'AI_ACTION_TARGET_DENIED', 403);
      const next = [...quote.conceptos.map((item) => ({ id: item.id, concepto: item.concepto, categoria: item.categoria, importe: String(item.importe) })), { concepto: args.concepto, categoria: args.categoria, importe: args.importe }];
      return {
        object: { type: 'Cotizacion', id: quote.id, label: quote.numero_cotizacion || quote.numero_solicitud || quote.id },
        before: quoteBudgetPayload(quote.conceptos), after: { concepts: next, totals: visibleTotals(next) },
        impact: 'Agregará el concepto y recalculará subtotal y total sin cambiar la etapa contractual.',
        guard: { kind: 'QUOTE_UPDATED_AT', id: quote.id, version: quote.updated_at.toISOString() },
      };
    },
    async execute(input) {
      const quote = await prisma.cotizacion.findFirst({ where: { id: input.args.quote_id, ...cotizacionObjectWhere(input.actor) }, include: { conceptos: { orderBy: { orden: 'asc' } } } });
      if (!quote) throw new AssistantActionError('No tienes acceso a esa cotización.', 'AI_ACTION_TARGET_DENIED', 403);
      const concepts = [...quote.conceptos.map((item) => ({ id: item.id, concepto: item.concepto, categoria: item.categoria, importe: String(item.importe) })), { concepto: input.args.concepto, categoria: input.args.categoria, importe: input.args.importe }];
      const result = await new QuoteBudgetService(prisma).save(input.actor, quote.id, { concepts, origin: 'MANUAL', expectedUpdatedAt: String(input.preview?.guard?.version || '') });
      return { entityType: 'Cotizacion', entityId: quote.id, message: 'El concepto quedó agregado y el total de la cotización fue recalculado.', refresh: 'cotizaciones', details: [{ label: 'Total', value: String(result.presupuesto.totals.total) }] };
    },
  },
  {
    key: 'quote.document.generate', domain: 'Cotizaciones', description: 'Generar la cotización documental mediante el formato CFG-002 vigente.',
    permissions: ['cotizaciones.write', 'documentos.write'], risk: 'SENSITIVE_WRITE', confirmation: 'REQUIRED',
    fields: { quote_id: { type: 'string', required: true, max: 80 }, quote_query: { type: 'string', max: 120 } },
    contextField: 'quote_id', contextTypes: ['cotizacion'],
    async prepare({ actor, args }) {
      const quote = await prisma.cotizacion.findFirst({ where: { id: args.quote_id, ...cotizacionObjectWhere(actor) }, include: { conceptos: { orderBy: { orden: 'asc' } } } });
      if (!quote) throw new AssistantActionError('No tienes acceso a esa cotización.', 'AI_ACTION_TARGET_DENIED', 403);
      if (!quote.conceptos.length) throw new AssistantActionError('Captura el presupuesto estructurado antes de generar la cotización.', 'AI_QUOTE_BUDGET_REQUIRED', 409);
      return { object: { type: 'Cotizacion', id: quote.id, label: quote.numero_cotizacion || quote.numero_solicitud || quote.id }, before: { documentos_generados: 'Sin nueva versión' }, after: { formato: 'CFG-002:COTIZACION_SERVICIOS', presupuesto: quoteBudgetPayload(quote.conceptos) }, impact: 'Generará una nueva versión documental; no modificará los importes ni la etapa.', guard: { kind: 'QUOTE_UPDATED_AT', id: quote.id, version: quote.updated_at.toISOString() } };
    },
    async assertFresh(input) {
      const guard = input.preview?.guard;
      const quote = guard ? await prisma.cotizacion.findFirst({ where: { id: guard.id, ...cotizacionObjectWhere(input.actor) }, select: { updated_at: true } }) : null;
      if (!quote || quote.updated_at.toISOString() !== guard?.version) throw new AssistantActionError('La cotización cambió desde que preparé la generación. Actualiza y vuelve a confirmar.', 'AI_ACTION_STALE', 409);
    },
    async execute(input) {
      const document = await quoteDocumentService.generate(input.actor, input.args.quote_id, { idempotencyKey: input.invocationId });
      return { entityType: 'Documento', entityId: document.id, message: 'La cotización documental quedó generada con el formato CFG-002 vigente.', refresh: 'cotizaciones', details: [{ label: 'Documento', value: document.nombre_original }] };
    },
  },
  {
    key: 'case.add_note', domain: 'Expedientes', description: 'Agregar una nota operativa al expediente actual.',
    permissions: ['expedientes.write'], risk: 'SAFE_WRITE', confirmation: 'REQUIRED',
    fields: { expediente_id: { type: 'string', required: true, max: 80 }, expediente_query: { type: 'string', max: 120 }, note: { type: 'string', required: true, max: 2_000 } },
    contextField: 'expediente_id', contextTypes: ['expediente'],
    async execute(input) {
      const result = await new ExpedienteActivityService(prisma).addNote(input.actor, input.args.expediente_id, { note: input.args.note, idempotency_key: input.invocationId });
      return { entityType: 'ExpedienteActividad', entityId: result.item.id, message: 'Listo, la nota quedó registrada en la actividad del expediente.', refresh: 'actividad' };
    },
  },
  {
    key: 'case.add_act', domain: 'Expedientes', description: 'Agregar un acto al expediente mediante preview canónico.',
    permissions: ['expedientes.write'], risk: 'SENSITIVE_WRITE', confirmation: 'REQUIRED',
    fields: { expediente_id: { type: 'string', required: true, max: 80 }, expediente_query: { type: 'string', max: 120 }, tipo_acto_id: { type: 'string', required: true, max: 80 } },
    contextField: 'expediente_id', contextTypes: ['expediente'],
    async execute(input) {
      const service = new ExpedienteActosService(prisma); const command = { operation: 'ADD' as const, tipo_acto_id: input.args.tipo_acto_id };
      const preview = await service.preview(input.actor, input.args.expediente_id, command);
      const result = await service.apply(input.actor, input.args.expediente_id, { ...command, idempotency_key: input.invocationId, preview_fingerprint: preview.fingerprint, confirm_protected_work: true });
      return { entityType: 'ExpedienteActo', entityId: result.acto.id, message: 'El acto quedó agregado al expediente.', refresh: 'actos' };
    },
  },
  {
    key: 'party.create', domain: 'Comparecientes', description: 'Crear un compareciente en el maestro de la organización.',
    permissions: ['comparecientes.write'], risk: 'SENSITIVE_WRITE', confirmation: 'REQUIRED',
    fields: {
      tipo_persona: { type: 'string', required: true, enum: ['FISICA', 'MORAL'] }, nombre: { type: 'string', required: true, max: 300 },
      apellido_paterno: { type: 'string', max: 180 }, apellido_materno: { type: 'string', max: 180 }, rfc: { type: 'string', max: 20 },
      curp: { type: 'string', max: 24 }, telefono: { type: 'string', max: 60 }, correo: { type: 'string', max: 240 }, observaciones: { type: 'string', max: 2_000 },
    },
    async execute(input) {
      const service = new ComparecienteService(prisma);
      const created = input.args.tipo_persona === 'MORAL'
        ? await service.crearPersonaMoral({
          razon_social: input.args.nombre, rfc: input.args.rfc, telefono: input.args.telefono,
          correo: input.args.correo, observaciones: input.args.observaciones, creado_por_id: input.actor.id,
        })
        : await service.crearPersonaFisica({
          nombre: input.args.nombre, apellido_paterno: input.args.apellido_paterno, apellido_materno: input.args.apellido_materno,
          rfc: input.args.rfc, curp: input.args.curp, telefono: input.args.telefono, correo: input.args.correo,
          observaciones: input.args.observaciones, creado_por_id: input.actor.id,
        });
      return {
        entityType: 'Compareciente', entityId: created.compareciente.id,
        message: 'El compareciente quedó creado en el maestro de la organización.', refresh: 'comparecientes',
        details: [{ label: 'Compareciente', value: input.args.nombre }, { label: 'Tipo', value: input.args.tipo_persona === 'MORAL' ? 'Persona moral' : 'Persona física' }],
      };
    },
  },
  {
    key: 'party.link_to_case', domain: 'Comparecientes', description: 'Vincular un compareciente a un acto del expediente.',
    permissions: ['expedientes.write', 'comparecientes.read'], risk: 'SENSITIVE_WRITE', confirmation: 'REQUIRED',
    fields: { expediente_id: { type: 'string', required: true, max: 80 }, expediente_query: { type: 'string', max: 120 }, expediente_acto_id: { type: 'string', required: true, max: 80 }, compareciente_id: { type: 'string', required: true, max: 80 }, caracter_id: { type: 'string', required: true, max: 80 }, forma_comparecencia: { type: 'string', required: true, max: 80 }, participacion_porcentaje: { type: 'number' } },
    contextField: 'expediente_id', contextTypes: ['expediente'],
    async execute(input) {
      const service = new ExpedientePartiesService(prisma); const command: any = { operation: 'LINK', expediente_acto_id: input.args.expediente_acto_id, compareciente_id: input.args.compareciente_id, caracter_id: input.args.caracter_id, forma_comparecencia: input.args.forma_comparecencia, participacion_porcentaje: input.args.participacion_porcentaje };
      const preview = await service.preview(input.actor, input.args.expediente_id, command);
      const result = await service.apply(input.actor, input.args.expediente_id, { ...command, idempotency_key: input.invocationId, preview_fingerprint: preview.fingerprint, confirm_protected_work: true });
      return { entityType: 'ExpedienteCompareciente', entityId: result.relation.id, message: 'El compareciente quedó vinculado al acto indicado.', refresh: 'comparecientes' };
    },
  },
  {
    key: 'party.extract_information', domain: 'Comparecientes', description: 'Extraer propuestas de los documentos vigentes de un compareciente sin guardar datos maestros.',
    permissions: ['comparecientes.write', 'documentos.read', 'ia.execute'], risk: 'SENSITIVE_WRITE', confirmation: 'REQUIRED',
    fields: { compareciente_id: { type: 'string', required: true, max: 80 } }, contextField: 'compareciente_id', contextTypes: ['compareciente'],
    async prepare({ actor, args }) {
      if (!(await canAccessCompareciente(actor, args.compareciente_id))) throw new AssistantActionError('No tienes acceso a ese compareciente.', 'AI_ACTION_TARGET_DENIED', 403);
      const documents = await prisma.comparecienteDocumento.findMany({ where: { organization_id: actor.organizationId, compareciente_id: args.compareciente_id, archived_at: null, estatus: 'ACTIVO', vigencia: 'VIGENTE' }, select: { documento: { select: { id: true, nombre_original: true } } } });
      if (!documents.length) throw new AssistantActionError('Carga al menos un documento vigente antes de extraer información.', 'AI_PARTY_DOCUMENT_REQUIRED', 409);
      return { object: { type: 'Compareciente', id: args.compareciente_id }, before: { datos_maestros_modificados: false }, after: { documentos: documents.map((item) => item.documento.nombre_original), resultado: 'Propuestas sujetas a revisión humana' }, impact: 'Analizará documentos autorizados y guardará sólo propuestas con procedencia; no modificará la ficha maestra.' };
    },
    async execute(input) {
      if (!(await canAccessCompareciente(input.actor, input.args.compareciente_id))) throw new AssistantActionError('No tienes acceso a ese compareciente.', 'AI_ACTION_TARGET_DENIED', 403);
      const result = await new ComparecienteService(prisma).extraerDocumentosExistentesConIA(input.args.compareciente_id, input.actor.id, input.actor.organizationId);
      return { entityType: 'Compareciente', entityId: input.args.compareciente_id, message: 'La extracción terminó. Revisa y confirma cada propuesta en la ficha; no se modificaron datos maestros.', refresh: 'comparecientes', details: [{ label: 'Propuestas', value: String(Object.keys(result.proposals || {}).length) }, { label: 'Conflictos', value: String(result.conflicts?.length || 0) }] };
    },
  },
  {
    key: 'property.create', domain: 'Predios', description: 'Crear un inmueble en el maestro de la organización.',
    permissions: ['expedientes.write'], risk: 'SENSITIVE_WRITE', confirmation: 'REQUIRED',
    fields: {
      ubicacion_texto: { type: 'string', required: true, max: 500 }, apodo: { type: 'string', max: 180 },
      clave_catastral: { type: 'string', max: 180 }, cuenta_predial: { type: 'string', max: 180 }, folio_real: { type: 'string', max: 180 },
      codigo_postal: { type: 'string', max: 20 }, municipio: { type: 'string', max: 180 }, estado: { type: 'string', max: 180 },
      descripcion: { type: 'string', max: 2_000 }, valor_operacion: { type: 'number' }, valor_catastral: { type: 'number' }, valor_avaluo: { type: 'number' },
    },
    async execute(input) {
      const created = await new PrediosService(prisma).create(input.actor, input.args);
      return {
        entityType: 'Predio', entityId: created.id,
        message: 'El inmueble quedó creado en el maestro de la organización.', refresh: 'predios',
        details: [{ label: 'Inmueble', value: created.apodo || created.ubicacion_texto || created.id }],
      };
    },
  },
  {
    key: 'property.link_to_case', domain: 'Predios', description: 'Vincular un predio existente al expediente y sus actos.',
    permissions: ['expedientes.write'], risk: 'SENSITIVE_WRITE', confirmation: 'REQUIRED',
    fields: { expediente_id: { type: 'string', required: true, max: 80 }, expediente_query: { type: 'string', max: 120 }, predio_id: { type: 'string', required: true, max: 80 }, expediente_acto_ids: { type: 'string[]', required: true } },
    contextField: 'expediente_id', contextTypes: ['expediente'],
    async execute(input) {
      const service = new ExpedientePrediosService(prisma); const command = { operation: 'LINK' as const, predio_id: input.args.predio_id, expediente_acto_ids: input.args.expediente_acto_ids };
      const preview = await service.preview(input.actor, input.args.expediente_id, command);
      const result = await service.apply(input.actor, input.args.expediente_id, { ...command, idempotency_key: input.invocationId, preview_fingerprint: preview.fingerprint, confirm_protected_work: true });
      return { entityType: 'ExpedientePredio', entityId: result.relation.id, message: 'El predio quedó vinculado mediante la relación canónica.', refresh: 'predios' };
    },
  },
  {
    key: 'property.extract_information', domain: 'Predios', description: 'Extraer propuestas desde documentos vigentes de un predio sin guardar datos maestros.',
    permissions: ['expedientes.write', 'documentos.read', 'ia.execute'], risk: 'SENSITIVE_WRITE', confirmation: 'REQUIRED',
    fields: { predio_id: { type: 'string', required: true, max: 80 }, document_ids: { type: 'string[]', required: true } }, contextField: 'predio_id', contextTypes: ['predio'],
    async prepare({ actor, args }) {
      const property = await new PrediosService(prisma).get(actor, args.predio_id);
      const ids = new Set(args.document_ids);
      const documents = property.documentos.filter((item: any) => ids.has(item.documento_id) && item.estatus === 'ACTIVO' && item.vigencia === 'VIGENTE');
      if (!ids.size || documents.length !== ids.size) throw new AssistantActionError('Selecciona únicamente documentos vigentes del inmueble.', 'AI_PROPERTY_DOCUMENT_REQUIRED', 409);
      return { object: { type: 'Predio', id: property.id, label: property.apodo || property.folio_real || property.ubicacion_texto || property.id }, before: { version: property.version, datos_maestros_modificados: false }, after: { documentos: documents.map((item: any) => item.documento.nombre_original), resultado: 'Propuestas sujetas a revisión humana' }, impact: 'Analizará los documentos seleccionados y guardará sólo propuestas; ningún dato maestro se aplica automáticamente.', guard: { kind: 'PREDIO_VERSION', id: property.id, version: property.version } };
    },
    async execute(input) {
      const current = await new PrediosService(prisma).get(input.actor, input.args.predio_id);
      if (Number(input.preview?.guard?.version) !== current.version) throw new AssistantActionError('El inmueble cambió desde la vista previa. Actualiza y vuelve a confirmar.', 'AI_ACTION_STALE', 409);
      const result = await new PrediosService(prisma).proposeFromDocument(input.actor, input.args.predio_id, input.args.document_ids);
      return { entityType: 'Predio', entityId: input.args.predio_id, message: 'La extracción terminó. Revisa y confirma cada propuesta en la ficha; no se modificaron datos maestros.', refresh: 'predios', details: [{ label: 'Propuestas', value: String(result.propuestas.length) }, { label: 'Conflictos', value: String(result.conflictos.length) }] };
    },
  },
  {
    key: 'document.attach_uploaded', domain: 'Documentos', description: 'Incorporar los archivos adjuntos del chat al registro operativo actual.',
    permissions: ['documentos.write'], risk: 'SENSITIVE_WRITE', confirmation: 'REQUIRED',
    fields: {
      attachment_ids: { type: 'string[]', required: true },
      target_type: { type: 'string', required: true, enum: ['EXPEDIENTE','COTIZACION','PROSPECTO','COMPARECIENTE','PREDIO'] },
      target_id: { type: 'string', required: true, max: 80 }, tipo_documento: { type: 'string', required: true, max: 120 },
    },
    async prepare({ actor, args }) {
      let label = '';
      if (args.target_type === 'EXPEDIENTE') {
        const record = await prisma.expediente.findFirst({ where: { id: args.target_id, archived_at: null, ...expedienteAccessWhere(actor) }, select: { numero_pravia: true } });
        label = record?.numero_pravia || '';
      } else if (args.target_type === 'COTIZACION') {
        const record = await prisma.cotizacion.findFirst({ where: { id: args.target_id, ...cotizacionObjectWhere(actor) }, select: { numero_cotizacion: true } });
        label = record?.numero_cotizacion || '';
      } else if (args.target_type === 'PROSPECTO') {
        const record = await prisma.prospecto.findFirst({ where: { id: args.target_id, archived_at: null, ...prospectoObjectWhere(actor) }, select: { folio: true, nombre: true } });
        label = record ? record.folio || record.nombre : '';
      } else if (args.target_type === 'COMPARECIENTE') {
        if (await canAccessCompareciente(actor, args.target_id)) {
          const record = await prisma.compareciente.findFirst({ where: { id: args.target_id, organization_id: actor.organizationId }, select: { nombre_busqueda: true } });
          label = record?.nombre_busqueda || '';
        }
      } else if (args.target_type === 'PREDIO') {
        const record = await new PrediosService(prisma).get(actor, args.target_id).catch(() => null);
        label = record ? record.apodo || record.folio_real || record.ubicacion_texto || '' : '';
      }
      if (!label) throw new AssistantActionError('No tienes acceso al registro de destino.', 'AI_ACTION_TARGET_DENIED', 403);
      return {
        object: { type: args.target_type, id: args.target_id, label: `${args.target_type} · ${label}` },
        after: { archivos: args.attachment_ids.length, tipo_documental: args.tipo_documento },
        impact: 'Incorporará todos los archivos de forma atómica como documentos oficiales; conservará su procedencia de PRAVIA IA sin duplicar los blobs.',
      };
    },
    async execute(input) {
      const results = await prisma.$transaction(async (tx) => {
        const promoted = [];
        for (const attachmentId of input.args.attachment_ids) {
          promoted.push(await assistantConversationService.promoteAttachment(input.actor, input.conversationId, attachmentId, {
            targetType: input.args.target_type, targetId: input.args.target_id, documentType: input.args.tipo_documento,
          }, tx));
        }
        return promoted;
      });
      return {
        entityType: input.args.target_type, entityId: input.args.target_id,
        message: `${results.length} archivo(s) quedaron incorporados al registro con trazabilidad de PRAVIA IA.`, refresh: 'documentos',
        details: [{ label: 'Archivos incorporados', value: String(results.length) }],
      };
    },
  },
  {
    key: 'document.generate', domain: 'Documentos', description: 'Generar una nueva versión de un formato documental pendiente.',
    permissions: ['expedientes.write', 'documentos.write'], risk: 'SENSITIVE_WRITE', confirmation: 'REQUIRED',
    fields: { expediente_id: { type: 'string', required: true, max: 80 }, expediente_query: { type: 'string', max: 120 }, pending_id: { type: 'string', required: true, max: 80 }, document_ids: { type: 'string[]' } },
    contextField: 'expediente_id', contextTypes: ['expediente'],
    async execute(input) {
      const service = new ExpedienteArtifactsService(prisma); const preview = await service.generationPreview(input.actor, input.args.expediente_id, input.args.pending_id, input.args.document_ids);
      const result = await service.generate(input.actor, input.args.expediente_id, input.args.pending_id, { expected_version: preview.pending_version, source_revision: preview.source_revision, idempotency_key: input.invocationId, document_ids: input.args.document_ids });
      return { entityType: 'Documento', entityId: result.document_id, message: 'El formato quedó generado como nueva evidencia pendiente de revisión humana.', refresh: 'documentos' };
    },
  },
  {
    key: 'document.import_current', domain: 'Documentos', description: 'Importar al expediente los documentos vigentes de comparecientes o predios.',
    permissions: ['expedientes.write', 'documentos.read'], risk: 'SENSITIVE_WRITE', confirmation: 'REQUIRED',
    fields: { expediente_id: { type: 'string', required: true, max: 80 }, expediente_query: { type: 'string', max: 120 }, origin: { type: 'string', required: true, enum: ['COMPARECIENTE','PREDIO'] } },
    contextField: 'expediente_id', contextTypes: ['expediente'],
    async prepare({ actor, args }) {
      const preview = await new ExpedienteDocumentAppendixService(prisma).importPreview(actor, args.expediente_id, args.origin);
      return { object: { type: 'Expediente', id: args.expediente_id }, before: { importados: 0 }, after: preview, impact: 'Vinculará referencias vigentes sin copiar blobs ni crear duplicados físicos.' };
    },
    async execute(input) {
      const result = await new ExpedienteDocumentAppendixService(prisma).importCurrent(input.actor, input.args.expediente_id, input.args.origin);
      return { entityType: 'Expediente', entityId: input.args.expediente_id, message: 'La importación documental terminó sin duplicar archivos físicos.', refresh: 'documentos', details: [{ label: 'Nuevos', value: String(result.import.new) }, { label: 'Actualizados', value: String(result.import.updated) }, { label: 'Sin cambios', value: String(result.import.unchanged) }] };
    },
  },
  {
    key: 'project.generate', domain: 'Proyecto', description: 'Generar un proyecto con EXP-010 y el machote CFG-002 aplicable.',
    permissions: ['expedientes.write', 'expedientes.project.read', 'documentos.write', 'ia.execute'], risk: 'SENSITIVE_WRITE', confirmation: 'REQUIRED',
    confirmLabel: 'Generar proyecto',
    fields: { expediente_id: { type: 'string', required: true, max: 80 }, expediente_query: { type: 'string', max: 120 }, template_version_id: { type: 'string', max: 80 }, source_document_ids: { type: 'string[]' }, instructions: { type: 'string', max: 4_000 } },
    contextField: 'expediente_id', contextTypes: ['expediente', 'proyecto'],
    async prepare({ actor, args }) {
      const expediente = await prisma.expediente.findFirst({ where: { id: args.expediente_id, archived_at: null, ...expedienteAccessWhere(actor) }, select: { id: true, numero_pravia: true, updated_at: true } });
      if (!expediente) throw new AssistantActionError('No tienes acceso a ese expediente.', 'AI_ACTION_TARGET_DENIED', 403);
      const workspace = await new ProjectGenerationService().workspace(actor, expediente.id);
      const selected = args.template_version_id
        ? workspace.templates.flatMap((item: any) => item.versions.map((version: any) => ({ ...version, artifact: item }))).find((version: any) => version.id === args.template_version_id)
        : workspace.templates.flatMap((item: any) => item.versions.map((version: any) => ({ ...version, artifact: item }))).find((version: any) => version.artifact.default) || workspace.templates[0]?.versions[0];
      if (!selected) throw new AssistantActionError('No existe un machote CFG-002 aplicable para proyectar este expediente.', 'AI_PROJECT_TEMPLATE_MISSING', 409);
      const requestedSources = Array.isArray(args.source_document_ids) ? args.source_document_ids : workspace.sources.documents.filter((item: any) => item.selected_by_default).map((item: any) => item.documento.id);
      return { object: { type: 'Expediente', id: expediente.id, label: expediente.numero_pravia }, before: { proyecto: 'Sin nueva versión generada' }, after: { expediente: workspace.expediente.folio, acto: workspace.expediente.acts.map((item: any) => item.name).join(', ') || 'Sin acto', machote: selected.artifact?.name || selected.name, version_machote: selected.version, fuentes: requestedSources.length, instrucciones: args.instructions || 'Sin indicaciones adicionales', pendientes_detectables: workspace.pending_detectable_count }, impact: 'Creará una nueva versión de proyecto mediante EXP-010; no reemplazará ni editará silenciosamente las fuentes.', guard: { kind: 'EXPEDIENTE_UPDATED_AT', id: expediente.id, version: expediente.updated_at.toISOString() } };
    },
    async assertFresh(input) {
      const guard = input.preview?.guard;
      if (!guard) return;
      const current = await prisma.expediente.findFirst({ where: { id: guard.id, archived_at: null, ...expedienteAccessWhere(input.actor) }, select: { updated_at: true } });
      if (!current || current.updated_at.toISOString() !== guard.version) throw new AssistantActionError('El expediente cambió desde la vista previa. Actualiza el contexto y vuelve a confirmar.', 'AI_ACTION_STALE', 409);
    },
    async execute(input) {
      const workspace = await new ProjectGenerationService().workspace(input.actor, input.args.expediente_id);
      const selectedVersion = input.args.template_version_id || workspace.templates.flatMap((item: any) => item.versions.map((version: any) => ({ ...version, default: item.default }))).find((version: any) => version.default)?.id || workspace.templates[0]?.versions[0]?.id;
      const sourceIds = Array.isArray(input.args.source_document_ids) ? input.args.source_document_ids : workspace.sources.documents.filter((item: any) => item.selected_by_default).map((item: any) => item.documento.id);
      const result = await new ProjectGenerationService().generate(input.actor, input.args.expediente_id, { template_version_id: selectedVersion, source_document_ids: sourceIds, instructions: input.args.instructions || null, origin: 'PRAVIA_IA', idempotency_key: input.invocationId });
      return { entityType: 'Expediente', entityId: input.args.expediente_id, message: 'El proyecto quedó generado mediante EXP-010 y está listo para revisión.', refresh: 'proyecto', details: [{ label: 'Versión', value: String((result.version as any)?.version_numero || 'Nueva') }, { label: 'Pendientes', value: String(result.pending_count) }, { label: 'Observaciones', value: String(result.generation_observation_count + result.residual_observation_count) }] };
    },
  },
  {
    key: 'project.review', domain: 'Proyecto', description: 'Revisar el proyecto vigente contra sus fuentes y generar un reporte de observaciones.',
    permissions: ['expedientes.project.read', 'documentos.write', 'ia.execute'], risk: 'SENSITIVE_WRITE', confirmation: 'REQUIRED',
    fields: { expediente_id: { type: 'string', required: true, max: 80 }, expediente_query: { type: 'string', max: 120 } },
    contextField: 'expediente_id', contextTypes: ['expediente', 'proyecto'],
    async prepare({ actor, args }) {
      const expediente = await prisma.expediente.findFirst({ where: { id: args.expediente_id, archived_at: null, ...expedienteAccessWhere(actor) }, select: { id: true, numero_pravia: true } });
      if (!expediente) throw new AssistantActionError('No tienes acceso a ese expediente.', 'AI_ACTION_TARGET_DENIED', 403);
      const versions = await new ProjectRepository(prisma).listVersions(expediente.id);
      const current = versions.find((version) => version.es_vigente) || versions[0];
      if (!current) throw new AssistantActionError('Genera o carga un proyecto vigente antes de revisarlo.', 'AI_PROJECT_VERSION_REQUIRED', 409);
      return { object: { type: 'Documento', id: current.id, label: current.nombre_original }, before: { version: current.version_numero, reporte_nuevo: false }, after: { reporte_observaciones: true, proyecto_modificado: false }, impact: 'Analizará el proyecto y sus fuentes y generará un reporte separado; no editará el Word ni aplicará observaciones automáticamente.', guard: { kind: 'PROJECT_VERSION', id: current.id, version: current.version_numero } };
    },
    async assertFresh(input) {
      const versions = await new ProjectRepository(prisma).listVersions(input.args.expediente_id);
      const current = versions.find((version) => version.es_vigente) || versions[0];
      if (!current || current.id !== input.preview?.guard?.id || current.version_numero !== input.preview?.guard?.version) throw new AssistantActionError('El proyecto vigente cambió desde la vista previa. Actualiza y vuelve a confirmar.', 'AI_ACTION_STALE', 409);
    },
    async execute(input) {
      const result = await invokeProjectReview(input);
      return { entityType: 'Documento', entityId: result.id, message: 'La revisión terminó y el reporte de observaciones quedó disponible. El proyecto no fue modificado.', refresh: 'proyecto', details: [{ label: 'Observaciones', value: String(result.observaciones?.length || 0) }, { label: 'Versión revisada', value: String(result.proyecto_version_numero || '') }] };
    },
  },
  {
    key: 'tracking.activity.update', domain: 'Seguimiento', description: 'Actualizar una actividad operativa del seguimiento.',
    permissions: ['expedientes.write'], risk: 'SAFE_WRITE', confirmation: 'REQUIRED',
    fields: { expediente_id: { type: 'string', required: true, max: 80 }, expediente_query: { type: 'string', max: 120 }, activity_id: { type: 'string', required: true, max: 80 }, estado: { type: 'string', required: true, enum: ['NO_INICIADO','EN_PROCESO','EN_ESPERA_EXTERNA','COMPLETADO','NO_APLICA'] }, responsable_id: { type: 'string', max: 80 }, razon: { type: 'string', max: 600 } },
    contextField: 'expediente_id', contextTypes: ['expediente'],
    async prepare({ actor, args }) {
      const current = await new ExpedienteSeguimientoService(prisma).read(actor, args.expediente_id);
      const activities = current.actos.flatMap((act: any) => act.etapas.flatMap((stage: any) => stage.actividades));
      const activity = activities.find((item: any) => item.id === args.activity_id);
      if (!activity) throw new AssistantActionError('No tienes acceso a esa actividad.', 'AI_ACTION_TARGET_DENIED', 403);
      return { object: { type: 'ExpedienteSeguimientoActividad', id: activity.id, label: activity.nombre }, before: { estado: activity.estado, version: activity.version }, after: { estado: args.estado, responsable_id: args.responsable_id, razon: args.razon }, impact: 'Actualizará la actividad y recalculará el seguimiento mediante el motor canónico.', guard: { kind: 'TRACKING_VERSION', id: activity.id, version: activity.version } };
    },
    async execute(input) {
      const service = new ExpedienteSeguimientoService(prisma); const current = await service.read(input.actor, input.args.expediente_id);
      const activities = current.actos.flatMap((act: any) => act.etapas.flatMap((stage: any) => stage.actividades));
      const activity = activities.find((item: any) => item.id === input.args.activity_id);
      if (!activity) throw new AssistantActionError('No tienes acceso a esa actividad.', 'AI_ACTION_TARGET_DENIED', 403);
      const result = await service.update(input.actor, input.args.expediente_id, input.args.activity_id, { expected_version: previewVersion(input, activity.version), estado: input.args.estado, responsable_id: input.args.responsable_id, razon: input.args.razon });
      return { entityType: 'ExpedienteSeguimientoActividad', entityId: result.id, message: 'La actividad de seguimiento quedó actualizada.', refresh: 'seguimiento' };
    },
  },
  {
    key: 'budget.generate_pdf', domain: 'Presupuesto', description: 'Generar el PDF vigente del presupuesto del expediente.',
    permissions: ['expedientes.write', 'documentos.write'], risk: 'SENSITIVE_WRITE', confirmation: 'REQUIRED',
    fields: { expediente_id: { type: 'string', required: true, max: 80 }, expediente_query: { type: 'string', max: 120 }, note: { type: 'string', max: 500 } },
    contextField: 'expediente_id', contextTypes: ['expediente'],
    async execute(input) {
      const service = new ExpedienteBudgetService(prisma); const current = await service.read(input.actor, input.args.expediente_id);
      const result = await service.generatePdf(input.actor, input.args.expediente_id, { expected_version: current.version, idempotency_key: input.invocationId, note: input.args.note });
      return { entityType: 'Documento', entityId: result.item.document_id, message: 'El PDF del presupuesto quedó generado como versión inmutable.', refresh: 'presupuesto' };
    },
  },
  {
    key: 'budget.concept.update', domain: 'Presupuesto', description: 'Actualizar un concepto del presupuesto del expediente.',
    permissions: ['expedientes.write'], risk: 'SENSITIVE_WRITE', confirmation: 'REQUIRED',
    fields: { expediente_id: { type: 'string', required: true, max: 80 }, expediente_query: { type: 'string', max: 120 }, concept_id: { type: 'string', required: true, max: 80 }, importe: { type: 'string', required: true, max: 30 }, concepto: { type: 'string', max: 240 }, categoria: { type: 'string', enum: ['HONORARIOS','IVA_HONORARIOS','IMPUESTOS_DERECHOS'] } },
    contextField: 'expediente_id', contextTypes: ['expediente'],
    async prepare({ actor, args }) {
      const current = await new ExpedienteBudgetService(prisma).read(actor, args.expediente_id);
      const selected = current.concepts.find((item: any) => item.id === args.concept_id);
      if (!selected) throw new AssistantActionError('El concepto no pertenece al presupuesto vigente.', 'AI_ACTION_TARGET_DENIED', 403);
      const concepts = current.concepts.map((item: any) => item.id === selected.id ? { ...item, concepto: args.concepto || item.concepto, categoria: args.categoria || item.categoria, importe: args.importe } : item);
      const totals = visibleTotals(concepts);
      return { object: { type: 'ExpedientePresupuestoConcepto', id: selected.id, label: selected.concepto }, before: { concepto: selected, totals: current.totals }, after: { concepto: concepts.find((item: any) => item.id === selected.id), totals }, impact: 'Actualizará sólo el presupuesto del expediente; la cotización de origen permanecerá inmutable.', guard: { kind: 'BUDGET_VERSION', id: current.id, version: current.version } };
    },
    async execute(input) {
      const service = new ExpedienteBudgetService(prisma); const current = await service.read(input.actor, input.args.expediente_id);
      const selected = current.concepts.find((item: any) => item.id === input.args.concept_id);
      if (!selected) throw new AssistantActionError('El concepto no pertenece al presupuesto vigente.', 'AI_ACTION_TARGET_DENIED', 403);
      const concepts = current.concepts.map((item: any) => item.id === selected.id ? { ...item, concepto: input.args.concepto || item.concepto, categoria: input.args.categoria || item.categoria, importe: input.args.importe } : item);
      const result = await service.save(input.actor, input.args.expediente_id, { expected_version: previewVersion(input, current.version), concepts });
      return { entityType: 'ExpedientePresupuesto', entityId: current.id, message: 'El concepto y el total del presupuesto quedaron actualizados; la cotización de origen no cambió.', refresh: 'presupuesto', details: [{ label: 'Total', value: String(result.totals.total) }] };
    },
  },
  {
    key: 'isr.document.generate', domain: 'ISR', description: 'Generar la memoria ISR mediante el destino CFG-002 vigente.',
    permissions: ['isr.calculate', 'documentos.write'], risk: 'SENSITIVE_WRITE', confirmation: 'REQUIRED',
    fields: { calculo_id: { type: 'string', required: true, max: 80 } }, contextField: 'calculo_id', contextTypes: ['isrCalculation'],
    async prepare({ actor, args }) {
      const current = await new ISRService(prisma).get(actor, args.calculo_id);
      return { object: { type: 'CalculoISR', id: current.id, label: current.folio }, before: { version: current.ultima_version, documento_nuevo: false }, after: { version: current.ultima_version, destino: 'CALCULO_ISR_MEMORIA' }, impact: 'Generará una memoria con el cálculo persistido y el formato CFG-002 vigente; no recalculará importes.', guard: { kind: 'ISR_VERSION', id: current.id, version: current.ultima_version } };
    },
    async execute(input) {
      const result = await new ISRService(prisma).generatePdf(input.actor, input.args.calculo_id, { expectedVersion: Number(input.preview?.guard?.version), idempotencyKey: input.invocationId });
      return { entityType: 'Documento', entityId: result.data.id, message: 'La memoria ISR quedó generada con el formato CFG-002 vigente.', refresh: 'isr', details: [{ label: 'Documento', value: result.data.nombre_original }] };
    },
  },
  {
    key: 'finance.payment_request.create', domain: 'Finanzas', description: 'Crear una solicitud interna de pago y su PDF.',
    permissions: ['expedientes.write', 'documentos.write'], risk: 'SENSITIVE_WRITE', confirmation: 'REQUIRED',
    fields: { expediente_id: { type: 'string', required: true, max: 80 }, expediente_query: { type: 'string', max: 120 }, concepto: { type: 'string', required: true, max: 500 }, importe: { type: 'number', required: true }, beneficiario: { type: 'string', max: 300 }, dependencia: { type: 'string', max: 300 }, referencia: { type: 'string', max: 180 }, fecha_limite: { type: 'string', max: 50 }, notas: { type: 'string', max: 2_000 } },
    contextField: 'expediente_id', contextTypes: ['expediente'],
    async execute(input) {
      const { expediente_id: _id, expediente_query: _query, ...command } = input.args;
      const result = await new ExpedienteFinanceService(prisma).createInternalRequest(input.actor, input.args.expediente_id, { ...command, idempotency_key: input.invocationId });
      return { entityType: 'ExpedienteSolicitudPago', entityId: result.item.id, message: 'La solicitud interna de pago quedó creada; no se aplicó ningún movimiento contable.', refresh: 'finanzas' };
    },
  },
  {
    key: 'compliance.review.run', domain: 'Cumplimiento', description: 'Ejecutar la revisión asistida CUM-AUD sin resolver decisiones legales.',
    permissions: ['compliance.review', 'ia.execute'], risk: 'SENSITIVE_WRITE', confirmation: 'REQUIRED',
    fields: { expediente_id: { type: 'string', required: true, max: 80 }, expediente_query: { type: 'string', max: 120 } },
    contextField: 'expediente_id', contextTypes: ['expediente'],
    async execute(input) {
      const result = await complianceH9Service.run(input.actor as any, input.args.expediente_id, { idempotency_key: input.invocationId }, input.correlationId);
      return { entityType: 'ComplianceAssistedReview', entityId: result.review.id, message: 'La revisión asistida quedó ejecutada. Sus observaciones siguen sujetas a revisión humana.', refresh: 'cumplimiento' };
    },
  },
  {
    key: 'cfg001.activity.update', domain: 'CFG-001', description: 'Modificar de forma controlada una actividad de Actos y Tiempos.',
    permissions: ['configuracion.actos_tiempos.manage'], risk: 'SENSITIVE_WRITE', confirmation: 'REINFORCED',
    fields: {
      activity_id: { type: 'string', required: true, max: 80 }, nombre: { type: 'string', max: 180 },
      duracion_estimada: { type: 'number' }, tipo_dias: { type: 'string', enum: ['HABILES','NATURALES'] },
      margen_seguridad: { type: 'number' }, activa: { type: 'boolean' },
    }, contextField: 'activity_id', contextTypes: ['cfg001Activity'],
    async prepare({ actor, args }) {
      const current = await prisma.configuracionActividad.findFirst({ where: { id: args.activity_id, organization_id: actor.organizationId }, select: { id: true, nombre: true, duracion_estimada: true, tipo_dias: true, margen_seguridad: true, activa: true, updated_at: true } });
      if (!current) throw new AssistantActionError('La actividad CFG-001 no existe o está fuera de tu organización.', 'AI_ACTION_TARGET_DENIED', 403);
      const { activity_id: _id, ...changes } = args;
      return { object: { type: 'ConfiguracionActividad', id: current.id, label: current.nombre }, before: current, after: { ...current, ...changes }, impact: 'Cambiará la configuración maestra para usos futuros; las instantáneas operativas existentes se conservan.', guard: { kind: 'CFG001_UPDATED_AT', id: current.id, version: current.updated_at.toISOString() } };
    },
    async assertFresh(input) {
      const guard = input.preview?.guard;
      const current = guard ? await prisma.configuracionActividad.findFirst({ where: { id: guard.id, organization_id: input.actor.organizationId }, select: { updated_at: true } }) : null;
      if (!current || current.updated_at.toISOString() !== guard?.version) throw new AssistantActionError('CFG-001 cambió desde que preparé la acción. Actualiza la vista antes de confirmar.', 'AI_ACTION_STALE', 409);
    },
    async execute(input) {
      const { activity_id: _id, ...changes } = input.args;
      const result = await actsAndTimesService.updateActivity(input.actor, input.args.activity_id, changes);
      return { entityType: 'ConfiguracionActividad', entityId: result.id, message: 'La actividad CFG-001 quedó actualizada y auditada.', refresh: 'configuracion' };
    },
  },
  {
    key: 'cfg002.destination.set', domain: 'CFG-002', description: 'Asignar de forma controlada un destino funcional a un formato.',
    permissions: ['configuracion.plantillas_formatos.manage'], risk: 'SENSITIVE_WRITE', confirmation: 'REINFORCED',
    fields: {
      artifact_id: { type: 'string', required: true, max: 80 },
      destination: { type: 'string', required: true, enum: ['COTIZACION_SERVICIOS','EXPEDIENTE_PRESUPUESTO','CALCULO_ISR_MEMORIA','FINANZAS_RECIBO_PAGO','FINANZAS_SOLICITUD_PAGO','PROYECTO_MACHOTE','EXPEDIENTE_DOCUMENTO_GENERICO','CUMPLIMIENTO_PLD_UIF'] },
      active: { type: 'boolean' }, default: { type: 'boolean' },
    }, contextField: 'artifact_id', contextTypes: ['cfg002Artifact'],
    async prepare({ actor, args }) {
      const artifact = await prisma.catalogoArtefacto.findFirst({ where: { id: args.artifact_id, organization_id: actor.organizationId }, select: { id: true, nombre: true } });
      if (!artifact) throw new AssistantActionError('El formato CFG-002 no existe o está fuera de tu organización.', 'AI_ACTION_TARGET_DENIED', 403);
      const current = await prisma.catalogoArtefactoDestino.findMany({ where: { organization_id: actor.organizationId, artefacto_id: artifact.id }, orderBy: { destino: 'asc' } });
      const next = current.filter((item) => item.destino !== args.destination).map((item) => ({ destino: item.destino, activo: item.activo, predeterminado: args.default === true ? false : item.predeterminado, reglas_json: item.reglas_json, mapeo_datos_json: item.mapeo_datos_json }));
      next.push({ destino: args.destination, activo: args.active !== false, predeterminado: args.default === true, reglas_json: null, mapeo_datos_json: null } as any);
      const fingerprint = createHash('sha256').update(JSON.stringify(current.map((item) => [item.destino, item.activo, item.predeterminado, item.updated_at]))).digest('hex');
      return { object: { type: 'CatalogoArtefacto', id: artifact.id, label: artifact.nombre }, before: current.map((item) => ({ destino: item.destino, activo: item.activo, predeterminado: item.predeterminado })), after: next.map((item) => ({ destino: item.destino, activo: item.activo, predeterminado: item.predeterminado })), impact: 'Reemplazará atómicamente la matriz de destinos del formato y puede cambiar qué archivo resuelven los motores documentales.', guard: { kind: 'CFG002_DESTINATIONS', id: artifact.id, version: fingerprint } };
    },
    async assertFresh(input) {
      const guard = input.preview?.guard;
      if (!guard) throw new AssistantActionError('Falta la instantánea administrativa de CFG-002.', 'AI_ACTION_STALE', 409);
      const current = await prisma.catalogoArtefactoDestino.findMany({ where: { organization_id: input.actor.organizationId, artefacto_id: guard.id }, orderBy: { destino: 'asc' } });
      const fingerprint = createHash('sha256').update(JSON.stringify(current.map((item) => [item.destino, item.activo, item.predeterminado, item.updated_at]))).digest('hex');
      if (fingerprint !== guard.version) throw new AssistantActionError('CFG-002 cambió desde que preparé la acción. Actualiza la vista antes de confirmar.', 'AI_ACTION_STALE', 409);
    },
    async execute(input) {
      const current = await prisma.catalogoArtefactoDestino.findMany({ where: { organization_id: input.actor.organizationId, artefacto_id: input.args.artifact_id }, orderBy: { destino: 'asc' } });
      const destinations = current.filter((item) => item.destino !== input.args.destination).map((item) => ({ destino: item.destino, activo: item.activo, predeterminado: input.args.default === true ? false : item.predeterminado, reglas_json: item.reglas_json, mapeo_datos_json: item.mapeo_datos_json }));
      destinations.push({ destino: input.args.destination, activo: input.args.active !== false, predeterminado: input.args.default === true, reglas_json: null, mapeo_datos_json: null } as any);
      await functionalDestinationService.assign(input.actor, input.args.artifact_id, { destinos: destinations });
      return { entityType: 'CatalogoArtefacto', entityId: input.args.artifact_id, message: 'El destino funcional CFG-002 quedó actualizado y auditado.', refresh: 'configuracion' };
    },
  },
];

const byKey = new Map(definitions.map((definition) => [definition.key, definition]));

export function assistantActionCatalog(actor: Actor) {
  return definitions.filter((definition) => hasPermissions(actor, definition.permissions)).map((definition) => ({
    key: definition.key, domain: definition.domain, description: definition.description, risk: definition.risk,
    level: actionLevel(definition),
    confirmation: effectiveConfirmation(definition), required: Object.entries(definition.fields).filter(([, field]) => field.required).map(([name]) => name),
    arguments: Object.keys(definition.fields),
    inputSchema: { type: 'object', additionalProperties: false, fields: definition.fields },
    outputSchema: { type: 'object', fields: ['entityType', 'entityId', 'message', 'refresh'] },
    requiredPermissions: definition.permissions,
    tenantPolicy: 'CURRENT_ORGANIZATION',
    objectAccessPolicy: definition.contextTypes?.length ? definition.contextTypes : ['CANONICAL_SERVICE'],
    idempotencyPolicy: 'REQUIRED',
    canonicalService: `assistantActions.${definition.key}`,
    auditPolicy: 'PRAVIA_IA_ORIGIN_REQUIRED',
  }));
}

function enumToken(value: string) {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleUpperCase('es-MX').replace(/[^A-Z0-9]/g, '');
}

function canonicalEnumValue(fieldName: string, value: string, allowed: readonly string[]) {
  const normalized = enumToken(value);
  const direct = allowed.find((candidate) => enumToken(candidate) === normalized);
  if (direct) return direct;
  const aliases: Record<string, Record<string, string>> = {
    tipo_persona: {
      PERSONAFISICA: 'FISICA', PF: 'FISICA',
      PERSONAMORAL: 'MORAL', PM: 'MORAL',
    },
  };
  const alias = aliases[fieldName]?.[normalized];
  return alias && allowed.includes(alias) ? alias : undefined;
}

function isPlannerPlaceholder(value: string) {
  return new Set([
    'PENDIENTE', 'PENDIENTEDEDEFINIR', 'PORDEFINIR', 'NOESPECIFICADO',
    'NOESPECIFICADA', 'DESCONOCIDO', 'DESCONOCIDA', 'SININFORMACION',
    'SINDATO', 'NA',
  ]).has(enumToken(value));
}

function validateArgs(definition: Definition, raw: unknown, options?: { invalidEnumAsMissing?: boolean }) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new AssistantActionError('Los datos de la acción no son válidos.', 'AI_ACTION_ARGUMENTS_INVALID');
  const args = { ...(raw as Record<string, unknown>) };
  for (const key of Object.keys(args)) if (!definition.fields[key]) throw new AssistantActionError('La acción incluye un dato no permitido.', 'AI_ACTION_UNKNOWN_ARGUMENT');
  for (const [key, value] of Object.entries(args)) {
    const field = definition.fields[key];
    if (value === undefined || value === null || value === '') continue;
    if (options?.invalidEnumAsMissing && typeof value === 'string' && isPlannerPlaceholder(value)) {
      delete args[key];
      continue;
    }
    if (field.enum && typeof value === 'string') {
      const canonical = canonicalEnumValue(key, value.trim(), field.enum);
      if (canonical) args[key] = canonical;
      else if (options?.invalidEnumAsMissing) {
        delete args[key];
        continue;
      }
    }
    const normalizedValue = args[key];
    const valid = field.type === 'string' ? typeof normalizedValue === 'string'
      : field.type === 'number' ? typeof normalizedValue === 'number' && Number.isFinite(normalizedValue)
        : field.type === 'boolean' ? typeof normalizedValue === 'boolean'
          : field.type === 'string[]' ? Array.isArray(normalizedValue) && normalizedValue.length <= 50 && normalizedValue.every((item) => typeof item === 'string')
            : field.type === 'object' ? typeof normalizedValue === 'object' && !Array.isArray(normalizedValue) : false;
    if (!valid) throw new AssistantActionError(`El campo ${key} no tiene el formato esperado.`, 'AI_ACTION_ARGUMENT_TYPE_INVALID');
    if (field.max && typeof normalizedValue === 'string' && normalizedValue.length > field.max) throw new AssistantActionError(`El campo ${key} es demasiado largo.`, 'AI_ACTION_ARGUMENT_TOO_LONG');
    if (field.enum && !field.enum.includes(String(normalizedValue))) throw new AssistantActionError(`El valor de ${key} no está permitido.`, 'AI_ACTION_ARGUMENT_ENUM_INVALID');
  }
  return args as Record<string, any>;
}

async function resolveQuery(actor: Actor, args: Record<string, any>) {
  if (!args.expediente_id && args.expediente_query) {
    const q = safeText(args.expediente_query, 120);
    const rows = await prisma.expediente.findMany({ where: { archived_at: null, ...expedienteAccessWhere(actor), OR: [{ numero_pravia: { contains: q, mode: 'insensitive' } }, { cliente_alias: { contains: q, mode: 'insensitive' } }] }, select: { id: true, numero_pravia: true, cliente_alias: true }, take: 3 });
    if (rows.length === 1) args.expediente_id = rows[0].id;
    else if (rows.length > 1) throw new AssistantActionError('Encontré más de un expediente. ¿Cuál quieres usar?', 'AI_ACTION_ENTITY_AMBIGUOUS', 409, rows.map((row) => `${row.numero_pravia} · ${row.cliente_alias || 'Sin alias'}`));
  }
  if (!args.prospect_id && args.prospect_query) {
    const q = safeText(args.prospect_query, 120);
    const rows = await prisma.prospecto.findMany({ where: { archived_at: null, ...prospectoObjectWhere(actor), OR: [{ folio: { contains: q, mode: 'insensitive' } }, { nombre: { contains: q, mode: 'insensitive' } }] }, select: { id: true, folio: true, nombre: true }, take: 3 });
    if (rows.length === 1) args.prospect_id = rows[0].id;
    else if (rows.length > 1) throw new AssistantActionError('Encontré más de un prospecto. ¿Cuál quieres usar?', 'AI_ACTION_ENTITY_AMBIGUOUS', 409, rows.map((row) => `${row.folio || 'Sin folio'} · ${row.nombre}`));
  }
  if (!args.quote_id && args.quote_query) {
    const q = safeText(args.quote_query, 120);
    const rows = await prisma.cotizacion.findMany({ where: { ...cotizacionObjectWhere(actor), numero_cotizacion: { contains: q, mode: 'insensitive' } }, select: { id: true, numero_cotizacion: true }, take: 3 });
    if (rows.length === 1) args.quote_id = rows[0].id;
    else if (rows.length > 1) throw new AssistantActionError('Encontré más de una cotización. ¿Cuál quieres usar?', 'AI_ACTION_ENTITY_AMBIGUOUS', 409, rows.map((row) => row.numero_cotizacion || 'Cotización sin folio'));
  }
  return args;
}

function projectInstructionsFromMessage(message?: string) {
  const raw = safeText(message, 4_000);
  if (!raw) return '';
  const instruction = raw
    .replace(/^\s*(?:por\s+favor[,\s]*)?(?:proy[eé]ctalo|proyecta(?:r)?(?:\s+la\s+escritura)?|genera(?:r)?(?:\s+el)?\s+proyecto)(?:\s+y\s+|\s*[:;,.-]\s*)?/i, '')
    .trim();
  if (!instruction || instruction === raw.trim()) return '';
  return instruction.charAt(0).toUpperCase() + instruction.slice(1);
}

function isContextReference(value: unknown) {
  const normalized = safeText(value, 80).toLocaleLowerCase('es-MX');
  if (['actual', 'current', 'este', 'esta', 'ese', 'esa', 'aquí', 'aqui', 'contexto', 'context'].includes(normalized)) return true;
  const entity = '(?:expediente|prospecto|cotizaci[oó]n|compareciente|predio|inmueble|documento|proyecto|evento|actividad|formato|c[aá]lculo)';
  return new RegExp(`^(?:el |la )?(?:actual|este|esta|ese|esa) ${entity}$`, 'i').test(normalized)
    || new RegExp(`^(?:el |la )?${entity} actual$`, 'i').test(normalized);
}

function isUuid(value: unknown) {
  return typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value.trim());
}

function applyContext(definition: Definition, args: Record<string, any>, context?: AssistantActionContext) {
  if (definition.contextField && (!args[definition.contextField] || isContextReference(args[definition.contextField])
      || (definition.contextField.endsWith('_id') && !isUuid(args[definition.contextField])))
    && context?.entityId && definition.contextTypes?.includes(String(context.entityType))) {
    args[definition.contextField] = context.entityId;
  }
  if (definition.key === 'project.generate' && context?.projectDraft) {
    const draft = context.projectDraft;
    const fieldInstructions = safeText(draft.instructions, 4_000);
    const plannedInstructions = safeText(args.instructions, 4_000);
    const derivedInstructions = projectInstructionsFromMessage(context.requestMessage);
    const requestInstructions = plannedInstructions && plannedInstructions !== fieldInstructions
      ? plannedInstructions
      : derivedInstructions || plannedInstructions;
    args.instructions = fieldInstructions && requestInstructions && fieldInstructions !== requestInstructions
      ? `Indicaciones existentes:\n${fieldInstructions}\n\nIndicaciones de esta solicitud:\n${requestInstructions}`.slice(0, 4_000)
      : requestInstructions || fieldInstructions || undefined;
    if (!args.template_version_id && draft.templateVersionId) args.template_version_id = safeText(draft.templateVersionId, 80);
    if (!args.source_document_ids && Array.isArray(draft.sourceDocumentIds)) args.source_document_ids = draft.sourceDocumentIds.slice(0, 50).map((id) => safeText(id, 80)).filter(Boolean);
  }
  if (definition.key === 'document.attach_uploaded' && context) {
    if ((!Array.isArray(args.attachment_ids) || args.attachment_ids.length === 0) && context.attachmentIds?.length) {
      args.attachment_ids = context.attachmentIds.slice(0, 6);
    }
    const targetTypeByContext: Record<string, string> = {
      expediente: 'EXPEDIENTE', cotizacion: 'COTIZACION', prospecto: 'PROSPECTO', compareciente: 'COMPARECIENTE', predio: 'PREDIO',
    };
    const targetType = targetTypeByContext[String(context.entityType || '').toLocaleLowerCase('es-MX')];
    if (!args.target_type && targetType) args.target_type = targetType;
    if ((!args.target_id || isContextReference(args.target_id)) && targetType && context.entityId) args.target_id = context.entityId;
  }
  if ((definition.key === 'party.create' || definition.key === 'property.create') && context?.attachmentFacts?.length) {
    const aliases: Record<string, string[]> = definition.key === 'party.create' ? {
      nombre: ['nombre', 'nombre_completo', 'razon_social', 'denominacion_social'], apellido_paterno: ['apellido_paterno'], apellido_materno: ['apellido_materno'],
      rfc: ['rfc'], curp: ['curp'], telefono: ['telefono', 'telefono_principal'], correo: ['correo', 'email', 'correo_electronico'], tipo_persona: ['tipo_persona'],
    } : {
      ubicacion_texto: ['ubicacion_texto', 'ubicacion', 'direccion', 'domicilio'], apodo: ['apodo', 'nombre_inmueble'], clave_catastral: ['clave_catastral'],
      cuenta_predial: ['cuenta_predial'], folio_real: ['folio_real'], codigo_postal: ['codigo_postal', 'cp'], municipio: ['municipio'], estado: ['estado'],
      valor_operacion: ['valor_operacion'], valor_catastral: ['valor_catastral'], valor_avaluo: ['valor_avaluo'],
    };
    for (const [target, sourceNames] of Object.entries(aliases)) {
      if (args[target] !== undefined) continue;
      const fact = context.attachmentFacts.find((item) => sourceNames.includes(item.field));
      if (!fact) continue;
      if (definition.fields[target]?.type === 'number') {
        const normalized = fact.value.replace(/[^0-9.-]/g, '');
        if (normalized && Number.isFinite(Number(normalized))) args[target] = Number(normalized);
      } else if (target === 'tipo_persona') {
        const normalized = fact.value.toLocaleUpperCase('es-MX');
        if (normalized.includes('MORAL')) args[target] = 'MORAL';
        else if (normalized.includes('FISICA') || normalized.includes('FÍSICA')) args[target] = 'FISICA';
      } else args[target] = safeText(fact.value, definition.fields[target]?.max || 500);
    }
  }
  return args;
}

function missingFields(definition: Definition, args: Record<string, any>) {
  const missing = Object.entries(definition.fields).filter(([, field]) => field.required).map(([name]) => name).filter((name) => args[name] === undefined || args[name] === null || args[name] === '');
  if (definition.key === 'agenda.event.update' && !Object.keys(args).some((key) => key !== 'event_id')) missing.push('cambio');
  if (definition.key === 'prospect.update' && !Object.keys(args).some((key) => !['prospect_id', 'prospect_query'].includes(key))) missing.push('cambio');
  return missing;
}

const missingQuestion: Record<string, string> = {
  titulo: '¿Qué título tendrá?', fecha_inicio: '¿En qué fecha y hora lo registro?', event_id: '¿Qué evento quieres modificar?', motivo_cancelacion: '¿Cuál es el motivo de la cancelación?',
  nombre: '¿Cuál es el nombre?', prospect_id: '¿Qué prospecto quieres usar?', action: '¿Qué cambio quieres registrar?', quote_id: '¿Qué cotización quieres usar?',
  expediente_id: '¿Qué expediente quieres usar?', note: '¿Qué nota quieres agregar?', tipo_acto_id: '¿Qué tipo de acto quieres agregar?', expediente_acto_id: '¿A qué acto del expediente corresponde?',
  compareciente_id: '¿Qué compareciente quieres vincular?', caracter_id: '¿Con qué carácter participa?', forma_comparecencia: '¿Cuál es su forma de comparecencia?',
  predio_id: '¿Qué predio quieres vincular?', expediente_acto_ids: '¿Con qué acto o actos se relaciona?', pending_id: '¿Qué formato pendiente quieres generar?',
  activity_id: '¿Qué actividad de seguimiento quieres actualizar?', estado: '¿A qué estado quieres cambiarla?', concepto: '¿Cuál es el concepto de la solicitud?', importe: '¿Por qué importe?',
  categoria: '¿En qué categoría debe registrarse?', concept_id: '¿Qué concepto quieres modificar?', origin: '¿Quieres importar documentos de comparecientes o de predios?',
  calculo_id: '¿Qué cálculo ISR quieres usar?', document_ids: '¿Qué documentos vigentes quieres analizar?',
  tipo_persona: '¿Es persona física o persona moral?', ubicacion_texto: '¿Cuál es la ubicación del inmueble?',
  cambio: '¿Qué dato quieres cambiar?', effectiveAt: '¿Cuál es la fecha y hora efectiva del hecho?',
};

const fieldLabels: Record<string, string> = {
  titulo: 'Título', fecha_inicio: 'Fecha y hora', event_id: 'Evento', motivo_cancelacion: 'Motivo de cancelación',
  nombre: 'Nombre o razón social', tipo_persona: 'Tipo de persona', apellido_paterno: 'Apellido paterno', apellido_materno: 'Apellido materno',
  rfc: 'RFC', curp: 'CURP', telefono: 'Teléfono', correo: 'Correo', prospect_id: 'Prospecto', action: 'Acción', quote_id: 'Cotización',
  expediente_id: 'Expediente', note: 'Nota', tipo_acto_id: 'Tipo de acto', expediente_acto_id: 'Acto del expediente',
  compareciente_id: 'Compareciente', caracter_id: 'Carácter', forma_comparecencia: 'Forma de comparecencia', predio_id: 'Predio',
  expediente_acto_ids: 'Actos relacionados', pending_id: 'Formato pendiente', activity_id: 'Actividad', estado: 'Estado', concepto: 'Concepto',
  importe: 'Importe', categoria: 'Categoría', concept_id: 'Concepto existente', origin: 'Origen', calculo_id: 'Cálculo ISR',
  document_ids: 'Documentos', ubicacion_texto: 'Ubicación del inmueble', apodo: 'Nombre corto', clave_catastral: 'Clave catastral',
  cuenta_predial: 'Cuenta predial', folio_real: 'Folio real', target_type: 'Destino', target_id: 'Registro de destino',
  attachment_ids: 'Archivos adjuntos', tipo_documento: 'Tipo documental', cambio: 'Dato a cambiar', effectiveAt: 'Fecha y hora efectiva',
};

function collectionFor(definition: Definition, args: Record<string, any>, missing: string[]): AssistantCollection {
  return {
    actionKey: definition.key,
    title: definition.description,
    description: 'Completa únicamente los datos faltantes. PRAVIA mostrará un resumen antes de cualquier cambio.',
    fields: missing.filter((name) => Boolean(definition.fields[name])).map((name) => {
      const field = definition.fields[name];
      return {
        name,
        label: fieldLabels[name] || name.replace(/_/g, ' '),
        type: field.enum ? 'select' as const
          : field.type === 'number' ? 'number' as const
            : field.type === 'boolean' ? 'checkbox' as const
              : field.type === 'string[]' ? 'multiline' as const
                : 'text' as const,
        required: Boolean(field.required),
        ...(args[name] !== undefined ? { value: args[name] } : {}),
        ...(field.enum ? { options: field.enum.map((value) => ({ value, label: value.replace(/_/g, ' ').toLocaleLowerCase('es-MX').replace(/^./, (letter) => letter.toLocaleUpperCase('es-MX')) })) } : {}),
      };
    }),
  };
}

async function auditOrigin(input: ExecuteInput, definition: Definition, result: ActionResult) {
  const jsonSafe = (value: unknown) => value == null ? undefined : JSON.parse(JSON.stringify(value, (_key, nested) => typeof nested === 'bigint' ? nested.toString() : nested));
  await prisma.auditLog.create({ data: {
    organization_id: input.actor.organizationId, user_id: input.actor.id, accion: 'AI_ACTION_COMPLETED', entidad: result.entityType,
    entidad_id: result.entityId || input.actor.id, correlation_id: input.correlationId, session_id: input.actor.sessionId,
    valores_anteriores: jsonSafe(input.preview?.before),
    valores_nuevos: jsonSafe(input.preview?.after),
    detalles: { origin: 'PRAVIA_IA', action_key: definition.key, tool: definition.key, invocation_id: input.invocationId, action_level: actionLevel(definition), confirmation_level: effectiveConfirmation(definition), impact: input.preview?.impact || null, object: input.preview?.object || null },
  } });
}

async function execute(definition: Definition, actor: Actor, conversationId: string, args: Record<string, any>, invocationId: string, correlationId: string, preview?: ActionPreview) {
  if (!hasPermissions(actor, definition.permissions)) throw new AssistantActionError('No tienes permiso para hacer eso.', 'AI_ACTION_DENIED', 403);
  const input = { actor, conversationId, args, invocationId, correlationId, preview };
  let result: ActionResult;
  try {
    await definition.assertFresh?.(input);
    result = await definition.execute(input);
  } catch (error) {
    if (error instanceof ProspectWorkflowError) throw new AssistantActionError(error.message, error.code, error.status);
    if (error instanceof ProjectGenerationError) throw new AssistantActionError(error.message, error.code, error.status);
    throw error;
  }
  await auditOrigin(input, definition, result);
  return result;
}

export type AssistantOperationalReply = {
  status: 'success'; message: string; confirmation?: { id: string; title: string; summary?: string; level?: 'STANDARD' | 'REINFORCED'; details: Array<{ label: string; value: string }>; confirmLabel?: string };
  refresh?: string;
  collection?: AssistantCollection;
};

export async function prepareOrExecuteAssistantAction(input: { actor: Actor; conversationId: string; messageId: string; actionKey: string; args: unknown; context?: AssistantActionContext; correlationId: string; origin?: 'USER_COMMAND' | 'PROACTIVE' }): Promise<AssistantOperationalReply> {
  const definition = byKey.get(input.actionKey);
  if (!definition) throw new AssistantActionError('Esa acción no está disponible.', 'AI_ACTION_UNKNOWN', 404);
  if (!hasPermissions(input.actor, definition.permissions)) throw new AssistantActionError('No tienes permiso para hacer eso.', 'AI_ACTION_DENIED', 403);
  // El planificador puede proponer una etiqueta humana o un placeholder para un
  // catálogo cerrado. Nunca lo persistimos ni lo tratamos como dato real: si no
  // puede normalizarse, el formulario estructurado solicita el valor canónico.
  const supplied = validateArgs(definition, input.args, { invalidEnumAsMissing: true });
  const previous = await assistantConversationService.actionState(input.actor, input.conversationId);
  const requestedInvocationId = actionId([input.actor.organizationId, input.actor.id, input.conversationId, input.messageId, definition.key]);
  if (previous?.status === 'COMPLETED' && previous.actionKey === definition.key
    && previous.invocationId === requestedInvocationId && previous.result) return previous.result;
  let args = previous?.status === 'COLLECTING' && previous.actionKey === definition.key
    ? { ...previous.args, ...supplied }
    : supplied;
  args = applyContext(definition, args, input.context);
  args = await resolveQuery(input.actor, args);
  const missing = missingFields(definition, args);
  const invocationId = previous?.status === 'COLLECTING' && previous.actionKey === definition.key
    ? previous.invocationId
    : requestedInvocationId;
  if (missing.length) {
    const collection = collectionFor(definition, args, missing);
    const state: AssistantActionState = { status: 'COLLECTING', actionKey: definition.key, args, invocationId, missing, collection };
    await assistantConversationService.setActionState(input.actor, input.conversationId, state);
    return { status: 'success', message: missingQuestion[missing[0]] || `Necesito ${missing[0]} para continuar.`, collection };
  }
  const confirmationPolicy = effectiveConfirmation(definition, input.origin || 'PROACTIVE');
  if (confirmationPolicy !== 'NONE') {
    if (previous?.status === 'AWAITING_CONFIRMATION' && previous.actionKey === definition.key
      && previous.confirmation && previous.expiresAt && new Date(previous.expiresAt) > new Date()
      && JSON.stringify(previous.args) === JSON.stringify(args)) {
      return { status: 'success', message: `Voy a ${definition.description.charAt(0).toLowerCase()}${definition.description.slice(1)} ¿Confirmas?`, confirmation: previous.confirmation };
    }
    let preview: ActionPreview;
    try {
      preview = definition.prepare
        ? await definition.prepare({ actor: input.actor, args })
        : { object: { type: definition.domain, id: definition.contextField ? args[definition.contextField] : undefined }, after: args, impact: definition.risk === 'DESTRUCTIVE' ? 'Esta acción cambia el estado del objeto y conserva su trazabilidad.' : 'Persistirá los cambios mostrados mediante el servicio canónico.' };
    } catch (error) {
      if (error instanceof ProspectWorkflowError) throw new AssistantActionError(error.message, error.code, error.status);
      throw error;
    }
    const confirmationId = randomUUID();
    const details = [
      { label: 'Acción', value: definition.description },
      { label: 'Objeto', value: preview.object?.label || preview.object?.id || preview.object?.type || definition.domain },
      ...(preview.before == null ? [] : [{ label: 'Antes', value: displayValue(preview.before) }]),
      { label: 'Después', value: displayValue(preview.after ?? args) },
      { label: 'Impacto', value: preview.impact || 'Persistirá el cambio mediante el servicio canónico.' },
    ];
    const reinforced = confirmationPolicy === 'REINFORCED';
    const confirmation = { id: confirmationId, title: definition.description, summary: reinforced ? 'Cambio administrativo sensible. Revisa el estado actual, la propuesta y su impacto antes de continuar.' : 'Revisa el cambio antes de ejecutarlo.', level: reinforced ? 'REINFORCED' as const : 'STANDARD' as const, details, confirmLabel: definition.confirmLabel || (reinforced ? 'Confirmar cambio administrativo' : 'Confirmar') };
    const state: AssistantActionState = { status: 'AWAITING_CONFIRMATION', actionKey: definition.key, args, invocationId, confirmationId, expiresAt: new Date(Date.now() + 15 * 60_000).toISOString(), confirmation, preview };
    await assistantConversationService.setActionState(input.actor, input.conversationId, state);
    return { status: 'success', message: `Voy a ${definition.description.charAt(0).toLowerCase()}${definition.description.slice(1)} ¿Confirmas?`, confirmation };
  }
  const result = await execute(definition, input.actor, input.conversationId, args, invocationId, input.correlationId);
  const reply = { status: 'success' as const, message: result.message, refresh: result.refresh };
  await assistantConversationService.setActionState(input.actor, input.conversationId, {
    status: 'COMPLETED', actionKey: definition.key, args, invocationId, result: reply,
  });
  return reply;
}

export async function confirmAssistantAction(input: { actor: Actor; conversationId: string; confirmationId: string; correlationId: string }): Promise<AssistantOperationalReply> {
  const claim = await assistantConversationService.claimActionState(input.actor, input.conversationId, input.confirmationId);
  if (claim.status === 'COMPLETED' && claim.state?.result) return claim.state.result;
  if (claim.status === 'IN_PROGRESS') throw new AssistantActionError('La acción ya se está ejecutando. Espera el resultado antes de volver a intentarlo.', 'AI_ACTION_IN_PROGRESS', 409);
  if (claim.status !== 'CLAIMED' || !claim.state) throw new AssistantActionError('Esta confirmación ya no está disponible.', 'AI_CONFIRMATION_NOT_FOUND', 404);
  const state = claim.state;
  if (!state.expiresAt || new Date(state.expiresAt) <= new Date()) { await assistantConversationService.setActionState(input.actor, input.conversationId, undefined); throw new AssistantActionError('La confirmación expiró. Prepara de nuevo la acción.', 'AI_CONFIRMATION_EXPIRED', 410); }
  const definition = byKey.get(state.actionKey);
  if (!definition || effectiveConfirmation(definition, 'PROACTIVE') === 'NONE') throw new AssistantActionError('La acción preparada ya no está disponible.', 'AI_CONFIRMATION_DENIED', 403);
  const args = await resolveQuery(input.actor, validateArgs(definition, state.args));
  const missing = missingFields(definition, args);
  if (missing.length) throw new AssistantActionError(missingQuestion[missing[0]] || `Falta ${missing[0]} para ejecutar la acción.`, 'AI_CONFIRMATION_DATA_INCOMPLETE', 409);
  try {
    const result = await execute(definition, input.actor, input.conversationId, args, state.invocationId, input.correlationId, state.preview);
    const reply = { status: 'success' as const, message: result.message, refresh: result.refresh };
    await assistantConversationService.setActionState(input.actor, input.conversationId, { ...state, status: 'COMPLETED', result: reply, confirmation: undefined, executingAt: undefined });
    return reply;
  } catch (error) {
    await assistantConversationService.setActionState(input.actor, input.conversationId, { ...state, status: 'AWAITING_CONFIRMATION', executingAt: undefined });
    const failure = error as { name?: unknown; code?: unknown; message?: unknown; status?: unknown };
    console.error(JSON.stringify({
      type: 'assistant_action_failed', level: 'error', action_key: state.actionKey,
      conversation_id: input.conversationId, correlation_id: input.correlationId,
      error_name: String(failure?.name || 'Error'), error_code: failure?.code,
      error_status: failure?.status, error_message: String(failure?.message || 'Unknown error').slice(0, 500),
    }));
    throw error;
  }
}

export async function cancelPendingAssistantAction(actor: Actor, conversationId: string) {
  await assistantConversationService.setActionState(actor, conversationId, undefined);
}

export async function cancelAssistantConfirmation(actor: Actor, conversationId: string, confirmationId: string) {
  const state = await assistantConversationService.actionState(actor, conversationId);
  if (!state || state.status !== 'AWAITING_CONFIRMATION' || state.confirmationId !== confirmationId) {
    throw new AssistantActionError('Esta confirmación ya no está disponible.', 'AI_CONFIRMATION_NOT_FOUND', 404);
  }
  await assistantConversationService.setActionState(actor, conversationId, undefined);
}

export function assistantActionDefinitionCount() { return definitions.length; }
