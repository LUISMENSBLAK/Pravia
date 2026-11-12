import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ membership: vi.fn(), update: vi.fn(), audit: vi.fn() }));
vi.mock('../config/prisma', () => ({ default: {
  organizationMembership: { findFirst: mocks.membership },
  authSession: { updateMany: mocks.update }, auditLog: { create: mocks.audit },
} }));
import { AuthController } from './auth.controller';

const organizationId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const request = (body: unknown): any => ({ body, user: { id: 'user-qa', sessionId: 'session-qa', organizationId } });
const response = (): any => { const res: any = {}; res.status = vi.fn(() => res); res.json = vi.fn(() => res); return res; };

describe('cambio de organización · entrada y errores controlados', () => {
  beforeEach(() => vi.clearAllMocks());
  it.each([{}, { organizationId: '' }, { organizationId: 'not-a-uuid' }, { organizationId: ['invalid'] }, { organization_id: organizationId }])(
    'rechaza una selección inválida sin consultar PostgreSQL: %j', async (body) => {
      const res = response(); await AuthController.switchOrganization(request(body), res);
      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ code: 'ORGANIZATION_ID_INVALID' }));
      expect(mocks.membership).not.toHaveBeenCalled();
      expect(mocks.update).not.toHaveBeenCalled();
    },
  );
  it('deniega otra organización sin modificar la sesión', async () => {
    mocks.membership.mockResolvedValue(null); const res = response();
    await AuthController.switchOrganization(request({ organizationId }), res);
    expect(res.status).toHaveBeenCalledWith(403); expect(mocks.update).not.toHaveBeenCalled();
  });
  it('resuelve un fallo del servicio sin rechazar el handler ni exponer detalles', async () => {
    mocks.membership.mockRejectedValue(new Error('private connection details')); const res = response();
    await expect(AuthController.switchOrganization(request({ organizationId }), res)).resolves.toBe(res);
    expect(res.status).toHaveBeenCalledWith(503);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ code: 'ORGANIZATION_SWITCH_UNAVAILABLE' }));
    expect(JSON.stringify(res.json.mock.calls)).not.toContain('private connection');
    expect(mocks.update).not.toHaveBeenCalled();
  });
});
