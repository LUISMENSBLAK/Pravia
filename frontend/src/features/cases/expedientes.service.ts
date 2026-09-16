import { apiBlobRequest, apiRequest } from '../../services/api/client';
import type { ActTypeOption, EligibleQuoteCandidate, ExpedienteAct, ExpedienteActCommand, ExpedienteActPreview, ExpedienteActivityCategory, ExpedienteActivityResponse, ExpedienteArtifacts, ExpedienteBudget, ExpedienteBudgetConcept, ExpedienteDetail, ExpedienteDocumentAppendix, ExpedienteListFilters, ExpedienteListResult, ExpedientePartyCatalogs, ExpedientePartyCommand, ExpedientePartyPreview, ExpedientePartyRelation, ExpedientePartySearchOption, ExpedientePredioCatalogs, ExpedientePredioCommand, ExpedientePredioPreview, ExpedientePredioRelation, ExpedienteQuestionnaireInstance, ExpedienteSeguimiento, PredioSummary, ProjectState, SeguimientoEstado } from './expedientes.types';

const query = (filters: ExpedienteListFilters) => {
  const params = new URLSearchParams();
  const values: Record<string, string | number | undefined> = {
    search: filters.search, folio: filters.folio, macrofase: filters.macrophase, etapa: filters.stage, responsable: filters.responsible,
    notaria_id: filters.notary, riesgo: filters.risk, cumplimiento: filters.compliance, fecha_desde: filters.dateFrom, fecha_hasta: filters.dateTo,
    tipo_acto_id: filters.actType, cliente: filters.client, estatus: filters.status, page: filters.page || 1,
    pageSize: filters.pageSize || 20, sort: filters.sort || 'updated_at:desc',
  };
  Object.entries(values).forEach(([key, value]) => { if (value !== undefined && value !== '') params.set(key, String(value)); });
  return params.toString();
};
const downloadBlob = async (endpoint: string, name: string, payload?: unknown) => {
  const blob = await apiBlobRequest(endpoint, {
    method: payload === undefined ? 'GET' : 'POST',
    headers: payload === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: payload === undefined ? undefined : JSON.stringify(payload),
  });
  const url = URL.createObjectURL(blob); const link = document.createElement('a'); link.href = url; link.download = name; link.click(); window.setTimeout(() => URL.revokeObjectURL(url), 1000);
};
export const expedientesService = {
  list(filters: ExpedienteListFilters, signal?: AbortSignal) { return apiRequest<ExpedienteListResult>(`/expedientes?${query(filters)}`, { signal }); },
  detail(id: string, signal?: AbortSignal) { return apiRequest<ExpedienteDetail>(`/expedientes/${encodeURIComponent(id)}`, { signal }); },
  activity(id: string, filters: { category?: ExpedienteActivityCategory; search?: string; from?: string; to?: string; cursor?: string | null; limit?: number } = {}, signal?: AbortSignal) { const params = new URLSearchParams(); Object.entries(filters).forEach(([key, value]) => { if (value !== undefined && value !== null && value !== '') params.set(key, String(value)); }); return apiRequest<ExpedienteActivityResponse>(`/expedientes/${encodeURIComponent(id)}/actividad?${params}`, { signal }); },
  addActivityNote(id: string, note: string, idempotencyKey: string) { return apiRequest<{ item: ExpedienteActivityResponse['data'][number]; idempotent: boolean }>(`/expedientes/${encodeURIComponent(id)}/actividad/notas`, { method: 'POST', body: JSON.stringify({ note, idempotency_key: idempotencyKey }) }); },
  actTypes(signal?: AbortSignal) { return apiRequest<ActTypeOption[]>('/expedientes/tipos-acto', { signal }); },
  listActs(id: string, signal?: AbortSignal) { return apiRequest<{ data: ExpedienteAct[]; canonical_source: 'ExpedienteActo'; legacy_tipo_acto_id_editable: false }>(`/expedientes/${encodeURIComponent(id)}/actos`, { signal }); },
  previewAct(id: string, input: ExpedienteActCommand) { return apiRequest<ExpedienteActPreview>(`/expedientes/${encodeURIComponent(id)}/actos/preview`, { method: 'POST', body: JSON.stringify(input) }); },
  applyAct(id: string, input: ExpedienteActCommand) { return apiRequest<{ acto: ExpedienteAct; idempotent: boolean; version?: number }>(`/expedientes/${encodeURIComponent(id)}/actos/aplicar`, { method: 'POST', body: JSON.stringify(input) }); },
  listParties(id: string, signal?: AbortSignal) { return apiRequest<{ data: ExpedientePartyRelation[]; canonical_source: 'ExpedienteCompareciente'; legacy_pending_act_assignment: number }>(`/expedientes/${encodeURIComponent(id)}/comparecientes`, { signal }); },
  searchParties(id: string, search: string, signal?: AbortSignal) { const params = new URLSearchParams({ search }); return apiRequest<{ data: ExpedientePartySearchOption[] }>(`/expedientes/${encodeURIComponent(id)}/comparecientes/buscar?${params}`, { signal }); },
  partyCatalogs(id: string, signal?: AbortSignal) { return apiRequest<{ data: ExpedientePartyCatalogs }>(`/expedientes/${encodeURIComponent(id)}/comparecientes/catalogos`, { signal }).then((payload) => payload.data); },
  previewParty(id: string, input: ExpedientePartyCommand) { return apiRequest<ExpedientePartyPreview>(`/expedientes/${encodeURIComponent(id)}/comparecientes/preview`, { method: 'POST', body: JSON.stringify(input) }); },
  applyParty(id: string, input: ExpedientePartyCommand) { return apiRequest<{ relation: ExpedientePartyRelation; idempotent: boolean; version?: number }>(`/expedientes/${encodeURIComponent(id)}/comparecientes/aplicar`, { method: 'POST', body: JSON.stringify(input) }); },
  listProperties(id: string, signal?: AbortSignal) { return apiRequest<{ data: ExpedientePredioRelation[]; canonical_source: string }>(`/expedientes/${encodeURIComponent(id)}/predios`, { signal }); },
  searchProperties(id: string, search: string, signal?: AbortSignal) { const params = new URLSearchParams({ search }); return apiRequest<{ data: PredioSummary[] }>(`/expedientes/${encodeURIComponent(id)}/predios/buscar?${params}`, { signal }); },
  propertyCatalogs(id: string, signal?: AbortSignal) { return apiRequest<{ data: ExpedientePredioCatalogs }>(`/expedientes/${encodeURIComponent(id)}/predios/catalogos`, { signal }).then((payload) => payload.data); },
  previewProperty(id: string, input: ExpedientePredioCommand) { return apiRequest<ExpedientePredioPreview>(`/expedientes/${encodeURIComponent(id)}/predios/preview`, { method: 'POST', body: JSON.stringify(input) }); },
  applyProperty(id: string, input: ExpedientePredioCommand) { return apiRequest<{ relation: ExpedientePredioRelation; idempotent: boolean; version?: number }>(`/expedientes/${encodeURIComponent(id)}/predios/aplicar`, { method: 'POST', body: JSON.stringify(input) }); },
  seguimiento(id: string, signal?: AbortSignal) { return apiRequest<ExpedienteSeguimiento>(`/expedientes/${encodeURIComponent(id)}/seguimiento`, { signal }); },
  materializeSeguimiento(id: string) { return apiRequest<{ created: number; existing: number; review_required: number; idempotent: boolean }>(`/expedientes/${encodeURIComponent(id)}/seguimiento/materializar`, { method: 'POST' }); },
  createSeguimientoExtraordinary(id: string, input: Record<string, unknown>) { return apiRequest(`/expedientes/${encodeURIComponent(id)}/seguimiento/actividades-extraordinarias`, { method: 'POST', body: JSON.stringify(input) }); },
  setSeguimientoDependencies(id: string, activityId: string, dependency_ids: string[]) { return apiRequest(`/expedientes/${encodeURIComponent(id)}/seguimiento/actividades/${encodeURIComponent(activityId)}/dependencias`, { method: 'PUT', body: JSON.stringify({ dependency_ids }) }); },
  artifacts(id: string, signal?: AbortSignal) { return apiRequest<ExpedienteArtifacts>(`/expedientes/${encodeURIComponent(id)}/plantillas-formatos`, { signal }); },
  questionnaires(id: string, signal?: AbortSignal) { return apiRequest<{ success: true; data: ExpedienteQuestionnaireInstance[] }>(`/expedientes/${encodeURIComponent(id)}/cuestionarios`, { signal }).then((payload) => payload.data); },
  saveQuestionnaire(id: string, input: { versionId: string; scope: string; subjectKey: string; answers: Record<string, unknown>; finalize: boolean; idempotencyKey: string }) { return apiRequest(`/expedientes/${encodeURIComponent(id)}/cuestionarios/respuestas`, { method: 'POST', body: JSON.stringify(input) }); },
  budget(id: string, signal?: AbortSignal) { return apiRequest<ExpedienteBudget>(`/expedientes/${encodeURIComponent(id)}/presupuesto`, { signal }); },
  saveBudget(id: string, input: { expected_version: number; concepts: ExpedienteBudgetConcept[]; distribution?: { pravia_honorarios: { mode: 'AMOUNT' | 'PERCENT'; value: string }; pravia_iva: { mode: 'AMOUNT' | 'PERCENT'; value: string } } }) { return apiRequest<ExpedienteBudget>(`/expedientes/${encodeURIComponent(id)}/presupuesto`, { method: 'PUT', body: JSON.stringify(input) }); },
  generateBudgetPdf(id: string, input: { expected_version: number; idempotency_key: string; note?: string }) { return apiRequest<{ item: any; idempotent: boolean }>(`/expedientes/${encodeURIComponent(id)}/presupuesto/generar`, { method: 'POST', body: JSON.stringify(input) }); },
  budgetPdfUrl(id: string, historyId: string) { return apiRequest<{ url: string; expires_in: number; file_name: string; mime_type: string }>(`/expedientes/${encodeURIComponent(id)}/presupuesto/documentos/${encodeURIComponent(historyId)}/url`); },
  deleteBudgetPdf(id: string, historyId: string, reason?: string) { return apiRequest<{ deleted: true; idempotent: boolean }>(`/expedientes/${encodeURIComponent(id)}/presupuesto/documentos/${encodeURIComponent(historyId)}`, { method: 'DELETE', body: JSON.stringify({ reason }) }); },
  materializeArtifacts(id: string, expectedRevision: string) { return apiRequest(`/expedientes/${encodeURIComponent(id)}/plantillas-formatos/materializar`, { method: 'POST', body: JSON.stringify({ expected_revision: expectedRevision }) }); },
  previewArtifactGeneration(id: string, pendingId: string) { return apiRequest<{ pending_id: string; pending_version: number; source_revision: string; source_manifest: { policy: string; subjectComparecienteId: string; structuredFieldsUsed: string[]; currentDocumentIds: string[]; masterArtifactId: string; masterVersionId: string }; missing: string[]; conflicts: unknown[]; can_generate: boolean }>(`/expedientes/${encodeURIComponent(id)}/plantillas-formatos/${encodeURIComponent(pendingId)}/generar/preview`, { method: 'POST', body: '{}' }); },
  generateArtifact(id: string, pendingId: string, input: { expected_version: number; source_revision: string; idempotency_key: string }) { return apiRequest(`/expedientes/${encodeURIComponent(id)}/plantillas-formatos/${encodeURIComponent(pendingId)}/generar`, { method: 'POST', body: JSON.stringify(input) }); },
  uploadArtifact(id: string, pendingId: string, file: File, expectedVersion: number, idempotencyKey: string) { const body = new FormData(); body.set('file', file); body.set('expected_version', String(expectedVersion)); body.set('idempotency_key', idempotencyKey); return apiRequest(`/expedientes/${encodeURIComponent(id)}/plantillas-formatos/${encodeURIComponent(pendingId)}/upload`, { method: 'POST', body }); },
  validateArtifact(id: string, pendingId: string, expectedVersion: number, idempotencyKey: string) { return apiRequest(`/expedientes/${encodeURIComponent(id)}/plantillas-formatos/${encodeURIComponent(pendingId)}/validar`, { method: 'POST', body: JSON.stringify({ expected_version: expectedVersion, idempotency_key: idempotencyKey }) }); },
  artifactUrl(id: string, pendingId: string) { return apiRequest<{ url: string; file_name: string }>(`/expedientes/${encodeURIComponent(id)}/plantillas-formatos/${encodeURIComponent(pendingId)}/url`); },
  updateSeguimientoActivity(id: string, activityId: string, input: { expected_version: number; estado?: SeguimientoEstado; responsable_id?: string | null; excepcion_operativa?: { duracion_estimada?: number; tipo_dias?: 'HABILES' | 'NATURALES'; margen_seguridad?: number; motivo?: string } | null; razon?: string; orden_operativo?: number }) { return apiRequest(`/expedientes/${encodeURIComponent(id)}/seguimiento/actividades/${encodeURIComponent(activityId)}`, { method: 'PATCH', body: JSON.stringify(input) }); },
  reopenSeguimientoActivity(id: string, activityId: string, input: { expected_version: number; razon: string }) { return apiRequest(`/expedientes/${encodeURIComponent(id)}/seguimiento/actividades/${encodeURIComponent(activityId)}/reabrir`, { method: 'POST', body: JSON.stringify(input) }); },
  eligibleQuotes(signal?: AbortSignal) {
    return apiRequest<{ data: EligibleQuoteCandidate[]; total: number }>('/expedientes/cotizaciones-elegibles', { signal });
  },
  convertQuote(cotizacionId: string, workflow?: { version: number; effectiveAt: string; idempotencyKey: string }) {
    return apiRequest<ExpedienteDetail & { idempotent?: boolean }>('/expedientes/convertir-cotizacion', {
      method: 'POST', body: JSON.stringify({ cotizacion_id: cotizacionId, ...(workflow ? { expectedVersion: workflow.version, effectiveAt: workflow.effectiveAt, idempotencyKey: workflow.idempotencyKey, confirm: true } : {}) }),
    });
  },
  transition(id: string, input: { expected_version: number; nuevo_estatus: string; nueva_etapa_clave?: string; notas?: string; fecha_efectiva?: string; datos_firma?: { fecha_firma: string; lugar: string }; document_revision?: string; mode?: 'PREVIEW' | 'CONFIRM'; preflight_hash?: string; idempotency_key?: string }) {
    return apiRequest<ExpedienteDetail>(`/expedientes/${encodeURIComponent(id)}/transicion-estatus`, { method: 'POST', body: JSON.stringify(input) });
  },
  signaturePreflight(id: string, expectedVersion: number) {
    return apiRequest<{ success: boolean; mode: 'PREVIEW'; preflight: { ready: boolean; ready_label: string; count: number; hash: string; missing: Array<{ id: string; label: string; source: string; action: string; status: string }> } }>(`/expedientes/${encodeURIComponent(id)}/transicion-estatus`, { method: 'POST', body: JSON.stringify({ expected_version: expectedVersion, nuevo_estatus: 'FIRMADO', mode: 'PREVIEW' }) });
  },
  project(id: string, signal?: AbortSignal) { return apiRequest<ProjectState>(`/expedientes/${encodeURIComponent(id)}/proyecto`, { signal }); },
  documentAppendix(id: string, signal?: AbortSignal) { return apiRequest<ExpedienteDocumentAppendix>(`/expedientes/${encodeURIComponent(id)}/documentos/apendice`, { signal }); },
  syncDocumentAppendix(id: string) { return apiRequest<ExpedienteDocumentAppendix>(`/expedientes/${encodeURIComponent(id)}/documentos/sincronizar`, { method: 'POST' }); },
  importDocumentSource(id: string, origin: 'compareciente' | 'predio') { return apiRequest<ExpedienteDocumentAppendix>(`/expedientes/${encodeURIComponent(id)}/documentos/importar/${origin}`, { method: 'POST' }); },
  createDocumentFolder(id: string, name: string, parentId?: string | null) { return apiRequest(`/expedientes/${encodeURIComponent(id)}/documentos/carpetas`, { method: 'POST', body: JSON.stringify({ name, parent_id: parentId || null }) }); },
  renameDocumentFolder(id: string, folderId: string, name: string) { return apiRequest(`/expedientes/${encodeURIComponent(id)}/documentos/carpetas/${encodeURIComponent(folderId)}`, { method: 'PATCH', body: JSON.stringify({ name }) }); },
  deleteDocumentFolder(id: string, folderId: string) { return apiRequest(`/expedientes/${encodeURIComponent(id)}/documentos/carpetas/${encodeURIComponent(folderId)}`, { method: 'DELETE' }); },
  moveDocumentItems(id: string, input: { document_ids?: string[]; folder_ids?: string[]; target_folder_id?: string | null }) { return apiRequest(`/expedientes/${encodeURIComponent(id)}/documentos/mover`, { method: 'POST', body: JSON.stringify(input) }); },
  renameDocument(id: string, itemId: string, name: string) { return apiRequest(`/expedientes/${encodeURIComponent(id)}/documentos/${encodeURIComponent(itemId)}`, { method: 'PATCH', body: JSON.stringify({ nombre: name }) }); },
  deleteDocument(id: string, itemId: string) { return apiRequest(`/expedientes/${encodeURIComponent(id)}/documentos/${encodeURIComponent(itemId)}`, { method: 'DELETE' }); },
  appendixSignedUrl(id: string, itemId: string) { return apiRequest<{ url: string; expires_in: number; file_name: string; mime_type: string }>(`/expedientes/${encodeURIComponent(id)}/documentos/apendice/${encodeURIComponent(itemId)}/url`); },
  async downloadAppendixFile(id: string, itemId: string, name: string) {
    return downloadBlob(`/expedientes/${encodeURIComponent(id)}/documentos/apendice/${encodeURIComponent(itemId)}/descargar`, name);
  },
  async downloadAppendixZip(id: string, input: { folder_id?: string | null; folder_ids?: string[]; item_ids?: string[] }, name = 'expediente-documental.zip') {
    return downloadBlob(`/expedientes/${encodeURIComponent(id)}/documentos/apendice/descargar-zip`, name, input);
  },
  uploadDocument(id: string, file: File, fields: { categoria: string; carpeta: string; folder_id?: string | null }) {
    const body = new FormData(); body.set('file', file); body.set('categoria', fields.categoria); body.set('carpeta', fields.carpeta); if (fields.folder_id) body.set('folder_id', fields.folder_id);
    return apiRequest(`/expedientes/${encodeURIComponent(id)}/documentos`, { method: 'POST', body });
  },
  uploadProject(id: string, file: File, note = '') {
    const body = new FormData(); body.set('file', file); if (note) body.set('nota_version', note);
    return apiRequest(`/expedientes/${encodeURIComponent(id)}/proyecto/upload`, { method: 'POST', body });
  },
  saveProjectAsNotaryTemplate(id: string, versionId: string, nombre?: string) {
    return apiRequest<{ artifact_id: string; version_id: string; idempotent: boolean }>(`/expedientes/${encodeURIComponent(id)}/proyecto/versions/${encodeURIComponent(versionId)}/guardar-como-plantilla`, { method: 'POST', body: JSON.stringify({ nombre }) });
  },
  createPostfirmaTask(id: string, input: { tipo: string; descripcion: string; institucion: string; fecha_limite?: string }) {
    return apiRequest(`/expedientes/${encodeURIComponent(id)}/postfirma/tramites`, { method: 'POST', body: JSON.stringify(input) });
  },
  updatePostfirmaTask(id: string, taskId: string, input: { estatus: string; resultado?: string; evidencia_documento_id?: string }) {
    return apiRequest(`/expedientes/${encodeURIComponent(id)}/postfirma/tramites/${encodeURIComponent(taskId)}`, { method: 'PATCH', body: JSON.stringify(input) });
  },
  deliver(id: string, input: { expected_version: number; receptor_nombre: string; receptor_caracter: string; fecha_efectiva: string; medio: string; items: Array<{ documento_id: string; tipo: string; cantidad: number }>; evidencia_documento_id: string; observaciones?: string }) {
    return apiRequest(`/expedientes/${encodeURIComponent(id)}/entrega`, { method: 'POST', body: JSON.stringify(input) });
  },
  async downloadDocument(expedienteId: string, documentId: string, name: string) {
    const blob = await apiBlobRequest(`/expedientes/${encodeURIComponent(expedienteId)}/documentos/${encodeURIComponent(documentId)}/descargar`);
    const url = URL.createObjectURL(blob); const link = document.createElement('a'); link.href = url; link.download = name; link.click(); window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  },
  async downloadProject(expedienteId: string, versionId: string, name: string) {
    const blob = await apiBlobRequest(`/expedientes/${encodeURIComponent(expedienteId)}/proyecto/versions/${encodeURIComponent(versionId)}/descargar`);
    const url = URL.createObjectURL(blob); const link = document.createElement('a'); link.href = url; link.download = name; link.click(); window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  },
};
