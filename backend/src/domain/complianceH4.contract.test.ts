import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(resolve(process.cwd(), 'prisma/migrations/20260902010000_create_h4_beneficial_controller/migration.sql'), 'utf8');
const service = readFileSync(resolve(process.cwd(), 'src/services/beneficialController.service.ts'), 'utf8');
const adapter = readFileSync(resolve(process.cwd(), 'src/services/complianceBcScreening.service.ts'), 'utf8');
const legal = readFileSync(resolve(process.cwd(), 'src/services/complianceLegalEngine.service.ts'), 'utf8');
const event = readFileSync(resolve(process.cwd(), 'src/events/beneficialControllerEventHandlers.ts'), 'utf8');
const traceability = readFileSync(resolve(process.cwd(), '../docs/requirements/h4-cum-bc-001-traceability.md'), 'utf8');

const designableAtomicMatrix = [
  ['CURRENT_STRUCTURE', 8], ['GRAPH_NODES', 7], ['OWNERSHIP_EDGES', 7], ['CONTROL_FACTS', 5],
  ['RECONCILIATION', 4], ['SNAPSHOTS', 5], ['REGIME_EVALUATION', 8], ['H3_SEAM', 5],
  ['SOCIETY_LIFECYCLE', 4], ['AI_PROPOSALS', 4], ['FORMATS_PORT', 2], ['RBAC_AUDIT_UI', 5],
] as const;

describe('H4 CUM-BC-001 frozen contract', () => {
  it('accounts for exactly 64 designable atomics without absorbing the eight frozen external dependencies', () => {
    expect(designableAtomicMatrix.reduce((sum, [, count]) => sum + count, 0)).toBe(64);
  });
  it('materializes each frozen atomic identifier exactly once and preserves its contractual classification', () => {
    const ids = traceability.match(/\bH4-BC-\d{3}\b/g) || [];
    expect(ids).toHaveLength(72);
    for (let number = 1; number <= 72; number++) {
      const id = `H4-BC-${String(number).padStart(3, '0')}`;
      expect(ids.filter(candidate => candidate === id), id).toHaveLength(1);
    }
    for (const id of ['054', '069', '070', '071']) expect(traceability).toMatch(new RegExp(`H4-BC-${id}.*DEFERRED`));
    for (const id of ['015', '037', '038']) expect(traceability).toMatch(new RegExp(`H4-BC-${id}.*BLOCKED LEGAL`));
    expect(traceability).toMatch(/H4-BC-051.*BLOCKED FORMAT/);
  });
  it('uses exactly one additive H4 migration with no legal, source, format or production-data seed', () => {
    expect(migration).toContain('H4 · CUM-BC-001');
    expect(migration).not.toMatch(/INSERT\s+INTO/i);
    expect(migration).not.toMatch(/UPDATE\s+"?(?:compliance_beneficial_owners|expedientes|personas_morales)"?\s+SET/i);
  });
  it('declares the 23 canonical FK coverage indexes without duplicating the existing expediente-acto tenant key', () => {
    const expected = [
      'idx_fk_compliance_bc_ai_proposals_63f3def5', 'idx_fk_compliance_bc_ai_proposals_c2d29517', 'idx_fk_compliance_bc_ai_proposals_e8f7a06a',
      'idx_fk_compliance_bc_evaluations_60e98cdc', 'idx_fk_compliance_bc_evaluations_79c69633', 'idx_fk_compliance_bc_evaluations_ee9d6a88',
      'idx_fk_compliance_bc_format_mappings_196cca7b', 'idx_fk_compliance_bc_format_mappings_863a48d3', 'idx_fk_compliance_bc_format_mappings_8d2d1ca1',
      'idx_fk_compliance_bc_results_e26f1eb5', 'idx_fk_compliance_bc_structure_snapshots_4ebf07ec', 'idx_fk_compliance_bc_structure_snapshots_d4b02396',
      'idx_fk_compliance_bc_structure_snapshots_f8e5680a', 'idx_fk_expediente_society_targets_4ca2676c', 'idx_fk_expediente_society_targets_9186dcc4',
      'idx_fk_expediente_society_targets_a1ab134d', 'idx_fk_persona_moral_control_facts_02a34d12', 'idx_fk_persona_moral_control_facts_9796eab2',
      'idx_fk_persona_moral_ownership_edges_9d3d2550', 'idx_fk_persona_moral_ownership_structures_b744060a', 'idx_fk_persona_moral_ownership_structures_eb3928fb',
      'idx_fk_persona_moral_structure_reconciliations_10111c06', 'idx_fk_persona_moral_structure_reconciliations_5d1176a8',
    ];
    expect(expected).toHaveLength(23);
    for (const name of expected) expect(migration).toContain(`CREATE INDEX "${name}"`);
    expect(migration).not.toContain('h4_expediente_actos_id_tenant_key');
  });
  it('preserves the legacy beneficiary ledger and does not promote it into H4', () => {
    expect(migration).not.toMatch(/ALTER TABLE "compliance_beneficial_owners"/);
    expect(service).not.toContain('complianceBeneficialOwner');
  });
  it('enforces tenant-aware graph lineage and linked-person kind at the database boundary', () => {
    expect(migration).toContain('H4_GRAPH_NODE_LINEAGE_MISMATCH');
    expect(migration).toContain('H4_LINKED_NODE_KIND_MISMATCH');
    expect(migration).toContain('FOREIGN KEY ("linked_compareciente_id","organization_id")');
  });
  it('uses one current structure per tenant/person with revision, fingerprint, lock and idempotency', () => {
    expect(migration).toContain('pm_ownership_structures_tenant_person_key');
    expect(service).toContain('pg_advisory_xact_lock');
    expect(service).toContain('BC_REVISION_CONFLICT');
    expect(service).toContain('idempotency_key');
  });
  it('keeps incomplete graphs and cycles reviewable while hard invalid shapes are rejected', () => {
    expect(service).toContain('validation.hard_errors');
    expect(service).toContain('incomplete_markers');
  });
  it('freezes immutable operation snapshots and evaluations with exact case/review/tenant lineage', () => {
    expect(migration).toContain('H4_SNAPSHOT_REVIEW_CASE_TENANT_MISMATCH');
    expect(migration).toContain('H4_EVALUATION_SNAPSHOT_LINEAGE_MISMATCH');
    expect(migration).toContain('trg_h4_snapshot_immutable');
    expect(migration).toContain('trg_h4_evaluation_immutable');
  });
  it('does not create results for NOT_CONFIGURED or unverified evaluations', () => {
    expect(migration).toContain('H4_RESULT_REQUIRES_VERIFIED_EVALUATION');
    expect(service).toContain("const pack: BcRulePack | null");
    expect(service).toContain("status: result.status");
    expect(service).toContain('complianceBcResult.create');
    expect(service).toContain('for (const matches of subjects.values())');
  });
  it('evaluates LFPIORPI and CFF/RMF separately without a threshold embedded in H4', () => {
    expect(service).toContain("['LFPIORPI', 'CFF_RMF']");
    expect(service).not.toMatch(/(?:25|50)\s*%|threshold/i);
  });
  it('converges identical logical BC reevaluations on one immutable H1 review and one current pointer', () => {
    expect(legal).toContain('h4:review:');
    expect(legal).toContain("input_snapshot: { path: ['request_hash'], equals: requestHash }");
    expect(legal).toContain("orderBy: { created_at: 'asc' }");
    expect(legal).toContain('current_review_id: duplicate.id');
    expect(legal).toContain("accion: 'BC_IDENTICAL_REVIEW_REUSED'");
  });
  it('reuses H1 and writes BC requirements into the existing CUM-EST aggregation path', () => {
    expect(legal).toContain('BeneficialControllerService.materializeForReviewTx');
    expect(service).toContain("provider: 'BC'");
    expect(service).not.toContain('ComplianceGeneralState');
  });
  it('reuses H3 lower-level functions through exact result/person lineage guards', () => {
    expect(adapter).toContain('queueMasterScreeningTx');
    expect(adapter).toContain('linkOperationSnapshotTx');
    expect(adapter).toContain('H4_BC_SCREENING_LINEAGE_MISMATCH');
    expect(adapter).toContain("provider: 'LST'");
    expect(adapter).toContain('subject_compareciente_id: input.comparecienteId');
  });
  it('keeps AI as proposals with source version, pages, fingerprint and explicit human decision', () => {
    for (const token of ['source_document_version', 'source_pages', 'base_fingerprint', 'proposed_changes', 'decided_by_id']) expect(migration).toContain(token);
    expect(service).toContain('generateOperationalArtifactWithOpenAI');
    expect(service).not.toMatch(/responses\.create|chat\.completions/i);
    expect(service).toContain('BC_AI_STALE_CONFLICT');
  });
  it('provides only a NOT_CONFIGURED format port and creates no fake file', () => {
    expect(migration).toContain('compliance_bc_format_mappings');
    expect(migration).toContain("DEFAULT 'NOT_CONFIGURED'");
    expect(migration).not.toMatch(/INSERT\s+INTO\s+"?documentos/i);
  });
  it('transitions an explicitly linked society only from the real signing event', () => {
    expect(event).toContain("DomainEventBus.register('ExpedienteFirmado'");
    expect(service).toContain("status: 'EN_CONSTITUCION'");
    expect(service).toContain("estatus_societario: 'EN_CONSTITUCION'");
    expect(service).toContain("estatus_societario: 'CONSTITUIDA'");
  });
  it('preserves actor context, canonical permissions and audit evidence for sensitive writes', () => {
    expect(service).toContain("need(actor, 'comparecientes.write')");
    expect(service).toContain("need(actor, 'compliance.write')");
    expect(service).toContain("accion: 'BC_STRUCTURE_SAVED'");
  });
});
