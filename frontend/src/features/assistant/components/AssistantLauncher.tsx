import { useAssistant } from '../AssistantProvider';
import { AssistantOwl } from './AssistantOwl';
import styles from './AssistantLayer.module.css';

export function AssistantLauncher() {
  const { openAssistant } = useAssistant();
  return (
    <button className={styles.launcher} type="button" onClick={() => openAssistant()} aria-label="Abrir PRAVIA IA">
      <AssistantOwl compact />
      <span className={styles.launcherStatus} aria-hidden="true" />
    </button>
  );
}
