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
export type ExpedientePartySearchOption = { id: string; nombre: string; tipo_persona: 'FISICA' | 'MORAL'; identificador: string };
export type ExpedientePartyRepresentation = { id?: string; representado_compareciente_id: string; cargo_o_caracter_descripcion: string; caracter_representacion_id?: string | null; facultades_aplicables?: string | null; representado?: { nombre_busqueda?: string; personaFisica?: { nombre_completo_calculado?: string } | null; personaMoral?: { razon_social?: string } | null }; caracterRepresentacion?: { id: string; clave: string; nombre: string } | null };
export type ExpedientePartyRelation = {
  id: string; expediente_id: string; expediente_acto_id?: string | null; compareciente_id: string; caracter_id: string;
  forma_comparecencia: 'PROPIO_DERECHO' | 'EN_REPRESENTACION_PERSONA_MORAL' | 'EN_REPRESENTACION_PERSONA_FISICA' | 'POR_PROPIO_DERECHO_Y_REPRESENTACION' | 'CARACTER_INSTITUCIONAL' | 'OTRO';
  participacion_porcentaje?: number | string | null; datos_validados: boolean; estatus: string;
  expedienteActo?: ExpedienteAct | null; caracter: { id: string; clave?: string; nombre: string };
  compareciente: { id: string; nombre_busqueda: string; tipo_persona: string; personaFisica?: { nombre_completo_calculado?: string } | null; personaMoral?: { razon_social?: string } | null };
  representacionesComoRepresentante?: ExpedientePartyRepresentation[];
};
export type ExpedientePartyCatalogs = { acts: Array<ExpedienteAct & { tipo_acto: ExpedienteAct['tipo_acto'] & { tipoActoCaracteresCompareciente: Array<{ caracter_id: string; sugerido?: boolean; caracter: { id: string; clave?: string; nombre: string } }> } }>; representationCharacters: Array<{ id: string; clave: string; nombre: string }>; appearanceForms: ExpedientePartyRelation['forma_comparecencia'][] };
export type ExpedientePartyOperation = 'LINK' | 'UPDATE' | 'UNLINK';
export type ExpedientePartyCommand = { operation: ExpedientePartyOperation; relation_id?: string; expediente_acto_id?: string; compareciente_id?: string; caracter_id?: string; forma_comparecencia?: ExpedientePartyRelation['forma_comparecencia']; participacion_porcentaje?: number | null; representation?: Omit<ExpedientePartyRepresentation, 'id' | 'representado' | 'caracterRepresentacion'> | null; reason?: string; idempotency_key?: string; preview_fingerprint?: string; confirm_protected_work?: boolean };
export type ExpedientePartyPreview = { fingerprint: string; classification: 'SAFE' | 'REVIEW_REQUIRED' | 'BLOCKED'; impact: { added: Array<{ key: string; id: string; name: string; source: 'CFG-002' }>; removed_or_no_longer_applicable: Array<{ key: string; id: string; name: string; source: 'CFG-002' }>; retained: Array<{ key: string; id: string; name: string; source: 'CFG-002' }>; protected_work: { count: number; requires_human_confirmation: boolean }; sources: { cfg002: true } } };

export type PredioSummary = { id: string; apodo?: string | null; clave_catastral?: string | null; cuenta_predial?: string | null; folio_real?: string | null; ubicacion_texto?: string | null; calle?: string | null; numero_exterior?: string | null; colonia?: string | null; municipio?: string | null; estado?: string | null };
export type ExpedientePredioRelation = { id: string; expediente_id: string; predio_id: string; estatus: string; predio: PredioSummary; actos: Array<{ id: string; expediente_acto_id: string; expedienteActo: ExpedienteAct }> };
export type ExpedientePredioCatalogs = { acts: ExpedienteAct[] };
export type ExpedientePredioOperation = 'LINK' | 'UPDATE' | 'UNLINK';
export type ExpedientePredioCommand = { operation: ExpedientePredioOperation; relation_id?: string; predio_id?: string; expediente_acto_ids?: string[]; reason?: string; idempotency_key?: string; preview_fingerprint?: string; confirm_protected_work?: boolean };
export type ExpedientePredioPreview = { fingerprint: string; classification: 'SAFE' | 'REVIEW_REQUIRED' | 'BLOCKED'; predio_id: string; current_relation_id?: string | null; target_act_ids: string[]; impact: { added: Array<{ key: string; id: string; name: string; source: 'CFG-002' }>; removed_or_no_longer_applicable: Array<{ key: string; id: string; name: string; source: 'CFG-002' }>; retained: Array<{ key: string; id: string; name: string; source: 'CFG-002' }>; protected_work: { count: number; requires_human_confirmation: boolean }; sources: { cfg002: true }; automatic_document_generation: false } };

export type ExpedienteDocumentOrigin = 'PROSPECTO' | 'COTIZACION' | 'COTIZACION_NOTARIA' | 'COMPARECIENTE' | 'PREDIO' | 'CFG002' | 'ISR' | 'FINANZAS' | 'EXPEDIENTE';
export type ExpedienteDocumentAppendixItem = {
  id: string; documento_id?: string | null; origin: ExpedienteDocumentOrigin; source_name: string;
  source_entity_type?: string | null; source_entity_id?: string | null; source_context?: string | null;
  document_version: string; name: string; type: string; status: string; incorporated_at: string;
  file_available: boolean; snapshot: boolean;
};
export type ExpedienteDocumentAppendix = {
  state: 'SINCRONIZADO_PREFIRMA' | 'CONGELADO_AL_FIRMAR'; frozen_at?: string | null; revision: string;
  groups: Array<{ origin: ExpedienteDocumentOrigin; label: string; items: ExpedienteDocumentAppendixItem[] }>;
  sync?: { created: number; reactivated: number; inactivated: number; blob_copies: 0 };
};

export type SeguimientoEstado = 'NO_INICIADO' | 'EN_PROCESO' | 'EN_ESPERA_EXTERNA' | 'COMPLETADO' | 'BLOQUEADO' | 'NO_APLICA';
export type SeguimientoActivity = {
  id: string; expediente_acto_id: string; etapa_nombre_snapshot: string; actividad_nombre_snapshot: string;
  actividad_descripcion_snapshot?: string | null; estado: SeguimientoEstado; estado_operativo: SeguimientoEstado;
  estado_efectivo: SeguimientoEstado; estado_label: string; version: number; en_alcance: boolean; requiere_revision: boolean;
  motivo_revision?: string | null; responsable_id?: string | null; responsable?: PersonOption | null; aplica_por_defecto: boolean;
  resolucion_fuente: string; excepcion_operativa?: { duracion_estimada?: number; tipo_dias?: 'HABILES' | 'NATURALES'; margen_seguridad?: number; motivo?: string } | null; primera_fecha_inicio?: string | null; fecha_completada_actual?: string | null;
  dependencias: Array<{ id: string; actividad_id: string; nombre: string; estado: SeguimientoEstado; bloqueante: boolean }>;
  bloqueada_por: Array<{ id: string; nombre: string; estado: SeguimientoEstado }>;
  tiempo: { estimado: number; tipo_dias: 'HABILES' | 'NATURALES'; margen: number; transcurrido: number; fecha_objetivo?: string | null; limite_margen?: string | null; atrasada: boolean; margen_consumido: boolean };
};
export type ExpedienteSeguimiento = {
  expediente_id: string; configuracion_actual_no_reaplicada: true; fecha_firma_manual?: string | null;
  firma: { programada?: string | null; efectiva?: string | null; snapshot_canonico: boolean };
  entrega: { completada: boolean; fecha?: string | null; alertas_operativas_activas: boolean };
  actos: Array<{ expediente_acto_id: string; tipo_acto_id?: string; nombre: string; estatus: string; etapas: Array<{ nombre: string; orden: number; actividades: SeguimientoActivity[] }> }>;
  responsables: PersonOption[];
  signals: { prefirm: SeguimientoActivity[]; postfirm: SeguimientoActivity[] };
};

export type ExpedienteArtifactPending = {
  id: string; artifact_id: string; rule_id: string; master_version_id: string; act_id?: string | null;
  subject_type: 'EXPEDIENTE' | 'COMPARECIENTE' | 'INMUEBLE' | 'FIJO'; subject_id?: string | null; ordinal: number;
  estado: 'PENDIENTE' | 'PENDIENTE_REVISION' | 'VALIDADO' | 'NO_APLICA'; obligatoria: boolean;
  explanation: { artifact_name?: string; artifact_type?: 'PLANTILLA' | 'FORMATO'; owner_type?: string; act_names?: string[]; subject_name?: string; master_version?: number; [key: string]: unknown };
  source_revision: string; version: number; in_scope: boolean; review_required: boolean; review_reason?: string | null;
  document_id?: string | null; validated_at?: string | null;
};
export type ExpedienteArtifacts = {
  data: ExpedienteArtifactPending[];
  preview: { revision: string; applicable: number; creates: number };
  source: 'CFG-002'; master_rules_editable: false; auto_generated_documents: 0;
};

export type BudgetConceptCategory = 'HONORARIOS' | 'IVA_HONORARIOS' | 'IMPUESTOS_DERECHOS';
export type ExpedienteBudgetConcept = { id?: string; concepto: string; categoria: BudgetConceptCategory; importe: string; orden: number };
export type BudgetDistributionParty = { honorarios: string; honorarios_porcentaje: string; iva: string; iva_porcentaje: string };
export type ExpedienteBudgetPdf = { id: string; document_id: string; generated_at: string; total: string; budget_version: number; note?: string | null; file_name: string; mime_type: string; immutable: true };
export type ExpedienteBudget = {
  id: string; version: number; origin: 'COTIZACION_ESTRUCTURADA' | 'LEGACY_JSON' | 'LEGACY_SIN_ESTRUCTURA';
  quote_origin?: { quote_id: string; quote_version_id: string; quote_version: number; immutable: true } | null;
  concepts: ExpedienteBudgetConcept[];
  totals: { honorarios: string; iva_honorarios: string; subtotal_honorarios: string; subtotal_impuestos_derechos: string; total: string };
  internal_distribution?: { pravia: BudgetDistributionParty; notaria: BudgetDistributionParty; canonical_values: 'AMOUNTS'; closed: boolean } | null;
  requires_classification: boolean; distribution_requires_review: boolean; pdf_history: ExpedienteBudgetPdf[];
  capabilities: { can_edit: boolean; can_view_internal_distribution: boolean; can_edit_internal_distribution: boolean; can_generate_pdf: boolean; can_view_pdf: boolean; can_delete_pdf: boolean };
  editable_history_versions: 0; canonical_source: 'ExpedientePresupuesto'; legacy_json_writer_enabled: false;
};

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
  comparecientes: ExpedientePartyRelation[]; expedienteRepresentaciones?: Array<any>; actos?: ExpedienteAct[];
  predios?: ExpedientePredioRelation[];
  requisitos_docs: Array<any>; expedienteDocumentos?: Array<any>; documentos_autorizados?: Array<any>;
  etapas?: Array<any>; tareas?: Array<any>; tareas_externas?: Array<any>; tareas_postfirma?: Array<any>; entrega?: any;
  movimientosFinancieros?: Array<any>; honorariosGenerados?: Array<any>; financialSummary?: { ingresos_recibidos:number;honorarios_generados:number;honorarios_cobrados:number;honorarios_por_cobrar:number;fondos_terceros:number;otros_destinos:number;fondos_terceros_pendientes:number;egresos:number } | null; actividades?: Array<any>; complianceReviews?: Array<any>;
  workflow: { current_status_label: string; transitions: ExpedienteTransition[]; next_stage?: any; stages?: Array<any> };
  progress: { documental: number; operativo: number; financiero?: number; general: number; configuration?: Record<string, string> };
  readiness: { indicators: ReadinessIndicator[]; blockers: Array<{ type: string; label: string }>; complete: number };
  capabilities: { canWrite: boolean; canDeliver: boolean; canManagePostfirma: boolean; canReadProject: boolean; canReadFinance: boolean; canWriteFinance: boolean; canReadCaseFinance?: boolean; canReportCaseFinance?: boolean; canApplyCaseFinance?: boolean; canUploadDocuments: boolean; canReadDocuments: boolean; canDeleteDocuments: boolean };
};

export type ExpedienteActivityCategory = 'TODO' | 'OPERACION' | 'DOCUMENTOS' | 'FINANZAS' | 'SISTEMA';
export type ExpedienteActivityItem = {
  id: string;
  type: string;
  category: Exclude<ExpedienteActivityCategory, 'TODO'>;
  title: string;
  description: string;
  occurred_at: string;
  actor: { id: string; nombre: string; apellido: string };
  manual_note: boolean;
  previous_values: Record<string, unknown> | null;
  new_values: Record<string, unknown> | null;
  related_section: 'resumen' | 'actos' | 'comparecientes' | 'predios' | 'documentos' | 'seguimiento' | 'plantillas' | 'presupuesto' | 'finanzas' | 'isr' | 'actividad';
  related_entity: string | null;
  related_entity_id: string | null;
};
export type ExpedienteActivityResponse = {
  data: ExpedienteActivityItem[];
  next_cursor: string | null;
  filters: { category: ExpedienteActivityCategory; search: string | null; from: string | null; to: string | null };
  canonical_source: 'ExpedienteActividad';
  technical_audit_source: false;
};
export type ProjectVersion = { id: string; version_numero: number; nombre_original?: string; nota_version?: string; es_vigente: boolean; es_version_final?: boolean; subido_por_nombre?: string; created_at: string };
export type ProjectState = { vigente: ProjectVersion | null; historial: ProjectVersion[]; ultimoReporte?: unknown };
