import { useRef, useState } from 'react';
import { ArrowRight, Check, Circle, LoaderCircle } from 'lucide-react';
import { Link } from 'react-router-dom';
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
};

export function ProspectWorkflowPanel({ prospect, workflow: w, canWrite, onChanged }: {
  prospect: Prospect;
  workflow: ProspectWorkflow;
  canWrite: boolean;
  onChanged: () => Promise<void>;
}) {
  const [pending, setPending] = useState<ProspectWorkflowAction | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const lock = useRef(false);
  const attempts = useRef(new Map<ProspectWorkflowAction, string>());
  const currentIndex = w.stages.findIndex((stage) => stage.code === w.stage);
  const primaryCode = primaryByStage[w.stage ?? ''];
  const primary = w.actions.find((action) => action.code === primaryCode);
  const exceptional = w.actions.filter((action) => action.code === 'SUSPENDER' || action.code === 'CANCELAR');

  const confirm = async () => {
    if (!pending || lock.current) return;
    lock.current = true;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const key = attempts.current.get(pending) ?? crypto.randomUUID();
      attempts.current.set(pending, key);
      await prospectsService.act(prospect.id, {
        action: pending,
        expectedVersion: w.version,
        confirm: true,
        idempotencyKey: key,
        ...(pending === 'SUSPENDER' || pending === 'CANCELAR' ? { reason: 'Confirmado desde la ficha de trabajo' } : {}),
      });
      attempts.current.delete(pending);
      setPending(null);
      await onChanged();
      setNotice(pending === 'CONVERTIR' ? 'Cotización creada y vinculada.' : 'Etapa actualizada y registrada.');
    } catch (caught) {
      setError(humanError(caught));
    } finally {
      lock.current = false;
      setBusy(false);
    }
  };

  return <section className={styles.panel} aria-label="Flujo Prospecto a Cotización" aria-busy={busy}>
    <header><div><p className={styles.eyebrow}>Flujo Prospecto → Cotización{w.folio ? ` · ${w.folio}` : ''}</p><h2>{w.stageLabel}</h2><p>Etapa registrada: {dateTime(w.stageEnteredAt)}</p></div></header>
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
      : canWrite && primary ? <button type="button" className={styles.primaryAction} disabled={busy} onClick={() => { setPending(primary.code); setError(''); }}>{primary.label}</button>
        : <p className={styles.info}>No hay una acción operativa disponible en esta etapa.</p>}

    {exceptional.length > 0 && <details className={styles.exceptional}><summary>Acciones excepcionales</summary><div className={styles.actions}>{exceptional.map((action) => <button type="button" key={action.code} disabled={busy} onClick={() => setPending(action.code)}>{action.label}</button>)}</div></details>}

    {pending && <div className={styles.confirmation} role="group" aria-label="Confirmar acción">
      <h3>{w.actions.find((action) => action.code === pending)?.label}</h3>
      <p>{pending === 'CONVERTIR' ? 'Se creará exactamente una cotización real con los datos, documentos y preparación económica de esta ficha.' : 'La acción registrará usuario, fecha y hora en el historial.'}</p>
      <div className={styles.actions}><button type="button" className={styles.primaryAction} disabled={busy} onClick={() => void confirm()}>{busy && <LoaderCircle className={styles.spin} size={16} />}{busy ? 'Guardando…' : 'Confirmar'}</button><button type="button" disabled={busy} onClick={() => setPending(null)}>Cancelar</button></div>
    </div>}
    {error && <p className={styles.error} role="alert">{error}</p>}
    {notice && <p role="status">{notice}</p>}

    <details><summary>Actividad de etapas ({w.events.length})</summary>{w.events.length ? <ol className={styles.history}>{w.events.map((event) => <li key={event.id}><strong>{event.previousLabel} → {event.nextLabel}</strong><p>{dateTime(event.effectiveAt)} · {event.actor}</p><small>{event.actionLabel} · {event.provenanceLabel}</small></li>)}</ol> : <p>No hay transiciones contractuales acreditadas.</p>}</details>
  </section>;
}
