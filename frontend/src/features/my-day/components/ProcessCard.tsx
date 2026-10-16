import { Link } from 'react-router-dom';
import { WidgetCard, WidgetEmpty, WidgetError, WidgetLoading } from './WidgetCard';
import type { ProcessCardData } from '../myDay.types';
import styles from './ProcessCard.module.css';

export function ProcessCard({ title, data, loading, error, onRetry }: {
  title: string; data?: ProcessCardData | null; loading: boolean; error?: string; onRetry: () => void;
}) {
  return <WidgetCard title={title} badge={data?.count}>
    {loading ? <WidgetLoading rows={3} /> : error || !data
      ? <WidgetError message={error || 'No pudimos consultar Seguimiento.'} onRetry={onRetry} />
      : data.count === 0 ? <WidgetEmpty>No hay procesos en esta condición dentro de tu alcance.</WidgetEmpty>
        : <><p className={styles.total}>{data.count} {data.count === 1 ? 'proceso' : 'procesos'} en total</p>
          <ul className={styles.list}>{data.items.map((item) => <li key={item.id}>
            <Link to={item.href} aria-label={`Abrir ${item.nombre} en ${item.folio}`}>
              <span><strong>{item.nombre}</strong><small>{item.folio} · {item.estado === 'BLOQUEADO' ? 'Bloqueado' : 'Pendiente'}</small></span>
              {item.fecha_objetivo && <time dateTime={item.fecha_objetivo}>
                {new Intl.DateTimeFormat('es-MX', { day: '2-digit', month: 'short' }).format(new Date(item.fecha_objetivo))}
              </time>}
            </Link>
          </li>)}</ul></>}
  </WidgetCard>;
}
