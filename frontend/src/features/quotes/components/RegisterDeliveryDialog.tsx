import { useState, type FormEvent } from 'react';
import { Copy, LoaderCircle, Sparkles } from 'lucide-react';
import { quotesService } from '../quotes.service';
import type { Quote } from '../quotes.types';
import { QuoteActionDialog } from './QuoteActionDialog';
import styles from '../Quotes.module.css';

export function RegisterDeliveryDialog({ quote, target, onClose, onDone }: { quote: Quote; target: 'NOTARIA' | 'CLIENTE'; onClose: () => void; onDone: () => void }) {
  const defaultRecipient = target === 'CLIENTE' ? quote.prospecto?.email || '' : quote.notaria?.correo_proyectos || quote.notaria?.correo_general || '';
  const defaultSubject = quote.correo_asunto || `Cotización ${quote.numero_cotizacion || quote.numero_solicitud || ''}`.trim();
  const defaultMessage = quote.cuerpo_correo_cliente || `Hola ${quote.prospecto?.nombre || ''},\n\nCompartimos la cotización solicitada para tu revisión.\n\nQuedamos atentos a tus comentarios.`;
  const localNow = () => { const value = new Date(Date.now() - new Date().getTimezoneOffset() * 60_000); return value.toISOString().slice(0, 23); };
  const [channel, setChannel] = useState('correo'); const [recipient, setRecipient] = useState(defaultRecipient); const [cc, setCc] = useState(quote.correo_cc || ''); const [subject, setSubject] = useState(defaultSubject); const [messageBody, setMessageBody] = useState(defaultMessage); const [summary, setSummary] = useState(''); const [effectiveAt, setEffectiveAt] = useState(localNow); const [key] = useState(() => crypto.randomUUID()); const [saving, setSaving] = useState(false); const [drafting, setDrafting] = useState(false); const [draftNotice, setDraftNotice] = useState(''); const [error, setError] = useState('');
  const canonical = Boolean(quote.workflow?.stage);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!recipient.trim() || !summary.trim() || !effectiveAt) return setError('Destinatario, fecha efectiva y evidencia son obligatorios.');
    if (canonical && target === 'CLIENTE' && channel === 'correo' && (!subject.trim() || !messageBody.trim())) return setError('Asunto y mensaje son obligatorios para confirmar un envío por correo.');
    setSaving(true); setError('');
    try {
      if (canonical && target === 'CLIENTE') {
        const action = quote.workflow!.stage === 'EN_ELABORACION' ? 'ENVIAR_CLIENTE' : 'REENVIAR_CLIENTE';
        await quotesService.contractAction(quote.id, { action, expectedVersion: quote.workflow!.version, idempotencyKey: key, confirm: true,
          effectiveAt: new Date(effectiveAt).toISOString(), channel, recipient, cc, subject, messageBody,
          deliveryMode: 'MANUAL_CONFIRMED', evidence: summary });
      } else {
        await quotesService.registerDelivery(quote.id, { destino: target, canal: channel, destinatario: recipient, resumen: summary });
      }
      onDone();
    } catch (caught) {
      setError(caught && typeof caught === 'object' && 'message' in caught ? String((caught as Error).message) : 'No pudimos registrar el envío. Revisa la ficha e inténtalo nuevamente.');
      setSaving(false);
    }
  };
  const copyDraft = async () => {
    const text = [`Para: ${recipient}`, cc.trim() ? `CC: ${cc.trim()}` : '', `Asunto: ${subject}`, '', messageBody].filter(Boolean).join('\n');
    try { await navigator.clipboard.writeText(text); setError(''); }
    catch { setError('No fue posible copiar automáticamente. Selecciona el texto y cópialo manualmente.'); }
  };
  const draftWithAI = async () => {
    setDrafting(true); setError(''); setDraftNotice('');
    try {
      const draft = await quotesService.draftEmailWithAI(quote.id);
      if (draft.recipient) setRecipient(draft.recipient);
      setCc(draft.cc || ''); setSubject(draft.subject); setMessageBody(draft.messageBody);
      setDraftNotice(`Borrador preparado con IA (${draft.model}). Revísalo antes de copiar o confirmar el envío manual.`);
    } catch (caught) {
      setError(caught && typeof caught === 'object' && 'message' in caught ? String((caught as Error).message) : 'No fue posible redactar el correo con IA.');
    } finally { setDrafting(false); }
  };
  const resend = canonical && quote.workflow?.stage === 'ENVIADA_CLIENTE';
  return <QuoteActionDialog title={resend ? 'Confirmar reenvío manual al cliente' : `Confirmar envío manual a ${target === 'CLIENTE' ? 'cliente' : 'notaría'}`} description={resend ? 'El reenvío queda en la historia sin sustituir la fecha del primer envío.' : 'PRAVIA prepara y conserva el borrador. Confirma sólo después de enviarlo por tu canal externo; el sistema no simula una entrega.'} onClose={onClose} footer={<><button type="button" className={styles.secondaryButton} onClick={onClose}>Cancelar</button><button type="submit" form="delivery-form" className={styles.primaryButton} disabled={saving || drafting}>{saving && <LoaderCircle className={styles.spin} size={17} />}{resend ? 'Confirmar reenvío manual' : 'Confirmar envío manual'}</button></>}><form id="delivery-form" className={styles.dialogForm} onSubmit={submit}>{error && <div className={styles.formError} role="alert">{error}</div>}<label><span>Fecha y hora efectiva</span><input type="datetime-local" step="0.001" max={localNow()} value={effectiveAt} onChange={(event) => setEffectiveAt(event.target.value)} required /></label><label><span>Canal externo</span><select value={channel} onChange={(event) => setChannel(event.target.value)}><option value="correo">Correo externo</option><option value="whatsapp">WhatsApp</option><option value="presencial">Entrega presencial</option><option value="otro">Otro</option></select></label><label><span>Para</span><input type={channel === 'correo' ? 'email' : 'text'} value={recipient} onChange={(event) => setRecipient(event.target.value)} required /></label>{canonical && target === 'CLIENTE' && <section className={styles.deliveryDraft} aria-label="Borrador editable para el cliente"><button type="button" className={styles.secondaryButton} disabled={drafting} onClick={() => void draftWithAI()}>{drafting ? <LoaderCircle className={styles.spin} size={16} /> : <Sparkles size={16} />}{drafting ? 'Redactando…' : 'Redactar correo con IA'}</button>{draftNotice && <p className={styles.aiDraftNotice} role="status">{draftNotice}</p>}<label><span>CC (opcional)</span><input value={cc} onChange={(event) => setCc(event.target.value)} /></label><label><span>Asunto</span><input value={subject} onChange={(event) => setSubject(event.target.value)} required={channel === 'correo'} /></label><label><span>Mensaje</span><textarea rows={7} value={messageBody} onChange={(event) => setMessageBody(event.target.value)} required={channel === 'correo'} /></label><button type="button" className={styles.secondaryButton} onClick={() => void copyDraft()}><Copy size={16} />Copiar redacción</button></section>}<label><span>Evidencia / nota del envío realizado</span><textarea rows={4} value={summary} onChange={(event) => setSummary(event.target.value)} placeholder="Ej. Enviado desde Outlook; asunto y hora del mensaje." required /></label></form></QuoteActionDialog>;
}
