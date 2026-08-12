import { describe, expect, it } from 'vitest';
import { evaluateAllDocumentModels, evaluateDocumentModel } from './aiDocumentEvaluation';

describe('evaluación offline de extracción documental', () => {
  it('cubre los ocho escenarios documentales requeridos', () => {
    const report = evaluateDocumentModel('gpt-5.4-nano');
    expect(report.fixture_count).toBe(8);
    expect(report.cases.map((item) => item.kind)).toEqual(expect.arrayContaining([
      'INE', 'PASAPORTE', 'CURP', 'CONSTANCIA_SITUACION_FISCAL',
      'COMPROBANTE_DOMICILIO', 'WORD_MULTIPLES', 'CONFLICTO', 'BAJA_CALIDAD',
    ]));
  });

  it('exige valores, conflictos, escalamiento y trazabilidad', () => {
    for (const report of evaluateAllDocumentModels()) {
      expect(report.accuracy).toBe(1);
      expect(report.cases.every((item) => item.passed)).toBe(true);
      expect(report.estimated_usd).toBeGreaterThan(0);
      expect(report.disclaimer).toContain('sintéticas');
    }
  });

  it('mantiene nano como ruta estimada de menor costo', () => {
    const [nano, mini] = evaluateAllDocumentModels();
    expect(nano.model).toBe('gpt-5.4-nano');
    expect(nano.estimated_usd).toBeLessThan(mini.estimated_usd);
  });
});
