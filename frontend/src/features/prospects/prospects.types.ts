export const PROSPECT_STATES = [
  'NUEVO', 'INFO_PENDIENTE', 'DOCS_RECIBIDOS', 'EN_REVISION',
  'COTIZACION_SOLICITADA', 'COTIZACION_ENVIADA', 'SEGUIMIENTO',
  'ACEPTADO', 'PERDIDO', 'CANCELADO', 'ARCHIVADO',
] as const;

export type ProspectState = typeof PROSPECT_STATES[number];
export type ProspectPriority = 'BAJA' | 'MEDIA' | 'ALTA';
export type ProspectStage = 'new' | 'follow-up' | 'quote' | 'closed';

export type ProspectFollowUp = {
  id: string;
  tipo: string;
  contenido: string;
  proxima_accion?: string | null;
  fecha_proximo_seguimiento?: string | null;
  created_at: string;
  usuario?: { nombre?: string | null } | null;
};

export type ProspectDocument = {
  id: string;
  nombre_original: string;
  tipo?: string | null;
  fecha_carga?: string | null;
};

export type Prospect = {
  id: string;
  nombre: string;
  telefono?: string | null;
  email?: string | null;
  tipo_acto?: string | null;
  necesidad?: string | null;
  documentos_disponibles?: string | null;
  tiene_antecedente?: boolean | null;
  tiene_predial?: boolean | null;
  puede_compartir_docs?: boolean | null;
  tiempo_estimado?: string | null;
  ciudad?: string | null;
  fuente?: string | null;
  prioridad: ProspectPriority;
  estado: ProspectState;
  user_id?: string;
  created_at: string;
  updated_at: string;
  atendido_por?: { id?: string; nombre?: string | null } | null;
  documentos?: Array<{ id: string }>;
  cotizacion?: { id: string; estado?: string | null } | null;
  seguimientos?: ProspectFollowUp[];
};

export type ProspectListFilters = { search?: string; priority?: ProspectPriority | ''; states?: ProspectState[]; service?: string; source?: string; page?: number; pageSize?: number };

export type ProspectListMeta = {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  hasNextPage: boolean;
  hasPreviousPage: boolean;
  countsByState: Partial<Record<ProspectState, number>>;
  metrics: { withQuote: number; accepted: number; active: number };
};

export type ProspectListResult = {
  data: Prospect[];
  meta: ProspectListMeta;
  facets: { services: string[]; sources: string[] };
};

export type NewProspectInput = {
  nombre: string;
  telefono?: string;
  email?: string;
  tipo_acto?: string;
  ciudad?: string;
  fuente?: string;
  prioridad: ProspectPriority;
  necesidad?: string;
  tiempo_estimado?: string;
};

export type FollowUpInput = {
  tipo: string;
  contenido: string;
  proxima_accion?: string;
  fecha_proximo_seguimiento?: string;
};

export const STAGES: Array<{ id: ProspectStage; label: string; states: ProspectState[] }> = [
  { id: 'new', label: 'Nuevo', states: ['NUEVO', 'INFO_PENDIENTE'] },
  { id: 'follow-up', label: 'Seguimiento', states: ['DOCS_RECIBIDOS', 'EN_REVISION', 'SEGUIMIENTO'] },
  { id: 'quote', label: 'Cotización', states: ['COTIZACION_SOLICITADA', 'COTIZACION_ENVIADA'] },
  { id: 'closed', label: 'Cierre', states: ['ACEPTADO', 'PERDIDO', 'CANCELADO'] },
];

export const STATE_LABELS: Record<ProspectState, string> = {
  NUEVO: 'Nuevo', INFO_PENDIENTE: 'Información pendiente', DOCS_RECIBIDOS: 'Documentos recibidos',
  EN_REVISION: 'En revisión', COTIZACION_SOLICITADA: 'Cotización solicitada',
  COTIZACION_ENVIADA: 'Cotización enviada', SEGUIMIENTO: 'Seguimiento', ACEPTADO: 'Aceptado',
  PERDIDO: 'Perdido', CANCELADO: 'Cancelado', ARCHIVADO: 'Archivado',
};

export const stageForState = (state: ProspectState): ProspectStage =>
  STAGES.find((stage) => stage.states.includes(state))?.id ?? 'closed';
