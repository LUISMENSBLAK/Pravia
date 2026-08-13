import { describe, expect, it } from 'vitest';
import { humanizeRole } from '../lib/formatters';

describe('humanizeRole', () => {
  it.each([
    ['DIRECCION', 'Dirección'],
    ['ADMINISTRACION', 'Administración'],
    ['RECEPCION', 'Recepción'],
    ['GESTORIA', 'Gestoría'],
  ])('humaniza %s sin mostrar el enum crudo', (role, label) => {
    expect(humanizeRole(role)).toBe(label);
  });

  it('mantiene una salida humana para roles futuros', () => {
    expect(humanizeRole('REVISION_LEGAL')).toBe('Revision legal');
  });
});
