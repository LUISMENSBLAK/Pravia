import { FolderClosed } from 'lucide-react';
import { Link } from 'react-router-dom';
import type { RecentFile } from '../myDay.types';
import { formatRelativeDate } from '../formatters';
import { WidgetCard, WidgetEmpty, WidgetError, WidgetLoading } from './WidgetCard';
import styles from './MyDayWidgets.module.css';

export function RecentFiles({ items, loading, error, onRetry, className }: { items: RecentFile[]; loading: boolean; error?: string; onRetry: () => void; className?: string }) {
  return (
    <WidgetCard title="Expedientes recientes" action={<Link to="/expedientes">Ver todos</Link>} className={className}>
      {loading ? <WidgetLoading rows={4} /> : error ? <WidgetError message="No pudimos cargar los expedientes recientes." onRetry={onRetry} /> : items.length === 0 ? (
        <WidgetEmpty>No hay expedientes recientes.</WidgetEmpty>
      ) : (
        <ul className={`${styles.compactList} ${styles.recentList}`}>
          {items.slice(0, 4).map((item) => (
            <li key={item.id}>
              <FolderClosed className={styles.folderIcon} size={17} aria-hidden="true" />
              <Link className={styles.itemCopy} to={item.href ?? `/expedientes/${item.id}`}>
                <strong>{item.fileNumber}</strong>
                {(item.act || item.summary) && <p>{[item.act, item.summary].filter(Boolean).join(' · ')}</p>}
              </Link>
              <div className={styles.itemMeta}>{item.status && <span>{item.status}</span>}{item.updatedAt && <time>{formatRelativeDate(item.updatedAt)}</time>}</div>
            </li>
          ))}
        </ul>
      )}
    </WidgetCard>
  );
}
