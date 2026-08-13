import { useEffect, useState } from 'react';
import { ArrowLeft, CalendarDays, FolderOpen, ShieldAlert, ShieldCheck, UserRound } from 'lucide-react';
import { Link, useParams } from 'react-router-dom';
import { PageContainer } from '../../components/layout/PageContainer';
import { Button } from '../../components/ui/Button';
import { settingsService } from './settings.service';
import { ROLE_LABELS } from './settings.types';
import styles from './Settings.module.css';

const formatDate = (value?: string | null) => value ? new Intl.DateTimeFormat('es-MX', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value)) : 'Sin registro';

export function UserDetailPage() {
  const { id = '' } = useParams();
  const [data, setData] = useState<any>(null); const [impact, setImpact] = useState<any>(null);
  const [loading, setLoading] = useState(true); const [error, setError] = useState(''); const [editing, setEditing] = useState(false); const [confirmSuspend, setConfirmSuspend] = useState(false);
  const [form, setForm] = useState({ nombre: '', apellido: '', rol: 'ABOGADO', activo: true });
  const load = async () => { setLoading(true); setError(''); try { const [record, dependencies] = await Promise.all([settingsService.user(id), settingsService.userImpact(id)]); setData(record); setImpact(dependencies); setForm({ nombre: record.user.nombre, apellido: record.user.apellido, rol: record.user.rol, activo: record.user.activo }); } catch (reason) { setError(reason instanceof Error ? reason.message : 'No fue posible cargar el usuario.'); } finally { setLoading(false); } };
  useEffect(() => { void load(); }, [id]);
  const save = async (confirm_impact = false) => { try { await settingsService.updateUser(id, { ...form, confirm_impact }); setEditing(false); setConfirmSuspend(false); await load(); } catch (reason: any) { if (reason?.status === 409 && !form.activo) setConfirmSuspend(true); else setError(reason instanceof Error ? reason.message : 'No fue posible actualizar el usuario.'); } };
  if (loading) return <PageContainer title="Usuario"><div className={styles.state} role="status">Cargando detalle seguro…</div></PageContainer>;
  if (error || !data) return <PageContainer title="Usuario"><div className={`${styles.state} ${styles.errorState}`} role="alert"><strong>No pudimos abrir este usuario</strong><span>{error}</span><Button onClick={load}>Reintentar</Button></div></PageContainer>;
  const user = data.user;
  return <PageContainer title={`${user.nombre} ${user.apellido}`} subtitle="Detalle de acceso, estado y actividad de la cuenta." action={<Link className={styles.backLink} to="/configuracion/usuarios"><ArrowLeft size={17} />Volver a usuarios</Link>}>
    <div className={styles.sectionStack}>
      <section className={styles.formCard}><div className={styles.profileHeader}><div className={styles.avatarXL}>{user.nombre[0]}{user.apellido[0]}</div><div><h2>{user.nombre} {user.apellido}</h2><p>{user.email}</p><span className={`${styles.status} ${styles[user.status.toLowerCase()]}`}>{user.status.replaceAll('_', ' ')}</span></div><Button variant="secondary" onClick={() => setEditing((value) => !value)}>{editing ? 'Cancelar' : 'Editar acceso'}</Button></div>
        <div className={styles.detailGrid}><label>Nombre<input disabled={!editing} value={form.nombre} onChange={(e) => setForm({ ...form, nombre: e.target.value })} /></label><label>Apellido<input disabled={!editing} value={form.apellido} onChange={(e) => setForm({ ...form, apellido: e.target.value })} /></label><label>Rol<select disabled={!editing} value={form.rol} onChange={(e) => setForm({ ...form, rol: e.target.value })}>{Object.entries(ROLE_LABELS).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label><span><small>Sesiones activas</small><strong>{data.active_sessions}</strong></span><span><small>Último acceso</small><strong>{formatDate(user.last_login_at)}</strong></span><span><small>Alta</small><strong>{formatDate(user.created_at)}</strong></span></div>
        {editing && <div className={styles.accountControls}><label><input type="checkbox" checked={form.activo} onChange={(e) => setForm({ ...form, activo: e.target.checked })} /><span><strong>Cuenta activa</strong><small>Al suspender se revocan todas sus sesiones.</small></span></label><Button onClick={() => save(false)}>Guardar cambios</Button></div>}
      </section>
      <div className={styles.metricsRow}><div><FolderOpen /><span>Expedientes activos</span><strong>{impact.active_assignments.expedientes}</strong></div><div><ShieldCheck /><span>Tareas pendientes</span><strong>{impact.active_assignments.tasks}</strong></div><div><CalendarDays /><span>Eventos futuros</span><strong>{impact.active_assignments.events}</strong></div></div>
      <section className={styles.tableCard}><div className={styles.cardHeader}><div><h2>Actividad reciente</h2><p>Historial conservado aun cuando la cuenta se suspenda.</p></div></div>{data.recent_activity.length ? <div className={styles.auditList}>{data.recent_activity.map((item: any) => <article key={item.id}><div className={styles.auditIcon}><UserRound size={17} /></div><span><strong>{item.accion.replaceAll('_', ' ')}</strong><small>{item.entidad}</small></span><time>{formatDate(item.created_at)}</time></article>)}</div> : <div className={styles.state}>Sin actividad reciente.</div>}</section>
    </div>
    {confirmSuspend && <div className={styles.overlay}><section className={styles.modal} role="alertdialog" aria-modal="true" aria-labelledby="impact-title"><header><div><h2 id="impact-title">Confirmar suspensión con impacto</h2><p>La cuenta tiene trabajo activo. No se reasignará automáticamente.</p></div></header><div className={styles.impactWarning}><ShieldAlert /><p>{impact.active_assignments.expedientes} expedientes, {impact.active_assignments.tasks} tareas y {impact.active_assignments.events} eventos continuarán registrados a nombre de esta persona. Reasigna desde cada módulo antes o después de suspender.</p></div><div className={styles.modalActions}><Button variant="secondary" onClick={() => setConfirmSuspend(false)}>Cancelar</Button><Button onClick={() => save(true)}>Suspender y revocar sesiones</Button></div></section></div>}
  </PageContainer>;
}
