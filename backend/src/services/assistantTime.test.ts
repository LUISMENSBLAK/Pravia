import { describe, expect, it } from 'vitest';
import { assistantTemporalReference, resolveAssistantTimeRange, resolveAssistantUpcomingDayWindow, safeAssistantTimezone } from './assistantTime';

describe('rangos temporales de PRAVIA IA', () => {
  const now = new Date('2026-08-15T18:30:00.000Z');

  it('resuelve hoy y esta semana en la zona horaria configurada, no en UTC implícito', () => {
    const today = resolveAssistantTimeRange('TODAY', 'America/Mexico_City', now);
    const week = resolveAssistantTimeRange('THIS_WEEK', 'America/Mexico_City', now);
    expect(today.from.toISOString()).toBe('2026-08-15T06:00:00.000Z');
    expect(today.to.toISOString()).toBe('2026-08-16T06:00:00.000Z');
    expect(week.from.toISOString()).toBe('2026-08-10T06:00:00.000Z');
    expect(week.to.toISOString()).toBe('2026-08-17T06:00:00.000Z');
  });

  it('separa eventos justo antes y después de medianoche local con límite superior exclusivo', () => {
    const range = resolveAssistantTimeRange('TODAY', 'America/Mexico_City', new Date('2026-10-14T18:00:00.000Z'));
    expect(range.from.toISOString()).toBe('2026-10-14T06:00:00.000Z');
    expect(range.to.toISOString()).toBe('2026-10-15T06:00:00.000Z');
    expect(new Date('2026-10-14T05:59:59.999Z') < range.from).toBe(true);
    expect(new Date('2026-10-14T06:00:00.000Z') >= range.from).toBe(true);
    expect(new Date('2026-10-15T06:00:00.000Z') < range.to).toBe(false);
  });

  it('respeta zonas con otro offset y publica límites exclusivos inequívocos', () => {
    const range = resolveAssistantTimeRange('NEXT_7_DAYS', 'America/Tijuana', now);
    const reference = assistantTemporalReference('America/Tijuana', now);
    expect(range.from.toISOString()).toBe('2026-08-15T07:00:00.000Z');
    expect(reference.timezone).toBe('America/Tijuana');
    expect(reference.ranges.NEXT_7_DAYS.to_exclusive).toBe(range.to.toISOString());
  });

  it('usa una zona segura cuando la configuración es inválida', () => {
    expect(safeAssistantTimezone('zona-inexistente')).toBe('America/Mexico_City');
  });

  it('delimita las ventanas configurables de citas y firmas en días locales completos', () => {
    const reference = new Date('2026-10-14T18:00:00.000Z');
    for (const [days, expectedEnd] of [
      [3, '2026-10-18T06:00:00.000Z'],
      [7, '2026-10-22T06:00:00.000Z'],
      [15, '2026-10-30T06:00:00.000Z'],
    ] as const) {
      const window = resolveAssistantUpcomingDayWindow(days, 'America/Mexico_City', reference);
      expect(window.to.toISOString()).toBe(expectedEnd);
      expect(new Date(window.to.getTime() - 1) < window.to).toBe(true);
      expect(new Date(expectedEnd) < window.to).toBe(false);
    }
  });
});
