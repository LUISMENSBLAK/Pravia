import { quoteDisplayStage } from '../quoteFormatters';
import type { Quote } from '../quotes.types';
import styles from '../Quotes.module.css';

export function QuoteStatusBadge({ quote }: { quote: Quote }) {
  const display = quoteDisplayStage(quote);
  return <span className={`${styles.statusBadge} ${styles[`tone-${display.tone}`]}`}>{display.label}</span>;
}
