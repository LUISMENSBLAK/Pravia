import { describe, expect, it, vi } from 'vitest';
import { FinancialMovementService } from './financialMovement.service';

const baseInput = {
  naturaleza: 'INGRESO', monto: 100_000, cuenta_id: 'account-1', concepto: 'Anticipo de cliente',
  tipo_movimiento: 'ANTICIPO', idempotency_key: 'idem-1',
  distribuciones: [{ categoria_id: 'cat-fees', monto: 30_000 }, { categoria_id: 'cat-rights', monto: 70_000 }],
};

function database(overrides: Record<string, unknown> = {}) {
  const tx: any = {
    $executeRaw: vi.fn(),
    $queryRawUnsafe: vi.fn().mockResolvedValue([{ value: 42n }]),
    categoriaFinanciera: { findMany: vi.fn().mockResolvedValue([{ id: 'cat-fees', nombre: 'Honorarios', direccion: 'INGRESO' }, { id: 'cat-rights', nombre: 'Derechos', direccion: 'AMBAS' }]) },
    cuentaFinanciera: { findFirst: vi.fn().mockResolvedValue({ id: 'account-1', activa: true }) },
    movimientoFinanciero: {
      findUnique: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockImplementation(({ data }) => ({ id: 'movement-1', ...data, distribuciones: data.distribuciones.create, cuenta: { id: 'account-1' } })),
      update: vi.fn().mockImplementation(({ data }) => ({ id: 'movement-1', ...data })),
    },
    movimientoDistribucion: { deleteMany: vi.fn(), createMany: vi.fn() },
    comprobanteFinanciero: { create: vi.fn().mockImplementation(({ data }) => ({ id: 'receipt-1', ...data })) },
    auditLog: { create: vi.fn() },
    ...overrides,
  };
  const db: any = { $transaction: vi.fn((callback) => callback(tx)) };
  return { db, tx, service: new FinancialMovementService(db) };
}

describe('FinancialMovementService', () => {
  it('crea un ingreso como pendiente de comprobante, nunca aplicado', async () => {
    const { service, tx } = database();
    const result = await service.createDraft(baseInput, 'actor-1', 'corr-1');
    expect(result.movement).toMatchObject({ folio: 'MOV-2026-000042', naturaleza: 'INGRESO', estatus: 'PENDIENTE_COMPROBANTE', monto: 100_000 });
    expect(tx.movimientoFinanciero.create.mock.calls[0][0].data.validado_por_id).toBeUndefined();
  });

  it('crea egresos sólo con categorías compatibles', async () => {
    const { service, tx } = database();
    tx.categoriaFinanciera.findMany.mockResolvedValue([{ id: 'cat-expense', nombre: 'Gastos', direccion: 'EGRESO' }]);
    const result = await service.createDraft({ ...baseInput, naturaleza: 'EGRESO', tipo_movimiento: 'EGRESO_TERCEROS', distribuciones: [{ categoria_id: 'cat-expense', monto: 100_000 }] }, 'actor-1');
    expect(result.movement).toMatchObject({ naturaleza: 'EGRESO', estatus: 'PENDIENTE_COMPROBANTE' });
  });

  it('rechaza categoría de ingreso en un egreso', async () => {
    const { service } = database();
    await expect(service.createDraft({ ...baseInput, naturaleza: 'EGRESO' }, 'actor-1')).rejects.toThrow('no corresponde');
  });

  it('respeta la clave de idempotencia y no crea dos movimientos', async () => {
    const existing = { id: 'movement-existing', idempotency_key: 'idem-1', distribuciones: [], comprobanteInterno: null };
    const { service, tx } = database();
    tx.movimientoFinanciero.findUnique.mockResolvedValue(existing);
    await expect(service.createDraft(baseInput, 'actor-1')).resolves.toEqual({ movement: existing, idempotent: true });
    expect(tx.movimientoFinanciero.create).not.toHaveBeenCalled();
  });

  it('aplica sólo con comprobante vigente y distribución cuadrada', async () => {
    const { service, tx } = database();
    tx.movimientoFinanciero.findUnique.mockResolvedValue({ id: 'movement-1', estatus: 'LISTO_APLICAR', monto: 100_000, distribuciones: [{ monto: 100_000 }], comprobanteInterno: { estado: 'VIGENTE' } });
    const result = await service.apply('movement-1', 'validator-1', 'corr-1');
    expect(result.idempotent).toBe(false);
    expect(tx.movimientoFinanciero.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ estatus: 'APLICADO', aplicado_por_id: 'validator-1' }) }));
  });

  it('cancela borradores con auditoría y exige reverso para aplicados', async () => {
    const first = database();
    first.tx.movimientoFinanciero.findUnique.mockResolvedValue({ id: 'movement-1', estatus: 'BORRADOR' });
    await first.service.cancelDraft('movement-1', 'actor-1', 'Captura duplicada');
    expect(first.tx.movimientoFinanciero.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ estatus: 'CANCELADO', motivo_cancelacion: 'Captura duplicada' }) }));
    const second = database();
    second.tx.movimientoFinanciero.findUnique.mockResolvedValue({ id: 'movement-2', estatus: 'APLICADO' });
    await expect(second.service.cancelDraft('movement-2', 'actor-1', 'Corrección')).rejects.toThrow('reverso');
  });

  it('revierte un aplicado con contramovimiento, comprobante y auditoría', async () => {
    const { service, tx } = database();
    tx.movimientoFinanciero.findUnique.mockResolvedValue({
      id: 'movement-1', folio: 'MOV-2026-000001', estatus: 'APLICADO', naturaleza: 'INGRESO', monto: 100_000,
      concepto: 'Anticipo', expediente_id: null, cotizacion_id: null, compareciente_id: null, notaria_id: null,
      responsable_id: null, cuenta_id: 'account-1', forma_pago: 'Transferencia', referencia: 'REF-1',
      cuenta: { institucion: 'Banco', alias: 'Operativa', ultimos_cuatro: '1234', moneda: 'MXN' }, expediente: null,
      comprobanteInterno: { estado: 'VIGENTE' }, reversosGenerados: [],
      distribuciones: [{ categoria_id: 'cat-fees', honorario_generado_id: null, monto: 100_000, categoria: { nombre: 'Honorarios', naturaleza: 'DESPACHO' } }],
    });
    tx.movimientoFinanciero.create.mockImplementation(({ data }: any) => ({ id: 'reverse-1', ...data, distribuciones: data.distribuciones.create }));
    const result = await service.reverseApplied('movement-1', 'validator-1', 'Depósito devuelto', 'corr-1');
    expect(result).toMatchObject({ idempotent: false, movement: { id: 'reverse-1', naturaleza: 'EGRESO', estatus: 'APLICADO', comprobanteInterno: { folio: 'COM-2026-000042' } } });
    expect(tx.movimientoFinanciero.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ estatus: 'REVERTIDO', motivo_reversion: 'Depósito devuelto' }) }));
    expect(tx.auditLog.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ accion: 'REVERSE_FINANCIAL_MOVEMENT' }) }));
  });
});
