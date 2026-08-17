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
    comprobanteFinanciero: { create: vi.fn().mockImplementation(({ data }) => ({ id: 'receipt-1', ...data })), update: vi.fn() },
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

  it('acepta distribución parcial, conserva el remanente y no la aplica', async () => {
    const { service, tx } = database();
    const result = await service.createDraft({
      ...baseInput,
      monto: 85_000,
      distribuciones: [{ categoria_id: 'cat-fees', monto: 30_000 }, { categoria_id: 'cat-rights', monto: 40_000 }],
    }, 'actor-1');
    expect(result.movement).toMatchObject({ monto: 85_000, estatus: 'BORRADOR' });
    expect(tx.movimientoFinanciero.create.mock.calls[0][0].data.distribuciones.create).toEqual([
      expect.objectContaining({ monto: 30_000 }),
      expect.objectContaining({ monto: 40_000 }),
    ]);
    expect(tx.comprobanteFinanciero.create).not.toHaveBeenCalled();
    expect(tx.movimientoFinanciero.update).not.toHaveBeenCalled();
  });

  it('rechaza 85K con distribución 30K + 70K antes de persistir', async () => {
    const { service, db, tx } = database();
    await expect(service.createDraft({
      ...baseInput,
      monto: 85_000,
      distribuciones: [{ categoria_id: 'cat-fees', monto: 30_000 }, { categoria_id: 'cat-rights', monto: 70_000 }],
    }, 'actor-1')).rejects.toMatchObject({ code: 'FINANCE_DISTRIBUTION_EXCEEDS_TOTAL', status: 400 });
    expect(db.$transaction).not.toHaveBeenCalled();
    expect(tx.movimientoFinanciero.create).not.toHaveBeenCalled();
  });

  it('permite reemplazo parcial y rechaza reemplazo excedido sin tocar filas', async () => {
    const partial = database();
    partial.tx.movimientoFinanciero.findUnique
      .mockResolvedValueOnce({ id: 'movement-1', naturaleza: 'INGRESO', estatus: 'PENDIENTE_COMPROBANTE', monto: 85_000, distribuciones: [], comprobanteInterno: null })
      .mockResolvedValueOnce({ id: 'movement-1', estatus: 'BORRADOR' });
    await partial.service.replaceDistribution('movement-1', [{ categoria_id: 'cat-fees', monto: 30_000 }, { categoria_id: 'cat-rights', monto: 40_000 }], 'actor-1');
    expect(partial.tx.movimientoDistribucion.createMany).toHaveBeenCalled();
    expect(partial.tx.movimientoFinanciero.update).toHaveBeenCalledWith(expect.objectContaining({ data: { estatus: 'BORRADOR' } }));

    const over = database();
    over.tx.movimientoFinanciero.findUnique.mockResolvedValue({ id: 'movement-1', naturaleza: 'INGRESO', estatus: 'BORRADOR', monto: 85_000, distribuciones: [], comprobanteInterno: null });
    await expect(over.service.replaceDistribution('movement-1', [{ categoria_id: 'cat-fees', monto: 30_000 }, { categoria_id: 'cat-rights', monto: 70_000 }], 'actor-1')).rejects.toMatchObject({ code: 'FINANCE_DISTRIBUTION_EXCEEDS_TOTAL' });
    expect(over.tx.movimientoDistribucion.deleteMany).not.toHaveBeenCalled();
    expect(over.tx.movimientoDistribucion.createMany).not.toHaveBeenCalled();
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

  it('retira únicamente el vínculo documental y conserva el movimiento', async () => {
    const movimientoDocumento = { updateMany: vi.fn().mockResolvedValue({ count: 1 }) };
    const { service, tx } = database({ movimientoDocumento });
    tx.movimientoFinanciero.findUnique.mockResolvedValue({ id: 'movement-1' });
    await expect(service.retireEvidence('movement-1', 'document-1', 'actor-1', 'Archivo sustituido', 'corr-1')).resolves.toMatchObject({ retired: true });
    expect(movimientoDocumento.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ movimiento_id: 'movement-1', documento_id: 'document-1', estatus: 'ACTIVO' }),
      data: expect.objectContaining({ estatus: 'INACTIVO', motivo_inactivacion: 'Archivo sustituido' }),
    }));
    expect(tx.movimientoFinanciero.update).not.toHaveBeenCalled();
    expect(tx.auditLog.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ accion: 'RETIRE_FINANCIAL_EVIDENCE' }) }));
  });

  it('no permite retirar un comprobante que no pertenece al movimiento', async () => {
    const movimientoDocumento = { updateMany: vi.fn().mockResolvedValue({ count: 0 }) };
    const { service, tx } = database({ movimientoDocumento });
    tx.movimientoFinanciero.findUnique.mockResolvedValue({ id: 'movement-1' });
    await expect(service.retireEvidence('movement-1', 'document-other', 'actor-1', 'Revisión')).rejects.toMatchObject({ code: 'FINANCE_EVIDENCE_NOT_FOUND', status: 404 });
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

  it('no replica una distribución histórica inválida al revertir', async () => {
    const { service, tx } = database();
    tx.movimientoFinanciero.findUnique.mockResolvedValue({
      id: 'movement-legacy', folio: 'MOV-2026-000142', estatus: 'APLICADO', naturaleza: 'INGRESO', monto: 85_000,
      reversosGenerados: [], distribuciones: [{ monto: 30_000 }, { monto: 70_000 }],
    });
    await expect(service.reverseApplied('movement-legacy', 'actor-1', 'Corrección')).rejects.toMatchObject({ code: 'FINANCE_DISTRIBUTION_EXCEEDS_TOTAL' });
    expect(tx.movimientoFinanciero.create).not.toHaveBeenCalled();
  });
});
