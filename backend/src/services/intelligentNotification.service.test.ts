import { describe, expect, it } from 'vitest';
import { calendarDaysUntil, coalesceNotificationRefresh, localDayKey, shouldIssueDailyReminder } from './intelligentNotification.service';

describe('intelligent notification reminder policy', () => {
  const zone = 'America/Bahia_Banderas';

  it('does not alert before the seven-day window and starts exactly at seven days', () => {
    const now = new Date('2026-09-29T15:00:00.000Z');
    expect(calendarDaysUntil(now, new Date('2026-10-07T18:00:00.000Z'), zone)).toBe(8);
    expect(shouldIssueDailyReminder({ now, dueAt: new Date('2026-10-07T18:00:00.000Z'), timeZone: zone })).toBe(false);
    expect(calendarDaysUntil(now, new Date('2026-10-06T18:00:00.000Z'), zone)).toBe(7);
    expect(shouldIssueDailyReminder({ now, dueAt: new Date('2026-10-06T18:00:00.000Z'), timeZone: zone })).toBe(true);
  });

  it('issues at most one reminder per local calendar day', () => {
    const dueAt = new Date('2026-10-01T18:00:00.000Z');
    const first = new Date('2026-09-29T14:00:00.000Z');
    const sameLocalDay = new Date('2026-09-30T04:59:00.000Z');
    const nextLocalDay = new Date('2026-09-30T08:00:00.000Z');
    expect(localDayKey(first, zone)).toBe(localDayKey(sameLocalDay, zone));
    expect(shouldIssueDailyReminder({ now: sameLocalDay, dueAt, lastReminderAt: first, timeZone: zone })).toBe(false);
    expect(localDayKey(first, zone)).not.toBe(localDayKey(nextLocalDay, zone));
    expect(shouldIssueDailyReminder({ now: nextLocalDay, dueAt, lastReminderAt: first, timeZone: zone })).toBe(true);
  });

  it('does not invent a date and emits only once for an undated active fact', () => {
    const now = new Date('2026-09-29T15:00:00.000Z');
    expect(shouldIssueDailyReminder({ now, dueAt: null, lastReminderAt: null, timeZone: zone })).toBe(true);
    expect(shouldIssueDailyReminder({ now, dueAt: null, lastReminderAt: new Date('2026-09-01T15:00:00.000Z'), timeZone: zone })).toBe(false);
  });

  it('uses local calendar dates rather than elapsed 24-hour approximations', () => {
    const beforeMidnight = new Date('2026-11-01T05:30:00.000Z');
    const afterMidnight = new Date('2026-11-01T06:30:00.000Z');
    expect(localDayKey(beforeMidnight, 'America/Mexico_City')).toBe('2026-10-31');
    expect(localDayKey(afterMidnight, 'America/Mexico_City')).toBe('2026-11-01');
  });

  it('coalesces concurrent refreshes for the same organization and user', async () => {
    let calls = 0;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const refresh = async () => {
      calls += 1;
      await gate;
      return { refreshed: 3, activeKeys: ['A', 'B', 'C'] };
    };

    const first = coalesceNotificationRefresh('org:user', refresh);
    const second = coalesceNotificationRefresh('org:user', refresh);
    expect(first).toBe(second);
    expect(calls).toBe(1);
    release();
    await expect(Promise.all([first, second])).resolves.toEqual([
      { refreshed: 3, activeKeys: ['A', 'B', 'C'] },
      { refreshed: 3, activeKeys: ['A', 'B', 'C'] },
    ]);

    await coalesceNotificationRefresh('org:user', refresh);
    expect(calls).toBe(2);
  });
});
