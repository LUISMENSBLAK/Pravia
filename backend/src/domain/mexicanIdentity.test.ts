import { describe, expect, it } from 'vitest';
import { IdentityValidationError, normalizeIdentifier, validateCurp, validateOptionalDate, validateRfc } from './mexicanIdentity';

describe('Mexican identity validation', () => {
  it('normalizes identifiers before persistence', () => {
    expect(normalizeIdentifier(' abcd 010101 9x1 ')).toBe('ABCD0101019X1');
  });

  it('accepts an empty optional CURP', () => {
    expect(validateCurp('')).toBeNull();
  });

  it('accepts a structurally valid CURP', () => {
    expect(validateCurp('GODE561231HDFRRN09')).toBe('GODE561231HDFRRN09');
  });

  it('rejects an invalid CURP', () => {
    expect(() => validateCurp('CURP-INCOMPLETA')).toThrow(IdentityValidationError);
  });

  it('distinguishes physical and legal-entity RFC structures', () => {
    expect(validateRfc('GODE561231GR8', 'FISICA')).toBe('GODE561231GR8');
    expect(validateRfc('ABC0101019X1', 'MORAL')).toBe('ABC0101019X1');
  });

  it('rejects an RFC with the wrong person-type length', () => {
    expect(() => validateRfc('ABC0101019X1', 'FISICA')).toThrow(IdentityValidationError);
  });

  it('parses valid optional dates and rejects malformed values', () => {
    expect(validateOptionalDate('2026-08-11', 'La fecha')?.getFullYear()).toBe(2026);
    expect(() => validateOptionalDate('no-es-fecha', 'La fecha')).toThrow(IdentityValidationError);
  });
});
