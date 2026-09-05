import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const root = path.resolve(__dirname, '..');
const read = (file: string) => fs.readFileSync(path.join(root, file), 'utf8');
const h7 = read('services/complianceH7.service.ts');
const h5 = read('services/complianceH5.service.ts');
const h6 = read('services/complianceH6.service.ts');
const screening = read('services/complianceScreening.service.ts');
const legal = read('services/complianceLegalEngine.service.ts');
const activity = read('services/expedienteActivity.service.ts');
const followup = read('services/expedienteSeguimiento.service.ts');
const routes = read('routes/compliance.routes.ts');

describe('H7 visible activity and operational independence contract', () => {
  it('routes each approved compliance event through the canonical EXP-009 writer seam', () => {
    for (const [source, action] of [
      [h5, 'QUESTIONNAIRE_FINALIZED'], [h5, 'RESOURCE_PROVIDER_CONFIRMED'],
      [h6, 'NOTICE_PRESENTED'], [h6, 'ACKNOWLEDGEMENT_REGISTERED'],
      [screening, 'SCREENING_MATCH_RESOLVED'], [legal, 'LEGAL_COMPLIANCE_EVALUATED'],
      [h7, 'AUTHORIZED_REQUIREMENT_EXCEPTION'],
    ]) {
      expect(source).toContain('recordComplianceActivityTx');
      expect(source).toContain(action);
    }
    expect(h7).toContain("source: 'H7-CUM-CIE'");
    expect(activity).toContain("'H7-CUM-CIE'");
    expect(activity).toContain("'cumplimiento'");
  });

  it('keeps the visible timeline distinct from technical AuditLog while correlating sensitive writes', () => {
    expect(h7).toContain('tx.auditLog.create');
    expect(h7).toContain('recordComplianceActivityTx');
    expect(activity).toContain('technical_audit_source: false');
    expect(activity).not.toContain('auditLog.find');
  });

  it('keeps compliance active after delivery without reviving operational alerts', () => {
    expect(routes).toContain('/expedientes/:expedienteId/requisitos/:requirementId/excepciones');
    expect(h7).not.toContain("estatus !== 'ENTREGADO'");
    expect(h7).not.toContain("estatus === 'ENTREGADO'");
    expect(followup).toContain("alertas_operativas_activas: expediente.estatus !== 'ENTREGADO'");
  });

  it('contains no manual complete writer or generic confirmed-to-complete shortcut', () => {
    expect(h7).not.toMatch(/manual.{0,30}complete|mark.{0,30}complete|marcar.{0,30}completo/i);
    expect(h7).not.toMatch(/CONFIRMADO.{0,80}CUMPLIMIENTO_COMPLETO/);
  });
});
