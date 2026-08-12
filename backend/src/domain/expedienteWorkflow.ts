import { ExpedienteEstatus } from '@prisma/client';

export class ExpedienteWorkflowError extends Error {
  constructor(message: string, readonly code: string, readonly status = 400) {
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

