import { apiRequest, tokenStore } from '../../services/api/client';
import { apiUrl } from '../../services/api/config';
import type { ActTypeOption, ExpedienteDetail, ExpedienteListFilters, ExpedienteListResult, NotaryOption, OpenExpedienteInput, PartyOption, PersonOption, ProjectState } from './expedientes.types';

const query = (filters: ExpedienteListFilters) => {
  const params = new URLSearchParams();
  const values: Record<string, string | number | undefined> = {
    search: filters.search, macrofase: filters.macrophase, etapa: filters.stage, responsable: filters.responsible,
    notaria_id: filters.notary, riesgo: filters.risk, fecha_desde: filters.dateFrom, fecha_hasta: filters.dateTo,
    tipo_acto_id: filters.actType, cliente: filters.client, estatus: filters.status, page: filters.page || 1,
    pageSize: filters.pageSize || 20, sort: filters.sort || 'updated_at:desc',
  };
  Object.entries(values).forEach(([key, value]) => { if (value !== undefined && value !== '') params.set(key, String(value)); });
  return params.toString();
};
const unwrapArray = <T>(payload: unknown): T[] => {
  if (Array.isArray(payload)) return payload as T[];
  if (payload && typeof payload === 'object' && Array.isArray((payload as any).data)) return (payload as any).data as T[];
  return [];
};

export const expedientesService = {
  list(filters: ExpedienteListFilters, signal?: AbortSignal) { return apiRequest<ExpedienteListResult>(`/expedientes?${query(filters)}`, { signal }); },
  detail(id: string, signal?: AbortSignal) { return apiRequest<ExpedienteDetail>(`/expedientes/${encodeURIComponent(id)}`, { signal }); },
  types(signal?: AbortSignal) { return apiRequest<ActTypeOption[]>('/expedientes/tipos-acto', { signal }); },
  users(signal?: AbortSignal) { return apiRequest<PersonOption[]>('/usuarios', { signal }).then((items) => items.filter((item) => ['DIRECCION', 'ADMINISTRACION', 'ABOGADO'].includes(item.rol || ''))); },
  notaries(search = '', signal?: AbortSignal) {
    const params = new URLSearchParams({ activa: 'true', paginated: 'true', page: '1', limit: '30' }); if (search.trim()) params.set('search', search.trim());
    return apiRequest<unknown>(`/notarias?${params}`, { signal }).then(unwrapArray<NotaryOption>);
  },
  parties(search: string, signal?: AbortSignal) {
    const params = new URLSearchParams({ page: '1', limit: '25', search: search.trim() });
    return apiRequest<unknown>(`/comparecientes?${params}`, { signal }).then(unwrapArray<PartyOption>);
  },
  create(input: OpenExpedienteInput) { return apiRequest<ExpedienteDetail>('/expedientes', { method: 'POST', body: JSON.stringify(input) }); },
  transition(id: string, input: { expected_version: number; nuevo_estatus: string; nueva_etapa_clave?: string; notas?: string; fecha_efectiva?: string; datos_firma?: { fecha_firma: string; lugar: string } }) {
    return apiRequest<ExpedienteDetail>(`/expedientes/${encodeURIComponent(id)}/transicion-estatus`, { method: 'POST', body: JSON.stringify(input) });
  },
  project(id: string, signal?: AbortSignal) { return apiRequest<ProjectState>(`/expedientes/${encodeURIComponent(id)}/proyecto`, { signal }); },
  uploadDocument(id: string, file: File, fields: { categoria: string; carpeta: string }) {
    const body = new FormData(); body.set('file', file); body.set('categoria', fields.categoria); body.set('carpeta', fields.carpeta);
    return apiRequest(`/expedientes/${encodeURIComponent(id)}/documentos`, { method: 'POST', body });
  },
  uploadProject(id: string, file: File, note = '') {
    const body = new FormData(); body.set('file', file); if (note) body.set('nota_version', note);
    return apiRequest(`/expedientes/${encodeURIComponent(id)}/proyecto/upload`, { method: 'POST', body });
  },
  createPostfirmaTask(id: string, input: { tipo: string; descripcion: string; institucion: string; fecha_limite?: string }) {
    return apiRequest(`/expedientes/${encodeURIComponent(id)}/postfirma/tramites`, { method: 'POST', body: JSON.stringify(input) });
  },
  updatePostfirmaTask(id: string, taskId: string, input: { estatus: string; resultado?: string; evidencia_documento_id?: string }) {
    return apiRequest(`/expedientes/${encodeURIComponent(id)}/postfirma/tramites/${encodeURIComponent(taskId)}`, { method: 'PATCH', body: JSON.stringify(input) });
  },
  deliver(id: string, input: { expected_version: number; receptor_nombre: string; receptor_caracter: string; fecha_efectiva: string; medio: string; items: Array<{ documento_id: string; tipo: string; cantidad: number }>; evidencia_documento_id: string; observaciones?: string }) {
    return apiRequest(`/expedientes/${encodeURIComponent(id)}/entrega`, { method: 'POST', body: JSON.stringify(input) });
  },
  async downloadDocument(expedienteId: string, documentId: string, name: string) {
    const headers = new Headers(); const token = tokenStore.get(); if (token) headers.set('Authorization', `Bearer ${token}`);
    const response = await fetch(apiUrl(`/expedientes/${encodeURIComponent(expedienteId)}/documentos/${encodeURIComponent(documentId)}/descargar`), { credentials: 'include', headers });
    if (!response.ok) throw new Error('No fue posible descargar el documento.');
    const url = URL.createObjectURL(await response.blob()); const link = document.createElement('a'); link.href = url; link.download = name; link.click(); window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  },
  async downloadProject(expedienteId: string, versionId: string, name: string) {
    const headers = new Headers(); const token = tokenStore.get(); if (token) headers.set('Authorization', `Bearer ${token}`);
    const response = await fetch(apiUrl(`/expedientes/${encodeURIComponent(expedienteId)}/proyecto/versions/${encodeURIComponent(versionId)}/descargar`), { credentials: 'include', headers });
    if (!response.ok) throw new Error('No fue posible descargar esta versión del proyecto.');
    const url = URL.createObjectURL(await response.blob()); const link = document.createElement('a'); link.href = url; link.download = name; link.click(); window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  },
};
