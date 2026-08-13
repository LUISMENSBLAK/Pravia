import { beforeEach, describe, expect, it, vi } from 'vitest';

const db = vi.hoisted(() => ({
  user: { findUnique: vi.fn(), count: vi.fn(), update: vi.fn() }, userInvitation: { findFirst: vi.fn(), create: vi.fn(), count: vi.fn() },
  expediente: { count: vi.fn() }, tarea: { count: vi.fn() }, eventoAgenda: { count: vi.fn() }, complianceReview: { count: vi.fn() },
  authSession: { updateMany: vi.fn() }, auditLog: { create: vi.fn() }, notification: { create: vi.fn() }, $transaction: vi.fn(),
}));
vi.mock('../config/prisma', () => ({ default: db }));

import { UsersController } from './users.controller';

const actor: any = { id: '11111111-1111-4111-8111-111111111111', email: 'direccion@pravia.mx', nombre: 'Ana', apellido: 'Ruiz', rol: 'DIRECCION', sessionId: '22222222-2222-4222-8222-222222222222', permissions: ['usuarios.manage'], requiresPasswordChange: false };
const response = () => { const res: any = {}; res.status = vi.fn(() => res); res.json = vi.fn(() => res); return res; };

describe('Administración de usuarios', () => {
  beforeEach(() => { vi.clearAllMocks(); db.$transaction.mockImplementation(async (callback: any) => callback(db)); });

  it('protege al último usuario activo de Dirección', async () => {
    db.user.findUnique.mockResolvedValue({ id: '33333333-3333-4333-8333-333333333333', nombre: 'Última', apellido: 'Dirección', rol: 'DIRECCION', activo: true }); db.user.count.mockResolvedValue(1);
    const res = response(); await UsersController.update({ user: actor, params: { id: '33333333-3333-4333-8333-333333333333' }, body: { rol: 'ABOGADO' } } as any, res);
    expect(res.status).toHaveBeenCalledWith(409); expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ code: 'LAST_DIRECTOR_REQUIRED' }));
  });

  it('exige confirmación cuando una suspensión impacta trabajo activo', async () => {
    db.user.findUnique.mockResolvedValue({ id: '33333333-3333-4333-8333-333333333333', nombre: 'Mario', apellido: 'Pérez', rol: 'ABOGADO', activo: true });
    db.expediente.count.mockResolvedValue(2); db.tarea.count.mockResolvedValue(1); db.eventoAgenda.count.mockResolvedValue(0);
    const res = response(); await UsersController.update({ user: actor, params: { id: '33333333-3333-4333-8333-333333333333' }, body: { activo: false } } as any, res);
    expect(res.status).toHaveBeenCalledWith(409); expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ code: 'USER_HAS_ACTIVE_ASSIGNMENTS', impact: { expedientes: 2, tasks: 1, events: 0 } }));
  });

  it('guarda una invitación con hash y nunca persiste el token visible', async () => {
    db.user.findUnique.mockResolvedValue(null); db.userInvitation.findFirst.mockResolvedValue(null);
    db.userInvitation.create.mockImplementation(async ({ data }: any) => ({ id: '44444444-4444-4444-8444-444444444444', ...data })); db.auditLog.create.mockResolvedValue({});
    const original = process.env.AUTH_ALLOW_DEV_INVITATION_LINK; delete process.env.AUTH_ALLOW_DEV_INVITATION_LINK;
    const res = response(); await UsersController.invite({ user: actor, body: { email: 'nuevo@pravia.mx', nombre: 'Nuevo', apellido: 'Usuario', rol: 'ABOGADO' }, correlationId: '55555555-5555-4555-8555-555555555555' } as any, res);
    process.env.AUTH_ALLOW_DEV_INVITATION_LINK = original;
    const persisted = db.userInvitation.create.mock.calls[0][0].data;
    expect(persisted.token_hash).toMatch(/^[a-f0-9]{64}$/); expect(persisted.token).toBeUndefined();
    expect(res.json.mock.calls[0][0].development_activation_url).toBeUndefined();
  });
});
