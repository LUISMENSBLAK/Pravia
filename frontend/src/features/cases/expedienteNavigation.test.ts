import { describe, expect, it } from 'vitest';
import { expedienteReturnParams, normalizeExpedienteSection, resolveExpedienteReturn } from './expedienteNavigation';

describe('navegación segura de regreso al expediente', () => {
  it('conserva expediente y sección usando únicamente valores permitidos', () => {
    const search = `?${expedienteReturnParams('exp-1', 'cumplimiento')}`;
    expect(resolveExpedienteReturn(search)).toBe('/expedientes/exp-1#cumplimiento');
  });

  it('normaliza el hash histórico de workflow a Seguimiento', () => {
    expect(normalizeExpedienteSection('workflow')).toBe('seguimiento');
  });

  it('rechaza IDs manipulados y nunca acepta una URL arbitraria', () => {
    expect(resolveExpedienteReturn('?fromExpediente=https%3A%2F%2Fevil.test&fromSection=isr')).toBeNull();
    expect(resolveExpedienteReturn('?fromExpediente=exp-1&fromSection=https%3A%2F%2Fevil.test')).toBe('/expedientes/exp-1#resumen');
    expect(() => expedienteReturnParams('../otro', 'isr')).toThrow('Identificador de expediente inválido.');
  });
});
