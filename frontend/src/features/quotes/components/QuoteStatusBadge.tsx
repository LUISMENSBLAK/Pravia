import { QUOTE_STATE_LABELS, quoteTone } from '../quoteFormatters';
import type { QuoteState } from '../quotes.types';
import styles from '../Quotes.module.css';

export function QuoteStatusBadge({ state }: { state: QuoteState }) {
  return <span className={`${styles.statusBadge} ${styles[`tone-${quoteTone(state)}`]}`}>{QUOTE_STATE_LABELS[state]}</span>;
}
