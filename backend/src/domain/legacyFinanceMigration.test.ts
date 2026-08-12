import { describe, expect, it } from 'vitest';
import { classifyLegacyPayment, type LegacyPayment, type ModernMovement } from './legacyFinanceMigration';

const basePayment: LegacyPayment = {
  id: 'pago-1', expediente_id: 'exp-1', cotizacion_id: null,
  categoria_ingreso: 'ANTICIPO_NOTARIA', concepto: 'Anticipo de cliente', monto: 10_000,
  fecha_pago: new Date('2026-01-10T12:00:00Z'), fecha_registro: new Date('2026-01-10T12:00:00Z'), estatus: 'VALIDADO',
};

const movement = (overrides: Partial<ModernMovement> = {}): ModernMovement => ({
  id: 'mov-1', expediente_id: 'exp-1', cotizacion_id: null,
  tipo_movimiento: 'ANTICIPO', naturaleza: 'INGRESO', categoria: 'ANTICIPO_NOTARIA',
  concepto: 'Anticipo de cliente', monto: 10_000, fecha_movimiento: new Date('2026-01-10T18:00:00Z'),
  estatus: 'VALIDADO', referencia: null, ...overrides,
});

describe('legacy finance migration classifier', () => {
  it('solo propone una migración segura con equivalencia determinista', () => {
    const result = classifyLegacyPayment(basePayment, []);
    expect(result.classification).toBe('MIGRACION_SEGURA');
    expect(result.proposal).toMatchObject({ tipo_movimiento: 'ANTICIPO', monto: 10_000, referencia: 'legacy:pago:pago-1' });
  });

  it('reconoce un pago ya representado', () => {
    expect(classifyLegacyPayment(basePayment, [movement()]).classification).toBe('YA_REPRESENTADO');
  });

  it('marca como probable duplicado una coincidencia cercana no exacta', () => {
    expect(classifyLegacyPayment(basePayment, [movement({ concepto: 'Pago recibido' })]).classification).toBe('DUPLICADO_PROBABLE');
  });

  it('no convierte honorarios esperados en deuda ni efectivo', () => {
    const result = classifyLegacyPayment({ ...basePayment, categoria_ingreso: 'HONORARIOS_ESPERADOS' }, []);
    expect(result.classification).toBe('AMBIGUO');
    expect(result.proposal).toBeUndefined();
  });

  it('exige revisión si el registro no fue validado o no tiene objeto', () => {
    expect(classifyLegacyPayment({ ...basePayment, estatus: 'PENDIENTE' }, []).classification).toBe('REQUIERE_REVISION');
    expect(classifyLegacyPayment({ ...basePayment, expediente_id: null }, []).classification).toBe('REQUIERE_REVISION');
  });
});
