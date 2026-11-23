import { LoaderCircle, Sparkles } from 'lucide-react';
import { useEffect, useState } from 'react';
import styles from './AIProcessingStatus.module.css';

type Props = {
  label: string;
  detail?: string;
  compact?: boolean;
  expanded?: boolean;
};

/**
 * Estado compartido para operaciones IA sin progreso cuantificable.
 * No simula porcentajes: comunica que la solicitud sigue activa y bloquea la
 * percepción de una interfaz congelada mientras el servidor procesa fuentes.
 */
export function AIProcessingStatus({ label, detail, compact = false, expanded = false }: Props) {
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    if (!expanded) return;
    const started = Date.now();
    const timer = window.setInterval(() => setElapsed(Math.floor((Date.now() - started) / 1000)), 1000);
    return () => window.clearInterval(timer);
  }, [expanded]);
  return <div className={`${styles.status} ${compact ? styles.compact : ''} ${expanded ? styles.expanded : ''}`} aria-busy="true">
    <span className={styles.icon} aria-hidden="true"><LoaderCircle /><Sparkles /></span>
    <span className={styles.copy} role="status" aria-live="polite" aria-atomic="true" aria-busy="true"><strong>{label}</strong>{detail && <small>{detail}</small>}</span>
    <span className={styles.activity} aria-hidden="true"><i /><i /><i /></span>
    {expanded && <div className={styles.waiting}><span aria-hidden="true">Tiempo transcurrido: {Math.floor(elapsed / 60)}:{String(elapsed % 60).padStart(2, '0')}</span><p>La solicitud sigue en curso. Espera la confirmación antes de volver a enviarla. Los datos no acreditados se mantendrán como pendientes.</p></div>}
  </div>;
}
