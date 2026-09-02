import { apiRequest, tokenStore } from '../../services/api/client';
import { apiUrl } from '../../services/api/config';
import type { ComplianceCatalogs, ComplianceDetail, ComplianceDocumentStructure, ComplianceList, ComplianceReview } from './compliance.types';

const query = (values: Record<string, string | number | undefined>) => {
  const params = new URLSearchParams();
  Object.entries(values).forEach(([key, value]) => { if (value !== undefined && value !== '' && value !== 'TODOS') params.set(key, String(value)); });
  return params.toString();
};

export const complianceService = {
  documentStructure: async (expedienteId: string, signal?: AbortSignal) => apiRequest<{ success: boolean } & ComplianceDocumentStructure>(`/cumplimiento/expedientes/${encodeURIComponent(expedienteId)}/documental`, { signal }),
  uploadSignedEvidence: async (expedienteId: string, requirementId: string, file: File) => {
    const body = new FormData(); body.set('file', file);
    return apiRequest(`/cumplimiento/expedientes/${encodeURIComponent(expedienteId)}/documental/requisitos/${encodeURIComponent(requirementId)}/cargar-firmado`, { method: 'POST', body });
  },
  validateDocumentEvidence: async (expedienteId: string, evidenceId: string, result: 'VALIDATED' | 'REJECTED', notes = '') => apiRequest(`/cumplimiento/expedientes/${encodeURIComponent(expedienteId)}/documental/evidencias/${encodeURIComponent(evidenceId)}/validar`, { method: 'POST', body: JSON.stringify({ result, notes }) }),
  exportDocumentPackage: async (expedienteId: string) => {
    const headers = new Headers(); const token = tokenStore.get(); if (token) headers.set('Authorization', `Bearer ${token}`);
    const response = await fetch(apiUrl(`/cumplimiento/expedientes/${encodeURIComponent(expedienteId)}/documental/exportar`), { credentials: 'include', headers });
    if (!response.ok) { const payload = await response.json().catch(() => null); throw new Error(payload?.error || 'No fue posible exportar el expediente de cumplimiento.'); }
    return response.blob();
  },
  catalogs: async (signal?: AbortSignal) => { const response = await apiRequest<{ success: boolean } & ComplianceCatalogs>('/cumplimiento/catalogos', { signal }); return response; },
  list: async (filters: Record<string, string | number | undefined>, signal?: AbortSignal) => { const response = await apiRequest<{ success: boolean } & ComplianceList>(`/cumplimiento/revisiones?${query(filters)}`, { signal }); return response; },
  detail: async (id: string, signal?: AbortSignal) => { const response = await apiRequest<{ success: boolean } & ComplianceDetail>(`/cumplimiento/revisiones/${id}`, { signal }); return response; },
  create: async (body: any) => { const response = await apiRequest<{ revision: ComplianceReview }>('/cumplimiento/revisiones', { method: 'POST', body: JSON.stringify(body) }); return response.revision; },
  evaluateLegalCase: async (expedienteId: string, body: { idempotency_key: string; fecha_juridica_confirmada?: string }) => {
    const response = await apiRequest<{ evaluation: { review: ComplianceReview } }>(`/cumplimiento/expedientes/${encodeURIComponent(expedienteId)}/evaluaciones-legales`, { method: 'POST', body: JSON.stringify(body) });
    return response.evaluation.review;
  },
  evaluate: async (id: string, cuestionario: Record<string, any>) => { const response = await apiRequest<{ revision: ComplianceReview }>(`/cumplimiento/revisiones/${id}/evaluar`, { method: 'POST', body: JSON.stringify({ cuestionario }) }); return response.revision; },
  decide: async (id: string, decision: 'CONFIRMAR' | 'REQUIERE_AJUSTES', observaciones: string) => { const response = await apiRequest<{ revision: ComplianceReview }>(`/cumplimiento/revisiones/${id}/revisar`, { method: 'POST', body: JSON.stringify({ decision, observaciones }) }); return response.revision; },
  reevaluate: async (id: string) => { const response = await apiRequest<{ revision: ComplianceReview }>(`/cumplimiento/revisiones/${id}/reevaluar`, { method: 'POST', body: JSON.stringify({ conservar_respuestas: true }) }); return response.revision; },
  addEvidence: async (id: string, body: any) => apiRequest(`/cumplimiento/revisiones/${id}/evidencias`, { method: 'POST', body: JSON.stringify(body) }),
  addPayment: async (id: string, body: any) => apiRequest(`/cumplimiento/revisiones/${id}/pagos`, { method: 'POST', body: JSON.stringify(body) }),
  saveBeneficialOwner: async (id: string, body: any) => apiRequest(`/cumplimiento/revisiones/${id}/beneficiarios-controladores`, { method: 'POST', body: JSON.stringify(body) }),
  savePepReview: async (id: string, body: any) => apiRequest(`/cumplimiento/revisiones/${id}/pep`, { method: 'POST', body: JSON.stringify(body) }),
  confirmExternalNotice: async (id: string, obligationId: string, body: any) => apiRequest(`/cumplimiento/revisiones/${id}/obligaciones/${obligationId}/presentacion-externa`, { method: 'POST', body: JSON.stringify(body) }),
  retireEvidence: async (id: string, evidenceId: string, reason: string) => apiRequest(`/cumplimiento/revisiones/${id}/evidencias/${evidenceId}/retirar`, { method: 'POST', body: JSON.stringify({ reason }) }),
  evidenceBlob: async (id: string, evidenceId: string) => {
    const response = await fetch(`/api/cumplimiento/revisiones/${encodeURIComponent(id)}/evidencias/${encodeURIComponent(evidenceId)}/archivo`, { credentials: 'include' });
    if (!response.ok) throw new Error('No fue posible preparar la vista previa protegida.');
    return response.blob();
  },
};
