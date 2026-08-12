import { apiRequest } from '../../services/api/client';
import type { FollowUpInput, NewProspectInput, Prospect, ProspectDocument, ProspectFollowUp, ProspectListFilters, ProspectListResult } from './prospects.types';

const asObject = (value: unknown): Record<string, unknown> | null => value && typeof value === 'object' ? value as Record<string, unknown> : null;

export const normalizeProspects = (payload: unknown): Prospect[] => {
  const root = asObject(payload);
  const source = Array.isArray(payload) ? payload : Array.isArray(root?.data) ? root.data : [];
  return source.filter((item): item is Prospect => {
    const candidate = asObject(item);
    return typeof candidate?.id === 'string' && typeof candidate.nombre === 'string';
  });
};

const queryString = (filters: ProspectListFilters) => {
  const params = new URLSearchParams();
  if (filters.search?.trim()) params.set('busqueda', filters.search.trim());
  if (filters.priority) params.set('prioridad', filters.priority);
  if (filters.states?.length) params.set('estado', filters.states.join(','));
  if (filters.service) params.set('servicio', filters.service);
  if (filters.source) params.set('origen', filters.source);
  params.set('page', String(filters.page ?? 1));
  params.set('pageSize', String(filters.pageSize ?? 24));
  params.set('sort', 'updated_at:desc');
  const value = params.toString();
  return value ? `?${value}` : '';
};

export const prospectsService = {
  async list(filters: ProspectListFilters = {}, signal?: AbortSignal): Promise<ProspectListResult> {
    const payload = await apiRequest<unknown>(`/prospectos${queryString(filters)}`, { signal });
    const data = normalizeProspects(payload);
    const root = asObject(payload);
    const rawMeta = asObject(root?.meta);
    const rawMetrics = asObject(rawMeta?.metrics);
    const rawFacets = asObject(root?.facets);
    const total = typeof rawMeta?.total === 'number' ? rawMeta.total : data.length;
    const pageSize = typeof rawMeta?.pageSize === 'number' ? rawMeta.pageSize : Math.max(data.length, 1);
    const page = typeof rawMeta?.page === 'number' ? rawMeta.page : 1;
    const totalPages = typeof rawMeta?.totalPages === 'number' ? rawMeta.totalPages : 1;
    return {
      data,
      meta: {
        page, pageSize, total, totalPages,
        hasNextPage: rawMeta?.hasNextPage === true,
        hasPreviousPage: rawMeta?.hasPreviousPage === true,
        countsByState: asObject(rawMeta?.countsByState) as ProspectListResult['meta']['countsByState'] ?? {},
        metrics: {
          withQuote: typeof rawMetrics?.withQuote === 'number' ? rawMetrics.withQuote : data.filter((item) => Boolean(item.cotizacion)).length,
          accepted: typeof rawMetrics?.accepted === 'number' ? rawMetrics.accepted : data.filter((item) => item.estado === 'ACEPTADO').length,
          active: typeof rawMetrics?.active === 'number' ? rawMetrics.active : data.filter((item) => !['ACEPTADO', 'PERDIDO', 'CANCELADO', 'ARCHIVADO'].includes(item.estado)).length,
        },
      },
      facets: {
        services: Array.isArray(rawFacets?.services) ? rawFacets.services.filter((item): item is string => typeof item === 'string') : [],
        sources: Array.isArray(rawFacets?.sources) ? rawFacets.sources.filter((item): item is string => typeof item === 'string') : [],
      },
    };
  },
  async get(id: string, signal?: AbortSignal): Promise<Prospect> {
    return apiRequest<Prospect>(`/prospectos/${encodeURIComponent(id)}`, { signal });
  },
  async getDocuments(id: string, signal?: AbortSignal): Promise<ProspectDocument[]> {
    const payload = await apiRequest<unknown>(`/prospectos/${encodeURIComponent(id)}/documentos`, { signal });
    return Array.isArray(payload) ? payload.filter((item): item is ProspectDocument => Boolean(item && typeof item === 'object' && typeof (item as { id?: unknown }).id === 'string')) : [];
  },
  async create(input: NewProspectInput): Promise<Prospect> {
    return apiRequest<Prospect>('/prospectos', { method: 'POST', body: JSON.stringify(input) });
  },
  async addFollowUp(id: string, input: FollowUpInput): Promise<ProspectFollowUp> {
    return apiRequest<ProspectFollowUp>(`/prospectos/${encodeURIComponent(id)}/seguimientos`, {
      method: 'POST', body: JSON.stringify(input),
    });
  },
};
