import { Link } from 'react-router-dom';
import type { MiDiaLayoutItem } from '../miDiaConfiguration.service';
import type { MyDayData } from '../myDay.types';
import { WidgetCard, WidgetEmpty, WidgetError, WidgetLoading } from './WidgetCard';
import styles from './ProcessCard.module.css';

type CountedSource = { count: number; available?: boolean; items: Array<{ href: string }> };
const attentionKeys = new Set([
  'OVERDUE_PROCESSES', 'DUE_TODAY', 'CASES_DELAYED', 'CASES_BLOCKED', 'NOT_READY_TO_SIGN',
  'MISSING_DOCUMENTS', 'EXPIRED_DOCUMENTS', 'DOCUMENT_INCONSISTENCIES',
  'NOTICES_OVERDUE', 'CRITICAL_ALERTS', 'PAYMENTS_DUE', 'PAYMENTS_UNPROVEN',
]);

/** Only configured, visible OWN cards participate; hidden/organization data is never summarized. */
export function buildOwnDaySummary(data: MyDayData, layout: MiDiaLayoutItem[], names: Record<string, string>,
  mode: 'summary' | 'attention' = 'summary') {
  const sources: Record<string, CountedSource | null | undefined> = {
    ...data.processCards, ...data.caseCards, ...data.commercialCards,
    ...data.financeCards, ...data.documentCards, ...data.complianceCards,
  };
  const errors: Record<string, string | undefined> = data.errors;
  const own = layout.filter((item) => item.scope === 'OWN' && item.key !== 'DAY_SUMMARY'
    && item.key !== 'NEEDS_ATTENTION' && (mode === 'summary' || attentionKeys.has(item.key))
    && Object.prototype.hasOwnProperty.call(sources, item.key));
  const failed = own.filter((item) => Boolean(errors[item.key]) || !sources[item.key]
    || sources[item.key]?.available === false);
  const items = own.flatMap((item) => {
    const source = sources[item.key];
    if (!source || source.available === false || errors[item.key] || !Number.isInteger(source.count) || source.count <= 0) return [];
    return [{ key: item.key, name: names[item.key] ?? item.key, count: source.count,
      href: source.items[0]?.href ?? null }];
  });
  return { items, failed: failed.length, connected: own.length };
}

export function DaySummary({ data, layout, names, loading, error, onRetry, mode = 'summary' }: {
  data?: MyDayData | null; layout: MiDiaLayoutItem[]; names: Record<string, string>;
  loading: boolean; error?: string; onRetry: () => void; mode?: 'summary' | 'attention';
}) {
  const summary = data ? buildOwnDaySummary(data, layout, names, mode) : null;
  return <WidgetCard title={mode === 'attention' ? 'Requieren mi atención' : 'Resumen de mi día'}>
    {loading ? <WidgetLoading rows={3} /> : error || !summary
      ? <WidgetError message={error || 'No pudimos cargar tu resumen.'} onRetry={onRetry} />
      : <>
        {summary.failed > 0 && <p role="status">{summary.failed} fuente{summary.failed === 1 ? '' : 's'} sin cargar. El resumen es parcial.</p>}
        {summary.connected === 0 ? <WidgetEmpty>{mode === 'attention'
          ? 'Agrega tarjetas de alertas o pendientes de alcance propio para revisar tu atención.'
          : 'Agrega tarjetas de alcance propio para preparar tu resumen.'}</WidgetEmpty>
          : summary.items.length === 0 ? <WidgetEmpty>{mode === 'attention'
            ? 'No hay señales pendientes en tus tarjetas de atención visibles.'
            : 'No hay elementos pendientes en tus tarjetas propias visibles.'}</WidgetEmpty>
            : <ul className={styles.list}>{summary.items.map((item) => <li key={item.key}>
              {item.href ? <Link to={item.href}><span><strong>{item.name}</strong><small>{item.count} en tu alcance</small></span></Link>
                : <span><strong>{item.name}</strong><small>{item.count} en tu alcance</small></span>}
            </li>)}</ul>}
      </>}
  </WidgetCard>;
}
