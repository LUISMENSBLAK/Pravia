import { apiRequest } from '../../services/api/client';
import { apiConfig } from '../../services/api/config';
import type { MyDayData, WidgetSection } from './myDay.types';

const arrayOrEmpty = <T>(value: unknown): T[] => Array.isArray(value) ? value as T[] : [];

const normalizeErrors = (value: unknown): Partial<Record<WidgetSection, string>> => {
  if (!value || typeof value !== 'object') return {};
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).filter(([, message]) => typeof message === 'string'),
  ) as Partial<Record<WidgetSection, string>>;
};

export const normalizeMyDay = (payload: unknown): MyDayData => {
  const root = payload && typeof payload === 'object' ? payload as Record<string, unknown> : {};
  const source = root.data && typeof root.data === 'object' ? root.data as Record<string, unknown> : root;
  const permissions = source.permissions && typeof source.permissions === 'object'
    ? source.permissions as Record<string, unknown>
    : {};
  const kpis = source.kpis && typeof source.kpis === 'object' ? source.kpis as MyDayData['kpis'] : {};
  const finance = source.finance && typeof source.finance === 'object'
    ? source.finance as NonNullable<MyDayData['finance']>
    : null;

  return {
    date: typeof source.date === 'string' ? source.date : undefined,
    permissions: { canViewFinance: permissions.canViewFinance === true },
    kpis,
    agenda: arrayOrEmpty(source.agenda),
    urgentSignatures: arrayOrEmpty(source.urgentSignatures),
    recentFiles: arrayOrEmpty(source.recentFiles),
    recommendation: source.recommendation && typeof source.recommendation === 'object'
      ? source.recommendation as MyDayData['recommendation']
      : null,
    reminders: arrayOrEmpty(source.reminders),
    urgentTasks: arrayOrEmpty(source.urgentTasks),
    finance,
    errors: normalizeErrors(source.errors),
  };
};

export const myDayService = {
  async get(signal?: AbortSignal): Promise<MyDayData> {
    const payload = await apiRequest<unknown>(apiConfig.myDayPath, { signal });
    return normalizeMyDay(payload);
  },
};
