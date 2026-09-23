import { useEffect, useState } from 'react';
import { LoaderCircle } from 'lucide-react';
import { quotesService } from '../quotes.service';
import type { Quote } from '../quotes.types';
import { QuoteActionDialog } from './QuoteActionDialog';
import styles from '../Quotes.module.css';

export function ConvertQuoteDialog({ quote, onClose, onDone }: { quote: Quote; onClose: () => void; onDone: (result: { id: string; numero_pravia?: string; idempotent?: boolean }) => void }) {
  const localNow = () => new Date(Date.now() - new Date().getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
  const [effectiveAt, setEffectiveAt] = useState(localNow); const [key] = useState(() => crypto.randomUUID()); const [saving, setSaving] = useState(false); const [error, setError] = useState('');
  const [actTypes, setActTypes] = useState<Array<{ id: string; nombre: string }>>([]); const [selectedActId, setSelectedActId] = useState(''); const [actsStatus, setActsStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const canonical = Boolean(quote.workflow?.stage);
  useEffect(() => {
    const controller = new AbortController();
    void quotesService.actTypes(controller.signal).then((types) => {
      const normalized = (value: string) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLocaleLowerCase('es-MX');
      const prospectAct = normalized(quote.prospecto?.tipo_acto || '');
      const exact = types.find((type) => normalized(type.nombre) === prospectAct);
      setActTypes(types); setSelectedActId(exact?.id || ''); setActsStatus('ready');
    }).catch((cause) => { if (!(cause instanceof DOMException && cause.name === 'AbortError')) setActsStatus('error'); });
    return () => controller.abort();
  }, [quote.prospecto?.tipo_acto]);
  const convert = async () => {
    if (!selectedActId) { setError('Selecciona el tipo de acto que tendrá el expediente.'); return; }
    setSaving(true); setError('');
    try {
      onDone(await quotesService.convert(quote.id, canonical
        ? { expectedVersion: quote.workflow!.version, idempotencyKey: key, confirm: true, effectiveAt: new Date(effectiveAt).toISOString(), tipoActoId: selectedActId }
        : { tipoActoId: selectedActId }));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'No se pudo crear el expediente.'); setSaving(false);
    }
  };
  const selectedAct = actTypes.find((type) => type.id === selectedActId);
  return <QuoteActionDialog title="Convertir a expediente" description="Se creará un expediente a partir de esta cotización, sin aplicar movimientos financieros." onClose={onClose} footer={<><button type="button" className={styles.secondaryButton} onClick={onClose}>Cancelar</button><button type="button" className={styles.primaryButton} disabled={saving || actsStatus !== 'ready' || !selectedActId || !quote.conversion?.eligible || (canonical && !effectiveAt)} onClick={convert}>{saving && <LoaderCircle className={styles.spin} size={17} />}Convertir en expediente</button></>}><dl className={styles.confirmationList}><div><dt>Cliente</dt><dd>{quote.prospecto?.nombre || 'Sin cliente visible'}</dd></div><div><dt>Acto</dt><dd>{selectedAct?.nombre || quote.prospecto?.tipo_acto || 'Sin especificar'}</dd></div><div><dt>Cotización</dt><dd>{quote.numero_cotizacion || quote.numero_solicitud}</dd></div><div><dt>Responsable</dt><dd>{quote.creada_por?.nombre || 'Sin responsable visible'}</dd></div></dl><label className={styles.confirmDate}><span>Tipo de acto del expediente</span><select aria-label="Tipo de acto del expediente" value={selectedActId} onChange={(event) => { setSelectedActId(event.target.value); setError(''); }} disabled={actsStatus === 'loading'}><option value="">{actsStatus === 'loading' ? 'Cargando catálogo…' : 'Selecciona un tipo de acto'}</option>{actTypes.map((type) => <option key={type.id} value={type.id}>{type.nombre}</option>)}</select></label>{actsStatus === 'error' && <div className={styles.formError} role="alert">No pudimos cargar el catálogo de actos. Cierra el diálogo e inténtalo nuevamente.</div>}{canonical && <label className={styles.confirmDate}><span>Fecha y hora efectiva</span><input type="datetime-local" max={localNow()} value={effectiveAt} onChange={(event) => setEffectiveAt(event.target.value)} required /></label>}{quote.conversion && !quote.conversion.eligible && <div className={styles.requirements}><strong>Requisitos pendientes</strong><ul>{quote.conversion.failures.map((failure) => <li key={failure}>{failure}</li>)}</ul></div>}{error && <div className={styles.formError} role="alert">{error}</div>}</QuoteActionDialog>;
}
