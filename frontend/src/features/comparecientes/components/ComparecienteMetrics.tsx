import { AlertCircle, Clock3, ShieldCheck, Users } from 'lucide-react';
import styles from '../Comparecientes.module.css';

export function ComparecienteMetrics({ metrics, active, onSelect }: { metrics: { total: number; verified: number; pending: number; observed: number }; active: string; onSelect(value: string): void }) {
  const items = [
    { key: '', label: 'Total comparecientes', value: metrics.total, icon: Users, tone: 'gold' },
    { key: 'VERIFICADA', label: 'Identidad verificada', value: metrics.verified, icon: ShieldCheck, tone: 'green' },
    { key: 'PENDIENTE', label: 'Pendientes', value: metrics.pending, icon: Clock3, tone: 'amber' },
    { key: 'OBSERVACION', label: 'Con observación', value: metrics.observed, icon: AlertCircle, tone: 'red' },
  ];
  return <section className={styles.metrics} aria-label="Resumen de comparecientes">{items.map(({ key, label, value, icon: Icon, tone }) => <button key={label} type="button" className={`${styles.metric} ${styles[`metric_${tone}`]} ${active === key ? styles.metricActive : ''}`} onClick={() => onSelect(key)} aria-pressed={active === key}><span><Icon size={20} /></span><div><small>{label}</small><strong>{value.toLocaleString('es-MX')}</strong><em>{key === 'VERIFICADA' ? 'Confirmación humana vigente' : key === 'OBSERVACION' ? 'Requieren revisión' : key === 'PENDIENTE' ? 'Sin validación completa' : 'Registros visibles'}</em></div></button>)}</section>;
}
