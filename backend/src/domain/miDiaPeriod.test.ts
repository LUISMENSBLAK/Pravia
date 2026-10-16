import { describe, expect, it } from 'vitest';
import { miDiaPeriodRange } from './miDiaPeriod';

describe('Mi Día local calendar periods', () => {
  const zone = 'America/Mexico_City';
  it('keeps a record near UTC midnight in the correct local day', () => {
    const now = new Date('2026-10-14T03:30:00.000Z'); // 13 Oct 21:30 in Mexico City
    const range = miDiaPeriodRange('TODAY', zone, now);
    expect(range.from.toISOString()).toBe('2026-10-13T06:00:00.000Z');
    expect(range.to.toISOString()).toBe('2026-10-14T06:00:00.000Z');
    expect(new Date('2026-10-14T05:59:59.999Z') >= range.from).toBe(true);
    expect(new Date('2026-10-14T06:00:00.000Z') < range.to).toBe(false);
  });
  it('uses canonical calendar week, month, quarter and year boundaries', () => {
    const now = new Date('2026-10-14T03:30:00.000Z');
    expect(miDiaPeriodRange('WEEK', zone, now).from.toISOString()).toBe('2026-10-12T06:00:00.000Z');
    expect(miDiaPeriodRange('MONTH', zone, now).from.toISOString()).toBe('2026-10-01T06:00:00.000Z');
    expect(miDiaPeriodRange('QUARTER', zone, now).from.toISOString()).toBe('2026-10-01T06:00:00.000Z');
    expect(miDiaPeriodRange('YEAR', zone, now).from.toISOString()).toBe('2026-01-01T06:00:00.000Z');
    expect(miDiaPeriodRange('YEAR', zone, now).to.toISOString()).toBe('2027-01-01T06:00:00.000Z');
  });
  it('mantiene inicio inclusivo y fin exclusivo para los cinco periodos', () => {
    const now = new Date('2026-12-31T23:00:00.000Z');
    const expected = {
      TODAY: ['2026-12-31T06:00:00.000Z', '2027-01-01T06:00:00.000Z'],
      WEEK: ['2026-12-28T06:00:00.000Z', '2027-01-04T06:00:00.000Z'],
      MONTH: ['2026-12-01T06:00:00.000Z', '2027-01-01T06:00:00.000Z'],
      QUARTER: ['2026-10-01T06:00:00.000Z', '2027-01-01T06:00:00.000Z'],
      YEAR: ['2026-01-01T06:00:00.000Z', '2027-01-01T06:00:00.000Z'],
    } as const;
    for (const [period, [start, end]] of Object.entries(expected)) {
      const range = miDiaPeriodRange(period as keyof typeof expected, zone, now);
      expect(range.from.toISOString()).toBe(start);
      expect(range.to.toISOString()).toBe(end);
      expect(new Date(range.from.getTime() - 1) >= range.from).toBe(false);
      expect(new Date(range.to.getTime() - 1) < range.to).toBe(true);
      expect(new Date(range.to.getTime()) < range.to).toBe(false);
    }
  });
  it('usa el huso solicitado, no el del servidor', () => {
    const now = new Date('2026-08-15T18:30:00.000Z');
    expect(miDiaPeriodRange('TODAY', 'America/Tijuana', now).from.toISOString()).toBe('2026-08-15T07:00:00.000Z');
    expect(miDiaPeriodRange('TODAY', zone, now).from.toISOString()).toBe('2026-08-15T06:00:00.000Z');
  });
});
