import { describe, expect, it } from 'vitest';
import { budgetTotals, normalizeBudgetConcepts, normalizeEditableBudgetConcepts, withDerivedHonorariosIva } from './expedienteBudget';

const corrected = (rows: unknown) => budgetTotals(withDerivedHonorariosIva(normalizeEditableBudgetConcepts(rows)));
const base = [
  { concepto: 'Honorarios', categoria: 'HONORARIOS', importe: '50000.00' },
  { concepto: 'Impuestos y derechos', categoria: 'IMPUESTOS_DERECHOS', importe: '20000.00' },
];

describe('Corrección presupuestaria · categorías, IVA derivado y centavos exactos', () => {
  it('reproduce el caso aprobado de $78,000', () => {
    const totals = corrected(base);
    expect(totals).toMatchObject({ honorarios: '50000.00', iva_honorarios: '8000.00', subtotal_honorarios: '58000.00', subtotal_impuestos_derechos: '20000.00', total: '78000.00' });
  });

  it('agrega otro gasto sin impuesto únicamente con tratamiento y fuente explícitos', () => {
    const totals = corrected([...base, { concepto: 'Avalúo', categoria: 'OTRO_GASTO', importe: '1500.00', tratamiento_iva: 'SIN_IMPUESTO', regla_fiscal_fuente: 'Regla QA aprobada', regla_fiscal_version: 'qa-v1' }]);
    expect(totals).toMatchObject({ otros_gastos: '1500.00', iva_otros_gastos: '0.00', subtotal_otros_gastos: '1500.00', total: '79500.00' });
  });

  it('sólo grava un gasto cuando la fixture aporta tasa, fuente y versión', () => {
    const totals = corrected([...base, { concepto: 'Gasto QA gravado', categoria: 'OTRO_GASTO', importe: '1500.00', tratamiento_iva: 'GRAVADO', iva_tasa: '0.160000', regla_fiscal_fuente: 'Fixture QA explícita', regla_fiscal_version: 'qa-v1' }]);
    expect(totals).toMatchObject({ iva_otros_gastos: '240.00', subtotal_otros_gastos: '1740.00', total: '79740.00' });
  });

  it('recalcula al agregar, editar y eliminar honorarios; redondea sólo al centavo', () => {
    expect(corrected([{ concepto: 'Honorarios', categoria: 'HONORARIOS', importe: '100.01' }]).iva_honorarios).toBe('16.00');
    expect(corrected([{ concepto: 'A', categoria: 'HONORARIOS', importe: '100.01' }, { concepto: 'B', categoria: 'HONORARIOS', importe: '0.02' }]).iva_honorarios).toBe('16.00');
    expect(corrected([{ concepto: 'A', categoria: 'HONORARIOS', importe: '100.04' }, { concepto: 'B', categoria: 'HONORARIOS', importe: '0.02' }]).iva_honorarios).toBe('16.01');
    expect(corrected([{ concepto: 'B', categoria: 'HONORARIOS', importe: '0.02' }]).iva_honorarios).toBe('0.00');
    expect(corrected([{ concepto: 'Honorarios cero', categoria: 'HONORARIOS', importe: '0.00' }]).total).toBe('0.00');
  });

  it('rechaza IVA manual y tratamiento fiscal de gasto sin fuente aprobada', () => {
    expect(() => normalizeEditableBudgetConcepts([{ concepto: 'IVA arbitrario', categoria: 'IVA_HONORARIOS', importe: '80000.00' }])).toThrowError(expect.objectContaining({ code: 'EXP007_MANUAL_VAT_DENIED' }));
    expect(() => normalizeEditableBudgetConcepts([{ concepto: 'Avalúo', categoria: 'OTRO_GASTO', importe: '1500.00', tratamiento_iva: 'GRAVADO', iva_tasa: '0.16' }])).toThrowError(expect.objectContaining({ code: 'EXP007_OTHER_TAX_SOURCE_REQUIRED' }));
  });

  it('no recalcula retroactivamente una fila IVA histórica', () => {
    const legacy = normalizeBudgetConcepts([{ concepto: 'Honorarios', categoria: 'HONORARIOS', importe: '50000.00' }, { concepto: 'IVA histórico', categoria: 'IVA_HONORARIOS', importe: '1000.00' }]);
    expect(budgetTotals(legacy).total).toBe('51000.00');
    expect(budgetTotals(legacy).requiresReview).toBe(true);
    const missingVat = normalizeBudgetConcepts([{ concepto: 'Honorarios', categoria: 'HONORARIOS', importe: '50000.00' }]);
    expect(budgetTotals(missingVat)).toMatchObject({ total: '50000.00', requiresReview: true });
  });
});
