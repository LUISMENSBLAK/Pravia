import { useState } from 'react';
import { Link } from 'react-router-dom';
import type { FinanceCardData } from '../myDay.types';
import { formatCurrency } from '../formatters';
import { WidgetCard, WidgetEmpty, WidgetError, WidgetLoading } from './WidgetCard';
import styles from './ProcessCard.module.css';

export function FinanceCard({ title, data, loading, error, onRetry, emptyMessage, itemLabel = 'movimiento', itemPluralLabel, note, expandable = false, sourceHref }: {
  title: string; data?: FinanceCardData | null; loading: boolean; error?: string; onRetry: () => void;
  emptyMessage?: string; itemLabel?: string; itemPluralLabel?: string; note?: string; expandable?: boolean; sourceHref?: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const visibleItems = expandable && !expanded ? data?.items.slice(0, 5) ?? [] : data?.items ?? [];
  return <WidgetCard title={title} badge={data?.count}>
    {loading ? <WidgetLoading rows={3} /> : error || !data
      ? <WidgetError message={error || 'No pudimos consultar los movimientos de Finanzas.'} onRetry={onRetry} />
      : data.available === false ? <><WidgetEmpty>{data.message || 'Sin información: falta configurar la fuente financiera.'}</WidgetEmpty>
        {sourceHref && <Link to={sourceHref}>Revisar fuente en Finanzas</Link>}</>
      : !data.count ? <WidgetEmpty>{emptyMessage || 'No hay ingresos recibidos en este periodo dentro de tu alcance.'}</WidgetEmpty>
      : <><p className={styles.total}>{formatCurrency(Number(data.amount))} · {data.count} {data.count === 1 ? itemLabel : itemPluralLabel || `${itemLabel}s`}</p>
        {note && <p className={styles.hint}>{note}</p>}
        <ul className={styles.list}>{visibleItems.map((item) => <li key={item.id}>
          <Link to={item.href} aria-label={`Abrir ${item.folio}`}><span><strong>{item.folio}</strong>
            <small>{item.concepto}</small></span><span><strong>{formatCurrency(Number(item.amount))}</strong></span></Link>
        </li>)}</ul>
        {expandable && data.items.length > 5 && <button type="button" onClick={() => setExpanded((value) => !value)}
          aria-expanded={expanded}>{expanded ? 'Mostrar menos' : `Ver los ${data.items.length} expedientes`}</button>}</>}
  </WidgetCard>;
}
