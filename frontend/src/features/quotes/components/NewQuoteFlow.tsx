import { Link } from 'react-router-dom';
import type { Quote } from '../quotes.types';
import { QuoteDrawer } from './QuoteDrawer';
import styles from '../Quotes.module.css';

/** Compatibility entry only. Creation and confirmation live in the canonical prospect record. */
export function NewQuoteFlow({ initialProspectId, onClose }: { initialProspectId?: string; onClose: () => void; onCreated: (quote: Quote) => void }) {
  return <QuoteDrawer title="Nueva cotización" subtitle="La fuente notarial se registra en Prospectos." onClose={onClose} footer={<button type="button" className={styles.secondaryButton} onClick={onClose}>Cerrar</button>}>
    <p>Abre el prospecto, registra la cotización recibida de Notaría y confirma su conversión. La fuente y su fecha se conservarán sin crear otra solicitud.</p>
    <Link className={styles.primaryButton} to={initialProspectId ? `/prospectos/${encodeURIComponent(initialProspectId)}` : '/prospectos'} onClick={onClose}>Ir al prospecto de origen</Link>
  </QuoteDrawer>;
}
