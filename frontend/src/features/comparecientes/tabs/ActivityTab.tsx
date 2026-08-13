import { Activity } from 'lucide-react';
import type { ComparecienteDetail } from '../comparecientes.types';
import { Empty, SectionCard } from './SectionCard';
import styles from '../Comparecientes.module.css';
export function ActivityTab({ item }: { item: ComparecienteDetail }) { return <SectionCard title="Actividad reciente" subtitle="Cambios registrados en la información del compareciente.">{item.actividad.length ? <ol className={styles.activityList}>{item.actividad.map((event: any) => <li key={event.id}><span><Activity /></span><div><strong>{event.accion.replaceAll('_',' ')}</strong><p>{event.detalles?.modulo ? `Sección: ${event.detalles.modulo}` : 'Actualización de la información'}</p><small>{[event.usuario?.nombre,event.usuario?.apellido].filter(Boolean).join(' ')} · {new Intl.DateTimeFormat('es-MX', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(event.created_at))}</small></div></li>)}</ol> : <Empty>No hay actividad disponible.</Empty>}</SectionCard>; }
