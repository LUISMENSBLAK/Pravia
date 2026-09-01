import { createHash } from 'crypto';
import type { Request } from 'express';
import {
  Prisma,
  PrismaClient,
  TimingCalendarSemantics,
  TimingCalculationStatus,
  TimingPolicyDomain,
  TimingPolicyType,
  TimingPolicyUnit,
} from '@prisma/client';
import type { Permission } from '../auth/permissions';
import prisma from '../config/prisma';
import { expedienteAccessWhere } from '../middleware/auth.middleware';
import { prospectoObjectWhere } from './objectAccess.service';

type Actor = NonNullable<Request['user']>;
type Db = PrismaClient | Prisma.TransactionClient;
type Tx = Prisma.TransactionClient;

export class TimingPolicyError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) { super(message); }
}

export const TIMING_POLICY_DEFINITIONS = [
  { type: TimingPolicyType.PROSPECT_INFO_COLLECTION, domain: TimingPolicyDomain.COMMERCIAL, label: 'Prospecto · Recabando información', description: 'Desde la entrada efectiva a Recabando información hasta la salida de esa etapa.' },
  { type: TimingPolicyType.PROSPECT_READY_TO_REQUEST, domain: TimingPolicyDomain.COMMERCIAL, label: 'Prospecto · Listo para solicitar', description: 'Desde Listo para solicitar hasta el envío efectivo confirmado a Notaría.' },
  { type: TimingPolicyType.PROSPECT_NOTARY_WAIT, domain: TimingPolicyDomain.COMMERCIAL, label: 'Prospecto · Espera de Notaría', description: 'Desde el envío efectivo hasta la recepción efectiva de la cotización notarial.' },
  { type: TimingPolicyType.ADMIN_PAYMENT_REQUEST_PENDING, domain: TimingPolicyDomain.ADMINISTRATIVE, label: 'Solicitud de pago pendiente', description: 'Desde la creación pendiente hasta que se paga o anula.' },
  { type: TimingPolicyType.ADMIN_RECEIPT_PENDING_APPLICATION, domain: TimingPolicyDomain.ADMINISTRATIVE, label: 'Comprobante pendiente de aplicación', description: 'Desde el reporte del comprobante hasta que se aplica o anula.' },
] as const;

const definitionByType = new Map(TIMING_POLICY_DEFINITIONS.map((item) => [item.type, item]));
const json = (value: unknown) => JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
const clean = (value: unknown, max: number) => String(value ?? '').trim().slice(0, max);
const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const requirePermission = (actor: Actor, permission: Permission) => {
  if (!actor?.id || !actor.organizationId) throw new TimingPolicyError(401, 'AUTH_REQUIRED', 'Inicia sesión para continuar.');
  if (!actor.permissions.includes(permission)) throw new TimingPolicyError(403, 'TIMING_POLICY_PERMISSION_DENIED', 'No tienes permiso para administrar esta configuración.');
};
const policyDefinition = (value: unknown) => {
  const definition = definitionByType.get(value as TimingPolicyType);
  if (!definition) throw new TimingPolicyError(400, 'TIMING_POLICY_TYPE_INVALID', 'Selecciona uno de los cinco tipos de tiempo disponibles.');
  return definition;
};
const publicationKey = (value: unknown) => {
  const key = clean(value, 120);
  if (!key) throw new TimingPolicyError(400, 'TIMING_POLICY_IDEMPOTENCY_REQUIRED', 'No fue posible identificar de forma segura la publicación.');
  return key;
};
const provenance = (value: unknown) => {
  const source = clean(value, 500);
  if (!source) throw new TimingPolicyError(400, 'TIMING_POLICY_PROVENANCE_REQUIRED', 'Indica la procedencia de esta configuración.');
  return source;
};
const duration = (value: unknown) => {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 100_000) throw new TimingPolicyError(400, 'TIMING_POLICY_DURATION_INVALID', 'Captura una duración entera mayor a cero.');
  return parsed;
};
const unit = (value: unknown) => {
  if (!Object.values(TimingPolicyUnit).includes(value as TimingPolicyUnit)) throw new TimingPolicyError(400, 'TIMING_POLICY_UNIT_INVALID', 'Selecciona una unidad temporal compatible.');
  return value as TimingPolicyUnit;
};
const calendar = (value: unknown) => {
  if (!Object.values(TimingCalendarSemantics).includes(value as TimingCalendarSemantics)) throw new TimingPolicyError(400, 'TIMING_POLICY_CALENDAR_INVALID', 'Selecciona una semántica temporal compatible.');
  return value as TimingCalendarSemantics;
};
const lockPolicy = (tx: Tx, organizationId: string, type: TimingPolicyType) =>
  tx.$executeRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${`pravia:g0c:${organizationId}:${type}`}))`);

const publicRevision = (revision: any) => revision ? {
  id: revision.id,
  domain: revision.domain,
  type: revision.policy_type,
  revision: revision.revision,
  duration: revision.duration,
  unit: revision.unit,
  calendarSemantics: revision.calendar_semantics,
  provenance: revision.provenance,
  createdById: revision.created_by_id,
  createdAt: revision.created_at,
  publishedAt: revision.published_at,
  supersededAt: revision.superseded_at,
} : null;

export const timingPolicyService = {
  async list(actor: Actor) {
    requirePermission(actor, 'configuracion.catalogos.read');
    const rows = await (prismaClient()).timingPolicyRevision.findMany({
      where: { organization_id: actor.organizationId },
      orderBy: [{ policy_type: 'asc' }, { revision: 'desc' }],
    });
    return TIMING_POLICY_DEFINITIONS.map((definition) => {
      const history = rows.filter((row) => row.policy_type === definition.type);
      const current = history.find((row) => row.superseded_at === null) ?? null;
      return { ...definition, status: current ? 'CONFIGURED' : 'NOT_CONFIGURED', current: publicRevision(current), history: history.map(publicRevision) };
    });
  },

  async publish(actor: Actor, input: Record<string, unknown>) {
    requirePermission(actor, 'configuracion.actos_tiempos.manage');
    const allowed = new Set(['policyType', 'duration', 'unit', 'calendarSemantics', 'provenance', 'idempotencyKey']);
    const unexpected = Object.keys(input).filter((key) => !allowed.has(key));
    if (unexpected.length) throw new TimingPolicyError(400, 'TIMING_POLICY_FIELDS_INVALID', 'La solicitud contiene campos no permitidos.');
    const definition = policyDefinition(input.policyType);
    const key = publicationKey(input.idempotencyKey);
    const value = {
      policyType: definition.type,
      domain: definition.domain,
      duration: duration(input.duration),
      unit: unit(input.unit),
      calendarSemantics: calendar(input.calendarSemantics),
      provenance: provenance(input.provenance),
    };
    const payloadHash = digest(value);
    return prismaClient().$transaction(async (tx) => {
      await lockPolicy(tx, actor.organizationId, definition.type);
      const replay = await tx.timingPolicyRevision.findFirst({ where: { organization_id: actor.organizationId, policy_type: definition.type, idempotency_key: key } });
      if (replay) {
        if (replay.payload_hash !== payloadHash || replay.created_by_id !== actor.id) throw new TimingPolicyError(409, 'TIMING_POLICY_KEY_REUSED', 'Ese intento de publicación ya se utilizó con otros datos.');
        return { revision: publicRevision(replay), idempotent: true };
      }
      const current = await tx.timingPolicyRevision.findFirst({ where: { organization_id: actor.organizationId, policy_type: definition.type, superseded_at: null } });
      const now = new Date();
      if (current) await tx.timingPolicyRevision.update({ where: { id: current.id }, data: { superseded_at: now } });
      const created = await tx.timingPolicyRevision.create({ data: {
        organization_id: actor.organizationId,
        domain: definition.domain,
        policy_type: definition.type,
        revision: (current?.revision ?? 0) + 1,
        duration: value.duration,
        unit: value.unit,
        calendar_semantics: value.calendarSemantics,
        provenance: json({ source: value.provenance, contract: 'G0-C', configuredByHuman: true }),
        created_by_id: actor.id,
        created_at: now,
        published_at: now,
        idempotency_key: key,
        payload_hash: payloadHash,
      } });
      await tx.auditLog.create({ data: {
        organization_id: actor.organizationId, user_id: actor.id, accion: 'G0C_POLICY_REVISION_CREATED',
        entidad: 'TimingPolicyRevision', entidad_id: created.id, session_id: actor.sessionId,
        valores_nuevos: json({ type: created.policy_type, revision: created.revision, duration: created.duration, unit: created.unit, calendar: created.calendar_semantics, provenance: created.provenance }),
      } });
      await tx.auditLog.create({ data: {
        organization_id: actor.organizationId, user_id: actor.id, accion: 'G0C_POLICY_REVISION_PUBLISHED',
        entidad: 'TimingPolicyRevision', entidad_id: created.id, session_id: actor.sessionId,
        valores_anteriores: current ? json({ id: current.id, revision: current.revision, supersededAt: now }) : undefined,
        valores_nuevos: json({ id: created.id, type: created.policy_type, revision: created.revision, publishedAt: now }),
      } });
      return { revision: publicRevision(created), idempotent: false };
    }, { timeout: 15_000, maxWait: 10_000 });
  },
};

// Kept behind a function so focused tests can mock the canonical Prisma singleton
// without introducing a second persistence layer.
const prismaClient = () => prisma;

type ProspectSource = { prospectoId: string; transitionId: string; effectiveAt: Date; action: string };
type FinancialSource = { sourceId: string; openedAt: Date };

async function existingInterval(tx: Tx, organizationId: string, type: TimingPolicyType, source: { prospecto_id?: string; payment_request_id?: string; receipt_report_id?: string }) {
  return tx.timingInterval.findFirst({ where: { organization_id: organizationId, policy_type: type, ...source } });
}

async function openInterval(tx: Tx, organizationId: string, type: TimingPolicyType, source: {
  prospecto_id?: string;
  payment_request_id?: string;
  receipt_report_id?: string;
  opened_transition_id?: string;
  opened_at: Date;
  provenance: Record<string, unknown>;
}) {
  await lockPolicy(tx, organizationId, type);
  const selector = { prospecto_id: source.prospecto_id, payment_request_id: source.payment_request_id, receipt_report_id: source.receipt_report_id };
  const prior = await existingInterval(tx, organizationId, type, selector);
  if (prior) return prior;
  const current = await tx.timingPolicyRevision.findFirst({ where: { organization_id: organizationId, policy_type: type, superseded_at: null } });
  return tx.timingInterval.create({ data: {
    organization_id: organizationId,
    policy_type: type,
    calculation_status: current ? TimingCalculationStatus.CALCULABLE : TimingCalculationStatus.NOT_CONFIGURED,
    policy_revision_id: current?.id ?? null,
    prospecto_id: source.prospecto_id ?? null,
    payment_request_id: source.payment_request_id ?? null,
    receipt_report_id: source.receipt_report_id ?? null,
    opened_transition_id: source.opened_transition_id ?? null,
    opened_at: source.opened_at,
    provenance: json({ ...source.provenance, policyResolution: current ? `REVISION_${current.revision}` : 'NOT_CONFIGURED_AT_START' }),
  } });
}

async function closeInterval(tx: Tx, organizationId: string, type: TimingPolicyType, source: { prospecto_id?: string; payment_request_id?: string; receipt_report_id?: string }, closedAt: Date, closedTransitionId?: string) {
  const interval = await existingInterval(tx, organizationId, type, source);
  if (!interval || interval.closed_at) return interval;
  return tx.timingInterval.update({ where: { id: interval.id }, data: { closed_at: closedAt, closed_transition_id: closedTransitionId ?? null } });
}

export async function applyProspectTimingTransition(tx: Tx, organizationId: string, previousStage: string | null, nextStage: string, fact: ProspectSource) {
  const source = { prospecto_id: fact.prospectoId };
  if (previousStage === 'RECABANDO_INFORMACION') await closeInterval(tx, organizationId, TimingPolicyType.PROSPECT_INFO_COLLECTION, source, fact.effectiveAt, fact.transitionId);
  if (fact.action === 'REGISTRAR_ENVIO') await closeInterval(tx, organizationId, TimingPolicyType.PROSPECT_READY_TO_REQUEST, source, fact.effectiveAt, fact.transitionId);
  if (fact.action === 'REGISTRAR_RECEPCION') await closeInterval(tx, organizationId, TimingPolicyType.PROSPECT_NOTARY_WAIT, source, fact.effectiveAt, fact.transitionId);
  if (nextStage === 'RECABANDO_INFORMACION') await openInterval(tx, organizationId, TimingPolicyType.PROSPECT_INFO_COLLECTION, { ...source, opened_transition_id: fact.transitionId, opened_at: fact.effectiveAt, provenance: { source: 'PRO-001', businessFact: fact.action } });
  if (nextStage === 'LISTO_PARA_SOLICITAR') await openInterval(tx, organizationId, TimingPolicyType.PROSPECT_READY_TO_REQUEST, { ...source, opened_transition_id: fact.transitionId, opened_at: fact.effectiveAt, provenance: { source: 'PRO-001', businessFact: fact.action } });
  if (fact.action === 'REGISTRAR_ENVIO') await openInterval(tx, organizationId, TimingPolicyType.PROSPECT_NOTARY_WAIT, { ...source, opened_transition_id: fact.transitionId, opened_at: fact.effectiveAt, provenance: { source: 'PRO-001', businessFact: fact.action } });
}

export const openPaymentRequestTiming = (tx: Tx, organizationId: string, source: FinancialSource) =>
  openInterval(tx, organizationId, TimingPolicyType.ADMIN_PAYMENT_REQUEST_PENDING, { payment_request_id: source.sourceId, opened_at: source.openedAt, provenance: { source: 'EXP-008', businessFact: 'PAYMENT_REQUEST_CREATED_PENDING' } });
export const openReceiptApplicationTiming = (tx: Tx, organizationId: string, source: FinancialSource) =>
  openInterval(tx, organizationId, TimingPolicyType.ADMIN_RECEIPT_PENDING_APPLICATION, { receipt_report_id: source.sourceId, opened_at: source.openedAt, provenance: { source: 'EXP-008', businessFact: 'RECEIPT_REPORTED_PENDING_APPLICATION' } });
export const closePaymentRequestTiming = (tx: Tx, organizationId: string, sourceId: string, closedAt: Date) =>
  closeInterval(tx, organizationId, TimingPolicyType.ADMIN_PAYMENT_REQUEST_PENDING, { payment_request_id: sourceId }, closedAt);
export const closeReceiptApplicationTiming = (tx: Tx, organizationId: string, sourceId: string, closedAt: Date) =>
  closeInterval(tx, organizationId, TimingPolicyType.ADMIN_RECEIPT_PENDING_APPLICATION, { receipt_report_id: sourceId }, closedAt);

const milliseconds = (value: number, valueUnit: TimingPolicyUnit) => value * (valueUnit === TimingPolicyUnit.HOURS ? 60 * 60 * 1_000 : 24 * 60 * 60 * 1_000);
export const calculateTimingReadModel = (type: TimingPolicyType, sourceId: string, interval: any, revision: any, now: Date) => {
  if (!interval) return null;
  const calculable = interval.calculation_status === TimingCalculationStatus.CALCULABLE && revision?.calendar_semantics === TimingCalendarSemantics.ELAPSED_UTC;
  const dueAt = calculable ? new Date(interval.opened_at.getTime() + milliseconds(revision.duration, revision.unit)) : null;
  return {
    sourceId,
    policyType: type,
    openedAt: interval.opened_at,
    closedAt: interval.closed_at,
    calculationStatus: calculable ? TimingCalculationStatus.CALCULABLE : interval.calculation_status,
    dueAt,
    overdue: dueAt ? (interval.closed_at ? false : now.getTime() > dueAt.getTime()) : null,
    policyRevision: publicRevision(revision),
    provenance: interval.provenance,
  };
};

export const timingSourceService = {
  async read(actor: Actor, rawType: unknown, sourceId: string, now = new Date()) {
    const definition = policyDefinition(rawType);
    if (definition.domain === TimingPolicyDomain.COMMERCIAL) {
      requirePermission(actor, 'prospectos.read');
      const source = await prisma.prospecto.findFirst({ where: { id: sourceId, archived_at: null, ...prospectoObjectWhere(actor) }, select: { id: true } });
      if (!source) throw new TimingPolicyError(404, 'TIMING_SOURCE_NOT_FOUND', 'No se encontró la fuente o no tienes acceso.');
      const interval = await prisma.timingInterval.findFirst({ where: { organization_id: actor.organizationId, policy_type: definition.type, prospecto_id: source.id } });
      if (!interval) {
        const eventWhere = definition.type === TimingPolicyType.PROSPECT_INFO_COLLECTION ? { etapa_nueva: 'RECABANDO_INFORMACION' as const }
          : definition.type === TimingPolicyType.PROSPECT_READY_TO_REQUEST ? { etapa_nueva: 'LISTO_PARA_SOLICITAR' as const }
            : { accion: 'REGISTRAR_ENVIO' };
        const historical = await prisma.prospectoTransicion.findFirst({ where: { organization_id: actor.organizationId, prospecto_id: source.id, ...eventWhere }, select: { id: true } });
        return { sourceId, policyType: definition.type, openedAt: null, closedAt: null, policyRevision: null, dueAt: null, overdue: null,
          calculationStatus: historical ? TimingCalculationStatus.UNKNOWN_LEGACY : TimingCalculationStatus.NOT_APPLICABLE,
          provenance: { source: 'G0-C', reason: historical ? 'INTERVAL_PRECEDES_G0C' : 'SOURCE_NEVER_ENTERED_INTERVAL' } };
      }
      const revision = interval.policy_revision_id ? await prisma.timingPolicyRevision.findFirst({ where: { id: interval.policy_revision_id, organization_id: actor.organizationId, policy_type: definition.type } }) : null;
      return calculateTimingReadModel(definition.type, sourceId, interval, revision, now);
    }

    requirePermission(actor, 'expedientes.read');
    const isPayment = definition.type === TimingPolicyType.ADMIN_PAYMENT_REQUEST_PENDING;
    const financial = isPayment
      ? await prisma.expedienteSolicitudPago.findFirst({ where: { id: sourceId, organization_id: actor.organizationId, expediente: { archived_at: null, ...expedienteAccessWhere(actor) } }, select: { id: true } })
      : await prisma.expedienteIngresoReportado.findFirst({ where: { id: sourceId, organization_id: actor.organizationId, expediente: { archived_at: null, ...expedienteAccessWhere(actor) } }, select: { id: true } });
    if (!financial) throw new TimingPolicyError(404, 'TIMING_SOURCE_NOT_FOUND', 'No se encontró la fuente o no tienes acceso.');
    const interval = await prisma.timingInterval.findFirst({ where: { organization_id: actor.organizationId, policy_type: definition.type, ...(isPayment ? { payment_request_id: sourceId } : { receipt_report_id: sourceId }) } });
    if (!interval) return { sourceId, policyType: definition.type, openedAt: null, closedAt: null, policyRevision: null, dueAt: null, overdue: null,
      calculationStatus: TimingCalculationStatus.UNKNOWN_LEGACY, provenance: { source: 'G0-C', reason: 'INTERVAL_PRECEDES_G0C' } };
    const revision = interval.policy_revision_id ? await prisma.timingPolicyRevision.findFirst({ where: { id: interval.policy_revision_id, organization_id: actor.organizationId, policy_type: definition.type } }) : null;
    return calculateTimingReadModel(definition.type, sourceId, interval, revision, now);
  },
};
