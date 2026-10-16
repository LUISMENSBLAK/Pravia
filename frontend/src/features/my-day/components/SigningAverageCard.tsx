import { Link } from 'react-router-dom';
import type { SigningAverageData } from '../myDay.types';
import { WidgetCard, WidgetEmpty, WidgetError, WidgetLoading } from './WidgetCard';
import styles from './ProcessCard.module.css';

export function SigningAverageCard({ data, loading, error, onRetry }: {
  data?: SigningAverageData | null; loading: boolean; error?: string; onRetry: () => void;
}) {
  return <WidgetCard title="Tiempo promedio a firma" badge={data?.count}>
    {loading ? <WidgetLoading rows={2} /> : error || !data
      ? <WidgetError message={error || 'No pudimos consultar el tiempo a firma.'} onRetry={onRetry} />
      : !data.count || data.promedio_dias_naturales === null
        ? <WidgetEmpty>No hay expedientes firmados con fechas de apertura y firma válidas en este periodo.</WidgetEmpty>
        : <><p className={styles.total}>{data.promedio_dias_naturales} días naturales desde apertura hasta firma real.</p>
          <p className={styles.hint}>{data.count} expedientes con fechas verificables; no es un plazo estimado.</p>
          <ul className={styles.list}>{data.items.map((item) => <li key={item.id}>
            <Link to={item.href} aria-label={`Abrir ${item.folio}`}><span><strong>{item.folio}</strong>
              <small>{item.dias_naturales} días naturales hasta la firma</small></span></Link>
          </li>)}</ul></>}
  </WidgetCard>;
}
