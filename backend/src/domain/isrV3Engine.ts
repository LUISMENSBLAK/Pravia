import { Prisma } from '@prisma/client';
import type { ISRRateBracket, ISRRuleSetSnapshot } from './isrTaxEngine';

const Decimal = Prisma.Decimal;

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
};

export type ISRV3Party = {
  id: string;
  role: 'ENAJENANTE' | 'ADQUIRENTE';
  name: string;
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
  effectiveDate: string;
  saleRuleSet: ISRRuleSetSnapshot;
  foreignGrossRate?: ISRV3RuleParameter;
  acquisitionThresholdPercent?: ISRV3RuleParameter;
  acquisitionRate?: ISRV3RuleParameter;
  ivaGeneralRate?: ISRV3RuleParameter;
  homeExemptionLimitPesos?: ISRV3RuleParameter;
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
};

export type ISRV3Result = {
  schemaVersion: 3;
  engineVersion: 'ISR-V3.0';
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

const acquisitionCost = (party: ISRV3Party, operationDate: string) => {
  const layers = party.acquisitionLayers || [];
  const missing: string[] = [];
  if (!layers.length) missing.push(`capas de adquisición de ${party.name}`);
  let totalPercentage = new Decimal(0);
  let total = new Decimal(0);
  let earliest: Date | undefined;
  const operation = new Date(`${operationDate}T00:00:00Z`);
  for (const layer of layers) {
    if (!layer.verified) missing.push(`verificación de la capa ${layer.id}`);
    if (!layer.fiscalDate) missing.push(`fecha fiscal de la capa ${layer.id}`);
    if (!layer.source.trim()) missing.push(`fuente de la capa ${layer.id}`);
    if ((layer.acquisitionAct === 'HERENCIA' || layer.acquisitionAct === 'DONACION') && !layer.priorLayerId) missing.push(`antecedente encadenado de la capa ${layer.id}`);
    const layerDate = layer.fiscalDate ? new Date(`${layer.fiscalDate}T00:00:00Z`) : undefined;
    if (layerDate && (!Number.isFinite(layerDate.getTime()) || layerDate > operation)) missing.push(`fecha fiscal válida de la capa ${layer.id}`);
    if (layerDate && (!earliest || layerDate < earliest)) earliest = layerDate;
    totalPercentage = totalPercentage.plus(percent(layer.percentage, `porcentaje de la capa ${layer.id}`));
    total = total.plus(money(layer.adjustedLandCost, 'costo de terreno')).plus(money(layer.adjustedConstructionCost, 'costo de construcción'));
  }
  const sellerPercentage = percent(party.percentage, `porcentaje de ${party.name}`);
  if (layers.length && !totalPercentage.eq(sellerPercentage)) missing.push(`capas de ${party.name} deben sumar ${sellerPercentage.toFixed()}%`);
  return { total, earliest, missing };
};

const calculateSale = (input: ISRV3Input, rules: ISRV3RuleSnapshot, party: ISRV3Party): ISRV3PartyResult => {
  if (party.subjectType === 'PM_TITULO_II' || party.subjectType === 'PM_TITULO_III') {
    return noAplica(party, 'PERSONA_MORAL', 'La herramienta notarial v3 no aplica automáticamente la ruta de persona física a una persona moral.');
  }
  if (party.subjectType !== 'PF') return pending(party, 'SUJETO_NO_CLASIFICADO', [`clasificación fiscal de ${party.name}`]);
  if (party.fiscalResidence === 'POR_DETERMINAR') return pending(party, 'RESIDENCIA_POR_DETERMINAR', [`residencia fiscal de ${party.name}`]);

  const share = percent(party.percentage, `porcentaje de ${party.name}`).div(100);
  const gross = money(input.values.operation, 'valor de operación').times(share);
  const costs = acquisitionCost(party, input.operationDate);
  if (costs.missing.length) return pending(party, party.fiscalResidence === 'EXTRANJERO' ? 'EXTRANJERO' : 'PF_MEXICO', costs.missing);
  const partyDeductions = input.deductions
    .filter((item) => !item.paidByPartyId || item.paidByPartyId === party.id)
    .reduce((sum, item) => item.verified ? sum.plus(money(item.amount, item.concept)) : sum, new Decimal(0));

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

  let exempt = new Decimal(0);
  const exemptionTraces: ISRV3Trace[] = [];
  if (party.homeExemption?.requested) {
    const home = party.homeExemption;
    const missing = [
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

  const taxableIncome = gross.minus(exempt);
  const gain = taxableIncome.minus(costs.total).minus(partyDeductions);
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
      traces: [...exemptionTraces, trace(ruleParameter, { ingresoGravable: serialized(taxableIncome), costo: serialized(costs.total), deducciones: serialized(partyDeductions) }, 'ingresoGravable − costo − deducciones', '0.00', 'No existe ganancia positiva sobre la cual aplicar la tarifa.')],
    };
  }
  const earliest = costs.earliest!;
  const years = Math.max(1, Math.min(rules.saleRuleSet.yearsCap, input.taxYear - earliest.getUTCFullYear()));
  const annualBase = gain.div(years);
  const tax = tariffTax(annualBase, rules.saleRuleSet.brackets).times(years);
  return {
    partyId: party.id, partyName: party.name, status: exempt.gt(0) ? 'EXENTO_PARCIALMENTE' : 'GRAVADO', amount: serialized(tax),
    taxableBase: serialized(gain), exemptAmount: serialized(exempt), route: party.fiscalResidence === 'EXTRANJERO' ? 'EXTRANJERO_OPCION_GANANCIA' : 'PF_MEXICO',
    reason: party.fiscalResidence === 'EXTRANJERO' ? 'Opción sobre ganancia aplicada con requisitos verificados.' : 'Tarifa de enajenación vigente aplicada a la ganancia individual.', missing: [],
    traces: [...exemptionTraces, trace(ruleParameter, { ganancia: serialized(gain), anos: String(years), baseAnual: annualBase.toFixed(8) }, 'tarifa(ganancia / años) × años', tax, 'Cálculo determinístico individual por enajenante y sus capas de adquisición.')],
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
  if (!input.act.id && input.act.fiscalClassification !== 'OTRO') throw new Error('Selecciona un acto del catálogo real de la Notaría.');
  if (input.act.fiscalClassification === 'OTRO' && !input.act.otherDescription?.trim()) throw new Error('Especifica el acto no catalogado.');
  const operationDate = new Date(`${input.operationDate}T00:00:00Z`);
  if (!input.operationDate || !Number.isFinite(operationDate.getTime())) throw new Error('La fecha fiscal de operación es obligatoria.');
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
  const missing = [...new Set([...saleISR.flatMap((item) => item.missing), ...acquisitionISR.flatMap((item) => item.missing), ...iva.missing])];
  const breakdown = [
    ...saleISR.map((item) => ({ key: `sale:${item.partyId}`, label: `ISR enajenación · ${item.partyName}`, operation: item.route, amount: item.amount ?? item.status, source: item.traces.map((entry) => entry.legalReference).join('; ') || item.reason })),
    ...acquisitionISR.map((item) => ({ key: `acquisition:${item.partyId}`, label: `ISR adquisición · ${item.partyName}`, operation: item.route, amount: item.amount ?? item.status, source: item.traces.map((entry) => entry.legalReference).join('; ') || item.reason })),
    { key: 'iva', label: 'IVA', operation: iva.status, amount: iva.amount ?? iva.status, source: iva.traces.map((entry) => entry.legalReference).join('; ') || iva.reason },
  ];
  return { schemaVersion: 3, engineVersion: 'ISR-V3.0', ruleVersion: rules.saleRuleSet.version, currency: 'MXN', saleISR, acquisitionISR, iva, missing, breakdown };
}

const parameterCodes = {
  foreignGrossRate: 'LISR160_GROSS_RATE',
  acquisitionThresholdPercent: 'RLISR217_THRESHOLD_PERCENT',
  acquisitionRate: 'RLISR217_ACQUISITION_RATE',
  ivaGeneralRate: 'LIVA_GENERAL_RATE',
  homeExemptionLimitPesos: 'LISR93_XIX_HOME_EXEMPTION_LIMIT_PESOS',
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
    engineVersion: 'ISR-V3.0', effectiveDate, saleRuleSet,
    foreignGrossRate: mapped(parameterCodes.foreignGrossRate),
    acquisitionThresholdPercent: mapped(parameterCodes.acquisitionThresholdPercent),
    acquisitionRate: mapped(parameterCodes.acquisitionRate),
    ivaGeneralRate: mapped(parameterCodes.ivaGeneralRate),
    homeExemptionLimitPesos: mapped(parameterCodes.homeExemptionLimitPesos),
  };
}
