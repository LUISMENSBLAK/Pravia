import { Building2, UserRound, Users } from 'lucide-react';
import styles from '../Comparecientes.module.css';

export function ComparecienteMetrics({ metrics, active, onSelect }: { metrics: { total: number; physical: number; legal: number }; active: string; onSelect(value: string): void }) {
  const items = [
    { key: '', label: 'Total comparecientes', value: metrics.total, icon: Users, tone: 'gold' },
    { key: 'FISICA', label: 'Personas físicas', value: metrics.physical, icon: UserRound, tone: 'green' },
    { key: 'MORAL', label: 'Personas morales', value: metrics.legal, icon: Building2, tone: 'amber' },
  ];
  return <section className={styles.metrics} aria-label="Resumen de comparecientes">{items.map(({ key, label, value, icon: Icon, tone }) => <button key={label} type="button" className={`${styles.metric} ${styles[`metric_${tone}`]} ${active === key ? styles.metricActive : ''}`} onClick={() => onSelect(key)} aria-pressed={active === key}><span><Icon size={20} /></span><div><small>{label}</small><strong>{Number(value ?? 0).toLocaleString('es-MX')}</strong><em>{key ? 'Por tipo de persona' : 'Registros visibles'}</em></div></button>)}</section>;
}
