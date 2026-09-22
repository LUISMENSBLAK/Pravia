import { apiRequest } from '../../services/api/client';
import type { PropertyAIReview, PropertyForm, PropertyImportableDocument, PropertyListItem, PropertyRecord } from './properties.types';

export const propertiesService = {
  list(search = '', signal?: AbortSignal) { const params = new URLSearchParams({ search, limit: '50' }); return apiRequest<{ data: PropertyListItem[] }>(`/predios?${params}`, { signal }); },
  get(id: string, signal?: AbortSignal) { return apiRequest<{ data: PropertyRecord }>(`/predios/${encodeURIComponent(id)}`, { signal }).then((payload) => payload.data); },
  create(input: PropertyForm) { return apiRequest<{ data: PropertyRecord }>('/predios', { method: 'POST', body: JSON.stringify(input) }).then((payload) => payload.data); },
  update(id: string, input: PropertyForm) { return apiRequest<{ data: PropertyRecord }>(`/predios/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(input) }).then((payload) => payload.data); },
  uploadDocument(id: string, file: File, tipo: string, observaciones = '', options: { vigencia?: 'VIGENTE' | 'HISTORICO'; principal?: boolean } = {}) {
    const body = new FormData(); body.set('file', file); body.set('tipo', tipo); body.set('vigencia', options.vigencia || 'VIGENTE'); body.set('es_antecedente_principal', String(Boolean(options.principal))); if (observaciones) body.set('observaciones', observaciones);
    return apiRequest<{ data: PropertyRecord }>(`/predios/${encodeURIComponent(id)}/documentos`, { method: 'POST', body }).then((payload) => payload.data);
  },
  documentUrl(id: string, documentId: string) { return apiRequest<{ url: string }>(`/predios/${encodeURIComponent(id)}/documentos/${encodeURIComponent(documentId)}/url`); },
  updateDocument(id: string, linkId: string, input: { vigencia?: 'VIGENTE' | 'HISTORICO'; es_antecedente_principal?: boolean; tipo_vinculo?: string }) { return apiRequest<{ data: PropertyRecord }>(`/predios/${encodeURIComponent(id)}/documentos/vinculos/${encodeURIComponent(linkId)}`, { method: 'PATCH', body: JSON.stringify(input) }).then((payload) => payload.data); },
  expedienteDocuments(id: string, expedienteId: string, signal?: AbortSignal) { return apiRequest<{ data: PropertyImportableDocument[] }>(`/predios/${encodeURIComponent(id)}/expedientes/${encodeURIComponent(expedienteId)}/documentos`, { signal }).then((payload) => payload.data); },
  importExpedienteDocument(id: string, expedienteId: string, expedienteDocumentoId: string, tipo: string, principal = false) { return apiRequest<{ data: PropertyRecord }>(`/predios/${encodeURIComponent(id)}/expedientes/${encodeURIComponent(expedienteId)}/documentos/importar`, { method: 'POST', body: JSON.stringify({ expediente_documento_id: expedienteDocumentoId, tipo, es_antecedente_principal: principal }) }).then((payload) => payload.data); },
  propose(id: string, documentIds: string[]) { return apiRequest<{ data: PropertyAIReview }>(`/predios/${encodeURIComponent(id)}/extracciones/preview`, { method: 'POST', body: JSON.stringify({ documento_ids: documentIds }) }).then((payload) => payload.data); },
  applyProposal(id: string, extractionId: string, expectedVersion: number, decisions: Record<string, 'ACCEPT' | 'KEEP'>) {
    return apiRequest<{ data: PropertyRecord }>(`/predios/${encodeURIComponent(id)}/extracciones/${encodeURIComponent(extractionId)}/aplicar`, { method: 'POST', body: JSON.stringify({ expected_version: expectedVersion, decisions }) }).then((payload) => payload.data);
  },
};
