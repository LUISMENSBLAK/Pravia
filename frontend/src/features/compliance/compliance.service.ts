import { apiRequest } from '../../services/api/client';
import type { ComplianceCatalogs, ComplianceDetail, ComplianceList, ComplianceReview } from './compliance.types';

const query = (values: Record<string, string | number | undefined>) => {
  const params = new URLSearchParams();
  Object.entries(values).forEach(([key, value]) => { if (value !== undefined && value !== '' && value !== 'TODOS') params.set(key, String(value)); });
  return params.toString();
};

export const complianceService = {
  catalogs: async (signal?: AbortSignal) => { const response = await apiRequest<{ success: boolean } & ComplianceCatalogs>('/cumplimiento/catalogos', { signal }); return response; },
  list: async (filters: Record<string, string | number | undefined>, signal?: AbortSignal) => { const response = await apiRequest<{ success: boolean } & ComplianceList>(`/cumplimiento/revisiones?${query(filters)}`, { signal }); return response; },
  detail: async (id: string, signal?: AbortSignal) => { const response = await apiRequest<{ success: boolean } & ComplianceDetail>(`/cumplimiento/revisiones/${id}`, { signal }); return response; },
  create: async (body: any) => { const response = await apiRequest<{ revision: ComplianceReview }>('/cumplimiento/revisiones', { method: 'POST', body: JSON.stringify(body) }); return response.revision; },
  evaluate: async (id: string, cuestionario: Record<string, any>) => { const response = await apiRequest<{ revision: ComplianceReview }>(`/cumplimiento/revisiones/${id}/evaluar`, { method: 'POST', body: JSON.stringify({ cuestionario }) }); return response.revision; },
  decide: async (id: string, decision: 'CONFIRMAR' | 'REQUIERE_AJUSTES', observaciones: string) => { const response = await apiRequest<{ revision: ComplianceReview }>(`/cumplimiento/revisiones/${id}/revisar`, { method: 'POST', body: JSON.stringify({ decision, observaciones }) }); return response.revision; },
  reevaluate: async (id: string) => { const response = await apiRequest<{ revision: ComplianceReview }>(`/cumplimiento/revisiones/${id}/reevaluar`, { method: 'POST', body: JSON.stringify({ conservar_respuestas: true }) }); return response.revision; },
  addEvidence: async (id: string, body: any) => apiRequest(`/cumplimiento/revisiones/${id}/evidencias`, { method: 'POST', body: JSON.stringify(body) }),
};
