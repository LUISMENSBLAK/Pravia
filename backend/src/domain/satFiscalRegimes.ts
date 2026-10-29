import catalog from './satCfdiCatalog_20261029.json';

// Snapshot versionado del XLS oficial de CFDI 4.0. Cargar el módulo es
// idempotente y no modifica catálogos ni datos de ningún tenant.
export const SAT_FISCAL_REGIME_SOURCE = `${catalog.fuente.archivo}:${catalog.fuente.sha256}`;
export const SAT_CFDI_CATALOG_SOURCE = catalog.fuente;
export const SAT_FISCAL_REGIMES = catalog.regimenFiscal.items.map((item) => ({
  ...item,
  tipo: item.tiposPersona.length === 2 ? 'AMBAS' : item.tiposPersona[0],
}));
export const SAT_CFDI_USES = catalog.usoCFDI.items;

export type SatPersonType = 'FISICA' | 'MORAL';

export const normalizeRegimeLabel = (value: string) => value.normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '').replace(/^regimen\s+(?:de\s+)?/i, '')
  .replace(/[^a-z0-9]+/gi, ' ').trim().toLowerCase();

function activeOn(item: { vigenteDesde: string; vigenteHasta: string | null }, date: string) {
  return item.vigenteDesde <= date && (!item.vigenteHasta || date <= item.vigenteHasta);
}

export function satRegime(code: string, date = new Date().toISOString().slice(0, 10)) {
  return SAT_FISCAL_REGIMES.find((item) => item.clave === code && activeOn(item, date)) || null;
}

export function satCfdiUse(code: string, date = new Date().toISOString().slice(0, 10)) {
  return SAT_CFDI_USES.find((item) => item.clave === code && activeOn(item, date)) || null;
}

export function satCfdiUseCompatible(code: string, regime: string, personType: SatPersonType,
  date = new Date().toISOString().slice(0, 10)) {
  const use = satCfdiUse(code, date);
  const receiverRegime = satRegime(regime, date);
  return Boolean(use && receiverRegime && use.tiposPersona.includes(personType) &&
    receiverRegime.tiposPersona.includes(personType) && use.regimenesReceptor.includes(regime));
}

export function mapLiteralSatRegime(literal: string) {
  const normalized = normalizeRegimeLabel(literal);
  // Correspondencia exacta tras normalización, nunca fuzzy/semántica.
  return SAT_FISCAL_REGIMES.find((item) => normalizeRegimeLabel(item.descripcion) === normalized) || null;
}
