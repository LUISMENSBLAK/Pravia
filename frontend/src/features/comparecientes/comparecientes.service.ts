import { apiRequest, tokenStore } from '../../services/api/client';
import { apiUrl } from '../../services/api/config';
import type { ComparecienteDetail, ComparecienteFilters, ComparecienteListResult, DuplicateCandidate, NewComparecienteDraft, ScreeningHistory, ScreeningQuery, ScreeningResolutionDecision } from './comparecientes.types';

export type OwnershipNode = { id:string; party_kind:'PF'|'PM'; identity_mode:'LINKED'|'STRUCTURED_ONLY'; linked_compareciente_id?:string|null; display_name?:string|null; canonical_label?:string|null; incomplete?:boolean; metadata?:Record<string,unknown> };
export type OwnershipEdge = { id:string; owner_node_id:string; owned_node_id:string; percentage?:string|null; evidence_document_id?:string|null; evidence_document_version?:string|null; evidence_document_checksum?:string|null };
export type ControlFact = { id:string; subject_node_id:string; kind:'VOTE'|'APPOINTMENT'|'MANAGEMENT'|'AGREEMENT'|'OTHER'; description?:string|null; evidence_document_id?:string|null; human_confirmed?:boolean; evidence_document_version?:string|null; evidence_document_checksum?:string|null };
export type OwnershipGraph = { root_node_id:string; nodes:OwnershipNode[]; edges:OwnershipEdge[]; controls:ControlFact[]; incomplete_markers?:string[] };
export type OwnershipReconciliation = { id:string; status:'PENDING'|'ACCEPTED'|'REJECTED'; source_node_id:string; target_revision:number; canonical_fingerprint:string; local_branch_snapshot?:Record<string,unknown> };
export type OwnershipStructure = Omit<OwnershipGraph,'incomplete_markers'> & { configured:boolean; revision:number; fingerprint:string|null; incomplete_markers:string[]; expanded?:OwnershipGraph; expanded_fingerprint?:string|null; reconciliations:OwnershipReconciliation[] };
export type OwnershipLinkPreview = { node_id:string; before:OwnershipNode|null; canonical_identity:{id:string;nombre:string;tipo_persona:'FISICA'|'MORAL'}; target_structure_revision:number; target_fingerprint:string|null; confirmation:string };
export type OwnershipReconciliationPreview = {local:OwnershipGraph;current:OwnershipGraph;proposed:OwnershipGraph;review_token:string;identity_confirmations:Record<string,string>};
export type OwnershipAiProposal = { id:string; review_token:string; status:'PENDING'|'ACCEPTED'|'REJECTED'|'CONFLICT'; source_document_id:string; source_pages:number[]; base_revision:number; base_fingerprint:string; proposed_changes:{graph:OwnershipGraph;validation?:{hard_errors?:string[];incomplete_markers?:string[]}} };

const query = (filters: ComparecienteFilters) => {
  const params = new URLSearchParams();
  const values: Record<string, string | number | undefined> = {
    search: filters.search, tipo_persona: filters.type,
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
  update(id: string, input: Record<string, unknown>) { return apiRequest(`/comparecientes/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(input) }); },
  resolveConflict(id: string, sourceId: string, action: 'CONSERVAR_ACTUAL' | 'ACTUALIZAR') { return apiRequest(`/comparecientes/${encodeURIComponent(id)}/provenance/${encodeURIComponent(sourceId)}/resolve`, { method: 'PATCH', body: JSON.stringify({ action }) }); },
  startAssisted(type: string, originExpedienteId?: string | null) { return apiRequest<{ session: { id: string } }>('/comparecientes/altas', { method: 'POST', body: JSON.stringify({ tipo_persona: type, idempotency_key: globalThis.crypto?.randomUUID?.() || String(Date.now()), origen_expediente_id: originExpedienteId || undefined }) }); },
  uploadAssisted(sessionId: string, file: File, type = 'OTRO') { const body = new FormData(); body.set('archivo', file); body.set('tipo_documento', type); return apiRequest<{ documento: { id: string; nombre_original: string } }>(`/comparecientes/altas/${sessionId}/documentos`, { method: 'POST', body }); },
  extractAssisted(sessionId: string, ids: string[]) { return apiRequest<any>(`/comparecientes/altas/${sessionId}/extraer`, { method: 'POST', body: JSON.stringify({ documentos: ids }) }); },
  confirmAssisted(sessionId: string, draft: NewComparecienteDraft, ids: string[]) { return apiRequest<{ compareciente: { id: string } }>(`/comparecientes/altas/${sessionId}/confirmar`, { method: 'POST', body: JSON.stringify({
    ...draft,
    aliases: (draft.aliases || '').split(',').map((value) => value.trim()).filter(Boolean),
    nacionalidad_moral: draft.nacionalidad,
    duracion_moral: draft.duracion,
    fecha_inscripcion: draft.fecha_inscripcion_mercantil,
    dom_particular_cp: draft.dom_particular_codigo_postal,
    dom_fiscal_cp: draft.dom_fiscal_codigo_postal,
    documentos_integrar: ids,
  }) }); },
  cancelAssisted(sessionId: string) { return apiRequest(`/comparecientes/altas/${sessionId}`, { method: 'DELETE' }); },
  deleteAssistedDocument(sessionId: string, documentId: string) { return apiRequest(`/comparecientes/altas/${sessionId}/documentos/${documentId}`, { method: 'DELETE' }); },
  uploadDocument(id: string, file: File, category: string, metadata: { issueDate?: string; expiryDate?: string; notes?: string } = {}) { const body = new FormData(); body.set('file', file); body.set('categoria', category); if (metadata.issueDate) body.set('fecha_emision', metadata.issueDate); if (metadata.expiryDate) body.set('fecha_vencimiento', metadata.expiryDate); if (metadata.notes) body.set('observaciones', metadata.notes); return apiRequest(`/comparecientes/${encodeURIComponent(id)}/documentos`, { method: 'POST', body }); },
  deleteDocument(id: string, documentId: string) { return apiRequest(`/comparecientes/${encodeURIComponent(id)}/documentos/${encodeURIComponent(documentId)}`, { method: 'DELETE' }); },
  extractExisting(id: string) { return apiRequest<{ data: { values: Record<string,string>; proposals: Record<string,any>; conflicts: Array<Record<string,any>>; domicilios_detectados: Array<Record<string,any>> } }>(`/comparecientes/${encodeURIComponent(id)}/extraer-ia`, { method: 'POST' }).then(unwrap); },
  searchMaster(search:string,signal?:AbortSignal){const params=new URLSearchParams({page:'1',pageSize:'8',search});return apiRequest<{data:Array<{id:string;nombre:string;rfc?:string|null;curp?:string|null;tipo_persona:'FISICA'|'MORAL'}>}>(`/comparecientes?${params}`,{signal}).then(unwrap)},
  ownershipStructure(id:string,signal?:AbortSignal){return apiRequest<{data:OwnershipStructure}>(`/comparecientes/${encodeURIComponent(id)}/estructura-propiedad`,{signal}).then(unwrap)},
  previewOwnershipLinks(id:string,input:OwnershipGraph){return apiRequest<{data:OwnershipLinkPreview[]}>(`/comparecientes/${encodeURIComponent(id)}/estructura-propiedad/vinculos/preview`,{method:'POST',body:JSON.stringify(input)}).then(unwrap)},
  saveOwnershipStructure(id:string,input:OwnershipGraph&{expected_revision:number;idempotency_key:string;identity_confirmations?:Record<string,string>}){return apiRequest<{data:OwnershipStructure}>(`/comparecientes/${encodeURIComponent(id)}/estructura-propiedad`,{method:'PUT',body:JSON.stringify(input)}).then(unwrap)},
  previewOwnershipReconciliation(id:string,proposalId:string){return apiRequest<{data:OwnershipReconciliationPreview}>(`/comparecientes/${encodeURIComponent(id)}/estructura-propiedad/reconciliaciones/${encodeURIComponent(proposalId)}/preview`,{method:'POST'}).then(unwrap)},
  decideOwnershipReconciliation(id:string,proposalId:string,input:{decision:'ACCEPTED'|'REJECTED';graph?:OwnershipGraph;review_token?:string}){return apiRequest<{data:OwnershipReconciliation}>(`/comparecientes/${encodeURIComponent(id)}/estructura-propiedad/reconciliaciones/${encodeURIComponent(proposalId)}/decision`,{method:'POST',body:JSON.stringify(input)}).then(unwrap)},
  proposeOwnershipAi(id:string,documentId:string){return apiRequest<{data:OwnershipAiProposal}>(`/comparecientes/${encodeURIComponent(id)}/estructura-propiedad/propuestas-ia`,{method:'POST',body:JSON.stringify({document_id:documentId})}).then(unwrap)},
  ownershipAiProposal(id:string,proposalId:string){return apiRequest<{data:OwnershipAiProposal}>(`/comparecientes/${encodeURIComponent(id)}/estructura-propiedad/propuestas-ia/${encodeURIComponent(proposalId)}`).then(unwrap)},
  decideOwnershipAi(id:string,proposalId:string,input:{decision:'CONFIRMED'|'REJECTED';graph?:OwnershipGraph;review_token?:string;identity_confirmations?:Record<string,string>}){return apiRequest<{data:OwnershipAiProposal}>(`/comparecientes/${encodeURIComponent(id)}/estructura-propiedad/propuestas-ia/${encodeURIComponent(proposalId)}/decision`,{method:'POST',body:JSON.stringify(input)}).then(unwrap)},
  screening(id: string, signal?: AbortSignal) { return apiRequest<ScreeningHistory>(`/cumplimiento/screening/comparecientes/${encodeURIComponent(id)}`, { signal }); },
  rerunScreening(id: string, idempotencyKey: string) { return apiRequest<{ data: ScreeningQuery }>(`/cumplimiento/screening/comparecientes/${encodeURIComponent(id)}/rerun`, { method: 'POST', body: JSON.stringify({ idempotency_key: idempotencyKey }) }).then(unwrap); },
  resolveScreeningCandidate(id: string, queryId: string, candidateId: string, decision: ScreeningResolutionDecision, rationale: string) { return apiRequest(`/cumplimiento/screening/comparecientes/${encodeURIComponent(id)}/queries/${encodeURIComponent(queryId)}/candidates/${encodeURIComponent(candidateId)}/resolutions`, { method: 'POST', body: JSON.stringify({ decision, rationale }) }); },
  generateScreeningReport(id: string, queryId: string, idempotencyKey: string) { return apiRequest(`/cumplimiento/screening/comparecientes/${encodeURIComponent(id)}/queries/${encodeURIComponent(queryId)}/reports`, { method: 'POST', body: JSON.stringify({ idempotency_key: idempotencyKey }) }); },
  async previewDocument(id: string, documentId: string) {
    const headers = new Headers(); const token = tokenStore.get(); if (token) headers.set('Authorization', `Bearer ${token}`);
    const response = await fetch(apiUrl(`/comparecientes/${encodeURIComponent(id)}/documentos/${encodeURIComponent(documentId)}/visualizar`), { credentials: 'include', headers });
    if (!response.ok) throw new Error('El documento no está disponible.');
    return URL.createObjectURL(await response.blob());
  },
  async previewAssistedDocument(sessionId: string, documentId: string) {
    const headers = new Headers(); const token = tokenStore.get(); if (token) headers.set('Authorization', `Bearer ${token}`);
    const response = await fetch(apiUrl(`/comparecientes/altas/${encodeURIComponent(sessionId)}/documentos/${encodeURIComponent(documentId)}/stream`), { credentials: 'include', headers });
    if (!response.ok) throw new Error('El documento no está disponible.');
    return URL.createObjectURL(await response.blob());
  },
  async downloadAssistedDocument(sessionId: string, documentId: string, name: string) {
    const headers = new Headers(); const token = tokenStore.get(); if (token) headers.set('Authorization', `Bearer ${token}`);
    const response = await fetch(apiUrl(`/comparecientes/altas/${encodeURIComponent(sessionId)}/documentos/${encodeURIComponent(documentId)}/stream`), { credentials: 'include', headers });
    if (!response.ok) throw new Error('El documento no está disponible.');
    const url = URL.createObjectURL(await response.blob()); const link = document.createElement('a'); link.href = url; link.download = name; link.click(); window.setTimeout(() => URL.revokeObjectURL(url),1000);
  },
  async downloadDocument(id: string, documentId: string, name: string) {
    const headers = new Headers(); const token = tokenStore.get(); if (token) headers.set('Authorization', `Bearer ${token}`);
    const response = await fetch(apiUrl(`/comparecientes/${encodeURIComponent(id)}/documentos/${encodeURIComponent(documentId)}/descargar`), { credentials: 'include', headers });
    if (!response.ok) throw new Error('El documento no está disponible.');
    const url = URL.createObjectURL(await response.blob()); const link = document.createElement('a'); link.href = url; link.download = name; link.click(); window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  },
};
