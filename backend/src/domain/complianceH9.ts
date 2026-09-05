import { createHash } from 'node:crypto';

export const H9_PROMPT_VERSION = 'CUM-AUD-001-v1';
export const H9_SCHEMA_VERSION = 'cum-aud-result-v1';
export const H9_NO_INCONSISTENCIES_MESSAGE = 'No se detectaron inconsistencias en las verificaciones realizadas';

export const H9_BLOCKS = [
  'IDENTIFICACION_COMPARECIENTES', 'SCREENING', 'CUESTIONARIOS_RIESGO',
  'BENEFICIARIO_CONTROLADOR', 'PAGOS', 'DOCUMENTAL', 'AVISOS_DECLARACIONES',
  'PROYECTO_ESCRITURA',
] as const;

export type H9Block = typeof H9_BLOCKS[number];
export type H9CheckStatus = 'CORRECT' | 'OBSERVATION' | 'CRITICAL';

export type H9SourceManifestEntry = {
  source_type: string;
  entity_id: string;
  revision_id: string | null;
  checksum: string;
  document_id: string | null;
  path: string;
  purpose: string[];
};

export type H9Finding = {
  check_key: string;
  category: string;
  status: H9CheckStatus;
  message: string;
  source_refs: string[];
  affected_block: H9Block;
  action_target: string;
  confidence: 'HIGH' | 'MEDIUM' | 'LOW';
  provenance: string;
};

export type H9StructuredResult = {
  verification_checks: H9Finding[];
  correct_count: number;
  observations: H9Finding[];
  critical_inconsistencies: H9Finding[];
};

export function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => [key, canonicalize(item)]));
  }
  return value;
}

export function h9Hash(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(canonicalize(value))).digest('hex');
}

export function normalizeManifest(entries: H9SourceManifestEntry[]): H9SourceManifestEntry[] {
  return entries.map((entry) => ({
    ...entry,
    purpose: [...new Set(entry.purpose)].sort(),
  })).sort((left, right) => `${left.source_type}:${left.entity_id}:${left.path}`.localeCompare(`${right.source_type}:${right.entity_id}:${right.path}`));
}

export function manifestFingerprint(entries: H9SourceManifestEntry[]): string {
  return h9Hash(normalizeManifest(entries));
}

export function compareManifests(stored: H9SourceManifestEntry[], current: H9SourceManifestEntry[]) {
  const key = (entry: H9SourceManifestEntry) => `${entry.source_type}:${entry.entity_id}:${entry.path}`;
  const oldMap = new Map(normalizeManifest(stored).map((entry) => [key(entry), entry]));
  const newMap = new Map(normalizeManifest(current).map((entry) => [key(entry), entry]));
  const changes: Array<{ source_ref: string; change: 'ADDED' | 'REMOVED' | 'CHANGED'; detail: string }> = [];
  for (const [sourceRef, entry] of oldMap) {
    const next = newMap.get(sourceRef);
    if (!next) changes.push({ source_ref: sourceRef, change: 'REMOVED', detail: `${entry.source_type} ya no forma parte de las fuentes actuales.` });
    else if (h9Hash(entry) !== h9Hash(next)) changes.push({ source_ref: sourceRef, change: 'CHANGED', detail: `${entry.source_type} cambió de versión o contenido normalizado.` });
  }
  for (const [sourceRef, entry] of newMap) if (!oldMap.has(sourceRef)) {
    changes.push({ source_ref: sourceRef, change: 'ADDED', detail: `Se incorporó una fuente actual de tipo ${entry.source_type}.` });
  }
  return { stale: changes.length > 0, changes };
}

const allowedFindingKeys = new Set(['check_key', 'category', 'status', 'message', 'source_refs', 'affected_block', 'action_target', 'confidence', 'provenance']);
const forbiddenResultKeys = /score|porcentaje|legalidad|firma_(?:valida|autentica)|beneficiario_controlador_determinado/i;

function validateFinding(value: unknown, expected: H9CheckStatus): H9Finding {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('H9_AI_FINDING_INVALID');
  const item = value as Record<string, unknown>;
  if (Object.keys(item).some((key) => !allowedFindingKeys.has(key))) throw new Error('H9_AI_OUTPUT_NOT_CLOSED');
  if (item.status !== expected) throw new Error('H9_AI_FINDING_STATUS_INVALID');
  if (!String(item.check_key || '').trim() || !String(item.category || '').trim() || !String(item.message || '').trim()) throw new Error('H9_AI_FINDING_REQUIRED_FIELD');
  if (!Array.isArray(item.source_refs) || !item.source_refs.every((entry) => typeof entry === 'string')) throw new Error('H9_AI_SOURCE_REFS_INVALID');
  if (!H9_BLOCKS.includes(item.affected_block as H9Block)) throw new Error('H9_AI_BLOCK_INVALID');
  if (!String(item.action_target || '').startsWith('#')) throw new Error('H9_AI_ACTION_TARGET_INVALID');
  if (!['HIGH', 'MEDIUM', 'LOW'].includes(String(item.confidence))) throw new Error('H9_AI_CONFIDENCE_INVALID');
  return item as H9Finding;
}

export function validateH9Result(value: unknown, allowedSourceRefs: Set<string>): H9StructuredResult {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('H9_AI_OUTPUT_INVALID');
  const raw = value as Record<string, unknown>;
  const keys = Object.keys(raw);
  if (keys.some((key) => forbiddenResultKeys.test(key)) || keys.some((key) => !['verification_checks', 'correct_count', 'observations', 'critical_inconsistencies'].includes(key))) throw new Error('H9_AI_OUTPUT_NOT_CLOSED');
  if (!Array.isArray(raw.verification_checks) || !Array.isArray(raw.observations) || !Array.isArray(raw.critical_inconsistencies)) throw new Error('H9_AI_OUTPUT_ARRAYS_REQUIRED');
  const checks = raw.verification_checks.map((item) => validateFinding(item, 'CORRECT'));
  const observations = raw.observations.map((item) => validateFinding(item, 'OBSERVATION'));
  const critical = raw.critical_inconsistencies.map((item) => validateFinding(item, 'CRITICAL'));
  const all = [...checks, ...observations, ...critical];
  if (new Set(all.map((item) => item.check_key)).size !== all.length) throw new Error('H9_AI_CHECK_KEY_DUPLICATED');
  if (all.some((item) => item.source_refs.some((ref) => !allowedSourceRefs.has(ref)))) throw new Error('H9_AI_SOURCE_REF_NOT_AUTHORIZED');
  if (!Number.isInteger(raw.correct_count) || raw.correct_count !== checks.length) throw new Error('H9_AI_CORRECT_COUNT_INVALID');
  return { verification_checks: checks, correct_count: checks.length, observations, critical_inconsistencies: critical };
}

export function h9Readiness(input: { expediente: boolean; reviewId: string | null; manifest: H9SourceManifestEntry[]; datasetError?: string | null }) {
  const causes: string[] = [];
  if (!input.expediente) causes.push('El expediente no está disponible dentro de tu ámbito.');
  if (!input.reviewId) causes.push('Ejecuta primero la evaluación canónica de Cumplimiento.');
  if (!input.manifest.length) causes.push('Agrega al menos una fuente actual de Cumplimiento que pueda revisarse.');
  if (input.datasetError) causes.push('No fue posible construir el conjunto de fuentes: inténtalo nuevamente.');
  return { status: causes.length ? 'NOT_READY' as const : 'READY' as const, causes };
}
