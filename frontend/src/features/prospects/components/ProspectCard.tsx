import { CalendarClock, FileText } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import type { Prospect } from '../prospects.types';
import { STATE_LABELS } from '../prospects.types';
import styles from '../ProspectsPage.module.css';

const daysSince = (value: string) => Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 86_400_000));
const priorityLabel = { ALTA: 'Alta', MEDIA: 'Media', BAJA: 'Baja' } as const;

export function ProspectCard({ prospect }: { prospect: Prospect }) {
  const navigate = useNavigate();
  const latest = prospect.seguimientos?.[0];
  const inactivity = daysSince(latest?.created_at ?? prospect.updated_at);
  const trigger = !latest?.proxima_accion ? 'SIN_SIGUIENTE_ACCION' : inactivity >= 7 ? 'PROSPECTO_ESTANCADO' : prospect.estado === 'COTIZACION_ENVIADA' ? 'COTIZACION_PENDIENTE' : undefined;
  return (
    <button className={styles.prospectCard} type="button" onClick={() => navigate(`/prospectos/${prospect.id}`)} data-ai-trigger={trigger} aria-label={`Abrir prospecto ${prospect.nombre}`}>
      <span className={styles.cardTop}><strong>{prospect.nombre}</strong><span className={`${styles.priority} ${styles[`priority${prospect.prioridad}`]}`}>{priorityLabel[prospect.prioridad]}</span></span>
      <span className={styles.cardMeta}><FileText size={14} aria-hidden="true" />{prospect.tipo_acto || 'Servicio por definir'}</span>
      <span className={styles.cardAction}><CalendarClock size={14} aria-hidden="true" /><span><small>Siguiente acción</small>{latest?.proxima_accion || 'Sin siguiente acción'}</span></span>
      <span className={styles.cardFooter}><span className={styles.cardState}>{STATE_LABELS[prospect.estado]}</span><span>{inactivity === 0 ? 'Actividad hoy' : `${inactivity} d sin actividad`}</span></span>
    </button>
  );
}
