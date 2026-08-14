import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { getJwtSecret, hashOpaqueToken, newOpaqueToken, parseCookies, signAccessToken, validateJwtSecret, verifyAccessToken } from './authTokens';

describe('tokens de sesión', () => {
  const previousSecret = process.env.AUTH_JWT_SECRET;
  beforeEach(() => { process.env.AUTH_JWT_SECRET = 'pravia-test-secret-2026-with-ample-length!'; });
  afterEach(() => {
    if (previousSecret === undefined) delete process.env.AUTH_JWT_SECRET;
    else process.env.AUTH_JWT_SECRET = previousSecret;
  });

  it('firma y verifica identidad, sesión y rol', () => {
    const token = signAccessToken({ sub: 'user-id', sid: 'session-id', role: 'DIRECCION' });
    expect(verifyAccessToken(token)).toMatchObject({ sub: 'user-id', sid: 'session-id', role: 'DIRECCION', type: 'access' });
  });

  it('rechaza un token alterado', () => {
    const token = signAccessToken({ sub: 'user-id', sid: 'session-id', role: 'ABOGADO' });
    expect(() => verifyAccessToken(`${token.slice(0, -1)}x`)).toThrow();
  });

  it('genera tokens opacos y solo conserva su huella', () => {
    const token = newOpaqueToken();
    expect(token.length).toBeGreaterThan(50);
    expect(hashOpaqueToken(token)).toMatch(/^[a-f0-9]{64}$/);
    expect(hashOpaqueToken(token)).not.toContain(token);
  });

  it('interpreta cookies sin perder valores codificados', () => {
    expect(parseCookies('uno=1; pravia_refresh=abc%2Fdef; tema=oscuro')).toEqual({ uno: '1', pravia_refresh: 'abc/def', tema: 'oscuro' });
  });

  it('rechaza secretos vacíos, cortos, placeholders y repetitivos', () => {
    expect(validateJwtSecret(undefined)).toMatch(/32 caracteres/);
    expect(validateJwtSecret('short-secret')).toMatch(/32 caracteres/);
    expect(validateJwtSecret('replace-with-a-random-secret-of-at-least-32-characters')).toMatch(/placeholder/);
    expect(validateJwtSecret('a'.repeat(64))).toMatch(/aleatorio/);
  });

  it('acepta un secreto aleatorio fuerte y getJwtSecret aplica la misma política', () => {
    const strong = 'kN7_q4f2Cw9-Yx3Vb8mP6sR1tL5zD0Ha';
    expect(validateJwtSecret(strong)).toBeNull();
    process.env.AUTH_JWT_SECRET = strong;
    expect(getJwtSecret()).toBe(strong);
  });
});
