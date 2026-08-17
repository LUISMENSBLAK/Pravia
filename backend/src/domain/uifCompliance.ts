export type NormativeStatus = 'VIGENTE' | 'PENDIENTE_DE_IMPLEMENTACION_NORMATIVA' | 'SUSTITUIDA' | 'DEROGADA';
export type TriState = 'SI' | 'NO' | 'INDETERMINADA';
export type VulnerableActivityKey =
  | 'TRANSMISION_DERECHOS_REALES_INMUEBLES'
  | 'PODER_IRREVOCABLE_ADMINISTRACION_DOMINIO'
  | 'CONSTITUCION_MODIFICACION_PERSONA_MORAL'
  | 'FIDEICOMISO_TRASLATIVO_GARANTIA'
  | 'MUTUO_CREDITO_NO_FINANCIERO';

export type UmaReference = {
  year: number;
  dailyValueMxn: number;
  effectiveFrom: string;
  effectiveTo?: string | null;
  sourceUrl: string;
};

export type RelatedOperation = {
  id: string;
  clientId: string;
  activity: VulnerableActivityKey;
  operationDate: string;
  amountMxn: number;
  isIdentifiable: boolean;
};

export type VulnerableActivityInput = {
  activity?: VulnerableActivityKey | 'OTRA';
  operationDate: string;
  clientId?: string;
  priceMxn?: number | null;
  cadastralValueMxn?: number | null;
  commercialValueMxn?: number | null;
  securedPrincipalMxn?: number | null;
  operationAmountMxn?: number | null;
  relatedOperations?: RelatedOperation[];
};

export type NormativeRule = {
  activity: VulnerableActivityKey;
  legalBasis: string;
  identificationAlways: true;
  noticeAlways: boolean;
  noticeThresholdUma: number | null;
  noticeChannel: 'SPPLD' | 'DECLARANOT';
  status: NormativeStatus;
};

export type VulnerableActivityResult = {
  activityVulnerable: TriState;
  identificationRequired: TriState;
  noticeRequired: TriState;
  noticeStatus: 'NO_APLICA' | 'POR_DETERMINAR' | 'REQUIERE_AVISO';
  amountConsideredMxn: number | null;
  accumulatedAmountMxn: number | null;
  noticeThresholdUma: number | null;
  noticeThresholdMxn: number | null;
  uma: UmaReference;
  legalBasis: string;
  channel: 'SPPLD' | 'DECLARANOT' | 'PENDIENTE_DE_DEFINIR';
  ruleVersion: string;
  ruleStatus: NormativeStatus;
  includedOperations: Array<{ id: string; amountMxn: number; operationDate: string }>;
  explanation: string;
};

export class UifRuleError extends Error {
  constructor(message: string, readonly code: string) { super(message); }
}

export const UIF_RULE_VERSION = 'LFPIORPI-2025-07-16+RLFPIORPI-2026-03-27+UMA';

export const NOTARIAL_RULES: Record<VulnerableActivityKey, NormativeRule> = {
  TRANSMISION_DERECHOS_REALES_INMUEBLES: {
    activity: 'TRANSMISION_DERECHOS_REALES_INMUEBLES',
    legalBasis: 'LFPIORPI, artículo 17, fracción XII, Apartado A, inciso a)',
    identificationAlways: true,
    noticeAlways: false,
    noticeThresholdUma: 8_000,
    noticeChannel: 'DECLARANOT',
    status: 'VIGENTE',
  },
  PODER_IRREVOCABLE_ADMINISTRACION_DOMINIO: {
    activity: 'PODER_IRREVOCABLE_ADMINISTRACION_DOMINIO',
    legalBasis: 'LFPIORPI, artículo 17, fracción XII, Apartado A, inciso b)',
    identificationAlways: true,
    noticeAlways: true,
    noticeThresholdUma: null,
    noticeChannel: 'SPPLD',
    status: 'VIGENTE',
  },
  CONSTITUCION_MODIFICACION_PERSONA_MORAL: {
    activity: 'CONSTITUCION_MODIFICACION_PERSONA_MORAL',
    legalBasis: 'LFPIORPI, artículo 17, fracción XII, Apartado A, inciso c)',
    identificationAlways: true,
    noticeAlways: true,
    noticeThresholdUma: null,
    noticeChannel: 'SPPLD',
    status: 'VIGENTE',
  },
  FIDEICOMISO_TRASLATIVO_GARANTIA: {
    activity: 'FIDEICOMISO_TRASLATIVO_GARANTIA',
    legalBasis: 'LFPIORPI, artículo 17, fracción XII, Apartado A, inciso d)',
    identificationAlways: true,
    noticeAlways: false,
    noticeThresholdUma: 4_000,
    noticeChannel: 'SPPLD',
    status: 'VIGENTE',
  },
  MUTUO_CREDITO_NO_FINANCIERO: {
    activity: 'MUTUO_CREDITO_NO_FINANCIERO',
    legalBasis: 'LFPIORPI, artículo 17, fracción XII, Apartado A, inciso e)',
    identificationAlways: true,
    noticeAlways: true,
    noticeThresholdUma: null,
    noticeChannel: 'SPPLD',
    status: 'VIGENTE',
  },
};

const cents = (value: unknown, field: string) => {
  if (value === undefined || value === null || value === '') return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) throw new UifRuleError(`${field} debe ser un monto no negativo.`, 'UIF_AMOUNT_INVALID');
  return Math.round(parsed * 100);
};
const money = (value: number) => Number((value / 100).toFixed(2));
const utcDate = (value: string, field = 'fecha') => {
  const date = new Date(`${value.slice(0, 10)}T12:00:00.000Z`);
  if (!/^\d{4}-\d{2}-\d{2}/.test(value) || Number.isNaN(date.getTime())) throw new UifRuleError(`${field} no es válida.`, 'UIF_DATE_INVALID');
  return date;
};

export function resolveUma(operationDate: string, catalog: UmaReference[]) {
  const target = utcDate(operationDate, 'La fecha jurídica');
  const match = catalog.find((entry) => {
    const from = utcDate(entry.effectiveFrom);
    const to = entry.effectiveTo ? utcDate(entry.effectiveTo) : null;
    return target >= from && (!to || target <= to);
  });
  if (!match || !Number.isFinite(match.dailyValueMxn) || match.dailyValueMxn <= 0) {
    throw new UifRuleError('No existe una UMA versionada aplicable a la fecha jurídica de la operación.', 'UIF_UMA_DATE_MISMATCH');
  }
  return match;
}

function amountFor(input: VulnerableActivityInput, activity: VulnerableActivityKey) {
  if (activity === 'TRANSMISION_DERECHOS_REALES_INMUEBLES') {
    const values = [
      cents(input.priceMxn, 'El precio pactado'),
      cents(input.cadastralValueMxn, 'El valor catastral'),
      cents(input.commercialValueMxn, 'El valor comercial'),
      cents(input.securedPrincipalMxn, 'La suerte principal garantizada'),
    ].filter((value): value is number => value !== null);
    return values.length ? Math.max(...values) : null;
  }
  return cents(input.operationAmountMxn ?? input.priceMxn, 'El importe de la operación');
}

function sixMonthWindow(operationDate: string) {
  const end = utcDate(operationDate);
  const start = new Date(end);
  start.setUTCMonth(start.getUTCMonth() - 6);
  return { start, end };
}

export function relatedOperationsFor(input: VulnerableActivityInput, activity: VulnerableActivityKey) {
  if (!input.clientId) return [];
  const { start, end } = sixMonthWindow(input.operationDate);
  const seen = new Set<string>();
  return (input.relatedOperations || [])
    .filter((item) => {
      if (seen.has(item.id) || item.clientId !== input.clientId || item.activity !== activity || !item.isIdentifiable) return false;
      const date = utcDate(item.operationDate);
      if (date < start || date > end) return false;
      seen.add(item.id);
      return true;
    })
    .map((item) => ({ id: item.id, operationDate: item.operationDate.slice(0, 10), amountMxn: money(cents(item.amountMxn, 'El importe relacionado') || 0) }));
}

export function evaluateVulnerableActivity(input: VulnerableActivityInput, umaCatalog: UmaReference[]): VulnerableActivityResult {
  const uma = resolveUma(input.operationDate, umaCatalog);
  if (!input.activity || input.activity === 'OTRA') {
    return {
      activityVulnerable: input.activity === 'OTRA' ? 'NO' : 'INDETERMINADA', identificationRequired: 'INDETERMINADA', noticeRequired: 'INDETERMINADA',
      noticeStatus: 'POR_DETERMINAR', amountConsideredMxn: null, accumulatedAmountMxn: null, noticeThresholdUma: null, noticeThresholdMxn: null,
      uma, legalBasis: 'Alcance inicial limitado a LFPIORPI, artículo 17, fracción XII, Apartado A', channel: 'PENDIENTE_DE_DEFINIR', ruleVersion: UIF_RULE_VERSION,
      ruleStatus: 'VIGENTE', includedOperations: [], explanation: input.activity === 'OTRA' ? 'El acto no pertenece al alcance notarial configurado; requiere clasificación jurídica.' : 'Falta seleccionar el supuesto notarial aplicable.',
    };
  }
  const rule = NOTARIAL_RULES[input.activity];
  const baseCents = amountFor(input, input.activity);
  const related = relatedOperationsFor(input, input.activity);
  const relatedCents = related.reduce((total, item) => total + Math.round(item.amountMxn * 100), 0);
  const accumulatedCents = baseCents === null ? null : baseCents + relatedCents;
  const thresholdCents = rule.noticeThresholdUma === null ? null : Math.round(rule.noticeThresholdUma * uma.dailyValueMxn * 100);
  const determined = rule.noticeAlways || (accumulatedCents !== null && thresholdCents !== null);
  const requiresNotice = rule.noticeAlways || (determined && accumulatedCents! >= thresholdCents!);
  return {
    activityVulnerable: 'SI', identificationRequired: 'SI', noticeRequired: determined ? (requiresNotice ? 'SI' : 'NO') : 'INDETERMINADA',
    noticeStatus: !determined ? 'POR_DETERMINAR' : requiresNotice ? 'REQUIERE_AVISO' : 'NO_APLICA',
    amountConsideredMxn: baseCents === null ? null : money(baseCents), accumulatedAmountMxn: accumulatedCents === null ? null : money(accumulatedCents),
    noticeThresholdUma: rule.noticeThresholdUma, noticeThresholdMxn: thresholdCents === null ? null : money(thresholdCents), uma,
    legalBasis: rule.legalBasis, channel: rule.noticeChannel, ruleVersion: UIF_RULE_VERSION, ruleStatus: rule.status, includedOperations: related,
    explanation: rule.noticeAlways
      ? 'La identificación y el Aviso proceden por la realización del supuesto, con revisión humana de aplicabilidad.'
      : !determined
        ? 'La actividad es vulnerable e identificable, pero faltan importes para determinar el Aviso.'
        : requiresNotice
          ? `El importe considerado${related.length ? ' y su acumulación aplicable' : ''} alcanza el umbral de Aviso.`
          : 'La identificación procede siempre; el importe no alcanza el umbral de Aviso.',
  };
}

export type PaymentMethod = 'EFECTIVO_MXN' | 'EFECTIVO_DIVISA' | 'METALES_PRECIOSOS' | 'TRANSFERENCIA' | 'CHEQUE' | 'CREDITO' | 'OTRO';
export type PaymentEntry = { id: string; amountMxn: number; method: PaymentMethod; paymentDate: string; evidenceDocumentId?: string | null };

export function validatePaymentDistribution(totalAmountMxn: number, payments: PaymentEntry[], complete: boolean) {
  const total = cents(totalAmountMxn, 'El importe total');
  if (total === null) throw new UifRuleError('El importe total es obligatorio.', 'UIF_PAYMENT_TOTAL_REQUIRED');
  const sum = payments.reduce((value, payment) => value + (cents(payment.amountMxn, 'El pago') || 0), 0);
  if (sum > total) throw new UifRuleError('La suma de las formas de pago no puede exceder el importe total.', 'UIF_PAYMENT_SUM_EXCEEDED');
  if (complete && sum !== total) throw new UifRuleError('La distribución completa debe coincidir con el importe total.', 'UIF_PAYMENT_SUM_INCOMPLETE');
  return { totalAmountMxn: money(total), distributedAmountMxn: money(sum), remainingAmountMxn: money(total - sum), complete };
}

export function evaluateRealEstateCashRestriction(input: { operationValueMxn?: number | null; payments: PaymentEntry[] }, umaCatalog: UmaReference[]) {
  const cash = input.payments.filter((payment) => ['EFECTIVO_MXN', 'EFECTIVO_DIVISA', 'METALES_PRECIOSOS'].includes(payment.method));
  if (!cash.length) return { status: 'CUMPLE' as const, cashDetectedMxn: 0, thresholdUma: 8_025, thresholdMxn: null, excessMxn: 0, legalBasis: 'LFPIORPI, artículo 32, fracción I', explanation: 'No se registraron pagos en efectivo, divisas o metales preciosos.' };
  const value = cents(input.operationValueMxn, 'El valor de la operación');
  if (value === null) return { status: 'REQUIERE_INFORMACION' as const, cashDetectedMxn: money(cash.reduce((sum, item) => sum + (cents(item.amountMxn, 'El pago') || 0), 0)), thresholdUma: 8_025, thresholdMxn: null, excessMxn: null, legalBasis: 'LFPIORPI, artículo 32, fracción I', explanation: 'Falta el valor de la operación para aplicar la restricción.' };
  const evaluations = cash.map((payment) => {
    const uma = resolveUma(payment.paymentDate, umaCatalog);
    const threshold = Math.round(8_025 * uma.dailyValueMxn * 100);
    return { payment, uma, threshold };
  });
  const triggered = evaluations.filter((item) => value >= item.threshold);
  const cashCents = cash.reduce((sum, item) => sum + (cents(item.amountMxn, 'El pago') || 0), 0);
  const reference = evaluations[0];
  return {
    status: triggered.length ? 'REQUIERE_REVISION' as const : 'CUMPLE' as const,
    cashDetectedMxn: money(cashCents), thresholdUma: 8_025, thresholdMxn: money(reference.threshold), uma: reference.uma,
    // El umbral califica el valor del acto; no es una franquicia de efectivo. Si se activa, todo pago detectado requiere revisión.
    excessMxn: triggered.length ? money(cashCents) : 0,
    legalBasis: 'LFPIORPI, artículo 32, fracción I; Reglamento, artículos 42 y 45',
    explanation: triggered.length
      ? 'El valor del acto alcanza el umbral independiente del artículo 32 y se detectó pago en efectivo o metales. El umbral no es una cantidad permitida de efectivo.'
      : 'El pago fue revisado contra la UMA de su fecha y el valor del acto no alcanza el umbral de la restricción inmobiliaria.',
  };
}

export function ordinaryNoticeDeadline(operationDate: string) {
  const date = utcDate(operationDate, 'La fecha del acto');
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 17, 23, 59, 59, 999));
}

export const RISK_RULE_STATUS: NormativeStatus = 'PENDIENTE_DE_IMPLEMENTACION_NORMATIVA';
export const RISK_DISCLAIMER = 'Clasificación interna de cumplimiento. No constituye una determinación de ilicitud.';

export function evaluateInternalRisk(input: {
  incompleteInformation?: boolean;
  beneficialOwnerUndetermined?: boolean;
  pepConfirmedByHuman?: boolean;
  documentaryContradiction?: boolean;
  complexStructureDocumented?: boolean;
  relatedOperations?: boolean;
}) {
  const factors = [
    input.incompleteInformation && { key: 'INFORMACION_INCOMPLETA', points: 20, evidence: 'Checklist de información' },
    input.beneficialOwnerUndetermined && { key: 'BC_NO_DETERMINADO', points: 25, evidence: 'Revisión de beneficiario controlador' },
    input.pepConfirmedByHuman && { key: 'PEP_CONFIRMADA', points: 20, evidence: 'Confirmación humana y evidencia PEP' },
    input.documentaryContradiction && { key: 'CONTRADICCION_DOCUMENTAL', points: 25, evidence: 'Comparación documental' },
    input.complexStructureDocumented && { key: 'ESTRUCTURA_COMPLEJA', points: 10, evidence: 'Estructura corporativa documentada' },
    input.relatedOperations && { key: 'OPERACIONES_RELACIONADAS', points: 10, evidence: 'Snapshot de acumulación' },
  ].filter(Boolean) as Array<{ key: string; points: number; evidence: string }>;
  const score = factors.reduce((sum, factor) => sum + factor.points, 0);
  const level = score === 0 ? 'BAJO' : score < 30 ? 'MEDIO' : score < 55 ? 'ALTO' : 'REQUIERE_REVISION';
  return { level, score, factors, methodology: 'PRAVIA-RISK-INTERNAL-1.0', normativeStatus: RISK_RULE_STATUS, disclaimer: RISK_DISCLAIMER };
}

export function screeningStateFromTextMatch() {
  return 'POTENTIAL_MATCH' as const;
}

export function canCreateUrgentNotice(input: { screeningState: string; evidenceVerified: boolean; ruleStatus: NormativeStatus }) {
  return input.screeningState === 'CONFIRMED_MATCH' && input.evidenceVerified && input.ruleStatus === 'VIGENTE';
}

export function retentionUntil(operationDate: string, years = 10) {
  const date = utcDate(operationDate, 'La fecha de la actividad');
  date.setUTCFullYear(date.getUTCFullYear() + years);
  return date;
}
