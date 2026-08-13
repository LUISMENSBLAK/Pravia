import { CalendarPlus } from 'lucide-react';
import type { AgendaEvent } from '../agenda.types';
import { dateKey, dateKeyInZone, eventTime, eventTypeLabel } from '../agenda.utils';
import styles from '../Agenda.module.css';

export function DayCalendar({ date, events, timezone, canWrite, onOpen, onNew }: { date: Date; events: AgendaEvent[]; timezone: string; canWrite: boolean; onOpen(event: AgendaEvent): void; onNew(): void }) {
  const items=events.filter((event)=>dateKeyInZone(event.fecha_inicio,timezone)===dateKey(date)).sort((a,b)=>+new Date(a.fecha_inicio)-+new Date(b.fecha_inicio));
  return <section className={styles.dayCalendar} aria-label="Agenda del día"><header><span>{new Intl.DateTimeFormat('es-MX',{weekday:'long'}).format(date)}</span><strong>{date.getDate()}</strong><small>{new Intl.DateTimeFormat('es-MX',{month:'long',year:'numeric'}).format(date)}</small></header>{items.length?<ol>{items.map((event)=><li key={event.id}><time>{eventTime(event,timezone).split(' – ')[0]}</time><i className={styles[`dot_${event.tipo}`]}/><button type="button" onClick={()=>onOpen(event)} aria-label={`${eventTime(event,timezone)}, ${eventTypeLabel(event.tipo)}, ${event.titulo}`}><span><strong>{event.titulo}</strong><small>{event.expediente?.tipo_acto?.nombre||event.compareciente_nombre||eventTypeLabel(event.tipo)}</small></span><em>{event.responsable_nombre}</em><b>{eventTypeLabel(event.tipo)}</b></button></li>)}</ol>:<div className={styles.dayEmpty}><span><CalendarPlus/></span><strong>No hay eventos programados.</strong><p>Este día está disponible dentro de tu agenda.</p>{canWrite&&<button type="button" className={styles.primaryButton} onClick={onNew}>Crear cita</button>}</div>}</section>;
}

