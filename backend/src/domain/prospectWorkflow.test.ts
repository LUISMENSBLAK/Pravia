import { describe, expect, it } from 'vitest';
import { prospectEffectiveAt } from './prospectWorkflow';

describe('PRO-001 effective business date', () => {
  const now = new Date('2026-08-31T20:00:00Z');
  it.each(['2026-02-30T12:00:00Z', '2026-02-29T12:00:00Z', '2026-04-31T12:00:00Z',
    '2026-08-30T24:00:00Z', '2026-08-30T12:60:00Z', '2026-08-30T12:00:00',
    '2026-08-30', '2026-08-30T12:00:00+24:00', false, 0])('rejects invalid calendar/zone instead of normalizing %s', (value) => {
    expect(() => prospectEffectiveAt(value, now, null)).toThrow();
  });
  it('accepts an actual leap day and preserves its instant', () => {
    expect(prospectEffectiveAt('2024-02-29T12:00:00-06:00', now, null).toISOString()).toBe('2024-02-29T18:00:00.000Z');
  });
  it('accepts seconds or milliseconds with an explicit zone', () => {
    expect(prospectEffectiveAt('2026-08-31T13:59:59.123-06:00', now, null).toISOString()).toBe('2026-08-31T19:59:59.123Z');
  });
  it('uses recording instant only for the explicit current action, never a historical fallback', () => {
    expect(prospectEffectiveAt(undefined, now, null)).toBe(now);
    expect(() => prospectEffectiveAt(undefined, now, null, true)).toThrow();
    expect(() => prospectEffectiveAt('2026-09-01T00:00:00Z', now, null)).toThrow();
    expect(() => prospectEffectiveAt('2026-08-30T00:00:00Z', now, now)).toThrow();
  });
});
