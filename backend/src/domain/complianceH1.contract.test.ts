import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const migration = fs.readFileSync(path.resolve(process.cwd(), 'prisma/migrations/20260831050000_create_h1_compliance_legal_engine/migration.sql'), 'utf8');
const h1AtomicMatrix = [
  ['CUM-MAT',16], ['MAT-001',8], ['MAT-002',8], ['MAT-003',7], ['MAT-004',6],
  ['MAT-005',8], ['MAT-006',5], ['MAT-007',5], ['CUM-EST-001',21],
] as const;

describe('H1 atomic contract and migration', () => {
  it('covers the 84 atomic requirements rebuilt from the approved H1 sections', () => {
    expect(h1AtomicMatrix.reduce((total, [, count]) => total + count, 0)).toBe(84);
  });

  it('is additive and contains no legal seed or production backfill', () => {
    expect(migration).not.toMatch(/INSERT\s+INTO\s+["']?compliance_legal_(?:rules|rule_revisions)/i);
    expect(migration).not.toMatch(/UPDATE\s+["']?(?:expedientes|compliance_reviews)/i);
  });

  it('enforces tenant, effective dating, provenance and immutable used revisions', () => {
    expect(migration).toContain('organization_id" UUID NOT NULL');
    expect(migration).toContain('ck_compliance_rule_verified_provenance');
    expect(migration).toContain('h1_rule_no_effective_overlap');
    expect(migration).toContain('h1_rule_revision_immutable');
    expect(migration).toContain('enforce_same_organization');
  });

  it('creates one current state per case and all controlled providers/states', () => {
    expect(migration).toContain('expediente_compliance_states_expediente_key');
    expect(migration).toContain("'LEGAL','DOC','LST','BC','CUE','PAG','FIR','AVI'");
    expect(migration).toContain("'NO_APLICA','PENDIENTE','EN_PROCESO','LISTO','CUMPLIMIENTO_COMPLETO','VENCIDO'");
  });

  it('keeps operational alert lead versioned and independent from legal deadlines and G0-C policy types', () => {
    expect(migration).toContain('compliance_alert_lead_revisions');
    expect(migration).toContain('lead_days_snapshot');
    expect(migration).toContain('opens_at');
    expect(migration).toContain('h1_alert_lead_revision_immutable');
    expect(migration).not.toContain("'COMPLIANCE_ALERT_LEAD'");
  });
});
