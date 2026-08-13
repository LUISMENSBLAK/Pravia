import { CalendarPlus, ChevronLeft, ChevronRight } from 'lucide-react';
import type { AgendaView } from '../agenda.types';
import { formatPeriod } from '../agenda.utils';
import { AgendaViewSwitcher } from './AgendaViewSwitcher';
import styles from '../Agenda.module.css';

export function AgendaHeader({ date, view, canWrite, onView, onMove, onToday, onNew }: { date: Date; view: AgendaView; canWrite: boolean; onView(value: AgendaView): void; onMove(amount: number): void; onToday(): void; onNew(): void }) {
  return <header className={styles.agendaHeader}><div className={styles.titleBlock}><h1>Agenda</h1><p>Firmas, citas y compromisos del equipo.</p></div><div className={styles.headerActions}><button type="button" className={styles.todayButton} onClick={onToday}>Hoy</button>{canWrite&&<button type="button" className={styles.primaryButton} onClick={onNew}><CalendarPlus size={17}/>Nueva cita</button>}</div><div className={styles.dateControls}><div className={styles.arrows}><button type="button" aria-label="Periodo anterior" onClick={() => onMove(-1)}><ChevronLeft/></button><button type="button" aria-label="Periodo siguiente" onClick={() => onMove(1)}><ChevronRight/></button></div><strong>{formatPeriod(date, view)}</strong></div><AgendaViewSwitcher value={view} onChange={onView}/></header>;
}

