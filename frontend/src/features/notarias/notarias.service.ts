import { apiRequest } from '../../services/api/client';
import type { NotariaDetail, NotariaDraft, NotariaFilters, NotariaListResult, NotariaUpdateInput } from './notarias.types';

const clean = (value: string) => value.trim() || undefined;
const query = (filters: NotariaFilters) => {
  const params = new URLSearchParams({ portfolio: 'true', page: String(filters.page || 1), pageSize: String(filters.pageSize || 20) });
  if (filters.search?.trim()) params.set('search', filters.search.trim());
  if (filters.state) params.set('estado', filters.state);
  return params.toString();
};
const payload = (draft: NotariaDraft) => ({
  numero_notaria: clean(draft.numero_notaria), nombre: draft.nombre.trim(), notario_titular: clean(draft.notario_titular),
  entidad_federativa: draft.entidad_federativa.trim(), municipio: draft.municipio.trim(), ciudad: clean(draft.ciudad), demarcacion: clean(draft.demarcacion),
  direccion: clean(draft.direccion), codigo_postal: clean(draft.codigo_postal), telefono: clean(draft.telefono),
  correo_general: clean(draft.correo_general), correo_proyectos: clean(draft.correo_proyectos), activa: draft.activa,
});

export const notariasService = {
  list(filters: NotariaFilters, signal?: AbortSignal) { return apiRequest<NotariaListResult>(`/notarias?${query(filters)}`, { signal }); },
  detail(id: string, signal?: AbortSignal) { return apiRequest<NotariaDetail>(`/notarias/${encodeURIComponent(id)}`, { signal }); },
  create(draft: NotariaDraft) { return apiRequest<NotariaDetail>('/notarias', { method: 'POST', body: JSON.stringify(payload(draft)) }); },
  update(id: string, input: NotariaUpdateInput) { return apiRequest<NotariaDetail>(`/notarias/${encodeURIComponent(id)}`, { method: 'PUT', body: JSON.stringify(input) }); },
  addContact(id: string, input: { nombre: string; cargo?: string; telefono?: string; correo?: string; observaciones?: string; principal?: boolean }) { return apiRequest(`/notarias/${encodeURIComponent(id)}/contactos`, { method: 'POST', body: JSON.stringify(input) }); },
  setMainContact(id: string, contactId: string) { return apiRequest<NotariaDetail>(`/notarias/${encodeURIComponent(id)}/contactos/${encodeURIComponent(contactId)}/principal`, { method: 'PATCH' }); },
  cases(id: string, page = 1, signal?: AbortSignal) { return apiRequest<{ data: NotariaDetail['expedientes']; meta: { total: number; page: number; totalPages: number; hasPreviousPage: boolean; hasNextPage: boolean } }>(`/notarias/${encodeURIComponent(id)}/expedientes?page=${page}&pageSize=10&sort=updated_at%3Adesc`, { signal }); },
};
