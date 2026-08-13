import { CheckCircle2, ClipboardCheck, ListChecks, TriangleAlert } from 'lucide-react';
import styles from '../Compliance.module.css';

export function ComplianceMetrics({ metrics }: { metrics: { requieren_revision: number; pendientes: number; observaciones: number; confirmadas: number } }) {
  const items = [
    { label: 'Requieren revisión', value: metrics.requieren_revision, detail: 'Borrador o pendiente', icon: ListChecks, tone: 'blue' },
    { label: 'Pendientes', value: metrics.pendientes, detail: 'Esperan confirmación', icon: ClipboardCheck, tone: 'gold' },
    { label: 'Con observaciones', value: metrics.observaciones, detail: 'Requieren ajustes', icon: TriangleAlert, tone: 'red' },
    { label: 'Confirmadas', value: metrics.confirmadas, detail: 'Decisión humana registrada', icon: CheckCircle2, tone: 'green' },
  ];
  return <section className={styles.metrics} aria-label="Indicadores de cumplimiento">{items.map(({ icon: Icon, ...item }) => <article key={item.label} data-tone={item.tone}><span><Icon /></span><div><small>{item.label}</small><strong>{item.value}</strong><p>{item.detail}</p></div></article>)}</section>;
}
