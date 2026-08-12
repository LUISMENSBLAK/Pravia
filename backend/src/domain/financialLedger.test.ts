import { describe, expect, it } from 'vitest';
import {
  calculateFinancialPosition,
  normalizeFinancialCategory,
  validateMovementSemantics,
} from './financialLedger';

describe('libro financiero PRAVIA', () => {
  it('no convierte automáticamente dinero del cliente en ingreso PRAVIA', () => {
    const result = calculateFinancialPosition({
      totalCliente: 100_000,
      participacionPravia: 20_000,
      movements: [{ naturaleza: 'INGRESO', categoria: 'CLIENTE_FONDOS', tipo_movimiento: 'ANTICIPO', monto: 50_000, estatus: 'RECIBIDO' }],
    });
    expect(result.recibido_cliente_neto).toBe(50_000);
    expect(result.honorarios_pravia_recibidos).toBe(0);
    expect(result.fondos_retenidos).toBe(50_000);
  });

  it('reconoce honorarios solo cuando la categoría es explícita', () => {
    const result = calculateFinancialPosition({
      totalCliente: 100_000,
      participacionPravia: 20_000,
      movements: [
        { naturaleza: 'INGRESO', categoria: 'HONORARIOS_PRAVIA', tipo_movimiento: 'ABONO', monto: 10_000, estatus: 'VALIDADO' },
        { naturaleza: 'EGRESO', categoria: 'PRAVIA', tipo_movimiento: 'EGRESO_TERCEROS', monto: 2_000, estatus: 'VALIDADO' },
      ],
    });
    expect(result.honorarios_pravia_recibidos).toBe(10_000);
    expect(result.utilidad_pravia).toBe(8_000);
  });

  it('separa saldo del cliente y saldo a terceros', () => {
    const result = calculateFinancialPosition({
      totalCliente: 100_000,
      participacionPravia: 20_000,
      movements: [
        { naturaleza: 'INGRESO', categoria: 'CLIENTE_FONDOS', tipo_movimiento: 'PAGO_UNICO', monto: 100_000, estatus: 'RECIBIDO' },
        { naturaleza: 'EGRESO', categoria: 'NOTARIA', tipo_movimiento: 'EGRESO_NOTARIA', monto: 50_000, estatus: 'VALIDADO' },
      ],
    });
    expect(result.saldo_cliente).toBe(0);
    expect(result.saldo_terceros).toBe(30_000);
  });

  it('normaliza aliases y rechaza categorías libres', () => {
    expect(normalizeFinancialCategory('honorarios')).toBe('HONORARIOS_PRAVIA');
    expect(() => normalizeFinancialCategory('cualquier cosa')).toThrow();
  });

  it('impide inconsistencias entre tipo y naturaleza', () => {
    expect(() => validateMovementSemantics({ tipo: 'EGRESO_NOTARIA', naturaleza: 'INGRESO', categoria: 'NOTARIA', monto: 1 })).toThrow();
  });

  it('no vuelve a contabilizar el renglón técnico de un reverso', () => {
    const result = calculateFinancialPosition({
      totalCliente: 100_000,
      participacionPravia: 20_000,
      movements: [
        { naturaleza: 'EGRESO', categoria: 'REVERSO', tipo_movimiento: 'DEVOLUCION', monto: 25_000, estatus: 'VALIDADO' },
      ],
    });
    expect(result.recibido_cliente_neto).toBe(0);
    expect(result.fondos_retenidos).toBe(0);
  });
});
