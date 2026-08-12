export const QUOTE_STATES = ['BORRADOR', 'ENVIADA_NOTARIA', 'PRESUPUESTO_RECIBIDO', 'EN_REVISION_ABOGADO', 'ENVIADA_CLIENTE', 'EN_NEGOCIACION', 'ACEPTADA', 'RECHAZADA', 'VENCIDA', 'CONVERTIDA_EXPEDIENTE'] as const;
export type QuoteState = typeof QUOTE_STATES[number];

export type QuoteConceptCategory = 'HONORARIOS' | 'DERECHOS' | 'IMPUESTOS' | 'GASTOS' | 'OTROS';
export type QuoteConcept = { categoria: QuoteConceptCategory; concepto: string; monto: number };

export type QuoteVersion = {
  id: string;
  version: number;
  desglose_notaria?: unknown;
  desglose_pravia?: unknown;
  total_notaria: number | string;
  honorarios_pravia: number | string;
  total_cliente: number | string;
  notas?: string | null;
  pdf_url?: string | null;
  aprobada: boolean;
  created_at: string;
};

export type QuoteFollowUp = {
  id: string;
  tipo: string;
  destinatario: string;
  resumen: string;
  resultado?: string | null;
  proxima_accion?: string | null;
  responsable?: string | null;
  fecha_proximo_seguimiento?: string | null;
  created_at: string;
  usuario?: { nombre?: string | null; apellido?: string | null } | null;
};

export type QuoteDocument = {
  id: string;
  nombre_original: string;
  mime_type?: string | null;
  tipo?: string | null;
  fecha_carga?: string | null;
  origen_etiqueta?: string;
};

export type ConversionEligibility = {
  eligible: boolean;
  accepted: boolean;
  approvedVersion: boolean;
  validatedAdvance: boolean;
  validatedAdvanceTotal: number;
  notConverted: boolean;
  linkedProspect: boolean;
  failures: string[];
};

export type Quote = {
  id: string;
  numero_solicitud?: string | null;
  numero_cotizacion?: string | null;
  version_actual: number;
  prospecto_id?: string | null;
  user_id: string;
  notaria_id?: string | null;
  estado: QuoteState;
  fecha_solicitud_notaria?: string | null;
  fecha_limite_respuesta_notaria?: string | null;
  fecha_presupuesto_recibido?: string | null;
  fecha_enviada_cliente?: string | null;
  fecha_aceptacion_cliente?: string | null;
  fecha_aprobacion_version?: string | null;
  fecha_conversion_expediente?: string | null;
  total_notaria?: number | string | null;
  honorarios_pravia?: number | string | null;
  total_cliente?: number | string | null;
  cuerpo_correo_notaria?: string | null;
  cuerpo_correo_cliente?: string | null;
  created_at: string;
  updated_at: string;
  prospecto?: { id?: string; nombre: string; tipo_acto?: string | null; email?: string | null; telefono?: string | null } | null;
  notaria?: { id?: string; nombre: string; correo_general?: string | null; correo_proyectos?: string | null } | null;
  creada_por?: { id?: string; nombre: string; apellido?: string | null } | null;
  versiones: QuoteVersion[];
  seguimientos?: QuoteFollowUp[];
  documentos?: QuoteDocument[];
  pagos?: Array<{ id: string; monto: number | string; estatus: string; categoria_ingreso: string }>;
  expediente?: { id: string; numero_pravia?: string | null } | null;
  transiciones_permitidas?: QuoteState[];
  conversion?: ConversionEligibility;
};

export type QuoteMetrics = { sent: number; accepted: number; totalAmount: number; conversionRate: number | null };
export type QuoteListMeta = {
  page: number; pageSize: number; total: number; totalPages: number; hasNextPage: boolean; hasPreviousPage: boolean;
  countsByState: Partial<Record<QuoteState, number>>;
  metrics: QuoteMetrics;
};
export type QuoteAnalyticsMonth = { key: string; label: string; sentAmount: number; acceptedAmount: number; sentCount: number; acceptedCount: number; rate: number };
export type QuoteListResult = {
  data: Quote[];
  meta: QuoteListMeta;
  facets: { acts: string[]; responsibles: Array<{ id: string; name: string }> };
  analytics: QuoteAnalyticsMonth[];
};
export type QuoteListFilters = { search?: string; state?: QuoteState | ''; act?: string; responsible?: string; dateFrom?: string; dateTo?: string; period?: '6m' | 'year'; page?: number; pageSize?: number };

export type ProspectCandidate = { id: string; nombre: string; tipo_acto?: string | null; email?: string | null; telefono?: string | null; cotizacion?: { id: string } | null };
export type NotaryOption = { id: string; nombre: string; numero_notaria?: string | null; entidad_federativa?: string | null; municipio?: string | null; correo_general?: string | null; correo_proyectos?: string | null; activa: boolean };

export type CreateQuoteVersionInput = {
  desglose_notaria: { rubros: QuoteConcept[] };
  desglose_pravia: { participacion_pravia: number };
  total_notaria: number;
  honorarios_pravia: number;
  notas?: string;
  aprobada?: boolean;
};
