import { calculateFinanceAggregates, moneyToCents, type CanonicalMovement } from './financeCore';
import { resolveAssistantTimeRange, safeAssistantTimezone } from '../services/assistantTime';

export type ReportingPeriodKey =
  | 'ESTA_SEMANA'
  | 'ESTE_MES'
  | 'MES_ANTERIOR'
  | 'TRIMESTRE'
  | 'ESTE_TRIMESTRE'
  | 'ANO'
  | 'ESTE_ANO'
  | 'PERSONALIZADO';

export type ReportingPeriod = {
  key: ReportingPeriodKey;
  from: Date;
  to: Date;
  label: string;
  timezone: string;
};

type CalendarDate = { year: number; month: number; day: number };

function zonedDate(date: Date, timezone: string): CalendarDate {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, Number(part.value)]));
  return { year: values.year, month: values.month, day: values.day };
}

function zonedDateTime(date: Date, timezone: string) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, Number(part.value)]));
  return { year: values.year, month: values.month, day: values.day, hour: values.hour, minute: values.minute, second: values.second };
}

function timezoneOffsetMs(date: Date, timezone: string) {
  const local = zonedDateTime(date, timezone);
  return Date.UTC(local.year, local.month - 1, local.day, local.hour, local.minute, local.second) - date.getTime();
}

function zonedStartOfDay(value: CalendarDate, timezone: string) {
  const nominal = Date.UTC(value.year, value.month - 1, value.day);
  let instant = nominal - timezoneOffsetMs(new Date(nominal), timezone);
  instant = nominal - timezoneOffsetMs(new Date(instant), timezone);
  return new Date(instant);
}

function calendarDate(year: number, month: number, day = 1): CalendarDate {
  const value = new Date(Date.UTC(year, month - 1, day));
  return { year: value.getUTCFullYear(), month: value.getUTCMonth() + 1, day: value.getUTCDate() };
}

function inclusiveRange(start: CalendarDate, endExclusive: CalendarDate, timezone: string) {
  const from = zonedStartOfDay(start, timezone);
  const to = new Date(zonedStartOfDay(endExclusive, timezone).getTime() - 1);
  return { from, to };
}

function parseCalendarDate(value: string | undefined) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value || '');
  if (!match) return null;
  const parsed = calendarDate(Number(match[1]), Number(match[2]), Number(match[3]));
  if (`${parsed.year}-${String(parsed.month).padStart(2, '0')}-${String(parsed.day).padStart(2, '0')}` !== value) return null;
  return parsed;
}

export function resolveReportingPeriod(
  input: { periodo?: string; fecha_desde?: string; fecha_hasta?: string; timezone?: string },
  now = new Date(),
): ReportingPeriod {
  const key = (input.periodo || 'ESTE_MES') as ReportingPeriodKey;
  const timezone = safeAssistantTimezone(input.timezone);
  if (key === 'ESTA_SEMANA') {
    const week = resolveAssistantTimeRange('THIS_WEEK', timezone, now);
    return { key, from: week.from, to: new Date(week.to.getTime() - 1), label: week.label, timezone };
  }

  const local = zonedDate(now, timezone);
  let range = inclusiveRange(
    { year: local.year, month: local.month, day: 1 },
    calendarDate(local.year, local.month + 1),
    timezone,
  );
  if (key === 'MES_ANTERIOR') {
    range = inclusiveRange(calendarDate(local.year, local.month - 1), { year: local.year, month: local.month, day: 1 }, timezone);
  }
  if (key === 'TRIMESTRE' || key === 'ESTE_TRIMESTRE') {
    const quarterMonth = Math.floor((local.month - 1) / 3) * 3 + 1;
    range = inclusiveRange({ year: local.year, month: quarterMonth, day: 1 }, calendarDate(local.year, quarterMonth + 3), timezone);
  }
  if (key === 'ANO' || key === 'ESTE_ANO') {
    range = inclusiveRange({ year: local.year, month: 1, day: 1 }, { year: local.year + 1, month: 1, day: 1 }, timezone);
  }
  if (key === 'PERSONALIZADO') {
    const start = parseCalendarDate(input.fecha_desde);
    const finish = parseCalendarDate(input.fecha_hasta);
    if (!start || !finish) throw new Error('Selecciona un periodo válido.');
    range = inclusiveRange(start, calendarDate(finish.year, finish.month, finish.day + 1), timezone);
  }
  if (Number.isNaN(range.from.getTime()) || Number.isNaN(range.to.getTime()) || range.from > range.to) {
    throw new Error('Selecciona un periodo válido.');
  }
  const fmt = new Intl.DateTimeFormat('es-MX', { timeZone: timezone, day: 'numeric', month: 'short', year: 'numeric' });
  return { key, from: range.from, to: range.to, label: `${fmt.format(range.from)} – ${fmt.format(range.to)}`, timezone };
}

export function reportingCalendarRanges(timezoneValue: string, now = new Date()) {
  const timezone = safeAssistantTimezone(timezoneValue);
  const week = resolveReportingPeriod({ periodo: 'ESTA_SEMANA', timezone }, now);
  const month = resolveReportingPeriod({ periodo: 'ESTE_MES', timezone }, now);
  const previousWeek = resolveReportingPeriod({ periodo: 'ESTA_SEMANA', timezone }, new Date(week.from.getTime() - 12 * 60 * 60 * 1000));
  const nextMonth = resolveReportingPeriod({ periodo: 'ESTE_MES', timezone }, new Date(month.to.getTime() + 12 * 60 * 60 * 1000));
  return { week, previousWeek, month, nextMonth };
}

export function reportingMonthRange(offset: number, timezoneValue: string, now = new Date()) {
  const timezone = safeAssistantTimezone(timezoneValue);
  const local = zonedDate(now, timezone);
  const start = calendarDate(local.year, local.month + offset);
  const range = inclusiveRange(start, calendarDate(start.year, start.month + 1), timezone);
  return { ...range, timezone };
}

export function reportFinancialTotals(generated: number[], movements: CanonicalMovement[]) {
  return calculateFinanceAggregates({ generatedFees: generated, movements });
}

export function canonicalFeeCohortTotals(
  fees: Array<{ generated: number; collected: number }>,
  movementTotals: ReturnType<typeof reportFinancialTotals>,
) {
  const generatedCents = fees.reduce((sum, item) => sum + moneyToCents(item.generated), 0);
  const collectedCents = fees.reduce(
    (sum, item) => sum + Math.min(moneyToCents(item.generated), moneyToCents(item.collected)),
    0,
  );
  return {
    ...movementTotals,
    honorarios_generados: generatedCents / 100,
    honorarios_cobrados: collectedCents / 100,
    honorarios_por_cobrar: Math.max(0, generatedCents - collectedCents) / 100,
  };
}

export function targetProgress(
  target: { amount: number; base: 'GENERADOS' | 'COBRADOS' } | null,
  totals: { honorarios_generados: number; honorarios_cobrados: number },
) {
  if (!target) return null;
  const actual = target.base === 'GENERADOS' ? totals.honorarios_generados : totals.honorarios_cobrados;
  return {
    meta: target.amount,
    base: target.base,
    actual,
    pendiente: Math.max(0, target.amount - actual),
    cumplimiento: target.amount > 0 ? Math.round((actual / target.amount) * 1000) / 10 : null,
  };
}

export function sortAndLimitEconomicRows<T extends { importe_computable: number }>(rows: T[], limit = 20) {
  return [...rows].sort((left, right) => right.importe_computable - left.importe_computable).slice(0, limit);
}
