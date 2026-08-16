import { describe, expect, it } from 'vitest';
import { assistantTemporalReference, resolveAssistantTimeRange, safeAssistantTimezone } from './assistantTime';

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
});
