import { CheckCircle2, FileCheck2, FilePenLine, FolderKanban, Layers3, Scale } from 'lucide-react';
import type { ExpedienteMetric } from '../expedientes.types';
import styles from '../Expedientes.module.css';
const icons = [Layers3, FolderKanban, FilePenLine, FileCheck2, CheckCircle2, Scale];
export function ExpedienteMetrics({ metrics, active, onSelect }: { metrics: ExpedienteMetric[]; active?: string; onSelect(key: string): void }) {
  return <section className={styles.metrics} aria-label="Resumen de expedientes">{metrics.map((metric, index) => { const Icon = icons[index] || Scale; return <button type="button" key={metric.key} className={`${styles.metric} ${styles[`metric${metric.key}`]} ${active === metric.key ? styles.metricActive : ''}`} onClick={() => onSelect(metric.key)} aria-pressed={active === metric.key}>
    <span className={styles.metricCopy}><small>{metric.label}</small><strong>{metric.value.toLocaleString('es-MX')}</strong><em>{metric.percentage === null ? metric.key === 'TOTAL' ? 'Registros disponibles' : 'Sin datos' : `${metric.percentage}% del total`}</em></span><span className={styles.metricIcon}><Icon size={20} /></span>
  </button>; })}</section>;
}
