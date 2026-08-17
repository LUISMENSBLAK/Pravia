import { apiRequest, tokenStore } from '../../services/api/client';
import { apiUrl } from '../../services/api/config';
import type { ISRInput, ISRListResponse, ISRRecord } from './isr.types';

const unwrap = <T>(payload: { data: T }) => payload.data;
const stream = async (path: string) => {
  const headers = new Headers(); const token = tokenStore.get(); if (token) headers.set('Authorization', `Bearer ${token}`);
  const response = await fetch(apiUrl(path), { credentials: 'include', headers });
  if (!response.ok) throw new Error('El documento no está disponible.');
  return response.blob();
};

export const isrService = {
  list(params: URLSearchParams, signal?: AbortSignal) { return apiRequest<ISRListResponse>(`/isr?${params}`, { signal }); },
  searchExpedientes(search: string, signal?: AbortSignal) { const params = new URLSearchParams({ page: '1', pageSize: '8', search }); return apiRequest<{ data: Array<{ id: string; numero_pravia: string; cliente_alias?: string; tipo_acto?: { nombre: string } }> }>(`/expedientes?${params}`, { signal }).then((payload) => payload.data); },
  searchComparecientes(search: string, signal?: AbortSignal) { const params = new URLSearchParams({ page: '1', pageSize: '8', search }); return apiRequest<{ data: Array<{ id: string; nombre: string; rfc?: string | null; curp?: string | null; tipo_persona: 'FISICA' | 'MORAL' }> }>(`/comparecientes?${params}`, { signal }).then((payload) => payload.data); },
  detail(id: string, signal?: AbortSignal) { return apiRequest<{ data: ISRRecord }>(`/isr/${encodeURIComponent(id)}`, { signal }).then(unwrap); },
  create(input: { ejercicio: number; tipo_operacion: string; expediente_id?: string; compareciente_id?: string }) { return apiRequest<{ data: ISRRecord }>('/isr', { method: 'POST', body: JSON.stringify(input) }).then(unwrap); },
  update(id: string, input: ISRInput, extra: { expediente_id?: string | null; compareciente_id?: string | null; contribuyente_snapshot?: Record<string, unknown> } = {}) { return apiRequest<{ data: ISRRecord }>(`/isr/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify({ input_data: input, ...extra }) }).then(unwrap); },
  calculate(id: string) { return apiRequest(`/isr/${encodeURIComponent(id)}/calculate`, { method: 'POST' }); },
  auditExport(id: string) { return apiRequest(`/isr/${encodeURIComponent(id)}/export-audit`, { method: 'POST' }); },
  extract(id: string) { return apiRequest(`/isr/${encodeURIComponent(id)}/extract`, { method: 'POST' }); },
  reviewProposal(id: string, proposalId: string, action: 'ACEPTADA' | 'RECHAZADA') { return apiRequest(`/isr/${encodeURIComponent(id)}/proposals/${encodeURIComponent(proposalId)}`, { method: 'PATCH', body: JSON.stringify({ action }) }); },
  upload(id: string, file: File) { const body = new FormData(); body.set('file', file); return apiRequest(`/isr/${encodeURIComponent(id)}/documents`, { method: 'POST', body }); },
  unlinkDocument(id: string, documentId: string) { return apiRequest(`/isr/${encodeURIComponent(id)}/documents/${encodeURIComponent(documentId)}`, { method: 'DELETE' }); },
  async preview(id: string, documentId: string) { return URL.createObjectURL(await stream(`/isr/${encodeURIComponent(id)}/documents/${encodeURIComponent(documentId)}/preview`)); },
  async download(id: string, documentId: string, name: string) { const url = URL.createObjectURL(await stream(`/isr/${encodeURIComponent(id)}/documents/${encodeURIComponent(documentId)}/download`)); const link = document.createElement('a'); link.href = url; link.download = name; link.click(); window.setTimeout(() => URL.revokeObjectURL(url), 1000); },
};
