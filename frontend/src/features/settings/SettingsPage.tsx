import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import {
  Bell, Bot, Building2, Check, ChevronRight, KeyRound, LayoutDashboard, LockKeyhole, Mail,
  MonitorSmartphone, Pencil, Search, ShieldCheck, SlidersHorizontal, Trash2, UserRound, UsersRound, X,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { PageContainer } from '../../components/layout/PageContainer';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { PasswordInput } from '../../components/ui/PasswordInput';
import { humanizeRole } from '../../lib/formatters';
import { useAuth } from '../auth/AuthProvider';
import { settingsService } from './settings.service';
import { ROLE_LABELS, type ManagedUser, type Session, type UserInvitation, type UserPreferences } from './settings.types';
import styles from './Settings.module.css';

type AsyncState<T> = { loading: boolean; error: string; data: T | null };
const useResource = <T,>(loader: () => Promise<T>, deps: unknown[] = []) => {
  const [version, setVersion] = useState(0);
  const [state, setState] = useState<AsyncState<T>>({ loading: true, error: '', data: null });
  useEffect(() => {
    let active = true;
    setState((current) => ({ ...current, loading: true, error: '' }));
    loader().then((data) => { if (active) setState({ loading: false, error: '', data }); }).catch((error) => { if (active) setState({ loading: false, error: error instanceof Error ? error.message : 'No fue posible cargar la información.', data: null }); });
    return () => { active = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, version]);
  return { ...state, reload: () => setVersion((value) => value + 1) };
};

const formatDate = (value?: string | null) => value ? new Intl.DateTimeFormat('es-MX', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value)) : 'Sin registro';
const humanRole = humanizeRole;
function StatePanel({ loading, error, empty, children, onRetry }: { loading?: boolean; error?: string; empty?: boolean; children: ReactNode; onRetry?: () => void }) {
  if (loading) return <div className={styles.state} role="status"><span className={styles.spinner} />Cargando información segura…</div>;
  if (error) return <div className={`${styles.state} ${styles.errorState}`} role="alert"><strong>No pudimos cargar esta sección</strong><span>{error}</span>{onRetry && <Button variant="secondary" onClick={onRetry}>Reintentar</Button>}</div>;
  if (empty) return <div className={styles.state}><strong>No hay información para mostrar</strong><span>Los registros aparecerán aquí cuando existan.</span></div>;
  return <>{children}</>;
}

function Modal({ title, description, children, onClose }: { title: string; description?: string; children: ReactNode; onClose: () => void }) {
  return <div className={styles.overlay} onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section className={styles.modal} role="dialog" aria-modal="true" aria-labelledby="modal-title">
      <header><div><h2 id="modal-title">{title}</h2>{description && <p>{description}</p>}</div><button type="button" className={styles.close} onClick={onClose} aria-label="Cerrar"><X size={20} /></button></header>
      {children}
    </section>
  </div>;
}

type SettingsNavItem = { to: string; label: string; icon: LucideIcon; permission?: string };
const personalItems: SettingsNavItem[] = [
  { to: '/configuracion/perfil', label: 'Mi perfil', icon: UserRound },
  { to: '/configuracion/seguridad', label: 'Seguridad y sesiones', icon: LockKeyhole },
  { to: '/configuracion/preferencias', label: 'Preferencias', icon: SlidersHorizontal },
  { to: '/configuracion/notificaciones', label: 'Notificaciones', icon: Bell },
];
const adminItems: SettingsNavItem[] = [
  { to: '/configuracion/usuarios', label: 'Usuarios y accesos', icon: UsersRound, permission: 'usuarios.manage' },
  { to: '/configuracion/roles', label: 'Roles y permisos', icon: ShieldCheck, permission: 'usuarios.read' },
  { to: '/configuracion/inteligencia', label: 'Administración de IA', icon: Bot, permission: 'ai.admin.read' },
  { to: '/configuracion/auditoria', label: 'Auditoría', icon: Search, permission: 'configuracion.manage' },
];

function SettingsNavigation() {
  const { user } = useAuth();
  const location = useLocation();
  const navigationRef = useRef<HTMLElement>(null);
  useEffect(() => {
    const active = navigationRef.current?.querySelector<HTMLElement>('[aria-current="page"]');
    active?.scrollIntoView?.({ block: 'nearest', inline: 'center' });
  }, [location.pathname]);
  const can = (permission?: string) => !permission || Boolean(user?.permissions?.includes(permission));
  const group = (title: string, items: SettingsNavItem[]) => <div className={styles.navGroup}><small>{title}</small>{items.filter((item) => can(item.permission)).map((item) => { const Icon = item.icon; return <NavLink key={item.to} to={item.to} className={({ isActive }) => isActive ? styles.settingsActive : ''}><Icon size={18} /><span>{item.label}</span><ChevronRight size={15} /></NavLink>; })}</div>;
  return <aside ref={navigationRef} className={styles.settingsNav} aria-label="Secciones de configuración">
    <NavLink end to="/configuracion" className={({ isActive }) => isActive ? styles.settingsActive : ''}><LayoutDashboard size={18} /><span>Resumen</span><ChevronRight size={15} /></NavLink>
    {group('PERSONAL', personalItems)}
    {group('ORGANIZACIÓN', [{ to: '/configuracion/organizacion', label: 'Organización', icon: Building2 }])}
    {adminItems.some((item) => can(item.permission)) && group('ADMINISTRACIÓN', adminItems)}
  </aside>;
}

function OverviewSection() {
  const resource = useResource(settingsService.overview, []);
  const navigate = useNavigate();
  return <StatePanel loading={resource.loading} error={resource.error} onRetry={resource.reload} empty={!resource.data}>
    {resource.data && <div className={styles.sectionStack}>
      <div className={styles.welcome}><div className={styles.avatarLarge}>{resource.data.profile.nombre?.[0]}{resource.data.profile.apellido?.[0]}</div><div><span>Centro de configuración</span><h2>{resource.data.profile.nombre} {resource.data.profile.apellido}</h2><p>{humanizeRole(resource.data.profile.rol)} · {resource.data.profile.email}</p></div></div>
      <div className={styles.cardGrid}>
        <button className={styles.actionCard} onClick={() => navigate('/configuracion/perfil')}><UserRound /><span><strong>Perfil personal</strong><small>Datos de contacto y alcance de acceso</small></span><ChevronRight /></button>
        <button className={styles.actionCard} onClick={() => navigate('/configuracion/seguridad')}><MonitorSmartphone /><span><strong>{resource.data.metrics.active_sessions} sesiones activas</strong><small>Revisa dispositivos y cambia tu contraseña</small></span><ChevronRight /></button>
        <button className={styles.actionCard} onClick={() => navigate('/configuracion/notificaciones')}><Bell /><span><strong>{resource.data.metrics.unread_notifications} notificaciones nuevas</strong><small>Centro de actividad de tu cuenta</small></span><ChevronRight /></button>
        <button className={styles.actionCard} onClick={() => navigate('/configuracion/organizacion')}><Building2 /><span><strong>{resource.data.organization.primary_notary?.nombre ?? 'Organización PRAVIA'}</strong><small>Ámbito {resource.data.organization.scope === 'GLOBAL' ? 'global' : 'por asignaciones'}</small></span><ChevronRight /></button>
      </div>
      <section className={styles.infoCard}><div><ShieldCheck /><span><strong>Acceso basado en rol</strong><small>Tu sesión tiene {resource.data.access.permissions.length} capacidades efectivas. Los permisos no se editan desde el perfil.</small></span></div></section>
    </div>}
  </StatePanel>;
}

function ProfileSection() {
  const resource = useResource(settingsService.profile, []);
  const [form, setForm] = useState({ nombre: '', apellido: '', telefono: '' });
  const [editing, setEditing] = useState(false); const [message, setMessage] = useState(''); const [saving, setSaving] = useState(false);
  useEffect(() => { if (resource.data?.user) setForm({ nombre: resource.data.user.nombre || '', apellido: resource.data.user.apellido || '', telefono: resource.data.user.telefono || '' }); }, [resource.data]);
  const save = async (event: FormEvent) => { event.preventDefault(); setSaving(true); setMessage(''); try { await settingsService.updateProfile(form); setMessage('Perfil actualizado correctamente.'); setEditing(false); resource.reload(); } catch (error) { setMessage(error instanceof Error ? error.message : 'No fue posible guardar.'); } finally { setSaving(false); } };
  return <StatePanel loading={resource.loading} error={resource.error} onRetry={resource.reload} empty={!resource.data}>
    {resource.data && <form className={styles.formCard} onSubmit={save}>
      <div className={styles.profileHeader}><div className={styles.avatarXL}>{form.nombre[0]}{form.apellido[0]}</div><div><h2>{form.nombre} {form.apellido}</h2><p>{resource.data.user.email}</p><span className={styles.roleBadge}>{humanizeRole(resource.data.user.rol)}</span></div><Button type="button" variant="secondary" onClick={() => setEditing((value) => !value)}><Pencil size={16} />{editing ? 'Cancelar edición' : 'Editar perfil'}</Button></div>
      <div className={styles.formGrid}>
        <Input label="Nombre" value={form.nombre} disabled={!editing} onChange={(event) => setForm({ ...form, nombre: event.target.value })} />
        <Input label="Apellido" value={form.apellido} disabled={!editing} onChange={(event) => setForm({ ...form, apellido: event.target.value })} />
        <Input label="Correo electrónico" value={resource.data.user.email} disabled />
        <Input label="Teléfono" value={form.telefono} disabled={!editing} onChange={(event) => setForm({ ...form, telefono: event.target.value })} />
      </div>
      <div className={styles.readonlyRow}><span><small>Ámbito operativo</small><strong>{resource.data.scope === 'GLOBAL' ? 'Acceso global' : 'Expedientes y objetos asignados'}</strong></span><span><small>Último acceso</small><strong>{formatDate(resource.data.user.last_login_at)}</strong></span></div>
      {message && <p className={styles.feedback} role="status">{message}</p>}
      {editing && <div className={styles.formActions}><Button type="submit" disabled={saving}>{saving ? 'Guardando…' : 'Guardar cambios'}</Button></div>}
    </form>}
  </StatePanel>;
}

function SecuritySection() {
  const resource = useResource<{ sessions: Session[] }>(settingsService.sessions, []);
  const [passwords, setPasswords] = useState({ current: '', next: '', confirmation: '' }); const [feedback, setFeedback] = useState('');
  const [confirm, setConfirm] = useState<Session | 'others' | null>(null);
  const changePassword = async (event: FormEvent) => { event.preventDefault(); if (passwords.next !== passwords.confirmation) { setFeedback('La confirmación no coincide.'); return; } try { await settingsService.changePassword(passwords.current, passwords.next); setPasswords({ current: '', next: '', confirmation: '' }); setFeedback('Contraseña actualizada y otras sesiones revocadas.'); resource.reload(); } catch (error) { setFeedback(error instanceof Error ? error.message : 'No fue posible cambiar la contraseña.'); } };
  const revoke = async () => { if (!confirm) return; if (confirm === 'others') await settingsService.revokeOtherSessions(); else await settingsService.revokeSession(confirm.id); setConfirm(null); resource.reload(); };
  return <div className={styles.sectionStack}>
    <form className={styles.formCard} onSubmit={changePassword}><div className={styles.cardTitle}><KeyRound /><div><h2>Cambiar contraseña</h2><p>Mínimo 12 caracteres, mayúscula, minúscula, número y símbolo.</p></div></div><div className={styles.formGrid}><PasswordInput label="Contraseña actual" value={passwords.current} onChange={(event) => setPasswords({ ...passwords, current: event.target.value })} /><PasswordInput label="Nueva contraseña" value={passwords.next} onChange={(event) => setPasswords({ ...passwords, next: event.target.value })} /><PasswordInput label="Confirmar contraseña" value={passwords.confirmation} onChange={(event) => setPasswords({ ...passwords, confirmation: event.target.value })} /></div><div className={styles.formActions}><Button type="submit">Actualizar contraseña</Button></div>{feedback && <p className={styles.feedback}>{feedback}</p>}</form>
    <section className={styles.tableCard}><div className={styles.cardHeader}><div><h2>Sesiones activas</h2><p>La ubicación se limita a una IP aproximada; no usamos geolocalización.</p></div><Button variant="secondary" disabled={!resource.data?.sessions.some((item) => !item.current)} onClick={() => setConfirm('others')}>Cerrar las demás</Button></div><StatePanel loading={resource.loading} error={resource.error} onRetry={resource.reload} empty={resource.data?.sessions.length === 0}><div className={styles.sessionList}>{resource.data?.sessions.map((session) => <div className={styles.sessionItem} key={session.id}><MonitorSmartphone /><span><strong>{session.device}{session.current && <em>Actual</em>}</strong><small>{session.ip_approximate} · Último uso {formatDate(session.last_used_at)}</small></span><Button variant="ghost" onClick={() => setConfirm(session)}>Cerrar sesión</Button></div>)}</div></StatePanel></section>
    {confirm && <Modal title={confirm === 'others' ? 'Cerrar otras sesiones' : 'Cerrar esta sesión'} description="El acceso se revocará inmediatamente. Esta acción quedará en auditoría." onClose={() => setConfirm(null)}><div className={styles.modalActions}><Button variant="secondary" onClick={() => setConfirm(null)}>Cancelar</Button><Button onClick={revoke}>Confirmar cierre</Button></div></Modal>}
  </div>;
}

function PreferencesSection() {
  const resource = useResource<{ preferences: UserPreferences }>(settingsService.preferences, []);
  const update = async (patch: Partial<UserPreferences>) => { await settingsService.updatePreferences(patch); resource.reload(); };
  return <StatePanel loading={resource.loading} error={resource.error} onRetry={resource.reload} empty={!resource.data}><div className={styles.formCard}><div className={styles.cardTitle}><SlidersHorizontal /><div><h2>Preferencias personales</h2><p>Se guardan en tu cuenta y aplican en tus dispositivos.</p></div></div>{resource.data && <div className={styles.preferenceGrid}>
    <label>Vista predeterminada<select value={resource.data.preferences.default_view} onChange={(e) => update({ default_view: e.target.value as UserPreferences['default_view'] })}><option value="CARDS">Tarjetas</option><option value="LIST">Lista</option></select></label>
    <label>Densidad<select value={resource.data.preferences.density} onChange={(e) => update({ density: e.target.value as UserPreferences['density'] })}><option value="COMFORTABLE">Cómoda</option><option value="COMPACT">Compacta</option></select></label>
    <label>Zona horaria<select value={resource.data.preferences.timezone} onChange={(e) => update({ timezone: e.target.value })}><option value="America/Mexico_City">Ciudad de México</option><option value="America/Bahia_Banderas">Bahía de Banderas</option><option value="America/Cancun">Cancún</option><option value="America/Tijuana">Tijuana</option></select></label>
    <label>Formato de fecha<select value={resource.data.preferences.date_format} onChange={(e) => update({ date_format: e.target.value as UserPreferences['date_format'] })}><option value="DD/MM/YYYY">DD/MM/AAAA</option><option value="YYYY-MM-DD">AAAA-MM-DD</option></select></label>
    <label>Tema<select value={resource.data.preferences.theme} onChange={(e) => update({ theme: e.target.value as UserPreferences['theme'] })}><option value="SYSTEM">Usar el sistema</option><option value="LIGHT">Claro</option></select></label>
    <label className={styles.switchRow}><span><strong>Notificaciones</strong><small>Mostrar actividad relevante de la cuenta.</small></span><input type="checkbox" checked={resource.data.preferences.notifications_enabled} onChange={(e) => update({ notifications_enabled: e.target.checked })} /></label>
    <label className={styles.switchRow}><span><strong>Sugerencias del asistente</strong><small>Mostrar recomendaciones contextuales.</small></span><input type="checkbox" checked={resource.data.preferences.assistant_suggestions_enabled} onChange={(e) => update({ assistant_suggestions_enabled: e.target.checked })} /></label>
  </div>}</div></StatePanel>;
}

function OrganizationSection() {
  const resource = useResource(settingsService.overview, []);
  return <StatePanel loading={resource.loading} error={resource.error} onRetry={resource.reload} empty={!resource.data}><div className={styles.sectionStack}>{resource.data && <><section className={styles.formCard}><div className={styles.cardTitle}><Building2 /><div><h2>Organización y ámbito</h2><p>Información operativa tomada del catálogo de notarías; no se duplica aquí.</p></div></div><div className={styles.detailGrid}><span><small>Notaría predeterminada</small><strong>{resource.data.organization.primary_notary?.nombre ?? 'Sin notaría predeterminada'}</strong></span><span><small>Ubicación</small><strong>{[resource.data.organization.primary_notary?.ciudad, resource.data.organization.primary_notary?.entidad_federativa].filter(Boolean).join(', ') || 'Sin registro'}</strong></span><span><small>Tu ámbito</small><strong>{resource.data.organization.scope === 'GLOBAL' ? 'Global' : 'Objetos asignados'}</strong></span><span><small>Zona horaria operativa</small><strong>Definida por preferencia personal</strong></span></div></section><section className={styles.infoCard}><div><LockKeyhole /><span><strong>Administración canónica</strong><small>Los datos de notarías se administran en su módulo para conservar una sola fuente de verdad.</small></span></div></section></>}</div></StatePanel>;
}

function InviteModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [form, setForm] = useState({ nombre: '', apellido: '', email: '', rol: 'ABOGADO' }); const [error, setError] = useState(''); const [saving, setSaving] = useState(false);
  const submit = async (event: FormEvent) => { event.preventDefault(); setSaving(true); setError(''); try { await settingsService.invite(form); onCreated(); onClose(); } catch (reason) { setError(reason instanceof Error ? reason.message : 'No fue posible enviar la invitación.'); } finally { setSaving(false); } };
  return <Modal title="Invitar usuario" description="La persona creará su propia contraseña desde un enlace seguro que expira en 72 horas." onClose={onClose}><form onSubmit={submit} className={styles.modalForm}><div className={styles.formGrid}><Input label="Nombre" value={form.nombre} onChange={(e) => setForm({ ...form, nombre: e.target.value })} required /><Input label="Apellido" value={form.apellido} onChange={(e) => setForm({ ...form, apellido: e.target.value })} required /><Input label="Correo" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} required /><label>Rol<select value={form.rol} onChange={(e) => setForm({ ...form, rol: e.target.value })}>{Object.entries(ROLE_LABELS).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label></div>{error && <p className={styles.feedback}>{error}</p>}<div className={styles.modalActions}><Button type="button" variant="secondary" onClick={onClose}>Cancelar</Button><Button type="submit" disabled={saving}>{saving ? 'Enviando…' : 'Enviar invitación'}</Button></div></form></Modal>;
}

function UsersSection() {
  const navigate = useNavigate(); const [search, setSearch] = useState(''); const [role, setRole] = useState('TODOS'); const [status, setStatus] = useState('TODOS'); const [invite, setInvite] = useState(false);
  const resource = useResource(() => settingsService.users({ page: 1, page_size: 20, search, role, status }), [search, role, status]);
  const invitations = useResource<{ invitations: UserInvitation[] }>(settingsService.invitations, []);
  const refresh = () => { resource.reload(); invitations.reload(); };
  const revoke = async (id: string) => { await settingsService.revokeInvitation(id); refresh(); };
  return <div className={styles.sectionStack}>{resource.data && <div className={styles.metricsRow}><div><span>Usuarios activos</span><strong>{resource.data.metrics.active}</strong></div><div><span>Invitaciones pendientes</span><strong>{resource.data.metrics.pending_invitations}</strong></div><div><span>Cuentas suspendidas</span><strong>{resource.data.metrics.suspended}</strong></div></div>}<section className={styles.tableCard}><div className={styles.cardHeader}><div><h2>Directorio de usuarios</h2><p>Acceso real por rol; suspender conserva el historial.</p></div><Button onClick={() => setInvite(true)}>Invitar usuario</Button></div><div className={styles.filters}><label><Search size={17} /><input aria-label="Buscar usuarios" placeholder="Nombre o correo…" value={search} onChange={(e) => setSearch(e.target.value)} /></label><select aria-label="Filtrar por rol" value={role} onChange={(e) => setRole(e.target.value)}><option value="TODOS">Todos los roles</option>{Object.entries(ROLE_LABELS).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select><select aria-label="Filtrar por estado" value={status} onChange={(e) => setStatus(e.target.value)}><option value="TODOS">Todos los estados</option><option value="ACTIVO">Activos</option><option value="SUSPENDIDO">Suspendidos</option><option value="BLOQUEADO">Bloqueados</option></select></div><StatePanel loading={resource.loading} error={resource.error} onRetry={resource.reload} empty={resource.data?.data.length === 0}><div className={styles.desktopTable}><table><thead><tr><th>Usuario</th><th>Rol</th><th>Estado</th><th>Último acceso</th><th aria-label="Acción" /></tr></thead><tbody>{resource.data?.data.map((user: ManagedUser) => <tr key={user.id}><td><strong>{user.nombre} {user.apellido}</strong><small>{user.email}</small></td><td>{humanRole(user.rol)}</td><td><span className={`${styles.status} ${styles[user.status.toLowerCase()]}`}>{user.status.replaceAll('_', ' ')}</span></td><td>{formatDate(user.last_login_at)}</td><td><button onClick={() => navigate(`/configuracion/usuarios/${user.id}`)} aria-label={`Abrir ${user.nombre}`}><ChevronRight size={18} /></button></td></tr>)}</tbody></table></div><div className={styles.mobileCards}>{resource.data?.data.map((user: ManagedUser) => <button key={user.id} className={styles.userCard} onClick={() => navigate(`/configuracion/usuarios/${user.id}`)}><div className={styles.avatarSmall}>{user.nombre[0]}{user.apellido[0]}</div><span><strong>{user.nombre} {user.apellido}</strong><small>{user.email}</small><em>{humanRole(user.rol)} · {user.status.replaceAll('_', ' ')}</em></span><ChevronRight /></button>)}</div></StatePanel></section><section className={styles.tableCard}><div className={styles.cardHeader}><div><h2>Invitaciones de acceso</h2><p>Enlaces seguros pendientes o expirados; nunca contienen contraseñas temporales.</p></div></div><StatePanel loading={invitations.loading} error={invitations.error} onRetry={invitations.reload} empty={invitations.data?.invitations?.length === 0}><div className={styles.invitationList}>{invitations.data?.invitations?.map((item) => <article key={item.id}><span className={styles.invitationIcon}><Mail size={17} /></span><span><strong>{item.nombre} {item.apellido}</strong><small>{item.email} · {humanRole(item.rol)}</small><time>Expira {formatDate(item.expires_at)}</time></span><span className={`${styles.status} ${item.status === 'EXPIRADA' ? styles.suspendido : styles.cambio_requerido}`}>{item.status}</span><Button variant="ghost" onClick={() => revoke(item.id)} aria-label={`Revocar invitación de ${item.email}`}><Trash2 size={16} />Revocar</Button></article>)}</div></StatePanel></section>{invite && <InviteModal onClose={() => setInvite(false)} onCreated={refresh} />}</div>;
}

function RolesSection() {
  const resource = useResource(settingsService.roles, []);
  const groups = useMemo(() => [{ key: 'expedientes', label: 'Expedientes' }, { key: 'finanzas', label: 'Finanzas' }, { key: 'reportes', label: 'Reportes' }, { key: 'usuarios', label: 'Usuarios' }, { key: 'configuracion', label: 'Configuración' }, { key: 'ai.', label: 'IA' }, { key: 'cumplimiento', label: 'Riesgos / UIF' }], []);
  return <StatePanel loading={resource.loading} error={resource.error} onRetry={resource.reload} empty={!resource.data}><section className={styles.tableCard}><div className={styles.cardHeader}><div><h2>Matriz efectiva de permisos</h2><p>Roles fijos del backend. Esta pantalla es de consulta para evitar permisos improvisados.</p></div></div>{resource.data && <div className={`${styles.desktopTable} ${styles.matrix}`}><table><thead><tr><th>Capacidad</th>{resource.data.roles.map((role: any) => <th key={role.role}>{humanRole(role.role)}</th>)}</tr></thead><tbody>{groups.map((group) => <tr key={group.key}><td><strong>{group.label}</strong></td>{resource.data.roles.map((role: any) => <td key={role.role}>{role.permissions.some((permission: string) => permission.startsWith(group.key)) ? <Check size={18} aria-label="Permitido" /> : <span aria-label="No permitido">—</span>}</td>)}</tr>)}</tbody></table></div>}<div className={styles.mobileCards}>{resource.data?.roles.map((role: any) => <article className={styles.roleCard} key={role.role}><strong>{humanRole(role.role)}</strong><small>{role.permissions.length} capacidades efectivas</small><p>{groups.filter((group) => role.permissions.some((permission: string) => permission.startsWith(group.key))).map((group) => group.label).join(' · ')}</p></article>)}</div></section></StatePanel>;
}

function AISection() {
  const resource = useResource(settingsService.aiDashboard, []);
  return <StatePanel loading={resource.loading} error={resource.error} onRetry={resource.reload} empty={!resource.data}><div className={styles.sectionStack}>{resource.data && <><div className={styles.metricsRow}><div><span>Solicitudes · 30 días</span><strong>{resource.data.metricas.solicitudes}</strong></div><div><span>Tokens procesados</span><strong>{resource.data.metricas.total_tokens.toLocaleString('es-MX')}</strong></div><div><span>Costo estimado</span><strong>${resource.data.metricas.costo_estimado_usd.toFixed(4)} USD</strong></div></div><section className={styles.formCard}><div className={styles.cardTitle}><Bot /><div><h2>Estado de IA</h2><p>Configuración de solo lectura; las credenciales nunca se exponen.</p></div></div><div className={styles.detailGrid}><span><small>Proveedor</small><strong>{resource.data.configuracion.provider}</strong></span><span><small>Modelo principal</small><strong>{resource.data.configuracion.modelo_principal}</strong></span><span><small>Modelo de escalamiento</small><strong>{resource.data.configuracion.modelo_escalamiento}</strong></span><span><small>Clave configurada</small><strong>{resource.data.configuracion.api_key_configurada ? 'Sí · protegida' : 'No configurada'}</strong></span><span><small>Escalamiento</small><strong>{resource.data.configuracion.escalamiento_habilitado ? 'Habilitado' : 'Deshabilitado'}</strong></span><span><small>Razonamiento</small><strong>{resource.data.configuracion.razonamiento}</strong></span></div></section><section className={styles.infoCard}><div><ShieldCheck /><span><strong>Política de herramientas</strong><small>El asistente consulta únicamente herramientas autorizadas por rol y alcance. Las acciones requieren confirmación explícita.</small></span></div></section></>}</div></StatePanel>;
}

function AuditSection() {
  const [action, setAction] = useState(''); const resource = useResource(() => settingsService.audit({ page: 1, page_size: 30, action }), [action]);
  return <section className={styles.tableCard}><div className={styles.cardHeader}><div><h2>Auditoría de acceso y configuración</h2><p>Se muestran metadatos seguros; no se exponen contraseñas, tokens ni valores sensibles.</p></div></div><div className={styles.filters}><label><Search size={17} /><input aria-label="Filtrar acción" placeholder="Filtrar por acción exacta…" value={action} onChange={(e) => setAction(e.target.value)} /></label></div><StatePanel loading={resource.loading} error={resource.error} onRetry={resource.reload} empty={resource.data?.data.length === 0}><div className={styles.auditList}>{resource.data?.data.map((item: any) => <article key={item.id}><div className={styles.auditIcon}><ShieldCheck size={17} /></div><span><strong>{item.accion.replaceAll('_', ' ')}</strong><small>{item.usuario.nombre} {item.usuario.apellido} · {item.entidad}</small></span><time>{formatDate(item.created_at)}</time></article>)}</div></StatePanel></section>;
}

function NotificationsSection() {
  const resource = useResource(settingsService.notifications, []);
  const navigate = useNavigate(); const read = async (id: string, href?: string | null) => { await settingsService.readNotification(id); resource.reload(); if (href) navigate(href); };
  return <section className={styles.tableCard}><div className={styles.cardHeader}><div><h2>Centro de notificaciones</h2><p>Eventos reales vinculados con tu cuenta y sus accesos.</p></div><Button variant="secondary" disabled={!resource.data?.unread} onClick={async () => { await settingsService.readAllNotifications(); resource.reload(); }}>Marcar todas como leídas</Button></div><StatePanel loading={resource.loading} error={resource.error} onRetry={resource.reload} empty={resource.data?.notifications.length === 0}><div className={styles.notificationList}>{resource.data?.notifications.map((item) => <button key={item.id} onClick={() => read(item.id, item.href)} className={!item.read_at ? styles.unread : ''}><span className={styles.notificationIcon}><Bell size={17} /></span><span><strong>{item.title}</strong><small>{item.body}</small><time>{formatDate(item.created_at)}</time></span>{!item.read_at && <i aria-label="No leída" />}</button>)}</div></StatePanel></section>;
}

export function SettingsPage() {
  const location = useLocation(); const { user } = useAuth();
  const segment = location.pathname.split('/')[2] || 'overview';
  const titles: Record<string, [string, string]> = {
    overview: ['Configuración', 'Administra tu cuenta, preferencias y controles de acceso.'], perfil: ['Mi perfil', 'Información personal y alcance operativo.'], seguridad: ['Seguridad y sesiones', 'Contraseña y dispositivos con acceso vigente.'], preferencias: ['Preferencias', 'Personaliza tu experiencia de trabajo.'], organizacion: ['Organización', 'Fuente operativa y ámbito de tu cuenta.'], usuarios: ['Usuarios y accesos', 'Invitaciones, estados, roles y trazabilidad.'], roles: ['Roles y permisos', 'Matriz efectiva definida por la política del servidor.'], inteligencia: ['Administración de IA', 'Estado técnico, política y consumo real.'], auditoria: ['Auditoría', 'Trazabilidad de acciones administrativas.'], notificaciones: ['Notificaciones', 'Actividad relevante de tu cuenta.'],
  };
  const denied = (segment === 'usuarios' && !user?.permissions?.includes('usuarios.manage')) || (segment === 'auditoria' && !user?.permissions?.includes('configuracion.manage')) || (segment === 'inteligencia' && !user?.permissions?.includes('ai.admin.read'));
  const section = denied ? <div className={styles.state} role="alert"><LockKeyhole /><strong>Acceso restringido</strong><span>Tu rol no incluye esta sección administrativa.</span></div> : segment === 'perfil' ? <ProfileSection /> : segment === 'seguridad' ? <SecuritySection /> : segment === 'preferencias' ? <PreferencesSection /> : segment === 'organizacion' ? <OrganizationSection /> : segment === 'usuarios' ? <UsersSection /> : segment === 'roles' ? <RolesSection /> : segment === 'inteligencia' ? <AISection /> : segment === 'auditoria' ? <AuditSection /> : segment === 'notificaciones' ? <NotificationsSection /> : <OverviewSection />;
  const [title, subtitle] = titles[segment] || titles.overview;
  return <PageContainer title={title} subtitle={subtitle}><div className={styles.layout}><SettingsNavigation /><div className={styles.content}>{section}</div></div></PageContainer>;
}
