export type IdentityState = 'VERIFICADA' | 'PENDIENTE' | 'OBSERVACION';
export type HealthState = 'COMPLETO' | 'PENDIENTE' | 'OBSERVACION' | 'NO_APLICA' | 'NO_CONFIGURADO';
export type PersonType = 'FISICA' | 'MORAL';

export type ComparecienteListItem = {
  id: string;
  tipo_persona: PersonType;
  nombre: string;
  rfc: string | null;
  curp: string | null;
  expedientes_vinculados: number;
  documentos: { total: number };
  updated_at: string;
};

export type ComparecienteListResult = {
  data: ComparecienteListItem[];
  metrics: { total: number; physical: number; legal: number };
  meta: { total: number; page: number; limit: number; pageSize: number; totalPages: number; hasPreviousPage: boolean; hasNextPage: boolean };
  definitions: Record<string, string>;
};

export type ComparecienteFilters = {
  search?: string; type?: string; updated?: string; sort?: string; page?: number; pageSize?: number;
};

export type DuplicateCandidate = {
  id: string; tipo_persona: PersonType; nombre: string; rfc: string | null; curp: string | null; razones: string[]; bloqueo_alta: boolean; updated_at: string;
};

export type HealthDimension = { key: string; label: string; state: HealthState };

export type ComparecienteDetail = ComparecienteListItem & {
  nombre_busqueda: string; estatus: string; created_at: string; updated_at_material: string;
  personaFisica?: Record<string, any> | null; personaMoral?: Record<string, any> | null;
  creado_por?: { id: string; nombre: string; apellido?: string | null };
  domicilios: Array<Record<string, any>>; contactos: Array<Record<string, any>>; identificaciones: Array<Record<string, any>>;
  documentos: Array<Record<string, any>>; expedientes: Array<Record<string, any>>; datosFuente: Array<Record<string, any>>;
  representacionesComoRepresentante: Array<Record<string, any>>; representacionesComoRepresentado: Array<Record<string, any>>;
  complianceSnapshots: Array<Record<string, any>>; actividad: Array<Record<string, any>>; health: HealthDimension[];
  observaciones?: string | null;
  capabilities: { canEdit?: boolean; canUploadDocuments: boolean; canReadDocuments?: boolean; canDeleteDocuments?: boolean; canExtractWithAI?: boolean; canArchive: boolean; allowsSoftDuplicateOverride: boolean; blocksExactIdentityDuplicate: boolean };
};

export type NewComparecienteDraft = Record<string, string> & { tipo_persona: PersonType };

export type ScreeningResolutionDecision = 'NO_CORRESPONDE' | 'REVISION_ADICIONAL' | 'COINCIDENCIA_CONFIRMADA';
export type ScreeningCandidate = {
  id: string; source_record_ref: string; display_name: string; score: string | number | null;
  match_fields: string[]; latest_resolution: { id: string; decision: ScreeningResolutionDecision; rationale: string; created_at: string } | null;
};
export type ScreeningQuery = {
  id: string; query_kind: 'MASTER' | 'FREE'; execution_state: 'NOT_EXECUTED' | 'QUEUED' | 'RUNNING' | 'NOT_CONFIGURED' | 'SUCCEEDED' | 'PARTIAL' | 'ERROR';
  trigger_reason: string; created_at: string; completed_at: string | null; human_status: string;
  candidates: ScreeningCandidate[]; sourceExecutions: Array<{ id: string; execution_state: string; source: { display_name: string }; sourceVersion?: { version: number } | null }>;
  reports: Array<{ id: string; documento_id: string; created_at: string }>;
};
export type ScreeningHistory = { current: ScreeningQuery | null; history: ScreeningQuery[] };
