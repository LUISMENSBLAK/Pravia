import { describe, expect, it } from 'vitest';
import {
  canonicalFeeCohortTotals,
  reportingCalendarRanges,
  reportFinancialTotals,
  resolveReportingPeriod,
  sortAndLimitEconomicRows,
  targetProgress,
} from './reportingCore';

describe('reporting core', () => {
  it('resuelve Esta semana de lunes a domingo en la zona configurada', () => {
    const period = resolveReportingPeriod({ periodo: 'ESTA_SEMANA', timezone: 'America/Mexico_City' }, new Date('2026-08-13T18:00:00Z'));
    expect(period.key).toBe('ESTA_SEMANA');
    expect(period.timezone).toBe('America/Mexico_City');
    expect(new Intl.DateTimeFormat('en-US', { timeZone: period.timezone, weekday: 'short' }).format(period.from)).toBe('Mon');
    expect(new Intl.DateTimeFormat('en-US', { timeZone: period.timezone, weekday: 'short' }).format(period.to)).toBe('Sun');
  });

  it('resuelve mes anterior, trimestre, año y personalizado con límites válidos', () => {
    const now = new Date('2026-08-13T18:00:00Z');
    const timezone = 'America/Mexico_City';
    expect(new Intl.DateTimeFormat('en-CA', { timeZone: timezone, month: '2-digit' }).format(resolveReportingPeriod({ periodo: 'MES_ANTERIOR', timezone }, now).from)).toBe('07');
    expect(new Intl.DateTimeFormat('en-CA', { timeZone: timezone, month: '2-digit' }).format(resolveReportingPeriod({ periodo: 'ESTE_TRIMESTRE', timezone }, now).from)).toBe('07');
    expect(new Intl.DateTimeFormat('en-CA', { timeZone: timezone, month: '2-digit' }).format(resolveReportingPeriod({ periodo: 'ESTE_ANO', timezone }, now).from)).toBe('01');
    const custom = resolveReportingPeriod({ periodo: 'PERSONALIZADO', fecha_desde: '2026-02-01', fecha_hasta: '2026-02-28' }, now);
    expect(new Intl.DateTimeFormat('en-CA', { timeZone: custom.timezone }).format(custom.from)).toBe('2026-02-01');
    expect(new Intl.DateTimeFormat('en-CA', { timeZone: custom.timezone }).format(custom.to)).toBe('2026-02-28');
    expect(() => resolveReportingPeriod({ periodo: 'PERSONALIZADO', fecha_desde: '2026-03-01', fecha_hasta: '2026-02-01' }, now)).toThrow('periodo válido');
    const ranges = reportingCalendarRanges(timezone, now);
    expect(new Intl.DateTimeFormat('en-US', { timeZone: timezone, weekday: 'short' }).format(ranges.week.from)).toBe('Mon');
    expect(new Intl.DateTimeFormat('en-US', { timeZone: timezone, weekday: 'short' }).format(ranges.previousWeek.from)).toBe('Mon');
    expect(new Intl.DateTimeFormat('en-CA', { timeZone: timezone, month: '2-digit' }).format(ranges.nextMonth.from)).toBe('09');
  });

  it('reconcilia 390 mil generados, 312 mil cobrados y 78 mil por cobrar sin sumar terceros', () => {
    const movementTotals = reportFinancialTotals([], [{
      nature: 'INGRESO',
      amount: 830_000,
      status: 'APLICADO',
      allocations: [
        { nature: 'DESPACHO', amount: 312_000 },
        { nature: 'TERCERO', amount: 498_000 },
        { nature: 'OTRO', amount: 20_000 },
      ],
    }]);
    const result = canonicalFeeCohortTotals([{ generated: 390_000, collected: 312_000 }], movementTotals);
    expect(result).toMatchObject({ honorarios_generados: 390_000, honorarios_cobrados: 312_000, honorarios_por_cobrar: 78_000, fondos_terceros: 498_000 });
    expect(result.honorarios_generados).toBe(result.honorarios_cobrados + result.honorarios_por_cobrar);
  });

  it('no cuenta un movimiento sin aplicar ni lo convierte en honorario', () => {
    const totals = reportFinancialTotals([], [{ nature: 'INGRESO', amount: 900_000, status: 'BORRADOR', allocations: [{ nature: 'DESPACHO', amount: 900_000 }] }]);
    expect(totals).toMatchObject({ ingresos_recibidos: 0, honorarios_cobrados: 0 });
  });

  it('calcula metas y trata ausencia o importe cero sin porcentaje falso', () => {
    expect(targetProgress({ amount: 500_000, base: 'GENERADOS' }, { honorarios_generados: 350_000, honorarios_cobrados: 300_000 })).toMatchObject({ cumplimiento: 70, pendiente: 150_000 });
    expect(targetProgress(null, { honorarios_generados: 350_000, honorarios_cobrados: 300_000 })).toBeNull();
    expect(targetProgress({ amount: 0, base: 'GENERADOS' }, { honorarios_generados: 1, honorarios_cobrados: 1 })?.cumplimiento).toBeNull();
  });

  it('ordena 80/20 por importe computable explícito y limita a veinte', () => {
    const rows = [{ honorarios: 5_000, importe_computable: 50, id: 'C' }, { honorarios: 1, importe_computable: 200, id: 'A' }, { honorarios: 2, importe_computable: 150, id: 'B' }, ...Array.from({ length: 21 }, (_, index) => ({ honorarios: 9_000 - index, importe_computable: 49 - index, id: `X${index}` }))];
    const result = sortAndLimitEconomicRows(rows, 20);
    expect(result.slice(0, 3).map((item) => item.id)).toEqual(['A', 'B', 'C']);
    expect(result).toHaveLength(20);
  });
});
