import { Clock3, X } from 'lucide-react';
import { useAssistant } from '../AssistantProvider';
import styles from './AssistantLayer.module.css';

export function AssistantSuggestionBubble() {
  const { suggestion, openAssistant, dismissSuggestion } = useAssistant();
  if (!suggestion) return null;
  return (
    <aside className={styles.suggestion} aria-label="Sugerencia contextual de PRAVIA IA">
      <header><div><span>PRAVIA IA</span><strong>{suggestion.title}</strong></div><button type="button" onClick={() => dismissSuggestion('dismiss')} aria-label="Descartar sugerencia"><X size={16} /></button></header>
      <p>{suggestion.message}</p>
      <small>{suggestion.reason}</small>
      <footer>
        <button type="button" className={styles.snooze} onClick={() => dismissSuggestion('snooze')}><Clock3 size={14} />Posponer</button>
        <button type="button" className={styles.review} onClick={() => openAssistant({ suggestion, prefill: suggestion.cta.prompt })}>{suggestion.cta.label}</button>
      </footer>
    </aside>
  );
}
