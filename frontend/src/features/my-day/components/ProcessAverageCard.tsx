import { Link } from 'react-router-dom';
import type { ProcessAverageData } from '../myDay.types';
import { WidgetCard, WidgetEmpty, WidgetError, WidgetLoading } from './WidgetCard';
import styles from './ProcessCard.module.css';

export function ProcessAverageCard({ data, loading, error, onRetry }: {
  data?: ProcessAverageData | null; loading: boolean; error?: string; onRetry: () => void;
}) {
  return <WidgetCard title="Tiempo promedio por proceso" badge={data?.count}>
    {loading ? <WidgetLoading rows={3} /> : error || !data
      ? <WidgetError message={error || 'No pudimos consultar los tiempos de procesos.'} onRetry={onRetry} />
      : !data.count ? <WidgetEmpty>No hay procesos completados con inicio y fin verificables en este periodo.</WidgetEmpty>
        : <><p className={styles.total}>{data.count} procesos completados con duración verificable.</p>
          <ul className={styles.list}>{data.items.map((item) => <li key={item.key}>
            <Link to={item.href} aria-label={`Abrir proceso ${item.nombre}`}><span><strong>{item.nombre}</strong>
              <small>{item.procesos} {item.procesos === 1 ? 'proceso' : 'procesos'} · {item.promedio_dias} días {item.unidad === 'HABILES' ? 'hábiles' : 'naturales'} en promedio</small>
            </span></Link>
          </li>)}</ul></>}
  </WidgetCard>;
}
