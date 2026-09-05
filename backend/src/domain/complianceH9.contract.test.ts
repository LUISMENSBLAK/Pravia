import { describe, expect, it } from 'vitest';
import fs from 'node:fs'; import path from 'node:path';
const root = path.resolve(__dirname, '..');
const read = (file: string) => fs.readFileSync(path.join(root, file), 'utf8');
const service = read('services/complianceH9.service.ts');
const ai = read('services/complianceH9.ai.ts');
const routes = read('routes/compliance.routes.ts');
const migration = fs.readFileSync(path.resolve(root, '../prisma/migrations/20260905030000_create_h9_assisted_compliance_review/migration.sql'), 'utf8');

describe('H9 CUM-AUD architectural boundaries', () => {
  it('exposes read and explicit manual run routes with canonical permissions', () => {
    expect(routes).toContain('/revision-asistida'); expect(routes).toContain('requirePermission("compliance.review")'); expect(routes).toContain('requirePermission("ia.execute")');
  });
  it('uses H1-H7 authorities without the legacy payment ledger', () => {
    ['complianceRequirement','complianceScreeningResult','complianceQuestionnaireAssessment','complianceOperationPayment','complianceBcEvaluation','complianceObligation','expedienteDocumento'].forEach((authority) => expect(service).toContain(authority));
    expect(service).not.toContain('compliancePayment.find');
  });
  it('does not mutate legal state, requirements, screening, BC, payments or AVI', () => {
    ['expedienteComplianceState.update','complianceRequirement.update','complianceScreeningResult.update','complianceBcEvaluation.update','complianceOperationPayment.update','complianceObligation.update'].forEach((writer) => expect(service).not.toContain(writer));
  });
  it('uses a closed structured response and contains explicit legal/score/signature boundaries', () => {
    expect(ai).toContain("type: 'json_schema'"); expect(ai).toContain("strict: true"); expect(ai).toContain('No emitas score'); expect(ai).toContain('no autentiques firmas'); expect(ai).toContain('no determines beneficiario controlador');
  });
  it('physically protects completed history and tenant-aware lineage', () => {
    expect(migration).toContain('BEFORE UPDATE OR DELETE'); expect(migration).toContain('append-only');
    expect(migration).toContain('h9_assisted_review_context_fkey'); expect(migration).toContain('h9_assisted_review_actor_fkey');
  });
});
