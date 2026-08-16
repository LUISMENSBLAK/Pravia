import { useAssistant } from '../AssistantProvider';
import { AssistantOwl } from './AssistantOwl';
import styles from './AssistantLayer.module.css';

export function AssistantLauncher({ mobileSidebarOpen = false }: { mobileSidebarOpen?: boolean }) {
  const { openAssistant } = useAssistant();
  return (
    <button className={`${styles.launcher} ${mobileSidebarOpen ? styles.launcherWithMobileSidebar : ''}`} type="button" onClick={() => openAssistant()} aria-label="Abrir PRAVIA IA">
      <AssistantOwl compact />
      <span className={styles.launcherStatus} aria-hidden="true" />
    </button>
  );
}
