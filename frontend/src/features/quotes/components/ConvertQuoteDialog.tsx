import { useState } from 'react';
import { LoaderCircle } from 'lucide-react';
import { quotesService } from '../quotes.service';
import type { Quote } from '../quotes.types';
import { QuoteActionDialog } from './QuoteActionDialog';
import styles from '../Quotes.module.css';

export function ConvertQuoteDialog({ quote, onClose, onDone }: { quote: Quote; onClose: () => void; onDone: (result: { id: string; numero_pravia?: string; idempotent?: boolean }) => void }) {
  const [saving, setSaving] = useState(false); const [error, setError] = useState('');
  const convert = async () => { setSaving(true); setError(''); try { onDone(await quotesService.convert(quote.id)); } catch (caught) { const status = caught && typeof caught === 'object' && 'status' in caught ? Number((caught as { status?: number }).status) : 0; setError(status === 409 ? 'Esta cotización ya fue convertida en expediente.' : 'No se pudo crear el expediente. Verifica la aceptación, la versión vigente y el anticipo validado.'); setSaving(false); } };
  return <QuoteActionDialog title="Convertir a expediente" description="Se creará un expediente a partir de esta cotización." onClose={onClose} footer={<><button type="button" className={styles.secondaryButton} onClick={onClose}>Cancelar</button><button type="button" className={styles.primaryButton} disabled={saving || !quote.conversion?.eligible} onClick={convert}>{saving && <LoaderCircle className={styles.spin} size={17} />}Crear expediente</button></>}><dl className={styles.confirmationList}><div><dt>Cliente</dt><dd>{quote.prospecto?.nombre || 'Sin cliente visible'}</dd></div><div><dt>Acto</dt><dd>{quote.prospecto?.tipo_acto || 'Sin especificar'}</dd></div><div><dt>Cotización</dt><dd>{quote.numero_cotizacion || quote.numero_solicitud}</dd></div><div><dt>Responsable</dt><dd>{quote.creada_por?.nombre || 'Sin responsable visible'}</dd></div></dl>{quote.conversion && !quote.conversion.eligible && <div className={styles.requirements}><strong>Requisitos pendientes</strong><ul>{quote.conversion.failures.map((failure) => <li key={failure}>{failure}</li>)}</ul></div>}{error && <div className={styles.formError} role="alert">{error}</div>}</QuoteActionDialog>;
}
