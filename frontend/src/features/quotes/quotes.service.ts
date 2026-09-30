import { apiBlobRequest, apiRequest } from '../../services/api/client';
import type { NotaryOption, ProspectCandidate, Quote, QuoteAIProposal, QuoteActTypeOption, QuoteBudget, QuoteBudgetConcept, QuoteBudgetExtraction, QuoteContractAction, QuoteDocument, QuoteFollowUp, QuoteListFilters, QuoteListResult, QuoteState } from './quotes.types';

const asObject = (value: unknown): Record<string, unknown> | null => value && typeof value === 'object' ? value as Record<string, unknown> : null;
const queryString = (filters: QuoteListFilters) => {
  const params = new URLSearchParams();
  if (filters.search?.trim()) params.set('busqueda', filters.search.trim());
  if (filters.state) params.set('estado', filters.state);
  if (filters.act) params.set('acto', filters.act);
  if (filters.responsible) params.set('responsable', filters.responsible);
  if (filters.dateFrom) params.set('fecha_desde', filters.dateFrom);
  if (filters.dateTo) params.set('fecha_hasta', filters.dateTo);
  params.set('periodo', filters.period ?? '6m');
  params.set('page', String(filters.page ?? 1));
  params.set('pageSize', String(filters.pageSize ?? 12));
  params.set('sort', 'created_at:desc');
  return `?${params.toString()}`;
};

export const quotesService = {
  async list(filters: QuoteListFilters, signal?: AbortSignal): Promise<QuoteListResult> {
    return apiRequest<QuoteListResult>(`/cotizaciones${queryString(filters)}`, { signal });
  },
  async get(id: string, signal?: AbortSignal): Promise<Quote> {
    return apiRequest<Quote>(`/cotizaciones/${encodeURIComponent(id)}`, { signal });
  },
  async getFollowUps(id: string, signal?: AbortSignal): Promise<QuoteFollowUp[]> {
    const payload = await apiRequest<unknown>(`/cotizaciones/${encodeURIComponent(id)}/seguimientos`, { signal });
    return Array.isArray(payload) ? payload as QuoteFollowUp[] : [];
  },
  async getDocuments(id: string, signal?: AbortSignal): Promise<QuoteDocument[]> {
    const payload = await apiRequest<unknown>(`/cotizaciones/${encodeURIComponent(id)}/documentos`, { signal });
    return Array.isArray(payload) ? payload as QuoteDocument[] : [];
  },
  async getDetail(id: string, signal?: AbortSignal): Promise<Quote> {
    const [quote, seguimientos, documentos] = await Promise.all([this.get(id, signal), this.getFollowUps(id, signal), this.getDocuments(id, signal)]);
    return { ...quote, seguimientos, documentos };
  },
  async prospects(search = '', signal?: AbortSignal): Promise<ProspectCandidate[]> {
    const params = new URLSearchParams({ page: '1', pageSize: '40', sinCotizacion: 'true', sort: 'updated_at:desc' });
    if (search.trim()) params.set('busqueda', search.trim());
    const payload = await apiRequest<unknown>(`/prospectos?${params.toString()}`, { signal });
    const root = asObject(payload);
    const data = Array.isArray(payload) ? payload : Array.isArray(root?.data) ? root.data : [];
    return data as ProspectCandidate[];
  },
  async notaries(search = '', signal?: AbortSignal): Promise<NotaryOption[]> {
    const params = new URLSearchParams({ activa: 'true' });
    if (search.trim()) params.set('search', search.trim());
    const payload = await apiRequest<unknown>(`/notarias?${params.toString()}`, { signal });
    return Array.isArray(payload) ? payload as NotaryOption[] : [];
  },
  async actTypes(signal?: AbortSignal): Promise<QuoteActTypeOption[]> {
    const payload = await apiRequest<unknown>('/expedientes/tipos-acto', { signal });
    return Array.isArray(payload) ? payload as QuoteActTypeOption[] : [];
  },
  async create(prospectId: string, notaryId?: string): Promise<Quote> {
    return apiRequest<Quote>('/cotizaciones', { method: 'POST', body: JSON.stringify({ prospecto_id: prospectId, ...(notaryId ? { notaria_id: notaryId } : {}) }) });
  },
  async extractBudget(file: File): Promise<QuoteBudgetExtraction> {
    const body = new FormData(); body.append('archivo', file);
    return apiRequest('/cotizaciones/extraer-presupuesto', { method: 'POST', body });
  },
  async generateDocument(id: string): Promise<QuoteDocument> {
    return apiRequest(`/cotizaciones/${encodeURIComponent(id)}/generar-documento`, { method: 'POST' });
  },
  async updateBudget(id: string, input: { concepts: Array<Pick<QuoteBudgetConcept, 'categoria' | 'concepto' | 'importe'>>; origin: 'MANUAL' | 'IMPORTADO'; operationContext: string; expectedUpdatedAt: string }): Promise<{ presupuesto: QuoteBudget; updated_at: string; stage: string | null }> {
    return apiRequest(`/cotizaciones/${encodeURIComponent(id)}/presupuesto`, { method: 'PUT', body: JSON.stringify(input) });
  },
  async generateAIProposal(id: string): Promise<{ data: QuoteAIProposal; idempotent: boolean }> {
    const key = crypto.randomUUID();
    return apiRequest(`/cotizaciones/${encodeURIComponent(id)}/propuestas-ia`, { method: 'POST', headers: { 'Idempotency-Key': key }, body: JSON.stringify({ idempotency_key: key }) });
  },
  async draftEmailWithAI(id: string): Promise<{ recipient: string; cc: string; subject: string; messageBody: string; provider: 'OPENAI'; model: string; promptVersion: string }> {
    return apiRequest(`/cotizaciones/${encodeURIComponent(id)}/correo-ia`, { method: 'POST' });
  },
  async decideAIProposal(id: string, proposalId: string, action: 'APLICAR' | 'DESCARTAR'): Promise<{ data: QuoteAIProposal; applied: boolean }> {
    return apiRequest(`/cotizaciones/${encodeURIComponent(id)}/propuestas-ia/${encodeURIComponent(proposalId)}`, { method: 'PATCH', body: JSON.stringify({ action }) });
  },
  async updateState(id: string, state: QuoteState): Promise<Quote> {
    return apiRequest(`/cotizaciones/${encodeURIComponent(id)}/estado`, { method: 'PUT', body: JSON.stringify({ estado: state }) });
  },
  async registerDelivery(id: string, input: { destino: 'NOTARIA' | 'CLIENTE'; canal: string; destinatario: string; resumen: string }) {
    return apiRequest(`/cotizaciones/${encodeURIComponent(id)}/registrar-envio`, { method: 'POST', body: JSON.stringify(input) });
  },
  async contractAction(id: string, input: { action: Exclude<QuoteContractAction, 'CONVERTIR'>; expectedVersion: number; idempotencyKey: string; confirm: true; effectiveAt: string; channel?: string; recipient?: string; cc?: string; subject?: string; messageBody?: string; deliveryMode?: 'MANUAL_CONFIRMED'; evidence?: string; reason?: string; confirmedActIds?: string[]; formalApplicantId?: string }) {
    return apiRequest<{ idempotent: boolean; eventId: string }>(`/cotizaciones/${encodeURIComponent(id)}/acciones`, { method: 'POST', body: JSON.stringify(input) });
  },
  async attachAct(id: string, actId: string) {
    return apiRequest<{ relation: NonNullable<Quote['actos']>[number]; idempotent: boolean }>(`/cotizaciones/${encodeURIComponent(id)}/actos`, { method: 'POST', body: JSON.stringify({ tipo_acto_id: actId }) });
  },
  async convert(id: string, input?: { expectedVersion?: number; idempotencyKey?: string; confirm?: true; effectiveAt?: string; tipoActoId?: string }): Promise<{ id: string; numero_pravia?: string; idempotent?: boolean }> {
    const { tipoActoId, ...contract } = input ?? {};
    return apiRequest(`/cotizaciones/${encodeURIComponent(id)}/convertir`, { method: 'POST', body: JSON.stringify({ ...contract, ...(tipoActoId ? { tipo_acto_id: tipoActoId } : {}) }) });
  },
  async documentUrl(documentId: string): Promise<string> {
    const payload = await apiRequest<{ url: string }>(`/documentos/${encodeURIComponent(documentId)}/url`);
    return payload.url;
  },
  async quoteDocumentPreviewUrl(quoteId: string, documentId: string): Promise<string> {
    const blob = await apiBlobRequest(`/cotizaciones/${encodeURIComponent(quoteId)}/documentos/${encodeURIComponent(documentId)}/ver`);
    return URL.createObjectURL(blob);
  },
  async downloadQuoteDocument(quoteId: string, document: QuoteDocument): Promise<void> {
    const blob = await apiBlobRequest(`/cotizaciones/${encodeURIComponent(quoteId)}/documentos/${encodeURIComponent(document.id)}/descargar`);
    const url = URL.createObjectURL(blob);
    const link = window.document.createElement('a');
    link.href = url; link.download = document.nombre_original; link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
  },
  async deleteQuoteDocument(quoteId: string, documentId: string): Promise<void> {
    await apiRequest(`/cotizaciones/${encodeURIComponent(quoteId)}/documentos/${encodeURIComponent(documentId)}`, { method: 'DELETE' });
  },
};
