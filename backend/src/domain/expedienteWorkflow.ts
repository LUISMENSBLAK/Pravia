import { ExpedienteEstatus } from '@prisma/client';

export class ExpedienteWorkflowError extends Error {
  constructor(message: string, readonly code: string, readonly status = 400, readonly detail?: unknown) {
    super(message);
  }
}

export const EXPEDIENTE_STATUS_LABELS: Record<ExpedienteEstatus, string> = {
  ABIERTO: 'Abierto',
  EN_INTEGRACION: 'En integración',
  EN_PROCESO: 'En proceso',
  PENDIENTE_CLIENTE: 'Pendiente del cliente',
  PENDIENTE_NOTARIA: 'Pendiente de Notaría',
  FIRMA_PROGRAMADA: 'Firma programada',
  FIRMADO: 'Firmado',
  POST_FIRMA: 'Postfirma',
  LISTO_ENTREGA: 'Listo para entrega',
  ENTREGADO: 'Entregado',
  SUSPENDIDO: 'Suspendido',
  CANCELADO: 'Cancelado',
};

const ALLOWED_TRANSITIONS: Record<ExpedienteEstatus, ExpedienteEstatus[]> = {
  ABIERTO: ['EN_INTEGRACION', 'SUSPENDIDO', 'CANCELADO'],
  EN_INTEGRACION: ['EN_PROCESO', 'PENDIENTE_CLIENTE', 'PENDIENTE_NOTARIA', 'SUSPENDIDO', 'CANCELADO'],
  EN_PROCESO: ['PENDIENTE_CLIENTE', 'PENDIENTE_NOTARIA', 'FIRMA_PROGRAMADA', 'SUSPENDIDO', 'CANCELADO'],
  PENDIENTE_CLIENTE: ['EN_INTEGRACION', 'EN_PROCESO', 'SUSPENDIDO', 'CANCELADO'],
  PENDIENTE_NOTARIA: ['EN_PROCESO', 'FIRMA_PROGRAMADA', 'SUSPENDIDO', 'CANCELADO'],
  FIRMA_PROGRAMADA: ['EN_PROCESO', 'PENDIENTE_NOTARIA', 'FIRMADO', 'SUSPENDIDO', 'CANCELADO'],
  FIRMADO: ['POST_FIRMA'],
  POST_FIRMA: ['LISTO_ENTREGA'],
  LISTO_ENTREGA: ['ENTREGADO'],
  ENTREGADO: [],
  SUSPENDIDO: ['EN_INTEGRACION', 'EN_PROCESO', 'CANCELADO'],
  CANCELADO: [],
};

export const getAllowedExpedienteTransitions = (status: ExpedienteEstatus) => [...ALLOWED_TRANSITIONS[status]];

export interface FrozenWorkflowStageTransition {
  clave: string;
  nombre: string;
  orden: number;
  estado_general_relacionado: string;
  [key: string]: unknown;
}

export interface ExpedienteTransitionOption {
  status: ExpedienteEstatus;
  label: string;
  stage: FrozenWorkflowStageTransition | null;
  requires_signature_data: boolean;
  requires_effective_date: boolean;
  requires_notes: boolean;
}

export function resolveFrozenWorkflowTransitions(
  currentStatus: ExpedienteEstatus,
  currentStageOrder: number,
  workflowStages: FrozenWorkflowStageTransition[],
): ExpedienteTransitionOption[] {
  const allowedStatuses = getAllowedExpedienteTransitions(currentStatus);
  const statusTransitions = allowedStatuses.map((status) => ({
    status,
    label: EXPEDIENTE_STATUS_LABELS[status],
    stage: workflowStages.find((stage) => stage.estado_general_relacionado === status && stage.orden > currentStageOrder) || null,
    requires_signature_data: status === 'FIRMA_PROGRAMADA',
    requires_effective_date: status === 'FIRMADO' || status === 'ENTREGADO',
    requires_notes: status === 'ENTREGADO' || status === 'CANCELADO' || status === 'SUSPENDIDO',
  }));
  const nextStage = workflowStages.find((stage) => stage.orden > currentStageOrder) || null;
  const nextStageStatus = nextStage?.estado_general_relacionado as ExpedienteEstatus | undefined;
  const sequentialTransition = nextStage && nextStageStatus
    && (nextStageStatus === currentStatus || allowedStatuses.includes(nextStageStatus))
    ? {
        status: nextStageStatus,
        label: nextStageStatus === currentStatus ? `Continuar: ${nextStage.nombre}` : EXPEDIENTE_STATUS_LABELS[nextStageStatus],
        stage: nextStage,
        requires_signature_data: nextStageStatus === 'FIRMA_PROGRAMADA',
        requires_effective_date: nextStageStatus === 'FIRMADO' || nextStageStatus === 'ENTREGADO',
        requires_notes: nextStageStatus === 'ENTREGADO' || nextStageStatus === 'CANCELADO' || nextStageStatus === 'SUSPENDIDO',
      }
    : null;

  return sequentialTransition
    ? [sequentialTransition, ...statusTransitions.filter((item) => item.status !== sequentialTransition.status)]
    : statusTransitions;
}

export function assertExpedienteTransition(current: ExpedienteEstatus, next?: ExpedienteEstatus) {
  if (!next || current === next) {
    throw new ExpedienteWorkflowError('Selecciona un estado distinto al actual.', 'EXPEDIENTE_STATUS_UNCHANGED');
  }
  if (!Object.prototype.hasOwnProperty.call(ALLOWED_TRANSITIONS, next)) {
    throw new ExpedienteWorkflowError(`El estado '${next}' no existe.`, 'EXPEDIENTE_STATUS_INVALID');
  }
  if (!ALLOWED_TRANSITIONS[current].includes(next)) {
    throw new ExpedienteWorkflowError(
      `No se puede pasar de ${EXPEDIENTE_STATUS_LABELS[current]} a ${EXPEDIENTE_STATUS_LABELS[next]}.`,
      'EXPEDIENTE_TRANSITION_NOT_ALLOWED',
      409,
    );
  }
}
