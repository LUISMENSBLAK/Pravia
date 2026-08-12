import { ChevronRight } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { money, quoteDeadline } from '../quoteFormatters';
import type { Quote } from '../quotes.types';
import { QuoteStatusBadge } from './QuoteStatusBadge';
import styles from '../Quotes.module.css';

export function QuoteCardMobile({ quote }: { quote: Quote }) {
  const navigate = useNavigate();
  const deadline = quoteDeadline(quote);
  return <button type="button" className={styles.mobileCard} onClick={() => navigate(`/cotizaciones/${quote.id}`)}>
    <span className={styles.mobileCardTop}><strong>{quote.numero_cotizacion || quote.numero_solicitud || 'Sin folio'}</strong><QuoteStatusBadge state={quote.estado} /></span>
    <b>{quote.prospecto?.nombre || 'Prospecto no disponible'}</b>
    <span>{quote.prospecto?.tipo_acto || 'Acto sin especificar'}</span>
    <footer><span><strong>{quote.total_cliente == null ? 'Sin importe' : money(quote.total_cliente)}</strong><small className={styles[`deadline-${deadline.tone}`]}>{deadline.label}</small></span><ChevronRight size={18} /></footer>
  </button>;
}
