export type DayType = 'HABILES' | 'NATURALES';
export type OwnerType = 'NOTARIA' | 'INSTITUCION';
export type ArtifactType = 'PLANTILLA' | 'FORMATO';

export type ActDependency = { id: string; depende_actividad_id: string; bloqueante: boolean };
export type ActException = {
  id: string; selector_tipo: 'INSTITUCION' | 'NOTARIA' | 'JURISDICCION'; institucion_id?: string | null; notaria_id?: string | null;
  jurisdiccion?: string | null; duracion: number; tipo_dias: DayType; margen_seguridad: number; activa: boolean;
  dependencias_adicionales: Array<{ depende_actividad_id: string }>;
};
export type ActActivity = {
  id: string; etapa_id: string; nombre: string; descripcion?: string | null; duracion_estimada: number; tipo_dias: DayType;
  margen_seguridad: number; responsable_rol?: string | null; responsable_usuario_id?: string | null; aplica_por_defecto: boolean; activa: boolean;
  dependencias: ActDependency[]; excepciones: ActException[];
  concepto_maestro_id?: string | null; naturaleza?: 'INTERNA' | 'INGRESO_A_EXTERNO' | 'ESPERA_EXTERNA' | 'CLIENTE_HITO' | 'REQUISITO_PREVIO_A_HITO';
  unidad_tiempo?: 'DIAS' | 'HORAS'; fuente_tiempo?: 'GENERAL' | 'OVERRIDE_ACTO' | 'INSTITUCION' | 'REGLA_JURIDICA';
  alcance_instancia?: 'EXPEDIENTE' | 'ACTO' | 'INMUEBLE'; atributos_heredados?: string[] | null; grupo_paralelo?: string | null; orden_operativo?: number; condicion_json?: unknown;
  inheritance?: Record<string, 'HEREDADO' | 'OVERRIDE'>; heredada_del_acto?: boolean; concepto_maestro?: ActivityConcept | null;
  etapa?: { id: string; nombre: string; orden: number }; source_configuration_id?: string;
};
export type ActStage = { id: string; nombre: string; orden: number; activa: boolean; inherited?: boolean; actividades: ActActivity[] };
export type ActConfiguration = { id: string; activa: boolean; requiere_revision: boolean; revision: number; familia?: string | null; hereda_configuracion_id?: string | null; exclusiones_conceptos?: string[] | null; created_at: string; updated_at: string; etapas: ActStage[] };
export type CatalogAct = { id: string; organization_id?: string | null; codigo_catalogo?: string | null; nombre: string; descripcion?: string | null; activo: boolean; complete: boolean; edited?: boolean; configuration?: ActConfiguration | null; effective_activities?: ActActivity[]; effective_stages?: ActStage[]; inheritance_chain?: string[] };
export type ActListPayload = { data: CatalogAct[]; metrics: { total: number; complete: number; edited: number; pending: number } };

export type ActivityConcept = { id: string; codigo: string; nombre: string; descripcion?: string | null; naturaleza: ActActivity['naturaleza']; duracion_estimada: number; unidad_tiempo: 'DIAS' | 'HORAS'; tipo_dias: DayType; margen_seguridad: number; fuente_tiempo: ActActivity['fuente_tiempo']; aplica_por_defecto: boolean; activa: boolean; revision: number; requiere_revision: boolean };

export type CatalogOwner = { id: string; nombre: string; numero_notaria?: string | null; tipo?: 'BANCO' | 'FIDUCIARIA' | 'OTRA'; activa: boolean };
export type CatalogFolder = { id: string; tipo: ArtifactType; nombre: string; parent_id?: string | null; created_at: string };
export type ArtifactVersion = { id: string; version: number; nombre_original: string; mime_type: string; size_bytes: number; checksum_sha256?: string; version_biblioteca?: string | null; created_at: string };
export type ArtifactRule = {
  id?: string; tipo_persona?: 'FISICA' | 'MORAL' | null; caracter_compareciente_id?: string | null; etapa_requerida_id?: string | null;
  momento_limite_etapa_id?: string | null; obligatoria: boolean; multiplicidad: 'EXPEDIENTE' | 'COMPARECIENTE' | 'INMUEBLE' | 'CANTIDAD_FIJA'; cantidad_fija?: number | null;
  activa?: boolean; codigo_regla?: string | null; revision?: number;
};
export type CatalogArtifact = {
  id: string; tipo: ArtifactType; propietario_tipo: OwnerType; nombre: string; descripcion?: string | null; activo: boolean;
  codigo_biblioteca?: string | null; ruta_biblioteca?: string | null; revision?: number;
  versiones: ArtifactVersion[]; actos: Array<{ tipo_acto_id: string }>; reglas: ArtifactRule[];
  revisionesNormativas?: Array<{ id: string; revision: number; fundamento_normativo: string; version_normativa: string; vigencia_desde: string | null }>;
};
export type ExplorerPayload = { owner_type: OwnerType; owner_id: string; type: ArtifactType; folder?: CatalogFolder | null; breadcrumbs: Array<{ id: string; name: string }>; folders: CatalogFolder[]; artifacts: CatalogArtifact[]; allows_templates: boolean };
export type SupportingCatalogs = {
  acts: Array<{ id: string; nombre: string; codigo_catalogo?: string | null }>;
  notaria: { id: string; nombre: string; numero_notaria?: string | null } | null;
  /** Shared CFG-001 timing selectors. CFG-002 never renders this legacy collection. */
  notarias: Array<{ id: string; nombre: string; numero_notaria?: string | null }>;
  institutions: Array<{ id: string; nombre: string; tipo: string; tipos_respuesta?: Array<{ id: string; codigo: string; nombre: string; duracion: number; tipo_dias: DayType; margen_seguridad: number; activa: boolean; revision: number }> }>;
  stages: Array<{ id: string; nombre: string; configuracion: { tipo_acto_id: string } }>;
  users: Array<{ id: string; nombre: string; apellido: string }>;
  roles: string[];
  characters: Array<{ id: string; nombre: string }>;
};

export type CatalogImportPreview = {
  total_files: number; total_bytes: number; requires_confirmation: true; persisted: false;
  folders?: string[];
  files: Array<{ path: string; name: string; extension: string; mimeType: string; checksum: string; size: number; folders: string[] }>;
};
