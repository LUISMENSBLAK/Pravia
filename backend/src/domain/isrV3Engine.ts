import { Prisma } from '@prisma/client';
import type { ISRRateBracket, ISRRuleSetSnapshot } from './isrTaxEngine';
import { fullFiscalYears, updateISRAcquisition, type ISRAcquisitionHistorical } from './isrAcquisitionUpdate';

const Decimal = Prisma.Decimal;
export const ISR_V3_CALCULATION_REVISION = '2026-11-21.2';

export type ISRV3LegalStatus =
  | 'GRAVADO'
  | 'EXENTO'
  | 'EXENTO_PARCIALMENTE'
  | 'NO_GENERADO'
  | 'NO_APLICA'
  | 'PENDIENTE_INFORMACION';

export type ISRV3SubjectType = 'PF' | 'PM_TITULO_II' | 'PM_TITULO_III' | 'OTRO';
export type ISRV3FiscalResidence = 'MEXICO' | 'EXTRANJERO' | 'POR_DETERMINAR';
export type ISRV3PropertyType =
  | 'TERRENO'
  | 'CASA_HABITACION'
  | 'TERRENO_CONSTRUCCION'
  | 'CONSTRUCCION_COMERCIAL'
  | 'USO_MIXTO'
  | 'OTRO';

export type ISRV3AcquisitionLayer = {
  id: string;
  percentage: string;
  acquisitionAct: 'ONEROSA' | 'HERENCIA' | 'DONACION' | 'OTRO';
  legalDate: string;
  fiscalDate: string;
  adjustedLandCost: string;
  adjustedConstructionCost: string;
  source: string;
  priorLayerId?: string;
  verified: boolean;
  historical?: ISRAcquisitionHistorical;
};

export type ISRV3Party = {
  id: string;
  role: 'ENAJENANTE' | 'ADQUIRENTE';
  name: string;
  rfc?: string;
  curp?: string;
  sourceComparecienteId?: string;
  subjectType: ISRV3SubjectType;
  nationalityCode: string;
  immigrationStatus?: string;
  fiscalResidence: ISRV3FiscalResidence;
  percentage: string;
  acquisitionLayers?: ISRV3AcquisitionLayer[];
  foreignGainOption?: { requested: boolean; requirementsVerified: boolean; source: string };
  acquisitionExemption?: { applies: boolean; legalReference: string; verified: boolean };
  homeExemption?: {
    requested: boolean;
    homeUseVerified: boolean;
    requiredDocumentsVerified: boolean;
    noExemptionInPriorThreeYearsVerified: boolean;
  };
};

export type ISRV3Input = {
  schemaVersion: 3;
  taxYear: number;
  operationDate: string;
  act: { id?: string; name: string; fiscalClassification: 'COMPRAVENTA' | 'PERMUTA' | 'DACION_PAGO' | 'ADJUDICACION' | 'DONACION' | 'FIDEICOMISO' | 'APORTACION' | 'OTRO'; otherDescription?: string };
  property: {
    type: ISRV3PropertyType;
    otherDescription?: string;
    sameAcquisitionDate: boolean;
    mixedTaxablePercentage?: string;
  };
  values: {
    operation: string;
    appraisal: string;
    cadastral: string;
    landSale: string;
    constructionSale: string;
  };
  calculateIVA: boolean;
  parties: ISRV3Party[];
  deductions: Array<{
    id: string;
    concept: string;
    amount: string;
    paidByPartyId?: string;
    component: 'TERRENO' | 'CONSTRUCCION' | 'AMBOS';
    verified: boolean;
    supportDocumentId?: string;
  }>;
};

export type ISRV3RuleParameter = {
  value: string;
  ruleId: string;
  legalReference: string;
  ruleVersion: string;
  sourceUrl: string;
};

export type ISRV3RuleSnapshot = {
  engineVersion: 'ISR-V3.0';
  calculationRevision?: string;
  effectiveDate: string;
  saleRuleSet: ISRRuleSetSnapshot;
  foreignGrossRate?: ISRV3RuleParameter;
  foreignGainRate?: ISRV3RuleParameter;
  acquisitionThresholdPercent?: ISRV3RuleParameter;
  acquisitionRate?: ISRV3RuleParameter;
  ivaGeneralRate?: ISRV3RuleParameter;
  homeExemptionLimitPesos?: ISRV3RuleParameter;
  minimumAcquisitionPercent?: ISRV3RuleParameter;
  statePaymentRate?: ISRV3RuleParameter;
};

export type ISRV3Trace = {
  ruleId: string;
  legalReference: string;
  ruleVersion: string;
  inputsUsed: Record<string, string>;
  calculation: string;
  result: string;
  explanation: string;
};

export type ISRV3PartyResult = {
  partyId: string;
  partyName: string;
  status: ISRV3LegalStatus;
  amount: string | null;
  taxableBase: string | null;
  exemptAmount: string | null;
  route: string;
  reason: string;
  missing: string[];
  traces: ISRV3Trace[];
  acquisitionWorksheet?: { updatedCost: string; minimumCost: string; appliedCost: string; appliedDeductions: string; taxableRatio: string };
  distribution?: { status: 'DETERMINADO' | 'PENDIENTE_INFORMACION' | 'NO_APLICA'; statePayment: string | null; federalRemainder: string | null; reason: string; traces: ISRV3Trace[] };
};

export type ISRV3Result = {
  schemaVersion: 3;
  engineVersion: 'ISR-V3.0';
  calculationRevision?: string;
  ruleVersion: string;
  currency: 'MXN';
  saleISR: ISRV3PartyResult[];
  acquisitionISR: ISRV3PartyResult[];
  iva: {
    status: ISRV3LegalStatus;
    taxableBase: string | null;
    rate: string | null;
    amount: string | null;
    reason: string;
    missing: string[];
    traces: ISRV3Trace[];
  };
  missing: string[];
  breakdown: Array<{ key: string; label: string; operation: string; amount: string; source: string }>;
};

const money = (value: string | number | Prisma.Decimal, label: string) => {
  try {
    const parsed = new Decimal(value || 0);
    if (!parsed.isFinite() || parsed.lt(0)) throw new Error();
    return parsed;
  } catch {
    throw new Error(`${label} debe ser un importe no negativo.`);
  }
};

const percent = (value: string, label: string) => {
  const parsed = money(value, label);
  if (parsed.gt(100)) throw new Error(`${label} no puede exceder 100%.`);
  return parsed;
};

const rounded = (value: Prisma.Decimal) => value.toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
const serialized = (value: Prisma.Decimal) => rounded(value).toFixed(2);

const trace = (
  parameter: Pick<ISRV3RuleParameter, 'ruleId' | 'legalReference' | 'ruleVersion'>,
  inputsUsed: Record<string, string>,
  calculation: string,
  result: Prisma.Decimal | string,
  explanation: string,
): ISRV3Trace => ({
  ...parameter,
  inputsUsed,
  calculation,
  result: typeof result === 'string' ? result : serialized(result),
  explanation,
});

const tariffTax = (base: Prisma.Decimal, brackets: ISRRateBracket[]) => {
  const bracket = brackets.find((item) => base.gte(item.lower) && (item.upper === null || base.lte(item.upper)));
  if (!bracket) throw new Error('No existe un tramo de tarifa vigente para la base determinada.');
  return new Decimal(bracket.fixedFee).plus(base.minus(bracket.lower).times(new Decimal(bracket.percentage).div(100)));
};

const pending = (party: ISRV3Party, route: string, missing: string[]): ISRV3PartyResult => ({
  partyId: party.id,
  partyName: party.name,
  status: 'PENDIENTE_INFORMACION',
  amount: null,
  taxableBase: null,
  exemptAmount: null,
  route,
  reason: `Falta información verificable: ${missing.join(', ')}.`,
  missing,
  traces: [],
});

const noAplica = (party: ISRV3Party, route: string, reason: string): ISRV3PartyResult => ({
  partyId: party.id, partyName: party.name, status: 'NO_APLICA', amount: null,
  taxableBase: null, exemptAmount: null, route, reason, missing: [], traces: [],
});

const acquisitionCost = (party: ISRV3Party, operationDate: string, rules: ISRV3RuleSnapshot, propertyIsLand: boolean) => {
  const layers = party.acquisitionLayers || [];
  const missing: string[] = [];
  if (!layers.length) missing.push(`capas de adquisición de ${party.name}`);
  let totalPercentage = new Decimal(0);
  let total = new Decimal(0);
  let earliest: Date | undefined;
  const traces: ISRV3Trace[] = [];
  const operation = new Date(`${operationDate}T00:00:00Z`);
  for (const layer of layers) {
    if (!layer.verified) missing.push(`verificación de la capa ${layer.id}`);
    if (!['ONEROSA', 'HERENCIA', 'DONACION', 'OTRO'].includes(layer.acquisitionAct)) missing.push(`acto de adquisición válido de la capa ${layer.id}`);
    if (!layer.fiscalDate) missing.push(`fecha fiscal de la capa ${layer.id}`);
    if (!layer.source.trim()) missing.push(`fuente de la capa ${layer.id}`);
    if ((layer.acquisitionAct === 'HERENCIA' || layer.acquisitionAct === 'DONACION') && !layer.priorLayerId) missing.push(`antecedente encadenado de la capa ${layer.id}`);
    const layerDate = layer.fiscalDate ? new Date(`${layer.fiscalDate}T00:00:00Z`) : undefined;
    if (layerDate && (!Number.isFinite(layerDate.getTime()) || layerDate > operation || layerDate.toISOString().slice(0, 10) !== layer.fiscalDate)) missing.push(`fecha fiscal válida de la capa ${layer.id}`);
    if (layerDate && (!earliest || layerDate < earliest)) earliest = layerDate;
    totalPercentage = totalPercentage.plus(percent(layer.percentage, `porcentaje de la capa ${layer.id}`));
    if (layer.historical) {
      const updated = updateISRAcquisition({ historical: layer.historical, acquisitionDate: layer.fiscalDate, operationDate, propertyIsLand, references: rules.saleRuleSet.referenceTables || [] });
      missing.push(...updated.missing.map((item) => `${item} · capa ${layer.id}`));
      if (updated.land !== null && updated.construction !== null) total = total.plus(updated.land).plus(updated.construction);
      for (const alternative of updated.alternatives) traces.push({ ruleId: alternative.referenceCode, legalReference: alternative.source, ruleVersion: String(alternative.referenceVersion),
        inputsUsed: { ...updated.inputs, factor: alternative.factor, method: alternative.method, layerId: layer.id }, calculation: 'base histórica actualizable × factor verificado', result: alternative.total,
        explanation: alternative.method === updated.chosenMethod ? 'Alternativa seleccionada por el método confirmado.' : 'Alternativa evaluada; no seleccionada.' });
    } else {
      if (!String(layer.adjustedLandCost ?? '').trim() || !String(layer.adjustedConstructionCost ?? '').trim()) missing.push(`costos explícitos de la capa ${layer.id} (cero cuando corresponda)`);
      total = total.plus(money(layer.adjustedLandCost, 'costo de terreno')).plus(money(layer.adjustedConstructionCost, 'costo de construcción'));
    }
  }
  const sellerPercentage = percent(party.percentage, `porcentaje de ${party.name}`);
  if (layers.length && !totalPercentage.eq(sellerPercentage)) missing.push(`capas de ${party.name} deben sumar ${sellerPercentage.toFixed()}%`);
  if (new Set(layers.map((layer) => layer.fiscalDate).filter(Boolean)).size > 1) missing.push(`criterio verificado de distribución de ganancia por fechas de adquisición distintas de ${party.name}; no se aplica a toda la ganancia la fecha más antigua`);
  return { total, earliest, missing, traces };
};

const distribution = (party: ISRV3Party, tax: Prisma.Decimal, gain: Prisma.Decimal, rules: ISRV3RuleSnapshot): NonNullable<ISRV3PartyResult['distribution']> => {
  if (party.fiscalResidence !== 'MEXICO') return { status: 'NO_APLICA', statePayment: null, federalRemainder: null, reason: 'Esta distribución no aplica automáticamente a la ruta de residentes en el extranjero.', traces: [] };
  if (!rules.statePaymentRate) return { status: 'PENDIENTE_INFORMACION', statePayment: null, federalRemainder: null, reason: 'Falta la tasa verificada y vigente LISR127_STATE_RATE.', traces: [] };
  const rate = percent(rules.statePaymentRate.value, 'tasa entidad federativa');
  const state = Decimal.min(rounded(tax), rounded(Decimal.max(new Decimal(0), gain).times(rate.div(100))));
  const federal = rounded(tax).minus(state);
  return { status: 'DETERMINADO', statePayment: serialized(state), federalRemainder: serialized(federal), reason: 'Pago a entidad federativa acreditable, limitado al pago provisional determinado; no se suma como un segundo ISR.',
    traces: [trace(rules.statePaymentRate, { ganancia: serialized(gain), tasa: rate.toFixed(), isrDeterminado: serialized(tax) }, 'min(ISR determinado, ganancia × tasa / 100); remanente = ISR − pago entidad', state, 'Distribución LISR 127; conserva la suma exacta del pago provisional.')] };
};

const calculateSale = (input: ISRV3Input, rules: ISRV3RuleSnapshot, party: ISRV3Party): ISRV3PartyResult => {
  if (party.subjectType === 'PM_TITULO_II' || party.subjectType === 'PM_TITULO_III') {
    return noAplica(party, 'PERSONA_MORAL', 'La herramienta notarial v3 no aplica automáticamente la ruta de persona física a una persona moral.');
  }
  if (party.subjectType !== 'PF') return pending(party, 'SUJETO_NO_CLASIFICADO', [`clasificación fiscal de ${party.name}`]);
  if (party.fiscalResidence === 'POR_DETERMINAR') return pending(party, 'RESIDENCIA_POR_DETERMINAR', [`residencia fiscal de ${party.name}`]);

  const share = percent(party.percentage, `porcentaje de ${party.name}`).div(100);
  const gross = money(input.values.operation, 'valor de operación').times(share);
  // LISR 160: the gross-income route has no deductions. Missing acquisition
  // evidence must not accidentally turn it into a gain-based calculation.
  if (party.fiscalResidence === 'EXTRANJERO' && !party.foreignGainOption?.requested) {
    if (!rules.foreignGrossRate) return pending(party, 'EXTRANJERO_INGRESO_BRUTO', ['tasa vigente verificada de LISR 160']);
    const rate = new Decimal(rules.foreignGrossRate.value);
    const tax = gross.times(rate.div(100));
    return {
      partyId: party.id, partyName: party.name, status: 'GRAVADO', amount: serialized(tax), taxableBase: serialized(gross), exemptAmount: '0.00',
      route: 'EXTRANJERO_INGRESO_BRUTO', reason: 'Retención sobre ingreso bruto conforme a la regla vigente verificada.', missing: [],
      traces: [trace(rules.foreignGrossRate, { ingresoBruto: serialized(gross), tasa: rate.toFixed() }, 'ingresoBruto × tasa / 100', tax, 'Ruta sobre ingreso bruto para residente en el extranjero.')],
    };
  }
  if (party.fiscalResidence === 'EXTRANJERO' && !party.foreignGainOption?.requirementsVerified) {
    return pending(party, 'EXTRANJERO_OPCION_GANANCIA', ['requisitos verificados para opción sobre ganancia']);
  }
  if (party.fiscalResidence === 'EXTRANJERO' && !party.foreignGainOption?.source.trim()) return pending(party, 'EXTRANJERO_OPCION_GANANCIA', ['fuente de verificación de la opción sobre ganancia']);
  if (party.fiscalResidence === 'EXTRANJERO' && !rules.foreignGainRate) return pending(party, 'EXTRANJERO_OPCION_GANANCIA', ['tasa máxima vigente verificada de LISR 152 para LISR 160']);
  let exempt = new Decimal(0);
  const exemptionTraces: ISRV3Trace[] = [];
  if (party.homeExemption?.requested) {
    const home = party.homeExemption;
    const missing = [
      input.property.type !== 'CASA_HABITACION' && 'clasificación acreditada como casa habitación',
      party.fiscalResidence !== 'MEXICO' && 'procedencia verificada de la exención en la ruta fiscal del contribuyente',
      !home.homeUseVerified && 'uso casa habitación',
      !home.requiredDocumentsVerified && 'documentación de casa habitación',
      !home.noExemptionInPriorThreeYearsVerified && 'antecedente temporal de exención',
      !rules.homeExemptionLimitPesos && 'límite UDI vigente convertido a pesos',
    ].filter(Boolean) as string[];
    if (missing.length) return pending(party, 'EXENCION_CASA_HABITACION', missing);
    const limit = new Decimal(rules.homeExemptionLimitPesos!.value).times(share);
    exempt = Decimal.min(gross, limit);
    exemptionTraces.push(trace(rules.homeExemptionLimitPesos!, { ingreso: serialized(gross), limiteParticipacion: serialized(limit) }, 'min(ingreso, límite × participación)', exempt, 'Exención de casa habitación limitada por participación y parámetro UDI vigente.'));
  }

  if (exempt.eq(gross)) return {
    partyId: party.id, partyName: party.name, status: 'EXENTO', amount: '0.00', taxableBase: '0.00', exemptAmount: serialized(exempt), route: 'EXENCION_CASA_HABITACION',
    reason: 'Ingreso totalmente exento con requisitos confirmados; no se requirieron deducciones para obtener este resultado.', missing: [], traces: exemptionTraces,
    distribution: distribution(party, new Decimal(0), new Decimal(0), rules),
  };
  const costs = acquisitionCost(party, input.operationDate, rules, input.property.type === 'TERRENO');
  if (costs.missing.length) return pending(party, party.fiscalResidence === 'EXTRANJERO' ? 'EXTRANJERO' : 'PF_MEXICO', costs.missing);
  const applicableDeductions = input.deductions.filter((item) => !item.paidByPartyId || item.paidByPartyId === party.id);
  const unverified = applicableDeductions.filter((item) => !item.verified);
  if (unverified.length) return pending(party, 'DEDUCCIONES_POR_CONFIRMAR', unverified.map((item) => `verificación de deducción ${item.concept || item.id}`));
  // Common deductions are allocated once; explicitly assigned ones only to payer.
  const partyDeductions = applicableDeductions.reduce((sum, item) => sum.plus(money(item.amount, item.concept).times(item.paidByPartyId ? 1 : share)), new Decimal(0));

  const taxableIncome = gross.minus(exempt);
  if (!rules.minimumAcquisitionPercent) return pending(party, 'COSTO_MINIMO_POR_VERIFICAR', ['porcentaje de costo mínimo LISR121_MIN_ACQUISITION_PERCENT verificado']);
  const minimumCost = gross.times(percent(rules.minimumAcquisitionPercent.value, 'porcentaje de costo mínimo').div(100));
  const deductibleCost = Decimal.max(costs.total, minimumCost);
  const taxableRatio = gross.eq(0) ? new Decimal(0) : taxableIncome.div(gross);
  const gain = taxableIncome.minus(deductibleCost.times(taxableRatio)).minus(partyDeductions.times(taxableRatio));
  const costTraces = [...costs.traces, trace(rules.minimumAcquisitionPercent, { costoActualizado: serialized(costs.total), costoMinimo: serialized(minimumCost), proporcionGravada: taxableRatio.toFixed(10) }, 'max(costo actualizado, ingreso × mínimo fiscal) × proporción gravada', deductibleCost.times(taxableRatio), 'Costo mínimo fiscal y proporción de deducciones cuando existe ingreso parcialmente exento.')];
  const acquisitionWorksheet = { updatedCost: serialized(costs.total), minimumCost: serialized(minimumCost), appliedCost: serialized(deductibleCost.times(taxableRatio)), appliedDeductions: serialized(partyDeductions.times(taxableRatio)), taxableRatio: taxableRatio.toFixed(10) };
  const ruleParameter = {
    ruleId: rules.saleRuleSet.key,
    legalReference: rules.saleRuleSet.normativeSource,
    ruleVersion: rules.saleRuleSet.version,
  };
  if (gain.lte(0)) {
    return {
      partyId: party.id, partyName: party.name, status: exempt.eq(gross) ? 'EXENTO' : 'NO_GENERADO', amount: '0.00',
      taxableBase: serialized(Decimal.max(new Decimal(0), gain)), exemptAmount: serialized(exempt), route: party.fiscalResidence === 'EXTRANJERO' ? 'EXTRANJERO_OPCION_GANANCIA' : 'PF_MEXICO',
      reason: exempt.eq(gross) ? 'Ingreso totalmente exento.' : 'La operación no determina ganancia gravable; el resultado no generado se conserva como cero.', missing: [],
      traces: [...exemptionTraces, ...costTraces, trace(ruleParameter, { ingresoGravable: serialized(taxableIncome), costo: serialized(deductibleCost.times(taxableRatio)), deducciones: serialized(partyDeductions.times(taxableRatio)) }, 'ingresoGravable − costo − deducciones', '0.00', 'No existe ganancia positiva sobre la cual aplicar la tarifa.')],
      distribution: distribution(party, new Decimal(0), new Decimal(0), rules),
      acquisitionWorksheet,
    };
  }
  const earliest = costs.earliest!;
  const operation = new Date(`${input.operationDate}T00:00:00Z`);
  const elapsedYears = fullFiscalYears(earliest, operation);
  const years = Math.max(1, Math.min(rules.saleRuleSet.yearsCap, elapsedYears));
  const annualBase = gain.div(years);
  const foreignGain = party.fiscalResidence === 'EXTRANJERO';
  const bracket = foreignGain ? null : rules.saleRuleSet.brackets.find((item) => annualBase.gte(item.lower) && (item.upper === null || annualBase.lte(item.upper)));
  if (!foreignGain && !bracket) return pending(party, 'TARIFA_SIN_TRAMO', ['tramo vigente de tarifa para la base anual determinada; no se extrapola ni se inventa redondeo']);
  const tax = foreignGain ? gain.times(percent(rules.foreignGainRate!.value, 'tasa máxima LISR 160').div(100)) : tariffTax(annualBase, rules.saleRuleSet.brackets).times(years);
  return {
    partyId: party.id, partyName: party.name, status: exempt.gt(0) ? 'EXENTO_PARCIALMENTE' : 'GRAVADO', amount: serialized(tax),
    taxableBase: serialized(gain), exemptAmount: serialized(exempt), route: party.fiscalResidence === 'EXTRANJERO' ? 'EXTRANJERO_OPCION_GANANCIA' : 'PF_MEXICO',
    reason: party.fiscalResidence === 'EXTRANJERO' ? 'Opción sobre ganancia aplicada con requisitos verificados.' : 'Tarifa de enajenación vigente aplicada a la ganancia individual.', missing: [],
    traces: [...exemptionTraces, ...costTraces, foreignGain
      ? trace(rules.foreignGainRate!, { ganancia: serialized(gain), tasa: rules.foreignGainRate!.value }, 'ganancia × tasa máxima / 100', tax, 'Opción LISR 160; no se aplica la tarifa provisional de residentes en México.')
      : trace(ruleParameter, { ganancia: serialized(gain), anos: String(years), baseAnual: annualBase.toFixed(8), limiteInferior: bracket!.lower, limiteSuperior: bracket!.upper || 'Sin límite superior', cuotaFija: bracket!.fixedFee, porcentaje: bracket!.percentage }, 'tarifa(ganancia / años) × años', tax, 'Cálculo determinístico individual por enajenante y sus capas de adquisición.')],
    distribution: distribution(party, tax, gain, rules),
    acquisitionWorksheet,
  };
};

const calculateAcquisition = (input: ISRV3Input, rules: ISRV3RuleSnapshot, party: ISRV3Party): ISRV3PartyResult => {
  if (party.subjectType === 'PM_TITULO_II') return noAplica(party, 'ADQUISICION_PM_TITULO_II', 'RLISR 217 no se aplica indiscriminadamente a personas morales del Título II.');
  if (!['PF', 'PM_TITULO_III'].includes(party.subjectType)) return pending(party, 'ADQUISICION_SUJETO', [`clasificación fiscal de ${party.name}`]);
  if (party.acquisitionExemption?.applies) {
    if (!party.acquisitionExemption.verified) return pending(party, 'ADQUISICION_EXCEPCION', ['verificación de la excepción legal']);
    return { partyId: party.id, partyName: party.name, status: 'NO_GENERADO', amount: '0.00', taxableBase: '0.00', exemptAmount: '0.00', route: 'ADQUISICION_EXCEPCION', reason: party.acquisitionExemption.legalReference, missing: [], traces: [] };
  }
  const missing = [!rules.acquisitionThresholdPercent && 'umbral vigente de ISR por adquisición', !rules.acquisitionRate && 'tasa vigente de ISR por adquisición'].filter(Boolean) as string[];
  if (missing.length) return pending(party, 'ISR_ADQUISICION', missing);
  const consideration = money(input.values.operation, 'valor de operación');
  const appraisal = money(input.values.appraisal, 'valor de avalúo');
  if (consideration.eq(0) || appraisal.eq(0)) return pending(party, 'ISR_ADQUISICION', ['valor de operación y avalúo positivos']);
  const thresholdRate = new Decimal(rules.acquisitionThresholdPercent!.value).div(100);
  const threshold = consideration.times(new Decimal(1).plus(thresholdRate));
  const share = percent(party.percentage, `porcentaje de ${party.name}`).div(100);
  if (appraisal.lte(threshold)) {
    return {
      partyId: party.id, partyName: party.name, status: 'NO_GENERADO', amount: '0.00', taxableBase: '0.00', exemptAmount: '0.00', route: 'ISR_ADQUISICION',
      reason: 'El avalúo no excede la contraprestación en más del umbral legal verificado.', missing: [],
      traces: [trace(rules.acquisitionThresholdPercent!, { contraprestacion: serialized(consideration), avaluo: serialized(appraisal), umbral: rules.acquisitionThresholdPercent!.value }, 'avalúo ≤ contraprestación × (1 + umbral)', '0.00', 'No se actualiza el supuesto que genera ISR por adquisición.')],
    };
  }
  const excess = appraisal.minus(consideration).times(share);
  const rate = new Decimal(rules.acquisitionRate!.value);
  const tax = excess.times(rate.div(100));
  return {
    partyId: party.id, partyName: party.name, status: 'GRAVADO', amount: serialized(tax), taxableBase: serialized(excess), exemptAmount: '0.00', route: 'ISR_ADQUISICION',
    reason: 'Diferencia individual gravada conforme al umbral y tasa vigentes verificados.', missing: [],
    traces: [
      trace(rules.acquisitionThresholdPercent!, { contraprestacion: serialized(consideration), avaluo: serialized(appraisal), umbral: rules.acquisitionThresholdPercent!.value }, 'avalúo > contraprestación × (1 + umbral)', excess, 'Se actualiza el supuesto de diferencia gravable.'),
      trace(rules.acquisitionRate!, { diferenciaIndividual: serialized(excess), tasa: rate.toFixed() }, 'diferenciaIndividual × tasa / 100', tax, 'ISR por adquisición individual del adquirente.'),
    ],
  };
};

const calculateIVA = (input: ISRV3Input, rules: ISRV3RuleSnapshot): ISRV3Result['iva'] => {
  if (!input.calculateIVA) return { status: 'NO_APLICA', taxableBase: null, rate: null, amount: null, reason: 'La rama IVA no fue activada por el usuario autorizado.', missing: [], traces: [] };
  if (input.property.type === 'TERRENO') return { status: 'EXENTO', taxableBase: '0.00', rate: null, amount: '0.00', reason: 'La enajenación de suelo se conserva fuera de la base gravada.', missing: [], traces: [] };
  if (input.property.type === 'CASA_HABITACION') return { status: 'EXENTO', taxableBase: '0.00', rate: null, amount: '0.00', reason: 'Construcción destinada o utilizada como casa habitación, con hechos confirmados en esta ruta.', missing: [], traces: [] };
  if (!rules.ivaGeneralRate) return { status: 'PENDIENTE_INFORMACION', taxableBase: null, rate: null, amount: null, reason: 'No existe tasa general de IVA verificada y vigente para la fecha de operación.', missing: ['tasa general de IVA vigente'], traces: [] };
  let taxableBase = money(input.values.constructionSale, 'valor de construcción');
  if (input.property.type === 'USO_MIXTO') {
    if (!input.property.mixedTaxablePercentage) return { status: 'PENDIENTE_INFORMACION', taxableBase: null, rate: null, amount: null, reason: 'Falta la proporción verificable de construcción gravada en el uso mixto.', missing: ['porcentaje gravado de uso mixto'], traces: [] };
    taxableBase = taxableBase.times(percent(input.property.mixedTaxablePercentage, 'porcentaje gravado').div(100));
  }
  const rate = new Decimal(rules.ivaGeneralRate.value);
  const tax = taxableBase.times(rate.div(100));
  return {
    status: input.property.type === 'USO_MIXTO' ? 'EXENTO_PARCIALMENTE' : 'GRAVADO', taxableBase: serialized(taxableBase), rate: rate.toFixed(), amount: serialized(tax),
    reason: 'Sólo el componente de construcción legalmente gravado integra la base; el suelo nunca se incluyó.', missing: [],
    traces: [trace(rules.ivaGeneralRate, { construccionGravada: serialized(taxableBase), tasa: rate.toFixed() }, 'construccionGravada × tasa / 100', tax, 'Determinación de IVA sobre el componente gravado.')],
  };
};

export function calculateISRV3(input: ISRV3Input, rules: ISRV3RuleSnapshot): ISRV3Result {
  if (input.schemaVersion !== 3) throw new Error('El motor ISR v3 requiere schemaVersion 3.');
  if (rules.engineVersion !== 'ISR-V3.0') throw new Error('La versión normativa no corresponde al motor ISR v3.');
  if (!['TERRENO', 'CASA_HABITACION', 'TERRENO_CONSTRUCCION', 'CONSTRUCCION_COMERCIAL', 'USO_MIXTO', 'OTRO'].includes(input.property.type)) throw new Error('Selecciona un tipo de inmueble válido.');
  if (!Array.isArray(input.parties) || !Array.isArray(input.deductions)) throw new Error('Las partes y deducciones deben tener un formato válido.');
  if (new Set(input.parties.map((party) => party.id)).size !== input.parties.length || input.parties.some((party) => !party.id || !party.name?.trim())) throw new Error('Identifica cada parte sin duplicar su ID.');
  for (const party of input.parties) {
    if (!['ENAJENANTE', 'ADQUIRENTE'].includes(party.role) || !['PF', 'PM_TITULO_II', 'PM_TITULO_III', 'OTRO'].includes(party.subjectType) || !['MEXICO', 'EXTRANJERO', 'POR_DETERMINAR'].includes(party.fiscalResidence)) throw new Error('El carácter, sujeto y residencia fiscal deben ser válidos.');
    if (percent(party.percentage, `participación de ${party.name}`).lte(0)) throw new Error('La participación de cada parte debe ser mayor que cero.');
    if (party.acquisitionLayers && new Set(party.acquisitionLayers.map((layer) => layer.id)).size !== party.acquisitionLayers.length) throw new Error('Las adquisiciones de una persona no pueden duplicar su ID.');
  }
  if (input.deductions.some((item) => item.paidByPartyId && !input.parties.some((party) => party.id === item.paidByPartyId && party.role === 'ENAJENANTE'))) throw new Error('El pagador de una deducción debe ser un enajenante del cálculo.');
  if (!input.act.id && input.act.fiscalClassification !== 'OTRO') throw new Error('Selecciona un acto del catálogo real de la Notaría.');
  if (input.act.fiscalClassification === 'OTRO' && !input.act.otherDescription?.trim()) throw new Error('Especifica el acto no catalogado.');
  const operationDate = new Date(`${input.operationDate}T00:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.operationDate) || !Number.isFinite(operationDate.getTime()) || operationDate.toISOString().slice(0, 10) !== input.operationDate) throw new Error('La fecha fiscal de operación debe ser válida.');
  if (operationDate.getUTCFullYear() !== input.taxYear) throw new Error('La fecha fiscal debe pertenecer al ejercicio del cálculo.');
  const operationValue = money(input.values.operation, 'valor de operación');
  if (operationValue.lte(0)) throw new Error('El valor de operación debe ser mayor que cero.');
  const componentValue = money(input.values.landSale, 'valor de terreno').plus(money(input.values.constructionSale, 'valor de construcción'));
  if (!componentValue.eq(operationValue)) throw new Error('La suma de terreno y construcción debe coincidir exactamente con el valor de operación.');

  const sellers = input.parties.filter((party) => party.role === 'ENAJENANTE');
  const buyers = input.parties.filter((party) => party.role === 'ADQUIRENTE');
  const sellerTotal = sellers.reduce((sum, party) => sum.plus(percent(party.percentage, `porcentaje de ${party.name}`)), new Decimal(0));
  const buyerTotal = buyers.reduce((sum, party) => sum.plus(percent(party.percentage, `porcentaje de ${party.name}`)), new Decimal(0));
  if (sellers.length && !sellerTotal.eq(100)) throw new Error('Las participaciones de enajenantes deben sumar exactamente 100%.');
  if (buyers.length && !buyerTotal.eq(100)) throw new Error('Las participaciones de adquirentes deben sumar exactamente 100%.');

  const saleISR = sellers.map((party) => calculateSale(input, rules, party));
  const acquisitionISR = buyers.map((party) => calculateAcquisition(input, rules, party));
  const iva = calculateIVA(input, rules);
  const missing = [...new Set([...saleISR.flatMap((item) => [...item.missing, ...(item.distribution?.status === 'PENDIENTE_INFORMACION' ? [item.distribution.reason] : [])]), ...acquisitionISR.flatMap((item) => item.missing), ...iva.missing])];
  if (!sellers.length) missing.push('enajenantes de la operación');
  if (!buyers.length) missing.push('adquirentes de la operación');
  const breakdown = [
    ...saleISR.map((item) => ({ key: `sale:${item.partyId}`, label: `ISR enajenación · ${item.partyName}`, operation: item.route, amount: item.amount ?? item.status, source: item.traces.map((entry) => entry.legalReference).join('; ') || item.reason })),
    ...acquisitionISR.map((item) => ({ key: `acquisition:${item.partyId}`, label: `ISR adquisición · ${item.partyName}`, operation: item.route, amount: item.amount ?? item.status, source: item.traces.map((entry) => entry.legalReference).join('; ') || item.reason })),
    { key: 'iva', label: 'IVA', operation: iva.status, amount: iva.amount ?? iva.status, source: iva.traces.map((entry) => entry.legalReference).join('; ') || iva.reason },
  ];
  return { schemaVersion: 3, engineVersion: 'ISR-V3.0', calculationRevision: ISR_V3_CALCULATION_REVISION, ruleVersion: rules.saleRuleSet.version, currency: 'MXN', saleISR, acquisitionISR, iva, missing, breakdown };
}

const parameterCodes = {
  foreignGrossRate: 'LISR160_GROSS_RATE',
  foreignGainRate: 'LISR160_GAIN_MAX_RATE',
  acquisitionThresholdPercent: 'RLISR217_THRESHOLD_PERCENT',
  acquisitionRate: 'RLISR217_ACQUISITION_RATE',
  ivaGeneralRate: 'LIVA_GENERAL_RATE',
  homeExemptionLimitPesos: 'LISR93_XIX_HOME_EXEMPTION_LIMIT_PESOS',
  minimumAcquisitionPercent: 'LISR121_MIN_ACQUISITION_PERCENT',
  statePaymentRate: 'LISR127_STATE_RATE',
} as const;

/** Convierte exclusivamente revisiones fiscales verificadas por el servicio a un
 * snapshot ejecutable. La ausencia de cualquier parámetro se conserva y produce
 * PENDIENTE_INFORMACION; nunca se reemplaza con un default inventado. */
export function buildISRV3RuleSnapshot(saleRuleSet: ISRRuleSetSnapshot, effectiveDate: string): ISRV3RuleSnapshot {
  const references = saleRuleSet.referenceTables || [];
  const mapped = (code: string): ISRV3RuleParameter | undefined => {
    const reference = references.find((item) => item.code === code);
    if (!reference) return undefined;
    const raw = reference.value as Record<string, unknown>;
    const value = raw.value ?? raw.rate ?? raw.percentage ?? raw.amount;
    if (value === undefined || value === null || String(value).trim() === '') return undefined;
    return {
      value: String(value), ruleId: reference.code, legalReference: reference.sourceTitle,
      ruleVersion: String(reference.version), sourceUrl: reference.sourceUrl,
    };
  };
  return {
    engineVersion: 'ISR-V3.0', calculationRevision: ISR_V3_CALCULATION_REVISION, effectiveDate, saleRuleSet,
    foreignGrossRate: mapped(parameterCodes.foreignGrossRate),
    foreignGainRate: mapped(parameterCodes.foreignGainRate),
    acquisitionThresholdPercent: mapped(parameterCodes.acquisitionThresholdPercent),
    acquisitionRate: mapped(parameterCodes.acquisitionRate),
    ivaGeneralRate: mapped(parameterCodes.ivaGeneralRate),
    homeExemptionLimitPesos: mapped(parameterCodes.homeExemptionLimitPesos),
    minimumAcquisitionPercent: mapped(parameterCodes.minimumAcquisitionPercent),
    statePaymentRate: mapped(parameterCodes.statePaymentRate),
  };
}
