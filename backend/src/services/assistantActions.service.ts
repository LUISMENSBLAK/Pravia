import { createHash, randomUUID } from 'crypto';
import type { Request, Response } from 'express';
import prisma from '../config/prisma';
import { AgendaController } from '../controllers/agenda.controller';
import { expedienteAccessWhere } from '../middleware/auth.middleware';
import { prospectoObjectWhere, cotizacionObjectWhere } from './objectAccess.service';
import { assistantConversationService, type AssistantActionState } from './assistantConversation.service';
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

type Actor = NonNullable<Request['user']>;
export type AssistantActionRisk = 'READ' | 'SAFE_WRITE' | 'SENSITIVE_WRITE' | 'DESTRUCTIVE';
export type AssistantActionContext = {
  entityType?: string;
  entityId?: string;
  module?: string;
  route?: string;
};

type FieldType = 'string' | 'number' | 'boolean' | 'string[]' | 'object';
type Field = { type: FieldType; required?: boolean; enum?: readonly string[]; max?: number };
type ActionResult = { entityType: string; entityId?: string; message: string; refresh: string; details?: Array<{ label: string; value: string }> };
type ExecuteInput = { actor: Actor; args: Record<string, any>; invocationId: string; correlationId: string };
type Definition = {
  key: string;
  domain: string;
  description: string;
  permissions: string[];
  risk: AssistantActionRisk;
  confirmation: 'NONE' | 'REQUIRED';
  fields: Record<string, Field>;
  contextField?: string;
  contextTypes?: string[];
  execute(input: ExecuteInput): Promise<ActionResult>;
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
  if (typeof value === 'object' && value) return 'Datos estructurados';
  return safeText(value, 120);
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

const definitions: Definition[] = [
  {
    key: 'agenda.event.create', domain: 'Agenda', description: 'Crear una cita o evento en Agenda.',
    permissions: ['agenda.write'], risk: 'SAFE_WRITE', confirmation: 'NONE',
    fields: {
      titulo: { type: 'string', required: true, max: 180 }, tipo: { type: 'string', enum: ['PERSONAL','DESPACHO','FIRMA','AUDIENCIA','VENCIMIENTO','CITA','NOTARIA','SEGUIMIENTO','OTRO'] },
      fecha_inicio: { type: 'string', required: true, max: 50 }, fecha_fin: { type: 'string', max: 50 }, todo_el_dia: { type: 'boolean' }, descripcion: { type: 'string', max: 2_000 },
      responsable_id: { type: 'string', max: 80 }, expediente_id: { type: 'string', max: 80 }, expediente_query: { type: 'string', max: 120 }, compareciente_id: { type: 'string', max: 80 }, recordatorios: { type: 'object' },
    }, contextField: 'expediente_id', contextTypes: ['expediente'],
    async execute(input) {
      input.args.idempotency_key = input.invocationId;
      const payload = await invokeAgenda(AgendaController.create, input);
      return { entityType: 'EventoAgenda', entityId: payload.evento?.id, message: 'Listo, el evento quedó creado en Agenda.', refresh: 'agenda', details: [{ label: 'Evento', value: safeText(payload.evento?.titulo || input.args.titulo, 180) }, { label: 'Fecha', value: safeText(payload.evento?.fecha_inicio || input.args.fecha_inicio, 80) }] };
    },
  },
  {
    key: 'agenda.event.update', domain: 'Agenda', description: 'Actualizar un evento accesible de Agenda.',
    permissions: ['agenda.write'], risk: 'SAFE_WRITE', confirmation: 'NONE',
    fields: { event_id: { type: 'string', required: true, max: 80 }, titulo: { type: 'string', max: 180 }, tipo: { type: 'string', enum: ['PERSONAL','DESPACHO','FIRMA','AUDIENCIA','VENCIMIENTO','CITA','NOTARIA','SEGUIMIENTO','OTRO'] }, fecha_inicio: { type: 'string', max: 50 }, fecha_fin: { type: 'string', max: 50 }, todo_el_dia: { type: 'boolean' }, descripcion: { type: 'string', max: 2_000 }, responsable_id: { type: 'string', max: 80 }, expediente_id: { type: 'string', max: 80 }, compareciente_id: { type: 'string', max: 80 }, estatus: { type: 'string', enum: ['ACTIVO','COMPLETADO'] }, recordatorios: { type: 'object' } },
    contextField: 'event_id', contextTypes: ['evento'],
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
    async execute(input) {
      const payload = await invokeAgenda(AgendaController.cancel, input, { id: input.args.event_id });
      return { entityType: 'EventoAgenda', entityId: payload.evento?.id, message: 'El evento quedó cancelado y conserva su historial.', refresh: 'agenda' };
    },
  },
  {
    key: 'prospect.create', domain: 'Prospectos', description: 'Crear un prospecto en la etapa inicial canónica.',
    permissions: ['prospectos.write'], risk: 'SAFE_WRITE', confirmation: 'NONE',
    fields: { nombre: { type: 'string', required: true, max: 300 }, telefono: { type: 'string', max: 80 }, email: { type: 'string', max: 320 }, necesidad: { type: 'string', max: 2_000 }, prioridad: { type: 'string', enum: ['BAJA','MEDIA','ALTA'] }, servicio_catalogo_codigo: { type: 'string', max: 80 }, tiene_predial: { type: 'boolean' }, tiene_antecedente: { type: 'boolean' } },
    async execute(input) {
      const result = await new ProspectWorkflowService(prisma).create(input.actor, input.args, input.invocationId);
      return { entityType: 'Prospecto', entityId: result.prospecto.id, message: 'Listo, el prospecto quedó creado en la etapa inicial.', refresh: 'prospectos', details: [{ label: 'Prospecto', value: result.prospecto.nombre }] };
    },
  },
  {
    key: 'prospect.update', domain: 'Prospectos', description: 'Actualizar datos permitidos de un prospecto accesible.',
    permissions: ['prospectos.write'], risk: 'SAFE_WRITE', confirmation: 'NONE',
    fields: { prospect_id: { type: 'string', required: true, max: 80 }, prospect_query: { type: 'string', max: 120 }, nombre: { type: 'string', max: 300 }, telefono: { type: 'string', max: 80 }, email: { type: 'string', max: 320 }, necesidad: { type: 'string', max: 2_000 }, prioridad: { type: 'string', enum: ['BAJA','MEDIA','ALTA'] }, servicio_catalogo_codigo: { type: 'string', max: 80 }, tiene_predial: { type: 'boolean' }, tiene_antecedente: { type: 'boolean' }, responsable_id: { type: 'string', max: 80 }, notaria_id: { type: 'string', max: 80 } },
    contextField: 'prospect_id', contextTypes: ['prospecto'],
    async execute(input) {
      const service = new ProspectWorkflowService(prisma); const current = await service.read(input.actor, input.args.prospect_id);
      const { prospect_id: _id, prospect_query: _query, ...changes } = input.args;
      const result = await service.update(input.actor, input.args.prospect_id, { ...changes, expectedVersion: current.version });
      return { entityType: 'Prospecto', entityId: result.id, message: 'Listo, la ficha del prospecto quedó actualizada.', refresh: 'prospectos' };
    },
  },
  {
    key: 'prospect.transition', domain: 'Prospectos', description: 'Ejecutar una transición contractual válida del prospecto.',
    permissions: ['prospectos.write'], risk: 'SENSITIVE_WRITE', confirmation: 'REQUIRED',
    fields: { prospect_id: { type: 'string', required: true, max: 80 }, prospect_query: { type: 'string', max: 120 }, action: { type: 'string', required: true, max: 80 }, effectiveAt: { type: 'string', max: 50 }, channel: { type: 'string', max: 100 }, recipient: { type: 'string', max: 320 }, evidence: { type: 'string', max: 2_000 }, reason: { type: 'string', max: 500 }, attachmentIds: { type: 'string[]' }, documentId: { type: 'string', max: 80 } },
    contextField: 'prospect_id', contextTypes: ['prospecto'],
    async execute(input) {
      const service = new ProspectWorkflowService(prisma); const current = await service.read(input.actor, input.args.prospect_id);
      const { prospect_id: _id, prospect_query: _query, ...command } = input.args;
      const result = await service.act(input.actor, input.args.prospect_id, { ...command, expectedVersion: current.version, idempotencyKey: input.invocationId, confirm: true });
      return { entityType: 'Prospecto', entityId: input.args.prospect_id, message: 'La transición del prospecto quedó registrada.', refresh: 'prospectos', details: result.quoteId ? [{ label: 'Resultado', value: 'Cotización creada mediante el flujo canónico' }] : undefined };
    },
  },
  {
    key: 'prospect.notary_request.prepare', domain: 'Prospectos', description: 'Preparar el borrador de solicitud a la notaría sin registrar un envío.',
    permissions: ['prospectos.write'], risk: 'READ', confirmation: 'NONE',
    fields: { prospect_id: { type: 'string', required: true, max: 80 }, prospect_query: { type: 'string', max: 120 }, attachment_ids: { type: 'string[]' } },
    contextField: 'prospect_id', contextTypes: ['prospecto'],
    async execute(input) {
      const service = new ProspectWorkflowService(prisma);
      const current = await service.read(input.actor, input.args.prospect_id);
      const draft = await service.prepare(input.actor, input.args.prospect_id, { expectedVersion: current.version, attachmentIds: input.args.attachment_ids || [] });
      return { entityType: 'Prospecto', entityId: input.args.prospect_id, message: `Preparé el borrador, pero no registré ningún envío.\n\nAsunto: ${safeText(draft.subject, 300)}\n\n${safeText(draft.content, 4_000)}`, refresh: 'prospectos' };
    },
  },
  {
    key: 'quote.transition', domain: 'Cotizaciones', description: 'Registrar un hito o transición válida de una cotización.',
    permissions: ['cotizaciones.write'], risk: 'SENSITIVE_WRITE', confirmation: 'REQUIRED',
    fields: { quote_id: { type: 'string', required: true, max: 80 }, quote_query: { type: 'string', max: 120 }, action: { type: 'string', required: true, max: 80 }, effectiveAt: { type: 'string', max: 50 }, channel: { type: 'string', max: 100 }, recipient: { type: 'string', max: 320 }, evidence: { type: 'string', max: 2_000 }, reason: { type: 'string', max: 500 }, versionId: { type: 'string', max: 80 } },
    contextField: 'quote_id', contextTypes: ['cotizacion'],
    async execute(input) {
      const service = new CotizacionWorkflowService(prisma); const current = await service.read(input.actor, input.args.quote_id);
      const { quote_id: _id, quote_query: _query, ...command } = input.args;
      await service.act(input.actor, input.args.quote_id, { ...command, expectedVersion: current.version, idempotencyKey: input.invocationId, confirm: true });
      return { entityType: 'Cotizacion', entityId: input.args.quote_id, message: 'La transición de la cotización quedó registrada.', refresh: 'cotizaciones' };
    },
  },
  {
    key: 'quote.convert_to_case', domain: 'Cotizaciones', description: 'Convertir una cotización elegible en expediente.',
    permissions: ['cotizaciones.write', 'expedientes.write'], risk: 'SENSITIVE_WRITE', confirmation: 'REQUIRED',
    fields: { quote_id: { type: 'string', required: true, max: 80 }, quote_query: { type: 'string', max: 120 }, abogado_id: { type: 'string', max: 80 }, tipo_acto_id: { type: 'string', max: 80 }, effectiveAt: { type: 'string', max: 50 } },
    contextField: 'quote_id', contextTypes: ['cotizacion'],
    async execute(input) {
      const current = await new CotizacionWorkflowService(prisma).read(input.actor, input.args.quote_id);
      const result = await new CotizacionConversionService(prisma).convert({ cotizacionId: input.args.quote_id, actor: input.actor, actorUserId: input.actor.id, actorOrganizationId: input.actor.organizationId, actorSessionId: input.actor.sessionId, abogadoId: input.args.abogado_id, tipoActoId: input.args.tipo_acto_id, effectiveAt: input.args.effectiveAt, expectedVersion: current.version, idempotencyKey: input.invocationId, confirm: true, correlationId: input.correlationId });
      return { entityType: 'Expediente', entityId: result.expediente.id, message: result.alreadyConverted ? 'La cotización ya estaba vinculada a su expediente.' : 'Listo, la cotización quedó convertida mediante el flujo canónico.', refresh: 'expedientes', details: [{ label: 'Expediente', value: result.expediente.numero_pravia }] };
    },
  },
  {
    key: 'case.add_note', domain: 'Expedientes', description: 'Agregar una nota operativa al expediente actual.',
    permissions: ['expedientes.write'], risk: 'SAFE_WRITE', confirmation: 'NONE',
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
    key: 'tracking.activity.update', domain: 'Seguimiento', description: 'Actualizar una actividad operativa del seguimiento.',
    permissions: ['expedientes.write'], risk: 'SAFE_WRITE', confirmation: 'NONE',
    fields: { expediente_id: { type: 'string', required: true, max: 80 }, expediente_query: { type: 'string', max: 120 }, activity_id: { type: 'string', required: true, max: 80 }, estado: { type: 'string', required: true, enum: ['NO_INICIADO','EN_PROCESO','EN_ESPERA_EXTERNA','COMPLETADO','NO_APLICA'] }, responsable_id: { type: 'string', max: 80 }, razon: { type: 'string', max: 600 } },
    contextField: 'expediente_id', contextTypes: ['expediente'],
    async execute(input) {
      const service = new ExpedienteSeguimientoService(prisma); const current = await service.read(input.actor, input.args.expediente_id);
      const activities = current.actos.flatMap((act: any) => act.etapas.flatMap((stage: any) => stage.actividades));
      const activity = activities.find((item: any) => item.id === input.args.activity_id);
      if (!activity) throw new AssistantActionError('No tienes acceso a esa actividad.', 'AI_ACTION_TARGET_DENIED', 403);
      const result = await service.update(input.actor, input.args.expediente_id, input.args.activity_id, { expected_version: activity.version, estado: input.args.estado, responsable_id: input.args.responsable_id, razon: input.args.razon });
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
];

const byKey = new Map(definitions.map((definition) => [definition.key, definition]));

export function assistantActionCatalog(actor: Actor) {
  return definitions.filter((definition) => hasPermissions(actor, definition.permissions)).map((definition) => ({
    key: definition.key, domain: definition.domain, description: definition.description, risk: definition.risk,
    confirmation: definition.confirmation, required: Object.entries(definition.fields).filter(([, field]) => field.required).map(([name]) => name),
    arguments: Object.keys(definition.fields),
  }));
}

function validateArgs(definition: Definition, raw: unknown) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new AssistantActionError('Los datos de la acción no son válidos.', 'AI_ACTION_ARGUMENTS_INVALID');
  const args = { ...(raw as Record<string, unknown>) };
  for (const key of Object.keys(args)) if (!definition.fields[key]) throw new AssistantActionError('La acción incluye un dato no permitido.', 'AI_ACTION_UNKNOWN_ARGUMENT');
  for (const [key, value] of Object.entries(args)) {
    const field = definition.fields[key];
    if (value === undefined || value === null || value === '') continue;
    const valid = field.type === 'string' ? typeof value === 'string'
      : field.type === 'number' ? typeof value === 'number' && Number.isFinite(value)
        : field.type === 'boolean' ? typeof value === 'boolean'
          : field.type === 'string[]' ? Array.isArray(value) && value.length <= 50 && value.every((item) => typeof item === 'string')
            : field.type === 'object' ? typeof value === 'object' && !Array.isArray(value) : false;
    if (!valid) throw new AssistantActionError(`El campo ${key} no tiene el formato esperado.`, 'AI_ACTION_ARGUMENT_TYPE_INVALID');
    if (field.max && typeof value === 'string' && value.length > field.max) throw new AssistantActionError(`El campo ${key} es demasiado largo.`, 'AI_ACTION_ARGUMENT_TOO_LONG');
    if (field.enum && !field.enum.includes(String(value))) throw new AssistantActionError(`El valor de ${key} no está permitido.`, 'AI_ACTION_ARGUMENT_ENUM_INVALID');
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

function applyContext(definition: Definition, args: Record<string, any>, context?: AssistantActionContext) {
  if (definition.contextField && !args[definition.contextField] && context?.entityId && definition.contextTypes?.includes(String(context.entityType))) {
    args[definition.contextField] = context.entityId;
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
  cambio: '¿Qué dato quieres cambiar?',
};

async function auditOrigin(input: ExecuteInput, definition: Definition, result: ActionResult) {
  await prisma.auditLog.create({ data: {
    organization_id: input.actor.organizationId, user_id: input.actor.id, accion: 'AI_ACTION_COMPLETED', entidad: result.entityType,
    entidad_id: result.entityId || input.actor.id, correlation_id: input.correlationId, session_id: input.actor.sessionId,
    detalles: { origin: 'PRAVIA_AI', action_key: definition.key, invocation_id: input.invocationId },
  } });
}

async function execute(definition: Definition, actor: Actor, args: Record<string, any>, invocationId: string, correlationId: string) {
  if (!hasPermissions(actor, definition.permissions)) throw new AssistantActionError('No tienes permiso para hacer eso.', 'AI_ACTION_DENIED', 403);
  const input = { actor, args, invocationId, correlationId };
  const result = await definition.execute(input);
  await auditOrigin(input, definition, result).catch((error: any) => {
    console.error(JSON.stringify({ type: 'ai_action_origin_audit_failed', level: 'error', action_key: definition.key, correlation_id: correlationId, error_name: error?.name || 'Error' }));
  });
  return result;
}

export type AssistantOperationalReply = {
  status: 'success'; message: string; confirmation?: { id: string; title: string; summary?: string; details: Array<{ label: string; value: string }>; confirmLabel?: string };
  refresh?: string;
};

export async function prepareOrExecuteAssistantAction(input: { actor: Actor; conversationId: string; messageId: string; actionKey: string; args: unknown; context?: AssistantActionContext; correlationId: string }): Promise<AssistantOperationalReply> {
  const definition = byKey.get(input.actionKey);
  if (!definition) throw new AssistantActionError('Esa acción no está disponible.', 'AI_ACTION_UNKNOWN', 404);
  if (!hasPermissions(input.actor, definition.permissions)) throw new AssistantActionError('No tienes permiso para hacer eso.', 'AI_ACTION_DENIED', 403);
  const supplied = validateArgs(definition, input.args);
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
    const state: AssistantActionState = { status: 'COLLECTING', actionKey: definition.key, args, invocationId, missing };
    await assistantConversationService.setActionState(input.actor, input.conversationId, state);
    return { status: 'success', message: missingQuestion[missing[0]] || `Necesito ${missing[0]} para continuar.` };
  }
  if (definition.confirmation === 'REQUIRED') {
    if (previous?.status === 'AWAITING_CONFIRMATION' && previous.actionKey === definition.key
      && previous.confirmation && previous.expiresAt && new Date(previous.expiresAt) > new Date()
      && JSON.stringify(previous.args) === JSON.stringify(args)) {
      return { status: 'success', message: `Voy a ${definition.description.charAt(0).toLowerCase()}${definition.description.slice(1)} ¿Confirmas?`, confirmation: previous.confirmation };
    }
    const confirmationId = randomUUID();
    const details = Object.entries(args).filter(([key]) => !key.endsWith('_id') && !key.endsWith('_query')).slice(0, 4).map(([key, value]) => ({ label: key.replace(/_/g, ' '), value: displayValue(value) }));
    const confirmation = { id: confirmationId, title: definition.description, details, confirmLabel: 'Confirmar' };
    const state: AssistantActionState = { status: 'AWAITING_CONFIRMATION', actionKey: definition.key, args, invocationId, confirmationId, expiresAt: new Date(Date.now() + 15 * 60_000).toISOString(), confirmation };
    await assistantConversationService.setActionState(input.actor, input.conversationId, state);
    return { status: 'success', message: `Voy a ${definition.description.charAt(0).toLowerCase()}${definition.description.slice(1)} ¿Confirmas?`, confirmation };
  }
  const result = await execute(definition, input.actor, args, invocationId, input.correlationId);
  const reply = { status: 'success' as const, message: result.message, refresh: result.refresh };
  await assistantConversationService.setActionState(input.actor, input.conversationId, {
    status: 'COMPLETED', actionKey: definition.key, args, invocationId, result: reply,
  });
  return reply;
}

export async function confirmAssistantAction(input: { actor: Actor; conversationId: string; confirmationId: string; correlationId: string }): Promise<AssistantOperationalReply> {
  const state = await assistantConversationService.actionState(input.actor, input.conversationId);
  if (state?.status === 'COMPLETED' && state.confirmationId === input.confirmationId && state.result) return state.result;
  if (!state || state.status !== 'AWAITING_CONFIRMATION' || state.confirmationId !== input.confirmationId) throw new AssistantActionError('Esta confirmación ya no está disponible.', 'AI_CONFIRMATION_NOT_FOUND', 404);
  if (!state.expiresAt || new Date(state.expiresAt) <= new Date()) { await assistantConversationService.setActionState(input.actor, input.conversationId, undefined); throw new AssistantActionError('La confirmación expiró. Prepara de nuevo la acción.', 'AI_CONFIRMATION_EXPIRED', 410); }
  const definition = byKey.get(state.actionKey);
  if (!definition || definition.confirmation !== 'REQUIRED') throw new AssistantActionError('La acción preparada ya no está disponible.', 'AI_CONFIRMATION_DENIED', 403);
  const args = await resolveQuery(input.actor, validateArgs(definition, state.args));
  const result = await execute(definition, input.actor, args, state.invocationId, input.correlationId);
  const reply = { status: 'success' as const, message: result.message, refresh: result.refresh };
  await assistantConversationService.setActionState(input.actor, input.conversationId, { ...state, status: 'COMPLETED', result: reply, confirmation: undefined });
  return reply;
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
