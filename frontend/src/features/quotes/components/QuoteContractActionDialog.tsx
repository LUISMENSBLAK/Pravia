import { useState, type FormEvent } from 'react';
import { LoaderCircle } from 'lucide-react';
import { quotesService } from '../quotes.service';
import type { Quote, QuoteContractAction } from '../quotes.types';
import { QuoteActionDialog } from './QuoteActionDialog';
import styles from '../Quotes.module.css';

const config: Record<'REGISTRAR_ACEPTACION_ANTICIPO' | 'SUSPENDER' | 'CANCELAR', { title: string; description: string; submit: string; destructive?: boolean }> = {
  REGISTRAR_ACEPTACION_ANTICIPO: {
    title: 'Registrar Aceptó / Anticipo',
    description: 'Registra un solo hito comercial. No crea, valida ni aplica movimientos financieros.',
    submit: 'Confirmar hito comercial',
  },
  SUSPENDER: { title: 'Suspender cotización', description: 'La cotización conservará su historia, fuente, documentos y relaciones.', submit: 'Suspender', destructive: true },
  CANCELAR: { title: 'Cancelar cotización', description: 'La cancelación no elimina la cotización ni sus documentos, pagos o auditoría.', submit: 'Cancelar cotización', destructive: true },
};

const localNow = () => new Date(Date.now() - new Date().getTimezoneOffset() * 60_000).toISOString().slice(0, 16);

export function QuoteContractActionDialog({ quote, action, onClose, onDone }: {
  quote: Quote;
  action: 'REGISTRAR_ACEPTACION_ANTICIPO' | 'SUSPENDER' | 'CANCELAR';
  onClose: () => void;
  onDone: () => void;
}) {
  const copy = config[action];
  const [effectiveAt, setEffectiveAt] = useState(localNow);
  const [reason, setReason] = useState('');
  const [key] = useState(() => crypto.randomUUID());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!effectiveAt || !quote.workflow) return;
    setSaving(true); setError('');
    try {
      await quotesService.contractAction(quote.id, {
        action: action as Exclude<QuoteContractAction, 'CONVERTIR'>,
        expectedVersion: quote.workflow.version,
        idempotencyKey: key,
        confirm: true,
        effectiveAt: new Date(effectiveAt).toISOString(),
        ...(reason.trim() ? { reason: reason.trim() } : {}),
      });
      onDone();
    } catch (caught) {
      setError(caught && typeof caught === 'object' && 'message' in caught ? String((caught as Error).message) : 'No pudimos registrar la acción. Actualiza la ficha e inténtalo de nuevo.');
      setSaving(false);
    }
  };
  return <QuoteActionDialog title={copy.title} description={copy.description} onClose={onClose} footer={<><button type="button" className={styles.secondaryButton} onClick={onClose}>Volver</button><button type="submit" form="contract-action-form" className={copy.destructive ? styles.dangerButton : styles.primaryButton} disabled={saving}>{saving && <LoaderCircle className={styles.spin} size={17} />}{copy.submit}</button></>}>
    <form id="contract-action-form" className={styles.dialogForm} onSubmit={submit}>
      {error && <div className={styles.formError} role="alert">{error}</div>}
      <label><span>Fecha y hora efectiva</span><input type="datetime-local" max={localNow()} value={effectiveAt} onChange={(event) => setEffectiveAt(event.target.value)} required /></label>
      <label><span>Nota opcional</span><textarea rows={3} value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Contexto operativo, si aplica." /></label>
      {action === 'REGISTRAR_ACEPTACION_ANTICIPO' && <p className={styles.contractNotice}>Este hito habilita la conversión comercial. La captura y aplicación de dinero permanecen separadas en Finanzas del expediente.</p>}
    </form>
  </QuoteActionDialog>;
}
