import { ProspectoEstado, ProspectoPrioridad } from '@prisma/client';

const MAX_PAGE_SIZE = 100;
const sortableFields = new Set(['created_at', 'updated_at', 'nombre', 'prioridad', 'estado']);
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

export type ProspectListQuery = {
  paginated: boolean;
  page: number;
  pageSize: number;
  skip: number;
  sortBy: string;
  sortOrder: 'asc' | 'desc';
  search: string;
  exactId?: string;
  states: ProspectoEstado[];
  priorities: ProspectoPrioridad[];
  service?: string;
  source?: string;
};

export function parseProspectListQuery(query: Record<string, unknown>): ProspectListQuery {
  const page = positiveInt(query.page, 1);
  const pageSize = Math.min(positiveInt(query.pageSize ?? query.limit, 20), MAX_PAGE_SIZE);
  const rawSort = typeof query.sort === 'string' ? query.sort.split(':') : [];
  const requestedSort = String(query.sortBy ?? rawSort[0] ?? 'created_at');
  const sortBy = sortableFields.has(requestedSort) ? requestedSort : 'created_at';
  const requestedOrder = String(query.sortOrder ?? rawSort[1] ?? 'desc').toLowerCase();
  const search = typeof query.busqueda === 'string' ? query.busqueda.trim() : typeof query.search === 'string' ? query.search.trim() : '';
  return {
    paginated: query.page !== undefined || query.pageSize !== undefined || query.limit !== undefined,
    page,
    pageSize,
    skip: (page - 1) * pageSize,
    sortBy,
    sortOrder: requestedOrder === 'asc' ? 'asc' : 'desc',
    search,
    ...(uuidPattern.test(search) ? { exactId: search } : {}),
    states: enumList(query.estado, Object.values(ProspectoEstado)),
    priorities: enumList(query.prioridad, Object.values(ProspectoPrioridad)),
    ...(typeof query.servicio === 'string' && query.servicio.trim() ? { service: query.servicio.trim() } : {}),
    ...(typeof query.origen === 'string' && query.origen.trim() ? { source: query.origen.trim() } : {}),
  };
}
