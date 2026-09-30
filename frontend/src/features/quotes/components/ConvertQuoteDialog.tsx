import { useEffect, useState } from 'react';
import { LoaderCircle } from 'lucide-react';
import { quotesService } from '../quotes.service';
import type { Quote } from '../quotes.types';
import { QuoteActionDialog } from './QuoteActionDialog';
import styles from '../Quotes.module.css';

export function ConvertQuoteDialog({ quote, onClose, onDone }: { quote: Quote; onClose: () => void; onDone: (result: { id: string; numero_pravia?: string; idempotent?: boolean }) => void }) {
  const localNow = () => new Date(Date.now() - new Date().getTimezoneOffset() * 60_000).toISOString().slice(0, 23);
  const [effectiveAt, setEffectiveAt] = useState(localNow); const [key] = useState(() => crypto.randomUUID()); const [saving, setSaving] = useState(false); const [error, setError] = useState('');
  const [actTypes, setActTypes] = useState<Array<{ id: string; nombre: string }>>([]); const [selectedActId, setSelectedActId] = useState(''); const [actsStatus, setActsStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const canonical = Boolean(quote.workflow?.stage);
  useEffect(() => {
    if (canonical) {
      if (!quote.actos?.length) { setActTypes([]); setSelectedActId(''); setActsStatus('error'); return; }
      const acceptedActs = quote.actos.map((item) => ({ id: item.tipo_acto_id, nombre: item.tipo_acto.nombre }));
      setActTypes(acceptedActs); setSelectedActId(acceptedActs[0].id); setActsStatus('ready');
      return;
    }
    const controller = new AbortController();
    void quotesService.actTypes(controller.signal).then((types) => {
      const normalized = (value: string) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLocaleLowerCase('es-MX');
      const prospectAct = normalized(quote.prospecto?.tipo_acto || '');
      const exact = types.find((type) => normalized(type.nombre) === prospectAct);
      setActTypes(types); setSelectedActId(exact?.id || ''); setActsStatus('ready');
    }).catch((cause) => { if (!(cause instanceof DOMException && cause.name === 'AbortError')) setActsStatus('error'); });
    return () => controller.abort();
  }, [canonical, quote.actos, quote.prospecto?.tipo_acto]);
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
  return <QuoteActionDialog title="Convertir a expediente" description="Se creará un expediente con todos los actos aceptados, sin aplicar movimientos financieros." onClose={onClose} footer={<><button type="button" className={styles.secondaryButton} onClick={onClose}>Cancelar</button><button type="button" className={styles.primaryButton} disabled={saving || actsStatus !== 'ready' || !selectedActId || !quote.conversion?.eligible || (canonical && !effectiveAt)} onClick={convert}>{saving && <LoaderCircle className={styles.spin} size={17} />}Convertir en expediente</button></>}><dl className={styles.confirmationList}><div><dt>Cliente</dt><dd>{quote.prospecto?.nombre || 'Sin cliente visible'}</dd></div><div><dt>Actos</dt><dd>{actTypes.length ? actTypes.map((item) => item.nombre).join(' · ') : quote.prospecto?.tipo_acto || 'Sin especificar'}</dd></div><div><dt>Solicitante formal</dt><dd>{quote.solicitante_formal?.nombre_busqueda || 'Sin confirmar'}</dd></div><div><dt>Cotización</dt><dd>{quote.numero_cotizacion || quote.numero_solicitud}</dd></div><div><dt>Responsable</dt><dd>{quote.creada_por?.nombre || 'Sin responsable visible'}</dd></div></dl><label className={styles.confirmDate}><span>{canonical ? 'Acto principal del expediente' : 'Tipo de acto del expediente'}</span><select aria-label="Tipo de acto del expediente" value={selectedActId} onChange={(event) => { setSelectedActId(event.target.value); setError(''); }} disabled={actsStatus !== 'ready'}><option value="">{actsStatus === 'loading' ? 'Cargando catálogo…' : 'Selecciona un tipo de acto'}</option>{actTypes.map((type) => <option key={type.id} value={type.id}>{type.nombre}</option>)}</select>{canonical && <small>Los demás actos aceptados también se incorporarán al expediente.</small>}</label>{actsStatus === 'error' && <div className={styles.formError} role="alert">{canonical ? 'La cotización no tiene actos estructurados aceptados. Corrige la cotización antes de convertir.' : 'No pudimos cargar el catálogo de actos. Cierra el diálogo e inténtalo nuevamente.'}</div>}{canonical && <label className={styles.confirmDate}><span>Fecha y hora efectiva</span><input type="datetime-local" step="0.001" max={localNow()} value={effectiveAt} onChange={(event) => setEffectiveAt(event.target.value)} required /></label>}{quote.conversion && !quote.conversion.eligible && <div className={styles.requirements}><strong>Requisitos pendientes</strong><ul>{quote.conversion.failures.map((failure) => <li key={failure}>{failure}</li>)}</ul></div>}{error && <div className={styles.formError} role="alert">{error}</div>}</QuoteActionDialog>;
}
