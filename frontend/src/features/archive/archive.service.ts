import { apiBlobRequest, apiRequest } from '../../services/api/client';

export type ArchivoRecord = {
  id: string; expediente_id: string | null; clase: 'INSTRUMENTO' | 'INUTILIZADO';
  numero_escritura: string | null; folio_inicio: string; folio_fin: string; numero_folios: string;
  fecha_instrumento: string; libro_tomo: string | null; no_paso: boolean; motivo: string | null;
  created_at: string; updated_at: string;
  expediente: { id: string; numero_pravia: string; cliente_alias: string | null; abogado: { id: string; nombre: string; apellido?: string | null }; acto: string | null; vulnerable: string } | null;
};
export type ArchivoOverview = {
  records: ArchivoRecord[]; unused_folios: ArchivoRecord[];
  next_numero_escritura: string | null; next_folio: string | null;
  libro_tomo: string | null; libro_tomo_configured: boolean;
  legacy_reconciliation_required: boolean; legacy_count: number;
};
export type ArchivoInput = { numero_escritura: string; folio_inicio: string; folio_fin: string; fecha_instrumento: string; libro_tomo: string; no_paso?: boolean };
export type ArchivoAppendix = { id: string; documento: { id: string; nombre_original: string; mime_type: string; size_bytes: number; fecha_carga: string } };

export const archivoService = {
  overview(signal?: AbortSignal) { return apiRequest<ArchivoOverview>('/archivo', { signal }); },
  expediente(id: string, signal?: AbortSignal) { return apiRequest<{ record: ArchivoRecord | null; appendix: ArchivoAppendix[]; notes: ArchivoAppendix[]; format: { available: boolean; name: string | null; reason: string | null }; overview: ArchivoOverview }>(`/expedientes/${encodeURIComponent(id)}/archivo`, { signal }); },
  assign(expedienteId: string, input: ArchivoInput) { return apiRequest<ArchivoRecord>(`/expedientes/${encodeURIComponent(expedienteId)}/archivo`, { method: 'POST', body: JSON.stringify(input) }); },
  update(recordId: string, input: ArchivoInput) { return apiRequest<ArchivoRecord>(`/archivo/${encodeURIComponent(recordId)}`, { method: 'PATCH', body: JSON.stringify(input) }); },
  registerUnused(input: { folio_inicio: string; folio_fin: string; fecha_instrumento: string; motivo: string }) { return apiRequest<ArchivoRecord>('/archivo/folios-inutilizados', { method: 'POST', body: JSON.stringify(input) }); },
  uploadAppendix(id: string, file: File, context: 'APENDICE_ARCHIVO' | 'NOTA_ARCHIVO' = 'APENDICE_ARCHIVO') { const body = new FormData(); body.set('file', file); body.set('context', context); return apiRequest<ArchivoAppendix>(`/expedientes/${encodeURIComponent(id)}/archivo/apendice`, { method: 'POST', body }); },
  generateNote(id: string, instruction: string) { return apiRequest<ArchivoAppendix & { idempotent: boolean }>(`/expedientes/${encodeURIComponent(id)}/archivo/formatos/generar`, { method: 'POST', body: JSON.stringify({ instruction, idempotency_key: globalThis.crypto.randomUUID() }) }); },
  async downloadAppendix(id: string, item: ArchivoAppendix) {
    const blob = await apiBlobRequest(`/expedientes/${encodeURIComponent(id)}/archivo/apendice/${encodeURIComponent(item.id)}/descargar`);
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a'); link.href = url; link.download = item.documento.nombre_original; link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  },
};
