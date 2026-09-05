import { describe, expect, it } from 'vitest';
import {
  H6_AVI_STATES,
  buildFirPreflight,
  canonicalDatabaseFingerprint,
  canonicalJson,
  deriveAviState,
  packageKind,
  isSignatureRelevantArtifact,
  selectCanonicalDeed,
  selectOfficialRevision,
  semanticHash,
  serializeCanonicalScope,
  stableObligationIdentity,
  sourceManifestMatches,
  validatePresentationLineage,
} from './complianceH6';

const ids = {
  org: '00000000-0000-4000-8000-000000000001',
  exp: '00000000-0000-4000-8000-000000000002',
  a: '00000000-0000-4000-8000-000000000003',
  b: '00000000-0000-4000-8000-000000000004',
};

describe('H6 canonical domain', () => {
  it('serializa y hashea objetos sin depender del orden de propiedades', () => {
    expect(canonicalJson({ b: 2, a: 1 })).toBe(canonicalJson({ a: 1, b: 2 }));
    expect(semanticHash({ b: 2, a: 1 })).toBe(semanticHash({ a: 1, b: 2 }));
  });

  it('serializa los cuatro scopes cerrados, normaliza orden y deduplica ACT_SET', () => {
    expect(serializeCanonicalScope('EXPEDIENTE', { expediente_id: ids.exp })).toBe(`EXPEDIENTE:${ids.exp}`);
    expect(serializeCanonicalScope('ACT_SET', { expediente_acto_ids: [ids.b, ids.a, ids.b] })).toBe(`ACT_SET:${ids.a},${ids.b}`);
    expect(serializeCanonicalScope('SUBJECT', { compareciente_id: ids.a })).toBe(`SUBJECT:${ids.a}`);
    expect(serializeCanonicalScope('INSTRUMENT', { instrument_id: ids.b })).toBe(`INSTRUMENT:${ids.b}`);
    expect(() => serializeCanonicalScope('ACT_SET', { expediente_acto_ids: ['texto-libre'] })).toThrowError(/identificadores/);
  });

  it('construye identidad estable sin review, revisión, fecha ni label', () => {
    const identity = stableObligationIdentity({ organizationId: ids.org, expedienteId: ids.exp, legalObligationKey: 'SYNTHETIC-LEGAL-KEY', channelCode: 'SYNTHETIC', obligationTypeCode: 'NOTICE', scopeKind: 'ACT_SET', scopeKey: serializeCanonicalScope('ACT_SET', { expediente_acto_ids: [ids.a] }) });
    expect(identity.stable_identity_hash).toHaveLength(64);
    expect(JSON.stringify(identity)).not.toMatch(/review|revision|fecha|label/i);
  });

  it('mantiene exactamente los ocho estados AVI y todas sus transiciones derivadas', () => {
    expect(H6_AVI_STATES).toEqual(['NO_APLICA', 'PENDIENTE', 'INFORMACION_INCOMPLETA', 'VALIDADO', 'LISTO_PARA_PRESENTAR', 'PRESENTADO', 'ACUSE_CARGADO', 'CUMPLIDO']);
    const base = { applicable: true, completeInformation: true, ficheValidated: false, productCurrent: false, presentationCount: 0, acknowledgementCount: 0, acknowledgementValidated: false };
    expect(deriveAviState({ ...base, applicable: false })).toBe('NO_APLICA');
    expect(deriveAviState({ ...base, completeInformation: false })).toBe('INFORMACION_INCOMPLETA');
    expect(deriveAviState(base)).toBe('PENDIENTE');
    expect(deriveAviState({ ...base, ficheValidated: true })).toBe('VALIDADO');
    expect(deriveAviState({ ...base, ficheValidated: true, productCurrent: true })).toBe('LISTO_PARA_PRESENTAR');
    expect(deriveAviState({ ...base, presentationCount: 1 })).toBe('PRESENTADO');
    expect(deriveAviState({ ...base, presentationCount: 1, acknowledgementCount: 1 })).toBe('ACUSE_CARGADO');
    expect(deriveAviState({ ...base, presentationCount: 1, acknowledgementCount: 1, acknowledgementValidated: true })).toBe('CUMPLIDO');
  });

  it('selecciona definición oficial por identidad, vigencia, base y adapter; falla 0/N', () => {
    const candidate = { id: ids.a, definition_id: ids.b, stable_definition_key: 'SYNTHETIC', channel_code: 'SYNTHETIC', product_type: 'NOTICE', effective_date_basis: 'LEGAL_DATE' as const, effective_from: new Date('2026-01-01'), effective_to: null, status: 'VERIFIED', active: true, layout_key: 'synthetic-layout', adapter_version: 'test-v1' };
    const input = { stableDefinitionKey: 'SYNTHETIC', channelCode: 'SYNTHETIC', productType: 'NOTICE', effectiveDate: new Date('2026-09-05'), effectiveDateBasis: 'LEGAL_DATE' as const, hasAdapter: () => true };
    expect(selectOfficialRevision([], input).status).toBe('NOT_CONFIGURED');
    expect(selectOfficialRevision([candidate], input)).toMatchObject({ status: 'PINNED', revision: candidate });
    expect(selectOfficialRevision([candidate, { ...candidate, id: ids.b }], input).status).toBe('CONFIGURATION_CONFLICT');
    expect(selectOfficialRevision([candidate], { ...input, effectiveDateBasis: 'GENERATION_DATE' }).status).toBe('NOT_CONFIGURED');
    expect(selectOfficialRevision([candidate], { ...input, hasAdapter: () => false }).status).toBe('NOT_CONFIGURED');
  });

  it('preflight sólo incluye PRE_FIRMA, es determinista y cambia con versión o faltantes', () => {
    const requirements = [{ id: ids.a, phase: 'PRE_FIRMA', status: 'PENDIENTE', label: 'Documento previo', missing_action: 'GO_TO_COMPLIANCE' }, { id: ids.b, phase: 'POST_FIRMA', status: 'PENDIENTE', label: 'Aviso posterior' }];
    const first = buildFirPreflight({ expedienteId: ids.exp, version: 2, requirements, artifacts: [] });
    expect(first).toMatchObject({ ready: false, count: 1, ready_label: 'Preparación pendiente' });
    expect(first.missing[0]).toMatchObject({ id: ids.a, source: 'COMPLIANCE' });
    expect(first.hash).not.toBe(buildFirPreflight({ expedienteId: ids.exp, version: 3, requirements, artifacts: [] }).hash);
    expect(buildFirPreflight({ expedienteId: ids.exp, version: 2, requirements: [{ ...requirements[0], status: 'VALIDADO' }], artifacts: [] })).toMatchObject({ ready: true, count: 0, ready_label: 'Listo para firma' });
  });

  it('ancla el hash FIR a estados, revisiones, evidencia, producto EXP-006 y snapshot, no a labels', () => {
    const requirement = { id: ids.a, requirement_key: 'REQ-A', phase: 'PRE_FIRMA', trigger: 'CURRENT_FACTS', status: 'PENDIENTE', label: 'Etiqueta uno', source_snapshot: { revision: 2, fingerprint: 'rule-a' } };
    const artifact = { id: ids.b, identity_key: 'ART-A', en_alcance: true, obligatoria: true, estado: 'VALIDADO', artefacto_version_id: ids.a, source_revision: 'source-a', current_document_id: ids.b, currentDocument: { checksum_sha256: 'doc-a' }, artefacto: { purpose: 'FIR_SIGNATURE_RELEVANT' } };
    const base = { organizationId: ids.org, expedienteId: ids.exp, version: 2, effectiveDate: '2026-09-05', target: { kind: 'EXPEDIENTE', id: ids.exp }, requirements: [requirement], artifacts: [artifact], evidence: [{ id: ids.a, requirement_id: ids.a, documento_id: ids.b, document_version: '1', document_checksum_snapshot: 'evidence-a', validation_status: 'VALIDATED', document_state: 'CURRENT' }], documentSnapshot: { id: ids.b, version: 2 } };
    const first = buildFirPreflight(base);
    expect(buildFirPreflight({ ...base, requirements: [{ ...requirement, label: 'Etiqueta visual distinta' }] }).hash).toBe(first.hash);
    expect(buildFirPreflight({ ...base, artifacts: [{ ...artifact, currentDocument: { checksum_sha256: 'doc-b' } }] }).hash).not.toBe(first.hash);
    expect(buildFirPreflight({ ...base, artifacts: [{ ...artifact, current_document_id: ids.a }] }).hash).not.toBe(first.hash);
    expect(buildFirPreflight({ ...base, artifacts: [{ ...artifact, source_revision: 'source-b' }] }).hash).not.toBe(first.hash);
    expect(buildFirPreflight({ ...base, evidence: [{ ...base.evidence[0], validation_status: 'PENDING' }] }).hash).not.toBe(first.hash);
    expect(buildFirPreflight({ ...base, evidence: [{ ...base.evidence[0], documento_id: ids.a }] }).hash).not.toBe(first.hash);
    expect(buildFirPreflight({ ...base, evidence: [{ ...base.evidence[0], document_checksum_snapshot: 'evidence-b' }] }).hash).not.toBe(first.hash);
    expect(buildFirPreflight({ ...base, documentSnapshot: { id: ids.b, version: 3 } }).hash).not.toBe(first.hash);
    expect(buildFirPreflight({ ...base, requirements: [{ ...requirement, updated_at: new Date('2030-01-01') }], artifacts: [{ ...artifact, updated_at: new Date('2030-01-01') }] }).hash).toBe(first.hash);
  });

  it('clasifica formatos firmables desde la autoridad EXP-006 y excluye formatos generales', () => {
    const base = { en_alcance: true, obligatoria: true, artefacto: { purpose: 'FIR_SIGNATURE_RELEVANT' } };
    expect(isSignatureRelevantArtifact(base)).toBe(true);
    expect(isSignatureRelevantArtifact({ ...base, artefacto: { purpose: null } })).toBe(false);
    expect(isSignatureRelevantArtifact({ ...base, en_alcance: false })).toBe(false);
    expect(isSignatureRelevantArtifact({ ...base, obligatoria: false })).toBe(false);
    expect(isSignatureRelevantArtifact({ ...base, artefacto: { purpose: 'CUE_GENERAL' } })).toBe(false);
  });

  it('prioriza escritura definitiva y falla ante ambigüedad sin escoger por orden técnico', () => {
    const draft = { id: ids.a, document_role: 'PROJECT_DRAFT' as const };
    const definitive = { id: ids.b, document_role: 'DEFINITIVE_DEED' as const };
    expect(selectCanonicalDeed([draft])).toBe(draft);
    expect(selectCanonicalDeed([draft, definitive])).toBe(definitive);
    expect(() => selectCanonicalDeed([definitive, { ...definitive, id: ids.a }])).toThrowError(/más de una escritura definitiva/i);
    expect(() => selectCanonicalDeed([draft, { ...draft, id: ids.b }])).toThrowError(/más de un proyecto/i);
  });

  it('aplica invalidación exacta por stableId y conserva semántica type-wide', () => {
    expect(sourceManifestMatches({ type: 'PREDIO', stable_id: ids.a }, 'predio')).toBe(true);
    expect(sourceManifestMatches({ type: 'PREDIO', stable_id: ids.a }, 'PREDIO', ids.a)).toBe(true);
    expect(sourceManifestMatches({ type: 'PREDIO', stable_id: null }, 'PREDIO', ids.a)).toBe(false);
    expect(sourceManifestMatches({ type: 'PREDIO', stable_id: ids.b }, 'PREDIO', ids.a)).toBe(false);
  });

  it('preserva linaje opcional y prohíbe previous en NORMAL o autorreferencia', () => {
    expect(() => validatePresentationLineage({ kind: 'NORMAL' })).not.toThrow();
    expect(() => validatePresentationLineage({ kind: 'COMPLEMENTARIA' })).not.toThrow();
    expect(() => validatePresentationLineage({ kind: 'CORRECCION', previousPresentationId: ids.a })).not.toThrow();
    expect(() => validatePresentationLineage({ kind: 'NORMAL', previousPresentationId: ids.a })).toThrowError(/normal/i);
    expect(() => validatePresentationLineage({ kind: 'CORRECCION', presentationId: ids.a, previousPresentationId: ids.a })).toThrowError(/sí misma/i);
  });

  it('genera fingerprint DB lógico reproducible sin depender del orden físico', () => {
    expect(canonicalDatabaseFingerprint({ b: [{ z: 2, a: 1 }], a: [{ id: 'x' }, { id: 'y' }] })).toBe(canonicalDatabaseFingerprint({ a: [{ id: 'y' }, { id: 'x' }], b: [{ a: 1, z: 2 }] }));
  });

  it('elige PDF sólo para un conjunto no vacío completamente PDF y ZIP en mezcla', () => {
    expect(packageKind([{ mime_type: 'application/pdf' }, { mime_type: 'application/pdf' }])).toBe('PDF');
    expect(packageKind([{ mime_type: 'application/pdf' }, { mime_type: 'image/png' }])).toBe('ZIP');
    expect(() => packageKind([])).toThrowError(/No hay documentos/);
  });
});
