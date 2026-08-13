import { useEffect, useState } from 'react';
import styles from './UpdatePrompt.module.css';

export function UpdatePrompt() {
  const [waiting, setWaiting] = useState<ServiceWorker | null>(null);

  useEffect(() => {
    const available = (event: Event) => setWaiting((event as CustomEvent<ServiceWorker>).detail);
    window.addEventListener('pravia:update-available', available);
    return () => window.removeEventListener('pravia:update-available', available);
  }, []);

  if (!waiting) return null;
  return <aside className={styles.prompt} role="status" aria-live="polite">
    <span><strong>Hay una nueva versión de PRAVIA disponible.</strong><small>Guarda tu trabajo antes de actualizar.</small></span>
    <button type="button" onClick={() => waiting.postMessage({ type: 'SKIP_WAITING' })}>Actualizar</button>
    <button type="button" className={styles.later} onClick={() => setWaiting(null)} aria-label="Actualizar más tarde">Más tarde</button>
  </aside>;
}
