import { describe, expect, it } from 'vitest';
import { normalizeOperationalText, optionalOperationalText, preserveFormatText } from './operationalText';

describe('regla contractual de texto operativo en mayúsculas', () => {
  it('normaliza nombres, conceptos, descripciones, domicilios, actos y roles', () => {
    for (const input of ['María López', 'honorarios notariales', 'calle Río Lerma 18', 'albacea testamentario']) {
      expect(normalizeOperationalText(input)).toBe(input.trim().replace(/\s+/gu, ' ').toLocaleUpperCase('es-MX'));
    }
    expect(optionalOperationalText('   ')).toBeNull();
  });

  it('ofrece una ruta explícita que preserva formatos excluidos y texto literal', () => {
    for (const input of ['Persona.Test+qa@Example.com', 'GOML850101AB1', 'https://example.test/Ruta', 'Texto Literal del Machote']) {
      expect(preserveFormatText(input)).toBe(input);
    }
  });
});
