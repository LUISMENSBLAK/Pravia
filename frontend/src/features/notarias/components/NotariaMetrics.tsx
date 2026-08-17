import { Building2, MapPinned } from 'lucide-react';
import styles from '../Notarias.module.css';

export function NotariaMetrics({ metrics }: { metrics: { total: number; nayarit: number; jalisco: number } }) {
  const items = [
    { label: 'Total de notarías', value: metrics.total, note: 'Todas las notarías registradas', icon: Building2, tone: 'gold' },
    { label: 'Notarías Nayarit', value: metrics.nayarit, note: 'Entidad federativa registrada: Nayarit', icon: MapPinned, tone: 'blue' },
    { label: 'Notarías Jalisco', value: metrics.jalisco, note: 'Entidad federativa registrada: Jalisco', icon: MapPinned, tone: 'green' },
  ];
  return <section className={styles.metrics} aria-label="Resumen de notarías">{items.map((item) => { const Icon = item.icon; return <article key={item.label} className={`${styles.metric} ${styles[`metric_${item.tone}`]}`}><span><Icon size={20} /></span><div><small>{item.label}</small><strong>{item.value.toLocaleString('es-MX')}</strong><em>{item.note}</em></div></article>; })}</section>;
}
