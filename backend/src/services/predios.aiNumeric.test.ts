import { describe, expect, it } from 'vitest';
import { normalizeAIProposalDecimal } from './predios.service';

describe('normalización de propuestas numéricas PRD-001', () => {
  it.each([
    ['$2,500,000.00 MXN', '2500000.00'],
    ['3.200.000,50 MXN', '3200000.50'],
    ['450.50 m²', '450.50'],
    ['210,25 m2', '210.25'],
    [2500000, '2500000'],
  ])('acepta evidencia documental con presentación conocida: %s', (input, expected) => {
    expect(normalizeAIProposalDecimal(input)).toBe(expected);
  });

  it('rechaza texto no numérico en lugar de inventar un importe', () => {
    expect(() => normalizeAIProposalDecimal('aproximadamente dos millones')).toThrowError(/formato reconocible/);
  });
});
