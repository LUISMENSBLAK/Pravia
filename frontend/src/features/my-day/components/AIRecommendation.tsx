import { ArrowUpRight, Sparkles } from 'lucide-react';
import { useAssistant } from '../../assistant/AssistantProvider';
import type { Recommendation } from '../myDay.types';
import { WidgetCard, WidgetEmpty, WidgetError, WidgetLoading } from './WidgetCard';
import styles from './MyDayWidgets.module.css';

export function AIRecommendation({ insight, loading, error, onRetry, className }: { insight?: Recommendation | null; loading: boolean; error?: string; onRetry: () => void; className?: string }) {
  const { openAssistant } = useAssistant();
  return (
    <WidgetCard title="Recomendación con IA" action={<span className={styles.aiBadge}>PRAVIA IA</span>} className={className}>
      {loading ? <WidgetLoading rows={3} /> : error ? <WidgetError message="No pudimos analizar las recomendaciones." onRetry={onRetry} /> : !insight ? (
        <WidgetEmpty>Todo bajo control por ahora.</WidgetEmpty>
      ) : (
        <div className={styles.recommendation}>
          <span className={styles.recommendationIcon}><Sparkles size={20} aria-hidden="true" /></span>
          <div><strong>{insight.title}</strong>{insight.description && <p>{insight.description}</p>}</div>
          <button type="button" onClick={() => openAssistant({ prefill: 'Revisar esta recomendación.', seedMessage: { content: [insight.title, insight.description].filter(Boolean).join('\n') } })}>Ver detalles y acciones sugeridas <ArrowUpRight size={15} /></button>
        </div>
      )}
    </WidgetCard>
  );
}
