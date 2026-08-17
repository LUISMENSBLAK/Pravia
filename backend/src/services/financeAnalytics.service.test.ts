import { describe, expect, it, vi } from 'vitest';
import { FinanceAnalyticsService, resolveFinancePeriod } from './financeAnalytics.service';

describe('FinanceAnalyticsService', () => {
  it('mantiene sin clasificar el ingreso histórico que no tiene distribución', async () => {
    const db: any = {
      movimientoFinanciero: {
        findMany: vi.fn().mockResolvedValue([{
          naturaleza: 'INGRESO', monto: 1_000, estatus: 'VALIDADO', categoria: 'CLIENTE_FONDOS',
          fecha_movimiento: new Date('2026-08-10T12:00:00Z'), distribuciones: [],
        }]),
      },
      honorarioGenerado: { findMany: vi.fn().mockResolvedValue([]) },
    };
    const result = await new FinanceAnalyticsService(db).summary(resolveFinancePeriod({ periodo: 'ESTE_MES' }, new Date('2026-08-17T12:00:00Z')));
    expect(result.kpis).toMatchObject({ ingresos_recibidos: 1_000, honorarios_cobrados: 0, fondos_terceros: 0, otros_destinos: 1_000 });
    expect(result.allocation).toEqual({ despacho: 0, terceros: 0, otros: 1_000 });
  });

  it('reconcilia honorarios generados, cobrados y por cobrar sin usar el total recibido', async () => {
    const db: any = {
      movimientoFinanciero: {
        findMany: vi.fn().mockResolvedValue([{
          naturaleza: 'INGRESO', monto: 60_000, estatus: 'APLICADO', categoria: 'DISTRIBUIDO',
          fecha_movimiento: new Date('2026-08-10T12:00:00Z'),
          distribuciones: [
            { monto: 40_000, categoria: { naturaleza: 'DESPACHO' } },
            { monto: 20_000, categoria: { naturaleza: 'TERCERO' } },
          ],
        }]),
      },
      honorarioGenerado: { findMany: vi.fn().mockResolvedValue([{ monto: 100_000 }]) },
    };
    const result = await new FinanceAnalyticsService(db).summary(resolveFinancePeriod({ periodo: 'ESTE_MES' }, new Date('2026-08-17T12:00:00Z')));
    expect(result.kpis).toMatchObject({ ingresos_recibidos: 60_000, honorarios_generados: 100_000, honorarios_cobrados: 40_000, fondos_terceros: 20_000, honorarios_por_cobrar: 60_000 });
  });

  it('calcula por cobrar al corte sin perder cobros de periodos anteriores', async () => {
    const currentMovement = {
      naturaleza: 'INGRESO', monto: 10_000, estatus: 'APLICADO', categoria: 'DISTRIBUIDO',
      fecha_movimiento: new Date('2026-08-10T12:00:00Z'),
      distribuciones: [{ monto: 10_000, categoria: { naturaleza: 'DESPACHO' } }],
    };
    const previousMovement = {
      naturaleza: 'INGRESO', monto: 30_000, estatus: 'APLICADO', categoria: 'DISTRIBUIDO',
      fecha_movimiento: new Date('2026-07-10T12:00:00Z'),
      distribuciones: [{ monto: 30_000, categoria: { naturaleza: 'DESPACHO' } }],
    };
    const db: any = {
      movimientoFinanciero: {
        findMany: vi.fn()
          .mockResolvedValueOnce([currentMovement])
          .mockResolvedValueOnce([previousMovement, currentMovement]),
      },
      honorarioGenerado: { findMany: vi.fn().mockResolvedValue([{ monto: 100_000 }]) },
    };
    const result = await new FinanceAnalyticsService(db).summary(resolveFinancePeriod({ periodo: 'ESTE_MES' }, new Date('2026-08-17T12:00:00Z')));
    expect(result.kpis).toMatchObject({
      ingresos_recibidos: 10_000,
      honorarios_cobrados: 10_000,
      honorarios_generados: 100_000,
      honorarios_por_cobrar: 60_000,
    });
  });

  it('mantiene los totales completos de cartera aunque la respuesta esté paginada', async () => {
    const record = (id: string, generated: number, collected: number) => ({
      id,
      monto: generated,
      expediente: { id: `exp-${id}`, numero_pravia: `EXP-${id}`, cliente_alias: `Cliente ${id}` },
      cotizacion: { id: `cot-${id}`, numero_cotizacion: `COT-${id}`, prospecto: { nombre: `Cliente ${id}` } },
      responsable: null,
      notaria: null,
      fecha_reconocimiento: new Date('2026-08-01T12:00:00Z'),
      fecha_vencimiento: null,
      distribuciones: collected ? [{ monto: collected }] : [],
    });
    const db: any = {
      honorarioGenerado: { findMany: vi.fn().mockResolvedValue([record('1', 100_000, 40_000), record('2', 80_000, 20_000)]) },
    };
    const result = await new FinanceAnalyticsService(db).receivables({ page: 1, pageSize: 1 });
    expect(result.items).toHaveLength(1);
    expect(result.meta).toMatchObject({ total: 2, totalPages: 2, totals: { generated: 180_000, collected: 60_000, pending: 120_000 } });
  });
});
