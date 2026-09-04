import { apiRequest, tokenStore } from "../../services/api/client";
import { apiUrl } from "../../services/api/config";
import type {
  ComplianceCatalogs,
  ComplianceDetail,
  ComplianceDocumentStructure,
  ComplianceList,
  ComplianceReview,
  ComplianceScreeningOperation,
} from "./compliance.types";

export type BeneficialControllerEvaluation = {
  id: string;
  review_id: string;
  regime: "LFPIORPI" | "CFF_RMF";
  status: string;
  legal_date?: string | null;
  rule_set_checksum?: string | null;
  created_at: string;
  reevaluation_required?: boolean;
  structure_path?: string | null;
  target_name?: string;
  supports?: Array<{ document_id: string; label: string; path: string }>;
  results: Array<{
    id: string;
    determination: string;
    subject_name?: string;
    subject_path?: string | null;
    subject_compareciente_id?: string | null;
    subject_snapshot_node_id?: string | null;
    result_snapshot?: Record<string, unknown>;
  }>;
  snapshot: {
    id: string;
    structure_revision: number;
    structure_fingerprint: string;
    incomplete_markers: string[];
  };
};
export type BeneficialControllerSummary = {
  current_review_id: string | null;
  configured_legal_rules: boolean;
  evaluations: BeneficialControllerEvaluation[];
  history: BeneficialControllerEvaluation[];
  snapshots: Array<Record<string, unknown>>;
  legacy_promoted: boolean;
};

const query = (values: Record<string, string | number | undefined>) => {
  const params = new URLSearchParams();
  Object.entries(values).forEach(([key, value]) => {
    if (value !== undefined && value !== "" && value !== "TODOS")
      params.set(key, String(value));
  });
  return params.toString();
};

export const complianceService = {
  h5Workspace: async (reviewId: string, signal?: AbortSignal) =>
    apiRequest<{ success: boolean; data: any }>(
      `/cumplimiento/revisiones/${encodeURIComponent(reviewId)}/h5`,
      { signal },
    ).then((response) => response.data),
  beneficialController: async (expedienteId: string, signal?: AbortSignal) =>
    apiRequest<{ success: boolean; data: BeneficialControllerSummary }>(
      `/cumplimiento/expedientes/${encodeURIComponent(expedienteId)}/beneficiario-controlador`,
      { signal },
    ).then((response) => response.data),
  screeningOperation: async (expedienteId: string, signal?: AbortSignal) =>
    apiRequest<{ success: boolean } & ComplianceScreeningOperation>(
      `/cumplimiento/screening/expedientes/${encodeURIComponent(expedienteId)}`,
      { signal },
    ),
  documentStructure: async (expedienteId: string, signal?: AbortSignal) =>
    apiRequest<{ success: boolean } & ComplianceDocumentStructure>(
      `/cumplimiento/expedientes/${encodeURIComponent(expedienteId)}/documental`,
      { signal },
    ),
  uploadSignedEvidence: async (
    expedienteId: string,
    requirementId: string,
    file: File,
  ) => {
    const body = new FormData();
    body.set("file", file);
    return apiRequest(
      `/cumplimiento/expedientes/${encodeURIComponent(expedienteId)}/documental/requisitos/${encodeURIComponent(requirementId)}/cargar-firmado`,
      { method: "POST", body },
    );
  },
  validateDocumentEvidence: async (
    expedienteId: string,
    evidenceId: string,
    result: "VALIDATED" | "REJECTED",
    notes = "",
  ) =>
    apiRequest(
      `/cumplimiento/expedientes/${encodeURIComponent(expedienteId)}/documental/evidencias/${encodeURIComponent(evidenceId)}/validar`,
      { method: "POST", body: JSON.stringify({ result, notes }) },
    ),
  exportDocumentPackage: async (expedienteId: string) => {
    const headers = new Headers();
    const token = tokenStore.get();
    if (token) headers.set("Authorization", `Bearer ${token}`);
    const response = await fetch(
      apiUrl(
        `/cumplimiento/expedientes/${encodeURIComponent(expedienteId)}/documental/exportar`,
      ),
      { credentials: "include", headers },
    );
    if (!response.ok) {
      const payload = await response.json().catch(() => null);
      throw new Error(
        payload?.error ||
          "No fue posible exportar el expediente de cumplimiento.",
      );
    }
    return response.blob();
  },
  catalogs: async (signal?: AbortSignal) => {
    const response = await apiRequest<
      { success: boolean } & ComplianceCatalogs
    >("/cumplimiento/catalogos", { signal });
    return response;
  },
  list: async (
    filters: Record<string, string | number | undefined>,
    signal?: AbortSignal,
  ) => {
    const response = await apiRequest<{ success: boolean } & ComplianceList>(
      `/cumplimiento/revisiones?${query(filters)}`,
      { signal },
    );
    return response;
  },
  detail: async (id: string, signal?: AbortSignal) => {
    const response = await apiRequest<{ success: boolean } & ComplianceDetail>(
      `/cumplimiento/revisiones/${id}`,
      { signal },
    );
    return response;
  },
  create: async (body: any) => {
    const response = await apiRequest<{ revision: ComplianceReview }>(
      "/cumplimiento/revisiones",
      { method: "POST", body: JSON.stringify(body) },
    );
    return response.revision;
  },
  evaluateLegalCase: async (
    expedienteId: string,
    body: { idempotency_key: string; fecha_juridica_confirmada?: string },
  ) => {
    const response = await apiRequest<{
      evaluation: { review: ComplianceReview };
    }>(
      `/cumplimiento/expedientes/${encodeURIComponent(expedienteId)}/evaluaciones-legales`,
      { method: "POST", body: JSON.stringify(body) },
    );
    return response.evaluation.review;
  },
  evaluate: async (id: string, cuestionario: Record<string, any>) => {
    const response = await apiRequest<{ revision: ComplianceReview }>(
      `/cumplimiento/revisiones/${id}/evaluar`,
      { method: "POST", body: JSON.stringify({ cuestionario }) },
    );
    return response.revision;
  },
  decide: async (
    id: string,
    decision: "CONFIRMAR" | "REQUIERE_AJUSTES",
    observaciones: string,
  ) => {
    const response = await apiRequest<{ revision: ComplianceReview }>(
      `/cumplimiento/revisiones/${id}/revisar`,
      { method: "POST", body: JSON.stringify({ decision, observaciones }) },
    );
    return response.revision;
  },
  reevaluate: async (id: string) => {
    const response = await apiRequest<{ revision: ComplianceReview }>(
      `/cumplimiento/revisiones/${id}/reevaluar`,
      { method: "POST", body: JSON.stringify({ conservar_respuestas: true }) },
    );
    return response.revision;
  },
  addEvidence: async (id: string, body: any) =>
    apiRequest(`/cumplimiento/revisiones/${id}/evidencias`, {
      method: "POST",
      body: JSON.stringify(body),
    }),
  addPayment: async (id: string, body: any) =>
    apiRequest(`/cumplimiento/revisiones/${id}/pagos`, {
      method: "POST",
      body: JSON.stringify(body),
    }),
  saveH5Payment: async (id: string, body: any) =>
    apiRequest(`/cumplimiento/revisiones/${encodeURIComponent(id)}/h5/pagos`, {
      method: "POST",
      body: JSON.stringify(body),
    }),
  generateH5QuestionnairePdf: async (id: string) => {
    const token = tokenStore.get();
    const response = await fetch(apiUrl(`/cumplimiento/h5/cuestionarios/${encodeURIComponent(id)}/resumen-interno.pdf`), {
      method: "POST", credentials: "include", headers: { Accept: "application/pdf", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    });
    if (!response.ok) throw new Error("No fue posible registrar el documento interno autorizado.");
    return response.blob();
  },
  prepareH5PaymentProposal: (reviewId: string, body: any) => apiRequest(`/cumplimiento/revisiones/${encodeURIComponent(reviewId)}/h5/pagos/propuestas`, { method: "POST", body: JSON.stringify(body) }),
  confirmH5PaymentProposal: (proposalId: string, body: any) => apiRequest(`/cumplimiento/h5/pagos/propuestas/${encodeURIComponent(proposalId)}/confirmar`, { method: "POST", body: JSON.stringify(body) }),
  rejectH5PaymentProposal: (proposalId: string, body: any) => apiRequest(`/cumplimiento/h5/pagos/propuestas/${encodeURIComponent(proposalId)}/rechazar`, { method: "POST", body: JSON.stringify(body) }),
  verifyH5Payment: (revisionId: string, body: any) => apiRequest(`/cumplimiento/h5/pagos/revisiones/${encodeURIComponent(revisionId)}/verificaciones`, { method: "POST", body: JSON.stringify(body) }),
  confirmH5Provider: (revisionId: string, relationId: string, body: any) => apiRequest(`/cumplimiento/h5/pagos/revisiones/${encodeURIComponent(revisionId)}/proveedores/${encodeURIComponent(relationId)}/confirmar`, { method: "POST", body: JSON.stringify(body) }),
  ensureH5Questionnaires: async (id: string) =>
    apiRequest(
      `/cumplimiento/revisiones/${encodeURIComponent(id)}/h5/cuestionarios/asegurar`,
      { method: "POST", body: JSON.stringify({}) },
    ),
  saveH5Questionnaire: async (
    assessmentId: string,
    body: any,
    finalize = false,
  ) =>
    apiRequest(
      `/cumplimiento/h5/cuestionarios/${encodeURIComponent(assessmentId)}/${finalize ? "finalizar" : "revisiones"}`,
      { method: "POST", body: JSON.stringify(body) },
    ),
  saveBeneficialOwner: async (id: string, body: any) =>
    apiRequest(`/cumplimiento/revisiones/${id}/beneficiarios-controladores`, {
      method: "POST",
      body: JSON.stringify(body),
    }),
  savePepReview: async (id: string, body: any) =>
    apiRequest(`/cumplimiento/revisiones/${id}/pep`, {
      method: "POST",
      body: JSON.stringify(body),
    }),
  confirmExternalNotice: async (id: string, obligationId: string, body: any) =>
    apiRequest(
      `/cumplimiento/revisiones/${id}/obligaciones/${obligationId}/presentacion-externa`,
      { method: "POST", body: JSON.stringify(body) },
    ),
  retireEvidence: async (id: string, evidenceId: string, reason: string) =>
    apiRequest(
      `/cumplimiento/revisiones/${id}/evidencias/${evidenceId}/retirar`,
      { method: "POST", body: JSON.stringify({ reason }) },
    ),
  evidenceBlob: async (id: string, evidenceId: string) => {
    const response = await fetch(
      `/api/cumplimiento/revisiones/${encodeURIComponent(id)}/evidencias/${encodeURIComponent(evidenceId)}/archivo`,
      { credentials: "include" },
    );
    if (!response.ok)
      throw new Error("No fue posible preparar la vista previa protegida.");
    return response.blob();
  },
};
