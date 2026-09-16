import { createHash } from 'crypto';
import { CotizacionEtapaContractual as Stage, CotizacionEstado } from '@prisma/client';

export const QUOTE_CONTRACT_STAGES = Object.freeze([
  { code: Stage.BORRADOR, label: 'Borrador' },
  { code: Stage.EN_ELABORACION, label: 'En elaboración' },
  { code: Stage.ENVIADA_CLIENTE, label: 'Enviada al cliente' },
  { code: Stage.EN_SEGUIMIENTO, label: 'En seguimiento' },
  { code: Stage.ACEPTADA, label: 'Aceptada' },
  { code: Stage.RECHAZADA, label: 'Rechazada' },
  // Historical canonical value retained read-only for pre-Correction-002 records.
  { code: Stage.ACEPTO_ANTICIPO, label: 'Aceptó / Anticipo (histórico)' },
  { code: Stage.SUSPENDIDA, label: 'Suspendida' },
  { code: Stage.CANCELADA, label: 'Cancelada' },
  { code: Stage.CONVERTIDA_EXPEDIENTE, label: 'Convertida en expediente' },
]);

export const QUOTE_CONTRACT_ACTIONS = {
  COMENZAR_ELABORACION: 'Comenzar elaboración',
  ENVIAR_CLIENTE: 'Registrar envío al cliente',
  INICIAR_SEGUIMIENTO: 'Iniciar seguimiento',
  REENVIAR_CLIENTE: 'Registrar reenvío al cliente',
  ACEPTAR: 'Registrar aceptación',
  RECHAZAR: 'Registrar rechazo',
  SUSPENDER: 'Suspender cotización',
  CANCELAR: 'Cancelar cotización',
  CONVERTIR: 'Convertir en expediente',
} as const;
export type QuoteContractAction = keyof typeof QUOTE_CONTRACT_ACTIONS;

export class QuoteContractError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) { super(message); }
}
export const failQuote = (status: number, code: string, message: string): never => { throw new QuoteContractError(status, code, message); };
export const quoteStageLabel = (stage: Stage | null) => QUOTE_CONTRACT_STAGES.find((item) => item.code === stage)?.label ?? 'Etapa histórica por confirmar';

export function allowedQuoteActions(stage: Stage | null): QuoteContractAction[] {
  if (stage === Stage.BORRADOR) return ['COMENZAR_ELABORACION', 'SUSPENDER', 'CANCELAR'];
  if (stage === Stage.EN_ELABORACION) return ['ENVIAR_CLIENTE', 'SUSPENDER', 'CANCELAR'];
  if (stage === Stage.ENVIADA_CLIENTE) return ['INICIAR_SEGUIMIENTO', 'REENVIAR_CLIENTE', 'ACEPTAR', 'RECHAZAR', 'SUSPENDER', 'CANCELAR'];
  if (stage === Stage.EN_SEGUIMIENTO) return ['REENVIAR_CLIENTE', 'ACEPTAR', 'RECHAZAR', 'SUSPENDER', 'CANCELAR'];
  if (stage === Stage.ACEPTADA || stage === Stage.ACEPTO_ANTICIPO) return ['CONVERTIR'];
  return [];
}

export function quoteActionResult(stage: Stage | null, action: QuoteContractAction): { next: Stage; changesStage: boolean } {
  if (!allowedQuoteActions(stage).includes(action)) {
    failQuote(409, 'COT001_TRANSITION_DENIED', 'Esta acción ya no corresponde a la etapa actual. Actualiza la ficha.');
  }
  if (action === 'COMENZAR_ELABORACION') return { next: Stage.EN_ELABORACION, changesStage: true };
  if (action === 'ENVIAR_CLIENTE') return { next: Stage.ENVIADA_CLIENTE, changesStage: true };
  if (action === 'INICIAR_SEGUIMIENTO') return { next: Stage.EN_SEGUIMIENTO, changesStage: true };
  if (action === 'REENVIAR_CLIENTE') return { next: stage!, changesStage: false };
  if (action === 'ACEPTAR') return { next: Stage.ACEPTADA, changesStage: true };
  if (action === 'RECHAZAR') return { next: Stage.RECHAZADA, changesStage: true };
  if (action === 'SUSPENDER') return { next: Stage.SUSPENDIDA, changesStage: true };
  if (action === 'CANCELAR') return { next: Stage.CANCELADA, changesStage: true };
  return { next: Stage.CONVERTIDA_EXPEDIENTE, changesStage: true };
}

export function quoteLegacyProjection(stage: Stage): CotizacionEstado {
  if (stage === Stage.BORRADOR || stage === Stage.EN_ELABORACION) return CotizacionEstado.BORRADOR;
  if (stage === Stage.ENVIADA_CLIENTE) return CotizacionEstado.ENVIADA_CLIENTE;
  if (stage === Stage.EN_SEGUIMIENTO) return CotizacionEstado.EN_NEGOCIACION;
  if (stage === Stage.ACEPTADA || stage === Stage.ACEPTO_ANTICIPO) return CotizacionEstado.ACEPTADA;
  if (stage === Stage.RECHAZADA) return CotizacionEstado.RECHAZADA;
  if (stage === Stage.SUSPENDIDA) return CotizacionEstado.SUSPENDIDA;
  if (stage === Stage.CANCELADA) return CotizacionEstado.CANCELADA;
  return CotizacionEstado.CONVERTIDA_EXPEDIENTE;
}

export function assertQuoteVersion(expected: unknown, current: number) {
  if (!Number.isInteger(expected) || Number(expected) < 0) failQuote(400, 'COT001_VERSION_REQUIRED', 'Actualiza la ficha antes de continuar.');
  if (expected !== current) failQuote(409, 'COT001_STALE_VERSION', 'La cotización cambió en otra sesión. Actualízala para revisar los cambios.');
}

export function quoteKey(value: unknown) {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9_.:-]{8,120}$/.test(value)) {
    failQuote(400, 'COT001_KEY_REQUIRED', 'No se pudo identificar el intento. Actualiza la ficha y vuelve a intentarlo.');
  }
  return value as string;
}

export function quoteEffectiveAt(value: unknown, recordedAt: Date, previous: Date | null, required = true) {
  const absent = value === undefined || value === null || value === '';
  if (required && absent) failQuote(400, 'COT001_DATE_REQUIRED', 'Indica cuándo ocurrió el hecho.');
  const result = absent ? recordedAt : new Date(String(value));
  if (!Number.isFinite(result.getTime()) || result > recordedAt || (previous && result < previous)) {
    failQuote(400, 'COT001_DATE_INVALID', 'La fecha debe ser válida, no futura y posterior o igual al hecho anterior.');
  }
  return result;
}

export function assertQuoteFields(raw: Record<string, unknown>, allowed: readonly string[]) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) || Object.keys(raw).some((key) => !allowed.includes(key))) {
    failQuote(400, 'COT001_FIELDS_DENIED', 'La solicitud contiene campos que no se pueden modificar desde esta acción.');
  }
}

const sortObject = (value: any): any => Array.isArray(value) ? value.map(sortObject) : value && typeof value === 'object'
  ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, sortObject(value[key])])) : value;
export const quoteJson = (value: unknown) => JSON.parse(JSON.stringify(value));
export const quoteHash = (value: unknown) => createHash('sha256').update(JSON.stringify(sortObject(value))).digest('hex');
export function assertQuoteReplay(stored: { payload_hash: string; actor_id: string }, hash: string, actorId: string) {
  if (stored.payload_hash !== hash || stored.actor_id !== actorId) {
    failQuote(409, 'COT001_KEY_REUSED', 'Ese intento ya se utilizó con otros datos. Revisa la ficha antes de continuar.');
  }
}

export const quoteKnowledge = (stage: Stage | null) => stage ? 'KNOWN' as const : 'UNKNOWN_LEGACY' as const;
