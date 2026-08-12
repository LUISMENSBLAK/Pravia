import { CalendarClock, Clock3, FolderSearch, Search, WalletCards } from 'lucide-react';
import { Link } from 'react-router-dom';
import { WidgetCard } from './WidgetCard';
import styles from './PraviaAiCard.module.css';

export function PraviaAiCard({ canViewFinance, className }: { canViewFinance: boolean; className?: string }) {
  return (
    <WidgetCard title="PRAVIA IA" action={<span className={styles.online}><i />En línea</span>} className={className}>
      <div className={styles.content}>
        <div className={styles.owl} aria-label="Asistente PRAVIA IA">
          <img className={styles.idle} src="/brand/pravia-ai/owl-idle.png" alt="Búho de PRAVIA IA" />
          <img className={styles.blink} src="/brand/pravia-ai/owl-blink.png" alt="" aria-hidden="true" />
        </div>
        <p>¿En qué puedo ayudarte hoy?</p>
        <label className={styles.prompt}>
          <Search size={15} aria-hidden="true" />
          <input disabled placeholder="Pregúntame algo..." aria-label="Pregúntame algo — disponible próximamente" />
        </label>
        <div className={styles.actions}>
          <button type="button" disabled title="Disponible en la Fase 3"><FolderSearch size={14} />Buscar expediente</button>
          <Link to="/mi-dia#tareas-urgentes"><Clock3 size={14} />Ver pendientes</Link>
          <Link to="/agenda"><CalendarClock size={14} />Programar firma</Link>
          {canViewFinance ? <Link to="/mi-dia#resumen-financiero"><WalletCards size={14} />Resumen financiero</Link> : <button type="button" disabled><WalletCards size={14} />Resumen financiero</button>}
        </div>
      </div>
    </WidgetCard>
  );
}
