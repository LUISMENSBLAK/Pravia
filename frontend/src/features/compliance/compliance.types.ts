export type ComplianceStatus = 'BORRADOR' | 'PENDIENTE_REVISION' | 'REQUIERE_AJUSTES' | 'CONFIRMADO' | 'EVALUACION_DETERMINISTA';
export type ComplianceType = 'UIF' | 'ISR' | 'LEGAL_H1';
export type ComplianceAlert = { codigo: string; mensaje: string; regla: string; dato: string; fuente: string; accion: string };
export type ComplianceReview = {
  id: string; tipo: ComplianceType; estatus: ComplianceStatus; fecha_operacion?: string; created_at: string; updated_at: string;
  rule_version_snapshot: string; rule_snapshot: any; master_snapshot: any; snapshot_captured_at: string; master_data_changed?: boolean;
  is_canonical_legal_engine?: boolean; legal_date_source?: string | null; engine_version?: string | null; canonical_state_snapshot?: any;
  cuestionario_json: Record<string, any>; resultado_json?: { clasificacion: string; disclaimer?: string; alertas?: ComplianceAlert[]; faltantes?: string[]; [key: string]: any };
  explicacion?: string; revisado_at?: string; expediente: any; ruleSet: any | null; creado_por: any; revisado_por?: any; evidencias: any[]; decisiones: any[]; supersedes?: any;
};
export type ComplianceList = { revisiones: ComplianceReview[]; meta: { page: number; pageSize: number; total: number; totalPages: number }; metrics: { expedientes_evaluados: number; requieren_revision: number; avisos_por_presentar: number; obligaciones_vencidas: number } };
export type ComplianceCatalogs = { reglas: any[]; expedientes: any[]; usuarios: any[]; documentos: any[] };
export type ComplianceWorkspace = { parties: any[]; beneficialOwners: any[]; pepReviews: any[]; screenings: any[]; payments: any[]; obligations: any[]; events: any[]; aiProposals: any[]; sensitiveRedacted: boolean; state?: any; ruleResults?: any[]; requirements?: any[]; alerts?: any[] };
export type ComplianceDetail = { revision: ComplianceReview; historial: ComplianceReview[]; workspace?: ComplianceWorkspace };

export type ComplianceDocumentEvidence = {
  id: string;
  source: 'COMPARECIENTE' | 'EXPEDIENTE' | 'FORMAT_GENERATED' | 'MANUAL_SIGNED_UPLOAD' | 'FUTURE_MODULE';
  document_state: 'CANONICAL' | 'GENERATED' | 'SIGNED_UPLOADED';
  validation_status: 'AUTO_LINKED' | 'PENDING_HUMAN' | 'VALIDATED' | 'REJECTED';
  document_version: string;
  linked_at: string;
  validated_at?: string | null;
  document: { id: string; nombre_original: string; mime_type: string; size_bytes: number };
};

export type ComplianceDocumentRequirement = {
  id: string;
  label: string;
  status: string;
  category: string;
  expected_document_type?: string | null;
  target_compareciente_id?: string | null;
  target_name?: string | null;
  requires_signed_document: boolean;
  requires_human_validation: boolean;
  missing_action: 'GO_TO_COMPARECIENTE' | 'GO_TO_QUESTIONNAIRE' | 'GO_TO_BENEFICIAL_OWNER' | 'UPLOAD_SIGNED' | 'UPLOAD_DOCUMENT' | 'GO_TO_PAYMENT_EVIDENCE' | 'GO_TO_NOTICE';
  action_target?: Record<string, unknown> | null;
  missing_reason?: string | null;
  evidence: ComplianceDocumentEvidence[];
};

export type ComplianceDocumentStructure = {
  vulnerable: boolean;
  automatic_structure: boolean;
  state: { state: string; pending_count: number } | null;
  groups: Array<{ category: string; label: string; requirements: ComplianceDocumentRequirement[] }>;
  requirements?: ComplianceDocumentRequirement[];
  missing: ComplianceDocumentRequirement[];
};
