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
  if (principal.lte(0)) throw new ISRValidationError('SURCHARGE_PRINCIPAL_INVALID', 'El principal debe ser mayor a cero.', 'principal');
  const origin = new Date(`${input.originDate}T00:00:00Z`); const due = new Date(`${input.dueDate}T00:00:00Z`); const paid = new Date(`${input.paymentDate}T00:00:00Z`);
  if ([origin, due, paid].some((date) => Number.isNaN(date.getTime())) || origin > due || due > paid) throw new ISRValidationError('SURCHARGE_DATE_INVALID', 'Confirma el orden de las fechas de obligación, vencimiento y pago.', 'paymentDate');
  const months: string[] = []; const cursor = new Date(Date.UTC(due.getUTCFullYear(), due.getUTCMonth() + 1, 1));
  const end = new Date(Date.UTC(paid.getUTCFullYear(), paid.getUTCMonth(), 1));
  while (cursor <= end) { months.push(`${cursor.getUTCFullYear()}-${String(cursor.getUTCMonth() + 1).padStart(2, '0')}`); cursor.setUTCMonth(cursor.getUTCMonth() + 1); }
  let surcharge = new Decimal(0); const applied: Array<{ month: string; rate: string; source: string; version: number }> = [];
  for (const month of months) {
    const reference = input.monthlyRates.find((item) => item.type === 'RECARGO' && item.code === month);
    if (!reference) throw new ISRValidationError('SURCHARGE_RATE_MISSING', `No existe tasa verificada de recargos para ${month}.`, 'monthlyRates');
    const rate = decimal(String(reference.value.rate ?? ''), `tasa ${month}`);
    surcharge = surcharge.plus(principal.times(rate.div(100)));
    applied.push({ month, rate: rate.toFixed(8), source: reference.sourceUrl, version: reference.version });
  }
  return { delayMonths: months.length, principal: value(principal), updateAmount: '0.00', surcharges: value(surcharge), total: value(principal.plus(surcharge)), applied, rounding: 'HALF_UP_CENT' as const };
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
