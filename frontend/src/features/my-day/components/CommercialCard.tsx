import { Link } from 'react-router-dom';
import { WidgetCard, WidgetEmpty, WidgetError, WidgetLoading } from './WidgetCard';
import type { CommercialCardData } from '../myDay.types';
import { formatCurrency } from '../formatters';
import styles from './ProcessCard.module.css';

export function CommercialCard({ title, data, loading, error, onRetry }: {
  title: string; data?: CommercialCardData | null; loading: boolean; error?: string; onRetry: () => void;
}) {
  return <WidgetCard title={title} badge={data?.count}>
    {loading ? <WidgetLoading rows={3} /> : error || !data
      ? <WidgetError message={error || 'No pudimos consultar el flujo comercial.'} onRetry={onRetry} />
      : data.amount !== undefined ? <>
        {data.count === 0 ? <WidgetEmpty>No hay cotizaciones en esta condición dentro de tu alcance.</WidgetEmpty>
          : <><p className={styles.total}>{data.amount === null ? 'Sin importe vigente' : formatCurrency(Number(data.amount))}</p>
            <p className={styles.total}>{data.count} {data.count === 1 ? 'cotización' : 'cotizaciones'} en total</p>
            <ul className={styles.list}>{data.items.map((item) => <li key={item.id}>
              <Link to={item.href} aria-label={`Abrir ${item.folio}`}><span><strong>{item.folio}</strong><small>{item.cliente}</small></span></Link>
            </li>)}</ul></>}
      </>
      : data.denominator !== undefined ? <>
        {data.denominator === 0 ? <WidgetEmpty>No hay registros en la cohorte de este periodo.</WidgetEmpty>
          : <p className={styles.total}>{data.rate}% · {data.count} de {data.denominator} conversiones</p>}
        {data.count > 0 && <ul className={styles.list}>{data.items.map((item) => <li key={item.id}>
          <Link to={item.href} aria-label={`Abrir ${item.folio}`}><span><strong>{item.folio}</strong><small>{item.cliente}</small></span></Link>
        </li>)}</ul>}
      </>
      : data.count === 0 ? <WidgetEmpty>No hay registros en esta condición dentro de tu alcance.</WidgetEmpty>
        : <><p className={styles.total}>{data.count} {data.count === 1 ? 'registro' : 'registros'} en total</p>
          <ul className={styles.list}>{data.items.map((item) => <li key={item.id}>
            <Link to={item.href} aria-label={`Abrir ${item.folio}`}>
              <span><strong>{item.folio}</strong><small>{item.cliente}</small>
                {item.contexto && <small>{item.contexto}</small>}</span>
            </Link>
          </li>)}</ul></>}
  </WidgetCard>;
}
