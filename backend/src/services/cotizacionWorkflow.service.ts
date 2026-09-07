import type { Request } from 'express';
import { CotizacionEtapaContractual as Stage, Prisma, PrismaClient } from '@prisma/client';
import {
  QUOTE_CONTRACT_ACTIONS,
  QUOTE_CONTRACT_STAGES,
  QuoteContractAction,
  allowedQuoteActions,
  assertQuoteFields,
  assertQuoteReplay,
  assertQuoteVersion,
  failQuote,
  quoteActionResult,
  quoteEffectiveAt,
  quoteHash,
  quoteJson,
  quoteKey,
  quoteKnowledge,
  quoteLegacyProjection,
  quoteStageLabel,
} from '../domain/cotizacionContract';
import { cotizacionObjectWhere } from './objectAccess.service';

type Actor = NonNullable<Request['user']>;
type Db = PrismaClient | Prisma.TransactionClient;
const actionFields = ['action', 'expectedVersion', 'idempotencyKey', 'confirm', 'effectiveAt', 'channel', 'recipient', 'evidence', 'versionId', 'reason'] as const;
const trim = (value: unknown, max = 4000) => typeof value === 'string' ? value.trim().slice(0, max) : '';

const permission = (actor: Actor, name: Actor['permissions'][number]) => {
  if (!actor?.id || !actor.organizationId) failQuote(401, 'AUTH_REQUIRED', 'Inicia sesión para continuar.');
  if (!actor.permissions.includes(name)) failQuote(403, 'PERMISSION_DENIED', 'No tienes permiso para realizar esta acción.');
};

export async function recordQuoteTransitionInTransaction(tx: Prisma.TransactionClient, input: {
  actor: Actor;
  quote: { id: string; organization_id: string | null; etapa_contractual: Stage | null; version_operativa: number; transicion_actual_id: string | null };
  action: QuoteContractAction | 'CREAR';
  next: Stage;
  changesStage: boolean;
  effectiveAt: Date;
  recordedAt: Date;
  key: string;
  hash: string;
  evidence: unknown;
  channel?: string | null;
  recipient?: string | null;
  reason?: string | null;
  quoteVersionId?: string | null;
}) {
  const { actor, quote } = input;
  if (quote.organization_id !== actor.organizationId) failQuote(404, 'COT001_NOT_FOUND', 'No se encontró la cotización o no tienes acceso.');
  const event = await tx.cotizacionTransicion.create({ data: {
    organization_id: actor.organizationId,
    cotizacion_id: quote.id,
    actor_id: actor.id,
    etapa_anterior: quote.etapa_contractual,
    etapa_nueva: input.next,
    effective_at: input.effectiveAt,
    recorded_at: input.recordedAt,
    accion: input.action,
    procedencia: input.action === 'CREAR' ? 'CONVERSION_PRO001' : 'CONFIRMACION_HUMANA',
    canal: input.channel || null,
    destinatario: input.recipient || null,
    causa: input.reason || null,
    evidencia: quoteJson(input.evidence),
    version: quote.version_operativa + 1,
    idempotency_key: input.key,
    payload_hash: input.hash,
    cambia_etapa: input.changesStage,
    cotizacion_version_id: input.quoteVersionId || null,
  } } as any);
  const quoteData: Prisma.CotizacionUpdateInput = {
    version_operativa: quote.version_operativa + 1,
    ...(input.changesStage ? {
      etapa_contractual: input.next,
      estado: quoteLegacyProjection(input.next),
      transicion_actual: { connect: { id: event.id } },
    } : {}),
  };
  if (input.action === 'ENVIAR_CLIENTE') quoteData.fecha_enviada_cliente = input.effectiveAt;
  if (input.action === 'REGISTRAR_ACEPTACION_ANTICIPO') quoteData.fecha_aceptacion_cliente = input.effectiveAt;
  if (input.action === 'CONVERTIR') quoteData.fecha_conversion_expediente = input.effectiveAt;
  await tx.cotizacion.update({ where: { id: quote.id }, data: quoteData });
  await tx.auditLog.create({ data: {
    organization_id: actor.organizationId,
    user_id: actor.id,
    accion: `COT001_${input.action}`,
    entidad: 'Cotizacion',
    entidad_id: quote.id,
    session_id: actor.sessionId ?? null,
    event_id: event.id,
    valores_anteriores: quoteJson({ stage: quote.etapa_contractual, version: quote.version_operativa }),
    valores_nuevos: quoteJson({ stage: input.next, version: quote.version_operativa + 1, effectiveAt: input.effectiveAt }),
    detalles: { source: 'COT-001', changesStage: input.changesStage },
  } });
  return event;
}

export async function initializeQuoteContractInTransaction(tx: Prisma.TransactionClient, actor: Actor, quote: {
  id: string; organization_id: string | null; etapa_contractual: Stage | null; version_operativa: number; transicion_actual_id: string | null;
}, input: { effectiveAt: Date; idempotencyKey: string; sourceId?: string | null; prospectId: string }) {
  if (quote.etapa_contractual || quote.transicion_actual_id || quote.version_operativa !== 0) failQuote(409, 'COT001_ALREADY_INITIALIZED', 'La cotización ya tiene una historia contractual.');
  return recordQuoteTransitionInTransaction(tx, {
    actor, quote, action: 'CREAR', next: Stage.BORRADOR, changesStage: true,
    effectiveAt: input.effectiveAt, recordedAt: input.effectiveAt,
    key: input.idempotencyKey,
    hash: quoteHash({ quoteId: quote.id, sourceId: input.sourceId ?? null, prospectId: input.prospectId, actor: actor.id }),
    evidence: { sourceId: input.sourceId ?? null, prospectId: input.prospectId, origin: input.sourceId ? 'LEGACY_NOTARY_SOURCE' : 'PROSPECT_DIRECT' },
  });
}

const readInclude = {
  transicion_actual: true,
  prospecto: { select: { id: true, nombre: true } },
  expediente: { select: { id: true, numero_pravia: true } },
  creada_por: { select: { id: true, nombre: true, apellido: true } },
} as const;

export class CotizacionWorkflowService {
  constructor(private readonly prisma: PrismaClient) {}

  private async lock(tx: Prisma.TransactionClient, organizationId: string, id: string) {
    await tx.$executeRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${`pravia:cot001:${organizationId}:${id}`}))`);
  }

  private async quote(db: Db, actor: Actor, id: string) {
    permission(actor, 'cotizaciones.read');
    const quote = await db.cotizacion.findFirst({ where: { id, ...cotizacionObjectWhere(actor) }, include: readInclude });
    if (!quote) return failQuote(404, 'COT001_NOT_FOUND', 'No se encontró la cotización o no tienes acceso.');
    return quote;
  }

  async read(actor: Actor, id: string) {
    const quote = await this.quote(this.prisma, actor, id);
    const events = await this.prisma.cotizacionTransicion.findMany({
      where: { organization_id: actor.organizationId, cotizacion_id: id },
      orderBy: { version: 'asc' },
      include: { actor: { select: { user: { select: { nombre: true, apellido: true } } } }, cotizacion_version: { select: { id: true, version: true, pdf_url: true } } },
    });
    const firstSend = events.find((event) => event.accion === 'ENVIAR_CLIENTE');
    const lastSend = [...events].reverse().find((event) => ['ENVIAR_CLIENTE', 'REENVIAR_CLIENTE'].includes(event.accion));
    const accepted = events.find((event) => event.accion === 'REGISTRAR_ACEPTACION_ANTICIPO');
    const suspended = events.find((event) => event.accion === 'SUSPENDER');
    const cancelled = events.find((event) => event.accion === 'CANCELAR');
    const converted = events.find((event) => event.accion === 'CONVERTIR');
    const writable = actor.permissions.includes('cotizaciones.write');
    const actions = writable ? allowedQuoteActions(quote.etapa_contractual).filter((action) => action !== 'CONVERTIR' || actor.permissions.includes('expedientes.write')) : [];
    return {
      stage: quote.etapa_contractual,
      stageLabel: quoteStageLabel(quote.etapa_contractual),
      stageEnteredAt: quote.transicion_actual?.effective_at ?? null,
      knowledge: quoteKnowledge(quote.etapa_contractual),
      version: quote.version_operativa,
      stages: QUOTE_CONTRACT_STAGES,
      actions: actions.map((code) => ({ code, label: QUOTE_CONTRACT_ACTIONS[code] })),
      firstSentAt: firstSend?.effective_at ?? null,
      lastSentAt: lastSend?.effective_at ?? null,
      acceptedAdvanceAt: accepted?.effective_at ?? null,
      suspendedAt: suspended?.effective_at ?? null,
      cancelledAt: cancelled?.effective_at ?? null,
      convertedAt: converted?.effective_at ?? null,
      originProspect: quote.prospecto,
      linkedCase: quote.expediente,
      responsible: quote.creada_por,
      provenance: quote.transicion_actual?.procedencia ?? null,
      events: events.map((event) => ({
        id: event.id,
        previous: event.etapa_anterior,
        next: event.etapa_nueva,
        previousLabel: event.etapa_anterior ? quoteStageLabel(event.etapa_anterior) : null,
        nextLabel: quoteStageLabel(event.etapa_nueva),
        action: event.accion,
        actionLabel: event.accion === 'CREAR' ? 'Cotización creada desde Prospecto' : QUOTE_CONTRACT_ACTIONS[event.accion as QuoteContractAction],
        effectiveAt: event.effective_at,
        recordedAt: event.recorded_at,
        channel: event.canal,
        recipient: event.destinatario,
        reason: event.causa,
        changesStage: event.cambia_etapa,
        actor: [event.actor.user.nombre, event.actor.user.apellido].filter(Boolean).join(' '),
        quoteVersion: event.cotizacion_version,
      })),
      legacy: { state: quote.estado, sentAt: quote.fecha_enviada_cliente, acceptedAt: quote.fecha_aceptacion_cliente, convertedAt: quote.fecha_conversion_expediente },
    };
  }

  async act(actor: Actor, id: string, raw: Record<string, unknown>) {
    permission(actor, 'cotizaciones.write');
    assertQuoteFields(raw, actionFields);
    const action = raw.action as QuoteContractAction;
    if (!Object.prototype.hasOwnProperty.call(QUOTE_CONTRACT_ACTIONS, action) || action === 'CONVERTIR') {
      failQuote(400, 'COT001_ACTION_INVALID', 'Selecciona una acción comercial válida.');
    }
    if (raw.confirm !== true) failQuote(400, 'COT001_CONFIRM_REQUIRED', 'Revisa y confirma la acción antes de continuar.');
    const key = quoteKey(raw.idempotencyKey);
    const hash = quoteHash({ ...raw, actor: actor.id });
    return this.prisma.$transaction(async (tx) => {
      await this.lock(tx, actor.organizationId, id);
      const quote = await this.quote(tx, actor, id);
      if (!quote.etapa_contractual) failQuote(409, 'COT001_LEGACY_COMPATIBILITY_ONLY', 'Esta cotización histórica conserva su flujo original y no puede adoptar hitos contractuales sin revisión.');
      const existing = await tx.cotizacionTransicion.findFirst({ where: { organization_id: actor.organizationId, cotizacion_id: id, idempotency_key: key } });
      if (existing) { assertQuoteReplay(existing, hash, actor.id); return { idempotent: true, eventId: existing.id }; }
      assertQuoteVersion(raw.expectedVersion, quote.version_operativa);
      const { next, changesStage } = quoteActionResult(quote.etapa_contractual, action);
      const recordedAt = new Date();
      const effectiveAt = quoteEffectiveAt(raw.effectiveAt, recordedAt, quote.transicion_actual?.effective_at ?? null, true);
      let quoteVersionId: string | null = null;
      let channel: string | null = null;
      let recipient: string | null = null;
      let evidence: Record<string, unknown> = { confirmation: 'Confirmación explícita del actor' };
      if (action === 'ENVIAR_CLIENTE' || action === 'REENVIAR_CLIENTE') {
        channel = trim(raw.channel, 100); recipient = trim(raw.recipient, 320); const deliveryEvidence = trim(raw.evidence);
        if (!channel || !recipient || !deliveryEvidence) failQuote(400, 'COT001_SEND_EVIDENCE_REQUIRED', 'Indica canal, destinatario y evidencia del envío realizado.');
        const approved = await tx.cotizacionVersion.findFirst({ where: { cotizacion_id: id, aprobada: true }, orderBy: { version: 'desc' } });
        if (!approved) return failQuote(409, 'COT001_APPROVED_VERSION_REQUIRED', 'Aprueba la cotización estructurada antes de enviarla al cliente.');
        if (raw.versionId && String(raw.versionId) !== approved.id) failQuote(409, 'COT001_VERSION_CHANGED', 'La versión vigente cambió. Actualiza la ficha antes de registrar el envío.');
        quoteVersionId = approved.id;
        evidence = { deliveryEvidence, deliveryConfirmedByProvider: false, quoteVersion: approved.version, pdfAvailable: Boolean(approved.pdf_url) };
      }
      const event = await recordQuoteTransitionInTransaction(tx, {
        actor, quote, action, next, changesStage, effectiveAt, recordedAt, key, hash, evidence,
        channel, recipient, reason: trim(raw.reason) || null, quoteVersionId,
      });
      return { idempotent: false, eventId: event.id };
    }, { timeout: 15000, maxWait: 10000 });
  }
}
