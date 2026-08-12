import { Link } from 'react-router-dom';
import type { AgendaItem } from '../myDay.types';
import { formatTime } from '../formatters';
import { WidgetCard, WidgetEmpty, WidgetError, WidgetLoading } from './WidgetCard';
import styles from './MyDayWidgets.module.css';

export function TodayAgenda({ items, loading, error, onRetry, className }: { items: AgendaItem[]; loading: boolean; error?: string; onRetry: () => void; className?: string }) {
  const sorted = [...items].sort((a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime()).slice(0, 5);
  return (
    <WidgetCard title="Agenda del día" action={<Link to="/agenda">Ver agenda completa</Link>} className={className}>
      {loading ? <WidgetLoading rows={5} /> : error ? <WidgetError message="No pudimos cargar tus eventos." onRetry={onRetry} /> : sorted.length === 0 ? (
        <WidgetEmpty>No tienes eventos programados para hoy.</WidgetEmpty>
      ) : (
        <ol className={styles.timeline}>
          {sorted.map((item) => (
            <li key={item.id} className={styles.timelineItem}>
              <time>{formatTime(item.startsAt)}</time>
              <span className={`${styles.timelineDot} ${styles[item.tone ?? 'blue']}`} aria-hidden="true" />
              <div>
                <strong>{item.title}</strong>
                {(item.type || item.fileNumber) && <p>{[item.type, item.fileNumber].filter(Boolean).join(' · ')}</p>}
                {item.context && <small>{item.context}</small>}
              </div>
              {item.status && <span className={styles.status}>{item.status}</span>}
            </li>
          ))}
        </ol>
      )}
    </WidgetCard>
  );
}
