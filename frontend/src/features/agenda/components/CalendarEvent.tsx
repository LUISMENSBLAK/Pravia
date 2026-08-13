import { eventTime, eventTypeLabel } from '../agenda.utils';
import type { CSSProperties } from 'react';
import type { AgendaEvent } from '../agenda.types';
import styles from '../Agenda.module.css';

export function CalendarEvent({ event, compact=false, onOpen, style, timezone }: { event: AgendaEvent; compact?: boolean; onOpen(event: AgendaEvent): void; style?: CSSProperties; timezone?: string }) {
  const typeClass = styles[`type_${event.tipo}`] || styles.type_OTRO;
  return <button type="button" title={event.titulo} style={style} className={`${styles.calendarEvent} ${typeClass} ${compact?styles.eventCompact:''} ${event.estatus==='CANCELADO'?styles.eventCancelled:''}`} aria-label={`${eventTime(event,timezone)}, ${eventTypeLabel(event.tipo)}, ${event.titulo}. Abrir para ver el texto completo.`} onClick={()=>onOpen(event)}><time>{eventTime(event,timezone)}</time><strong>{event.titulo}</strong>{!compact&&<span>{event.expediente?.tipo_acto?.nombre||event.expediente?.numero_pravia||event.compareciente_nombre||'Sin vínculo'}</span>}<em><i/>{eventTypeLabel(event.tipo)}</em></button>;
}
