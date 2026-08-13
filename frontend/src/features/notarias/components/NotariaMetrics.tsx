import { Building2, CheckCircle2, FolderKanban, XCircle } from 'lucide-react';
import styles from '../Notarias.module.css';

export function NotariaMetrics({ metrics, active, onSelect }: { metrics: { total: number; active: number; inactive: number; withActiveCases: number }; active: string; onSelect(value: string): void }) {
  const items = [
    { key: '', label: 'Total de notarías', value: metrics.total, note: 'Directorio registrado', icon: Building2, tone: 'gold' },
    { key: 'ACTIVA', label: 'Activas', value: metrics.active, note: 'Disponibles para operación', icon: CheckCircle2, tone: 'green' },
    { key: 'INACTIVA', label: 'Inactivas', value: metrics.inactive, note: 'Fuera de operación', icon: XCircle, tone: 'red' },
    { key: 'WITH_CASES', label: 'Con expedientes activos', value: metrics.withActiveCases, note: 'No incluye entregados o cancelados', icon: FolderKanban, tone: 'blue' },
  ];
  return <section className={styles.metrics} aria-label="Resumen de notarías">{items.map((item) => { const Icon = item.icon; const selected = item.key === 'WITH_CASES' ? active === item.key : active === item.key; return <button key={item.label} type="button" className={`${styles.metric} ${styles[`metric_${item.tone}`]} ${selected ? styles.metricActive : ''}`} onClick={() => onSelect(item.key)}><span><Icon size={20} /></span><div><small>{item.label}</small><strong>{item.value.toLocaleString('es-MX')}</strong><em>{item.note}</em></div></button>; })}</section>;
}
