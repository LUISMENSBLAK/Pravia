import { CalendarClock, Check } from 'lucide-react';
import { useAssistant } from '../AssistantProvider';
import styles from './AssistantDrawer.module.css';

export function AssistantConfirmationCard() {
  const { confirmation, confirmAction, editConfirmation, cancelConfirmation, status } = useAssistant();
  if (!confirmation) return null;
  return (
    <section className={styles.confirmation} aria-label="Confirmación requerida">
      <div className={styles.confirmationTitle}><CalendarClock size={18} aria-hidden="true" /><div><small>Confirmación requerida</small><strong>{confirmation.title}</strong></div></div>
      {confirmation.summary && <p>{confirmation.summary}</p>}
      <dl>{confirmation.details.map((detail) => <div key={detail.label}><dt>{detail.label}</dt><dd>{detail.value}</dd></div>)}</dl>
      <div className={styles.confirmationActions}>
        <button type="button" className={styles.confirmButton} onClick={() => void confirmAction()} disabled={status === 'processing'}><Check size={15} />{confirmation.confirmLabel ?? 'Confirmar'}</button>
        <button type="button" onClick={editConfirmation}>Editar</button>
        <button type="button" onClick={cancelConfirmation}>Cancelar</button>
      </div>
    </section>
  );
}
