import { useRef, useState } from 'react';
import { ArrowRight, Check, Circle, LoaderCircle } from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import { ApiError } from '../../../services/api/client';
import { prospectsService } from '../prospects.service';
import type { Prospect, ProspectWorkflow, ProspectWorkflowAction } from '../prospects.types';
import styles from '../ProspectWorkflow.module.css';

const dateTime = (value: string | null) => value
  ? new Intl.DateTimeFormat('es-MX', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value))
  : 'Fecha de etapa no acreditada';
const humanError = (error: unknown) => error instanceof ApiError && error.status < 500
  ? error.message
  : 'No pudimos confirmar la operación. Puedes reintentar: no se duplicará.';
const primaryByStage: Record<string, ProspectWorkflowAction | undefined> = {
  NUEVO: 'COMENZAR_INTEGRACION',
  EN_INTEGRACION: 'MARCAR_LISTO_PARA_COTIZAR',
  LISTO_PARA_COTIZAR: 'CONVERTIR',
  SUSPENDIDO: 'REACTIVAR',
  CANCELADO: 'REACTIVAR',
};

export function ProspectWorkflowPanel({ prospect, workflow: w, canWrite, blocked = false, currentUserId, onChanged }: {
  prospect: Prospect;
  workflow: ProspectWorkflow;
  canWrite: boolean;
  blocked?: boolean;
  currentUserId?: string;
  onChanged: () => Promise<void>;
}) {
  const navigate = useNavigate();
  const [pending, setPending] = useState<ProspectWorkflowAction | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [reason, setReason] = useState('');
  const [quoteAssigneeId, setQuoteAssigneeId] = useState('');
  const lock = useRef(false);
  const attempts = useRef(new Map<ProspectWorkflowAction, string>());
  const currentIndex = w.stages.findIndex((stage) => stage.code === w.stage);
  const primaryCode = primaryByStage[w.stage ?? ''];
  const primary = w.actions.find((action) => action.code === primaryCode);
  const exceptional = w.actions.filter((action) => action.code === 'SUSPENDER' || action.code === 'CANCELAR');
  const requiresAssignee = pending === 'MARCAR_LISTO_PARA_COTIZAR' || (pending === 'CONVERTIR' && !w.quoteAssignee);

  const confirm = async () => {
    if (!pending || lock.current || blocked) return;
    if (requiresAssignee && !quoteAssigneeId) { setError('Selecciona quién continuará con la cotización.'); return; }
    lock.current = true;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const key = attempts.current.get(pending) ?? crypto.randomUUID();
      attempts.current.set(pending, key);
      const result = await prospectsService.act(prospect.id, {
        action: pending,
        expectedVersion: w.version,
        confirm: true,
        idempotencyKey: key,
        ...(['SUSPENDER', 'CANCELAR', 'REACTIVAR'].includes(pending) ? { reason: reason.trim() } : {}),
        ...(requiresAssignee ? { quoteAssigneeId } : {}),
      });
      attempts.current.delete(pending);
      if (pending === 'CONVERTIR' && result.quoteId) {
        navigate(`/cotizaciones/${encodeURIComponent(result.quoteId)}`);
        return;
      }
      setPending(null);
      setReason('');
      setQuoteAssigneeId('');
      await onChanged();
      setNotice(pending === 'CONVERTIR' ? 'Cotización creada y vinculada.' : 'Etapa actualizada y registrada.');
    } catch (caught) {
      setError(humanError(caught));
    } finally {
      lock.current = false;
      setBusy(false);
    }
  };

  return <section className={styles.panel} aria-label="Flujo Prospecto a Cotización" aria-busy={busy || blocked}>
    <header><div><p className={styles.eyebrow}>Prospecto → Cotización</p><h2>Progreso / flujo</h2><p>Etapa actual: {w.stageLabel} · {dateTime(w.stageEnteredAt)}</p></div></header>
    {w.knowledge === 'UNKNOWN_LEGACY' && <p className={styles.info}>Registro histórico sin equivalencia demostrable. Se conserva en modo de consulta y no se le asigna una etapa nueva automáticamente.</p>}
    <ol className={styles.progress} aria-label="Progreso del prospecto">
      {w.stages.map((stage, index) => {
        const completed = currentIndex >= 0 && index < currentIndex;
        const current = stage.code === w.stage;
        return <li key={stage.code} data-complete={completed || undefined} aria-current={current ? 'step' : undefined}>
          <span>{completed ? <Check size={16} /> : <Circle size={14} />}</span><strong>{stage.label}</strong>{index < w.stages.length - 1 && <ArrowRight size={15} aria-hidden="true" />}
        </li>;
      })}
    </ol>

    {w.quote ? <div className={styles.quoteReady}><div><strong>{w.quote.numero_cotizacion || 'Cotización creada'}</strong><p>La relación con este prospecto está guardada.</p></div><Link to={`/cotizaciones/${encodeURIComponent(w.quote.id)}`}>Ir a cotización</Link></div>
      : canWrite && primary ? <button type="button" className={styles.primaryAction} disabled={busy || blocked} onClick={() => { setPending(primary.code); setError(''); }}>{primary.label}</button>
        : <p className={styles.info}>No hay una acción operativa disponible en esta etapa.</p>}

    {pending && <div className={styles.confirmation} role="group" aria-label="Confirmar acción">
      <h3>{w.actions.find((action) => action.code === pending)?.label}</h3>
      <p>{pending === 'CONVERTIR' ? 'Se creará exactamente una cotización real, se notificará a la persona asignada y se abrirá esa misma ficha sin recaptura.' : 'La acción registrará usuario, fecha y hora en el historial.'}</p>
      {requiresAssignee && <label>¿Quién continuará con la cotización?<select required value={quoteAssigneeId} onChange={(event) => setQuoteAssigneeId(event.target.value)}><option value="">Selecciona una persona autorizada</option>{w.quoteAssignees?.map((person) => <option key={person.id} value={person.id}>{person.id === currentUserId ? 'Yo · ' : ''}{[person.nombre, person.apellido].filter(Boolean).join(' ')}</option>)}</select></label>}
      {pending === 'CONVERTIR' && w.quoteAssignee && <p>Responsable de cotización: {[w.quoteAssignee.nombre, w.quoteAssignee.apellido].filter(Boolean).join(' ')}</p>}
      {['SUSPENDER', 'CANCELAR', 'REACTIVAR'].includes(pending) && <label>Motivo{pending === 'REACTIVAR' ? ' (opcional)' : ''}<textarea required={pending !== 'REACTIVAR'} maxLength={500} value={reason} onChange={(event) => setReason(event.target.value)} /></label>}
      <div className={styles.actions}><button type="button" className={styles.primaryAction} disabled={busy || blocked || (requiresAssignee && !quoteAssigneeId) || (['SUSPENDER', 'CANCELAR'].includes(pending) && !reason.trim())} onClick={() => void confirm()}>{busy && <LoaderCircle className={styles.spin} size={16} />}{busy ? 'Guardando…' : 'Confirmar'}</button><button type="button" disabled={busy} onClick={() => { setPending(null); setReason(''); setQuoteAssigneeId(''); }}>Cancelar</button></div>
    </div>}
    {error && <p className={styles.error} role="alert">{error}</p>}
    {notice && <p role="status">{notice}</p>}
    {exceptional.length > 0 && <div className={styles.exceptional}><div className={styles.actions}>{exceptional.map((action) => <button type="button" key={action.code} disabled={busy || blocked} onClick={() => { setPending(action.code); setError(''); }}>{action.label}</button>)}</div></div>}
  </section>;
}

export function ProspectStageActivity({ workflow }: { workflow: ProspectWorkflow }) {
  return <section className={styles.panel} aria-label="Actividad de etapas"><header><div><h2>Actividad de etapas</h2><p>Transiciones automáticas acreditadas ({workflow.events.length}).</p></div></header>{workflow.events.length ? <ol className={styles.history}>{workflow.events.map((event) => <li key={event.id}><strong>{event.previousLabel} → {event.nextLabel}</strong><p>{dateTime(event.effectiveAt)} · {event.actor}</p><small>{event.actionLabel} · {event.provenanceLabel}</small></li>)}</ol> : <p>No hay transiciones contractuales acreditadas.</p>}</section>;
}
