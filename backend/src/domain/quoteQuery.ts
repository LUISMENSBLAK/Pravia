import { CotizacionEstado } from '@prisma/client';

const MAX_PAGE_SIZE = 100;
const sortableFields = new Set(['created_at', 'updated_at', 'numero_cotizacion', 'total_cliente', 'estado', 'fecha_limite_respuesta_notaria']);
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const positiveInt = (value: unknown, fallback: number) => {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

const enumList = <T extends string>(value: unknown, allowed: readonly T[]): T[] => {
  if (typeof value !== 'string') return [];
  const accepted = new Set(allowed);
  return value.split(',').map((item) => item.trim()).filter((item): item is T => accepted.has(item as T));
};

const validDate = (value: unknown) => {
  if (typeof value !== 'string' || !value.trim()) return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date;
};

export type QuoteListQuery = {
  paginated: boolean;
  page: number;
  pageSize: number;
  skip: number;
  sortBy: string;
  sortOrder: 'asc' | 'desc';
  search: string;
  exactId?: string;
  states: CotizacionEstado[];
  act?: string;
  responsible?: string;
  dateFrom?: Date;
  dateTo?: Date;
  period: '6m' | 'year';
};

export function parseQuoteListQuery(query: Record<string, unknown>): QuoteListQuery {
  const page = positiveInt(query.page, 1);
  const pageSize = Math.min(positiveInt(query.pageSize ?? query.limit, 20), MAX_PAGE_SIZE);
  const rawSort = typeof query.sort === 'string' ? query.sort.split(':') : [];
  const requestedSort = String(query.sortBy ?? rawSort[0] ?? 'created_at');
  const requestedOrder = String(query.sortOrder ?? rawSort[1] ?? 'desc').toLowerCase();
  const search = typeof query.busqueda === 'string' ? query.busqueda.trim() : typeof query.search === 'string' ? query.search.trim() : '';
  const dateFrom = validDate(query.fecha_desde ?? query.dateFrom);
  const dateTo = validDate(query.fecha_hasta ?? query.dateTo);
  if (dateTo) dateTo.setHours(23, 59, 59, 999);
  return {
    paginated: query.page !== undefined || query.pageSize !== undefined || query.limit !== undefined,
    page,
    pageSize,
    skip: (page - 1) * pageSize,
    sortBy: sortableFields.has(requestedSort) ? requestedSort : 'created_at',
    sortOrder: requestedOrder === 'asc' ? 'asc' : 'desc',
    search,
    ...(uuidPattern.test(search) ? { exactId: search } : {}),
    states: enumList(query.estado, Object.values(CotizacionEstado)),
    ...(typeof query.acto === 'string' && query.acto.trim() ? { act: query.acto.trim() } : {}),
    ...(typeof query.responsable === 'string' && query.responsable.trim() ? { responsible: query.responsable.trim() } : {}),
    ...(dateFrom ? { dateFrom } : {}),
    ...(dateTo ? { dateTo } : {}),
    period: query.periodo === 'year' ? 'year' : '6m',
  };
}

export type QuoteAnalyticsRecord = {
  fecha_enviada_cliente: Date | null;
  fecha_aceptacion_cliente: Date | null;
  total_cliente: number | string | { toString(): string } | null;
};

export function quoteAnalyticsRange(period: '6m' | 'year', now = new Date()) {
  const start = period === 'year' ? new Date(now.getFullYear(), 0, 1) : new Date(now.getFullYear(), now.getMonth() - 5, 1);
  const end = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  return { start, end };
}

export function buildQuoteAnalytics(records: QuoteAnalyticsRecord[], period: '6m' | 'year', now = new Date()) {
  const { start, end } = quoteAnalyticsRange(period, now);
  const months: Array<{ key: string; label: string; sentAmount: number; acceptedAmount: number; sentCount: number; acceptedCount: number; rate: number }> = [];
  for (let cursor = new Date(start); cursor < end; cursor = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1)) {
    months.push({
      key: `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, '0')}`,
      label: new Intl.DateTimeFormat('es-MX', { month: 'short' }).format(cursor).replace('.', ''),
      sentAmount: 0,
      acceptedAmount: 0,
      sentCount: 0,
      acceptedCount: 0,
      rate: 0,
    });
  }
  const byKey = new Map(months.map((month) => [month.key, month]));
  for (const record of records) {
    if (!record.fecha_enviada_cliente) continue;
    const sent = new Date(record.fecha_enviada_cliente);
    const bucket = byKey.get(`${sent.getFullYear()}-${String(sent.getMonth() + 1).padStart(2, '0')}`);
    if (!bucket) continue;
    const amount = Number(record.total_cliente ?? 0);
    bucket.sentCount += 1;
    bucket.sentAmount += Number.isFinite(amount) ? amount : 0;
    if (record.fecha_aceptacion_cliente) {
      bucket.acceptedCount += 1;
      bucket.acceptedAmount += Number.isFinite(amount) ? amount : 0;
    }
  }
  for (const month of months) month.rate = month.sentCount ? Number(((month.acceptedCount / month.sentCount) * 100).toFixed(1)) : 0;
  return months;
}
