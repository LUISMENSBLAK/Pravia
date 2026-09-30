import { apiRequest, tokenStore } from '../../services/api/client';
import { apiUrl } from '../../services/api/config';
import type { ISRAnyInput, ISRListResponse, ISRPostalCodeSearch, ISRRecord, ISRResources } from './isr.types';

const unwrap = <T>(payload: { data: T }) => payload.data;
const stream = async (path: string) => {
  const headers = new Headers(); const token = tokenStore.get(); if (token) headers.set('Authorization', `Bearer ${token}`);
  const response = await fetch(apiUrl(path), { credentials: 'include', headers });
  if (!response.ok) throw new Error('El documento no está disponible.');
  return response.blob();
};

export const isrService = {
  list(params: URLSearchParams, signal?: AbortSignal) { return apiRequest<ISRListResponse>(`/isr?${params}`, { signal }); },
  resources(legalDate: string, signal?: AbortSignal) { const query = legalDate ? `?legal_date=${encodeURIComponent(legalDate)}` : ''; return apiRequest<{ data: ISRResources }>(`/isr/resources${query}`, { signal }).then(unwrap); },
  postalCodes(query: string, signal?: AbortSignal) { return apiRequest<ISRPostalCodeSearch>(`/isr/resources/postal-codes?q=${encodeURIComponent(query)}`, { signal }); },
  referredValue(input: { reference_id: string; amount: string; factor?: string; valuation_date: string; target_date: string }) { return apiRequest<{ data: Record<string, unknown> }>('/isr/utilities/referred-value', { method: 'POST', body: JSON.stringify(input) }).then(unwrap); },
  surcharges(input: { principal: string; origin_date: string; due_date: string; payment_date: string }) { return apiRequest<{ data: Record<string, unknown> }>('/isr/utilities/surcharges', { method: 'POST', body: JSON.stringify(input) }).then(unwrap); },
  additionalTax(input: { reference_id: string; taxable_base: string }) { return apiRequest<{ data: Record<string, unknown> }>('/isr/utilities/additional-tax', { method: 'POST', body: JSON.stringify(input) }).then(unwrap); },
  validateExport(id: string, profileId: string) { return apiRequest<{ data: Record<string, unknown> }>(`/isr/${encodeURIComponent(id)}/export-validation`, { method: 'POST', body: JSON.stringify({ profile_id: profileId }) }).then(unwrap); },
  prepareExport(id: string, profileId: string) { return apiRequest<{ data: { payload: Record<string, unknown>; checksum_sha256: string; mime_type: string; file_name: string } }>(`/isr/${encodeURIComponent(id)}/export-data`, { method: 'POST', body: JSON.stringify({ profile_id: profileId }) }).then(unwrap); },
  searchExpedientes(search: string, signal?: AbortSignal) { const params = new URLSearchParams({ page: '1', pageSize: '8', search }); return apiRequest<{ data: Array<{ id: string; numero_pravia: string; cliente_alias?: string; tipo_acto?: { nombre: string } }> }>(`/expedientes?${params}`, { signal }).then((payload) => payload.data); },
  searchComparecientes(search: string, signal?: AbortSignal) { const params = new URLSearchParams({ page: '1', pageSize: '8', search }); return apiRequest<{ data: Array<{ id: string; nombre: string; rfc?: string | null; curp?: string | null; tipo_persona: 'FISICA' | 'MORAL' }> }>(`/comparecientes?${params}`, { signal }).then((payload) => payload.data); },
  detail(id: string, signal?: AbortSignal) { return apiRequest<{ data: ISRRecord }>(`/isr/${encodeURIComponent(id)}`, { signal }).then(unwrap); },
  create(input: { ejercicio: number; tipo_operacion: string; expediente_id?: string; compareciente_id?: string; idempotency_key?: string }) { return apiRequest<{ data: ISRRecord }>('/isr', { method: 'POST', body: JSON.stringify(input) }).then(unwrap); },
  openForExpediente(expedienteId: string, idempotencyKey = crypto.randomUUID()) { return apiRequest<{ data: ISRRecord; created: boolean; idempotent: boolean }>(`/isr/expedientes/${encodeURIComponent(expedienteId)}/open`, { method: 'POST', headers: { 'Idempotency-Key': idempotencyKey }, body: JSON.stringify({}) }); },
  update(id: string, input: ISRAnyInput, extra: { expediente_id?: string | null; compareciente_id?: string | null; contribuyente_snapshot?: Record<string, unknown>; expected_updated_at?: string; replace_existing?: boolean } = {}) { return apiRequest<{ data: ISRRecord }>(`/isr/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify({ input_data: input, ...extra }) }).then(unwrap); },
  unlinkExpediente(id: string) { return apiRequest<{ data: ISRRecord; idempotent: boolean }>(`/isr/${encodeURIComponent(id)}/expediente-link`, { method: 'DELETE' }); },
  calculate(id: string, expectedVersion: number, requestKey = crypto.randomUUID()) { return apiRequest(`/isr/${encodeURIComponent(id)}/calculate`, { method: 'POST', headers: { 'Idempotency-Key': requestKey }, body: JSON.stringify({ expected_version: expectedVersion }) }); },
  generatePdf(id: string, expectedVersion: number, idempotencyKey = crypto.randomUUID()) { return apiRequest<{ data: ISRRecord['documentos'][number]['documento']; idempotent: boolean }>(`/isr/${encodeURIComponent(id)}/pdf`, { method: 'POST', headers: { 'Idempotency-Key': idempotencyKey }, body: JSON.stringify({ expected_version: expectedVersion }) }); },
  auditExport(id: string) { return apiRequest(`/isr/${encodeURIComponent(id)}/export-audit`, { method: 'POST' }); },
  extract(id: string, requestKey = crypto.randomUUID()) { return apiRequest(`/isr/${encodeURIComponent(id)}/extract`, { method: 'POST', headers: { 'Idempotency-Key': requestKey } }); },
  reviewProposal(id: string, proposalId: string, action: 'ACEPTADA' | 'RECHAZADA') { return apiRequest(`/isr/${encodeURIComponent(id)}/proposals/${encodeURIComponent(proposalId)}`, { method: 'PATCH', body: JSON.stringify({ action }) }); },
  upload(id: string, file: File) { const body = new FormData(); body.set('file', file); return apiRequest(`/isr/${encodeURIComponent(id)}/documents`, { method: 'POST', body }); },
  unlinkDocument(id: string, documentId: string) { return apiRequest(`/isr/${encodeURIComponent(id)}/documents/${encodeURIComponent(documentId)}`, { method: 'DELETE' }); },
  async preview(id: string, documentId: string) { return URL.createObjectURL(await stream(`/isr/${encodeURIComponent(id)}/documents/${encodeURIComponent(documentId)}/preview`)); },
  async download(id: string, documentId: string, name: string) { const url = URL.createObjectURL(await stream(`/isr/${encodeURIComponent(id)}/documents/${encodeURIComponent(documentId)}/download`)); const link = document.createElement('a'); link.href = url; link.download = name; link.click(); window.setTimeout(() => URL.revokeObjectURL(url), 1000); },
};
