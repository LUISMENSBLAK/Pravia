import { ArrowRight, Check, Circle } from 'lucide-react';
import type { Quote, QuoteContractStage } from '../quotes.types';
import styles from '../Quotes.module.css';

const stages: Array<{ code: QuoteContractStage; label: string }> = [
  { code: 'BORRADOR', label: 'Creada / borrador' },
  { code: 'EN_ELABORACION', label: 'En elaboración' },
  { code: 'ENVIADA_CLIENTE', label: 'Enviada al cliente' },
  { code: 'EN_SEGUIMIENTO', label: 'En seguimiento' },
  { code: 'ACEPTADA', label: 'Aceptada' },
  { code: 'CONVERTIDA_EXPEDIENTE', label: 'Expediente' },
];

export function QuoteProgress({ quote }: { quote: Quote }) {
  const stage = quote.workflow?.stage;
  if (!stage) return null;
  const directlyCurrent = stages.findIndex((item) => item.code === stage);
  const reached = new Set<QuoteContractStage>([
    ...(quote.workflow?.events ?? []).filter((event) => event.changesStage).map((event) => event.next),
    stage,
  ]);
  const furthest = directlyCurrent >= 0
    ? directlyCurrent
    : stages.reduce((result, item, index) => reached.has(item.code) ? Math.max(result, index) : result, -1);

  return <section className={styles.quoteProgressPanel} aria-label="Avance operativo de la cotización">
    <div><strong>Avance operativo</strong><span>Etapa persistida: {quote.workflow?.stageLabel}</span></div>
    <ol className={styles.quoteProgress}>
      {stages.map((item, index) => {
        const current = item.code === stage;
        const complete = index < furthest || (stage === 'CONVERTIDA_EXPEDIENTE' && index === furthest);
        return <li key={item.code} aria-current={current ? 'step' : undefined} data-complete={complete || undefined}>
          <span>{complete ? <Check size={15} /> : <Circle size={13} />}</span>
          <strong>{item.label}</strong>
          {index < stages.length - 1 && <ArrowRight size={14} aria-hidden="true" />}
        </li>;
      })}
    </ol>
  </section>;
}
