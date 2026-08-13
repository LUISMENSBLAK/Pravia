import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({
  overview: vi.fn(), profile: vi.fn(), updateProfile: vi.fn(), preferences: vi.fn(), updatePreferences: vi.fn(), sessions: vi.fn(), revokeSession: vi.fn(), revokeOtherSessions: vi.fn(), changePassword: vi.fn(),
  users: vi.fn(), user: vi.fn(), userImpact: vi.fn(), updateUser: vi.fn(), invitations: vi.fn(), invite: vi.fn(), revokeInvitation: vi.fn(), roles: vi.fn(), audit: vi.fn(), aiDashboard: vi.fn(), notifications: vi.fn(), readNotification: vi.fn(), readAllNotifications: vi.fn(), search: vi.fn(),
}));
const auth = vi.hoisted(() => ({ user: { id: 'u1', name: 'María López', email: 'maria@pravia.mx', role: 'DIRECCION', permissions: ['usuarios.read', 'usuarios.manage', 'configuracion.manage', 'ai.admin.read'] } }));
vi.mock('../features/settings/settings.service', () => ({ settingsService: api }));
vi.mock('../features/auth/AuthProvider', () => ({ useAuth: () => auth }));

import { SettingsPage } from '../features/settings/SettingsPage';
import { UserDetailPage } from '../features/settings/UserDetailPage';

const renderSettings = (path = '/configuracion') => render(<MemoryRouter initialEntries={[path]}><Routes><Route path="/configuracion" element={<SettingsPage />} /><Route path="/configuracion/:section" element={<SettingsPage />} /><Route path="/configuracion/usuarios/:id" element={<UserDetailPage />} /></Routes></MemoryRouter>);

describe('Configuración, usuarios y accesos', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.overview.mockResolvedValue({ profile: { nombre: 'María', apellido: 'López', email: 'maria@pravia.mx', rol: 'DIRECCION' }, metrics: { active_sessions: 2, unread_notifications: 3, active_users: 8 }, organization: { primary_notary: { nombre: 'Notaría 45', ciudad: 'Tepic', entidad_federativa: 'Nayarit' }, scope: 'GLOBAL' }, access: { permissions: ['usuarios.manage'] } });
    api.profile.mockResolvedValue({ user: { nombre: 'María', apellido: 'López', email: 'maria@pravia.mx', telefono: '311 100 2000', rol: 'DIRECCION', last_login_at: '2026-08-13T12:00:00Z' }, scope: 'GLOBAL' });
    api.sessions.mockResolvedValue({ sessions: [{ id: 's1', device: 'Safari en macOS', ip_approximate: '192.168.1.…', current: true, created_at: '2026-08-12T12:00:00Z', last_used_at: '2026-08-13T12:00:00Z', expires_at: '2026-09-13T12:00:00Z' }] });
    api.users.mockResolvedValue({ data: [{ id: 'u2', nombre: 'Carlos', apellido: 'Ruiz', email: 'carlos@pravia.mx', rol: 'ABOGADO', activo: true, status: 'ACTIVO', created_at: '2026-08-01T12:00:00Z', last_login_at: '2026-08-12T12:00:00Z' }], metrics: { active: 8, suspended: 1, pending_invitations: 2 }, meta: { total: 1 } });
    api.invitations.mockResolvedValue({ invitations: [{ id: 'i1', nombre: 'Lucía', apellido: 'Pérez', email: 'lucia@pravia.mx', rol: 'ABOGADO', status: 'PENDIENTE', created_at: '2026-08-13T12:00:00Z', expires_at: '2026-08-16T12:00:00Z' }] });
    api.roles.mockResolvedValue({ roles: [{ role: 'DIRECCION', permissions: ['expedientes.read', 'usuarios.manage', 'configuracion.manage', 'ai.admin.read'] }, { role: 'ABOGADO', permissions: ['expedientes.read'] }] });
    api.notifications.mockResolvedValue({ notifications: [], unread: 0 });
  });

  it('presenta un resumen conectado con sesiones, notificaciones y organización', async () => {
    renderSettings();
    expect(await screen.findByText('2 sesiones activas')).toBeInTheDocument();
    expect(screen.getByText('3 notificaciones nuevas')).toBeInTheDocument();
    expect(screen.getByText('Notaría 45')).toBeInTheDocument();
  });

  it('mantiene perfil, seguridad y preferencias disponibles en el menú personal', async () => {
    renderSettings(); await screen.findByText('Centro de configuración');
    expect(screen.getByRole('link', { name: /Mi perfil/ })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Seguridad y sesiones/ })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Preferencias/ })).toBeInTheDocument();
  });

  it('el perfil muestra rol y ámbito como datos no editables', async () => {
    const user = userEvent.setup(); renderSettings('/configuracion/perfil');
    expect(await screen.findByText('Dirección')).toBeInTheDocument();
    expect(screen.getByText('Acceso global')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Editar perfil' }));
    expect(screen.queryByLabelText('Rol')).not.toBeInTheDocument();
  });

  it('seguridad identifica la sesión actual y pide confirmación antes de cerrarla', async () => {
    const user = userEvent.setup(); renderSettings('/configuracion/seguridad');
    expect(await screen.findByText('Safari en macOS')).toBeInTheDocument(); expect(screen.getByText('Actual')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Cerrar sesión' }));
    expect(screen.getByRole('dialog', { name: 'Cerrar esta sesión' })).toBeInTheDocument();
  });

  it('usuarios usa datos paginados reales y ofrece invitación sin contraseña temporal', async () => {
    const user = userEvent.setup(); renderSettings('/configuracion/usuarios');
    expect(await screen.findAllByText('Carlos Ruiz')).not.toHaveLength(0);
    await user.click(screen.getByRole('button', { name: 'Invitar usuario' }));
    expect(screen.getByRole('dialog', { name: 'Invitar usuario' })).toBeInTheDocument();
    expect(screen.queryByLabelText(/contraseña/i)).not.toBeInTheDocument();
    expect(screen.getByText(/expira en 72 horas/i)).toBeInTheDocument();
    expect(await screen.findByText('Lucía Pérez')).toBeInTheDocument();
  });

  it('permite revocar una invitación pendiente sin exponer su token', async () => {
    const user = userEvent.setup(); api.revokeInvitation.mockResolvedValue({ success: true }); renderSettings('/configuracion/usuarios');
    await user.click(await screen.findByRole('button', { name: 'Revocar invitación de lucia@pravia.mx' }));
    expect(api.revokeInvitation).toHaveBeenCalledWith('i1');
    expect(screen.queryByText(/token/i)).not.toBeInTheDocument();
  });

  it('la matriz de roles refleja capacidades entregadas por el servidor', async () => {
    renderSettings('/configuracion/roles');
    expect(await screen.findAllByText('Dirección')).not.toHaveLength(0);
    expect(screen.getAllByLabelText('Permitido').length).toBeGreaterThan(0);
  });

  it('oculta y bloquea administración cuando faltan permisos', async () => {
    auth.user.permissions = ['usuarios.read'];
    renderSettings('/configuracion/auditoria');
    expect(await screen.findByText('Acceso restringido')).toBeInTheDocument();
    expect(api.audit).not.toHaveBeenCalled();
  });

  it('ofrece un estado vacío real en notificaciones', async () => {
    renderSettings('/configuracion/notificaciones');
    expect(await screen.findByText('No hay información para mostrar')).toBeInTheDocument();
  });

  it('detalle de usuario muestra impacto antes de suspender', async () => {
    api.user.mockResolvedValue({ user: { id: 'u2', nombre: 'Carlos', apellido: 'Ruiz', email: 'carlos@pravia.mx', rol: 'ABOGADO', activo: true, status: 'ACTIVO', created_at: '2026-08-01T12:00:00Z' }, active_sessions: 1, recent_activity: [] });
    api.userImpact.mockResolvedValue({ active_assignments: { expedientes: 2, tasks: 3, events: 1, reviews: 0 }, requires_confirmation: true, reassignment_supported: false });
    renderSettings('/configuracion/usuarios/u2');
    expect(await screen.findByText('Expedientes activos')).toBeInTheDocument(); expect(screen.getByText('Tareas pendientes')).toBeInTheDocument();
    expect(screen.getByText('2')).toBeInTheDocument(); expect(screen.getByText('3')).toBeInTheDocument();
  });
});
