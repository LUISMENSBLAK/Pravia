/** Structured quote relations are authoritative; Prospect is a historical fallback. */
export function quoteActName(quote: { actos?: Array<{ tipo_acto: { nombre: string } }>; prospecto?: { tipo_acto?: string | null } | null }) {
  return quote.actos?.map((item) => item.tipo_acto.nombre).filter(Boolean).join(', ') || quote.prospecto?.tipo_acto?.trim() || '';
}
export function quoteClientName(quote: { solicitante_formal?: { nombre_busqueda: string } | null; prospecto?: { nombre: string } | null }) {
  return quote.solicitante_formal?.nombre_busqueda || quote.prospecto?.nombre || '';
}
