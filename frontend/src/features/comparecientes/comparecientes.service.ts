import { apiRequest, tokenStore } from '../../services/api/client';
import { apiUrl } from '../../services/api/config';
import type { ComparecienteDetail, ComparecienteFilters, ComparecienteListResult, DuplicateCandidate, NewComparecienteDraft } from './comparecientes.types';

const query = (filters: ComparecienteFilters) => {
  const params = new URLSearchParams();
  const values: Record<string, string | number | undefined> = {
    search: filters.search, tipo_persona: filters.type, identidad: filters.identity, cumplimiento: filters.compliance,
    actualizacion: filters.updated, sort: filters.sort || 'updated_at:desc', page: filters.page || 1, pageSize: filters.pageSize || 20,
  };
  Object.entries(values).forEach(([key, value]) => { if (value !== undefined && value !== '') params.set(key, String(value)); });
  return params.toString();
};

const unwrap = <T>(payload: { data: T }) => payload.data;
const clean = (value?: string) => value?.trim() || undefined;

export const comparecientesService = {
  list(filters: ComparecienteFilters, signal?: AbortSignal) { return apiRequest<ComparecienteListResult>(`/comparecientes?${query(filters)}`, { signal }); },
  detail(id: string, signal?: AbortSignal) { return apiRequest<{ data: ComparecienteDetail }>(`/comparecientes/${encodeURIComponent(id)}`, { signal }).then(unwrap); },
  catalogs(signal?: AbortSignal) { return apiRequest<{ data: { caracteresCompareciente: Array<{ id: string; nombre: string }> } }>('/comparecientes/catalogos', { signal }).then(unwrap); },
  searchCases(search: string, signal?: AbortSignal) { const params = new URLSearchParams({ page: '1', pageSize: '20', search }); return apiRequest<{ data: Array<{ id: string; numero_pravia: string; cliente_principal?: string; tipo_acto?: { nombre: string } }> }>(`/expedientes?${params}`, { signal }).then((payload) => payload.data); },
  duplicates(draft: NewComparecienteDraft, signal?: AbortSignal) {
    const params = new URLSearchParams();
    const name = draft.tipo_persona === 'FISICA' ? [draft.nombre, draft.apellido_paterno, draft.apellido_materno].filter(Boolean).join(' ') : draft.razon_social;
    Object.entries({ nombre: name, rfc: draft.rfc, curp: draft.curp, correo: draft.correo, telefono: draft.telefono }).forEach(([key, value]) => { if (clean(value)) params.set(key, clean(value)!); });
    return apiRequest<{ data: DuplicateCandidate[] }>(`/comparecientes/duplicados?${params}`, { signal }).then(unwrap);
  },
  create(draft: NewComparecienteDraft) {
    const domicilio = draft.calle || draft.colonia || draft.codigo_postal ? { tipo: draft.tipo_persona === 'FISICA' ? 'PARTICULAR' : 'FISCAL', pais: draft.pais || 'México', estado: clean(draft.estado), municipio: clean(draft.municipio), colonia: clean(draft.colonia), calle: clean(draft.calle), exterior: clean(draft.exterior), interior: clean(draft.interior), codigo_postal: clean(draft.codigo_postal) } : undefined;
    const contacto = draft.correo ? { tipo: 'CORREO', valor: draft.correo } : draft.telefono ? { tipo: 'TELEFONO', valor: draft.telefono } : undefined;
    if (draft.tipo_persona === 'FISICA') return apiRequest<{ data: { compareciente: { id: string } } }>('/comparecientes/persona-fisica', { method: 'POST', body: JSON.stringify({ nombre: draft.nombre, apellido_paterno: clean(draft.apellido_paterno), apellido_materno: clean(draft.apellido_materno), rfc: clean(draft.rfc), curp: clean(draft.curp), fecha_nacimiento: clean(draft.fecha_nacimiento), nacionalidad: clean(draft.nacionalidad), estado_civil: clean(draft.estado_civil), ocupacion: clean(draft.ocupacion), pep_estado: draft.pep_estado || 'PENDIENTE', domicilio_principal: domicilio, contacto_principal: contacto, identificacion_principal: draft.folio_identificacion ? { tipo_identificacion: draft.tipo_identificacion || 'INE', numero: draft.folio_identificacion, fecha_vencimiento: clean(draft.fecha_vencimiento_identificacion) } : undefined }) });
    return apiRequest<{ data: { compareciente: { id: string } } }>('/comparecientes/persona-moral', { method: 'POST', body: JSON.stringify({ razon_social: draft.razon_social, nombre_comercial: clean(draft.nombre_comercial), tipo_societario: clean(draft.tipo_societario), rfc: clean(draft.rfc), fecha_constitucion: clean(draft.fecha_constitucion), folio_mercantil: clean(draft.folio_mercantil), objeto_social_resumido: clean(draft.objeto_social_resumido), nacionalidad: clean(draft.nacionalidad), domicilio_principal: domicilio, contacto_principal: contacto }) });
  },
  update(id: string, input: Record<string, string>) { return apiRequest(`/comparecientes/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(input) }); },
  resolveConflict(id: string, sourceId: string, action: 'CONSERVAR_ACTUAL' | 'ACTUALIZAR') { return apiRequest(`/comparecientes/${encodeURIComponent(id)}/provenance/${encodeURIComponent(sourceId)}/resolve`, { method: 'PATCH', body: JSON.stringify({ action }) }); },
  startAssisted(type: string) { return apiRequest<{ session: { id: string } }>('/comparecientes/altas', { method: 'POST', body: JSON.stringify({ tipo_persona: type, idempotency_key: globalThis.crypto?.randomUUID?.() || String(Date.now()) }) }); },
  uploadAssisted(sessionId: string, file: File, type = 'OTRO') { const body = new FormData(); body.set('archivo', file); body.set('tipo_documento', type); return apiRequest<{ documento: { id: string; nombre_original: string } }>(`/comparecientes/altas/${sessionId}/documentos`, { method: 'POST', body }); },
  extractAssisted(sessionId: string, ids: string[]) { return apiRequest<any>(`/comparecientes/altas/${sessionId}/extraer`, { method: 'POST', body: JSON.stringify({ documentos: ids }) }); },
  confirmAssisted(sessionId: string, draft: NewComparecienteDraft, ids: string[]) { return apiRequest<{ compareciente: { id: string } }>(`/comparecientes/altas/${sessionId}/confirmar`, { method: 'POST', body: JSON.stringify({ ...draft, documentos_integrar: ids }) }); },
  uploadDocument(id: string, file: File, category: string, metadata: { issueDate?: string; expiryDate?: string; notes?: string } = {}) { const body = new FormData(); body.set('file', file); body.set('categoria', category); if (metadata.issueDate) body.set('fecha_emision', metadata.issueDate); if (metadata.expiryDate) body.set('fecha_vencimiento', metadata.expiryDate); if (metadata.notes) body.set('observaciones', metadata.notes); return apiRequest(`/comparecientes/${encodeURIComponent(id)}/documentos`, { method: 'POST', body }); },
  linkCase(id: string, input: { expediente_id: string; caracter_id: string; observaciones?: string }) { return apiRequest('/comparecientes/vincular-expediente', { method: 'POST', body: JSON.stringify({ ...input, compareciente_id: id }) }); },
  async previewDocument(id: string, documentId: string) {
    const headers = new Headers(); const token = tokenStore.get(); if (token) headers.set('Authorization', `Bearer ${token}`);
    const response = await fetch(apiUrl(`/comparecientes/${encodeURIComponent(id)}/documentos/${encodeURIComponent(documentId)}/visualizar`), { credentials: 'include', headers });
    if (!response.ok) throw new Error('El documento no está disponible.');
    return URL.createObjectURL(await response.blob());
  },
  async downloadDocument(id: string, documentId: string, name: string) {
    const headers = new Headers(); const token = tokenStore.get(); if (token) headers.set('Authorization', `Bearer ${token}`);
    const response = await fetch(apiUrl(`/comparecientes/${encodeURIComponent(id)}/documentos/${encodeURIComponent(documentId)}/descargar`), { credentials: 'include', headers });
    if (!response.ok) throw new Error('El documento no está disponible.');
    const url = URL.createObjectURL(await response.blob()); const link = document.createElement('a'); link.href = url; link.download = name; link.click(); window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  },
};
