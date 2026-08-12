import { CircleAlert, ClipboardCheck } from 'lucide-react';
import { Link } from 'react-router-dom';
import type { UrgentTask } from '../myDay.types';
import { WidgetCard, WidgetEmpty, WidgetError, WidgetLoading } from './WidgetCard';
import styles from './MyDayWidgets.module.css';

export function UrgentTasks({ items, loading, error, onRetry, className }: { items: UrgentTask[]; loading: boolean; error?: string; onRetry: () => void; className?: string }) {
  return (
    <WidgetCard id="tareas-urgentes" title="Tareas urgentes" action={<Link to="/mi-dia#tareas-urgentes">Ver todas</Link>} className={className}>
      {loading ? <WidgetLoading rows={4} /> : error ? <WidgetError message="No pudimos cargar las tareas urgentes." onRetry={onRetry} /> : items.length === 0 ? (
        <WidgetEmpty>No tienes tareas urgentes.</WidgetEmpty>
      ) : (
        <ul className={`${styles.compactList} ${styles.taskList}`}>
          {items.slice(0, 3).map((item) => {
            const Icon = item.priority === 'urgent' ? CircleAlert : ClipboardCheck;
            const content = <><span className={`${styles.itemIcon} ${item.priority === 'urgent' ? styles.dangerIcon : styles.goldIcon}`}><Icon size={16} aria-hidden="true" /></span><div className={styles.itemCopy}><strong>{item.title}</strong>{item.context && <p>{item.context}</p>}{item.reference && <small>{item.reference}</small>}</div><span className={item.priority === 'urgent' ? styles.urgentLabel : styles.pendingLabel}>{item.priority === 'urgent' ? 'Urgente' : 'Pendiente'}</span></>;
            return <li key={item.id}>{item.href ? <Link className={styles.rowLink} to={item.href}>{content}</Link> : content}</li>;
          })}
        </ul>
      )}
    </WidgetCard>
  );
}
