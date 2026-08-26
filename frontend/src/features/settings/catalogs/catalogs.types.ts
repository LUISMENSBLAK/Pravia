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
};
export type ActStage = { id: string; nombre: string; orden: number; activa: boolean; actividades: ActActivity[] };
export type ActConfiguration = { id: string; activa: boolean; requiere_revision: boolean; revision: number; created_at: string; updated_at: string; etapas: ActStage[] };
export type CatalogAct = { id: string; organization_id?: string | null; codigo_catalogo?: string | null; nombre: string; descripcion?: string | null; activo: boolean; complete: boolean; edited?: boolean; configuration?: ActConfiguration | null };
export type ActListPayload = { data: CatalogAct[]; metrics: { total: number; complete: number; edited: number; pending: number } };

export type CatalogOwner = { id: string; nombre: string; numero_notaria?: string | null; tipo?: 'BANCO' | 'FIDUCIARIA' | 'OTRA'; activa: boolean };
export type CatalogFolder = { id: string; tipo: ArtifactType; nombre: string; parent_id?: string | null; created_at: string };
export type ArtifactVersion = { id: string; version: number; nombre_original: string; mime_type: string; size_bytes: number; created_at: string };
export type ArtifactRule = {
  id?: string; tipo_persona?: 'FISICA' | 'MORAL' | null; caracter_compareciente_id?: string | null; etapa_requerida_id?: string | null;
  momento_limite_etapa_id?: string | null; obligatoria: boolean; multiplicidad: 'EXPEDIENTE' | 'COMPARECIENTE' | 'INMUEBLE' | 'CANTIDAD_FIJA'; cantidad_fija?: number | null;
};
export type CatalogArtifact = {
  id: string; tipo: ArtifactType; propietario_tipo: OwnerType; nombre: string; descripcion?: string | null; activo: boolean;
  versiones: ArtifactVersion[]; actos: Array<{ tipo_acto_id: string }>; reglas: ArtifactRule[];
};
export type ExplorerPayload = { owner_type: OwnerType; owner_id: string; type: ArtifactType; folder?: CatalogFolder | null; breadcrumbs: Array<{ id: string; name: string }>; folders: CatalogFolder[]; artifacts: CatalogArtifact[]; allows_templates: boolean };
export type SupportingCatalogs = {
  acts: Array<{ id: string; nombre: string; codigo_catalogo?: string | null }>;
  notarias: Array<{ id: string; nombre: string; numero_notaria?: string | null }>;
  institutions: Array<{ id: string; nombre: string; tipo: string }>;
  stages: Array<{ id: string; nombre: string; configuracion: { tipo_acto_id: string } }>;
  users: Array<{ id: string; nombre: string; apellido: string }>;
  roles: string[];
  characters: Array<{ id: string; nombre: string }>;
};
