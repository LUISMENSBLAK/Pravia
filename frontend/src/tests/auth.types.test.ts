import { describe, expect, it } from 'vitest';
import { normalizeUser } from '../features/auth/auth.types';

describe('normalizeUser', () => {
  it('normaliza una sesión anidada sin introducir datos fijos', () => {
    expect(normalizeUser({ data: { user: { id: 'u-1', full_name: 'María López', email: 'maria@notaria.mx', roleName: 'Titular' } } })).toEqual({
      id: 'u-1', name: 'María López', email: 'maria@notaria.mx', role: 'Titular', notary: undefined,
    });
  });

  it('rechaza respuestas sin identidad utilizable', () => {
    expect(normalizeUser({ data: {} })).toBeNull();
  });
});
