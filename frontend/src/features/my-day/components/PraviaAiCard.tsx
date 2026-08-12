import { CalendarClock, Clock3, FolderSearch, Search, WalletCards } from 'lucide-react';
import { useAssistant } from '../../assistant/AssistantProvider';
import { WidgetCard } from './WidgetCard';
import styles from './PraviaAiCard.module.css';

export function PraviaAiCard({ canViewFinance, className }: { canViewFinance: boolean; className?: string }) {
  const { openAssistant } = useAssistant();
  return (
    <WidgetCard title="PRAVIA IA" action={<span className={styles.online}><i />En línea</span>} className={className}>
      <div className={styles.content}>
        <div className={styles.owl} aria-label="Asistente PRAVIA IA">
          <img className={styles.idle} src="/brand/pravia-ai/owl-idle.png" alt="Búho de PRAVIA IA" />
          <img className={styles.blink} src="/brand/pravia-ai/owl-blink.png" alt="" aria-hidden="true" />
        </div>
        <p>¿En qué puedo ayudarte hoy?</p>
        <button type="button" className={styles.prompt} onClick={() => openAssistant()} aria-label="Abrir PRAVIA IA para hacer una pregunta">
          <Search size={15} aria-hidden="true" />
          <span>Pregúntame algo...</span>
        </button>
        <div className={styles.actions}>
          <button type="button" onClick={() => openAssistant({ prefill: 'Ayúdame a buscar un expediente.' })}><FolderSearch size={14} />Buscar expediente</button>
          <button type="button" onClick={() => openAssistant({ prefill: 'Muéstrame mis pendientes de hoy.' })}><Clock3 size={14} />Ver pendientes</button>
          <button type="button" onClick={() => openAssistant({ prefill: 'Ayúdame a programar una firma.' })}><CalendarClock size={14} />Programar firma</button>
          <button type="button" disabled={!canViewFinance} onClick={() => openAssistant({ prefill: 'Muéstrame el resumen financiero disponible.' })}><WalletCards size={14} />Resumen financiero</button>
        </div>
      </div>
    </WidgetCard>
  );
}
