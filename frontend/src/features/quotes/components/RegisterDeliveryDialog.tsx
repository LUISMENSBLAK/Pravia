import { useState, type FormEvent } from 'react';
import { LoaderCircle } from 'lucide-react';
import { quotesService } from '../quotes.service';
import type { Quote } from '../quotes.types';
import { QuoteActionDialog } from './QuoteActionDialog';
import styles from '../Quotes.module.css';

export function RegisterDeliveryDialog({ quote, target, onClose, onDone }: { quote: Quote; target: 'NOTARIA' | 'CLIENTE'; onClose: () => void; onDone: () => void }) {
  const defaultRecipient = target === 'CLIENTE' ? quote.prospecto?.email || '' : quote.notaria?.correo_proyectos || quote.notaria?.correo_general || '';
  const localNow = () => { const value = new Date(Date.now() - new Date().getTimezoneOffset() * 60_000); return value.toISOString().slice(0, 16); };
  const [channel, setChannel] = useState('correo'); const [recipient, setRecipient] = useState(defaultRecipient); const [summary, setSummary] = useState(''); const [effectiveAt, setEffectiveAt] = useState(localNow); const [key] = useState(() => crypto.randomUUID()); const [saving, setSaving] = useState(false); const [error, setError] = useState('');
  const canonical = Boolean(quote.workflow?.stage);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!recipient.trim() || !summary.trim() || !effectiveAt) return setError('Destinatario, fecha efectiva y evidencia son obligatorios.');
    setSaving(true); setError('');
    try {
      if (canonical && target === 'CLIENTE') {
        const action = quote.workflow!.stage === 'BORRADOR' ? 'ENVIAR_CLIENTE' : 'REENVIAR_CLIENTE';
        const approved = quote.versiones.find((item) => item.aprobada);
        await quotesService.contractAction(quote.id, { action, expectedVersion: quote.workflow!.version, idempotencyKey: key, confirm: true,
          effectiveAt: new Date(effectiveAt).toISOString(), channel, recipient, evidence: summary, ...(approved ? { versionId: approved.id } : {}) });
      } else {
        await quotesService.registerDelivery(quote.id, { destino: target, canal: channel, destinatario: recipient, resumen: summary });
      }
      onDone();
    } catch (caught) {
      setError(caught && typeof caught === 'object' && 'message' in caught ? String((caught as Error).message) : 'No pudimos registrar el envío. Revisa la ficha e inténtalo nuevamente.');
      setSaving(false);
    }
  };
  const resend = canonical && quote.workflow?.stage === 'ENVIADA_CLIENTE';
  return <QuoteActionDialog title={resend ? 'Registrar reenvío al cliente' : `Registrar envío a ${target === 'CLIENTE' ? 'cliente' : 'notaría'}`} description={resend ? 'El reenvío queda en la historia sin sustituir la fecha del primer envío.' : 'Guarda el canal, destinatario, fecha efectiva y evidencia. Este registro no garantiza que el destinatario haya recibido el mensaje.'} onClose={onClose} footer={<><button type="button" className={styles.secondaryButton} onClick={onClose}>Cancelar</button><button type="submit" form="delivery-form" className={styles.primaryButton} disabled={saving}>{saving && <LoaderCircle className={styles.spin} size={17} />}{resend ? 'Registrar reenvío' : 'Registrar envío'}</button></>}><form id="delivery-form" className={styles.dialogForm} onSubmit={submit}>{error && <div className={styles.formError} role="alert">{error}</div>}<label><span>Fecha y hora efectiva</span><input type="datetime-local" max={localNow()} value={effectiveAt} onChange={(event) => setEffectiveAt(event.target.value)} required /></label><label><span>Canal</span><select value={channel} onChange={(event) => setChannel(event.target.value)}><option value="correo">Correo externo</option><option value="whatsapp">WhatsApp</option><option value="presencial">Entrega presencial</option><option value="otro">Otro</option></select></label><label><span>Destinatario</span><input value={recipient} onChange={(event) => setRecipient(event.target.value)} required /></label><label><span>Evidencia / nota de entrega</span><textarea rows={4} value={summary} onChange={(event) => setSummary(event.target.value)} placeholder="Ej. Enviado desde Outlook; asunto y hora del mensaje." required /></label></form></QuoteActionDialog>;
}
