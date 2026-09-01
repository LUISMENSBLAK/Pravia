import { CheckCircle2, FileClock, MessageSquare, Send } from 'lucide-react';
import { shortDate } from '../quoteFormatters';
import type { Quote } from '../quotes.types';
import styles from '../Quotes.module.css';

export function QuoteActivity({ quote }: { quote: Quote }) {
  if (quote.workflow?.events?.length) {
    const events = [...quote.workflow.events].sort((a, b) => new Date(b.effectiveAt).getTime() - new Date(a.effectiveAt).getTime());
    return <section className={styles.detailSection}><header><div><h2>Historia comercial</h2><p>Hechos contractuales confirmados, con fecha efectiva y procedencia.</p></div></header><ol className={styles.activityList}>{events.map((event) => <li key={event.id}><span><CheckCircle2 size={17} /></span><div><strong>{event.actionLabel}</strong><small>{event.previousLabel ? `${event.previousLabel} → ` : ''}{event.nextLabel} · {event.actor || 'Actor registrado'}{event.channel ? ` · ${event.channel}` : ''}</small></div><time>{shortDate(event.effectiveAt)}</time></li>)}</ol></section>;
  }
  const lifecycle = [
    { date: quote.fecha_aceptacion_cliente, title: 'Aceptada por cliente', detail: 'Aceptada por el cliente.', icon: CheckCircle2 },
    { date: quote.fecha_enviada_cliente, title: 'Envío a cliente registrado', detail: 'Compartida con el cliente.', icon: Send },
    { date: quote.fecha_presupuesto_recibido, title: 'Presupuesto recibido', detail: 'Presupuesto recibido de la notaría.', icon: FileClock },
    { date: quote.fecha_solicitud_notaria, title: 'Envío a notaría registrado', detail: 'Solicitud enviada a la notaría.', icon: Send },
    { date: quote.created_at, title: 'Cotización creada', detail: 'Inicio de la cotización.', icon: FileClock },
  ].filter((item): item is { date: string; title: string; detail: string; icon: typeof CheckCircle2 } => Boolean(item.date));
  const activityType = (value: string) => ({ ENVIO_CLIENTE: 'Envío al cliente', ENVIO_NOTARIA: 'Envío a notaría', LLAMADA: 'Llamada', CORREO: 'Correo', NOTA: 'Nota' }[value] ?? 'Seguimiento');
  const activities = [...(quote.seguimientos ?? []).map((item) => ({ id: item.id, date: item.created_at, title: item.resumen, detail: `${activityType(item.tipo)} · ${item.destinatario}`, icon: MessageSquare })), ...lifecycle.map((item) => ({ id: `${item.title}-${item.date}`, date: item.date, title: item.title, detail: item.detail, icon: item.icon }))].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  return <section className={styles.detailSection}><header><div><h2>Actividad</h2><p>Historial de la cotización y sus seguimientos.</p></div></header>{activities.length ? <ol className={styles.activityList}>{activities.map(({ id, date, title, detail, icon: Icon }) => <li key={id}><span><Icon size={17} /></span><div><strong>{title}</strong><small>{detail}</small></div><time>{shortDate(date)}</time></li>)}</ol> : <p className={styles.sectionEmpty}>Sin actividad registrada.</p>}</section>;
}
