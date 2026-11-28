import { isAbsentDocumentValue } from './documentExtraction';
import { normalizeDocumentText } from './partyDocumentPolicy';

export type PropertyDocumentKind = 'ANTECEDENTE' | 'PREDIAL' | 'CNA' | 'AVALUO' | 'PREAVALUO';
export function propertyDocumentKind(label: string): PropertyDocumentKind | undefined {
  const text = normalizeDocumentText(label);
  if (/\b(?:PRE ?AVALUO)\b/.test(text)) return 'PREAVALUO';
  if (/\b(?:CNAP?|(?:CERTIFICADO|CONSTANCIA|CARTA) (?:DE )?(?:NO )?ADEUDO (?:DE )?PREDIAL)\b/.test(text)) return 'CNA';
  if (/\b(?:PREDIAL)\b/.test(text)) return 'PREDIAL';
  if (/\b(?:AVALUO)\b/.test(text)) return 'AVALUO';
  if (/\b(?:ESCRITURA|ESC|ANTECEDENTE|TITULO(?: DE PROPIEDAD)?)\b/.test(text)) return 'ANTECEDENTE';
}

const address: PropertyDocumentKind[] = ['PREDIAL', 'AVALUO', 'CNA', 'ANTECEDENTE'];
const registry: PropertyDocumentKind[] = ['PREDIAL', 'AVALUO', 'CNA'];
const measures: PropertyDocumentKind[] = ['PREDIAL', 'AVALUO', 'ANTECEDENTE'];
export const propertyDocumentRules: Record<string, PropertyDocumentKind[]> = {
  ubicacion_texto: ['ANTECEDENTE', 'PREDIAL', 'CNA', 'AVALUO'],
  ...Object.fromEntries(['calle', 'numero_exterior', 'numero_interior', 'colonia', 'localidad', 'municipio', 'estado', 'codigo_postal', 'pais'].map(key => [key, address])),
  clave_catastral: registry, cuenta_predial: registry,
  folio_real: ['ANTECEDENTE'], datos_registrales: ['ANTECEDENTE'], descripcion: ['ANTECEDENTE'], regimen: ['ANTECEDENTE'], colindancias: ['ANTECEDENTE'],
  superficie_terreno_m2: measures, superficie_construccion_m2: measures,
  superficie_construccion_comercial_m2: ['AVALUO', 'PREDIAL', 'ANTECEDENTE'],
  valor_catastral: ['PREDIAL'], valor_avaluo: ['AVALUO', 'PREAVALUO'],
};

/** Allows line-wrap differences from the PDF renderer, not paraphrases or
 * changes in case, punctuation, spelling or figures. */
export function locateLiteralPropertyDescription(nativeText: string, proposed: string) {
  const pattern = proposed.trim().split(/\s+/).filter(Boolean).map(token => token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('\\s+');
  if (!pattern || pattern.length > 40_000) return null;
  return nativeText.match(new RegExp(pattern, 'u'))?.[0] || null;
}

const identifier = (value: string) => normalizeDocumentText(value).replace(/\s/g, '');

export const PROPERTY_ANCHORS = ['folio_real', 'clave_catastral', 'cuenta_predial'] as const;
type PropertyAnchorKey = typeof PROPERTY_ANCHORS[number];
export type PropertyTarget = Partial<Record<PropertyAnchorKey, string>>;
export type PropertyScopeReading = { alcance?: string; campo?: string; valor?: string; pagina?: number; fragmento?: string; paginas_unidad?: number[] };

export function propertyTargetFrom(record: Record<string, unknown> = {}): PropertyTarget {
  return Object.fromEntries(PROPERTY_ANCHORS.flatMap(key => {
    const raw = record[key];
    return typeof raw === 'string' && raw.length <= 180 && identifier(raw).length >= 3 ? [[key, raw.trim()]] : [];
  }));
}

/** More than one unit cannot be narrowed down by the AI's guess, a nickname,
 * or a number that merely appears inside a longer folio. */
export function propertyScopePages(scope: PropertyScopeReading | undefined, target: PropertyTarget, requiresAnchor: boolean, totalPages?: number) {
  if (scope?.alcance === 'INDETERMINADO') return { safe: false, allowedPages: undefined };
  if (!requiresAnchor && scope?.alcance !== 'MULTIPLE') return { safe: true, allowedPages: undefined };
  const campo = scope?.campo as PropertyAnchorKey | undefined;
  const targetValue = campo && PROPERTY_ANCHORS.includes(campo) ? target[campo] : undefined;
  if (!scope || !campo || !targetValue || typeof scope.valor !== 'string' || identifier(scope.valor) !== identifier(targetValue) || !scope.fragmento) return { safe: false, allowedPages: undefined };
  const label = { folio_real: 'FOLIO REAL(?: ELECTRONICO)?', clave_catastral: 'CLAVE CATASTRAL', cuenta_predial: 'CUENTA PREDIAL' }[campo];
  const token = identifier(targetValue).split('').join(' *');
  if (!new RegExp(`\\b${label} (?:NUMERO |NO )?${token}(?![A-Z0-9])`).test(normalizeDocumentText(scope.fragmento))) return { safe: false, allowedPages: undefined };
  const safePage = (page: unknown): page is number => typeof page === 'number' && Number.isSafeInteger(page) && page >= 1 && (!totalPages || page <= totalPages);
  if (!safePage(scope.pagina) || !Array.isArray(scope.paginas_unidad)) return { safe: false, allowedPages: undefined };
  const allowedPages = new Set(scope.paginas_unidad.filter(safePage));
  if (allowedPages.size > 40 || !allowedPages.has(scope.pagina)) return { safe: false, allowedPages: undefined };
  return { safe: true, allowedPages };
}

export function propertyIdentityMismatch(a: Record<string, unknown>, b: Record<string, unknown>) {
  return ['clave_catastral', 'cuenta_predial', 'folio_real'].some(key => typeof a[key] === 'string' && typeof b[key] === 'string' && identifier(a[key] as string) !== identifier(b[key] as string));
}

export function orderPropertyCandidates<T extends { campo: string; valor: string; tipo: PropertyDocumentKind; confianza: string; principal: boolean }>(campo: string, candidates: T[], numericKey?: (value: string) => string) {
  const rules = propertyDocumentRules[campo] || [];
  const ordered = candidates.filter(item => item.campo === campo && rules.includes(item.tipo) && item.confianza !== 'LECTURA_DEFICIENTE' && !isAbsentDocumentValue(item.valor)).sort((a, b) => rules.indexOf(a.tipo) - rules.indexOf(b.tipo) || Number(b.principal) - Number(a.principal));
  let key = (value: string) => normalizeDocumentText(value);
  if (numericKey && /^(?:superficie_|valor_)/.test(campo)) key = numericKey;
  if (campo === 'colindancias') key = value => value;
  if (['clave_catastral', 'cuenta_predial', 'folio_real'].includes(campo)) key = identifier;
  const selected = ordered[0];
  const conflict = selected && ordered.some(candidate => key(candidate.valor) !== key(selected.valor));
  const unresolved = conflict && ordered.some(candidate => candidate.tipo === selected.tipo && candidate.principal === selected.principal && key(candidate.valor) !== key(selected.valor));
  return { ordered, selected, conflict: Boolean(conflict), unresolved: Boolean(unresolved) };
}
