import { Link } from 'react-router-dom';
import type { UserLoadData } from '../myDay.types';
import { WidgetCard, WidgetEmpty, WidgetError, WidgetLoading } from './WidgetCard';
import styles from './ProcessCard.module.css';

export function UserLoadCard({ data, loading, error, onRetry }: {
  data?: UserLoadData | null; loading: boolean; error?: string; onRetry: () => void;
}) {
  return <WidgetCard title="Carga por usuario" badge={data?.count}>
    {loading ? <WidgetLoading rows={3} /> : error || !data
      ? <WidgetError message={error || 'No pudimos consultar la carga por usuario.'} onRetry={onRetry} />
      : data.count === 0 ? <WidgetEmpty>No hay usuarios activos en esta notaría.</WidgetEmpty>
        : <><p className={styles.total}>{data.count} usuarios activos; expedientes y procesos se muestran por separado.</p>
          <ul className={styles.list}>{data.items.map((item) => <li key={item.id}>
            <Link to={item.href} aria-label={`Abrir reporte de ${item.nombre}`}>
              <span><strong>{item.nombre}</strong><small>{item.expedientes} expedientes activos · {item.procesos} procesos en alcance</small></span>
            </Link>
          </li>)}</ul></>}
  </WidgetCard>;
}
