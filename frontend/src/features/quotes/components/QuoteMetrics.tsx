import { BadgeCheck, ChartNoAxesCombined, CircleDollarSign, FileText, Send } from 'lucide-react';
import { Tooltip } from '../../../components/ui/Tooltip';
import { compactMoney, money } from '../quoteFormatters';
import type { QuoteListMeta } from '../quotes.types';
import styles from '../Quotes.module.css';

export function QuoteMetrics({ meta }: { meta: QuoteListMeta }) {
  const items = [
    { label: 'Total cotizaciones', value: String(meta.total), icon: FileText, tone: 'gold' },
    { label: 'Enviadas al cliente', value: String(meta.metrics.sent), icon: Send, tone: 'blue' },
    { label: 'Aceptadas', value: String(meta.metrics.accepted), icon: BadgeCheck, tone: 'green' },
    { label: 'Importe total', value: compactMoney(meta.metrics.totalAmount), exactValue: money(meta.metrics.totalAmount), icon: CircleDollarSign, tone: 'gold' },
    { label: 'Tasa de conversión', value: meta.metrics.conversionRate === null ? '—' : `${meta.metrics.conversionRate}%`, icon: ChartNoAxesCombined, tone: 'purple', help: 'Tasa = cotizaciones aceptadas / cotizaciones enviadas al cliente.' },
  ];
  return <section className={styles.metrics} aria-label="Indicadores de cotizaciones">
    {items.map(({ label, value, exactValue, icon: Icon, tone, help }) => <article className={styles.metric} key={label}>
      <span className={`${styles.metricIcon} ${styles[tone]}`}><Icon size={20} aria-hidden="true" /></span>
      <div><span>{label}{help && <Tooltip label={help}><button className={styles.infoButton} type="button" aria-label={help}>i</button></Tooltip>}</span><strong title={exactValue}>{value}</strong></div>
    </article>)}
  </section>;
}
