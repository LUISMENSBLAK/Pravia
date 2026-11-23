import { Prisma } from '@prisma/client';
import { ISRValidationError, type ISRMoney } from './isrTaxEngine';

const Decimal = Prisma.Decimal;
const decimal = (value: Prisma.Decimal.Value, field: string) => {
  try { const parsed = new Decimal(value); if (!parsed.isFinite()) throw new Error(); return parsed; }
  catch { throw new ISRValidationError('INVALID_AMOUNT', `El valor de ${field} no es válido.`, field); }
};
const value = (amount: Prisma.Decimal) => amount.toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toFixed(2);

export type FiscalReferenceSnapshot = {
  id: string; type: 'INPC' | 'FACTOR' | 'RECARGO' | 'UDI' | string; code: string; version: number;
  effectiveFrom: string; effectiveTo: string | null; value: Record<string, unknown>;
  sourceTitle: string; sourceUrl: string;
};

export function calculateReferredValue(input: { amount: ISRMoney; factor: ISRMoney; valuationDate: string; targetDate: string; reference: FiscalReferenceSnapshot }) {
  const amount = decimal(input.amount, 'importe'); const factor = decimal(input.factor, 'factor');
  if (amount.lt(0) || factor.lte(0)) throw new ISRValidationError('REFERRED_VALUE_INVALID', 'El importe y el factor deben ser válidos.', 'factor');
  if (!input.reference.id || !input.reference.sourceUrl || !['INPC', 'FACTOR', 'UDI'].includes(input.reference.type)) throw new ISRValidationError('FISCAL_REFERENCE_REQUIRED', 'Selecciona una referencia fiscal verificada.', 'reference');
  const valuation = new Date(`${input.valuationDate}T00:00:00Z`); const target = new Date(`${input.targetDate}T00:00:00Z`);
  if (Number.isNaN(valuation.getTime()) || Number.isNaN(target.getTime()) || target > valuation) throw new ISRValidationError('REFERRED_VALUE_DATE_INVALID', 'La fecha objetivo no puede ser posterior a la fecha de valuación.', 'targetDate');
  return { amount: value(amount), factor: factor.toFixed(8), referredValue: value(amount.times(factor)), reference: input.reference, formula: 'amount × verifiedFactor', rounding: 'HALF_UP_CENT' as const };
}

export function calculateSurcharges(input: { principal: ISRMoney; originDate: string; dueDate: string; paymentDate: string; monthlyRates: FiscalReferenceSnapshot[] }) {
  const principal = decimal(input.principal, 'principal');
  if (principal.lte(0) || principal.decimalPlaces() > 2) throw new ISRValidationError('SURCHARGE_PRINCIPAL_INVALID', 'El principal debe ser mayor a cero y estar expresado en centavos.', 'principal');
  const origin = new Date(`${input.originDate}T00:00:00Z`); const due = new Date(`${input.dueDate}T00:00:00Z`); const paid = new Date(`${input.paymentDate}T00:00:00Z`);
  if ([origin, due, paid].some((date, index) => Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== [input.originDate, input.dueDate, input.paymentDate][index]) || origin > due || due > paid) throw new ISRValidationError('SURCHARGE_DATE_INVALID', 'Confirma el orden de las fechas de obligación, vencimiento y pago.', 'paymentDate');
  const applied: Array<{ month: string; rate: string; source: string; version: number; from: string; to: string }> = [];
  if (paid.getTime() === due.getTime()) return { delayMonths: 0, principal: value(principal), updatedPrincipal: value(principal), updateFactor: '1', updateAmount: '0.00', surcharges: '0.00', total: value(principal), applied, rounding: 'HALF_UP_CENT' as const };
  const available = input.monthlyRates.filter((item) => item.id && item.sourceUrl && item.version > 0);
  const latest = (type: string, code: string, day: string) => available.filter((item) => item.type === type && item.code === code && item.effectiveFrom <= day && (!item.effectiveTo || item.effectiveTo >= day)).sort((a, b) => b.version - a.version)[0];
  const policy = latest('ISR_SURCHARGE_POLICY', 'CFF17A_21_POLICY', input.paymentDate);
  if (!policy || policy.value.period_mode !== 'ANNIVERSARY' || !['PERIOD_START', 'PERIOD_END'].includes(String(policy.value.rate_month))) throw new ISRValidationError('SURCHARGE_POLICY_REQUIRED', 'Falta política verificada de actualización y periodos de recargos; no se mostrará actualización cero.', 'monthlyRates');
  const cap = Number(policy.value.max_months), digits = Number(policy.value.factor_decimals);
  const rounding = policy.value.factor_rounding === 'DOWN' ? Decimal.ROUND_DOWN : policy.value.factor_rounding === 'HALF_UP' ? Decimal.ROUND_HALF_UP : null;
  if (!Number.isInteger(cap) || cap < 1 || cap > 1200 || !Number.isInteger(digits) || digits < 0 || digits > 8 || rounding === null) throw new ISRValidationError('SURCHARGE_POLICY_INVALID', 'Confirma límite, precisión y redondeo en la política versionada.', 'monthlyRates');
  const monthBefore = (date: Date) => new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 0)).toISOString().slice(0, 7);
  let factor = new Decimal(1); let updateSource: { id: string; version: number; source: string; fromMonth: string; toMonth: string; fromIndex: string; toIndex: string } | null = null;
  if (input.dueDate.slice(0, 7) !== input.paymentDate.slice(0, 7)) {
    const series = latest('INPC', 'ISR_INPC_SERIES', input.paymentDate);
    const fromMonth = monthBefore(due); let toMonth = monthBefore(paid);
    const months = series?.value.months && typeof series.value.months === 'object' ? series.value.months as Record<string, unknown> : {};
    const published = String(series?.value.lastPublishedMonth || '');
    if (months[toMonth] === undefined && /^\d{4}-\d{2}$/.test(published) && published < toMonth && published >= fromMonth) toMonth = published;
    if (!series || !series.value.base || months[fromMonth] === undefined || months[toMonth] === undefined) throw new ISRValidationError('SURCHARGE_INPC_MISSING', `Faltan INPC verificados de ${fromMonth} y ${toMonth}; no se inventa actualización cero.`, 'monthlyRates');
    const first = decimal(String(months[fromMonth]), 'INPC inicial'), last = decimal(String(months[toMonth]), 'INPC final');
    if (first.lte(0) || last.lte(0)) throw new ISRValidationError('SURCHARGE_INPC_INVALID', 'Los índices deben ser positivos y pertenecer a la misma base.', 'monthlyRates');
    factor = Decimal.max(last.div(first).toDecimalPlaces(digits, rounding), new Decimal(1));
    updateSource = { id: series.id, version: series.version, source: series.sourceUrl, fromMonth, toMonth, fromIndex: first.toFixed(), toIndex: last.toFixed() };
  }
  const updated = principal.times(factor).toDecimalPlaces(2, Decimal.ROUND_HALF_UP); let totalRate = new Decimal(0);
  const anniversary = (offset: number) => {
    const date = new Date(Date.UTC(due.getUTCFullYear(), due.getUTCMonth() + offset, 1));
    const lastDay = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate();
    date.setUTCDate(Math.min(due.getUTCDate(), lastDay)); return date;
  };
  for (let index = 0; ; index += 1) {
    const start = new Date(anniversary(index).getTime() + 86400000); if (start > paid) break;
    if (index >= cap) throw new ISRValidationError('SURCHARGE_PERIOD_REQUIRES_REVIEW', 'La mora excede el periodo configurado; requiere revisión, no truncamiento silencioso.', 'paymentDate');
    const end = new Date(Math.min(anniversary(index + 1).getTime(), paid.getTime()));
    const month = (policy.value.rate_month === 'PERIOD_START' ? start : end).toISOString().slice(0, 7);
    const reference = latest('RECARGO', month, `${month}-01`);
    if (!reference) throw new ISRValidationError('SURCHARGE_RATE_MISSING', `No existe tasa verificada de recargos para ${month}.`, 'monthlyRates');
    const rate = decimal(String(reference.value.rate ?? ''), `tasa ${month}`);
    if (rate.lt(0) || rate.gt(100)) throw new ISRValidationError('SURCHARGE_RATE_INVALID', 'La tasa de recargos configurada no es válida.', 'monthlyRates');
    totalRate = totalRate.plus(rate);
    applied.push({ month, rate: rate.toFixed(8), source: reference.sourceUrl, version: reference.version, from: start.toISOString().slice(0, 10), to: end.toISOString().slice(0, 10) });
  }
  const surcharge = updated.times(totalRate.div(100)).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
  return { delayMonths: applied.length, principal: value(principal), updatedPrincipal: value(updated), updateFactor: factor.toFixed(), updateAmount: value(updated.minus(principal)), surcharges: value(surcharge), total: value(updated.plus(surcharge)), applied, policy: { id: policy.id, version: policy.version, source: policy.sourceUrl, rateMonth: policy.value.rate_month }, updateSource, rounding: 'HALF_UP_CENT' as const };
}

export function calculateAdditionalTax(input: { taxableBase: ISRMoney; reference: FiscalReferenceSnapshot }) {
  const taxableBase = decimal(input.taxableBase, 'base gravable');
  if (taxableBase.lt(0)) throw new ISRValidationError('ADDITIONAL_TAX_BASE_INVALID', 'La base gravable no puede ser negativa.', 'taxableBase');
  if (!['ADQUISICION', 'IVA'].includes(input.reference.type) || !input.reference.id || !input.reference.sourceUrl) {
    throw new ISRValidationError('ADDITIONAL_TAX_REFERENCE_REQUIRED', 'Selecciona una regla verificada de adquisición o IVA.', 'reference');
  }
  const rate = decimal(String(input.reference.value.rate ?? ''), 'tasa');
  if (rate.lt(0) || rate.gt(100)) throw new ISRValidationError('ADDITIONAL_TAX_RATE_INVALID', 'La tasa configurada no es válida.', 'rate');
  const amount = taxableBase.times(rate).div(100);
  return {
    type: input.reference.type, taxableBase: value(taxableBase), rate: rate.toFixed(8), tax: value(amount),
    totalWithTax: value(taxableBase.plus(amount)), reference: input.reference,
    formula: 'taxableBase × verifiedRate / 100', rounding: 'HALF_UP_CENT' as const,
  };
}

export type ExportField = { path: string; outputPath?: string; required?: boolean; catalog?: string };
type ExportCatalogs = Record<string, Array<{ code: string; label?: string }>>;
export type FiscalExportDefinition = { code: string; version: number; target: string; fields: ExportField[]; catalogs?: ExportCatalogs };

const safePath = (path: string) => path.split('.').filter((key) => key && !['__proto__', 'prototype', 'constructor'].includes(key));
const getPath = (record: Record<string, unknown>, path: string) => safePath(path).reduce<unknown>((current, key) => current && typeof current === 'object' ? (current as Record<string, unknown>)[key] : undefined, record);
const setPath = (record: Record<string, unknown>, path: string, fieldValue: unknown) => {
  const parts = safePath(path);
  if (!parts.length) throw new ISRValidationError('EXPORT_FIELD_PATH_INVALID', 'El perfil contiene una ruta de salida no válida.', path);
  let current = record;
  parts.forEach((part, index) => {
    if (index === parts.length - 1) current[part] = fieldValue;
    else {
      const next = current[part];
      if (!next || typeof next !== 'object' || Array.isArray(next)) current[part] = {};
      current = current[part] as Record<string, unknown>;
    }
  });
};

export function validateFiscalExportProfile(snapshot: Record<string, unknown>, profile: FiscalExportDefinition) {
  const errors: Array<{ level: 'ERROR'; field: string; code: string; message: string }> = [];
  for (const field of profile.fields || []) {
    const fieldValue = getPath(snapshot, field.path);
    if (field.required && (fieldValue === undefined || fieldValue === null || fieldValue === '')) {
      errors.push({ level: 'ERROR', field: field.path, code: 'MISSING_REQUIRED', message: `Falta ${field.path}; no se generará un valor ficticio.` });
      continue;
    }
    const catalog = field.catalog ? profile.catalogs?.[field.catalog] : undefined;
    if (field.catalog && !catalog?.length) {
      errors.push({ level: 'ERROR', field: field.path, code: 'PROFILE_CATALOG_MISSING', message: `El perfil no tiene configurado el catálogo controlado ${field.catalog}.` });
      continue;
    }
    if (fieldValue !== undefined && fieldValue !== null && fieldValue !== '' && catalog?.length && !catalog.some((entry) => entry.code === String(fieldValue))) {
      errors.push({ level: 'ERROR', field: field.path, code: 'VALUE_OUTSIDE_CATALOG', message: `${field.path} no pertenece al catálogo controlado ${field.catalog}.` });
    }
  }
  return { valid: errors.length === 0, errors, warnings: [], profile: { code: profile.code, version: profile.version, target: profile.target }, transformedValues: false, fictitiousValues: false };
}

/**
 * Builds the deterministic, profile-shaped data body. It deliberately has no
 * current timestamp and performs no value synthesis or coercion: the same
 * immutable calculation snapshot and profile always produce the same body.
 */
export function buildFiscalExportPayload(snapshot: Record<string, unknown>, profile: FiscalExportDefinition) {
  const validation = validateFiscalExportProfile(snapshot, profile);
  if (!validation.valid) throw new ISRValidationError('FISCAL_EXPORT_VALIDATION_FAILED', 'El snapshot no cumple los campos obligatorios del perfil fiscal.', undefined, 422);
  const data: Record<string, unknown> = {};
  for (const field of profile.fields || []) {
    const fieldValue = getPath(snapshot, field.path);
    if (fieldValue !== undefined) setPath(data, field.outputPath || field.path, fieldValue);
  }
  return { profile: validation.profile, data, transformedValues: false, fictitiousValues: false };
}
