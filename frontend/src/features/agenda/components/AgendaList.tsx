import { CalendarDays, Clock3, FolderKanban, UserRound } from 'lucide-react';
import type { AgendaEvent } from '../agenda.types';
import { eventStatusLabel, eventTime, eventTypeLabel } from '../agenda.utils';
import styles from '../Agenda.module.css';

export function AgendaList({ events, timezone, canWrite, onOpen, onNew }: { events: AgendaEvent[]; timezone: string; canWrite: boolean; onOpen(event: AgendaEvent): void; onNew(): void }) {
  const sorted=[...events].sort((a,b)=>+new Date(a.fecha_inicio)-+new Date(b.fecha_inicio));
  return <section className={styles.agendaList} aria-label="Lista cronológica de eventos">{sorted.length?sorted.map((event)=><button type="button" key={event.id} onClick={()=>onOpen(event)} className={event.estatus==='CANCELADO'?styles.listCancelled:''}><i className={styles[`dot_${event.tipo}`]}/><time><CalendarDays size={14}/>{new Intl.DateTimeFormat('es-MX',{weekday:'short',day:'numeric',month:'short',timeZone:timezone}).format(new Date(event.fecha_inicio))}<small><Clock3 size={12}/>{eventTime(event,timezone)}</small></time><span><strong>{event.titulo}</strong><small>{eventTypeLabel(event.tipo)} · {eventStatusLabel(event.estatus)}</small></span><span><UserRound size={14}/>{event.responsable_nombre}</span><span><FolderKanban size={14}/>{event.expediente?.numero_pravia||'Sin expediente'}</span></button>):<div className={styles.dayEmpty}><strong>No hay eventos programados.</strong>{canWrite&&<button type="button" className={styles.primaryButton} onClick={onNew}>Crear cita</button>}</div>}</section>;
}
