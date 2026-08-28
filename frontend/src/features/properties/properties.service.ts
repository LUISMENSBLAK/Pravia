import { apiRequest } from '../../services/api/client';
import type { PropertyAIReview, PropertyForm, PropertyRecord } from './properties.types';

export const propertiesService = {
  get(id: string, signal?: AbortSignal) { return apiRequest<{ data: PropertyRecord }>(`/predios/${encodeURIComponent(id)}`, { signal }).then((payload) => payload.data); },
  create(input: PropertyForm) { return apiRequest<{ data: PropertyRecord }>('/predios', { method: 'POST', body: JSON.stringify(input) }).then((payload) => payload.data); },
  update(id: string, input: PropertyForm) { return apiRequest<{ data: PropertyRecord }>(`/predios/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(input) }).then((payload) => payload.data); },
  uploadDocument(id: string, file: File, tipo: string, observaciones = '') {
    const body = new FormData(); body.set('file', file); body.set('tipo', tipo); if (observaciones) body.set('observaciones', observaciones);
    return apiRequest<{ data: PropertyRecord }>(`/predios/${encodeURIComponent(id)}/documentos`, { method: 'POST', body }).then((payload) => payload.data);
  },
  documentUrl(id: string, documentId: string) { return apiRequest<{ url: string }>(`/predios/${encodeURIComponent(id)}/documentos/${encodeURIComponent(documentId)}/url`); },
  propose(id: string, documentId: string) { return apiRequest<{ data: PropertyAIReview }>(`/predios/${encodeURIComponent(id)}/extracciones/preview`, { method: 'POST', body: JSON.stringify({ documento_id: documentId }) }).then((payload) => payload.data); },
  applyProposal(id: string, extractionId: string, expectedVersion: number, decisions: Record<string, 'ACCEPT' | 'KEEP'>) {
    return apiRequest<{ data: PropertyRecord }>(`/predios/${encodeURIComponent(id)}/extracciones/${encodeURIComponent(extractionId)}/aplicar`, { method: 'POST', body: JSON.stringify({ expected_version: expectedVersion, decisions }) }).then((payload) => payload.data);
  },
};
