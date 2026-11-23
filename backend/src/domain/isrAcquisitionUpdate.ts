import { Prisma } from '@prisma/client';
import type { ISRRuleSetSnapshot } from './isrTaxEngine';

const Decimal = Prisma.Decimal;
type Reference = NonNullable<ISRRuleSetSnapshot['referenceTables']>[number];
export type ISRAcquisitionHistorical = {
  method: 'AUTO' | 'INPC' | 'FACTORES';
  separation: 'EXPLICIT' | 'STATUTORY';
  land?: string; construction?: string; total?: string;
};
export type ISRAcquisitionUpdateResult = {
  land: string | null; construction: string | null;
  chosenMethod: 'INPC' | 'FACTORES' | null;
  alternatives: Array<{ method: 'INPC' | 'FACTORES'; factor: string; land: string; construction: string; total: string; referenceCode: string; referenceVersion: number; source: string }>;
  missing: string[];
  inputs: Record<string, string>;
};
const object = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
const decimal = (value: unknown) => {
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  if (!/^\d+(?:\.\d+)?$/.test(String(value))) return null;
  const number = new Decimal(value); return number.isFinite() && number.gte(0) ? number : null;
};
const money = (value: Prisma.Decimal) => value.toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toFixed(2);
export const fiscalAnniversary = (date: Date, years: number) => {
  const target = new Date(Date.UTC(date.getUTCFullYear() + years, date.getUTCMonth(), date.getUTCDate()));
  if (target.getUTCMonth() !== date.getUTCMonth()) target.setUTCDate(0);
  return target;
};
export const fullFiscalYears = (from: Date, to: Date) => {
  const years = to.getUTCFullYear() - from.getUTCFullYear();
  return years - (to < fiscalAnniversary(from, years) ? 1 : 0);
};

/** Arithmetic extension of the canonical ISR engine. All rates, options,
 * indices and factors arrive in verified/versioned reference snapshots. The
 * function never consults a model or trusts a client-supplied update factor. */
export function updateISRAcquisition(input: {
  historical: ISRAcquisitionHistorical; acquisitionDate: string; operationDate: string;
  propertyIsLand: boolean; references: Reference[];
}): ISRAcquisitionUpdateResult {
  const result: ISRAcquisitionUpdateResult = { land: null, construction: null, chosenMethod: null, alternatives: [], missing: [], inputs: {} };
  if (!['AUTO', 'INPC', 'FACTORES'].includes(input.historical.method) || !['EXPLICIT', 'STATUTORY'].includes(input.historical.separation)) { result.missing.push('método y separación válidos'); return result; }
  const from = new Date(`${input.acquisitionDate}T00:00:00Z`), to = new Date(`${input.operationDate}T00:00:00Z`);
  if (!Number.isFinite(from.getTime()) || !Number.isFinite(to.getTime()) || from > to || from.toISOString().slice(0, 10) !== input.acquisitionDate || to.toISOString().slice(0, 10) !== input.operationDate) {
    result.missing.push('fechas válidas de adquisición y enajenación'); return result;
  }
  const references = input.references.filter((item) => item.sourceUrl && item.version > 0 && item.effectiveFrom <= input.operationDate && (!item.effectiveTo || item.effectiveTo >= input.operationDate));
  const latest = (code: string) => references.filter((item) => item.code === code).sort((a, b) => b.version - a.version)[0];
  const policyRef = latest('ISR_ACQUISITION_UPDATE_POLICY'), policy = object(policyRef?.value);
  if (!policyRef) { result.missing.push('política verificada ISR_ACQUISITION_UPDATE_POLICY'); return result; }
  let land = decimal(input.historical.land), construction = decimal(input.historical.construction);
  if (input.propertyIsLand) { land = decimal(input.historical.land ?? input.historical.total); construction = new Decimal(0); }
  else if (input.historical.separation === 'STATUTORY') {
    const total = decimal(input.historical.total), share = decimal(policy.statutoryLandPercent);
    if (!total || !share || share.gt(100)) { result.missing.push('costo total y porcentaje supletorio de terreno verificado'); return result; }
    land = total.times(share.div(100)); construction = total.minus(land);
  }
  if (!land || !construction) { result.missing.push('costos históricos explícitos por componente'); return result; }
  const years = fullFiscalYears(from, to);
  result.inputs = { acquisitionDate: input.acquisitionDate, operationDate: input.operationDate, historicalLand: money(land), historicalConstruction: money(construction), fullYears: String(years), policyCode: policyRef.code, policyVersion: String(policyRef.version), policySource: policyRef.sourceUrl };
  let depreciated = construction;
  if (construction.gt(0)) {
    const annual = decimal(policy.constructionAnnualDepreciationPercent), minimum = decimal(policy.constructionMinimumRemainingPercent);
    if (!annual || !minimum || annual.gt(100) || minimum.gt(100)) { result.missing.push('depreciación anual y mínimo de construcción verificados'); return result; }
    depreciated = Decimal.max(construction.times(new Decimal(1).minus(annual.times(years).div(100))), construction.times(minimum.div(100)));
    result.inputs.depreciatedConstruction = money(depreciated);
  }
  const missing: string[] = [];
  const add = (method: 'INPC' | 'FACTORES', factor: Prisma.Decimal, reference: Reference, constructionBase: Prisma.Decimal) => {
    const updatedLand = land!.times(factor), updatedConstruction = constructionBase.times(factor);
    result.alternatives.push({ method, factor: factor.toFixed(), land: money(updatedLand), construction: money(updatedConstruction), total: money(updatedLand.plus(updatedConstruction)), referenceCode: reference.code, referenceVersion: reference.version, source: reference.sourceUrl });
  };
  if (input.historical.method !== 'FACTORES') {
    const ref = latest('ISR_INPC_SERIES'), raw = object(ref?.value), months = object(raw.months);
    const previous = new Date(Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), 0));
    const firstMonth = input.acquisitionDate.slice(0, 7), lastMonth = previous.toISOString().slice(0, 7);
    const first = decimal(months[firstMonth]), last = decimal(months[lastMonth]);
    const floor = decimal(policy.minimumUpdateFactor), digits = Number(policy.factorDecimals);
    const rounding = policy.factorRounding === 'DOWN' ? Decimal.ROUND_DOWN : policy.factorRounding === 'HALF_UP' ? Decimal.ROUND_HALF_UP : null;
    if (!ref || !raw.base || !first || first.lte(0) || !last || last.lte(0)) missing.push(`INPC verificable de ${firstMonth} y ${lastMonth}, en la misma serie/base`);
    else if (!floor || !Number.isInteger(digits) || digits < 0 || digits > 12 || rounding === null) missing.push('precisión, redondeo y piso de actualización verificados');
    else {
      const factor = Decimal.max(last.div(first).toDecimalPlaces(digits, rounding), floor);
      result.inputs.inpcFromMonth = firstMonth; result.inputs.inpcToMonth = lastMonth;
      result.inputs.inpcFrom = first.toFixed(); result.inputs.inpcTo = last.toFixed();
      add('INPC', factor, ref, depreciated);
    }
  }
  if (input.historical.method !== 'INPC') {
    const ref = latest('ISR_ANNEX9_FACTORS'), raw = object(ref?.value);
    const rows = Array.isArray(raw.rows) ? raw.rows.map(object) : [];
    const matches = rows.filter((row) => {
      const lower = row.moreThanYears === null ? null : Number(row.moreThanYears);
      const upper = row.upToYears === null ? null : Number(row.upToYears);
      if ((lower !== null && (!Number.isInteger(lower) || lower < 0)) || (upper !== null && (!Number.isInteger(upper) || upper < 0))) return false;
      return (lower === null || to > fiscalAnniversary(from, lower)) && (upper === null || to <= fiscalAnniversary(from, upper));
    });
    const factor = matches.length === 1 ? decimal(matches[0].factor) : null;
    if (!ref || Number(raw.taxYear) !== to.getUTCFullYear() || !factor || factor.lte(0)) missing.push('factor Anexo 9 vigente e intervalo único de antigüedad');
    else if (construction.gt(0) && !['APPLY_BEFORE_FACTOR', 'HISTORICAL_BASE'].includes(String(policy.annex9ConstructionBase))) missing.push('criterio verificado de base de construcción para Anexo 9');
    else add('FACTORES', factor, ref, policy.annex9ConstructionBase === 'HISTORICAL_BASE' ? construction : depreciated);
  }
  // AUTO only claims "best" after BOTH legally configured alternatives have
  // actually been evaluated. Do not silently promote one available method.
  if (missing.length) { result.missing.push(...missing); return result; }
  const chosen = result.alternatives.reduce<(typeof result.alternatives)[number] | undefined>((best, candidate) => !best || new Decimal(candidate.total).gt(best.total) ? candidate : best, undefined);
  if (!chosen) { result.missing.push('alternativa de actualización verificable'); return result; }
  result.land = chosen.land; result.construction = chosen.construction; result.chosenMethod = chosen.method;
  return result;
}
