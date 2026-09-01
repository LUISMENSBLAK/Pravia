import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { CalendarClock, CheckCircle2, ChevronDown, History, ShieldCheck, X } from 'lucide-react';
import { Button } from '../../../components/ui/Button';
import { Input } from '../../../components/ui/Input';
import { useAuth } from '../../auth/AuthProvider';
import { settingsService } from '../settings.service';
import type { TimingPolicyDefinition, TimingPolicyUnit } from './timing.types';
import styles from './TimingPolicies.module.css';

const domainLabel = { COMMERCIAL: 'Comercial', ADMINISTRATIVE: 'Administrativa' } as const;
const unitLabel = { HOURS: 'horas', DAYS: 'días' } as const;
const calendarLabel = { ELAPSED_UTC: 'Tiempo transcurrido (UTC)' } as const;
const formatDate = (value: string) => new Intl.DateTimeFormat('es-MX', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));

function PublicationDialog({ policy, onClose, onPublished }: { policy: TimingPolicyDefinition; onClose: () => void; onPublished: () => void }) {
  const titleId = useId();
  const descriptionId = useId();
  const dialogRef = useRef<HTMLElement>(null);
  const firstInput = useRef<HTMLInputElement>(null);
  const [duration, setDuration] = useState('');
  const [unit, setUnit] = useState<TimingPolicyUnit | ''>('');
  const [calendarSemantics, setCalendarSemantics] = useState<'ELAPSED_UTC' | ''>('');
  const [provenance, setProvenance] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    firstInput.current?.focus();
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !saving) {
        onClose();
        return;
      }
      if (event.key !== 'Tab') return;
      const focusable = Array.from(dialogRef.current?.querySelectorAll<HTMLElement>(
        'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      ) ?? []);
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onClose, saving]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const parsedDuration = Number(duration);
    if (!Number.isInteger(parsedDuration) || parsedDuration < 1) { setError('Captura una duración entera mayor a cero.'); firstInput.current?.focus(); return; }
    if (!unit || !calendarSemantics || !provenance.trim()) { setError('Completa la unidad, el cómputo y la procedencia.'); return; }
    setSaving(true); setError('');
    try {
      await settingsService.publishTimingPolicy({ policyType: policy.type, duration: parsedDuration, unit, calendarSemantics, provenance: provenance.trim() });
      onPublished();
      onClose();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'No fue posible publicar la revisión.');
    } finally { setSaving(false); }
  };

  return <div className={styles.overlay} onMouseDown={(event) => { if (event.target === event.currentTarget && !saving) onClose(); }}>
    <section ref={dialogRef} className={styles.dialog} role="dialog" aria-modal="true" aria-labelledby={titleId} aria-describedby={descriptionId}>
      <header>
        <div><span>Nueva revisión</span><h2 id={titleId}>{policy.label}</h2><p id={descriptionId}>La publicación será inmutable y solo aplicará a intervalos que inicien después de publicarla.</p></div>
        <button type="button" onClick={onClose} disabled={saving} aria-label="Cerrar"><X size={20} /></button>
      </header>
      <form onSubmit={submit}>
        <div className={styles.formGrid}>
          <Input ref={firstInput} id="timing-duration" label="Duración" inputMode="numeric" pattern="[0-9]*" min="1" step="1" value={duration} onChange={(event) => setDuration(event.target.value)} placeholder="Captura un valor" />
          <label>Unidad<select value={unit} onChange={(event) => setUnit(event.target.value as TimingPolicyUnit | '')} required><option value="">Selecciona una unidad</option><option value="HOURS">Horas</option><option value="DAYS">Días</option></select></label>
          <label>Cómputo temporal<select value={calendarSemantics} onChange={(event) => setCalendarSemantics(event.target.value as 'ELAPSED_UTC' | '')} required><option value="">Selecciona el cómputo</option><option value="ELAPSED_UTC">Tiempo transcurrido (UTC)</option></select></label>
          <label className={styles.fullField}>Procedencia<textarea value={provenance} onChange={(event) => setProvenance(event.target.value)} maxLength={500} required placeholder="Acuerdo, política o decisión administrativa que respalda esta configuración" /></label>
        </div>
        <div className={styles.notice}><ShieldCheck size={18} /><span><strong>Aplicación no retroactiva</strong><small>Los intervalos ya abiertos conservarán la revisión que capturaron al iniciar.</small></span></div>
        {error && <p className={styles.error} role="alert">{error}</p>}
        <footer><Button type="button" variant="secondary" onClick={onClose} disabled={saving}>Cancelar</Button><Button type="submit" disabled={saving}>{saving ? 'Publicando…' : 'Publicar revisión'}</Button></footer>
      </form>
    </section>
  </div>;
}

function PolicyCard({ policy, canManage, onConfigure }: { policy: TimingPolicyDefinition; canManage: boolean; onConfigure: () => void }) {
  const [historyOpen, setHistoryOpen] = useState(false);
  const current = policy.current;
  return <article className={styles.card}>
    <div className={styles.cardHeader}>
      <span className={styles.icon}><CalendarClock size={20} /></span>
      <div><div className={styles.eyebrow}>{domainLabel[policy.domain]}</div><h2>{policy.label}</h2><p>{policy.description}</p></div>
      <span className={`${styles.status} ${current ? styles.configured : styles.unconfigured}`}>{current ? 'Configurada' : 'No configurada'}</span>
    </div>
    <div className={styles.details}>
      <span><small>Revisión vigente</small><strong>{current ? `Revisión ${current.revision}` : 'Sin publicación'}</strong></span>
      <span><small>Duración</small><strong>{current ? `${current.duration} ${unitLabel[current.unit]}` : 'No definida'}</strong></span>
      <span><small>Cómputo</small><strong>{current ? calendarLabel[current.calendarSemantics] : 'No definido'}</strong></span>
      <span><small>Procedencia</small><strong>{current?.provenance?.source || 'No registrada'}</strong></span>
    </div>
    <div className={styles.cardActions}>
      <button type="button" className={styles.historyButton} aria-expanded={historyOpen} onClick={() => setHistoryOpen((value) => !value)}><History size={17} />Historial ({policy.history.length})<ChevronDown size={16} className={historyOpen ? styles.rotated : ''} /></button>
      {canManage && <Button onClick={onConfigure}>{current ? 'Publicar nueva revisión' : 'Configurar política'}</Button>}
    </div>
    {historyOpen && <div className={styles.history}>
      {policy.history.length === 0 ? <p>No existen revisiones publicadas.</p> : policy.history.map((revision) => <div key={revision.id}>
        <CheckCircle2 size={17} /><span><strong>Revisión {revision.revision} · {revision.duration} {unitLabel[revision.unit]}</strong><small>{calendarLabel[revision.calendarSemantics]} · Publicada {formatDate(revision.publishedAt)}{revision.supersededAt ? ` · Sustituida ${formatDate(revision.supersededAt)}` : ' · Vigente'}</small><em>{revision.provenance?.source || 'Procedencia no registrada'}</em></span>
      </div>)}
    </div>}
  </article>;
}

export function TimingPolicies() {
  const { user } = useAuth();
  const canManage = Boolean(user?.permissions?.includes('configuracion.actos_tiempos.manage'));
  const [policies, setPolicies] = useState<TimingPolicyDefinition[]>([]);
  const [selected, setSelected] = useState<TimingPolicyDefinition | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [announcement, setAnnouncement] = useState('');
  const triggerRef = useRef<HTMLElement | null>(null);

  const load = async () => {
    setLoading(true); setError('');
    try { setPolicies(await settingsService.timingPolicies()); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'No fue posible cargar las políticas.'); }
    finally { setLoading(false); }
  };
  useEffect(() => { void load(); }, []);
  const open = (policy: TimingPolicyDefinition) => { triggerRef.current = document.activeElement as HTMLElement; setSelected(policy); };
  const close = () => { setSelected(null); window.setTimeout(() => triggerRef.current?.focus(), 0); };
  const published = () => { setAnnouncement('La revisión se publicó correctamente.'); void load(); };

  if (loading) return <div className={styles.state} role="status"><span />Cargando políticas de tiempo…</div>;
  if (error) return <div className={`${styles.state} ${styles.errorState}`} role="alert"><strong>No pudimos cargar las políticas</strong><p>{error}</p><Button variant="secondary" onClick={() => void load()}>Reintentar</Button></div>;
  return <div className={styles.page}>
    <section className={styles.intro}><div><span>Configuración organizacional</span><h2>Políticas de tiempo</h2><p>Define tiempos comerciales y administrativos sin modificar intervalos históricos. Una organización puede operar sin políticas configuradas.</p></div><div className={styles.count}><strong>{policies.filter((policy) => policy.current).length}</strong><span>de 5 configuradas</span></div></section>
    {!canManage && <div className={styles.readOnly}><ShieldCheck size={18} /><span><strong>Vista de consulta</strong><small>Tu rol permite consultar las políticas, pero no publicar revisiones.</small></span></div>}
    {announcement && <p className={styles.success} role="status">{announcement}</p>}
    <div className={styles.grid}>{policies.map((policy) => <PolicyCard key={policy.type} policy={policy} canManage={canManage} onConfigure={() => open(policy)} />)}</div>
    {selected && <PublicationDialog policy={selected} onClose={close} onPublished={published} />}
  </div>;
}
