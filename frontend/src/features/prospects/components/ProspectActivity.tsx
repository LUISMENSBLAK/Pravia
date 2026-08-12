import { CalendarClock, Mail, MessageSquareText, Phone, Users } from 'lucide-react';
import type { ProspectFollowUp } from '../prospects.types';
import styles from '../ProspectsPage.module.css';

const iconFor = (type: string) => {
  const value = type.toLowerCase();
  if (value.includes('llamada')) return Phone;
  if (value.includes('correo')) return Mail;
  if (value.includes('reun')) return Users;
  return MessageSquareText;
};

const formatDate = (value: string) => new Intl.DateTimeFormat('es-MX', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));

export function ProspectActivity({ followUps }: { followUps: ProspectFollowUp[] }) {
  if (!followUps.length) return <div className={styles.activityEmpty}><MessageSquareText size={24} /><strong>Sin actividad registrada</strong><p>Los seguimientos aparecerán aquí, del más reciente al más antiguo.</p></div>;
  return <ol className={styles.timeline}>{followUps.map((item) => { const Icon = iconFor(item.tipo); return <li key={item.id}><span><Icon size={17} /></span><div><header><strong>{item.tipo}</strong><time dateTime={item.created_at}>{formatDate(item.created_at)}</time></header><p>{item.contenido}</p>{item.proxima_accion && <small><CalendarClock size={14} />Siguiente: {item.proxima_accion}{item.fecha_proximo_seguimiento ? ` · ${new Intl.DateTimeFormat('es-MX', { dateStyle: 'medium' }).format(new Date(item.fecha_proximo_seguimiento))}` : ''}</small>}<em>{item.usuario?.nombre || 'Usuario de PRAVIA OS'}</em></div></li>; })}</ol>;
}
