import { FileSignature } from 'lucide-react';
import { Link } from 'react-router-dom';
import type { UrgentSignature } from '../myDay.types';
import { formatRelativeDate } from '../formatters';
import { WidgetCard, WidgetEmpty, WidgetError, WidgetLoading } from './WidgetCard';
import styles from './MyDayWidgets.module.css';

export function UrgentSignatures({ items, count, visibleLimit = 3, loading, error, onRetry, className }: {
  items: UrgentSignature[]; count?: number; visibleLimit?: number; loading: boolean; error?: string; onRetry: () => void; className?: string;
}) {
  return (
    <WidgetCard title="Firmas próximas" badge={count} action={<Link to="/expedientes">Ver expedientes</Link>} className={className}>
      {loading ? <WidgetLoading rows={3} /> : error ? <WidgetError message="No pudimos cargar las firmas pendientes." onRetry={onRetry} /> : items.length === 0 ? (
        <WidgetEmpty>Sin firmas pendientes.</WidgetEmpty>
      ) : (
        <ul className={styles.compactList}>
          {items.slice(0, visibleLimit).map((item) => (
            <li key={item.id}>
              <span className={`${styles.itemIcon} ${styles.dangerIcon}`}><FileSignature size={17} aria-hidden="true" /></span>
              <div className={styles.itemCopy}>
                <strong><Link to={`/expedientes/${encodeURIComponent(item.id)}`}>{item.fileNumber}</Link></strong>
                {(item.act || item.context) && <p>{[item.act, item.context].filter(Boolean).join(' · ')}</p>}
                {item.signatureType && <small>{item.signatureType}</small>}
              </div>
              {item.dueAt && <time className={styles.due}>{formatRelativeDate(item.dueAt)}</time>}
            </li>
          ))}
        </ul>
      )}
    </WidgetCard>
  );
}
