import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { addDays, dateKey, sameDay, startOfMonth, startOfWeek } from '../agenda.utils';
import styles from '../Agenda.module.css';

export function MiniCalendar({ selected, onSelect }: { selected: Date; onSelect(date: Date): void }) {
  const [month, setMonth] = useState(() => startOfMonth(selected));
  useEffect(() => { setMonth(startOfMonth(selected)); }, [selected.getMonth(), selected.getFullYear()]);
  const days = useMemo(() => { const start = startOfWeek(month); return Array.from({ length: 42 }, (_, index) => addDays(start, index)); }, [month]);
  const today = new Date();
  return <section className={styles.miniCalendar} aria-label="Calendario mensual"><header><button type="button" aria-label="Mes anterior" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))}><ChevronLeft/></button><strong>{new Intl.DateTimeFormat('es-MX', { month: 'long', year: 'numeric' }).format(month)}</strong><button type="button" aria-label="Mes siguiente" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))}><ChevronRight/></button></header><div className={styles.weekdayRow}>{['L','M','M','J','V','S','D'].map((day,index)=><span key={`${day}-${index}`}>{day}</span>)}</div><div className={styles.monthDays}>{days.map((day)=><button key={dateKey(day)} type="button" aria-label={new Intl.DateTimeFormat('es-MX',{dateStyle:'full'}).format(day)} aria-pressed={sameDay(day,selected)} data-outside={day.getMonth()!==month.getMonth()} data-today={sameDay(day,today)} onClick={()=>onSelect(day)}>{day.getDate()}</button>)}</div></section>;
}

