import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { addDays, dateKey, dateKeyInZone, eventEnd, sameDay, startOfMonth, startOfWeek } from '../agenda.utils';
import { agendaService } from '../agenda.service';
import type { AgendaEvent, AgendaTask } from '../agenda.types';
import styles from '../Agenda.module.css';

export function MiniCalendar({ selected, onSelect, timezone = 'America/Mexico_City', selectedUsers = [], tasks = [], revision = 0 }: {
  selected: Date; onSelect(date: Date): void; timezone?: string; selectedUsers?: string[]; tasks?: AgendaTask[]; revision?: number;
}) {
  const [month, setMonth] = useState(() => startOfMonth(selected));
  useEffect(() => { setMonth(startOfMonth(selected)); }, [selected.getMonth(), selected.getFullYear()]);
  const days = useMemo(() => { const start = startOfWeek(month); return Array.from({ length: 42 }, (_, index) => addDays(start, index)); }, [month]);
  const [events, setEvents] = useState<Pick<AgendaEvent, 'fecha_inicio' | 'fecha_fin' | 'estatus' | 'user_id'>[]>([]);
  const [now, setNow] = useState(Date.now);
  const [refresh, setRefresh] = useState(0);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30_000);
    const update = () => { setNow(Date.now()); setRefresh(value => value + 1); };
    window.addEventListener('pravia:data-changed', update); window.addEventListener('focus', update);
    return () => { clearInterval(timer); window.removeEventListener('pravia:data-changed', update); window.removeEventListener('focus', update); };
  }, []);
  useEffect(() => {
    const controller = new AbortController(); setEvents([]); setFailed(false);
    // Fetch the displayed month through the same permission-scoped API, not
    // just the selected week. Never infer the existence of private events.
    agendaService.markers(days[0], addDays(days[41], 1), controller.signal)
      .then(result => { if (!controller.signal.aborted) setEvents(result.eventos); })
      .catch(() => { if (!controller.signal.aborted) setFailed(true); });
    return () => controller.abort();
  }, [days, revision, refresh]);
  const marked = useMemo(() => new Set(days.filter(day => {
    const key = dateKey(day);
    return events.some(event => event.estatus === 'ACTIVO' && +eventEnd(event) > now
      && (!selectedUsers.length || !!event.user_id && selectedUsers.includes(event.user_id))
      && dateKeyInZone(event.fecha_inicio, timezone) <= key && dateKeyInZone(new Date(+eventEnd(event) - 1), timezone) >= key)
      || tasks.some(task => task.fecha_limite && ['PENDIENTE', 'EN_PROCESO'].includes(task.estatus)
        && +new Date(task.fecha_limite) > now && (!selectedUsers.length || selectedUsers.includes(task.asignado_a.id))
        && dateKeyInZone(task.fecha_limite, timezone) === key);
  }).map(dateKey)), [days, events, tasks, selectedUsers, timezone, now]);
  const today = new Date(now);
  return <section className={styles.miniCalendar} aria-label="Calendario mensual">
    <header><button type="button" aria-label="Mes anterior" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))}><ChevronLeft/></button><strong>{new Intl.DateTimeFormat('es-MX', { month: 'long', year: 'numeric' }).format(month)}</strong><button type="button" aria-label="Mes siguiente" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))}><ChevronRight/></button></header>
    <div className={styles.weekdayRow}>{['L','M','M','J','V','S','D'].map((day,index) => <span key={`${day}-${index}`}>{day}</span>)}</div>
    <div className={styles.monthDays}>{days.map(day => <button key={dateKey(day)} type="button" aria-label={`${new Intl.DateTimeFormat('es-MX', { dateStyle: 'full' }).format(day)}${marked.has(dateKey(day)) ? ' · Con pendientes' : ''}`} aria-pressed={sameDay(day, selected)} data-outside={day.getMonth() !== month.getMonth()} data-today={sameDay(day, today)} onClick={() => onSelect(day)}>{day.getDate()}{marked.has(dateKey(day)) && <i className={styles.pendingDayDot} aria-hidden="true"/>}</button>)}</div>
    {failed && <p className={styles.calendarMarkerError} role="status">No se pudieron consultar los indicadores del mes.</p>}
  </section>;
}

