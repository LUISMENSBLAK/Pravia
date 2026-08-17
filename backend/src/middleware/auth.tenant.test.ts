import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  findFirst: vi.fn(),
  claims: { sub: 'user-a', sid: 'session-a', org: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', role: 'ABOGADO', type: 'access' },
}));
vi.mock('../config/prisma', () => ({ default: { authSession: { findFirst: mocks.findFirst } } }));
vi.mock('../auth/authTokens', () => ({ verifyAccessToken: vi.fn(() => mocks.claims) }));

import { authenticate } from './auth.middleware';

const ORG_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const response = () => { const res: any = {}; res.status = vi.fn(() => res); res.json = vi.fn(() => res); return res; };
const request = () => ({ header: vi.fn((name: string) => name === 'authorization' ? 'Bearer valid' : undefined) } as any);
const session = () => ({
  id: 'session-a', user_id: 'user-a', organization_id: ORG_A,
  user: { id: 'user-a', email: 'a@test.invalid', nombre: 'Ana', apellido: 'A', rol: 'DIRECCION', activo: true, requires_password_change: false },
  membership: { id: 'membership-a', user_id: 'user-a', organization_id: ORG_A, rol: 'ABOGADO', status: 'ACTIVE', organization: { id: ORG_A, status: 'ACTIVE' } },
});

describe('sesión tenant autoritativa', () => {
  const previousNodeEnv = process.env.NODE_ENV;
  beforeEach(() => { vi.clearAllMocks(); process.env.NODE_ENV = 'production'; mocks.claims.org = ORG_A; });
  afterEach(() => { process.env.NODE_ENV = previousNodeEnv; });

  it('construye ActorContext desde sesión y Membership, no desde input del cliente', async () => {
    mocks.findFirst.mockResolvedValue(session());
    const req = request(); const res = response(); const next = vi.fn();
    await authenticate(req, res, next);
    expect(next).toHaveBeenCalledOnce();
    expect(req.user).toMatchObject({ id: 'user-a', organizationId: ORG_A, membershipId: 'membership-a', rol: 'ABOGADO' });
  });

  it('rechaza un JWT cuyo tenant no coincide con la sesión vigente', async () => {
    mocks.claims.org = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
    mocks.findFirst.mockResolvedValue(session());
    const res = response(); const next = vi.fn();
    await authenticate(request(), res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
  });

  it('falla cerrado en producción cuando no existe Membership activa', async () => {
    mocks.findFirst.mockResolvedValue({ ...session(), membership: null, organization_id: null });
    const res = response(); const next = vi.fn();
    await authenticate(request(), res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ code: 'TENANT_CONTEXT_REQUIRED' }));
  });

  it('usa el rol de la Membership activa y no traslada el rol global legacy', async () => {
    mocks.findFirst.mockResolvedValue(session());
    const req = request(); const res = response(); const next = vi.fn();
    await authenticate(req, res, next);
    expect(next).toHaveBeenCalledOnce();
    expect(req.user.rol).toBe('ABOGADO');
  });

  it('rechaza inmediatamente una sesión cuya Membership fue suspendida', async () => {
    mocks.findFirst.mockResolvedValue({ ...session(), membership: { ...session().membership, status: 'SUSPENDED' } });
    const res = response(); const next = vi.fn();
    await authenticate(request(), res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ code: 'TENANT_CONTEXT_REQUIRED' }));
  });
});
