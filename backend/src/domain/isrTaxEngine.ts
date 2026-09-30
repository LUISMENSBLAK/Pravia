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
  property: {
    description: string;
    landAndConstructionSameAcquisitionDate: boolean;
    sourcePredioId?: string;
    addressText?: string;
    cadastralKey?: string;
    propertyTaxAccount?: string;
    realEstateFolio?: string;
    registryData?: Record<string, unknown>;
    countryCode?: string;
    boundaries?: Array<{ order: number; reference?: string; measurement?: ISRMoney; unit?: string; neighbor?: string; description?: string }>;
    landSurfaceM2?: ISRMoney;
    constructionSurfaceM2?: ISRMoney;
    commercialConstructionSurfaceM2?: ISRMoney;
    cadastralValue?: ISRMoney;
    appraisalValue?: ISRMoney;
    operationValue?: ISRMoney;
  };
  operation?: {
    operationDate: string;
    operationTypeCode: string;
    instrumentTypeCode: string;
    deedNumber: string;
    notary: { id?: string; number: string; name: string; state: string };
    propertyTypeCode: string;
    transmissionTypeCode: string;
    reportingMetadata: { operationReference?: string; noticeReference?: string };
    source: 'EXPEDIENTE_SNAPSHOT' | 'MANUAL_CONFIRMED';
    confirmed: boolean;
  };
  sourceContext?: {
    capturedAt: string;
    expediente?: { id: string; number: string; version: number };
    acts: Array<{ id: string; typeId: string; name: string }>;
    properties: Array<{
      relationId: string; predioId: string; actIds: string[]; version: number; label: string;
      description: string; landSurfaceM2: ISRMoney; constructionSurfaceM2: ISRMoney;
      commercialConstructionSurfaceM2: ISRMoney; cadastralValue: ISRMoney; appraisalValue: ISRMoney;
      operationValue: ISRMoney; ivaSuggested: boolean;
    }>;
    parties: Array<{
      relationId: string; comparecienteId: string; actId: string | null; role: string; name: string;
      personType: 'FISICA' | 'MORAL'; rfc: string; curp: string; nationality: string;
      fiscalResidence: 'MEXICO' | 'EXTRANJERO' | 'NO_CONFIRMADA'; participationPercentage: string;
      validated: boolean;
    }>;
  };
  iva?: { applies: boolean; suggestedFromProperty: boolean; reviewNote: string };
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
    appliesTo?: 'TERRENO' | 'CONSTRUCCION' | 'AMBOS';
    allocationRule?: {
      landPercentage: ISRMoney;
      constructionPercentage: ISRMoney;
      code: string;
      version: string;
      source: string;
      confirmed: boolean;
    };
    depreciateConstructionComponent?: boolean;
    depreciationRule?: {
      factor: ISRMoney;
      code: string;
      version: string;
      source: string;
      confirmed: boolean;
    };
  }>;
  exemptionTreatment: 'NO_APLICA_CONFIRMADO' | 'PENDIENTE_REVISION' | 'SOLICITADA';
  ordinaryCaseConfirmed: boolean;
  specialCases: Array<'COPROPIEDAD' | 'HERENCIA_DONACION' | 'PRESCRIPCION' | 'ADJUDICACION' | 'FIDEICOMISO' | 'PAGO_PARCIALIDADES' | 'FECHAS_SEPARADAS_TERRENO_CONSTRUCCION' | 'MULTIPLES_CONTRIBUYENTES' | 'MULTIPLES_INMUEBLES' | 'OTRO'>;
  /** Capacidades avanzadas del mismo motor canónico. Todas las reglas numéricas
   * deben llegar como snapshots verificados; nunca se derivan con IA. */
  components?: ISRPropertyComponent[];
  parties?: ISRPartyAllocation[];
  payments?: ISRPayment[];
  landExemption?: ISRLandExemptionInput;
  criteria?: ISRCalculationCriteria;
};

export type ISRPropertyComponent = {
  id: string;
  type: 'TERRENO' | 'CONSTRUCCION';
  saleValue: ISRMoney;
  surfaceM2?: ISRMoney;
  acquisitions: Array<{
    id: string;
    date: string;
    historicalAmount: ISRMoney;
    updatedAmount: ISRMoney;
    adjustmentMethod: 'MANUAL_CONFIRMED' | 'INPC' | 'FACTORES';
    factor?: ISRMoney;
    referenceCode?: string;
    source: string;
    confirmed: boolean;
  }>;
};

export type ISRPartyAllocation = {
  id: string;
  comparecienteId?: string;
  role: 'ENAJENANTE' | 'ADQUIRENTE';
  fullName: string;
  rfc?: string;
  curp?: string;
  personType: 'FISICA' | 'MORAL';
  fiscalResidence: 'MEXICO' | 'EXTRANJERO' | 'NO_CONFIRMADA';
  participationPercentage: ISRMoney;
  exemption?: { amount: ISRMoney; confirmed: boolean; source: string };
  foreignTreatment?: { rate: ISRMoney; ruleCode: string; source: string; confirmed: boolean };
};

export type ISRPayment = {
  id: string;
  paymentDate: string;
  paymentFormCode: string;
  monetaryInstrumentCode: string;
  currencyCode: string;
  amount: ISRMoney;
  financialInstitutionCode?: string;
  accountReference?: string;
  additionalDescription?: string;
  source: string;
};

export type ISRLandExemptionInput = {
  enabled: boolean;
  coveredAreaM2: ISRMoney;
  totalAreaM2: ISRMoney;
  exemptMultiplier: ISRMoney;
  ruleCode: string;
  ruleVersion: string;
  source: string;
  confirmed: boolean;
};

export type ISRCalculationCriteria = {
  adjustmentMethod: 'AUTO' | 'INPC' | 'FACTORES';
  resolvedAdjustmentMethod: 'MANUAL_CONFIRMED' | 'INPC' | 'FACTORES';
  tariffSelection: 'AUTO' | 'MANUAL_AUTHORIZED';
  landLossOffsetsConstructionGain: boolean;
  version: string;
  effectiveFrom: string;
  source: string;
  referenceCode: string;
  tariffRuleSetId?: string;
  authorizedBy?: string;
  authorizedAt?: string;
  reason?: string;
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
  referenceTables?: Array<{ id: string; type: string; code: string; version: number; effectiveFrom: string; effectiveTo: string | null; value: unknown; sourceTitle: string; sourceUrl: string }>;
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
  ruleSet: {
    id: string; key: string; version: string; sourceUrl: string; normativeSource: string;
    jurisdiction: string; validFrom: string; validTo: string;
  };
  capabilityMatrix: Array<{ key: string; label: string; status: 'SUPPORTED' | 'HUMAN_REVIEW_REQUIRED'; reason: string }>;
  breakdown: ISRBreakdownStep[];
  advanced?: {
    scenario: 'LEGACY_TOTAL' | 'TERRENO' | 'CONSTRUCCION' | 'TERRENO_CONSTRUCCION_MISMA_FECHA' | 'TERRENO_CONSTRUCCION_FECHAS_DIFERENTES';
    adjustedAcquisition: ISRMoney;
    components: Array<{ id: string; type: 'TERRENO' | 'CONSTRUCCION'; saleValue: ISRMoney; adjustedAcquisition: ISRMoney; allocatedDeductions: ISRMoney; gain: ISRMoney; acquisitionCount: number }>;
    criteria?: ISRCalculationCriteria;
    partyResults: Array<{ id: string; role: 'ENAJENANTE'; participationPercentage: ISRMoney; taxableIncome: ISRMoney; allocatedDeductions: ISRMoney; exemptIncome: ISRMoney; provisionalFederalISR: ISRMoney; treatment: 'DOMESTIC_TARIFF' | 'FOREIGN_WITHHOLDING' }>;
    landExemption?: { exemptAreaM2: ISRMoney; nonExemptAreaM2: ISRMoney; exemptRatio: ISRMoney; acquisitionNonExempt: ISRMoney; saleNonExempt: ISRMoney; ruleCode: string; ruleVersion: string; source: string };
    paymentTotal: ISRMoney;
    calculationTrace: Array<{ node: string; inputs: Record<string, string>; formula: string; rule: string; rounding: string; result: string }>;
  };
};

export class ISRValidationError extends Error {
  constructor(public readonly code: string, message: string, public readonly field?: string, public readonly status = 422) {
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

const decimalPercentTotal = (parties: ISRPartyAllocation[], role: ISRPartyAllocation['role']) => parties
  .filter((party) => party.role === role)
  .reduce((total, party) => total.plus(money(party.participationPercentage, `${role.toLowerCase()} participation`)), new Decimal(0));

const tariffFor = (base: Prisma.Decimal, rules: ISRRuleSetSnapshot) => {
  const bracket = rules.brackets.find((candidate) => {
    const lower = money(candidate.lower, 'límite inferior');
    const upper = candidate.upper === null ? null : money(candidate.upper, 'límite superior');
    return base.gte(lower) && (upper === null || base.lte(upper));
  });
  if (!bracket) throw new ISRValidationError('RATE_BRACKET_NOT_FOUND', 'No existe un rango de tarifa aplicable a la base determinada.');
  const lower = money(bracket.lower, 'límite inferior');
  const fixedFee = money(bracket.fixedFee, 'cuota fija');
  const rate = money(bracket.percentage, 'porcentaje').div(100);
  return { bracket, tax: fixedFee.plus(base.minus(lower).times(rate)), lower, fixedFee };
};

export function determineISRScenario(components: ISRPropertyComponent[] = []): NonNullable<ISRCalculationResult['advanced']>['scenario'] {
  if (!components.length) return 'LEGACY_TOTAL';
  const land = components.filter((item) => item.type === 'TERRENO');
  const construction = components.filter((item) => item.type === 'CONSTRUCCION');
  if (land.length && !construction.length) return 'TERRENO';
  if (!land.length && construction.length) return 'CONSTRUCCION';
  const dates = new Set(components.flatMap((item) => item.acquisitions.map((acquisition) => acquisition.date)));
  return dates.size <= 1 ? 'TERRENO_CONSTRUCCION_MISMA_FECHA' : 'TERRENO_CONSTRUCCION_FECHAS_DIFERENTES';
}

export function calculateLandExemption(input: ISRLandExemptionInput, acquisition: Prisma.Decimal.Value, sale: Prisma.Decimal.Value) {
  if (!input.enabled) return undefined;
  if (!input.confirmed || !input.ruleCode || !input.ruleVersion || !input.source) throw new ISRValidationError('LAND_EXEMPTION_RULE_REQUIRED', 'El área exenta requiere una regla versionada y confirmada.', 'landExemption');
  const covered = money(input.coveredAreaM2, 'área cubierta');
  const total = money(input.totalAreaM2, 'área total');
  const multiplier = money(input.exemptMultiplier, 'multiplicador de área exenta');
  if (covered.lt(0) || total.lte(0) || multiplier.lt(0) || covered.gt(total)) throw new ISRValidationError('LAND_EXEMPTION_AREA_INVALID', 'Confirma las superficies usadas para el área exenta.', 'landExemption');
  const exemptArea = Decimal.min(total, covered.times(multiplier));
  const nonExemptArea = total.minus(exemptArea);
  const ratio = nonExemptArea.div(total);
  return {
    exemptAreaM2: serialized(exemptArea), nonExemptAreaM2: serialized(nonExemptArea), exemptRatio: ratio.toFixed(8),
    acquisitionNonExempt: serialized(money(acquisition, 'adquisición').times(ratio)), saleNonExempt: serialized(money(sale, 'enajenación').times(ratio)),
    ruleCode: input.ruleCode, ruleVersion: input.ruleVersion, source: input.source,
  };
}

const validateSupportedCase = (input: ISRCalculationInput, rules: ISRRuleSetSnapshot) => {
  if (input.operationType !== 'ENAJENACION_INMUEBLE') throw new ISRValidationError('UNSUPPORTED_CASE', 'Cálculo no disponible para este supuesto.', 'operationType');
  if (input.taxYear !== rules.taxYear) throw new ISRValidationError('RULESET_NOT_FOUND', `No existe una tarifa confirmada para el ejercicio ${input.taxYear}.`, 'taxYear');
  const sellers = input.parties?.filter((party) => party.role === 'ENAJENANTE') || [];
  if (!sellers.length && (input.taxpayer.personType !== 'FISICA' || input.taxpayer.fiscalResidence !== 'MEXICO')) throw new ISRValidationError('UNSUPPORTED_CASE', 'Cálculo no disponible para este supuesto de contribuyente.', 'taxpayer');
  if (!sellers.length && (!input.taxpayer.confirmed || !input.taxpayer.fullName.trim() || !input.taxpayer.rfc.trim())) throw new ISRValidationError('MISSING_DATA', 'Confirma el nombre y RFC del contribuyente antes de calcular.', 'taxpayer');
  if (!input.ordinaryCaseConfirmed) throw new ISRValidationError('HUMAN_REVIEW_REQUIRED', 'Confirma que se trata de una operación ordinaria antes de calcular.', 'ordinaryCaseConfirmed');
  const confirmedPartyExemptions = Boolean(input.parties?.some((party) => party.role === 'ENAJENANTE' && party.exemption?.confirmed && party.exemption.source));
  const confirmedLandExemption = Boolean(input.landExemption?.enabled && input.landExemption.confirmed && input.landExemption.source && input.landExemption.ruleCode && input.landExemption.ruleVersion);
  if (input.exemptionTreatment !== 'NO_APLICA_CONFIRMADO' && !confirmedPartyExemptions && !confirmedLandExemption) throw new ISRValidationError('UNSUPPORTED_EXEMPTION', 'La exención requiere regla, fuente y confirmación humana antes de calcular.', 'exemptionTreatment');
  if (input.iva?.applies) throw new ISRValidationError('UNSUPPORTED_IVA_RULESET', 'La operación marcada con IVA requiere una regla normativa versionada que todavía no está disponible.', 'iva');
  const supportedAdvancedCases = new Set(['COPROPIEDAD', 'FECHAS_SEPARADAS_TERRENO_CONSTRUCCION', 'MULTIPLES_CONTRIBUYENTES', 'MULTIPLES_INMUEBLES']);
  if (input.specialCases.some((item) => !supportedAdvancedCases.has(item))) throw new ISRValidationError('UNSUPPORTED_CASE', 'Cálculo no disponible para este supuesto especial.', 'specialCases');
  if ((input.specialCases.includes('COPROPIEDAD') || input.specialCases.includes('MULTIPLES_CONTRIBUYENTES')) && (input.parties?.filter((party) => party.role === 'ENAJENANTE').length || 0) < 2) throw new ISRValidationError('PARTIES_REQUIRED', 'La copropiedad requiere capturar y validar a todos los enajenantes.', 'parties');
  if (!input.property.landAndConstructionSameAcquisitionDate && !(input.components?.length)) throw new ISRValidationError('UNSUPPORTED_CASE', 'Captura por separado terreno y construcción para calcular fechas distintas.', 'property');
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

  const components = input.components || [];
  if (input.criteria || components.length) {
    const criteria = input.criteria;
    const effectiveFrom = new Date(`${criteria?.effectiveFrom || ''}T00:00:00Z`);
    const saleDate = new Date(`${input.saleDate}T00:00:00Z`);
    if (!criteria || !criteria.version.trim() || !criteria.source.trim() || !criteria.referenceCode.trim() || !criteria.resolvedAdjustmentMethod || Number.isNaN(effectiveFrom.getTime()) || effectiveFrom > saleDate) {
      throw new ISRValidationError('CALCULATION_CRITERIA_REQUIRED', 'El desglose por componentes requiere un criterio versionado, vigente y con fuente verificable.', 'criteria');
    }
    if (criteria.tariffSelection === 'MANUAL_AUTHORIZED' && (!criteria.tariffRuleSetId || !criteria.authorizedBy || !criteria.authorizedAt || !criteria.reason?.trim())) {
      throw new ISRValidationError('MANUAL_TARIFF_AUTHORIZATION_REQUIRED', 'La tarifa manual requiere ruleset, autorización, fecha y motivo trazables.', 'criteria.tariffSelection');
    }
    if (criteria.tariffSelection === 'MANUAL_AUTHORIZED' && Number.isNaN(new Date(criteria.authorizedAt!).getTime())) throw new ISRValidationError('MANUAL_TARIFF_AUTHORIZATION_REQUIRED', 'La autorización de tarifa manual requiere una fecha válida.', 'criteria.authorizedAt');
  }
  let componentAcquisition = new Decimal(0);
  const componentResults: NonNullable<ISRCalculationResult['advanced']>['components'] = [];
  if (components.length) {
    const componentSale = components.reduce((sum, item) => sum.plus(money(item.saleValue, `valor de enajenación ${item.type}`)), new Decimal(0));
    if (!componentSale.eq(salePrice)) throw new ISRValidationError('COMPONENT_SALE_TOTAL_MISMATCH', 'La suma de terreno y construcción debe coincidir con el valor total de enajenación.', 'components');
    for (const component of components) {
      if (!component.id || !component.acquisitions.length) throw new ISRValidationError('ACQUISITION_REQUIRED', `Captura al menos una adquisición para ${component.type.toLowerCase()}.`, 'components');
      let adjusted = new Decimal(0);
      for (const acquisition of component.acquisitions) {
        const historical = money(acquisition.historicalAmount, 'valor histórico de adquisición');
        const updated = money(acquisition.updatedAmount, 'valor actualizado de adquisición');
        if (!acquisition.confirmed || !acquisition.date || !acquisition.source || historical.lt(0) || updated.lt(0)) throw new ISRValidationError('ACQUISITION_TRACE_REQUIRED', 'Cada adquisición requiere fecha, importes confirmados y fuente.', 'components');
        if (acquisition.adjustmentMethod !== 'MANUAL_CONFIRMED' && (!acquisition.factor || !acquisition.referenceCode)) throw new ISRValidationError('FISCAL_REFERENCE_REQUIRED', 'La actualización por INPC o factores requiere snapshot de tabla y factor.', 'components');
        if (acquisition.adjustmentMethod !== input.criteria?.resolvedAdjustmentMethod) {
          throw new ISRValidationError('ADJUSTMENT_METHOD_MISMATCH', `La adquisición no coincide con el método determinístico ${input.criteria?.resolvedAdjustmentMethod} resuelto por el criterio vigente.`, 'components');
        }
        if (acquisition.factor && !rounded(historical.times(money(acquisition.factor, 'factor'))).eq(rounded(updated))) throw new ISRValidationError('ACQUISITION_FACTOR_MISMATCH', 'El importe actualizado no coincide con el factor fiscal capturado.', 'components');
        adjusted = adjusted.plus(updated);
      }
      componentAcquisition = componentAcquisition.plus(adjusted);
      componentResults.push({ id: component.id, type: component.type, saleValue: serialized(money(component.saleValue, 'valor de componente')), adjustedAcquisition: serialized(adjusted), allocatedDeductions: '0.00', gain: serialized(money(component.saleValue, 'valor de componente').minus(adjusted)), acquisitionCount: component.acquisitions.length });
    }
  }

  let deductions = componentAcquisition;
  const allocatedByType = { TERRENO: new Decimal(0), CONSTRUCCION: new Decimal(0) };
  for (const item of input.deductions) {
    const historicalAmount = money(item.historicalAmount, `importe histórico de ${item.concept || 'deducción'}`);
    const updatedAmount = money(item.updatedAmount, `importe actualizado de ${item.concept || 'deducción'}`);
    if (historicalAmount.lt(0) || updatedAmount.lt(0)) throw new ISRValidationError('INVALID_AMOUNT', 'Las deducciones no pueden ser negativas.', `deductions.${item.id}`);
    if (!item.included) continue;
    if (components.length && item.treatment === 'COSTO_ADQUISICION_ACTUALIZADO') throw new ISRValidationError('DUPLICATE_ACQUISITION_COST', 'El costo de adquisición ya está desglosado por componentes.', `deductions.${item.id}`);
    if (!item.confirmed || item.treatment === 'REQUIERE_REVISION') throw new ISRValidationError('HUMAN_REVIEW_REQUIRED', `Confirma el tratamiento fiscal de “${item.concept}”.`, `deductions.${item.id}`);
    if (item.treatment === 'NO_DEDUCIBLE') throw new ISRValidationError('INVALID_DEDUCTION', `“${item.concept}” no puede incluirse como deducción.`, `deductions.${item.id}`);
    if (!item.concept.trim() || !item.expenseDate || !item.updateMethod.trim() || !item.supportDocumentId.trim() || !item.reason.trim() || !item.confirmedBy.trim() || !item.confirmedAt) {
      throw new ISRValidationError('MISSING_DEDUCTION_TRACE', `Completa la trazabilidad de “${item.concept || 'la deducción'}” antes de incluirla.`, `deductions.${item.id}`);
    }
    const expenseDate = new Date(`${item.expenseDate}T00:00:00Z`);
    const confirmedAt = new Date(item.confirmedAt);
    if (Number.isNaN(expenseDate.getTime()) || Number.isNaN(confirmedAt.getTime())) throw new ISRValidationError('INVALID_DEDUCTION_TRACE_DATE', `Confirma las fechas de trazabilidad de “${item.concept}”.`, `deductions.${item.id}`);
    if (item.updateOrigin !== 'MANUAL_CONFIRMED' && !item.updateMethod.match(/(?:INPC|FACTOR).*(?:VERSION|FUENTE|CÓDIGO)/i)) {
      throw new ISRValidationError('UNSUPPORTED_DEDUCTION_UPDATE', 'La actualización normativa requiere método, versión y fuente trazables.', `deductions.${item.id}.updateOrigin`);
    }
    if (components.length) {
      if (!item.appliesTo) throw new ISRValidationError('DEDUCTION_COMPONENT_REQUIRED', `Indica si “${item.concept}” corresponde a terreno, construcción o ambos.`, `deductions.${item.id}.appliesTo`);
      const hasLand = componentResults.some((entry) => entry.type === 'TERRENO');
      const hasConstruction = componentResults.some((entry) => entry.type === 'CONSTRUCCION');
      if ((item.appliesTo === 'TERRENO' && !hasLand) || (item.appliesTo === 'CONSTRUCCION' && !hasConstruction) || (item.appliesTo === 'AMBOS' && (!hasLand || !hasConstruction))) {
        throw new ISRValidationError('DEDUCTION_COMPONENT_NOT_PRESENT', `El alcance de “${item.concept}” no coincide con los componentes capturados.`, `deductions.${item.id}.appliesTo`);
      }
      if (item.depreciateConstructionComponent) {
        const depreciation = item.depreciationRule;
        if (!depreciation?.confirmed || !depreciation.code || !depreciation.version || !depreciation.source || !depreciation.factor) {
          throw new ISRValidationError('DEPRECIATION_RULE_REQUIRED', 'La depreciación de construcción requiere factor, regla, versión, fuente y confirmación.', `deductions.${item.id}.depreciationRule`);
        }
        if (item.appliesTo !== 'CONSTRUCCION') throw new ISRValidationError('DEPRECIATION_SCOPE_INVALID', 'La depreciación debe aplicarse exclusivamente a la porción de construcción.', `deductions.${item.id}.appliesTo`);
        if (!rounded(historicalAmount.times(money(depreciation.factor, 'factor de depreciación'))).eq(rounded(updatedAmount))) {
          throw new ISRValidationError('DEPRECIATION_FACTOR_MISMATCH', 'El importe actualizado no coincide con el factor de depreciación confirmado.', `deductions.${item.id}.depreciationRule`);
        }
      }
      if (item.appliesTo === 'AMBOS' && componentResults.some((entry) => entry.type === 'TERRENO') && componentResults.some((entry) => entry.type === 'CONSTRUCCION')) {
        const allocation = item.allocationRule;
        if (!allocation?.confirmed || !allocation.code || !allocation.version || !allocation.source) throw new ISRValidationError('DEDUCTION_ALLOCATION_RULE_REQUIRED', 'La deducción aplicable a ambos componentes requiere una regla de distribución versionada y confirmada.', `deductions.${item.id}.allocationRule`);
        const landPercentage = money(allocation.landPercentage, 'porcentaje terreno');
        const constructionPercentage = money(allocation.constructionPercentage, 'porcentaje construcción');
        if (!landPercentage.plus(constructionPercentage).eq(100) || landPercentage.lt(0) || constructionPercentage.lt(0)) throw new ISRValidationError('DEDUCTION_ALLOCATION_INVALID', 'La distribución entre terreno y construcción debe sumar exactamente 100%.', `deductions.${item.id}.allocationRule`);
        allocatedByType.TERRENO = allocatedByType.TERRENO.plus(updatedAmount.times(landPercentage).div(100));
        allocatedByType.CONSTRUCCION = allocatedByType.CONSTRUCCION.plus(updatedAmount.times(constructionPercentage).div(100));
      } else if (item.appliesTo === 'TERRENO') allocatedByType.TERRENO = allocatedByType.TERRENO.plus(updatedAmount);
      else if (item.appliesTo === 'CONSTRUCCION') allocatedByType.CONSTRUCCION = allocatedByType.CONSTRUCCION.plus(updatedAmount);
      else {
        const onlyType = componentResults[0]?.type;
        if (onlyType) allocatedByType[onlyType] = allocatedByType[onlyType].plus(updatedAmount);
      }
    }
    deductions = deductions.plus(updatedAmount);
  }
  if (components.length) {
    for (const result of componentResults) {
      const allocated = allocatedByType[result.type];
      result.allocatedDeductions = serialized(allocated);
      result.gain = serialized(money(result.saleValue, 'valor de componente').minus(money(result.adjustedAcquisition, 'adquisición ajustada')).minus(allocated));
    }
    if (input.criteria?.landLossOffsetsConstructionGain === false) {
      deductions = componentResults.reduce((sum, result) => {
        const componentDeduction = money(result.adjustedAcquisition, 'adquisición ajustada').plus(money(result.allocatedDeductions, 'deducciones asignadas'));
        return sum.plus(Decimal.min(money(result.saleValue, 'valor de componente'), componentDeduction));
      }, new Decimal(0));
    }
  }
  if (input.parties?.length) {
    const sellerTotal = decimalPercentTotal(input.parties, 'ENAJENANTE');
    const buyers = input.parties.filter((party) => party.role === 'ADQUIRENTE');
    if (!sellerTotal.eq(100)) throw new ISRValidationError('SELLER_PERCENTAGE_INVALID', 'Las participaciones de enajenantes deben sumar exactamente 100%.', 'parties');
    if (buyers.length && !decimalPercentTotal(input.parties, 'ADQUIRENTE').eq(100)) throw new ISRValidationError('BUYER_PERCENTAGE_INVALID', 'Las participaciones de adquirentes deben sumar exactamente 100%.', 'parties');
    for (const party of input.parties) {
      if (!party.fullName.trim()) throw new ISRValidationError('PARTY_NAME_REQUIRED', 'Cada parte requiere identidad vinculada o confirmada.', 'parties');
      if ((!party.rfc || !party.rfc.trim()) && party.role === 'ENAJENANTE') throw new ISRValidationError('PARTY_RFC_REQUIRED', 'Falta RFC del enajenante; PRAVIA no generará uno ficticio.', 'parties');
      if (party.fiscalResidence === 'EXTRANJERO' && (!party.foreignTreatment?.confirmed || !party.foreignTreatment.source || !party.foreignTreatment.ruleCode)) throw new ISRValidationError('FOREIGN_TREATMENT_REQUIRED', 'El enajenante extranjero requiere tratamiento fiscal confirmado y fuente vigente.', 'parties');
    }
  }

  const land = componentResults.filter((item) => item.type === 'TERRENO');
  const landAcquisition = land.reduce((sum, item) => sum.plus(item.adjustedAcquisition), new Decimal(0));
  const landSale = land.reduce((sum, item) => sum.plus(item.saleValue), new Decimal(0));
  const landExemption = input.landExemption ? calculateLandExemption(input.landExemption, landAcquisition, landSale) : undefined;
  const areaExemptIncome = landExemption ? landSale.minus(money(landExemption.saleNonExempt, 'venta no exenta')) : new Decimal(0);
  const partyExemptIncome = (input.parties || []).filter((party) => party.role === 'ENAJENANTE' && party.exemption?.confirmed).reduce((sum, party) => sum.plus(money(party.exemption!.amount, 'exención por enajenante')), new Decimal(0));
  const totalExemptIncome = areaExemptIncome.plus(partyExemptIncome);
  const taxableSalePrice = salePrice.minus(totalExemptIncome);
  if (taxableSalePrice.lt(0)) throw new ISRValidationError('EXEMPTION_EXCEEDS_INCOME', 'Las exenciones confirmadas exceden el ingreso de la operación.', 'parties');
  if (deductions.gte(taxableSalePrice)) throw new ISRValidationError('LOSS_REVIEW_REQUIRED', 'La operación determina una ganancia nula o pérdida y requiere revisión fiscal específica.', 'deductions');

  const gain = taxableSalePrice.minus(deductions);
  const years = Math.min(input.yearsElapsed, rules.yearsCap);
  const tariffBase = gain.div(years);
  const tariff = tariffFor(tariffBase, rules);
  const { bracket, lower, fixedFee } = tariff;
  const tariffTax = tariff.tax;
  const provisionalRaw = tariffTax.times(years);
  let provisional = rounded(provisionalRaw);

  const partyResults: NonNullable<ISRCalculationResult['advanced']>['partyResults'] = [];
  const sellers = (input.parties || []).filter((party) => party.role === 'ENAJENANTE');
  if (sellers.length) {
    provisional = new Decimal(0);
    for (const party of sellers) {
      const share = money(party.participationPercentage, 'participación').div(100);
      const partyTaxable = taxableSalePrice.times(share);
      const partyDeduction = deductions.times(share);
      const partyGain = Decimal.max(new Decimal(0), partyTaxable.minus(partyDeduction));
      let tax: Prisma.Decimal; let treatment: 'DOMESTIC_TARIFF' | 'FOREIGN_WITHHOLDING';
      if (party.fiscalResidence === 'EXTRANJERO') {
        tax = partyTaxable.times(money(party.foreignTreatment!.rate, 'tasa de retención extranjera').div(100)); treatment = 'FOREIGN_WITHHOLDING';
      } else {
        const base = partyGain.div(years); tax = tariffFor(base, rules).tax.times(years); treatment = 'DOMESTIC_TARIFF';
      }
      provisional = provisional.plus(rounded(tax));
      partyResults.push({ id: party.id, role: 'ENAJENANTE', participationPercentage: serialized(share.times(100)), taxableIncome: serialized(partyTaxable), allocatedDeductions: serialized(partyDeduction), exemptIncome: serialized(money(party.exemption?.amount || 0, 'exención')), provisionalFederalISR: serialized(tax), treatment });
    }
  }

  const paymentTotal = (input.payments || []).reduce((sum, payment) => {
    if (!payment.id || !payment.paymentDate || !payment.paymentFormCode || !payment.monetaryInstrumentCode || !payment.currencyCode || !payment.source) throw new ISRValidationError('PAYMENT_TRACE_REQUIRED', 'Cada liquidación requiere fecha, catálogos controlados, importe y fuente.', 'payments');
    return sum.plus(money(payment.amount, 'importe de pago'));
  }, new Decimal(0));

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
    taxableIncome: serialized(taxableSalePrice), exemptIncome: serialized(totalExemptIncome), consideredDeductions: serialized(deductions), gain: serialized(gain),
    yearsConsidered: years, tariffBase: serialized(tariffBase), bracket, provisionalFederalISR: serialized(provisional),
    calculationPrecision: { tariffTaxRaw: tariffTax.toFixed(5), provisionalFederalISRRaw: provisionalRaw.toFixed(5) },
    ruleSet: {
      id: rules.id, key: rules.key, version: rules.version, sourceUrl: rules.sourceUrl,
      normativeSource: rules.normativeSource, jurisdiction: rules.jurisdiction,
      validFrom: rules.validFrom, validTo: rules.validTo,
    },
    capabilityMatrix: ISR_NORMATIVE_MATRIX,
    breakdown,
    advanced: components.length || sellers.length || input.payments?.length || input.landExemption || input.criteria ? {
      scenario: determineISRScenario(components), adjustedAcquisition: serialized(componentAcquisition), components: componentResults, criteria: input.criteria, partyResults,
      landExemption, paymentTotal: serialized(paymentTotal),
      calculationTrace: [
        { node: 'taxable-income', inputs: { salePrice: serialized(salePrice), exemptIncome: serialized(totalExemptIncome) }, formula: 'salePrice - exemptIncome', rule: landExemption?.ruleCode || 'LISR-119', rounding: rules.rounding, result: serialized(taxableSalePrice) },
        { node: 'gain', inputs: { taxableIncome: serialized(taxableSalePrice), deductions: serialized(deductions) }, formula: 'taxableIncome - deductions', rule: 'LISR-121', rounding: rules.rounding, result: serialized(gain) },
        ...(input.criteria ? [{ node: 'criteria', inputs: { adjustmentMethod: input.criteria.adjustmentMethod, resolvedAdjustmentMethod: input.criteria.resolvedAdjustmentMethod, tariffSelection: input.criteria.tariffSelection, landLossOffsetsConstructionGain: String(input.criteria.landLossOffsetsConstructionGain) }, formula: 'apply versioned calculation policy', rule: `${input.criteria.referenceCode}@${input.criteria.version}`, rounding: rules.rounding, result: input.criteria.source }] : []),
        { node: 'federal-provisional', inputs: { gain: serialized(gain), years: String(years) }, formula: sellers.length ? 'sum(party deterministic result)' : 'tariff(gain / years) * years', rule: rules.version, rounding: rules.rounding, result: serialized(provisional) },
      ],
    } : undefined,
  };
}

/** Matriz explícita del alcance validado. No contiene ni ejecuta fórmulas. */
export const ISR_NORMATIVE_MATRIX: ISRCalculationResult['capabilityMatrix'] = [
  { key: 'ISR_ENAJENACION_ART126', label: 'ISR por enajenación · pago provisional federal', status: 'SUPPORTED', reason: 'LISR 119, 121 y 126; Anexo 8 RMF 2026 A.I, versión 2026.1.' },
  { key: 'ISR_ADQUISICION', label: 'ISR por adquisición', status: 'HUMAN_REVIEW_REQUIRED', reason: 'No existe un ruleset aprobado en el repositorio para determinarlo.' },
  { key: 'IVA_INMUEBLE', label: 'IVA de la operación inmobiliaria', status: 'HUMAN_REVIEW_REQUIRED', reason: 'No existe un ruleset aprobado en el repositorio para determinarlo.' },
  { key: 'LISR_ART127_STATE_PAYMENT', label: 'Pago a la entidad federativa', status: 'HUMAN_REVIEW_REQUIRED', reason: 'El motor canónico declara expresamente este componente fuera de alcance.' },
  { key: 'MULTIPLE_TAXPAYERS', label: 'Distribución entre múltiples contribuyentes', status: 'SUPPORTED', reason: 'Distribución Decimal por enajenante confirmado; la suma de participaciones debe ser exactamente 100%.' },
  { key: 'FOREIGN_TAX_TREATMENT', label: 'Tratamiento de residencia fiscal extranjera', status: 'SUPPORTED', reason: 'Disponible únicamente con tratamiento, tasa, regla y fuente versionada expresamente confirmados; en otro caso se bloquea.' },
];

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
