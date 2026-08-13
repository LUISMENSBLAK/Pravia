import {
  AlertTriangle, CalendarClock, CheckCircle2, Clock3, FileText, MapPin, Pencil,
  RotateCcw, UserRound, X, XCircle,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { agendaService } from '../agenda.service';
import type { AgendaEvent } from '../agenda.types';
import { eventDurationMinutes, eventStatusLabel, eventTime, eventTypeLabel } from '../agenda.utils';
import styles from '../Agenda.module.css';

export function EventDrawer({ id, canWrite, timezone, onClose, onEdit, onChanged }: {
  id: string; canWrite: boolean; timezone: string; onClose(): void;
  onEdit(event: AgendaEvent): void; onChanged(): void;
}) {
  const [event, setEvent] = useState<AgendaEvent | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [cancelling, setCancelling] = useState(false);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  useEffect(() => {
    const controller = new AbortController();
    setStatus('loading');
    agendaService.detail(id, controller.signal)
      .then((result) => { setEvent(result.evento); setStatus('ready'); })
      .catch(() => setStatus('error'));
    return () => controller.abort();
  }, [id]);

  const cancel = async () => {
    if (reason.trim().length < 5) { setMessage('Escribe un motivo de al menos 5 caracteres.'); return; }
    setBusy(true);
    try { await agendaService.cancel(id, reason); onChanged(); onClose(); }
    catch (error: any) { setMessage(error?.message || 'No pudimos cancelar el evento.'); }
    finally { setBusy(false); }
  };

  return <div className={styles.drawerBackdrop} role="presentation">
    <aside className={styles.eventDrawer} role="dialog" aria-modal="true" aria-labelledby="event-detail-title">
      <header>
        <div><span>DETALLE DEL EVENTO</span><h2 id="event-detail-title">{event?.titulo || 'Evento'}</h2>
          {event && <p><i className={styles[`dot_${event.tipo}`]} />{eventTypeLabel(event.tipo)} · {eventStatusLabel(event.estatus)}</p>}
        </div>
        <button type="button" aria-label="Cerrar" onClick={onClose}><X /></button>
      </header>
      {status === 'loading' && <div className={styles.drawerState}><CalendarClock className={styles.spin} />Cargando evento…</div>}
      {status === 'error' && <div className={styles.drawerState}><AlertTriangle /><strong>No pudimos cargar el evento.</strong><button type="button" onClick={onClose}>Cerrar</button></div>}
      {status === 'ready' && event && <div className={styles.eventDetailBody}>
        <section className={styles.eventHero}><CalendarClock /><div><small>Fecha y hora programadas</small>
          <strong>{new Intl.DateTimeFormat('es-MX', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: timezone }).format(new Date(event.fecha_inicio))}</strong>
          <span>{eventTime(event, timezone)} · {eventDurationMinutes(event)} min</span></div>
        </section>
        <dl className={styles.eventFacts}>
          <div><dt><UserRound />Responsable</dt><dd>{event.responsable_nombre}</dd></div>
          <div><dt><FileText />Expediente</dt><dd>{event.expediente?.numero_pravia || 'Sin expediente relacionado'}{event.expediente?.tipo_acto && <small>{event.expediente.tipo_acto.nombre}</small>}</dd></div>
          <div><dt><MapPin />Notaría</dt><dd>{event.notaria?.nombre || 'Sin notaría derivada'}{event.notaria && <small>{event.notaria.ciudad || event.notaria.municipio}, {event.notaria.entidad_federativa}</small>}</dd></div>
          <div><dt><UserRound />Compareciente</dt><dd>{event.compareciente_nombre || 'Sin compareciente relacionado'}</dd></div>
        </dl>
        {event.tipo === 'FIRMA' && <section className={styles.signatureDates}>
          <h3>Firma programada vs. efectiva</h3>
          <div><span><CalendarClock /></span><p><small>Programada</small><strong>{eventTime(event, timezone)}</strong></p></div>
          <div data-complete={Boolean(event.firma?.efectiva)}><span>{event.firma?.efectiva ? <CheckCircle2 /> : <Clock3 />}</span><p><small>Realizada efectivamente</small><strong>{event.firma?.efectiva ? new Intl.DateTimeFormat('es-MX', { dateStyle: 'medium', timeStyle: 'short', timeZone: timezone }).format(new Date(event.firma.efectiva)) : 'Aún no registrada'}</strong></p></div>
          <p>Una cita programada nunca se convierte automáticamente en una firma realizada.</p>
        </section>}
        {event.descripcion && <section className={styles.eventNotes}><h3>Notas</h3><p>{event.descripcion}</p></section>}
        {event.motivo_cancelacion && <p className={styles.cancelledNote}><XCircle />Motivo de cancelación: {event.motivo_cancelacion}</p>}
        {cancelling && <section className={styles.cancelBox}><label>Motivo de cancelación<textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={3} /></label>{message && <p role="alert">{message}</p>}<div><button type="button" className={styles.secondaryButton} onClick={() => setCancelling(false)}>Volver</button><button type="button" className={styles.dangerButton} disabled={busy} onClick={() => void cancel()}>{busy ? 'Cancelando…' : 'Confirmar cancelación'}</button></div></section>}
      </div>}
      {status === 'ready' && event && canWrite && event.estatus !== 'CANCELADO' && !cancelling && <footer>
        <button type="button" className={styles.secondaryButton} onClick={() => onEdit(event)}><Pencil size={15} />Editar</button>
        <button type="button" className={styles.secondaryButton} onClick={() => onEdit(event)}><RotateCcw size={15} />Reprogramar</button><span />
        <button type="button" className={styles.cancelButton} onClick={() => setCancelling(true)}>Cancelar evento</button>
      </footer>}
    </aside>
  </div>;
}
