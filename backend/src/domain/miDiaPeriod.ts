import { resolveReportingPeriod } from './reportingCore';
import { resolveAssistantTimeRange, safeAssistantTimezone } from '../services/assistantTime';

export type MiDiaPeriod = 'TODAY' | 'WEEK' | 'MONTH' | 'QUARTER' | 'YEAR';

/** Reuses the reporting calendar; ranges are half-open so midnight belongs to one day only. */
export function miDiaPeriodRange(period: MiDiaPeriod, timezoneValue: unknown, now = new Date()) {
  const timezone = safeAssistantTimezone(timezoneValue);
  if (period === 'TODAY') {
    const range = resolveAssistantTimeRange('TODAY', timezone, now);
    return { from: range.from, to: range.to, timezone };
  }
  const reportingPeriod = { WEEK: 'ESTA_SEMANA', MONTH: 'ESTE_MES',
    QUARTER: 'ESTE_TRIMESTRE', YEAR: 'ESTE_ANO' }[period];
  const range = resolveReportingPeriod({ periodo: reportingPeriod, timezone }, now);
  return { from: range.from, to: new Date(range.to.getTime() + 1), timezone };
}
