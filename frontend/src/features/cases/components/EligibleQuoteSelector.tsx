import { Check, FileCheck2, LoaderCircle, RefreshCw, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { ApiError } from '../../../services/api/client';
import { expedientesService } from '../expedientes.service';
import type { EligibleQuoteCandidate, ExpedienteDetail } from '../expedientes.types';
import styles from '../Expedientes.module.css';

const money = (value: number | string | null | undefined) => new Intl.NumberFormat('es-MX', {
  style: 'currency', currency: 'MXN', maximumFractionDigits: 2,
}).format(Number(value || 0));

export function EligibleQuoteSelector({ onClose, onConverted }: {
  onClose(): void;
  onConverted(expediente: ExpedienteDetail & { idempotent?: boolean }): void;
}) {
  const [quotes, setQuotes] = useState<EligibleQuoteCandidate[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [status, setStatus] = useState<'loading' | 'ready' | 'error' | 'denied'>('loading');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const load = () => {
    const controller = new AbortController();
    setStatus('loading'); setError('');
    expedientesService.eligibleQuotes(controller.signal)
      .then((result) => { setQuotes(result.data); setSelectedId((current) => result.data.some((quote) => quote.id === current) ? current : ''); setStatus('ready'); })
      .catch((cause) => {
        if (cause instanceof DOMException && cause.name === 'AbortError') return;
        setStatus(cause instanceof ApiError && cause.status === 403 ? 'denied' : 'error');
      });
    return controller;
  };

  useEffect(() => { const controller = load(); return () => controller.abort(); }, []);
  useEffect(() => {
    const close = (event: KeyboardEvent) => { if (event.key === 'Escape' && !saving) onClose(); };
    window.addEventListener('keydown', close);
    return () => window.removeEventListener('keydown', close);
  }, [onClose, saving]);

  const selected = useMemo(() => quotes.find((quote) => quote.id === selectedId), [quotes, selectedId]);
  const convert = async () => {
    if (!selected || saving) return;
    setSaving(true); setError('');
    try {
      onConverted(await expedientesService.convertQuote(selected.id));
    } catch (cause) {
      if (cause instanceof ApiError && cause.status === 403) setError('No tienes permiso para convertir esta cotización.');
      else if (cause instanceof ApiError && cause.status === 409) setError('La cotización cambió mientras la revisabas. Actualiza la lista para abrir el expediente existente o elegir otra.');
      else setError(cause instanceof ApiError ? cause.message : 'No pudimos convertir la cotización. Inténtalo nuevamente.');
      setSaving(false);
    }
  };

  return <div className={styles.drawerBackdrop} role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !saving) onClose(); }}>
    <section className={styles.drawer} role="dialog" aria-modal="true" aria-labelledby="eligible-quotes-title">
      <header className={styles.drawerHeader}><div><span>Nuevo expediente</span><h2 id="eligible-quotes-title">Selecciona una cotización elegible</h2><p>Los datos ya capturados se heredarán automáticamente, sin recaptura.</p></div><button type="button" aria-label="Cerrar" onClick={onClose} disabled={saving}><X size={20} /></button></header>
      <div className={styles.drawerBody}>
        {status === 'loading' && <div className={styles.formState} role="status"><LoaderCircle className={styles.spin} />Consultando cotizaciones elegibles…</div>}
        {status === 'denied' && <div className={styles.quoteSelectorState} role="alert"><FileCheck2 /><strong>No tienes permiso para abrir expedientes.</strong><p>Solicita acceso a una persona administradora.</p></div>}
        {status === 'error' && <div className={styles.quoteSelectorState} role="alert"><FileCheck2 /><strong>No pudimos cargar las cotizaciones.</strong><p>La fuente operativa no está disponible en este momento.</p><button type="button" className={styles.secondaryButton} onClick={load}><RefreshCw size={16} />Reintentar</button></div>}
        {status === 'ready' && !quotes.length && <div className={styles.quoteSelectorState}><FileCheck2 /><strong>No hay cotizaciones listas para convertir.</strong><p>Una cotización aparecerá aquí cuando esté aceptada, tenga versión aprobada y anticipo validado.</p></div>}
        {status === 'ready' && quotes.length > 0 && <fieldset className={styles.flowStep}><legend>Cotizaciones disponibles</legend><p>La elegibilidad fue validada por PRAVIA. Selecciona una para continuar.</p><div className={styles.eligibleQuoteList}>{quotes.map((quote) => <button type="button" key={quote.id} className={selectedId === quote.id ? styles.choiceSelected : ''} aria-pressed={selectedId === quote.id} onClick={() => setSelectedId(quote.id)}><span className={styles.quoteSelectorIcon}><FileCheck2 size={18} /></span><span className={styles.quoteSelectorCopy}><strong>{quote.numero_cotizacion || quote.numero_solicitud || 'Cotización'}</strong><b>{quote.prospecto.nombre}</b><small>{quote.prospecto.tipo_acto || 'Acto sin especificar'} · {quote.notaria?.numero_notaria ? `Notaría ${quote.notaria.numero_notaria}` : quote.notaria?.nombre || 'Sin notaría'}</small></span><span className={styles.quoteSelectorAmount}><strong>{money(quote.total_cliente)}</strong><small>Anticipo validado {money(quote.conversion.validatedAdvanceTotal)}</small></span>{selectedId === quote.id && <Check className={styles.quoteSelectorCheck} size={18} />}</button>)}</div></fieldset>}
        {error && <div className={styles.formError} role="alert">{error}</div>}
      </div>
      <footer className={styles.drawerFooter}><button type="button" className={styles.secondaryButton} onClick={onClose} disabled={saving}>Cancelar</button><span /><button type="button" className={styles.primaryButton} disabled={!selected || saving || status !== 'ready'} onClick={convert}>{saving ? <><LoaderCircle className={styles.spin} size={17} />Convirtiendo…</> : 'Convertir en expediente'}</button></footer>
    </section>
  </div>;
}
