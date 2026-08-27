export const EXPEDIENTE_STATUSES = ['ABIERTO', 'EN_INTEGRACION', 'EN_PROCESO', 'PENDIENTE_CLIENTE', 'PENDIENTE_NOTARIA', 'FIRMA_PROGRAMADA', 'FIRMADO', 'POST_FIRMA', 'LISTO_ENTREGA', 'ENTREGADO', 'SUSPENDIDO', 'CANCELADO'] as const;
export type ExpedienteStatus = typeof EXPEDIENTE_STATUSES[number];
export type ExpedienteMacrophase = 'INTEGRACION' | 'PROYECTO' | 'FIRMA' | 'POSTFIRMA' | 'ENTREGADO' | 'OTROS';
export type PersonOption = { id: string; nombre: string; apellido?: string | null; rol?: string };
export type NotaryOption = { id: string; nombre: string; numero_notaria?: string | null; municipio?: string | null; entidad_federativa?: string | null };
export type ActTypeOption = { id: string; nombre: string; descripcion?: string | null; tipoActoCaracteresCompareciente?: Array<{ caracter_id: string; sugerido: boolean; caracter: { id: string; nombre: string } }> };
export type ExpedienteAct = {
  id: string; expediente_id: string; tipo_acto_id: string;
  origen: 'COTIZACION' | 'ADICIONAL' | 'LEGACY_MIGRATION';
  estatus: 'ACTIVO' | 'RETIRADO'; created_at: string;
  removed_at?: string | null; removed_reason?: string | null;
  tipo_acto: { id: string; nombre: string; descripcion?: string | null };
};
export type ExpedienteActOperation = 'ADD' | 'CHANGE' | 'REMOVE';
export type ExpedienteActImpactItem = { key: string; id: string; name: string; source: 'CFG-001' | 'CFG-002' };
export type ExpedienteActPreview = {
  fingerprint: string; classification: 'SAFE' | 'REVIEW_REQUIRED' | 'BLOCKED';
  target_tipo_acto: { id: string; nombre: string } | null;
  impact: { added: ExpedienteActImpactItem[]; removed_or_no_longer_applicable: ExpedienteActImpactItem[]; retained: ExpedienteActImpactItem[]; protected_work: { count: number; requires_human_confirmation: boolean }; sources: { cfg001: true; cfg002: true } };
};
export type ExpedienteActCommand = { operation: ExpedienteActOperation; tipo_acto_id?: string; expediente_acto_id?: string; idempotency_key?: string; preview_fingerprint?: string; confirm_protected_work?: boolean; reason?: string };
export type PartyOption = { id: string; nombre_busqueda: string; tipo_persona: string; personaFisica?: { nombre_completo_calculado?: string; rfc?: string | null; curp?: string | null } | null; personaMoral?: { razon_social?: string; rfc?: string | null } | null };

export type ExpedienteMetric = { key: string; label: string; value: number; percentage: number | null };
export type ExpedienteListItem = {
  id: string; numero_pravia: string; numero_notaria?: string | null; cliente_alias?: string | null; cliente_principal: string;
  comparecientes_adicionales: number; estatus: ExpedienteStatus; macrofase: ExpedienteMacrophase; version: number;
  etapa_actual_nombre?: string | null; proxima_accion?: string | null; fecha_limite_accion?: string | null;
  fecha_estimada_firma?: string | null; updated_at: string; tipo_acto: { id: string; nombre: string };
  abogado?: PersonOption | null; notaria?: NotaryOption | null;
  etapaActual?: { id: string; clave_snapshot: string; nombre_snapshot: string; orden_snapshot: number; fecha_inicio: string } | null;
  riesgo: { label: string; requires_attention: boolean; review_id?: string | null };
};
export type ExpedienteListResult = {
  data: ExpedienteListItem[]; metrics: ExpedienteMetric[];
  meta: { total: number; page: number; pageSize: number; limit: number; totalPages: number; hasPreviousPage: boolean; hasNextPage: boolean };
  facets: { actTypes: ActTypeOption[]; responsibles: PersonOption[]; notaries: NotaryOption[]; stages: string[] };
};
export type ExpedienteListFilters = { search?: string; macrophase?: string; stage?: string; responsible?: string; notary?: string; risk?: string; dateFrom?: string; dateTo?: string; actType?: string; client?: string; status?: string; page?: number; pageSize?: number; sort?: string };

export type EligibleQuoteCandidate = {
  id: string;
  numero_solicitud?: string | null;
  numero_cotizacion?: string | null;
  total_cliente?: number | string | null;
  updated_at: string;
  prospecto: { id: string; nombre: string; tipo_acto?: string | null; email?: string | null; telefono?: string | null };
  notaria?: { id: string; nombre: string; numero_notaria?: string | null; municipio?: string | null } | null;
  creada_por: { id: string; nombre: string; apellido?: string | null };
  conversion: { eligible: true; validatedAdvanceTotal: number };
};

export type ReadinessIndicator = { key: string; label: string; state: 'COMPLETO' | 'PENDIENTE' | 'NO_APLICA' | 'NO_CONFIGURADO'; detail: string };
export type ExpedienteTransition = { status: ExpedienteStatus; label: string; stage?: { clave: string; nombre: string; orden: number } | null; requires_signature_data: boolean; requires_effective_date: boolean; requires_notes: boolean };
export type ExpedienteDetail = ExpedienteListItem & {
  descripcion?: string | null; created_at: string; fecha_apertura: string; fecha_real_firma?: string | null; fecha_entrega_cliente?: string | null;
  datos_operacion?: Record<string, unknown> | null;
  abogado: PersonOption; gestor?: PersonOption | null; creador?: PersonOption; notaria?: NotaryOption | null;
  flujoVersion?: { id: string; version: number } | null;
  comparecientes: Array<any>; expedienteRepresentaciones?: Array<any>; actos?: ExpedienteAct[];
  requisitos_docs: Array<any>; expedienteDocumentos?: Array<any>; documentos_autorizados?: Array<any>;
  etapas?: Array<any>; tareas?: Array<any>; tareas_externas?: Array<any>; tareas_postfirma?: Array<any>; entrega?: any;
  movimientosFinancieros?: Array<any>; honorariosGenerados?: Array<any>; financialSummary?: { ingresos_recibidos:number;honorarios_generados:number;honorarios_cobrados:number;honorarios_por_cobrar:number;fondos_terceros:number;otros_destinos:number;fondos_terceros_pendientes:number;egresos:number } | null; actividades?: Array<any>; complianceReviews?: Array<any>;
  workflow: { current_status_label: string; transitions: ExpedienteTransition[]; next_stage?: any; stages?: Array<any> };
  progress: { documental: number; operativo: number; financiero?: number; general: number; configuration?: Record<string, string> };
  readiness: { indicators: ReadinessIndicator[]; blockers: Array<{ type: string; label: string }>; complete: number };
  capabilities: { canWrite: boolean; canDeliver: boolean; canManagePostfirma: boolean; canReadProject: boolean; canReadFinance: boolean; canWriteFinance: boolean; canUploadDocuments: boolean; canReadDocuments: boolean; canDeleteDocuments: boolean };
};
export type ProjectVersion = { id: string; version_numero: number; nombre_original?: string; nota_version?: string; es_vigente: boolean; es_version_final?: boolean; subido_por_nombre?: string; created_at: string };
export type ProjectState = { vigente: ProjectVersion | null; historial: ProjectVersion[]; ultimoReporte?: unknown };
