import type { AgendaEvent } from '../agenda.types';
import { addDays, dateKey, dateKeyInZone, sameDay, startOfMonth, startOfWeek } from '../agenda.utils';
import styles from '../Agenda.module.css';

export function MonthCalendar({ date, events, timezone, onDay, onOpen }: { date: Date; events: AgendaEvent[]; timezone: string; onDay(date: Date): void; onOpen(event: AgendaEvent): void }) {
  const month=startOfMonth(date);const first=startOfWeek(month);const days=Array.from({length:42},(_,index)=>addDays(first,index));const today=new Date();
  return <section className={styles.monthCalendar} aria-label="Vista mensual"><header>{['Lun','Mar','Mié','Jue','Vie','Sáb','Dom'].map((day)=><span key={day}>{day}</span>)}</header><div>{days.map((day)=>{const items=events.filter((event)=>dateKeyInZone(event.fecha_inicio,timezone)===dateKey(day));return <article key={dateKey(day)} data-outside={day.getMonth()!==month.getMonth()} data-today={sameDay(day,today)}><button type="button" className={styles.monthDayNumber} onClick={()=>onDay(day)} aria-label={`Ver ${new Intl.DateTimeFormat('es-MX',{dateStyle:'full'}).format(day)}`}>{day.getDate()}</button>{items.slice(0,2).map((event)=><button type="button" key={event.id} className={`${styles.monthEvent} ${styles[`type_${event.tipo}`]}`} onClick={()=>onOpen(event)}>{event.titulo}</button>)}{items.length>2&&<button type="button" className={styles.moreEvents} onClick={()=>onDay(day)}>+{items.length-2} más</button>}</article>})}</div></section>;
}

