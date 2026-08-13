import { beforeEach, describe, expect, it, vi } from 'vitest';

const db = vi.hoisted(() => ({
  user: { findUnique: vi.fn(), count: vi.fn() }, userPreference: { upsert: vi.fn() },
  authSession: { findMany: vi.fn(), findFirst: vi.fn(), update: vi.fn(), updateMany: vi.fn(), count: vi.fn() },
  notification: { count: vi.fn(), findMany: vi.fn(), updateMany: vi.fn() }, notaria: { findFirst: vi.fn(), findMany: vi.fn() },
  auditLog: { create: vi.fn(), findMany: vi.fn(), count: vi.fn() }, expediente: { findMany: vi.fn() }, compareciente: { findMany: vi.fn() },
  prospecto: { findMany: vi.fn() }, cotizacion: { findMany: vi.fn() }, $transaction: vi.fn(),
}));
vi.mock('../config/prisma', () => ({ default: db }));

import { SettingsController } from './settings.controller';

const user: any = { id: '11111111-1111-4111-8111-111111111111', email: 'maria@pravia.mx', nombre: 'María', apellido: 'López', rol: 'DIRECCION', sessionId: '22222222-2222-4222-8222-222222222222', permissions: ['ai.search', 'expedientes.read', 'configuracion.manage'], requiresPasswordChange: false };
const response = () => { const res: any = {}; res.status = vi.fn(() => res); res.json = vi.fn(() => res); return res; };

describe('Configuración y acceso', () => {
  beforeEach(() => { vi.clearAllMocks(); db.$transaction.mockImplementation(async (callback: any) => callback(db)); });

  it('expone el perfil propio sin campos de credenciales', async () => {
    db.user.findUnique.mockResolvedValue({ id: user.id, email: user.email, nombre: 'María', apellido: 'López', rol: 'DIRECCION' });
    const res = response(); await SettingsController.profile({ user } as any, res);
    expect(db.user.findUnique).toHaveBeenCalledWith(expect.objectContaining({ select: expect.not.objectContaining({ password_hash: true }) }));
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ permissions: user.permissions }));
  });

  it('rechaza preferencias fuera del catálogo persistible', async () => {
    const res = response(); await SettingsController.updatePreferences({ user, body: { theme: 'DARK' } } as any, res);
    expect(res.status).toHaveBeenCalledWith(400); expect(db.userPreference.upsert).not.toHaveBeenCalled();
  });

  it('muestra sesiones con IP aproximada y marca la sesión actual', async () => {
    db.authSession.findMany.mockResolvedValue([{ id: user.sessionId, user_agent: 'Mozilla/5.0 (Macintosh) Version/18 Safari/605', ip_address: '192.168.1.55', expires_at: new Date(), last_used_at: new Date(), created_at: new Date() }]);
    const res = response(); await SettingsController.sessions({ user } as any, res);
    expect(res.json.mock.calls[0][0].sessions[0]).toEqual(expect.objectContaining({ current: true, device: 'Safari en macOS', ip_approximate: '192.168.1.…' }));
  });

  it('no revoca una sesión ajena', async () => {
    db.authSession.findFirst.mockResolvedValue(null); const res = response();
    await SettingsController.revokeSession({ user, params: { id: 'other' } } as any, res);
    expect(res.status).toHaveBeenCalledWith(404); expect(db.authSession.update).not.toHaveBeenCalled();
  });

  it('la búsqueda solo consulta módulos autorizados', async () => {
    db.expediente.findMany.mockResolvedValue([{ id: 'e1', numero_pravia: 'EXP-1', cliente_alias: 'Cliente' }]);
    const res = response(); await SettingsController.search({ user, query: { q: 'EXP' } } as any, res);
    expect(db.expediente.findMany).toHaveBeenCalled(); expect(db.compareciente.findMany).not.toHaveBeenCalled(); expect(db.prospecto.findMany).not.toHaveBeenCalled();
    expect(res.json.mock.calls[0][0].data[0]).toEqual(expect.objectContaining({ type: 'EXPEDIENTE', href: '/expedientes/e1' }));
  });

  it('auditoría selecciona metadatos y omite valores sensibles', async () => {
    db.auditLog.findMany.mockResolvedValue([]); db.auditLog.count.mockResolvedValue(0); const res = response();
    await SettingsController.audit({ query: {} } as any, res);
    const select = db.auditLog.findMany.mock.calls[0][0].select;
    expect(select.valores_anteriores).toBeUndefined(); expect(select.valores_nuevos).toBeUndefined(); expect(select.detalles).toBeUndefined();
  });
});
