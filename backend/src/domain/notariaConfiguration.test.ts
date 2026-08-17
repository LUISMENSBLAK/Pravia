import { describe, expect, it } from 'vitest';
import { normalizeWeeklySchedule, optionalEstimatedDays } from './notariaConfiguration';

describe('configuración estructurada de Notarías', () => {
  it('acepta días abiertos y cerrados sin completar días ausentes', () => {
    expect(normalizeWeeklySchedule({
      lunes: { cerrado: false, apertura: '09:00', cierre: '17:00' },
      domingo: { cerrado: true },
    })).toEqual({
      lunes: { cerrado: false, apertura: '09:00', cierre: '17:00' },
      domingo: { cerrado: true },
    });
  });

  it('rechaza horas ambiguas, rangos invertidos y días inventados', () => {
    expect(() => normalizeWeeklySchedule({ lunes: { cerrado: false, apertura: '9', cierre: '17:00' } })).toThrow(/lunes/);
    expect(() => normalizeWeeklySchedule({ lunes: { cerrado: false, apertura: '18:00', cierre: '17:00' } })).toThrow(/lunes/);
    expect(() => normalizeWeeklySchedule({ festivo: { cerrado: true } })).toThrow(/día no válido/);
  });

  it('valida duraciones explícitas en días y permite null', () => {
    expect(optionalEstimatedDays('12', 'Tiempo')).toBe(12);
    expect(optionalEstimatedDays(null, 'Tiempo')).toBeNull();
    expect(optionalEstimatedDays(undefined, 'Tiempo')).toBeUndefined();
    expect(() => optionalEstimatedDays(0, 'Tiempo')).toThrow(/1 y 365/);
  });
});
