import { useCallback, useEffect, useState } from 'react';
import { ArrowLeft, Check, Download, FileText, LoaderCircle, Pencil, Send, X } from 'lucide-react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '../auth/AuthProvider';
import { ConvertQuoteDialog } from './components/ConvertQuoteDialog';
import { EditQuoteVersionDrawer } from './components/EditQuoteVersionDrawer';
import { QuoteActivity } from './components/QuoteActivity';
import { QuoteConcepts } from './components/QuoteConcepts';
import { QuoteContractActionDialog } from './components/QuoteContractActionDialog';
import { QuoteStatusBadge } from './components/QuoteStatusBadge';
import { QuoteVersions } from './components/QuoteVersions';
import { QuotesLoading } from './components/QuotesLoading';
import { RegisterDeliveryDialog } from './components/RegisterDeliveryDialog';
import { money, quoteDeadline, shortDate } from './quoteFormatters';
import { quotesService } from './quotes.service';
import type { Quote, QuoteContractAction, QuoteState, QuoteVersion } from './quotes.types';
import styles from './Quotes.module.css';

type ContractDialogAction = 'REGISTRAR_ACEPTACION_ANTICIPO' | 'SUSPENDER' | 'CANCELAR';

export function QuoteDetailPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const [quote, setQuote] = useState<Quote | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [busy, setBusy] = useState('');
  const [toast, setToast] = useState('');
  const [edit, setEdit] = useState(false);
  const [delivery, setDelivery] = useState<'NOTARIA' | 'CLIENTE' | null>(null);
  const [contractAction, setContractAction] = useState<ContractDialogAction | null>(null);
  const [convert, setConvert] = useState(false);
  const canWrite = user?.permissions?.includes('cotizaciones.write') ?? false;
  const canConvert = user?.permissions?.includes('expedientes.write') ?? false;

  const load = useCallback(async (signal?: AbortSignal) => {
    try { setQuote(await quotesService.getDetail(id, signal)); setStatus('ready'); }
    catch (error) { if (!(error instanceof DOMException && error.name === 'AbortError')) setStatus('error'); }
  }, [id]);
  useEffect(() => { const controller = new AbortController(); void load(controller.signal); return () => controller.abort(); }, [load]);
  const notify = (message: string) => { setToast(message); window.setTimeout(() => setToast(''), 3500); };
  const updateLegacyState = async (state: QuoteState) => {
    if (!quote) return;
    setBusy(state);
    try { await quotesService.updateState(quote.id, state); await load(); notify(state === 'ACEPTADA' ? 'Cotización histórica aceptada.' : 'Estado histórico actualizado.'); }
    catch { notify('No fue posible actualizar el estado.'); }
    finally { setBusy(''); }
  };
  const download = async () => {
    if (!quote) return;
    const current = quote.versiones.find((item) => item.aprobada) ?? quote.versiones[0]; setBusy('download');
    try {
      const direct = current?.pdf_url;
      const pdfDocument = quote.documentos?.find((item) => item.mime_type === 'application/pdf' || item.nombre_original.toLowerCase().endsWith('.pdf'));
      const url = direct || (pdfDocument ? await quotesService.documentUrl(pdfDocument.id) : '');
      if (!url) throw new Error('missing');
      window.open(url, '_blank', 'noopener,noreferrer'); notify('Documento abierto para descarga.');
    } catch { notify('No hay un PDF disponible para esta cotización.'); }
    finally { setBusy(''); }
  };

  if (status === 'loading') return <QuotesLoading />;
  if (status === 'error' || !quote) return <section className={styles.pageState} role="alert"><span><FileText /></span><h1>No pudimos abrir esta cotización.</h1><p>Puede que ya no exista o que no tengas acceso.</p><Link className={styles.secondaryButton} to="/cotizaciones">Volver a Cotizaciones</Link></section>;

  const currentVersion = quote.versiones.find((item) => item.aprobada) ?? quote.versiones[0];
  const deadline = quoteDeadline(quote);
  const legacyAllowed = quote.transiciones_permitidas ?? [];
  const canonical = Boolean(quote.workflow?.stage);
  const actions = (quote.workflow?.actions ?? []).map((action) => typeof action === 'string' ? action : action.code) as QuoteContractAction[];
  const hasPdf = Boolean(currentVersion?.pdf_url || quote.documentos?.some((item) => item.mime_type === 'application/pdf' || item.nombre_original.toLowerCase().endsWith('.pdf')));
  const accepted = quote.workflow?.stage === 'ACEPTO_ANTICIPO' || (!canonical && quote.estado === 'ACEPTADA');

  return <div className={styles.detailPage} data-ai-trigger={accepted && !quote.expediente ? 'COTIZACION_ACEPTADA_SIN_EXPEDIENTE' : undefined}>
    <Link className={styles.backLink} to="/cotizaciones"><ArrowLeft size={17} />Cotizaciones</Link>
    <header className={styles.detailHeader}>
      <div><div className={styles.detailEyebrow}><QuoteStatusBadge quote={quote} /><span>Versión actual v{quote.version_actual}</span>{!canonical && <span>Registro histórico</span>}</div><h1>{quote.numero_cotizacion || quote.numero_solicitud || 'Cotización'}</h1><p>{quote.prospecto?.nombre || 'Prospecto no disponible'} · {quote.prospecto?.tipo_acto || 'Acto sin especificar'}</p></div>
      <div className={styles.detailActions}>
        {canWrite && <button type="button" className={styles.secondaryButton} onClick={() => setEdit(true)}><Pencil size={17} />Editar versión</button>}
        <button type="button" className={styles.secondaryButton} onClick={download} disabled={!hasPdf || busy === 'download'}>{busy === 'download' ? <LoaderCircle className={styles.spin} size={17} /> : <Download size={17} />}Descargar</button>
        {canonical && canWrite && actions.includes('ENVIAR_CLIENTE') && <button type="button" className={styles.primaryButton} onClick={() => setDelivery('CLIENTE')}><Send size={17} />Registrar envío al cliente</button>}
        {canonical && canWrite && actions.includes('REENVIAR_CLIENTE') && <button type="button" className={styles.secondaryButton} onClick={() => setDelivery('CLIENTE')}><Send size={17} />Registrar reenvío</button>}
        {!canonical && canWrite && legacyAllowed.includes('ENVIADA_NOTARIA') && <button type="button" className={styles.secondaryButton} onClick={() => setDelivery('NOTARIA')}><Send size={17} />Enviar a notaría</button>}
        {!canonical && canWrite && legacyAllowed.includes('ENVIADA_CLIENTE') && <button type="button" className={styles.secondaryButton} onClick={() => setDelivery('CLIENTE')}><Send size={17} />Enviar a cliente</button>}
      </div>
    </header>

    <section className={styles.detailOverview} aria-label="Resumen de cotización">
      <article><small>Cliente</small><strong>{quote.prospecto?.nombre || 'Sin cliente visible'}</strong><span>{quote.prospecto?.email || quote.prospecto?.telefono || 'Sin contacto visible'}</span></article>
      <article><small>Importe cliente</small><strong>{quote.total_cliente == null ? 'Sin importe' : money(quote.total_cliente)}</strong><span>Total de la cotización</span></article>
      <article><small>{canonical ? 'Hito actual' : 'Vigencia / plazo histórico'}</small><strong className={styles[`deadline-${deadline.tone}`]}>{deadline.label}</strong><span>{canonical ? 'Fecha contractual registrada' : quote.fecha_limite_respuesta_notaria ? shortDate(quote.fecha_limite_respuesta_notaria) : 'Sin vencimiento registrado'}</span></article>
      <article><small>Versión vigente</small><strong>{currentVersion ? `v${currentVersion.version}` : 'Sin versión'}</strong><span>{currentVersion?.aprobada ? 'Vigente' : 'Pendiente de aprobación'}</span></article>
    </section>

    <div className={styles.detailGrid}>
      <main>
        {quote.fuente_notarial && <section className={styles.detailSection}><h2>Cotización de Notaría · Fuente de origen</h2><p>Primera recepción: {shortDate(quote.fuente_notarial.received_at)} · Versión {quote.fuente_notarial.version}</p><button type="button" className={styles.secondaryButton} onClick={async () => { try { const url = await quotesService.documentUrl(quote.fuente_notarial!.documento.id); window.open(url, '_blank', 'noopener,noreferrer'); } catch { notify('No pudimos abrir la fuente notarial.'); } }}>Abrir {quote.fuente_notarial.documento.nombre_original}</button></section>}
        <QuoteConcepts version={currentVersion} />
        <QuoteActivity quote={quote} />
      </main>
      <aside>
        <section className={styles.detailSection}><header><div><h2>Acciones de negocio</h2><p>{canonical ? 'Acciones contractuales disponibles para el hito actual.' : 'Compatibilidad operativa del registro histórico.'}</p></div></header><div className={styles.businessActions}>
          {canonical && canWrite && actions.includes('REGISTRAR_ACEPTACION_ANTICIPO') && <button type="button" className={styles.primaryButton} onClick={() => setContractAction('REGISTRAR_ACEPTACION_ANTICIPO')}><Check size={17} />Registrar Aceptó / Anticipo</button>}
          {canonical && canConvert && actions.includes('CONVERTIR') && !quote.expediente && <button type="button" className={styles.primaryButton} onClick={() => setConvert(true)}>Convertir en expediente</button>}
          {canonical && canWrite && actions.includes('SUSPENDER') && <button type="button" onClick={() => setContractAction('SUSPENDER')}>Suspender cotización</button>}
          {canonical && canWrite && actions.includes('CANCELAR') && <button type="button" className={styles.dangerAction} onClick={() => setContractAction('CANCELAR')}><X size={17} />Cancelar cotización</button>}
          {!canonical && quote.fuente_notarial_id && legacyAllowed.includes('EN_REVISION_ABOGADO') && canWrite && <button type="button" onClick={() => void updateLegacyState('EN_REVISION_ABOGADO')} disabled={Boolean(busy)}>Pasar a revisión</button>}
          {!canonical && legacyAllowed.includes('ACEPTADA') && canWrite && <button type="button" onClick={() => void updateLegacyState('ACEPTADA')} disabled={Boolean(busy)}><Check size={17} />Aceptar cotización histórica</button>}
          {!canonical && legacyAllowed.includes('RECHAZADA') && canWrite && <button type="button" className={styles.dangerAction} onClick={() => void updateLegacyState('RECHAZADA')} disabled={Boolean(busy)}><X size={17} />Registrar rechazo histórico</button>}
          {!canonical && canConvert && quote.estado === 'ACEPTADA' && !quote.expediente && <button type="button" className={styles.primaryButton} onClick={() => setConvert(true)}>Convertir registro histórico</button>}
          {quote.expediente && <Link className={styles.secondaryButton} to={`/expedientes/${quote.expediente.id}`}>Ir al expediente</Link>}
          {!actions.length && !legacyAllowed.length && !quote.expediente && <p>No hay acciones disponibles en el estado actual.</p>}
        </div></section>
        <QuoteVersions versions={quote.versiones} />
        <section className={styles.detailSection}><header><div><h2>Documentos</h2><p>Documentos relacionados con la cotización.</p></div></header>{quote.documentos?.length ? <ul className={styles.documentList}>{quote.documentos.map((document) => <li key={document.id}><FileText size={17} /><span><strong>{document.nombre_original}</strong><small>{document.origen_etiqueta || 'Cotización'} · {document.tipo || 'Documento'}</small></span></li>)}</ul> : <p className={styles.sectionEmpty}>Sin documentos vinculados.</p>}</section>
      </aside>
    </div>

    {edit && <EditQuoteVersionDrawer quote={quote} onClose={() => setEdit(false)} onCreated={(version: QuoteVersion) => { setEdit(false); setQuote((current) => current ? { ...current, versiones: [version, ...current.versiones], version_actual: version.version, total_cliente: version.total_cliente, total_notaria: version.total_notaria, honorarios_pravia: version.honorarios_pravia } : current); notify(`Versión v${version.version} creada.`); }} />}
    {delivery && <RegisterDeliveryDialog quote={quote} target={delivery} onClose={() => setDelivery(null)} onDone={() => { setDelivery(null); void load(); notify(canonical && quote.workflow?.stage === 'ENVIADA_CLIENTE' ? 'Reenvío registrado sin cambiar el primer envío.' : 'Envío registrado con evidencia.'); }} />}
    {contractAction && <QuoteContractActionDialog quote={quote} action={contractAction} onClose={() => setContractAction(null)} onDone={() => { const completed = contractAction; setContractAction(null); void load(); notify(completed === 'REGISTRAR_ACEPTACION_ANTICIPO' ? 'Hito Aceptó / Anticipo registrado.' : completed === 'SUSPENDER' ? 'Cotización suspendida.' : 'Cotización cancelada.'); }} />}
    {convert && <ConvertQuoteDialog quote={quote} onClose={() => setConvert(false)} onDone={(result) => { setConvert(false); notify(result.idempotent ? 'La cotización ya tenía expediente.' : 'Expediente creado correctamente.'); navigate(`/expedientes/${result.id}`); }} />}
    <div className={`${styles.toast} ${toast ? styles.toastVisible : ''}`} role="status" aria-live="polite">{toast}</div>
  </div>;
}
