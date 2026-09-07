import type { Request } from 'express';
import {
  CotizacionEtapaContractual,
  PrismaClient,
  ProspectoEtapaContractual,
  TimingCalculationStatus,
  TimingPolicyType,
} from '@prisma/client';
import { quoteStageLabel } from '../domain/cotizacionContract';
import {
  AdministrationMidBaseSource,
  emptyTime,
  MidBaseSource,
  operationalActivityFact,
  operationalPhase,
  ProspectMidBaseSource,
  stableMidBaseSort,
  timingFact,
} from '../domain/midBaseSources';
import { prospectWait, stageLabel } from '../domain/prospectWorkflow';
import { expedienteAccessWhere } from '../middleware/auth.middleware';
import { cotizacionObjectWhere, prospectoObjectWhere } from './objectAccess.service';

type Actor = NonNullable<Request['user']>;

export class MidBaseSourceError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) { super(message); }
}

const requireRead = (actor: Actor) => {
  if (!actor?.id || !actor.organizationId) throw new MidBaseSourceError(401, 'AUTH_REQUIRED', 'Inicia sesión para continuar.');
  if (!actor.permissions.includes('mi_dia.read')) throw new MidBaseSourceError(403, 'MID_BASE_PERMISSION_DENIED', 'No tienes permiso para consultar Mi Día.');
};

const prospectPolicy = (stage: ProspectoEtapaContractual | null) => {
  if (stage === 'EN_INTEGRACION' || stage === 'RECABANDO_INFORMACION') return TimingPolicyType.PROSPECT_INFO_COLLECTION;
  if (stage === 'LISTO_PARA_COTIZAR' || stage === 'LISTO_PARA_SOLICITAR') return TimingPolicyType.PROSPECT_READY_TO_REQUEST;
  if (stage === 'SOLICITUD_ENVIADA_NOTARIA' || stage === 'EN_ESPERA_COTIZACION') return TimingPolicyType.PROSPECT_NOTARY_WAIT;
  return null;
};

const waitingParty = (stage: ProspectoEtapaContractual | null) => {
  const wait = prospectWait(stage);
  if (wait.knowledge === 'UNKNOWN_LEGACY') return 'UNKNOWN' as const;
  if (wait.type === 'CLIENTE_DOCUMENTOS') return 'CLIENT' as const;
  if (wait.type === 'INTERNA_SOLICITUD') return 'OFFICE' as const;
  if (wait.type === 'OFFICE_QUOTE') return 'OFFICE' as const;
  if (wait.type === 'NOTARIA') return 'NOTARY' as const;
  return 'NONE' as const;
};

const notaryFact = (stage: ProspectoEtapaContractual | null, hasSource: boolean): ProspectMidBaseSource['notaryFact'] => {
  if (!stage) return 'UNKNOWN_LEGACY';
  if (['NUEVO', 'EN_INTEGRACION', 'LISTO_PARA_COTIZAR', 'CONVERTIDO_EN_COTIZACION', 'SUSPENDIDO', 'CANCELADO'].includes(stage)) return 'NOT_APPLICABLE';
  if (hasSource || stage === 'COTIZACION_RECIBIDA' || stage === 'CONVERTIDO_COTIZACION') return 'QUOTE_RECEIVED';
  if (stage === 'LISTO_PARA_SOLICITAR') return 'REQUEST_PENDING';
  if (stage === 'SOLICITUD_ENVIADA_NOTARIA') return 'REQUEST_SENT';
  if (stage === 'EN_ESPERA_COTIZACION') return 'WAITING_NOTARY';
  return 'NOT_APPLICABLE';
};

const quoteActive = (stage: CotizacionEtapaContractual | null) => !stage || !['SUSPENDIDA', 'CANCELADA', 'CONVERTIDA_EXPEDIENTE'].includes(stage);
const quoteWaiting = (stage: CotizacionEtapaContractual | null) => stage === 'ENVIADA_CLIENTE' ? 'CLIENT' as const : stage ? 'NONE' as const : 'UNKNOWN' as const;

export class MidBaseSourceService {
  constructor(private readonly prisma: PrismaClient) {}

  async read(actor: Actor, options: { now?: Date; limit?: number } = {}) {
    requireRead(actor);
    const now = options.now ? new Date(options.now) : new Date();
    if (!Number.isFinite(now.getTime())) throw new MidBaseSourceError(400, 'MID_BASE_CLOCK_INVALID', 'El reloj de consulta no es válido.');
    const limit = Math.max(1, Math.min(250, Math.trunc(options.limit ?? 100)));
    const sources: MidBaseSource[] = [];

    const [prospects, quotes, cases] = await Promise.all([
      actor.permissions.includes('prospectos.read') ? this.prisma.prospecto.findMany({
        where: { archived_at: null, ...prospectoObjectWhere(actor) },
        select: {
          id: true, organization_id: true, user_id: true, etapa_contractual: true,
          transicion_actual: { select: { id: true, effective_at: true, accion: true, procedencia: true } },
          fuentes_notariales: { select: { id: true, received_at: true, origen: true }, orderBy: { version: 'desc' }, take: 1 },
        },
        orderBy: { id: 'asc' }, take: limit,
      }) : Promise.resolve([]),
      actor.permissions.includes('cotizaciones.read') ? this.prisma.cotizacion.findMany({
        where: cotizacionObjectWhere(actor),
        select: {
          id: true, organization_id: true, user_id: true, prospecto_id: true, etapa_contractual: true,
          fecha_aceptacion_cliente: true, fecha_conversion_expediente: true,
          transicion_actual: { select: { id: true, effective_at: true, accion: true, procedencia: true } },
          expediente: { select: { id: true } },
        },
        orderBy: { id: 'asc' }, take: limit,
      }) : Promise.resolve([]),
      actor.permissions.includes('expedientes.read') ? this.prisma.expediente.findMany({
        where: { archived_at: null, organization_id: actor.organizationId, ...expedienteAccessWhere(actor) },
        select: {
          id: true, organization_id: true, estatus: true, fecha_estimada_firma: true, fecha_real_firma: true,
          fecha_entrega_cliente: true, abogado_id: true, gestor_id: true,
        },
        orderBy: { id: 'asc' }, take: limit,
      }) : Promise.resolve([]),
    ]);

    const prospectIds = prospects.map((row) => row.id);
    const quoteIds = quotes.map((row) => row.id);
    const caseIds = cases.map((row) => row.id);
    const [prospectIntervals, firstSends, activities, dependencies, requests, receipts] = await Promise.all([
      prospectIds.length ? this.prisma.timingInterval.findMany({ where: { organization_id: actor.organizationId, prospecto_id: { in: prospectIds } }, orderBy: { id: 'asc' } }) : Promise.resolve([]),
      quoteIds.length ? this.prisma.cotizacionTransicion.findMany({
        where: { organization_id: actor.organizationId, cotizacion_id: { in: quoteIds }, accion: 'ENVIAR_CLIENTE' },
        select: { cotizacion_id: true, effective_at: true, procedencia: true },
        orderBy: [{ cotizacion_id: 'asc' }, { effective_at: 'asc' }], distinct: ['cotizacion_id'],
      }) : Promise.resolve([]),
      caseIds.length ? this.prisma.expedienteSeguimientoActividad.findMany({
        where: { organization_id: actor.organizationId, expediente_id: { in: caseIds }, en_alcance: true },
        orderBy: [{ expediente_id: 'asc' }, { etapa_orden_snapshot: 'asc' }, { id: 'asc' }],
      }) : Promise.resolve([]),
      caseIds.length ? this.prisma.expedienteSeguimientoDependencia.findMany({
        where: { organization_id: actor.organizationId, expediente_id: { in: caseIds } }, orderBy: { id: 'asc' },
      }) : Promise.resolve([]),
      actor.permissions.includes('finanzas.read') && caseIds.length ? this.prisma.expedienteSolicitudPago.findMany({
        where: { organization_id: actor.organizationId, expediente_id: { in: caseIds }, estado: 'PENDIENTE' },
        select: { id: true, organization_id: true, expediente_id: true, creado_por_id: true, created_at: true, fecha_limite: true },
        orderBy: { id: 'asc' }, take: limit,
      }) : Promise.resolve([]),
      actor.permissions.includes('finanzas.read') && caseIds.length ? this.prisma.expedienteIngresoReportado.findMany({
        where: { organization_id: actor.organizationId, expediente_id: { in: caseIds }, estado: 'PENDIENTE_APLICACION' },
        select: { id: true, organization_id: true, expediente_id: true, reportado_por_id: true, created_at: true },
        orderBy: { id: 'asc' }, take: limit,
      }) : Promise.resolve([]),
    ]);

    const financialIds = [...requests.map((row) => row.id), ...receipts.map((row) => row.id)];
    const financialIntervals = financialIds.length ? await this.prisma.timingInterval.findMany({
      where: { organization_id: actor.organizationId, OR: [{ payment_request_id: { in: requests.map((row) => row.id) } }, { receipt_report_id: { in: receipts.map((row) => row.id) } }] },
      orderBy: { id: 'asc' },
    }) : [];
    const allIntervals = [...prospectIntervals, ...financialIntervals];
    const revisionIds = [...new Set(allIntervals.map((row) => row.policy_revision_id).filter(Boolean))] as string[];
    const revisions = revisionIds.length ? await this.prisma.timingPolicyRevision.findMany({
      where: { organization_id: actor.organizationId, id: { in: revisionIds } }, orderBy: { id: 'asc' },
    }) : [];
    const revisionById = new Map(revisions.map((row) => [row.id, row]));
    const intervalFor = (predicate: (interval: typeof allIntervals[number]) => boolean) => allIntervals.find(predicate) ?? null;

    prospects.forEach((row) => {
      const policyType = prospectPolicy(row.etapa_contractual);
      const transition = row.transicion_actual;
      const interval = policyType ? intervalFor((item) => item.prospecto_id === row.id && item.policy_type === policyType) : null;
      const time = policyType ? timingFact(policyType, row.id, interval, interval?.policy_revision_id ? revisionById.get(interval.policy_revision_id) : null, now, {
        state: TimingCalculationStatus.UNKNOWN_LEGACY,
        openedAt: null,
        provenance: transition
          ? { source: 'PRO-001', transitionId: transition.id, reason: 'INTERVAL_PRECEDES_G0C_OR_MISSING' }
          : { source: 'PRO-001', reason: 'NO_DEMONSTRABLE_STAGE_TRANSITION' },
      }) : emptyTime(TimingCalculationStatus.NOT_APPLICABLE, { source: 'PRO-001', reason: 'STAGE_HAS_NO_TIMING_POLICY' });
      sources.push({
        sourceKind: 'PROSPECT', sourceId: `prospect:${row.id}`, organizationId: row.organization_id!, objectType: 'Prospecto', objectId: row.id,
        status: row.etapa_contractual ?? 'UNKNOWN_LEGACY', stage: row.etapa_contractual, stageLabel: stageLabel(row.etapa_contractual),
        active: !['CONVERTIDO_EN_COTIZACION', 'CONVERTIDO_COTIZACION', 'SUSPENDIDO', 'CANCELADO'].includes(row.etapa_contractual ?? ''), responsibility: { userId: row.user_id, role: null },
        waitingOn: waitingParty(row.etapa_contractual), effectiveAt: transition?.effective_at ?? null,
        stageDateKnowledge: transition ? 'KNOWN' : 'UNKNOWN_LEGACY', notaryFact: notaryFact(row.etapa_contractual, row.fuentes_notariales.length > 0),
        provenance: transition ? { source: 'PRO-001', transitionId: transition.id, action: transition.accion, value: transition.procedencia } : { source: 'PRO-001', reason: 'LEGACY_WITHOUT_CANONICAL_TRANSITION' },
        time, links: { prospectId: row.id },
      });
    });

    const firstSendByQuote = new Map(firstSends.map((row) => [row.cotizacion_id, row]));
    quotes.forEach((row) => {
      const firstSend = firstSendByQuote.get(row.id);
      sources.push({
        sourceKind: 'QUOTE', sourceId: `quote:${row.id}`, organizationId: row.organization_id!, objectType: 'Cotizacion', objectId: row.id,
        status: row.etapa_contractual ?? 'UNKNOWN_LEGACY', stage: row.etapa_contractual, stageLabel: quoteStageLabel(row.etapa_contractual),
        active: quoteActive(row.etapa_contractual), responsibility: { userId: row.user_id, role: null }, waitingOn: quoteWaiting(row.etapa_contractual),
        effectiveAt: row.transicion_actual?.effective_at ?? null, firstSentAt: firstSend?.effective_at ?? null,
        commercialMilestoneAt: row.etapa_contractual === 'ACEPTO_ANTICIPO' ? row.fecha_aceptacion_cliente : row.etapa_contractual === 'CONVERTIDA_EXPEDIENTE' ? row.fecha_conversion_expediente : null,
        internalUrgency: null,
        provenance: row.transicion_actual ? { source: 'COT-001', transitionId: row.transicion_actual.id, action: row.transicion_actual.accion, value: row.transicion_actual.procedencia, firstSentProvenance: firstSend?.procedencia ?? null } : { source: 'COT-001', reason: 'LEGACY_WITHOUT_CANONICAL_TRANSITION' },
        time: emptyTime(TimingCalculationStatus.NOT_APPLICABLE, { source: 'COT-001', reason: 'NO_APPROVED_QUOTE_TIMING_POLICY' }),
        links: { prospectId: row.prospecto_id ?? undefined, quoteId: row.id, caseId: row.expediente?.id },
      });
    });

    const activitiesByCase = new Map<string, typeof activities>();
    activities.forEach((row) => activitiesByCase.set(row.expediente_id, [...(activitiesByCase.get(row.expediente_id) ?? []), row]));
    const dependenciesByCase = new Map<string, typeof dependencies>();
    dependencies.forEach((row) => dependenciesByCase.set(row.expediente_id, [...(dependenciesByCase.get(row.expediente_id) ?? []), row]));
    cases.forEach((record) => {
      const caseActivities = activitiesByCase.get(record.id) ?? [];
      const caseDependencies = dependenciesByCase.get(record.id) ?? [];
      const signatureStageOrder = caseActivities.filter((item) => item.etapa_nombre_snapshot.localeCompare('Firma', 'es', { sensitivity: 'base' }) === 0)
        .reduce<number | null>((lowest, item) => lowest === null ? item.etapa_orden_snapshot : Math.min(lowest, item.etapa_orden_snapshot), null);
      caseActivities.forEach((activity) => {
        const phase = operationalPhase(activity, signatureStageOrder);
        if (!phase) return;
        if (phase === 'PRE_SIGNATURE' && record.fecha_real_firma) return;
        if (phase === 'POST_SIGNATURE' && (!record.fecha_real_firma || record.estatus === 'ENTREGADO')) return;
        const fact = operationalActivityFact(activity, caseDependencies, caseActivities, now);
        if (!fact.incomplete) return;
        sources.push({
          sourceKind: phase, sourceId: `${phase.toLocaleLowerCase()}:${activity.id}`, organizationId: record.organization_id!, objectType: 'Expediente', objectId: record.id,
          status: fact.effectiveState, active: true,
          responsibility: { userId: activity.responsable_id, role: activity.responsable_rol_snapshot }, waitingOn: activity.estado === 'EN_ESPERA_EXTERNA' ? 'UNKNOWN' : 'OFFICE',
          effectiveAt: activity.primera_fecha_inicio, provenance: { source: 'EXP-005', configuration: 'CFG-001', configurationId: activity.configuracion_acto_id, revision: activity.configuracion_revision, resolutionSource: activity.resolucion_fuente },
          time: {
            calculationState: activity.primera_fecha_inicio ? TimingCalculationStatus.CALCULABLE : TimingCalculationStatus.NOT_APPLICABLE,
            policyType: null, policyRevisionId: null, policyRevision: activity.configuracion_revision, duration: fact.duration,
            unit: fact.durationUnit, calendarSemantics: fact.durationUnit, openedAt: activity.primera_fecha_inicio, closedAt: activity.fecha_completada_actual,
            dueAt: fact.dueAt, elapsed: fact.elapsed, overdue: fact.overdue, provenance: { source: 'CFG-001_OPERATIONAL_SNAPSHOT', configurationId: activity.configuracion_acto_id, resolutionSource: activity.resolucion_fuente },
          },
          links: { caseId: record.id, activityId: activity.id }, caseStatus: record.estatus,
          scheduledSignatureAt: record.fecha_estimada_firma, signedAt: record.fecha_real_firma, deliveredAt: record.fecha_entrega_cliente,
          activity: {
            id: activity.id, name: activity.actividad_nombre_snapshot, stage: activity.etapa_nombre_snapshot, stageOrder: activity.etapa_orden_snapshot,
            state: activity.estado, effectiveState: fact.effectiveState, incomplete: fact.incomplete, blocked: fact.blocked,
            blockers: fact.blockers, dependencies: fact.dependencies, duration: fact.duration, durationUnit: fact.durationUnit,
            remainingDuration: fact.remainingDuration, safetyMargin: fact.safetyMargin, marginDeadline: fact.marginDeadline,
            configurationId: activity.configuracion_acto_id, configurationRevision: activity.configuracion_revision, resolutionSource: activity.resolucion_fuente,
          },
        });
      });
    });

    const pushAdmin = (row: any, administrationType: AdministrationMidBaseSource['administrationType'], policyType: TimingPolicyType, objectType: AdministrationMidBaseSource['objectType'], creatorId: string) => {
      const interval = intervalFor((item) => administrationType === 'PAYMENT_REQUEST_PENDING' ? item.payment_request_id === row.id : item.receipt_report_id === row.id);
      const time = timingFact(policyType, row.id, interval, interval?.policy_revision_id ? revisionById.get(interval.policy_revision_id) : null, now, {
        state: interval ? interval.calculation_status : TimingCalculationStatus.UNKNOWN_LEGACY,
        openedAt: interval?.opened_at ?? null,
        provenance: { source: 'EXP-008', reason: 'INTERVAL_PRECEDES_G0C_OR_MISSING' },
      });
      sources.push({
        sourceKind: 'ADMINISTRATION', sourceId: `administration:${administrationType}:${row.id}`, organizationId: row.organization_id,
        objectType, objectId: row.id, status: administrationType, active: true,
        responsibility: { userId: null, role: 'ADMINISTRACION' }, responsibleRole: 'ADMINISTRACION', waitingOn: 'OFFICE',
        effectiveAt: row.created_at, provenance: { source: 'EXP-008', createdById: creatorId, financialSystem: 'SERVICE_FINANCE' }, time,
        links: { caseId: row.expediente_id }, administrationType,
      });
    };
    requests.forEach((row) => pushAdmin(row, 'PAYMENT_REQUEST_PENDING', TimingPolicyType.ADMIN_PAYMENT_REQUEST_PENDING, 'ExpedienteSolicitudPago', row.creado_por_id));
    receipts.forEach((row) => pushAdmin(row, 'RECEIPT_PENDING_APPLICATION', TimingPolicyType.ADMIN_RECEIPT_PENDING_APPLICATION, 'ExpedienteIngresoReportado', row.reportado_por_id));

    const rows = stableMidBaseSort(sources);
    return {
      generatedAt: now,
      readOnly: true,
      finalPriorityAlgorithm: null,
      rows,
      counts: Object.fromEntries(['PROSPECT', 'QUOTE', 'PRE_SIGNATURE', 'POST_SIGNATURE', 'ADMINISTRATION'].map((kind) => [kind, rows.filter((row) => row.sourceKind === kind).length])),
    };
  }
}
