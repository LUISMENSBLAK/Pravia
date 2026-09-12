import {
  ConfiguracionTipoDias,
  SeguimientoActividadEstado,
  TimingCalculationStatus,
  TimingPolicyType,
} from '@prisma/client';
import { addOperationalDays, isDependencySatisfied, operationalDaysBetween } from '../services/expedienteSeguimiento.service';
import { calculateTimingReadModel } from '../services/timingPolicy.service';

export const MID_BASE_SOURCE_KINDS = [
  'PROSPECT',
  'QUOTE',
  'PRE_SIGNATURE',
  'POST_SIGNATURE',
  'ADMINISTRATION',
] as const;

export type MidBaseSourceKind = typeof MID_BASE_SOURCE_KINDS[number];
export type MidBaseWaitingOn = 'CLIENT' | 'OFFICE' | 'NOTARY' | 'NONE' | 'UNKNOWN';
export type MidBaseResponsibility = { userId: string | null; role: string | null };

export type MidBaseTime = {
  calculationState: TimingCalculationStatus;
  policyType: TimingPolicyType | null;
  policyRevisionId: string | null;
  policyRevision: number | null;
  duration: number | null;
  unit: string | null;
  calendarSemantics: string | null;
  openedAt: Date | null;
  closedAt: Date | null;
  dueAt: Date | null;
  elapsed: number | null;
  overdue: boolean | null;
  provenance: unknown;
};

type BaseSource = {
  sourceKind: MidBaseSourceKind;
  sourceId: string;
  organizationId: string;
  objectType: 'Prospecto' | 'Cotizacion' | 'Expediente' | 'ExpedienteSolicitudPago' | 'ExpedienteIngresoReportado';
  objectId: string;
  status: string;
  active: boolean;
  responsibility: MidBaseResponsibility;
  waitingOn: MidBaseWaitingOn;
  effectiveAt: Date | null;
  provenance: unknown;
  time: MidBaseTime;
  links: { prospectId?: string; quoteId?: string; caseId?: string; activityId?: string };
};

export type ProspectMidBaseSource = BaseSource & {
  sourceKind: 'PROSPECT';
  stage: string | null;
  stageLabel: string;
  stageDateKnowledge: 'KNOWN' | 'UNKNOWN_LEGACY';
  notaryFact: 'REQUEST_PENDING' | 'REQUEST_SENT' | 'WAITING_NOTARY' | 'QUOTE_RECEIVED' | 'NOT_APPLICABLE' | 'UNKNOWN_LEGACY';
};

export type QuoteMidBaseSource = BaseSource & {
  sourceKind: 'QUOTE';
  stage: string | null;
  stageLabel: string;
  firstSentAt: Date | null;
  commercialMilestoneAt: Date | null;
  internalUrgency: null;
};

export type OperationalMidBaseSource = BaseSource & {
  sourceKind: 'PRE_SIGNATURE' | 'POST_SIGNATURE';
  caseStatus: string;
  scheduledSignatureAt: Date | null;
  signedAt: Date | null;
  deliveredAt: Date | null;
  activity: {
    id: string;
    name: string;
    stage: string;
    stageOrder: number;
    state: SeguimientoActividadEstado;
    effectiveState: SeguimientoActividadEstado;
    incomplete: boolean;
    blocked: boolean;
    blockers: Array<{ id: string; name: string; state: SeguimientoActividadEstado }>;
    dependencies: Array<{ id: string; prerequisiteActivityId: string; blocking: boolean; satisfied: boolean }>;
    duration: number;
    durationUnit: ConfiguracionTipoDias;
    remainingDuration: number | null;
    safetyMargin: number;
    marginDeadline: Date | null;
    configurationId: string | null;
    configurationRevision: number | null;
    resolutionSource: string;
  };
};

export type AdministrationMidBaseSource = BaseSource & {
  sourceKind: 'ADMINISTRATION';
  administrationType: 'PAYMENT_REQUEST_PENDING' | 'RECEIPT_PENDING_APPLICATION';
  responsibleRole: 'ADMINISTRACION';
};

export type MidBaseSource = ProspectMidBaseSource | QuoteMidBaseSource | OperationalMidBaseSource | AdministrationMidBaseSource;

export const emptyTime = (state: TimingCalculationStatus, provenance: unknown, openedAt: Date | null = null): MidBaseTime => ({
  calculationState: state,
  policyType: null,
  policyRevisionId: null,
  policyRevision: null,
  duration: null,
  unit: null,
  calendarSemantics: null,
  openedAt,
  closedAt: null,
  dueAt: null,
  elapsed: null,
  overdue: null,
  provenance,
});

export function timingFact(
  policyType: TimingPolicyType,
  sourceId: string,
  interval: any | null,
  revision: any | null,
  now: Date,
  fallback: { state: TimingCalculationStatus; openedAt: Date | null; provenance: unknown },
): MidBaseTime {
  if (!interval) return { ...emptyTime(fallback.state, fallback.provenance, fallback.openedAt), policyType };
  const revisionComplete = revision
    && Number.isInteger(revision.duration)
    && revision.duration > 0
    && ['HOURS', 'DAYS'].includes(revision.unit)
    && revision.calendar_semantics === 'ELAPSED_UTC';
  if (interval.calculation_status === TimingCalculationStatus.CALCULABLE && !revisionComplete) {
    return {
      ...emptyTime(TimingCalculationStatus.NOT_CONFIGURED, {
        source: 'G0-C',
        reason: 'PINNED_POLICY_REVISION_MISSING_OR_INCOMPLETE',
        intervalProvenance: interval.provenance,
      }, interval.opened_at),
      policyType,
      policyRevisionId: interval.policy_revision_id ?? null,
    };
  }
  const calculated = calculateTimingReadModel(policyType, sourceId, interval, revision, now);
  if (!calculated) return { ...emptyTime(fallback.state, fallback.provenance, fallback.openedAt), policyType };
  const policy = calculated.policyRevision;
  const end = interval.closed_at ?? now;
  const elapsed = calculated.calculationStatus === TimingCalculationStatus.CALCULABLE
    ? Math.max(0, (end.getTime() - interval.opened_at.getTime()) / (revision.unit === 'HOURS' ? 3_600_000 : 86_400_000))
    : null;
  return {
    calculationState: calculated.calculationStatus,
    policyType,
    policyRevisionId: policy?.id ?? null,
    policyRevision: policy?.revision ?? null,
    duration: policy?.duration ?? null,
    unit: policy?.unit ?? null,
    calendarSemantics: policy?.calendarSemantics ?? null,
    openedAt: calculated.openedAt,
    closedAt: calculated.closedAt,
    dueAt: calculated.dueAt,
    elapsed,
    overdue: calculated.overdue,
    provenance: calculated.provenance,
  };
}

const normalized = (value: unknown) => String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('es-MX').trim();

export function operationalPhase(activity: { etapa_nombre_snapshot: string; etapa_orden_snapshot: number }, signatureStageOrder: number | null) {
  const stage = normalized(activity.etapa_nombre_snapshot);
  if (stage === 'prefirma' || stage === 'firma') return 'PRE_SIGNATURE' as const;
  if (['postfirma', 'registro', 'cierre'].includes(stage)) return 'POST_SIGNATURE' as const;
  if (signatureStageOrder !== null) return activity.etapa_orden_snapshot <= signatureStageOrder ? 'PRE_SIGNATURE' as const : 'POST_SIGNATURE' as const;
  return null;
}

export function operationalActivityFact(activity: any, dependencies: any[], allActivities: any[], now: Date) {
  const byId = new Map(allActivities.map((item) => [item.id, item]));
  const ownDependencies = dependencies.filter((item) => item.actividad_id === activity.id);
  const blockers = ownDependencies
    .filter((item) => item.bloqueante && !isDependencySatisfied(byId.get(item.depende_actividad_id)?.estado))
    .map((item) => byId.get(item.depende_actividad_id))
    .filter(Boolean);
  const effectiveState: SeguimientoActividadEstado = activity.en_alcance
    && !isDependencySatisfied(activity.estado)
    && blockers.length ? 'BLOQUEADO' : activity.estado;
  const override = activity.excepcion_operativa && typeof activity.excepcion_operativa === 'object' && !Array.isArray(activity.excepcion_operativa)
    ? activity.excepcion_operativa : {};
  const duration = Number.isInteger(override.duracion_estimada) ? override.duracion_estimada : activity.duracion_estimada;
  const durationUnit: ConfiguracionTipoDias = ['HABILES', 'NATURALES'].includes(override.tipo_dias) ? override.tipo_dias : activity.tipo_dias;
  const safetyMargin = Number.isInteger(override.margen_seguridad) ? override.margen_seguridad : activity.margen_seguridad;
  const end = activity.fecha_completada_actual ?? now;
  const elapsed = activity.primera_fecha_inicio ? operationalDaysBetween(activity.primera_fecha_inicio, end, durationUnit) : null;
  const dueAt = activity.primera_fecha_inicio ? addOperationalDays(activity.primera_fecha_inicio, duration, durationUnit) : null;
  const marginDeadline = dueAt ? addOperationalDays(dueAt, safetyMargin, durationUnit) : null;
  const incomplete = activity.en_alcance && !isDependencySatisfied(activity.estado);
  return {
    effectiveState,
    incomplete,
    blocked: blockers.length > 0,
    blockers: blockers.map((item) => ({ id: item.id, name: item.actividad_nombre_snapshot, state: item.estado })),
    dependencies: ownDependencies.map((item) => ({
      id: item.id,
      prerequisiteActivityId: item.depende_actividad_id,
      blocking: item.bloqueante,
      satisfied: isDependencySatisfied(byId.get(item.depende_actividad_id)?.estado),
    })),
    duration,
    durationUnit,
    elapsed,
    remainingDuration: elapsed === null ? null : Math.max(0, duration - elapsed),
    safetyMargin,
    dueAt,
    marginDeadline,
    overdue: marginDeadline && incomplete ? now > marginDeadline : null,
  };
}

export const stableMidBaseSort = (rows: MidBaseSource[]) => [...rows].sort((left, right) => {
  const kind = MID_BASE_SOURCE_KINDS.indexOf(left.sourceKind) - MID_BASE_SOURCE_KINDS.indexOf(right.sourceKind);
  if (kind) return kind;
  const date = (left.effectiveAt?.getTime() ?? 0) - (right.effectiveAt?.getTime() ?? 0);
  return date || left.sourceId.localeCompare(right.sourceId);
});
