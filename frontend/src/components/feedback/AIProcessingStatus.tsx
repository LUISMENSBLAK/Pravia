import { LoaderCircle, Sparkles } from 'lucide-react';
import styles from './AIProcessingStatus.module.css';

type Props = {
  label: string;
  detail?: string;
  compact?: boolean;
};

/**
 * Estado compartido para operaciones IA sin progreso cuantificable.
 * No simula porcentajes: comunica que la solicitud sigue activa y bloquea la
 * percepción de una interfaz congelada mientras el servidor procesa fuentes.
 */
export function AIProcessingStatus({ label, detail, compact = false }: Props) {
  return <div className={`${styles.status} ${compact ? styles.compact : ''}`} role="status" aria-live="polite" aria-atomic="true" aria-busy="true">
    <span className={styles.icon} aria-hidden="true"><LoaderCircle /><Sparkles /></span>
    <span className={styles.copy}><strong>{label}</strong>{detail && <small>{detail}</small>}</span>
    <span className={styles.activity} aria-hidden="true"><i /><i /><i /></span>
  </div>;
}
