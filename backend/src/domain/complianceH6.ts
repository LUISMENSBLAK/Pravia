import { createHash } from 'node:crypto';

export const H6_AVI_STATES = [
  'NO_APLICA',
  'PENDIENTE',
  'INFORMACION_INCOMPLETA',
  'VALIDADO',
  'LISTO_PARA_PRESENTAR',
  'PRESENTADO',
  'ACUSE_CARGADO',
  'CUMPLIDO',
] as const;

export type H6AviState = (typeof H6_AVI_STATES)[number];
export type H6ScopeKind = 'EXPEDIENTE' | 'ACT_SET' | 'SUBJECT' | 'INSTRUMENT';

export class ComplianceH6Error extends Error {
  constructor(readonly code: string, message: string, readonly status = 409, readonly detail?: unknown) {
    super(message);
  }
}

export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

export const semanticHash = (value: unknown) => createHash('sha256').update(canonicalJson(value)).digest('hex');

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function canonicalIds(value: unknown): string[] {
  if (!Array.isArray(value) || value.some((id) => typeof id !== 'string' || !UUID.test(id))) {
    throw new ComplianceH6Error('H6_SCOPE_IDS_INVALID', 'El alcance jurídico contiene identificadores no válidos.', 400);
  }
  return [...new Set(value.map((id) => id.toLowerCase()))].sort();
}

export function serializeCanonicalScope(kind: H6ScopeKind, input: unknown): string {
  const scope = input && typeof input === 'object' ? input as Record<string, unknown> : {};
  if (kind === 'EXPEDIENTE') {
    const expedienteId = String(scope.expediente_id || '').toLowerCase();
    if (!UUID.test(expedienteId)) throw new ComplianceH6Error('H6_SCOPE_CASE_INVALID', 'El alcance de expediente no es válido.', 400);
    return `EXPEDIENTE:${expedienteId}`;
  }
  if (kind === 'ACT_SET') {
    const ids = canonicalIds(scope.expediente_acto_ids);
    if (!ids.length) throw new ComplianceH6Error('H6_SCOPE_ACT_SET_EMPTY', 'El alcance por actos no puede estar vacío.', 400);
    return `ACT_SET:${ids.join(',')}`;
  }
  if (kind === 'SUBJECT') {
    const id = String(scope.compareciente_id || '').toLowerCase();
    if (!UUID.test(id)) throw new ComplianceH6Error('H6_SCOPE_SUBJECT_INVALID', 'El alcance por compareciente no es válido.', 400);
    return `SUBJECT:${id}`;
  }
  const instrumentId = String(scope.instrument_id || '').toLowerCase();
  if (!UUID.test(instrumentId)) throw new ComplianceH6Error('H6_SCOPE_INSTRUMENT_INVALID', 'El alcance por instrumento no es válido.', 400);
  return `INSTRUMENT:${instrumentId}`;
}

export function stableObligationIdentity(input: {
  organizationId: string;
  expedienteId: string;
  legalObligationKey: string;
  channelCode: string;
  obligationTypeCode: string;
  scopeKind: H6ScopeKind;
  scopeKey: string;
}) {
  for (const [key, value] of Object.entries(input)) {
    if (!String(value || '').trim()) throw new ComplianceH6Error('H6_OBLIGATION_IDENTITY_INCOMPLETE', `Falta ${key} en la identidad estable.`, 400);
  }
  const normalized = {
    organization_id: input.organizationId.toLowerCase(),
    expediente_id: input.expedienteId.toLowerCase(),
    legal_obligation_key: input.legalObligationKey.trim(),
    channel_code: input.channelCode.trim(),
    obligation_type_code: input.obligationTypeCode.trim(),
    canonical_scope_kind: input.scopeKind,
    canonical_scope_key: input.scopeKey,
  };
  return { ...normalized, stable_identity_hash: semanticHash(normalized) };
}

export function deriveAviState(input: {
  applicable: boolean;
  completeInformation: boolean;
  ficheValidated: boolean;
  productCurrent: boolean;
  presentationCount: number;
  acknowledgementCount: number;
  acknowledgementValidated: boolean;
}): H6AviState {
  if (!input.applicable) return 'NO_APLICA';
  if (!input.completeInformation) return 'INFORMACION_INCOMPLETA';
  if (input.presentationCount > 0 && input.acknowledgementCount > 0 && input.acknowledgementValidated) return 'CUMPLIDO';
  if (input.presentationCount > 0 && input.acknowledgementCount > 0) return 'ACUSE_CARGADO';
  if (input.presentationCount > 0) return 'PRESENTADO';
  if (input.ficheValidated && input.productCurrent) return 'LISTO_PARA_PRESENTAR';
  if (input.ficheValidated) return 'VALIDADO';
  return 'PENDIENTE';
}

export type OfficialRevisionCandidate = {
  id: string;
  definition_id: string;
  stable_definition_key: string;
  channel_code: string;
  product_type: string;
  effective_date_basis: 'LEGAL_DATE' | 'GENERATION_DATE' | 'PRESENTATION_DATE';
  effective_from: Date | null;
  effective_to: Date | null;
  status: string;
  active: boolean;
  layout_key: string;
  adapter_version: string;
};

export function selectOfficialRevision(candidates: OfficialRevisionCandidate[], input: {
  stableDefinitionKey: string;
  channelCode: string;
  productType: string;
  effectiveDate: Date;
  effectiveDateBasis: OfficialRevisionCandidate['effective_date_basis'];
  hasAdapter(candidate: OfficialRevisionCandidate): boolean;
}) {
  const matches = candidates.filter((candidate) => candidate.active && candidate.status === 'VERIFIED'
    && candidate.stable_definition_key === input.stableDefinitionKey
    && candidate.channel_code === input.channelCode
    && candidate.product_type === input.productType
    && candidate.effective_date_basis === input.effectiveDateBasis
    && (!candidate.effective_from || candidate.effective_from.getTime() <= input.effectiveDate.getTime())
    && (!candidate.effective_to || candidate.effective_to.getTime() >= input.effectiveDate.getTime())
    && input.hasAdapter(candidate));
  if (matches.length === 0) return { status: 'NOT_CONFIGURED' as const, revision: null };
  if (matches.length > 1) return { status: 'CONFIGURATION_CONFLICT' as const, revision: null };
  return { status: 'PINNED' as const, revision: matches[0] };
}

export type FirMissingItem = { id: string; label: string; source: 'COMPLIANCE' | 'EXP006'; action: string; status: string };

export function isSignatureRelevantArtifact(item: any) {
  return Boolean(item?.en_alcance)
    && Boolean(item?.obligatoria)
    && item?.artefacto?.purpose === 'FIR_SIGNATURE_RELEVANT';
}

const normalizedDate = (value: unknown) => {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
};

export function buildFirPreflight(input: {
  organizationId?: string;
  expedienteId: string;
  version: number;
  effectiveDate?: Date | string | null;
  target?: unknown;
  requirements: any[];
  artifacts: any[];
  evidence?: any[];
  documentSnapshot?: { id: string; version?: number | null } | null;
}) {
  const satisfied = new Set(['LISTO', 'CUMPLIDO', 'NO_APLICA', 'VALIDADO']);
  const compliance: FirMissingItem[] = input.requirements
    .filter((item) => item.phase === 'PRE_FIRMA' && !satisfied.has(String(item.status)))
    .map((item) => ({ id: item.id, label: item.label, source: 'COMPLIANCE', action: item.missing_action || 'GO_TO_NOTICE', status: item.status }));
  const artifacts: FirMissingItem[] = input.artifacts
    .filter((item) => isSignatureRelevantArtifact(item) && item.estado !== 'VALIDADO')
    .map((item) => ({ id: item.id, label: String(item.label || 'Formato pendiente'), source: 'EXP006', action: 'GENERATE_OR_VALIDATE', status: item.estado }));
  const missing = [...compliance, ...artifacts].sort((left, right) => `${left.source}:${left.id}`.localeCompare(`${right.source}:${right.id}`));
  const semantic = {
    organization_id: input.organizationId?.toLowerCase() || null,
    expediente_id: input.expedienteId.toLowerCase(),
    expediente_version: input.version,
    effective_date: normalizedDate(input.effectiveDate),
    target: input.target ?? null,
    requirements: input.requirements
      .filter((item) => item.phase === 'PRE_FIRMA')
      .map((item) => ({
        identity: item.requirement_key || item.id,
        phase: item.phase,
        trigger: item.trigger,
        state: item.status,
        revision: item.source_snapshot?.revision ?? item.source_snapshot?.rule_revision_id ?? null,
        fingerprint: item.source_snapshot?.fingerprint ?? item.source_snapshot?.checksum ?? null,
      }))
      .sort((left, right) => String(left.identity).localeCompare(String(right.identity))),
    artifacts: input.artifacts.filter(isSignatureRelevantArtifact).map((item) => ({
      identity: item.identity_key || item.id,
      master_version_id: item.artefacto_version_id,
      source_revision: item.source_revision,
      state: item.estado,
      current_document_id: item.current_document_id || null,
      current_document_checksum: item.currentDocument?.checksum_sha256 || null,
    })).sort((left, right) => String(left.identity).localeCompare(String(right.identity))),
    evidence: (input.evidence || []).map((item) => ({
      id: item.id,
      requirement_id: item.requirement_id,
      document_id: item.documento_id,
      document_version: item.document_version,
      checksum: item.document_checksum_snapshot,
      validation_status: item.validation_status,
      state: item.document_state,
    })).sort((left, right) => String(left.id).localeCompare(String(right.id))),
    document_snapshot: input.documentSnapshot ? { id: input.documentSnapshot.id, version: input.documentSnapshot.version ?? null } : null,
    missing: missing.map(({ label: _label, ...item }) => item),
  };
  return { ready: missing.length === 0, ready_label: missing.length === 0 ? 'Listo para firma' : 'Preparación pendiente', missing, count: missing.length, hash: semanticHash(semantic) };
}

export function selectCanonicalDeed<T extends { id: string; document_role: 'DEFINITIVE_DEED' | 'PROJECT_DRAFT' | null }>(documents: T[]): T {
  const definitive = documents.filter((item) => item.document_role === 'DEFINITIVE_DEED');
  if (definitive.length > 1) throw new ComplianceH6Error('H6_DEFINITIVE_DEED_AMBIGUOUS', 'Existe más de una escritura definitiva activa; requiere revisión.', 409);
  if (definitive.length === 1) return definitive[0];
  const drafts = documents.filter((item) => item.document_role === 'PROJECT_DRAFT');
  if (drafts.length > 1) throw new ComplianceH6Error('H6_PROJECT_DRAFT_AMBIGUOUS', 'Existe más de un proyecto de escritura activo; requiere revisión.', 409);
  if (drafts.length === 1) return drafts[0];
  throw new ComplianceH6Error('H6_CANONICAL_DEED_NOT_FOUND', 'No existe una escritura o proyecto canónico activo para integrar el paquete.', 409);
}

export function validatePresentationLineage(input: { kind: string; presentationId?: string | null; previousPresentationId?: string | null }) {
  if (input.kind === 'NORMAL' && input.previousPresentationId) throw new ComplianceH6Error('H6_NORMAL_PRESENTATION_HAS_PREVIOUS', 'Una presentación normal no puede referir una presentación anterior.', 409);
  if (input.presentationId && input.previousPresentationId === input.presentationId) throw new ComplianceH6Error('H6_PRESENTATION_SELF_REFERENCE', 'Una presentación no puede referirse a sí misma.', 409);
}

export function sourceManifestMatches(entry: { type?: unknown; stable_id?: unknown }, sourceType: string, stableId?: string | null) {
  if (String(entry.type || '').toUpperCase() !== sourceType.toUpperCase()) return false;
  return stableId == null || String(entry.stable_id || '') === stableId;
}

export const H6_DB_FINGERPRINT_ALGORITHM = 'h6-schema-logical-v1';

export function canonicalDatabaseFingerprint(sections: Record<string, unknown[]>) {
  const normalized = Object.fromEntries(Object.entries(sections).sort(([left], [right]) => left.localeCompare(right)).map(([name, rows]) => [
    name,
    rows.map((row) => canonicalJson(row)).sort(),
  ]));
  return semanticHash({ algorithm: H6_DB_FINGERPRINT_ALGORITHM, sections: normalized });
}

export function packageKind(documents: Array<{ mime_type: string }>) {
  if (!documents.length) throw new ComplianceH6Error('H6_SIGNATURE_PACKAGE_EMPTY', 'No hay documentos vigentes para integrar el paquete de firma.', 409);
  return documents.every((item) => item.mime_type === 'application/pdf') ? 'PDF' as const : 'ZIP' as const;
}

export function relevantSourceFingerprint(input: {
  legalSource: unknown;
  officialRevision: { id: string; checksum: string };
  validatedFiche: { id: string; source_fingerprint: string };
  localValues: unknown;
  sourceManifest: unknown[];
}) {
  return semanticHash(input);
}
