import { lazy, Suspense } from 'react';
import { useAssistant } from '../AssistantProvider';
import { AssistantLauncher } from './AssistantLauncher';
import { AssistantSuggestionBubble } from './AssistantSuggestionBubble';
import styles from './AssistantLayer.module.css';

const AssistantDrawer = lazy(() => import('./AssistantDrawer').then((module) => ({ default: module.AssistantDrawer })));

export function AssistantLayer() {
  const { isOpen, closeAssistant } = useAssistant();
  if (!isOpen) return <><AssistantSuggestionBubble /><AssistantLauncher /></>;
  return <div className={styles.layer}><button className={styles.backdrop} type="button" onClick={closeAssistant} aria-label="Cerrar panel al pulsar fuera" tabIndex={-1} /><Suspense fallback={null}><AssistantDrawer /></Suspense></div>;
}
