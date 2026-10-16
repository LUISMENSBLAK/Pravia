import { Link } from 'react-router-dom';
import { WidgetCard, WidgetEmpty, WidgetError, WidgetLoading } from './WidgetCard';
import type { CaseCardData } from '../myDay.types';
import { formatOperationalStatus } from '../formatters';
import styles from './ProcessCard.module.css';

export function CaseCard({ title, data, loading, error, onRetry, inactive = false }: {
  title: string; data?: CaseCardData | null; loading: boolean; error?: string;
  onRetry: () => void; inactive?: boolean;
}) {
  return <WidgetCard title={title} badge={data?.count}>
    {loading ? <WidgetLoading rows={3} /> : error || !data
      ? <WidgetError message={error || 'No pudimos consultar los expedientes.'} onRetry={onRetry} />
      : data.count === 0 ? <WidgetEmpty>No hay expedientes en esta condición dentro de tu alcance.</WidgetEmpty>
        : <><p className={styles.total}>{data.count} {data.count === 1 ? 'expediente' : 'expedientes'} en total</p>
          <ul className={styles.list}>{data.items.map((item) => <li key={item.id}>
            <Link to={item.href} aria-label={`Abrir ${item.folio}`}>
              <span><strong>{item.folio}</strong><small>{item.cliente || formatOperationalStatus(item.estado)}</small>
                {item.contexto && <small>{inactive ? `Última actividad: ${new Intl.DateTimeFormat('es-MX', { dateStyle: 'medium' }).format(new Date(item.contexto))}` : item.contexto}</small>}
                {inactive && !item.contexto && <small>Sin actividad registrada</small>}
              </span>
            </Link>
          </li>)}</ul></>}
  </WidgetCard>;
}
