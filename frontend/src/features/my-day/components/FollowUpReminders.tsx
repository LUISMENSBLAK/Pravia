import { FileCheck2, PhoneCall, UserRound } from 'lucide-react';
import { Link } from 'react-router-dom';
import type { Reminder } from '../myDay.types';
import { formatRelativeDate } from '../formatters';
import { WidgetCard, WidgetEmpty, WidgetError, WidgetLoading } from './WidgetCard';
import styles from './MyDayWidgets.module.css';

const icons = { document: FileCheck2, call: PhoneCall, person: UserRound };

export function FollowUpReminders({ items, loading, error, onRetry, className }: { items: Reminder[]; loading: boolean; error?: string; onRetry: () => void; className?: string }) {
  return (
    <WidgetCard title="Recordatorios de seguimiento" className={className}>
      {loading ? <WidgetLoading rows={3} /> : error ? <WidgetError message="No pudimos cargar los recordatorios." onRetry={onRetry} /> : items.length === 0 ? (
        <WidgetEmpty>Todo al día.</WidgetEmpty>
      ) : (
        <ul className={styles.compactList}>
          {items.slice(0, 3).map((item) => {
            const Icon = icons[item.kind ?? 'document'];
            const content = <><span className={`${styles.itemIcon} ${styles.infoIcon}`}><Icon size={16} aria-hidden="true" /></span><div className={styles.itemCopy}><strong>{item.title}</strong>{item.context && <p>{item.context}</p>}</div>{item.dueAt && <time className={styles.reminderDate}>{formatRelativeDate(item.dueAt)}</time>}</>;
            return <li key={item.id}>{item.href ? <Link className={styles.rowLink} to={item.href}>{content}</Link> : content}</li>;
          })}
        </ul>
      )}
    </WidgetCard>
  );
}
