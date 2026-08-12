import type { PropsWithChildren, ReactNode } from 'react';
import { AlertCircle, RotateCcw } from 'lucide-react';
import { Skeleton } from '../../../components/ui/Skeleton';
import styles from './WidgetCard.module.css';

type WidgetCardProps = PropsWithChildren<{
  id?: string;
  title: string;
  action?: ReactNode;
  badge?: number;
  className?: string;
}>;

export function WidgetCard({ id, title, action, badge, className = '', children }: WidgetCardProps) {
  return (
    <section id={id} className={`${styles.card} ${className}`}>
      <header className={styles.header}>
        <div className={styles.titleRow}>
          <h2>{title}</h2>
          {typeof badge === 'number' && badge > 0 && <span className={styles.badge}>{badge}</span>}
        </div>
        {action && <div className={styles.action}>{action}</div>}
      </header>
      <div className={styles.content}>{children}</div>
    </section>
  );
}

export function WidgetLoading({ rows = 3 }: { rows?: number }) {
  return (
    <div className={styles.loading} role="status" aria-label="Cargando información">
      {Array.from({ length: rows }, (_, index) => <Skeleton key={index} className={index === rows - 1 ? styles.shortSkeleton : ''} />)}
    </div>
  );
}

export function WidgetEmpty({ children }: PropsWithChildren) {
  return <div className={styles.empty}><span aria-hidden="true" />{children}</div>;
}

export function WidgetError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className={styles.error} role="alert">
      <AlertCircle size={18} aria-hidden="true" />
      <div><p>{message}</p><button type="button" onClick={onRetry}><RotateCcw size={14} />Reintentar</button></div>
    </div>
  );
}
