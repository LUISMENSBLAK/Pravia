import { describe, expect, it } from 'vitest';
import { calculateLegalDeadline, deriveComplianceState, evaluateCondition, evaluateLegalRule, selectEffectiveRuleRevisions } from './complianceLegalEngine';

describe('H1 deterministic legal engine', () => {
  it('resolves one effective revision per rule and preserves retired historical revisions', () => {
    const selected = selectEffectiveRuleRevisions([
      { id: 'rule-a-v1', rule_id: 'rule-a', version: 1, status: 'RETIRED' },
      { id: 'rule-a-v2', rule_id: 'rule-a', version: 2, status: 'ACTIVE' },
      { id: 'rule-b-v1', rule_id: 'rule-b', version: 1, status: 'RETIRED' },
    ]);
    expect(selected.map((revision) => revision.id)).toEqual(['rule-a-v2', 'rule-b-v1']);
  });

  it('uses three-valued logic and never converts missing information into a negative conclusion', () => {
    expect(evaluateCondition({ op: 'all', rules: [{ op: 'equals', path: 'acto.code', value: 'A' }, { op: 'gte', path: 'operacion.valor', value: 100 }] }, { acto: { code: 'A' } })).toEqual({ value: 'UNKNOWN', missing: new Set(['operacion.valor']) });
  });

  it('evaluates a synthetic verified revision without any hard-coded legal threshold', () => {
    const result = evaluateLegalRule({ id: 'rev', rule_id: 'rule', stable_key: 'SYNTHETIC-001', family: 'CUM_MAT_001', version: 1, checksum: 'hash', legal_basis: 'Fuente sintética de prueba', conditions: { op: 'gte', path: 'acto.value', value: 50 }, outcome: { when_true: { applicability: 'APLICA_CON_AVISO', vulnerable_activity: true, notice_required: true } } }, { acto: { value: 75 } });
    expect(result.applicability).toBe('APLICA_CON_AVISO');
    expect(result.noticeRequired).toBe(true);
  });

  it('evaluates all array candidates instead of stopping at the first non-match', () => {
    expect(evaluateCondition({ op: 'array_some', path: 'actos', rule: { op: 'equals', path: 'code', value: 'MATCH' } }, { actos: [{ code: 'NO' }, { code: 'MATCH' }] }).value).toBe('TRUE');
  });

  it('only calculates deadlines from a revision and an explicit legal date', () => {
    expect(calculateLegalDeadline({ kind: 'DAYS_AFTER_LEGAL_DATE', days: 3 }, null)).toEqual({ deadline: null, source: null });
    expect(calculateLegalDeadline({ kind: 'DAYS_AFTER_LEGAL_DATE', days: 3 }, new Date('2026-08-01T00:00:00.000Z')).deadline?.toISOString()).toBe('2026-08-04T00:00:00.000Z');
  });

  it('derives canonical state without accepting a manual complete flag', () => {
    expect(deriveComplianceState(['PENDIENTE'], [null])).toBe('PENDIENTE');
    expect(deriveComplianceState(['CUMPLIDO', 'NO_APLICA'], [null])).toBe('CUMPLIMIENTO_COMPLETO');
  });
});
