import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { deriveH7Closure, H7_EXCEPTION_RESOLUTION } from './complianceH7';
import {
  buildFirPreflight, deriveAviState, selectOfficialRevision,
  serializeCanonicalScope, stableObligationIdentity,
} from './complianceH6';
import { compareManifests, validateH9Result, type H9SourceManifestEntry } from './complianceH9';

const root = path.resolve(__dirname, '..');
const read = (file: string) => fs.readFileSync(path.join(root, file), 'utf8');
const req = (provider: string, status: string, missing_action: string | null = null) => ({ id: `${provider}:${status}`, provider, status, deadline: null, missing_action });
const ids = { org: '10000000-0000-4000-8000-000000000001', exp: '10000000-0000-4000-8000-000000000002', act: '10000000-0000-4000-8000-000000000003' };
const source = (checksum: string): H9SourceManifestEntry => ({ source_type: 'COMPLIANCE_REQUIREMENT', entity_id: ids.act, revision_id: '1', checksum, document_id: null, path: 'requirements.notice', purpose: ['CURRENT_STATE'] });

describe('H10 negative integration suite', () => {
  it.each(['LST','CUE','BC','PAG','FIR','AVI','ACK'])('%s pending prevents manual or accidental completion', (provider) => {
    const requirements = ['LEGAL','LST','CUE','BC','PAG','DOC','FIR','AVI','ACK'].map((item) => req(item, item === provider ? 'PENDIENTE' : 'CUMPLIDO', item === provider ? 'RESOLVE' : null));
    expect(deriveH7Closure(requirements)).toMatchObject({ complete: false, state: 'PENDIENTE', pendingCount: 1, actionableCount: 1 });
  });

  it('generated is neither signed, presented nor complete', () => {
    const base = { applicable: true, completeInformation: true, ficheValidated: true, productCurrent: true, presentationCount: 0, acknowledgementCount: 0, acknowledgementValidated: false };
    expect(deriveAviState(base)).toBe('LISTO_PARA_PRESENTAR');
    expect(deriveAviState({ ...base, presentationCount: 1 })).toBe('PRESENTADO');
    expect(deriveAviState({ ...base, presentationCount: 1, acknowledgementCount: 1 })).toBe('ACUSE_CARGADO');
    expect(deriveAviState({ ...base, presentationCount: 1, acknowledgementCount: 1, acknowledgementValidated: true })).toBe('CUMPLIDO');
  });

  it('rejects an AI score and an unauthorized source reference', () => {
    expect(() => validateH9Result({ score: 100, verification_checks: [], correct_count: 0, observations: [], critical_inconsistencies: [] }, new Set())).toThrow(/NOT_CLOSED/);
    const finding = { check_key: 'H10', category: 'TEST', status: 'CRITICAL', message: 'Synthetic', source_refs: ['FOREIGN:1:path'], affected_block: 'DOCUMENTAL', action_target: '#cumplimiento', confidence: 'HIGH', provenance: 'SYNTHETIC' };
    expect(() => validateH9Result({ verification_checks: [], correct_count: 0, observations: [], critical_inconsistencies: [finding] }, new Set(['LOCAL:1:path']))).toThrow(/SOURCE_REF_NOT_AUTHORIZED/);
  });

  it('fails official-definition selection closed for zero or multiple matches', () => {
    const candidate = { id: 'revision-a', definition_id: 'definition-a', stable_definition_key: 'SYNTHETIC', channel_code: 'PORTAL', product_type: 'NOTICE', effective_date_basis: 'LEGAL_DATE' as const, effective_from: new Date('2026-01-01'), effective_to: null, status: 'VERIFIED', active: true, layout_key: 'synthetic', adapter_version: 'v1' };
    const input = { stableDefinitionKey: 'SYNTHETIC', channelCode: 'PORTAL', productType: 'NOTICE', effectiveDate: new Date('2026-09-05'), effectiveDateBasis: 'LEGAL_DATE' as const, hasAdapter: () => true };
    expect(selectOfficialRevision([], input).status).toBe('NOT_CONFIGURED');
    expect(selectOfficialRevision([candidate, { ...candidate, id: 'revision-b' }], input).status).toBe('CONFIGURATION_CONFLICT');
  });

  it('keeps FIR confirmation stale-safe when semantic inputs change', () => {
    const first = buildFirPreflight({ expedienteId: ids.exp, version: 1, requirements: [{ id: 'r1', phase: 'PRE_FIRMA', status: 'PENDIENTE', source_snapshot: { revision: 1 } }], artifacts: [] });
    const changed = buildFirPreflight({ expedienteId: ids.exp, version: 2, requirements: [{ id: 'r1', phase: 'PRE_FIRMA', status: 'PENDIENTE', source_snapshot: { revision: 1 } }], artifacts: [] });
    expect(first.hash).not.toBe(changed.hash);
  });

  it('keeps stable obligation identity independent of review, revision and timestamps', () => {
    const result = stableObligationIdentity({ organizationId: ids.org, expedienteId: ids.exp, legalObligationKey: 'NOTICE', channelCode: 'PORTAL', obligationTypeCode: 'AVI', scopeKind: 'ACT_SET', scopeKey: serializeCanonicalScope('ACT_SET', { expediente_acto_ids: [ids.act] }) });
    expect(JSON.stringify(result)).not.toMatch(/review|revision|timestamp|created_at/i);
  });

  it('has no H9 or route-level writer that completes deterministic compliance', () => {
    const h9 = read('services/complianceH9.service.ts');
    const routes = read('routes/compliance.routes.ts');
    ['expedienteComplianceState.update','complianceRequirement.update','complianceScreeningResult.update','complianceBcEvaluation.update','complianceObligation.update'].forEach((writer) => expect(h9).not.toContain(writer));
    expect(routes).not.toMatch(/manual[-_ ]?complete|cumplimiento[-_ ]?completo/i);
  });

  it('enforces tenant plus object scope in H8 and H9 backend authorities', () => {
    const h8 = read('services/complianceH8.service.ts');
    const h9 = read('services/complianceH9.service.ts');
    expect(h8).toContain('organizationId');
    expect(h8).toContain('accessSql(user)');
    expect(h9).toContain('organization_id: user.organizationId');
    expect(h9).toContain('expedienteAccessWhere(user)');
  });

  it('keeps critical actions idempotent through stable keys and unique constraints', () => {
    const schema = fs.readFileSync(path.resolve(root, '../prisma/schema.prisma'), 'utf8');
    ['h7_compliance_exception_idempotency_key','h9_assisted_review_idempotency_key','h6_notice_presentation_idempotency_key','h6_notice_ack_idempotency_key'].forEach((key) => expect(schema).toContain(key));
  });
});

describe('H10 cross-phase journeys', () => {
  it('journey 1 resolves one shared full vulnerable-operation requirement set', () => {
    const all = ['LEGAL','LST','CUE','BC','PAG','DOC','FIR','AVI'].map((provider) => req(provider, 'CUMPLIDO'));
    expect(deriveH7Closure(all)).toMatchObject({ state: 'CUMPLIMIENTO_COMPLETO', complete: true, pendingCount: 0 });
    expect(validateH9Result({ verification_checks: [], correct_count: 0, observations: [], critical_inconsistencies: [] }, new Set())).toEqual({ verification_checks: [], correct_count: 0, observations: [], critical_inconsistencies: [] });
  });

  it('journey 2 creates no artificial work for a non-applicable operation', () => {
    expect(deriveH7Closure([req('LEGAL','NO_APLICA'), req('AVI','NO_APLICA')])).toMatchObject({ state: 'NO_APLICA', complete: false, pendingCount: 0 });
  });

  it('journey 3 reports the exact provider and notice actions still pending', () => {
    const closure = deriveH7Closure([req('LEGAL','CUMPLIDO'), req('PAG','PENDIENTE','ASSIGN_PROVIDER'), req('AVI','PENDIENTE','PREPARE_NOTICE')]);
    expect(closure).toMatchObject({ state: 'PENDIENTE', complete: false, pendingCount: 2, actionableCount: 2 });
  });

  it('journey 4 leaves compliance services usable after Entregado while operational alerting stays separate', () => {
    const h8 = read('services/complianceH8.service.ts');
    const h6Routes = read('routes/compliance.routes.ts');
    const operational = read('services/expedienteSeguimiento.service.ts');
    expect(h8).toContain("'ENTREGADO'");
    expect(h6Routes).toContain('/presentaciones');
    expect(h6Routes).toContain('/acuses');
    expect(operational).toContain("alertas_operativas_activas: expediente.estatus !== 'ENTREGADO'");
  });

  it('journey 5 marks reviews stale after a relevant source change without mutating history', () => {
    expect(compareManifests([source('before')], [source('after')])).toMatchObject({ stale: true, changes: [{ change: 'CHANGED' }] });
    const migration = fs.readFileSync(path.resolve(root, '../prisma/migrations/20260905030000_create_h9_assisted_compliance_review/migration.sql'), 'utf8');
    expect(migration).toMatch(/BEFORE UPDATE OR DELETE/);
  });

  it('journey 6 permits a clean H9 result while deterministic H7 remains pending', () => {
    const clean = validateH9Result({ verification_checks: [], correct_count: 0, observations: [], critical_inconsistencies: [] }, new Set());
    const closure = deriveH7Closure([req('LEGAL','CUMPLIDO'), req('AVI','PENDIENTE')]);
    expect(clean.critical_inconsistencies).toEqual([]);
    expect(closure).toMatchObject({ state: 'PENDIENTE', complete: false });
  });

  it('authorized exception resolves exactly one requirement without adding a seventh state', () => {
    expect(H7_EXCEPTION_RESOLUTION).toBe('NO_APLICA_BY_AUTHORIZED_EXCEPTION');
    expect(deriveH7Closure([req('LEGAL','CUMPLIDO'), req('DOC','NO_APLICA')])).toMatchObject({ state: 'CUMPLIMIENTO_COMPLETO', complete: true });
  });
});
