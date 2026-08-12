import { CotizacionEstado } from '@prisma/client';

export type MoneyLike = number | string | { toString(): string };

export interface ConversionCandidate {
  estado: CotizacionEstado;
  prospecto_id?: string | null;
  expediente?: { id: string } | null;
  versiones: Array<{ aprobada: boolean }>;
  pagos: Array<{
    categoria_ingreso: string;
    estatus: string;
    monto: MoneyLike;
  }>;
}

export interface ConversionEligibility {
  eligible: boolean;
  accepted: boolean;
  approvedVersion: boolean;
  validatedAdvance: boolean;
  validatedAdvanceTotal: number;
  notConverted: boolean;
  linkedProspect: boolean;
  failures: string[];
}

export class CotizacionBusinessError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly status = 400,
  ) {
    super(message);
    this.name = 'CotizacionBusinessError';
  }
}

export const COTIZACION_TRANSITIONS: Record<CotizacionEstado, CotizacionEstado[]> = {
  BORRADOR: [CotizacionEstado.ENVIADA_NOTARIA],
  ENVIADA_NOTARIA: [CotizacionEstado.PRESUPUESTO_RECIBIDO, CotizacionEstado.VENCIDA],
  PRESUPUESTO_RECIBIDO: [CotizacionEstado.EN_REVISION_ABOGADO],
  EN_REVISION_ABOGADO: [CotizacionEstado.ENVIADA_CLIENTE],
  ENVIADA_CLIENTE: [CotizacionEstado.EN_NEGOCIACION, CotizacionEstado.ACEPTADA, CotizacionEstado.RECHAZADA, CotizacionEstado.VENCIDA],
  EN_NEGOCIACION: [CotizacionEstado.ENVIADA_CLIENTE, CotizacionEstado.ACEPTADA, CotizacionEstado.RECHAZADA, CotizacionEstado.VENCIDA],
  ACEPTADA: [],
  RECHAZADA: [],
  VENCIDA: [],
  CONVERTIDA_EXPEDIENTE: [],
};

export function getAllowedCotizacionTransitions(current: CotizacionEstado): CotizacionEstado[] {
  return COTIZACION_TRANSITIONS[current] || [];
}

export function validateCotizacionTransition(input: {
  current: CotizacionEstado;
  next: CotizacionEstado;
  hasNotaria: boolean;
  hasApprovedVersion: boolean;
}): void {
  if (input.current === input.next) return;
  if (input.next === CotizacionEstado.CONVERTIDA_EXPEDIENTE) {
    throw new CotizacionBusinessError(
      'La conversión a expediente sólo puede realizarse mediante la acción de conversión, después de validar aceptación y anticipo.',
      'CONVERSION_ACTION_REQUIRED',
    );
  }
  if (!getAllowedCotizacionTransitions(input.current).includes(input.next)) {
    throw new CotizacionBusinessError(
      `La transición ${input.current} → ${input.next} no está permitida en el flujo comercial.`,
      'INVALID_STATE_TRANSITION',
    );
  }
  if (input.next === CotizacionEstado.ENVIADA_NOTARIA && !input.hasNotaria) {
    throw new CotizacionBusinessError('Asigna una notaría antes de enviar la solicitud.', 'NOTARIA_REQUIRED');
  }
  if ((input.next === CotizacionEstado.ENVIADA_CLIENTE || input.next === CotizacionEstado.ACEPTADA) && !input.hasApprovedVersion) {
    throw new CotizacionBusinessError(
      'Debe existir una versión de presupuesto aprobada antes de enviar o aceptar la cotización.',
      'APPROVED_VERSION_REQUIRED',
    );
  }
}

export function evaluateConversionEligibility(candidate: ConversionCandidate): ConversionEligibility {
  const accepted = candidate.estado === CotizacionEstado.ACEPTADA;
  const approvedVersion = candidate.versiones.some((version) => version.aprobada);
  const validatedAdvances = candidate.pagos.filter(
    (payment) => payment.categoria_ingreso === 'ANTICIPO_NOTARIA'
      && payment.estatus === 'VALIDADO'
      && Number(payment.monto) > 0,
  );
  const validatedAdvanceTotal = validatedAdvances.reduce((sum, payment) => sum + Number(payment.monto), 0);
  const validatedAdvance = validatedAdvanceTotal > 0;
  const notConverted = candidate.estado !== CotizacionEstado.CONVERTIDA_EXPEDIENTE && !candidate.expediente;
  const linkedProspect = Boolean(candidate.prospecto_id);
  const failures: string[] = [];

  if (!accepted) failures.push('La cotización debe estar ACEPTADA por el cliente.');
  if (!approvedVersion) failures.push('Debe existir una versión de presupuesto aprobada.');
  if (!validatedAdvance) failures.push('Debe existir un anticipo mayor a cero validado por administración.');
  if (!notConverted) failures.push('La cotización ya fue convertida a expediente.');
  if (!linkedProspect) failures.push('La cotización debe conservar un prospecto vinculado.');

  return {
    eligible: failures.length === 0,
    accepted,
    approvedVersion,
    validatedAdvance,
    validatedAdvanceTotal,
    notConverted,
    linkedProspect,
    failures,
  };
}
