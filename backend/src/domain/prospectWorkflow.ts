import { createHash } from 'crypto';
import { ProspectoEtapaContractual as Stage } from '@prisma/client';

export const PROSPECT_CONTRACT_STAGES = Object.freeze([
  { code: Stage.NUEVO, label: 'Nuevo' },
  { code: Stage.EN_INTEGRACION, label: 'En integración' },
  { code: Stage.LISTO_PARA_COTIZAR, label: 'Listo para cotizar' },
  { code: Stage.CONVERTIDO_EN_COTIZACION, label: 'Convertido en cotización' },
]);
export const PROSPECT_PIPELINE_STAGES = Object.freeze({
  new: [Stage.NUEVO],
  progress: [Stage.EN_INTEGRACION, Stage.RECABANDO_INFORMACION, Stage.LISTO_PARA_SOLICITAR, Stage.SOLICITUD_ENVIADA_NOTARIA, Stage.EN_ESPERA_COTIZACION],
  quote: [Stage.LISTO_PARA_COTIZAR, Stage.COTIZACION_RECIBIDA],
  converted: [Stage.CONVERTIDO_EN_COTIZACION, Stage.CONVERTIDO_COTIZACION, Stage.SUSPENDIDO, Stage.CANCELADO],
});
export type ProspectPipelineStage = keyof typeof PROSPECT_PIPELINE_STAGES;
export const PROSPECT_ACTIONS = {
  COMENZAR_INTEGRACION: 'Comenzar integración',
  MARCAR_LISTO_PARA_COTIZAR: 'Marcar listo para cotizar',
  CONVERTIR: 'Convertir en cotización',
  SUSPENDER: 'Suspender prospecto',
  CANCELAR: 'Cancelar prospecto',
} as const;
export type ProspectAction = keyof typeof PROSPECT_ACTIONS;
export class ProspectWorkflowError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) { super(message); }
}
export const failProspect = (status: number, code: string, message: string): never => { throw new ProspectWorkflowError(status, code, message); };
export const stageLabel = (stage: Stage | null) => PROSPECT_CONTRACT_STAGES.find((s) => s.code === stage)?.label ?? 'Etapa por confirmar';
export const prospectWait = (stage: Stage | null) => {
  if (!stage) return { type: null, knowledge: 'UNKNOWN_LEGACY' as const, label: 'Espera por confirmar' };
  const types: Partial<Record<Stage, [string, string]>> = {
    EN_INTEGRACION: ['CLIENTE_DOCUMENTOS', 'Integración de información y documentos'],
    LISTO_PARA_COTIZAR: ['OFFICE_QUOTE', 'Preparación interna de cotización'],
    RECABANDO_INFORMACION: ['CLIENTE_DOCUMENTOS', 'Información pendiente del cliente (histórico)'],
    LISTO_PARA_SOLICITAR: ['INTERNA_SOLICITUD', 'Preparación interna de solicitud (histórico)'],
    SOLICITUD_ENVIADA_NOTARIA: ['NOTARIA', 'Espera de notaría (histórico)'],
    EN_ESPERA_COTIZACION: ['NOTARIA', 'Espera de notaría (histórico)'],
  };
  const type = types[stage];
  return type ? { type: type[0], knowledge: 'KNOWN' as const, label: type[1] }
    : { type: null, knowledge: 'NOT_APPLICABLE' as const, label: 'Sin espera correspondiente a esta etapa' };
};
export function allowedProspectActions(stage: Stage | null, linkedQuote: boolean): ProspectAction[] {
  if (linkedQuote) return [];
  if (stage === Stage.NUEVO) return ['COMENZAR_INTEGRACION', 'SUSPENDER', 'CANCELAR'];
  if (stage === Stage.EN_INTEGRACION) return ['MARCAR_LISTO_PARA_COTIZAR', 'SUSPENDER', 'CANCELAR'];
  if (stage === Stage.LISTO_PARA_COTIZAR) return ['CONVERTIR', 'SUSPENDER', 'CANCELAR'];
  return [];
}
export function nextProspectStage(stage: Stage | null, action: ProspectAction, linkedQuote = false): Stage {
  if (!allowedProspectActions(stage, linkedQuote).includes(action)) failProspect(409, 'PRO001_TRANSITION_DENIED', 'Esta acción ya no corresponde a la etapa actual. Actualiza la ficha.');
  return ({ COMENZAR_INTEGRACION: Stage.EN_INTEGRACION,
    MARCAR_LISTO_PARA_COTIZAR: Stage.LISTO_PARA_COTIZAR,
    CONVERTIR: Stage.CONVERTIDO_EN_COTIZACION,
    SUSPENDER: Stage.SUSPENDIDO,
    CANCELAR: Stage.CANCELADO })[action];
}
export function assertProspectVersion(expected: unknown, current: number) {
  if (!Number.isInteger(expected) || Number(expected) < 0) failProspect(400, 'PRO001_VERSION_REQUIRED', 'Actualiza la ficha antes de continuar.');
  if (expected !== current) failProspect(409, 'PRO001_STALE_VERSION', 'La ficha cambió en otra sesión. Actualízala para revisar los cambios antes de continuar.');
}
export function prospectKey(value: unknown) {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9_.:-]{8,120}$/.test(value)) failProspect(400, 'PRO001_KEY_REQUIRED', 'No se pudo identificar el intento. Actualiza la ficha y vuelve a intentarlo.');
  return value as string;
}
export function prospectEffectiveAt(value: unknown, recordedAt: Date, previous: Date | null, required = false) {
  const absent = value === undefined || value === null || value === '';
  if (required && absent) failProspect(400, 'PRO001_DATE_REQUIRED', 'Indica cuándo ocurrió el hecho.');
  if (!absent) {
    const parts = typeof value === 'string' && value.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,3})?)?(?:Z|[+-](\d{2}):(\d{2}))$/);
    if (!parts) failProspect(400, 'PRO001_DATE_INVALID', 'La fecha y hora no son válidas.');
    const [, year, month, day, hour, minute, second = '0', offsetHour = '0', offsetMinute = '0'] = parts as RegExpMatchArray;
    const y = Number(year), m = Number(month), d = Number(day);
    const leap = y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0);
    const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    // Date silently normalizes e.g. February 30. A business fact must not move to another day.
    if (y < 1 || m < 1 || m > 12 || d < 1 || d > days[m - 1] || Number(hour) > 23 || Number(minute) > 59 || Number(second) > 59 || Number(offsetHour) > 23 || Number(offsetMinute) > 59) {
      failProspect(400, 'PRO001_DATE_INVALID', 'La fecha y hora no son válidas.');
    }
  }
  const result = absent ? recordedAt : new Date(String(value));
  if (!Number.isFinite(result.getTime()) || result > recordedAt || (previous && result < previous)) failProspect(400, 'PRO001_DATE_INVALID', 'La fecha debe ser válida, no futura y posterior o igual al hecho anterior.');
  return result;
}
export const prospectJson = (value: unknown) => JSON.parse(JSON.stringify(value));
const sortObject = (value: any): any => Array.isArray(value) ? value.map(sortObject) : value && typeof value === 'object'
  ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, sortObject(value[key])])) : value;
export const prospectHash = (value: unknown) => createHash('sha256').update(JSON.stringify(sortObject(value))).digest('hex');
export function assertProspectReplay(stored: { payload_hash: string; actor_id: string }, hash: string, actorId: string) {
  if (stored.payload_hash !== hash || stored.actor_id !== actorId) failProspect(409, 'PRO001_KEY_REUSED', 'Ese intento ya se utilizó con otros datos. Revisa la ficha antes de continuar.');
}
export function assertProspectFields(raw: Record<string, unknown>, allowed: string[]) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) || Object.keys(raw).some((key) => !allowed.includes(key))) {
    failProspect(400, 'PRO001_FIELDS_DENIED', 'La solicitud contiene campos que no se pueden modificar desde esta acción.');
  }
}
