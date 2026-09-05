import { describe, expect, it } from 'vitest';
import { compareManifests, h9Readiness, manifestFingerprint, validateH9Result, type H9SourceManifestEntry } from './complianceH9';

const source = (checksum = 'a'): H9SourceManifestEntry => ({ source_type: 'COMPLIANCE_EVIDENCE', entity_id: 'e-1', revision_id: 'v1', checksum, document_id: 'd-1', path: 'evidence.current-document', purpose: ['DOCUMENTAL'] });
const finding = (status: 'CORRECT' | 'OBSERVATION' | 'CRITICAL') => ({ check_key: `CHECK_${status}`, category: 'DOCUMENTAL', status, message: 'Comparación factual', source_refs: ['COMPLIANCE_EVIDENCE:e-1:evidence.current-document'], affected_block: 'DOCUMENTAL', action_target: '#documentos', confidence: 'HIGH', provenance: 'source manifest' });

describe('H9 CUM-AUD deterministic contract', () => {
  it('builds a semantic, stable manifest fingerprint independent from input ordering', () => {
    const other = { ...source('b'), entity_id: 'e-2' };
    expect(manifestFingerprint([source(), other])).toBe(manifestFingerprint([other, source()]));
  });
  it('marks a relevant source version change stale and explains it', () => {
    const result = compareManifests([source('old')], [source('new')]);
    expect(result.stale).toBe(true); expect(result.changes[0]).toMatchObject({ change: 'CHANGED' }); expect(result.changes[0].detail).toContain('cambió');
  });
  it('does not stale when unrelated input is excluded from the consumed manifest', () => {
    expect(compareManifests([source()], [source()])).toEqual({ stale: false, changes: [] });
  });
  it('requires canonical context and at least one meaningful current source', () => {
    expect(h9Readiness({ expediente: true, reviewId: null, manifest: [] }).status).toBe('NOT_READY');
    expect(h9Readiness({ expediente: true, reviewId: 'r-1', manifest: [source()] }).status).toBe('READY');
  });
  it('accepts the closed three-category output and verifies exact correct_count', () => {
    const parsed = validateH9Result({ verification_checks: [finding('CORRECT')], correct_count: 1, observations: [finding('OBSERVATION')], critical_inconsistencies: [finding('CRITICAL')] }, new Set(['COMPLIANCE_EVIDENCE:e-1:evidence.current-document']));
    expect(parsed).toMatchObject({ correct_count: 1 }); expect(parsed.observations).toHaveLength(1); expect(parsed.critical_inconsistencies).toHaveLength(1);
  });
  it('rejects scores, unknown sources and legal-shaped additions', () => {
    expect(() => validateH9Result({ verification_checks: [], correct_count: 0, observations: [], critical_inconsistencies: [], score: 100 }, new Set())).toThrow('H9_AI_OUTPUT_NOT_CLOSED');
    expect(() => validateH9Result({ verification_checks: [{ ...finding('CORRECT'), source_refs: ['UNKNOWN:x:y'] }], correct_count: 1, observations: [], critical_inconsistencies: [] }, new Set())).toThrow('H9_AI_SOURCE_REF_NOT_AUTHORIZED');
  });
});
