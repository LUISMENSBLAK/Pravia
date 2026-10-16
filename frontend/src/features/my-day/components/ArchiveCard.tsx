import { Link } from 'react-router-dom';
import type { ArchiveCardData } from '../myDay.types';
import { WidgetCard, WidgetEmpty, WidgetError, WidgetLoading } from './WidgetCard';
import styles from './ProcessCard.module.css';

export function ArchiveCard({ title, data, loading, error, onRetry }: {
  title: string; data?: ArchiveCardData | null; loading: boolean; error?: string; onRetry: () => void;
}) {
  return <WidgetCard title={title}>
    {loading ? <WidgetLoading rows={1} /> : error || !data
      ? <WidgetError message={error || 'No pudimos consultar Archivo.'} onRetry={onRetry} />
      : !data.available || data.value === null
        ? <><WidgetEmpty>{data.message || 'Archivo no tiene un siguiente número disponible.'}</WidgetEmpty>
          <Link to={data.href}>Revisar fuente en Archivo</Link></>
        : <>{data.value === '0' && data.items ? <WidgetEmpty>{data.message || 'No se asignaron escrituras hoy.'}</WidgetEmpty>
          : <><p className={styles.total}>{data.value}{data.items ? ' escritura(s)' : ''}</p>
            {data.items && <ul className={styles.list}>{data.items.map((item) => <li key={item.id}>
              <Link to={item.href}><span><strong>Escritura {item.numero_escritura} · {item.folio}</strong>
                <small>{item.cliente || 'Sin alias'}</small></span></Link>
            </li>)}</ul>}</>}
          <Link to={data.href}>Abrir Archivo</Link></>}
  </WidgetCard>;
}
