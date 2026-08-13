import { describe, expect, it } from 'vitest';
import {
  assertMovementApplicable,
  calculateFinanceAggregates,
  calculateReceivable,
  canMutateFinancialRecord,
  reconciliationReasons,
  reconciliationScore,
  validateDistribution,
} from './financeCore';

describe('dominio financiero canónico', () => {
  it('acepta una distribución exacta y evita errores de centavos', () => {
    expect(validateDistribution(100_000, [{ amount: 30_000 }, { amount: 70_000 }])).toEqual({ total: 100000, classified: 100000, pending: 0, balanced: true });
    expect(validateDistribution(0.3, [{ amount: 0.1 }, { amount: 0.2 }]).balanced).toBe(true);
  });

  it('expone el importe pendiente de clasificar', () => {
    expect(validateDistribution(100_000, [{ amount: 80_000 }])).toMatchObject({ pending: 20_000, balanced: false });
  });

  it('rechaza importes y distribuciones inválidas', () => {
    expect(() => validateDistribution(0, [{ amount: 1 }])).toThrow('mayor a cero');
    expect(() => validateDistribution(1, [])).toThrow('clasificación');
    expect(() => validateDistribution(1, [{ amount: -1 }])).toThrow('Cada clasificación');
  });

  it('impide aplicar sin comprobante interno vigente', () => {
    expect(() => assertMovementApplicable({ status: 'PENDIENTE_COMPROBANTE', total: 100, allocations: [{ amount: 100 }] })).toThrow('Falta un comprobante');
    expect(() => assertMovementApplicable({ status: 'LISTO_APLICAR', total: 100, allocations: [{ amount: 100 }], receipt: { status: 'ANULADO' } })).toThrow('Falta un comprobante');
  });

  it('impide aplicar una distribución descuadrada', () => {
    expect(() => assertMovementApplicable({ status: 'LISTO_APLICAR', total: 100, allocations: [{ amount: 80 }], receipt: { status: 'VIGENTE' } })).toThrow('no coinciden');
  });

  it('hace idempotente la segunda aplicación', () => {
    expect(assertMovementApplicable({ status: 'APLICADO', total: 100, allocations: [{ amount: 100 }], receipt: { status: 'VIGENTE' } }).idempotent).toBe(true);
  });

  it('separa efectivo, honorarios y fondos de terceros', () => {
    const result = calculateFinanceAggregates({
      generatedFees: [10_000],
      movements: [{ nature: 'INGRESO', amount: 20_000, status: 'APLICADO', allocations: [{ nature: 'DESPACHO', amount: 5_000 }, { nature: 'TERCERO', amount: 15_000 }] }],
    });
    expect(result).toMatchObject({ ingresos_recibidos: 20_000, honorarios_generados: 10_000, honorarios_cobrados: 5_000, honorarios_por_cobrar: 5_000, fondos_terceros: 15_000 });
  });

  it('explica otros destinos no propios sin incluirlos silenciosamente como terceros', () => {
    const result = calculateFinanceAggregates({
      generatedFees: [390_000],
      movements: [{ nature: 'INGRESO', amount: 830_000, status: 'APLICADO', allocations: [{ nature: 'DESPACHO', amount: 312_000 }, { nature: 'TERCERO', amount: 498_000 }, { nature: 'OTRO', amount: 20_000 }] }],
    });
    expect(result).toMatchObject({ ingresos_recibidos: 830_000, honorarios_cobrados: 312_000, fondos_terceros: 498_000, otros_destinos: 20_000, honorarios_por_cobrar: 78_000 });
    expect(result.honorarios_cobrados + result.fondos_terceros + result.otros_destinos).toBe(result.ingresos_recibidos);
  });

  it('no cuenta borradores ni convierte terceros en honorarios', () => {
    const result = calculateFinanceAggregates({
      generatedFees: [10_000],
      movements: [{ nature: 'INGRESO', amount: 99_000, status: 'BORRADOR', allocations: [{ nature: 'DESPACHO', amount: 99_000 }] }, { nature: 'INGRESO', amount: 5_000, status: 'APLICADO', allocations: [{ nature: 'TERCERO', amount: 5_000 }] }],
    });
    expect(result.honorarios_cobrados).toBe(0);
    expect(result.ingresos_recibidos).toBe(5_000);
  });

  it('calcula egresos y fondos de terceros aún pendientes de entregar', () => {
    const result = calculateFinanceAggregates({
      generatedFees: [],
      movements: [
        { nature: 'INGRESO', amount: 10_000, status: 'APLICADO', allocations: [{ nature: 'TERCERO', amount: 10_000 }] },
        { nature: 'EGRESO', amount: 4_000, status: 'APLICADO', allocations: [{ nature: 'TERCERO', amount: 4_000 }] },
      ],
    });
    expect(result).toMatchObject({ egresos: 4_000, fondos_terceros_pendientes: 6_000 });
  });

  it('deriva cartera de honorarios, no del valor de operación', () => {
    expect(calculateReceivable({ generated: 10_000, collected: 5_000 })).toMatchObject({ pending: 5_000, bucket: null });
  });

  it('sólo calcula aging con vencimiento fiable', () => {
    const result = calculateReceivable({ generated: 10_000, collected: 0, dueDate: new Date('2026-05-01T00:00:00Z'), now: new Date('2026-08-12T00:00:00Z') });
    expect(result.bucket).toBe('91_120');
  });

  it('sugiere conciliación sin volverla automática', () => {
    const exact = { movementAmount: 35_000, bankAmount: 35_000, movementDate: new Date('2026-08-12'), bankDate: new Date('2026-08-12'), movementReference: 'SPEI 42', bankReference: 'SPEI 42', sameAccount: true };
    expect(reconciliationScore(exact)).toBe(100);
    expect(reconciliationReasons(exact)).toEqual(['Importe exacto', 'Misma cuenta', 'Misma fecha', 'Referencia coincidente']);
    expect(reconciliationScore({ movementAmount: 35_000, bankAmount: 34_000, movementDate: new Date(), bankDate: new Date(), sameAccount: true })).toBe(0);
  });

  it('protege la inmutabilidad de aplicados y reversados', () => {
    expect(canMutateFinancialRecord('BORRADOR')).toBe(true);
    expect(canMutateFinancialRecord('APLICADO')).toBe(false);
    expect(canMutateFinancialRecord('REVERTIDO')).toBe(false);
  });
});
