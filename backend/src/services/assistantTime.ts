export type AssistantPeriod = 'TODAY' | 'TOMORROW' | 'THIS_WEEK' | 'NEXT_7_DAYS' | 'THIS_MONTH';

export type AssistantTimeRange = {
  period: AssistantPeriod;
  timezone: string;
  from: Date;
  to: Date;
  label: string;
};

const DEFAULT_TIMEZONE = 'America/Mexico_City';
const PERIODS = new Set<AssistantPeriod>(['TODAY', 'TOMORROW', 'THIS_WEEK', 'NEXT_7_DAYS', 'THIS_MONTH']);

export function safeAssistantTimezone(value: unknown) {
  const candidate = String(value || '').trim();
  if (!candidate) return DEFAULT_TIMEZONE;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: candidate }).format(new Date());
    return candidate;
  } catch {
    return DEFAULT_TIMEZONE;
  }
}

function zonedParts(date: Date, timezone: string) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, Number(part.value)]));
  return { year: values.year, month: values.month, day: values.day, hour: values.hour, minute: values.minute, second: values.second };
}

function timezoneOffsetMs(date: Date, timezone: string) {
  const parts = zonedParts(date, timezone);
  return Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second) - date.getTime();
}

function zonedStartOfDay(year: number, month: number, day: number, timezone: string) {
  const localMidnightAsUtc = Date.UTC(year, month - 1, day);
  let instant = localMidnightAsUtc - timezoneOffsetMs(new Date(localMidnightAsUtc), timezone);
  instant = localMidnightAsUtc - timezoneOffsetMs(new Date(instant), timezone);
  return new Date(instant);
}

function addCalendarDays(year: number, month: number, day: number, amount: number) {
  const value = new Date(Date.UTC(year, month - 1, day + amount));
  return { year: value.getUTCFullYear(), month: value.getUTCMonth() + 1, day: value.getUTCDate() };
}

function formatLocalDate(date: Date, timezone: string) {
  return new Intl.DateTimeFormat('es-MX', { timeZone: timezone, day: 'numeric', month: 'short', year: 'numeric' }).format(date);
}

export function resolveAssistantTimeRange(periodValue: unknown, timezoneValue: unknown, now = new Date()): AssistantTimeRange {
  const period = PERIODS.has(String(periodValue || '').toUpperCase() as AssistantPeriod)
    ? String(periodValue).toUpperCase() as AssistantPeriod
    : 'NEXT_7_DAYS';
  const timezone = safeAssistantTimezone(timezoneValue);
  const local = zonedParts(now, timezone);
  let start = { year: local.year, month: local.month, day: local.day };
  let end = addCalendarDays(start.year, start.month, start.day, 7);

  if (period === 'TODAY') end = addCalendarDays(start.year, start.month, start.day, 1);
  if (period === 'TOMORROW') {
    start = addCalendarDays(start.year, start.month, start.day, 1);
    end = addCalendarDays(start.year, start.month, start.day, 1);
  }
  if (period === 'THIS_WEEK') {
    const weekday = new Date(Date.UTC(start.year, start.month - 1, start.day)).getUTCDay();
    start = addCalendarDays(start.year, start.month, start.day, -((weekday + 6) % 7));
    end = addCalendarDays(start.year, start.month, start.day, 7);
  }
  if (period === 'THIS_MONTH') {
    start = { year: local.year, month: local.month, day: 1 };
    const nextMonth = new Date(Date.UTC(local.year, local.month, 1));
    end = { year: nextMonth.getUTCFullYear(), month: nextMonth.getUTCMonth() + 1, day: 1 };
  }

  const from = zonedStartOfDay(start.year, start.month, start.day, timezone);
  const to = zonedStartOfDay(end.year, end.month, end.day, timezone);
  return {
    period,
    timezone,
    from,
    to,
    label: `${formatLocalDate(from, timezone)} – ${formatLocalDate(new Date(to.getTime() - 1), timezone)}`,
  };
}

export function assistantTemporalReference(timezoneValue: unknown, now = new Date()) {
  const timezone = safeAssistantTimezone(timezoneValue);
  const ranges = (['TODAY', 'TOMORROW', 'THIS_WEEK', 'NEXT_7_DAYS', 'THIS_MONTH'] as AssistantPeriod[])
    .map((period) => resolveAssistantTimeRange(period, timezone, now));
  return {
    timezone,
    now: now.toISOString(),
    ranges: Object.fromEntries(ranges.map((range) => [range.period, {
      from: range.from.toISOString(),
      to_exclusive: range.to.toISOString(),
      label: range.label,
    }])),
  };
}
