import { CalendarClock, Check } from 'lucide-react';
import { useAssistant } from '../AssistantProvider';
import styles from './AssistantDrawer.module.css';

export function AssistantConfirmationCard() {
  const { confirmation, confirmAction, editConfirmation, cancelConfirmation, closeAssistant, status } = useAssistant();
  if (!confirmation) return null;
  const projectGeneration = confirmation.confirmLabel === 'Generar proyecto';
  const openProjectOptions = (target: 'sources' | 'template') => {
    cancelConfirmation();
    closeAssistant();
    window.dispatchEvent(new CustomEvent('pravia:project-options', { detail: target }));
  };
  return (
    <section className={styles.confirmation} aria-label="Confirmación requerida">
      <div className={styles.confirmationTitle}><CalendarClock size={18} aria-hidden="true" /><div><small>Confirmación requerida</small><strong>{confirmation.title}</strong></div></div>
      {confirmation.summary && <p>{confirmation.summary}</p>}
      <dl>{confirmation.details.map((detail) => <div key={detail.label}><dt>{detail.label}</dt><dd>{detail.value}</dd></div>)}</dl>
      <div className={styles.confirmationActions}>
        <button type="button" className={styles.confirmButton} onClick={() => void confirmAction()} disabled={status === 'processing'}><Check size={15} />{confirmation.confirmLabel ?? 'Confirmar'}</button>
        {projectGeneration ? <>
          <button type="button" onClick={() => openProjectOptions('sources')}>REVISAR FUENTES</button>
          <button type="button" onClick={() => openProjectOptions('template')}>CAMBIAR MACHOTE</button>
        </> : <button type="button" onClick={editConfirmation}>Editar</button>}
        <button type="button" onClick={cancelConfirmation}>Cancelar</button>
      </div>
    </section>
  );
}
