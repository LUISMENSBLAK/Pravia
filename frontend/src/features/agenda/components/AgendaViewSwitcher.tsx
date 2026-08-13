import type { AgendaView } from '../agenda.types';
import styles from '../Agenda.module.css';

const views: Array<[AgendaView, string]> = [['day', 'Día'], ['week', 'Semana'], ['month', 'Mes'], ['list', 'Lista']];
export function AgendaViewSwitcher({ value, onChange }: { value: AgendaView; onChange(value: AgendaView): void }) {
  return <div className={styles.viewSwitcher} role="tablist" aria-label="Vista de agenda">{views.map(([key, label]) => <button key={key} type="button" role="tab" aria-selected={value === key} className={value === key ? styles.viewActive : ''} onClick={() => onChange(key)}>{label}</button>)}</div>;
}

