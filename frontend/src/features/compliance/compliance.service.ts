import { apiRequest, tokenStore } from "../../services/api/client";
import { apiUrl } from "../../services/api/config";
import type {
  ComplianceCatalogs,
  ComplianceDetail,
  ComplianceDocumentStructure,
  ComplianceList,
  ComplianceReview,
  ComplianceScreeningOperation,
  H8Panel,
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

export type H6NoticeWorkspace = {
  post_sign_materialization: "EN_PROCESO" | "CURRENT";
  acknowledgement_documents: Array<{ id: string; nombre_original: string; tipo: string; fecha_carga: string }>;
  obligations: Array<{
    id: string; legal_obligation_key: string | null; channel_code: string | null; obligation_type_code: string | null;
    avi_state: string; freshness: "CURRENT" | "STALE"; review_needed: boolean; due_at: string | null;
    ficheRevisions: Array<{ id: string; status: "DRAFT" | "VALIDATED"; version: number; revision_number: number; local_values: Record<string, unknown>; source_manifest: Array<Record<string, unknown>>; officialRevision?: { schema_json: { fields: Array<{ key: string; label?: string; authority: "MASTER_SOURCE" | "NOTICE_LOCAL_FIELD"; required?: boolean; path?: string; type?: string; input_type?: string; max_length?: number }> } } }>;
    officialProducts: Array<{ id: string; documento_id: string; checksum: string; created_at: string }>;
    presentations: Array<{
      id: string; kind: "NORMAL" | "COMPLEMENTARIA" | "CORRECCION"; presented_at: string; external_folio: string | null;
      previous_presentation_id: string | null;
      product: { id: string; checksum: string; adapter_version: string; created_at: string } | null;
      ficheRevision: { revision_number: number } | null;
      acknowledgements: Array<{ id: string; acknowledgement_type: string; received_at: string }>;
    }>;
    projectedRequirements: Array<{ id: string; label: string; status: string }>;
  }>;
};

export type H7ClosureWorkspace = {
  state: 'NO_APLICA' | 'PENDIENTE' | 'EN_PROCESO' | 'LISTO' | 'CUMPLIMIENTO_COMPLETO' | 'VENCIDO' | null;
  state_label: string;
  pending_count: number;
  actionable_missing_count: number;
  operational_status: string;
  providers: string[];
  requirements: Array<{
    id: string; provider: string; key: string; label: string; status: string;
    deadline: string | null; blocks_completion: boolean; missing_action: string | null;
    action_target: Record<string, unknown> | null;
    resolution: null | { type: 'NO_APLICA_BY_AUTHORIZED_EXCEPTION'; label: string; reason: string; authorized_at: string };
  }>;
};

export type H9Finding = {
  check_key: string; category: string; status: 'CORRECT' | 'OBSERVATION' | 'CRITICAL'; message: string;
  source_refs: string[]; affected_block: string; action_target: string; confidence: 'HIGH' | 'MEDIUM' | 'LOW'; provenance: string;
};
export type H9ReviewItem = {
  id: string; created_at: string; executed_by: { id: string; name: string }; freshness: 'ACTUAL' | 'DESACTUALIZADA';
  changes: Array<{ source_ref: string; change: string; detail: string }>;
  correct_count: number; observation_count: number; critical_count: number;
  result: { verification_checks: H9Finding[]; correct_count: number; observations: H9Finding[]; critical_inconsistencies: H9Finding[] };
  provider: string; model: string; prompt_version: string; output_schema_version: string;
  canonical_document: null | { id: string; version: string | null; checksum: string | null; role: string | null };
};
export type H9Workspace = {
  readiness: { status: 'READY' | 'NOT_READY'; causes: string[] };
  latest: H9ReviewItem | null;
  history: H9ReviewItem[];
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
  h9Workspace: async (expedienteId: string, signal?: AbortSignal) =>
    apiRequest<{ success: boolean; data: H9Workspace }>(`/cumplimiento/expedientes/${encodeURIComponent(expedienteId)}/revision-asistida`, { signal }).then((response) => response.data),
  h9Run: async (expedienteId: string, idempotencyKey: string) =>
    apiRequest<{ success: boolean; data: unknown }>(`/cumplimiento/expedientes/${encodeURIComponent(expedienteId)}/revision-asistida`, { method: 'POST', body: JSON.stringify({ idempotency_key: idempotencyKey }) }).then((response) => response.data),
  h8Panel: async (filters: Record<string, string | number | undefined>, signal?: AbortSignal) =>
    apiRequest<{ success: boolean; data: H8Panel }>(`/cumplimiento/panel?${query(filters)}`, { signal }).then((response) => response.data),
  freeScreening: async (body: { identity: Record<string, unknown>; idempotency_key: string }) =>
    apiRequest<{ success: boolean; data: any }>("/cumplimiento/screening/free", { method: "POST", body: JSON.stringify(body) }).then((response) => response.data),
  h7Workspace: async (expedienteId: string, signal?: AbortSignal) =>
    apiRequest<{ success: boolean; data: H7ClosureWorkspace }>(
      `/cumplimiento/expedientes/${encodeURIComponent(expedienteId)}/cierre`, { signal },
    ).then((response) => response.data),
  h7AuthorizeException: async (expedienteId: string, requirementId: string, body: { reason: string; idempotency_key: string }) =>
    apiRequest<{ success: boolean; data: unknown }>(
      `/cumplimiento/expedientes/${encodeURIComponent(expedienteId)}/requisitos/${encodeURIComponent(requirementId)}/excepciones`,
      { method: 'POST', body: JSON.stringify(body) },
    ).then((response) => response.data),
  h6Workspace: async (expedienteId: string, signal?: AbortSignal) =>
    apiRequest<{ success: boolean; data: H6NoticeWorkspace }>(`/cumplimiento/expedientes/${encodeURIComponent(expedienteId)}/avisos`, { signal }).then((response) => response.data),
  h6EnsureFiche: async (obligationId: string) => apiRequest<{ success: boolean; data: any }>(`/cumplimiento/avisos/${encodeURIComponent(obligationId)}/fichas`, { method: "POST", body: "{}" }).then((response) => response.data),
  h6SaveFiche: async (obligationId: string, ficheId: string, body: any) => apiRequest<{ success: boolean; data: any }>(`/cumplimiento/avisos/${encodeURIComponent(obligationId)}/fichas/${encodeURIComponent(ficheId)}`, { method: "PUT", body: JSON.stringify(body) }).then((response) => response.data),
  h6FinalizeFiche: async (obligationId: string, ficheId: string, body: any) => apiRequest<{ success: boolean; data: any }>(`/cumplimiento/avisos/${encodeURIComponent(obligationId)}/fichas/${encodeURIComponent(ficheId)}/validar`, { method: "POST", body: JSON.stringify(body) }).then((response) => response.data),
  h6GenerateProduct: async (obligationId: string, body: any) => apiRequest<{ success: boolean; data: any }>(`/cumplimiento/avisos/${encodeURIComponent(obligationId)}/productos`, { method: "POST", body: JSON.stringify(body) }).then((response) => response.data),
  h6RegisterPresentation: async (obligationId: string, body: any) => apiRequest<{ success: boolean; data: any }>(`/cumplimiento/avisos/${encodeURIComponent(obligationId)}/presentaciones`, { method: "POST", body: JSON.stringify(body) }).then((response) => response.data),
  h6RegisterAcknowledgement: async (presentationId: string, body: any) => apiRequest<{ success: boolean; data: any }>(`/cumplimiento/avisos/presentaciones/${encodeURIComponent(presentationId)}/acuses`, { method: "POST", body: JSON.stringify(body) }).then((response) => response.data),
  h6PrepareAcknowledgementProposal: async (presentationId: string, body: any) => apiRequest<{ success: boolean; data: any }>(`/cumplimiento/avisos/presentaciones/${encodeURIComponent(presentationId)}/acuses/propuestas`, { method: "POST", body: JSON.stringify(body) }).then((response) => response.data),
  h6GeneratePending: async (expedienteId: string) => apiRequest<{ success: boolean; data: any }>(`/cumplimiento/expedientes/${encodeURIComponent(expedienteId)}/generar-formatos-pendientes`, { method: "POST", body: "{}" }).then((response) => response.data),
  h6SignaturePackage: async (expedienteId: string) => {
    const token = tokenStore.get();
    const response = await fetch(apiUrl(`/cumplimiento/expedientes/${encodeURIComponent(expedienteId)}/paquete-firma`), { credentials: "include", headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}) } });
    if (!response.ok) throw new Error("No fue posible preparar el paquete de firma.");
    return { blob: await response.blob(), disposition: response.headers.get("content-disposition") || "" };
  },
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
