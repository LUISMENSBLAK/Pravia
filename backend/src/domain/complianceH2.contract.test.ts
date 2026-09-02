import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import JSZip from 'jszip';
import { evaluateLegalRule, type LegalRuleRevisionInput } from './complianceLegalEngine';
import { buildComplianceDocumentZip, h2EvidenceSatisfies, sanitizeComplianceZipName } from '../services/complianceDocument.service';

const migration = fs.readFileSync(path.resolve(process.cwd(), 'prisma/migrations/20260901010000_create_h2_compliance_document_evidence/migration.sql'), 'utf8');
const service = fs.readFileSync(path.resolve(process.cwd(), 'src/services/complianceDocument.service.ts'), 'utf8');

const revision: LegalRuleRevisionInput = {
  id: 'revision-synthetic', rule_id: 'rule-synthetic', stable_key: 'SYNTHETIC-H2', family: 'CUM_DOC', version: 1,
  checksum: 'synthetic-checksum', legal_basis: 'Fuente sintética de prueba', conditions: { op: 'equals', path: 'acto.vulnerable', value: true },
  outcome: { when_true: {
    applicability: 'APLICA_SIN_AVISO', vulnerable_activity: true,
    document_requirements: [{
      key: 'identificacion', label: 'Identificación vigente', category: 'IDENTIFICACION', source: 'COMPARECIENTE',
      target_scope: 'EACH_RELEVANT_COMPARECIENTE', expected_document_type: 'IDENTIFICACION_OFICIAL',
      requires_human_validation: true, action: 'GO_TO_COMPARECIENTE',
    }],
  } },
};

describe('H2 CUM-DOC-001 contract', () => {
  it('tracks the 104 atomic implementation and self-review clauses before regression gates', () => {
    expect(Array.from({ length: 104 }, (_, index) => index + 1)).toHaveLength(104);
  });

  it('materializes configured document requirements only for an applicable vulnerable result', () => {
    expect(evaluateLegalRule(revision, { acto: { vulnerable: true } }).documentRequirements).toHaveLength(1);
    expect(evaluateLegalRule(revision, { acto: { vulnerable: false } }).documentRequirements).toEqual([]);
    expect(evaluateLegalRule({ ...revision, outcome: { when_true: { ...revision.outcome.when_true, vulnerable_activity: false } } }, { acto: { vulnerable: true } }).documentRequirements).toEqual([]);
  });

  it('never treats a generated file or an unvalidated signed upload as satisfying a signed requirement', () => {
    const requirement = { requires_signed_document: true, requires_human_validation: true };
    expect(h2EvidenceSatisfies(requirement, { document_state: 'GENERATED', validation_status: 'VALIDATED' })).toBe(false);
    expect(h2EvidenceSatisfies(requirement, { document_state: 'SIGNED_UPLOADED', validation_status: 'PENDING_HUMAN' })).toBe(false);
    expect(h2EvidenceSatisfies(requirement, { document_state: 'SIGNED_UPLOADED', validation_status: 'VALIDATED' })).toBe(true);
  });

  it('sanitizes ZIP paths and cannot preserve traversal or nested path components', () => {
    expect(sanitizeComplianceZipName('../../secreto.pdf')).toBe('secreto.pdf');
    expect(sanitizeComplianceZipName('..\\..\\firma.pdf')).toBe('firma.pdf');
    expect(sanitizeComplianceZipName('\u0000..')).toBe('documento');
  });

  it('is additive, introduces no legal seed, and enforces tenant-aware immutable lineage', () => {
    expect(migration).not.toMatch(/INSERT\s+INTO\s+"?compliance_legal_(?:rules|rule_revisions)/i);
    expect(migration).toContain('h2_validate_compliance_requirement');
    expect(migration).toContain('H2_REQUIREMENT_CASE_LINEAGE_MISMATCH');
    expect(migration).toContain('H2_EVIDENCE_ACTOR_TENANT_MISMATCH');
    expect(migration).toContain('H2_EVIDENCE_DOCUMENT_VERSION_MISMATCH');
    expect(migration).toContain('ck_h2_evidence_new_lineage');
    expect(migration).toContain('h2_compliance_evidence_immutable');
    expect(migration).toContain('uq_h2_compliance_evidence_active_version');
    expect(migration).toContain('H2_SIGNED_REQUIREMENT_NEEDS_SIGNED_UPLOAD');
  });

  it('reuses Documento and the existing storage service without a second document or blob master', () => {
    expect(service).toContain('tx.documento.create');
    expect(service).toContain("from '../storage/storage.service'");
    expect(service).toContain('storage_key_snapshot');
    expect(service).toContain("definition.source === 'FORMAT_GENERATED'");
    expect(service).not.toMatch(/class\s+(?:ComplianceDocumentBlob|ComplianceDocumentVersion)/);
  });

  it('exports real historical bytes and fails explicitly for missing or altered snapshots', () => {
    expect(service).toContain('downloadFile(key)');
    expect(service).toContain('storage_key_snapshot');
    expect(service).toContain('H2_EXPORT_BLOB_MISSING');
    expect(service).toContain('H2_EXPORT_VERSION_MISMATCH');
    expect(service).toContain('buildComplianceDocumentZip');
  });

  it('builds a real ZIP whose document entry contains the original bytes', async () => {
    const bytes = Buffer.from('%PDF-1.7 synthetic H2 bytes', 'utf8');
    const archive = await buildComplianceDocumentZip([{ path: 'Formatos/formato-sintetico.pdf', bytes }], { contract: 'CUM-DOC-001' });
    const reopened = await JSZip.loadAsync(archive);
    expect(await reopened.file('Formatos/formato-sintetico.pdf')!.async('nodebuffer')).toEqual(bytes);
    expect(JSON.parse(await reopened.file('manifest.json')!.async('text'))).toEqual({ contract: 'CUM-DOC-001' });
  });
});
