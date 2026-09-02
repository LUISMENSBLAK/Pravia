import { describe, expect, it } from 'vitest';
import { humanComplianceLabel } from '../features/compliance/complianceLabels';

describe('H1 compliance presentation contract', () => {
  it('renders all canonical states and applicability values with human labels', () => {
    expect(humanComplianceLabel('INFORMACION_INCOMPLETA')).toBe('Información incompleta');
    expect(humanComplianceLabel('APLICA_CON_AVISO')).toBe('Aplica con aviso');
    expect(humanComplianceLabel('CUMPLIMIENTO_COMPLETO')).toBe('Cumplimiento completo');
    expect(humanComplianceLabel('CRITICA')).toBe('Crítica');
  });

  it('does not synthesize human labels for unknown technical identifiers', () => {
    expect(humanComplianceLabel('CUM_MAT_001')).toBe('Por determinar');
    expect(humanComplianceLabel('RULE_TEST_A')).toBe('Por determinar');
  });
});
