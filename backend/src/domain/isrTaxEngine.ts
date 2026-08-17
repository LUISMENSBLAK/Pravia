import { Prisma } from '@prisma/client';

const Decimal = Prisma.Decimal;

export type ISRMoney = string;

export type ISRDeductionTreatment =
  | 'COSTO_ADQUISICION_ACTUALIZADO'
  | 'CONSTRUCCIONES_MEJORAS_AMPLIACIONES_ACTUALIZADAS'
  | 'GASTOS_NOTARIALES_IMPUESTOS_DERECHOS_AVALUO_ACTUALIZADOS'
  | 'COMISIONES_MEDIACIONES_ACTUALIZADAS';

export type ISRUpdateOrigin =
  | 'PRAVIA_CALCULATION'
  | 'MANUAL_CONFIRMED'
  | 'NORMATIVE_OPTION_TABLE';

export type ISRCalculationInput = {
  operationType: 'ENAJENACION_INMUEBLE' | 'ADQUISICION_INMUEBLE' | 'CASO_ESPECIAL';
  taxYear: number;
  taxpayer: {
    fullName: string;
    rfc: string;
    curp?: string;
    personType: 'FISICA' | 'MORAL';
    fiscalResidence: 'MEXICO' | 'EXTRANJERO' | 'NO_CONFIRMADA';
    confirmed: boolean;
  };
  property: { description: string; landAndConstructionSameAcquisitionDate: boolean };
  acquisitionDate: string;
  saleDate: string;
  yearsElapsed: number;
  salePrice: ISRMoney;
  deductions: Array<{
    id: string;
    concept: string;
    historicalAmount: ISRMoney;
    updatedAmount: ISRMoney;
    expenseDate: string;
    updateOrigin: ISRUpdateOrigin;
    updateMethod: string;
    treatment: ISRDeductionTreatment | 'NO_DEDUCIBLE' | 'REQUIERE_REVISION';
    included: boolean;
    confirmed: boolean;
    supportDocumentId: string;
    reason: string;
    confirmedBy: string;
    confirmedAt: string;
  }>;
  exemptionTreatment: 'NO_APLICA_CONFIRMADO' | 'PENDIENTE_REVISION' | 'SOLICITADA';
  ordinaryCaseConfirmed: boolean;
  specialCases: Array<'COPROPIEDAD' | 'HERENCIA_DONACION' | 'PRESCRIPCION' | 'ADJUDICACION' | 'FIDEICOMISO' | 'PAGO_PARCIALIDADES' | 'FECHAS_SEPARADAS_TERRENO_CONSTRUCCION' | 'OTRO'>;
};

export type ISRRateBracket = {
  order: number;
  lower: ISRMoney;
  upper: ISRMoney | null;
  fixedFee: ISRMoney;
  percentage: ISRMoney;
};

export type ISRRuleSetSnapshot = {
  id: string;
  key: string;
  version: string;
  taxYear: number;
  operationType: 'ENAJENACION_INMUEBLE';
  jurisdiction: 'MX-FED';
  validFrom: string;
  validTo: string;
  normativeSource: string;
  sourceUrl: string;
  yearsCap: number;
  rounding: 'HALF_UP_CENT';
  brackets: ISRRateBracket[];
};

export type ISRBreakdownStep = {
  key: string;
  label: string;
  operation: string;
  amount: ISRMoney;
  source: string;
};

export type ISRCalculationResult = {
  currency: 'MXN';
  scope: 'FEDERAL_ARTICLE_126_ONLY';
  fiscalOperationFullyDetermined: false;
  unsupportedObligations: Array<'LISR_ARTICLE_127_STATE_PAYMENT'>;
  taxableIncome: ISRMoney;
  exemptIncome: ISRMoney;
  consideredDeductions: ISRMoney;
  gain: ISRMoney;
  yearsConsidered: number;
  tariffBase: ISRMoney;
  bracket: ISRRateBracket;
  provisionalFederalISR: ISRMoney;
  calculationPrecision: {
    tariffTaxRaw: ISRMoney;
    provisionalFederalISRRaw: ISRMoney;
  };
  ruleSet: { id: string; key: string; version: string; sourceUrl: string };
  breakdown: ISRBreakdownStep[];
};

export class ISRValidationError extends Error {
  constructor(public readonly code: string, message: string, public readonly field?: string) {
    super(message);
    this.name = 'ISRValidationError';
  }
}

const money = (value: Prisma.Decimal.Value, field: string) => {
  try {
    const parsed = new Decimal(value);
    if (!parsed.isFinite()) throw new Error('not finite');
    return parsed;
  } catch {
    throw new ISRValidationError('INVALID_AMOUNT', `El importe de ${field} no es válido.`, field);
  }
};
const rounded = (value: Prisma.Decimal) => value.toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
const serialized = (value: Prisma.Decimal) => rounded(value).toFixed(2);

const validateSupportedCase = (input: ISRCalculationInput, rules: ISRRuleSetSnapshot) => {
  if (input.operationType !== 'ENAJENACION_INMUEBLE') throw new ISRValidationError('UNSUPPORTED_CASE', 'Cálculo no disponible para este supuesto.', 'operationType');
  if (input.taxYear !== rules.taxYear) throw new ISRValidationError('RULESET_NOT_FOUND', `No existe una tarifa confirmada para el ejercicio ${input.taxYear}.`, 'taxYear');
  if (input.taxpayer.personType !== 'FISICA' || input.taxpayer.fiscalResidence !== 'MEXICO') throw new ISRValidationError('UNSUPPORTED_CASE', 'Cálculo no disponible para este supuesto de contribuyente.', 'taxpayer');
  if (!input.taxpayer.confirmed || !input.taxpayer.fullName.trim() || !input.taxpayer.rfc.trim()) throw new ISRValidationError('MISSING_DATA', 'Confirma el nombre y RFC del contribuyente antes de calcular.', 'taxpayer');
  if (!input.ordinaryCaseConfirmed) throw new ISRValidationError('HUMAN_REVIEW_REQUIRED', 'Confirma que se trata de una operación ordinaria antes de calcular.', 'ordinaryCaseConfirmed');
  if (input.exemptionTreatment !== 'NO_APLICA_CONFIRMADO') throw new ISRValidationError('UNSUPPORTED_EXEMPTION', 'La exención requiere revisión fiscal humana y este supuesto todavía no se calcula.', 'exemptionTreatment');
  if (input.specialCases.length) throw new ISRValidationError('UNSUPPORTED_CASE', 'Cálculo no disponible para este supuesto especial.', 'specialCases');
  if (!input.property.landAndConstructionSameAcquisitionDate) throw new ISRValidationError('UNSUPPORTED_CASE', 'Las fechas separadas de terreno y construcción requieren un motor específico.', 'property');
  const acquired = new Date(`${input.acquisitionDate}T00:00:00Z`);
  const sold = new Date(`${input.saleDate}T00:00:00Z`);
  if (Number.isNaN(acquired.getTime())) throw new ISRValidationError('INVALID_DATE', 'La fecha de adquisición no es válida.', 'acquisitionDate');
  if (Number.isNaN(sold.getTime())) throw new ISRValidationError('INVALID_DATE', 'La fecha de enajenación no es válida.', 'saleDate');
  if (acquired >= sold) throw new ISRValidationError('INVALID_DATE_ORDER', 'La fecha de adquisición debe ser anterior a la fecha de enajenación.', 'acquisitionDate');
  if (sold.getUTCFullYear() !== input.taxYear) throw new ISRValidationError('TAX_YEAR_MISMATCH', 'El ejercicio debe coincidir con la fecha de enajenación.', 'taxYear');
  if (!Number.isInteger(input.yearsElapsed) || input.yearsElapsed < 1) throw new ISRValidationError('INVALID_YEARS', 'Confirma un número entero de años transcurridos mayor o igual a uno.', 'yearsElapsed');
};

export function calculateISR(input: ISRCalculationInput, rules: ISRRuleSetSnapshot): ISRCalculationResult {
  validateSupportedCase(input, rules);
  const salePrice = money(input.salePrice, 'precio de enajenación');
  if (salePrice.lte(0)) throw new ISRValidationError('INVALID_AMOUNT', 'El precio de enajenación debe ser mayor a cero.', 'salePrice');

  let deductions = new Decimal(0);
  for (const item of input.deductions) {
    const historicalAmount = money(item.historicalAmount, `importe histórico de ${item.concept || 'deducción'}`);
    const updatedAmount = money(item.updatedAmount, `importe actualizado de ${item.concept || 'deducción'}`);
    if (historicalAmount.lt(0) || updatedAmount.lt(0)) throw new ISRValidationError('INVALID_AMOUNT', 'Las deducciones no pueden ser negativas.', `deductions.${item.id}`);
    if (!item.included) continue;
    if (!item.confirmed || item.treatment === 'REQUIERE_REVISION') throw new ISRValidationError('HUMAN_REVIEW_REQUIRED', `Confirma el tratamiento fiscal de “${item.concept}”.`, `deductions.${item.id}`);
    if (item.treatment === 'NO_DEDUCIBLE') throw new ISRValidationError('INVALID_DEDUCTION', `“${item.concept}” no puede incluirse como deducción.`, `deductions.${item.id}`);
    if (!item.concept.trim() || !item.expenseDate || !item.updateMethod.trim() || !item.supportDocumentId.trim() || !item.reason.trim() || !item.confirmedBy.trim() || !item.confirmedAt) {
      throw new ISRValidationError('MISSING_DEDUCTION_TRACE', `Completa la trazabilidad de “${item.concept || 'la deducción'}” antes de incluirla.`, `deductions.${item.id}`);
    }
    const expenseDate = new Date(`${item.expenseDate}T00:00:00Z`);
    const confirmedAt = new Date(item.confirmedAt);
    if (Number.isNaN(expenseDate.getTime()) || Number.isNaN(confirmedAt.getTime())) throw new ISRValidationError('INVALID_DEDUCTION_TRACE_DATE', `Confirma las fechas de trazabilidad de “${item.concept}”.`, `deductions.${item.id}`);
    if (item.updateOrigin !== 'MANUAL_CONFIRMED') {
      throw new ISRValidationError('UNSUPPORTED_DEDUCTION_UPDATE', 'La actualización automática por PRAVIA o por tabla normativa aún no está implementada.', `deductions.${item.id}.updateOrigin`);
    }
    deductions = deductions.plus(updatedAmount);
  }
  if (deductions.gte(salePrice)) throw new ISRValidationError('LOSS_REVIEW_REQUIRED', 'La operación determina una ganancia nula o pérdida y requiere revisión fiscal específica.', 'deductions');

  const gain = salePrice.minus(deductions);
  const years = Math.min(input.yearsElapsed, rules.yearsCap);
  const tariffBase = gain.div(years);
  const bracket = rules.brackets.find((candidate) => {
    const lower = money(candidate.lower, 'límite inferior');
    const upper = candidate.upper === null ? null : money(candidate.upper, 'límite superior');
    return tariffBase.gte(lower) && (upper === null || tariffBase.lte(upper));
  });
  if (!bracket) throw new ISRValidationError('RATE_BRACKET_NOT_FOUND', 'No existe un rango de tarifa aplicable a la base determinada.');
  const lower = money(bracket.lower, 'límite inferior');
  const fixedFee = money(bracket.fixedFee, 'cuota fija');
  const rate = money(bracket.percentage, 'porcentaje').div(100);
  const tariffTax = fixedFee.plus(tariffBase.minus(lower).times(rate));
  const provisionalRaw = tariffTax.times(years);
  const provisional = rounded(provisionalRaw);

  const source = `${rules.normativeSource}; reglaset ${rules.version}`;
  const breakdown: ISRBreakdownStep[] = [
    { key: 'income', label: 'Ingreso considerado', operation: 'Precio de enajenación confirmado', amount: serialized(salePrice), source: 'LISR 119' },
    { key: 'deductions', label: 'Deducciones consideradas', operation: 'Suma de partidas incluidas y confirmadas', amount: serialized(deductions), source: 'LISR 121' },
    { key: 'gain', label: 'Ganancia determinada', operation: `${serialized(salePrice)} − ${serialized(deductions)}`, amount: serialized(gain), source: 'LISR 121' },
    { key: 'tariff-base', label: 'Base para tarifa', operation: `${serialized(gain)} ÷ ${years} años`, amount: serialized(tariffBase), source: 'LISR 126, primer párrafo' },
    { key: 'bracket-tax', label: 'Impuesto sobre base', operation: `Cuota ${serialized(fixedFee)} + excedente sobre ${serialized(lower)} × ${bracket.percentage}%`, amount: serialized(tariffTax), source: 'Anexo 8 RMF 2026, apartado A.I' },
    { key: 'provisional-isr', label: 'ISR provisional federal', operation: `${serialized(tariffTax)} × ${years} años`, amount: serialized(provisional), source: 'LISR 126, primer párrafo' },
  ];

  return {
    currency: 'MXN', scope: 'FEDERAL_ARTICLE_126_ONLY', fiscalOperationFullyDetermined: false,
    unsupportedObligations: ['LISR_ARTICLE_127_STATE_PAYMENT'],
    taxableIncome: serialized(salePrice), exemptIncome: '0.00', consideredDeductions: serialized(deductions), gain: serialized(gain),
    yearsConsidered: years, tariffBase: serialized(tariffBase), bracket, provisionalFederalISR: serialized(provisional),
    calculationPrecision: { tariffTaxRaw: tariffTax.toFixed(5), provisionalFederalISRRaw: provisionalRaw.toFixed(5) },
    ruleSet: { id: rules.id, key: rules.key, version: rules.version, sourceUrl: rules.sourceUrl }, breakdown,
  };
}

export const ISR2026_RULESET: ISRRuleSetSnapshot = {
  id: '2d790ca1-30f8-4897-b552-f6c20a89f8e1',
  key: 'ISR_ENAJENACION_INMUEBLE_PAGO_PROVISIONAL_MX_FED',
  version: '2026.1-DOF-2025-12-28',
  taxYear: 2026,
  operationType: 'ENAJENACION_INMUEBLE',
  jurisdiction: 'MX-FED',
  validFrom: '2026-01-01', validTo: '2026-12-31', yearsCap: 20, rounding: 'HALF_UP_CENT',
  normativeSource: 'LISR artículos 119, 120, 121 y 126; RMF 2026 regla 3.15.4; Anexo 8 apartado A.I',
  sourceUrl: 'https://www.dof.gob.mx/nota_detalle.php?codigo=5777219&fecha=28/12/2025',
  brackets: [
    { order: 1, lower: '0.01', upper: '10135.11', fixedFee: '0.00', percentage: '1.92' },
    { order: 2, lower: '10135.12', upper: '86022.11', fixedFee: '194.59', percentage: '6.40' },
    { order: 3, lower: '86022.12', upper: '151176.19', fixedFee: '5051.37', percentage: '10.88' },
    { order: 4, lower: '151176.20', upper: '175735.66', fixedFee: '12140.13', percentage: '16.00' },
    { order: 5, lower: '175735.67', upper: '210403.69', fixedFee: '16069.64', percentage: '17.92' },
    { order: 6, lower: '210403.70', upper: '424353.97', fixedFee: '22282.14', percentage: '21.36' },
    { order: 7, lower: '424353.98', upper: '668840.14', fixedFee: '67981.92', percentage: '23.52' },
    { order: 8, lower: '668840.15', upper: '1276925.98', fixedFee: '125485.07', percentage: '30.00' },
    { order: 9, lower: '1276925.99', upper: '1702567.97', fixedFee: '307910.81', percentage: '32.00' },
    { order: 10, lower: '1702567.98', upper: '5107703.92', fixedFee: '444116.23', percentage: '34.00' },
    { order: 11, lower: '5107703.93', upper: null, fixedFee: '1601862.46', percentage: '35.00' },
  ],
};
