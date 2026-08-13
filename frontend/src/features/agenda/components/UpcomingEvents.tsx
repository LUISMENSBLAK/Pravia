import { CalendarDays, ChevronRight } from 'lucide-react';
import type { AgendaEvent } from '../agenda.types';
import { eventTime, eventTypeLabel } from '../agenda.utils';
import styles from '../Agenda.module.css';

export function UpcomingEvents({ events, onOpen, onAll, timezone }: { events: AgendaEvent[]; onOpen(event: AgendaEvent): void; onAll(): void; timezone: string }) {
  return <aside className={styles.upcoming}><header><h2>Próximos eventos</h2><span>{events.length}</span></header>{events.length?<ol>{events.slice(0,7).map((event)=><li key={event.id}><button type="button" onClick={()=>onOpen(event)}><i className={styles[`dot_${event.tipo}`]}/><span><strong>{event.titulo}</strong><small>{eventTypeLabel(event.tipo)}{event.expediente?` · ${event.expediente.numero_pravia}`:''}</small><time><CalendarDays size={12}/>{new Intl.DateTimeFormat('es-MX',{weekday:'short',day:'numeric',month:'short',timeZone:timezone}).format(new Date(event.fecha_inicio))} · {eventTime(event,timezone).split(' – ')[0]}</time></span><ChevronRight size={15}/></button></li>)}</ol>:<p className={styles.railEmpty}>No hay eventos próximos en este periodo.</p>}<button type="button" className={styles.railCta} onClick={onAll}>Ver toda la agenda <ChevronRight size={15}/></button></aside>;
}
