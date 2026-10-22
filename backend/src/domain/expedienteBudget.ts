import { normalizeOperationalText, preserveFormatText } from '../utils/operationalText';

// IVA_HONORARIOS remains readable for issued legacy snapshots and internally
// derived rows. It is never an editable operational category.
export const BUDGET_CATEGORIES = ['HONORARIOS', 'IVA_HONORARIOS', 'IMPUESTOS_DERECHOS', 'OTRO_GASTO'] as const;
export type BudgetCategory = typeof BUDGET_CATEGORIES[number];
export const EDITABLE_BUDGET_CATEGORIES = ['HONORARIOS', 'IMPUESTOS_DERECHOS', 'OTRO_GASTO'] as const;
export type BudgetTaxTreatment = 'SIN_IMPUESTO' | 'GRAVADO' | 'EXENTO' | 'NO_OBJETO' | 'REQUIERE_REVISION';
export type MoneyInput = string | number;

export class BudgetValidationError extends Error {
  constructor(readonly code: string, message: string) { super(message); }
}

const MONEY_PATTERN = /^\d{1,14}(?:\.\d{1,2})?$/;
const PERCENT_PATTERN = /^\d{1,3}(?:\.\d{1,6})?$/;

export function moneyToCents(value: unknown, label = 'El importe'): bigint {
  const raw = typeof value === 'number' ? String(value) : String(value ?? '').trim();
  if (!MONEY_PATTERN.test(raw)) throw new BudgetValidationError('EXP007_INVALID_MONEY', `${label} debe ser un importe válido con máximo dos decimales.`);
  const [whole, fraction = ''] = raw.split('.');
  const cents = BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0'));
  if (cents > 9_999_999_999_999_999n) throw new BudgetValidationError('EXP007_MONEY_TOO_LARGE', `${label} excede el máximo permitido.`);
  return cents;
}

export function centsToMoney(cents: bigint): string {
  const sign = cents < 0n ? '-' : '';
  const absolute = cents < 0n ? -cents : cents;
  return `${sign}${absolute / 100n}.${String(absolute % 100n).padStart(2, '0')}`;
}

export function percentageToPpm(value: unknown): bigint {
  const raw = typeof value === 'number' ? String(value) : String(value ?? '').trim();
  if (!PERCENT_PATTERN.test(raw)) throw new BudgetValidationError('EXP007_INVALID_PERCENT', 'El porcentaje debe estar entre 0 y 100.');
  const [whole, fraction = ''] = raw.split('.');
  const ppm = BigInt(whole) * 10_000n + BigInt(fraction.padEnd(6, '0').slice(0, 6)) / 100n;
  if (ppm > 1_000_000n) throw new BudgetValidationError('EXP007_PERCENT_EXCEEDS_100', 'El porcentaje no puede superar 100%.');
  return ppm;
}

export function centsFromPercentage(poolCents: bigint, percentage: unknown): bigint {
  const ppm = percentageToPpm(percentage);
  return (poolCents * ppm + 500_000n) / 1_000_000n;
}

export function percentageFromCents(partCents: bigint, poolCents: bigint): string {
  if (poolCents === 0n) return '0.0000';
  const tenThousandths = (partCents * 1_000_000n + poolCents / 2n) / poolCents;
  return `${tenThousandths / 10_000n}.${String(tenThousandths % 10_000n).padStart(4, '0')}`;
}

export type BudgetConceptInput = { id?: string; concepto: string; categoria: BudgetCategory; importe: MoneyInput; tratamiento_iva?: BudgetTaxTreatment | null; iva_tasa?: MoneyInput | null; regla_fiscal_fuente?: string | null; regla_fiscal_version?: string | null };
export type NormalizedBudgetConcept = { id?: string; concepto: string; categoria: BudgetCategory; importe: string; importeCents: bigint; orden: number; tratamiento_iva: BudgetTaxTreatment | null; iva_tasa: string | null; regla_fiscal_fuente: string | null; regla_fiscal_version: string | null };

const TAX_TREATMENTS: BudgetTaxTreatment[] = ['SIN_IMPUESTO', 'GRAVADO', 'EXENTO', 'NO_OBJETO', 'REQUIERE_REVISION'];
const RATE_PATTERN = /^(?:0(?:\.\d{1,6})?|1(?:\.0{1,6})?)$/;
const rateToPpm = (rate: string): bigint => {
  if (!RATE_PATTERN.test(rate)) throw new BudgetValidationError('EXP007_INVALID_TAX_RATE', 'La tasa de IVA debe estar entre 0 y 1 con máximo seis decimales.');
  const [whole, fraction = ''] = rate.split('.');
  return BigInt(whole) * 1_000_000n + BigInt(fraction.padEnd(6, '0'));
};

const roundTax = (baseCents: bigint, rate: string): bigint => (baseCents * rateToPpm(rate) + 500_000n) / 1_000_000n;

export function normalizeBudgetConcepts(input: unknown): NormalizedBudgetConcept[] {
  if (!Array.isArray(input) || input.length === 0) throw new BudgetValidationError('EXP007_CONCEPTS_REQUIRED', 'Agrega al menos un concepto al presupuesto.');
  if (input.length > 200) throw new BudgetValidationError('EXP007_TOO_MANY_CONCEPTS', 'El presupuesto no puede contener más de 200 conceptos.');
  return input.map((raw: any, orden) => {
    const concepto = normalizeOperationalText(raw?.concepto, 240);
    if (!concepto || concepto.length > 240) throw new BudgetValidationError('EXP007_INVALID_CONCEPT', `El concepto ${orden + 1} debe tener entre 1 y 240 caracteres.`);
    const categoria = String(raw?.categoria ?? '') as BudgetCategory;
    if (!BUDGET_CATEGORIES.includes(categoria)) throw new BudgetValidationError('EXP007_INVALID_CATEGORY', `Selecciona una categoría válida para "${concepto}".`);
    const importeCents = moneyToCents(raw?.importe, `El importe de "${concepto}"`);
    const tratamiento = raw?.tratamiento_iva == null ? null : String(raw.tratamiento_iva) as BudgetTaxTreatment;
    if (tratamiento && !TAX_TREATMENTS.includes(tratamiento)) throw new BudgetValidationError('EXP007_INVALID_TAX_TREATMENT', 'El tratamiento fiscal no es válido.');
    const ivaTasa = raw?.iva_tasa == null ? null : String(raw.iva_tasa);
    if (ivaTasa != null) rateToPpm(ivaTasa);
    if (categoria !== 'OTRO_GASTO' && (tratamiento || ivaTasa)) throw new BudgetValidationError('EXP007_TAX_TREATMENT_CATEGORY', 'El tratamiento de otros gastos no corresponde a esta categoría.');
    if (categoria === 'OTRO_GASTO' && tratamiento === 'GRAVADO' && (!ivaTasa || rateToPpm(ivaTasa) === 0n)) throw new BudgetValidationError('EXP007_TAX_RATE_REQUIRED', 'Un gasto gravado requiere una tasa configurada.');
    if (categoria === 'OTRO_GASTO' && tratamiento !== 'GRAVADO' && ivaTasa != null) throw new BudgetValidationError('EXP007_TAX_RATE_NOT_APPLICABLE', 'La tasa sólo corresponde a un gasto gravado.');
    const fuente = raw?.regla_fiscal_fuente == null ? null : preserveFormatText(raw.regla_fiscal_fuente, 240);
    const version = raw?.regla_fiscal_version == null ? null : preserveFormatText(raw.regla_fiscal_version, 80);
    return { id: raw?.id ? String(raw.id) : undefined, concepto, categoria, importe: centsToMoney(importeCents), importeCents, orden,
      tratamiento_iva: tratamiento, iva_tasa: ivaTasa, regla_fiscal_fuente: fuente, regla_fiscal_version: version };
  });
}

export function normalizeEditableBudgetConcepts(input: unknown): NormalizedBudgetConcept[] {
  const concepts = normalizeBudgetConcepts(input);
  if (concepts.some((item) => item.categoria === 'IVA_HONORARIOS')) throw new BudgetValidationError('EXP007_MANUAL_VAT_DENIED', 'El IVA de honorarios se calcula automáticamente; no puede capturarse como partida.');
  for (const item of concepts) {
    if (item.categoria !== 'OTRO_GASTO') continue;
    if (!item.tratamiento_iva) throw new BudgetValidationError('EXP007_OTHER_TAX_TREATMENT_REQUIRED', 'Selecciona el tratamiento fiscal del otro gasto.');
    if (item.tratamiento_iva !== 'REQUIERE_REVISION' && (!item.regla_fiscal_fuente || !item.regla_fiscal_version)) {
      throw new BudgetValidationError('EXP007_OTHER_TAX_SOURCE_REQUIRED', 'El tratamiento del otro gasto requiere fuente y versión explícitas.');
    }
  }
  return concepts;
}

export function withDerivedHonorariosIva(concepts: NormalizedBudgetConcept[]): NormalizedBudgetConcept[] {
  if (concepts.some((item) => item.categoria === 'IVA_HONORARIOS')) throw new BudgetValidationError('EXP007_MANUAL_VAT_DENIED', 'El IVA de honorarios no es una partida editable.');
  const fees = concepts.filter((item) => item.categoria === 'HONORARIOS').reduce((sum, item) => sum + item.importeCents, 0n);
  const vat = roundTax(fees, '0.16');
  return [...concepts, ...(vat ? [{ concepto: 'IVA de honorarios (16 %)', categoria: 'IVA_HONORARIOS' as const,
    importe: centsToMoney(vat), importeCents: vat, orden: concepts.length,
    tratamiento_iva: null, iva_tasa: null, regla_fiscal_fuente: null, regla_fiscal_version: null }] : [])];
}

export function budgetTotals(concepts: Array<Pick<NormalizedBudgetConcept, 'categoria' | 'importeCents'> & Partial<Pick<NormalizedBudgetConcept, 'tratamiento_iva' | 'iva_tasa'>>>) {
  const honorariosCents = concepts.filter((item) => item.categoria === 'HONORARIOS').reduce((sum, item) => sum + item.importeCents, 0n);
  const ivaHonorariosCents = concepts.filter((item) => item.categoria === 'IVA_HONORARIOS').reduce((sum, item) => sum + item.importeCents, 0n);
  const impuestosDerechosCents = concepts.filter((item) => item.categoria === 'IMPUESTOS_DERECHOS').reduce((sum, item) => sum + item.importeCents, 0n);
  const otros = concepts.filter((item) => item.categoria === 'OTRO_GASTO');
  const otrosGastosCents = otros.reduce((sum, item) => sum + item.importeCents, 0n);
  const ivaOtrosGastosCents = otros.reduce((sum, item) => sum + (item.tratamiento_iva === 'GRAVADO' && item.iva_tasa ? roundTax(item.importeCents, item.iva_tasa) : 0n), 0n);
  const subtotalOtrosGastosCents = otrosGastosCents + ivaOtrosGastosCents;
  return {
    honorarios: centsToMoney(honorariosCents), iva_honorarios: centsToMoney(ivaHonorariosCents),
    subtotal_honorarios: centsToMoney(honorariosCents + ivaHonorariosCents),
    subtotal_impuestos_derechos: centsToMoney(impuestosDerechosCents),
    otros_gastos: centsToMoney(otrosGastosCents), iva_otros_gastos: centsToMoney(ivaOtrosGastosCents), subtotal_otros_gastos: centsToMoney(subtotalOtrosGastosCents),
    total: centsToMoney(honorariosCents + ivaHonorariosCents + impuestosDerechosCents + subtotalOtrosGastosCents),
    // Preserve issued legacy amounts, but never certify a historical fee/VAT
    // combination that cannot be explained by the current 16% rule. A tax
    // exception needs an explicit, versioned source before it can be accepted.
    requiresReview: otros.some((item) => item.tratamiento_iva === 'REQUIERE_REVISION')
      || (honorariosCents > 0n && ivaHonorariosCents !== roundTax(honorariosCents, '0.16')),
    honorariosCents, ivaHonorariosCents, impuestosDerechosCents, otrosGastosCents, ivaOtrosGastosCents, subtotalOtrosGastosCents,
  };
}

export type DistributionEdit = { mode: 'AMOUNT' | 'PERCENT'; value: MoneyInput };
export type DistributionInput = { pravia_honorarios: DistributionEdit; pravia_iva: DistributionEdit };

const resolvePart = (pool: bigint, edit: DistributionEdit, label: string) => {
  const part = edit.mode === 'PERCENT' ? centsFromPercentage(pool, edit.value) : moneyToCents(edit.value, label);
  if (part > pool) throw new BudgetValidationError('EXP007_DISTRIBUTION_EXCEEDS_POOL', `${label} no puede superar el importe distribuible.`);
  return part;
};

export function calculateDistribution(totals: ReturnType<typeof budgetTotals>, input: DistributionInput) {
  const praviaHonorarios = resolvePart(totals.honorariosCents, input.pravia_honorarios, 'Los honorarios PRAVIA');
  const praviaIva = resolvePart(totals.ivaHonorariosCents, input.pravia_iva, 'El IVA PRAVIA');
  const notariaHonorarios = totals.honorariosCents - praviaHonorarios;
  const notariaIva = totals.ivaHonorariosCents - praviaIva;
  return {
    pravia: {
      honorarios: centsToMoney(praviaHonorarios), honorarios_porcentaje: percentageFromCents(praviaHonorarios, totals.honorariosCents),
      iva: centsToMoney(praviaIva), iva_porcentaje: percentageFromCents(praviaIva, totals.ivaHonorariosCents),
    },
    notaria: {
      honorarios: centsToMoney(notariaHonorarios), honorarios_porcentaje: percentageFromCents(notariaHonorarios, totals.honorariosCents),
      iva: centsToMoney(notariaIva), iva_porcentaje: percentageFromCents(notariaIva, totals.ivaHonorariosCents),
    },
  };
}

export function quoteCategoryToBudget(category: unknown, concept: unknown): BudgetCategory {
  const normalized = String(category || '').toUpperCase();
  if (normalized === 'HONORARIOS') return /\bIVA\b/i.test(String(concept || '')) ? 'IVA_HONORARIOS' : 'HONORARIOS';
  if (normalized === 'OTRO_GASTO' || normalized === 'OTROS' || normalized === 'GASTOS') return 'OTRO_GASTO';
  return 'IMPUESTOS_DERECHOS';
}

export type ClientBudgetPdfData = {
  folio: string; client: string; notary: string; generatedDate: string;
  concepts: Array<{ concept: string; categoryLabel: string; amount: string }>;
  subtotalHonorarios: string; subtotalImpuestosDerechos: string; total: string; optionalNote?: string;
};

const pdfText = (value: string) => value.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)').replace(/[^\x20-\xFF]/g, ' ');
export function renderClientBudgetPdf(data: ClientBudgetPdfData): Buffer {
  const lines = [
    'PRAVIA OS', 'PRESUPUESTO', `Expediente: ${data.folio}`, `Cliente: ${data.client}`,
    `Notaria: ${data.notary}`, `Fecha: ${data.generatedDate}`, '',
    ...data.concepts.map((item) => `${item.categoryLabel} | ${item.concept} | $${item.amount} MXN`), '',
    `Subtotal Honorarios: $${data.subtotalHonorarios} MXN`,
    `Subtotal Impuestos y derechos: $${data.subtotalImpuestosDerechos} MXN`,
    `TOTAL: $${data.total} MXN`,
    ...(data.optionalNote ? ['', `Nota: ${data.optionalNote}`] : []),
  ];
  let y = 760;
  const content = lines.map((line, index) => {
    const size = index === 1 ? 18 : index === lines.length - 1 && line.startsWith('TOTAL') ? 14 : 10;
    const command = `BT /F1 ${size} Tf 54 ${y} Td (${pdfText(line)}) Tj ET`;
    y -= line ? 18 : 9;
    return command;
  }).join('\n');
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',
    `<< /Length ${Buffer.byteLength(content, 'latin1')} >>\nstream\n${content}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let pdf = '%PDF-1.4\n';
  const offsets = [0];
  objects.forEach((object, index) => { offsets.push(Buffer.byteLength(pdf, 'latin1')); pdf += `${index + 1} 0 obj\n${object}\nendobj\n`; });
  const xref = Buffer.byteLength(pdf, 'latin1');
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.slice(1).map((offset) => `${String(offset).padStart(10, '0')} 00000 n `).join('\n')}\n`;
  pdf += `trailer << /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(pdf, 'latin1');
}
