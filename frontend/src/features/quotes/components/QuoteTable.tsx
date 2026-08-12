import { ChevronRight, MoreHorizontal } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { money, quoteDeadline } from '../quoteFormatters';
import type { Quote } from '../quotes.types';
import { QuoteStatusBadge } from './QuoteStatusBadge';
import styles from '../Quotes.module.css';

export function QuoteTable({ quotes }: { quotes: Quote[] }) {
  const navigate = useNavigate();
  return <div className={styles.tableWrap}><table className={styles.quoteTable}>
    <thead><tr><th>Folio</th><th>Cliente</th><th>Trámite / acto</th><th>Importe</th><th>Estado</th><th>Vigencia / plazo</th><th><span className={styles.srOnly}>Acciones</span></th></tr></thead>
    <tbody>{quotes.map((quote) => {
      const deadline = quoteDeadline(quote);
      return <tr key={quote.id} onDoubleClick={() => navigate(`/cotizaciones/${quote.id}`)}>
        <td><button type="button" className={styles.folioLink} onClick={() => navigate(`/cotizaciones/${quote.id}`)}>{quote.numero_cotizacion || quote.numero_solicitud || 'Sin folio'}</button><small>v{quote.version_actual}</small></td>
        <td><strong>{quote.prospecto?.nombre || 'Prospecto no disponible'}</strong></td>
        <td>{quote.prospecto?.tipo_acto || 'Sin especificar'}</td>
        <td className={styles.amount}>{quote.total_cliente == null ? 'Sin importe' : money(quote.total_cliente)}</td>
        <td><QuoteStatusBadge state={quote.estado} /></td>
        <td><span className={`${styles.deadline} ${styles[`deadline-${deadline.tone}`]}`}>{deadline.label}</span></td>
        <td><button type="button" className={styles.rowAction} aria-label={`Abrir ${quote.numero_cotizacion || 'cotización'}`} onClick={() => navigate(`/cotizaciones/${quote.id}`)}><MoreHorizontal size={17} /><ChevronRight size={15} /></button></td>
      </tr>;
    })}</tbody>
  </table></div>;
}
