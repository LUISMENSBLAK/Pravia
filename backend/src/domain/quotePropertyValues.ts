import { BudgetValidationError, centsToMoney, moneyToCents } from './expedienteBudget';

const moneyFields = {
  operationValue: { column: 'valor_operacion', label: 'El valor de operación' },
  cadastralValue: { column: 'valor_catastral', label: 'El valor catastral' },
  appraisalValue: { column: 'valor_avaluo', label: 'El valor de avalúo' },
  predialAmount: { column: 'importe_predial', label: 'El importe del impuesto predial' },
} as const;
export type QuotePropertyRecord = { valor_operacion?: unknown; valor_catastral?: unknown; valor_avaluo?: unknown; cuenta_predial?: string | null; importe_predial?: unknown };
/** Linked masters are authoritative for current documents; saved document versions
 * stay immutable. Missing master values remain missing, never use stale manual values. */
export function effectiveQuotePropertyValues(record: QuotePropertyRecord & { predio_principal?: QuotePropertyRecord | null }): QuotePropertyRecord {
  if (!record.predio_principal) return record;
  return { ...record, valor_operacion: record.predio_principal.valor_operacion ?? null,
    valor_catastral: record.predio_principal.valor_catastral ?? null,
    valor_avaluo: record.predio_principal.valor_avaluo ?? null,
    cuenta_predial: record.predio_principal.cuenta_predial ?? null };
}
export function quotePropertyValuesPayload(record: QuotePropertyRecord) {
  return { operationValue: record.valor_operacion == null ? null : String(record.valor_operacion),
    cadastralValue: record.valor_catastral == null ? null : String(record.valor_catastral),
    ...(record.valor_avaluo !== undefined ? { appraisalValue: record.valor_avaluo == null ? null : String(record.valor_avaluo) } : {}),
    propertyTaxAccount: record.cuenta_predial ?? null,
    predialAmount: record.importe_predial == null ? null : String(record.importe_predial) };
}

/** PATCH semantics: omitted = preserve, blank/null = clear, explicit zero = zero.
 * Account references retain leading zeros/case; never coerce them to money. */
export function parseQuotePropertyValues(raw: unknown) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new BudgetValidationError('QUOTE_PROPERTY_VALUES_INVALID', 'Los datos del inmueble deben ser un objeto.');
  const fields = raw as Record<string, unknown>;
  if (Object.keys(fields).some((key) => ![...Object.keys(moneyFields), 'propertyTaxAccount'].includes(key))) {
    throw new BudgetValidationError('QUOTE_PROPERTY_FIELDS_DENIED', 'Los datos del inmueble contienen campos no permitidos.');
  }
  const data: { valor_operacion?: string | null; valor_catastral?: string | null; valor_avaluo?: string | null; importe_predial?: string | null; cuenta_predial?: string | null } = {};
  for (const [field, { column, label }] of Object.entries(moneyFields)) {
    if (!Object.prototype.hasOwnProperty.call(fields, field)) continue;
    const value = fields[field];
    data[column] = value == null || (typeof value === 'string' && !value.trim()) ? null : centsToMoney(moneyToCents(value, label));
  }
  if (Object.prototype.hasOwnProperty.call(fields, 'propertyTaxAccount')) {
    const value = fields.propertyTaxAccount;
    if (value !== null && (typeof value !== 'string' || value.length > 180 || /[\x00-\x1f\x7f]/.test(value))) {
      throw new BudgetValidationError('QUOTE_PROPERTY_ACCOUNT_INVALID', 'La cuenta predial debe ser texto de máximo 180 caracteres.');
    }
    data.cuenta_predial = typeof value === 'string' ? value.trim() || null : null;
  }
  return data;
}
