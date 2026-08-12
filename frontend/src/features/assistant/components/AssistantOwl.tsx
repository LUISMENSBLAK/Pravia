import type { AssistantStatus } from '../assistant.types';
import { useReducedMotion } from '../useReducedMotion';
import styles from './AssistantOwl.module.css';

const stateAssets: Record<AssistantStatus, string> = {
  idle: 'owl-idle.png', thinking: 'owl-thinking.png', processing: 'owl-processing.png',
  success: 'owl-success.png', error: 'owl-idle.png', 'confirmation-required': 'owl-idle.png',
};

export function AssistantOwl({ status = 'idle', greeting = false, compact = false }: { status?: AssistantStatus; greeting?: boolean; compact?: boolean }) {
  const reducedMotion = useReducedMotion();
  const source = greeting && status === 'idle' ? 'owl-greeting.png' : stateAssets[status];
  return (
    <span className={`${styles.frame} ${compact ? styles.compact : ''} ${reducedMotion ? styles.reduced : ''}`} data-motion={reducedMotion ? 'reduced' : 'full'}>
      <img src={`/brand/pravia-ai/${source}`} alt="Búho de PRAVIA IA" loading={source === 'owl-idle.png' ? 'eager' : 'lazy'} />
      {status === 'idle' && !greeting && !reducedMotion && <img className={styles.blink} src="/brand/pravia-ai/owl-blink.png" alt="" aria-hidden="true" loading="lazy" />}
    </span>
  );
}
