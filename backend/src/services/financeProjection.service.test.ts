import { describe, expect, it, vi } from 'vitest';
import { businessDaysUntil, FinanceProjectionService, parseFinancialQuery } from './financeProjection.service';

describe('FinanceProjectionService', () => {
  it.each([
    ['honorarios cobrados por abogado en 3 meses', { metric: 'COLLECTED', groupBy: 'LAWYER', period: '3_MESES', chart: 'BAR' }],
    ['pendientes por estado durante un año', { metric: 'OUTSTANDING', groupBy: 'STATUS', period: '1_ANO', chart: 'STACKED_BAR' }],
    ['egresos por acto últimos 30 días', { metric: 'EXPENSES', groupBy: 'ACT', period: '30_DIAS', chart: 'BAR' }],
    ['recursos no propios esta semana', { metric: 'THIRD_PARTY', groupBy: 'PERIOD', period: '7_DIAS', chart: 'BAR' }],
  ])('convierte lenguaje financiero en plan tipado sin SQL: %s', (query, expected) => {
    expect(parseFinancialQuery(query)).toEqual(expected);
  });

  it('cuenta días hábiles para los hitos 5/3/0 sin contar fin de semana', () => {
    expect(businessDaysUntil(new Date('2026-09-28T09:00:00'), new Date('2026-10-05T09:00:00'))).toBe(5);
    expect(businessDaysUntil(new Date('2026-10-01T09:00:00'), new Date('2026-10-06T09:00:00'))).toBe(3);
    expect(businessDaysUntil(new Date('2026-10-06T09:00:00'), new Date('2026-10-06T18:00:00'))).toBe(0);
  });

  it('scopea toda agregación avanzada a la organización activa', async () => {
    const honorarioGenerado = { findMany: vi.fn().mockResolvedValue([]) };
    const movimientoFinanciero = { findMany: vi.fn().mockResolvedValueOnce([]).mockResolvedValueOnce([]) };
    const expedientePresupuesto = { findMany: vi.fn().mockResolvedValue([]) };
    const gastoRecurrenteFinanciero = { findMany: vi.fn().mockResolvedValue([]) };
    const db: any = { honorarioGenerado, movimientoFinanciero, expedientePresupuesto, gastoRecurrenteFinanciero };
    await new FinanceProjectionService(db).additions(
      { from: new Date('2026-09-01T00:00:00Z'), to: new Date('2026-09-30T23:59:59Z'), key: '30_DIAS', label: 'Septiembre' },
      new Date('2026-09-28T12:00:00Z'),
      'org-active',
    );
    expect(honorarioGenerado.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ organization_id: 'org-active' }) }));
    expect(expedientePresupuesto.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ organization_id: 'org-active' }) }));
    expect(gastoRecurrenteFinanciero.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ organization_id: 'org-active' }) }));
    for (const call of movimientoFinanciero.findMany.mock.calls) expect(call[0].where.organization_id).toBe('org-active');
  });

  it('mantiene recursos no propios fuera del ingreso del despacho y reduce la proyección al cobrar', async () => {
    const db: any = {
      honorarioGenerado: { findMany: vi.fn().mockResolvedValue([{
        id: 'fee-1', monto: 100_000, fecha_reconocimiento: new Date('2026-09-02'), fecha_vencimiento: null,
        responsable: { id: 'lawyer-1', nombre: 'Ana', apellido: 'López' },
        expediente: { id: 'exp-1', numero_pravia: 'EXP-0001-2026', cliente_alias: 'Cliente', fecha_estimada_firma: new Date('2026-10-15'), actos: [{ tipo_acto: { nombre: 'Compraventa' } }] },
        distribuciones: [{ monto: 40_000, movimiento: { id: 'mov-1', fecha_movimiento: new Date('2026-09-10') } }],
      }]) },
      movimientoFinanciero: { findMany: vi.fn().mockResolvedValueOnce([{ id: 'mov-third', naturaleza: 'INGRESO', monto: 20_000, fecha_movimiento: new Date('2026-09-10'), concepto: 'Derechos', expediente_id: 'exp-1', expediente: { id: 'exp-1', numero_pravia: 'EXP-0001-2026' }, responsable: null, distribuciones: [{ monto: 20_000, categoria: { naturaleza: 'TERCERO' } }] }]).mockResolvedValueOnce([]) },
      expedientePresupuesto: { findMany: vi.fn().mockResolvedValue([]) },
      gastoRecurrenteFinanciero: { findMany: vi.fn().mockResolvedValue([]) },
    };
    const result = await new FinanceProjectionService(db).additions({ from: new Date('2026-09-01'), to: new Date('2026-09-30T23:59:59'), key: '30_DIAS', label: '30 días' }, new Date('2026-09-28'), 'org-1');
    expect(result.collectionStatus).toMatchObject({ collected: 40_000, outstanding: 60_000 });
    expect(result.projection.months).toEqual(expect.arrayContaining([expect.objectContaining({ period: '2026-10', fees: 60_000 })]));
    expect(result.recentMovements[0]).toMatchObject({ origin: 'EXPEDIENTE', amount: 20_000 });
  });
});
