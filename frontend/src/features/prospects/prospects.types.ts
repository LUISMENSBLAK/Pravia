export const PROSPECT_SUBSTATUSES = [
  'NUEVO', 'INFO_PENDIENTE', 'DOCS_RECIBIDOS', 'EN_REVISION',
  'COTIZACION_SOLICITADA', 'COTIZACION_ENVIADA', 'SEGUIMIENTO',
  'ACEPTADO', 'PERDIDO', 'CANCELADO', 'ARCHIVADO',
] as const;

export type ProspectSubstatus = typeof PROSPECT_SUBSTATUSES[number];
export type ProspectPriority = 'BAJA' | 'MEDIA' | 'ALTA';
export type ProspectPipelineStage = 'new' | 'progress' | 'quote' | 'converted';

export type ProspectCatalogStage = { code: string; label: string; order: number; active: boolean };
export type ProspectCatalogService = {
  code: string;
  label: string;
  order: number;
  active: boolean;
  states: string[];
  personTypes: string[];
};
export type ProspectCatalogs = { stages: ProspectCatalogStage[]; services: ProspectCatalogService[] };

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
  mime_type?: string | null;
  size_bytes?: number | null;
  fecha_carga?: string | null;
};

export type Prospect = {
  folio?: string | null;
  etapa_contractual?: string | null;
  version_operativa?: number;
  notaria_id?: string | null;
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
  etapa_operativa_codigo?: string | null;
  servicio_catalogo_codigo?: string | null;
  etapa_operativa?: ProspectCatalogStage | null;
  servicio_catalogo?: ProspectCatalogService | null;
  prioridad: ProspectPriority;
  /** El nombre `estado` se conserva por compatibilidad con la API/DB; representa el subestado detallado. */
  estado: ProspectSubstatus;
  user_id?: string;
  created_at: string;
  updated_at: string;
  atendido_por?: { id?: string; nombre?: string | null } | null;
  documentos?: Array<{ id: string }>;
  cotizacion?: { id: string; estado?: string | null } | null;
  seguimientos?: ProspectFollowUp[];
};

export type ProspectListFilters = {
  search?: string;
  priority?: ProspectPriority | '';
  substatuses?: ProspectSubstatus[];
  pipelineStage?: ProspectPipelineStage;
  serviceCode?: string;
  operationalStageCode?: string;
  page?: number;
  pageSize?: number;
  includeSummary?: boolean;
};

export type ProspectListMeta = {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  hasNextPage: boolean;
  hasPreviousPage: boolean;
  countsByState: Partial<Record<ProspectSubstatus, number>>;
  metrics: { withQuote: number; accepted: number; active: number };
};

export type ProspectListResult = {
  data: Prospect[];
  meta: ProspectListMeta;
  facets: { services: string[]; sources: string[] };
};

export type ProspectMutationInput = {
  nombre: string;
  telefono?: string;
  email?: string;
  servicio_catalogo_codigo?: string;
  etapa_operativa_codigo?: string;
  prioridad: ProspectPriority;
  necesidad?: string;
  tiene_predial: boolean;
  tiene_antecedente: boolean;
};

export type NewProspectInput = ProspectMutationInput;
export type UpdateProspectInput = Partial<ProspectMutationInput> & { expectedVersion?: number; notaria_id?: string; responsable_id?: string };

export type ProspectWorkflowAction = 'RECABAR' | 'MARCAR_LISTO' | 'REGISTRAR_ENVIO' | 'REGISTRAR_RECEPCION' | 'SUSTITUIR_FUENTE' | 'CONVERTIR';
export type ProspectSource = {
  id: string; version: number; received_at: string; recorded_at: string; motivo: string;
  documento: ProspectDocument; notaria: { id: string; nombre: string };
};
export type ProspectWorkflow = {
  stage: string | null; stageLabel: string; stageEnteredAt: string | null; folio: string | null;
  knowledge: 'KNOWN' | 'UNKNOWN_LEGACY'; version: number;
  wait: { type: string | null; knowledge: 'KNOWN' | 'UNKNOWN_LEGACY' | 'NOT_APPLICABLE'; label: string };
  stages: Array<{ code: string; label: string }>;
  actions: Array<{ code: ProspectWorkflowAction; label: string }>;
  notaria: { id: string; nombre: string; correo_general?: string | null } | null;
  notaries: Array<{ id: string; nombre: string }>;
  responsibles: Array<{ id: string; nombre: string; apellido?: string | null }>;
  source: ProspectSource | null; sourceHistory: ProspectSource[]; canReadSource: boolean;
  quote: { id: string; estado: string; numero_cotizacion?: string | null } | null;
  events: Array<{ id: string; previousLabel: string; nextLabel: string; viaLabel: string | null;
    effectiveAt: string; recordedAt: string; actor: string; actionLabel: string; provenanceLabel: string }>;
};
export type PreparedProspectRequest = { preparedOnly: true; deliveryConfirmedByProvider: false; version: number; attachmentIds: string[]; recipient: string; subject: string; content: string };

export type FollowUpInput = {
  tipo: string;
  contenido: string;
  proxima_accion?: string;
  fecha_proximo_seguimiento?: string;
};

export const PIPELINE_STAGES: Array<{ id: ProspectPipelineStage; label: string; substatuses: ProspectSubstatus[] }> = [
  { id: 'new', label: 'Nuevo', substatuses: ['NUEVO', 'INFO_PENDIENTE'] },
  { id: 'progress', label: 'En proceso', substatuses: ['DOCS_RECIBIDOS', 'EN_REVISION', 'SEGUIMIENTO'] },
  { id: 'quote', label: 'Cotización', substatuses: ['COTIZACION_SOLICITADA', 'COTIZACION_ENVIADA'] },
  { id: 'converted', label: 'Convertido', substatuses: ['ACEPTADO', 'PERDIDO', 'CANCELADO'] },
];

export const SUBSTATUS_LABELS: Record<ProspectSubstatus, string> = {
  NUEVO: 'Nuevo', INFO_PENDIENTE: 'Información pendiente', DOCS_RECIBIDOS: 'Documentos recibidos',
  EN_REVISION: 'En revisión', COTIZACION_SOLICITADA: 'Cotización solicitada',
  COTIZACION_ENVIADA: 'Cotización enviada', SEGUIMIENTO: 'Seguimiento', ACEPTADO: 'Convertido',
  PERDIDO: 'Perdido', CANCELADO: 'Cancelado', ARCHIVADO: 'Archivado',
};

export const pipelineStageForSubstatus = (substatus: ProspectSubstatus): ProspectPipelineStage =>
  PIPELINE_STAGES.find((stage) => stage.substatuses.includes(substatus))?.id ?? 'converted';

export const pipelineStageForProspect = (prospect: Pick<Prospect, 'etapa_contractual' | 'estado'>): ProspectPipelineStage => {
  if (!prospect.etapa_contractual) return pipelineStageForSubstatus(prospect.estado);
  if (prospect.etapa_contractual === 'NUEVO') return 'new';
  if (prospect.etapa_contractual === 'COTIZACION_RECIBIDA') return 'quote';
  if (prospect.etapa_contractual === 'CONVERTIDO_COTIZACION') return 'converted';
  return 'progress';
};

export const isConvertedProspect = (prospect: Pick<Prospect, 'etapa_contractual' | 'estado'>) => prospect.etapa_contractual
  ? prospect.etapa_contractual === 'CONVERTIDO_COTIZACION'
  : prospect.estado === 'ACEPTADO';

export const isActiveProspect = (prospect: Pick<Prospect, 'etapa_contractual' | 'estado'>) => prospect.etapa_contractual
  ? prospect.etapa_contractual !== 'CONVERTIDO_COTIZACION'
  : !['ACEPTADO', 'PERDIDO', 'CANCELADO', 'ARCHIVADO'].includes(prospect.estado);

export const displayProspectName = (value: string) => value.trim().replace(/\s+/gu, ' ').toLocaleUpperCase('es-MX');
export const uppercaseProspectNameInput = (value: string) => value.toLocaleUpperCase('es-MX');
