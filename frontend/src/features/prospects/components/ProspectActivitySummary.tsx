import { CalendarCheck2, Clock3, MessageSquareMore, UserCheck } from 'lucide-react';
import type { Prospect } from '../prospects.types';
import styles from '../ProspectsPage.module.css';

export function ProspectActivitySummary({ prospects }: { prospects: Prospect[] }) {
  const now = Date.now();
  const stale = prospects.filter((item) => (now - new Date(item.seguimientos?.[0]?.created_at ?? item.updated_at).getTime()) / 86_400_000 >= 7).length;
  const withoutNext = prospects.filter((item) => !item.seguimientos?.[0]?.proxima_accion).length;
  const due = prospects.filter((item) => {
    const date = item.seguimientos?.[0]?.fecha_proximo_seguimiento;
    return date ? new Date(date).getTime() < now : false;
  }).length;
  const accepted = prospects.filter((item) => item.estado === 'ACEPTADO').length;
  const items = [
    { icon: Clock3, value: stale, label: 'Sin actividad por 7+ días' },
    { icon: MessageSquareMore, value: withoutNext, label: 'Sin siguiente acción' },
    { icon: CalendarCheck2, value: due, label: 'Seguimientos vencidos' },
    { icon: UserCheck, value: accepted, label: 'Prospectos aceptados' },
  ];
  return <section className={styles.activitySummary} aria-label="Resumen de actividad comercial"><div><strong>Actividad comercial</strong><span>Señales calculadas con el último seguimiento disponible.</span></div>{items.map(({ icon: Icon, value, label }) => <article key={label}><Icon size={19} /><strong>{value}</strong><span>{label}</span></article>)}</section>;
}
