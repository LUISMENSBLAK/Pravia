import { useCallback, useEffect, useState } from 'react';
import { ArrowLeft, Check, Download, Eye, FilePlus2, FileText, LoaderCircle, Send, Trash2, X } from 'lucide-react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { DocumentViewer } from '../../components/documents/DocumentViewer';
import { useAuth } from '../auth/AuthProvider';
import { ConvertQuoteDialog } from './components/ConvertQuoteDialog';
import { QuoteActivity } from './components/QuoteActivity';
import { QuoteConcepts } from './components/QuoteConcepts';
import { QuoteContractActionDialog } from './components/QuoteContractActionDialog';
import { QuoteProgress } from './components/QuoteProgress';
import { QuoteStatusBadge } from './components/QuoteStatusBadge';
import { QuotesLoading } from './components/QuotesLoading';
import { RegisterDeliveryDialog } from './components/RegisterDeliveryDialog';
import { money, quoteDeadline, shortDate } from './quoteFormatters';
import { quotesService } from './quotes.service';
import type { Quote, QuoteContractAction, QuoteDocument, QuoteState } from './quotes.types';
import styles from './Quotes.module.css';

type ContractDialogAction = 'COMENZAR_ELABORACION' | 'INICIAR_SEGUIMIENTO' | 'ACEPTAR' | 'RECHAZAR' | 'SUSPENDER' | 'CANCELAR';

export function QuoteDetailPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const [quote, setQuote] = useState<Quote | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [busy, setBusy] = useState('');
  const [toast, setToast] = useState('');
  const [delivery, setDelivery] = useState<'NOTARIA' | 'CLIENTE' | null>(null);
  const [contractAction, setContractAction] = useState<ContractDialogAction | null>(null);
  const [convert, setConvert] = useState(false);
  const [viewer, setViewer] = useState<{ document: QuoteDocument; url?: string; loading?: boolean; error?: string } | null>(null);
  const canWrite = user?.permissions?.includes('cotizaciones.write') ?? false;
  const canConvert = user?.permissions?.includes('expedientes.write') ?? false;
  const canReadDocuments = user?.permissions?.includes('documentos.read') ?? false;
  const canDeleteDocuments = user?.permissions?.includes('documentos.unlink') ?? false;

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
  const download = async (document?: QuoteDocument) => {
    if (!quote) return;
    const selected = document ?? quote.documentos?.[0]; setBusy(`download:${selected?.id ?? ''}`);
    try {
      if (!selected) throw new Error('missing');
      await quotesService.downloadQuoteDocument(quote.id, selected); notify('Descarga iniciada.');
    } catch { notify('No fue posible descargar el documento.'); }
    finally { setBusy(''); }
  };
  const view = async (document: QuoteDocument) => {
    if (!quote) return;
    setBusy(`view:${document.id}`);
    setViewer({ document, loading: true });
    try { setViewer({ document, url: await quotesService.quoteDocumentPreviewUrl(quote.id, document.id) }); }
    catch { setViewer({ document, error: 'No fue posible preparar la vista previa del documento.' }); }
    finally { setBusy(''); }
  };
  const closeViewer = () => {
    if (viewer?.url) URL.revokeObjectURL(viewer.url);
    setViewer(null);
  };
  const removeDocument = async (document: QuoteDocument) => {
    if (!quote || !window.confirm(`¿Retirar “${document.nombre_original}” de esta cotización? El archivo histórico no se elimina físicamente.`)) return;
    setBusy(`delete:${document.id}`);
    try { await quotesService.deleteQuoteDocument(quote.id, document.id); await load(); notify('Documento retirado de la cotización.'); }
    catch (cause) { notify(cause instanceof Error ? cause.message : 'No fue posible retirar el documento.'); }
    finally { setBusy(''); }
  };
  const generateDocument = async () => {
    if (!quote) return;
    setBusy('generate');
    try { await quotesService.generateDocument(quote.id); await load(); notify('Documento de cotización generado desde ADM-001.'); }
    catch (cause) { notify(cause instanceof Error ? cause.message : 'No fue posible generar la cotización.'); }
    finally { setBusy(''); }
  };

  if (status === 'loading') return <QuotesLoading />;
  if (status === 'error' || !quote) return <section className={styles.pageState} role="alert"><span><FileText /></span><h1>No pudimos abrir esta cotización.</h1><p>Puede que ya no exista o que no tengas acceso.</p><Link className={styles.secondaryButton} to="/cotizaciones">Volver a Cotizaciones</Link></section>;

  const deadline = quoteDeadline(quote);
  const legacyAllowed = quote.transiciones_permitidas ?? [];
  const canonical = Boolean(quote.workflow?.stage);
  const actions = (quote.workflow?.actions ?? []).map((action) => typeof action === 'string' ? action : action.code) as QuoteContractAction[];
  const accepted = quote.workflow?.stage === 'ACEPTADA' || quote.workflow?.stage === 'ACEPTO_ANTICIPO' || (!canonical && quote.estado === 'ACEPTADA');

  return <div className={styles.detailPage} data-ai-trigger={accepted && !quote.expediente ? 'COTIZACION_ACEPTADA_SIN_EXPEDIENTE' : undefined}>
    <Link className={styles.backLink} to="/cotizaciones"><ArrowLeft size={17} />Cotizaciones</Link>
    <header className={styles.detailHeader}>
      <div><div className={styles.detailEyebrow}><QuoteStatusBadge quote={quote} />{!canonical && <span>Registro histórico</span>}</div><h1>{quote.numero_cotizacion || quote.numero_solicitud || 'Cotización'}</h1><p>{quote.prospecto?.nombre || 'Prospecto no disponible'} · {quote.prospecto?.tipo_acto || 'Acto sin especificar'}</p></div>
      <div className={styles.detailActions}>
        {canWrite && (quote.presupuesto?.concepts?.length ?? 0) > 0 && <button type="button" className={styles.primaryButton} onClick={() => void generateDocument()} disabled={busy === 'generate'}>{busy === 'generate' ? <LoaderCircle className={styles.spin} size={17} /> : <FilePlus2 size={17} />}Generar cotización</button>}
        {canonical && canWrite && actions.includes('ENVIAR_CLIENTE') && <button type="button" className={styles.primaryButton} onClick={() => setDelivery('CLIENTE')}><Send size={17} />Registrar envío al cliente</button>}
        {canonical && canWrite && actions.includes('REENVIAR_CLIENTE') && <button type="button" className={styles.secondaryButton} onClick={() => setDelivery('CLIENTE')}><Send size={17} />Registrar reenvío</button>}
        {!canonical && canWrite && legacyAllowed.includes('ENVIADA_NOTARIA') && <button type="button" className={styles.secondaryButton} onClick={() => setDelivery('NOTARIA')}><Send size={17} />Enviar a notaría</button>}
        {!canonical && canWrite && legacyAllowed.includes('ENVIADA_CLIENTE') && <button type="button" className={styles.secondaryButton} onClick={() => setDelivery('CLIENTE')}><Send size={17} />Enviar a cliente</button>}
      </div>
    </header>

    <QuoteProgress quote={quote} />

    <section className={styles.detailOverview} aria-label="Resumen de cotización">
      <article><small>Cliente</small><strong>{quote.prospecto?.nombre || 'Sin cliente visible'}</strong><span>{quote.prospecto?.email || quote.prospecto?.telefono || 'Sin contacto visible'}</span></article>
      <article><small>Importe cliente</small><strong>{quote.total_cliente == null ? 'Sin importe' : money(quote.total_cliente)}</strong><span>Total de la cotización</span></article>
      <article><small>{canonical ? 'Hito actual' : 'Vigencia / plazo histórico'}</small><strong className={styles[`deadline-${deadline.tone}`]}>{deadline.label}</strong><span>{canonical ? 'Fecha contractual registrada' : quote.fecha_limite_respuesta_notaria ? shortDate(quote.fecha_limite_respuesta_notaria) : 'Sin vencimiento registrado'}</span></article>
      <article><small>Responsable</small><strong>{quote.creada_por?.nombre || 'Sin asignar'}</strong><span>Presupuesto estructurado vigente</span></article>
    </section>

    <div className={styles.detailGrid}>
      <main>
        {quote.fuente_notarial && <section className={styles.detailSection}><h2>Cotización de Notaría · Fuente de origen</h2><p>Primera recepción: {shortDate(quote.fuente_notarial.received_at)} · Versión {quote.fuente_notarial.version}</p><button type="button" className={styles.secondaryButton} onClick={async () => { try { const url = await quotesService.documentUrl(quote.fuente_notarial!.documento.id); window.open(url, '_blank', 'noopener,noreferrer'); } catch { notify('No pudimos abrir la fuente notarial.'); } }}>Abrir {quote.fuente_notarial.documento.nombre_original}</button></section>}
        <QuoteConcepts quote={quote} canWrite={canWrite} onSaved={() => load()} notify={notify} />
        <QuoteActivity quote={quote} />
      </main>
      <aside>
        <section className={styles.detailSection}><header><div><h2>Acciones de negocio</h2><p>{canonical ? 'Acciones contractuales disponibles para el hito actual.' : 'Compatibilidad operativa del registro histórico.'}</p></div></header><div className={styles.businessActions}>
          {canonical && canWrite && actions.includes('COMENZAR_ELABORACION') && <button type="button" className={styles.primaryButton} onClick={() => setContractAction('COMENZAR_ELABORACION')}>Comenzar elaboración</button>}
          {canonical && canWrite && actions.includes('INICIAR_SEGUIMIENTO') && <button type="button" className={styles.primaryButton} onClick={() => setContractAction('INICIAR_SEGUIMIENTO')}>Iniciar seguimiento</button>}
          {canonical && canWrite && actions.includes('ACEPTAR') && <button type="button" className={styles.primaryButton} onClick={() => setContractAction('ACEPTAR')}><Check size={17} />Registrar aceptación</button>}
          {canonical && canWrite && actions.includes('RECHAZAR') && <button type="button" className={styles.dangerAction} onClick={() => setContractAction('RECHAZAR')}><X size={17} />Registrar rechazo</button>}
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
        <section className={styles.detailSection}><header><div><h2>Documentos</h2><p>Archivos operativos y cotizaciones generadas conservadas como evidencia.</p></div></header>{quote.documentos?.length ? <ul className={styles.documentList}>{quote.documentos.map((document) => <li key={document.id}><FileText size={17} /><span><strong>{document.nombre_original}</strong><small>{document.origen_etiqueta || 'Cotización'} · {document.tipo || 'Documento'}</small></span><div className={styles.documentActions}>{canReadDocuments && <button type="button" aria-label={`Ver ${document.nombre_original}`} onClick={() => void view(document)} disabled={Boolean(busy)}>{busy === `view:${document.id}` ? <LoaderCircle className={styles.spin} size={16} /> : <Eye size={16} />}Ver</button>}{canReadDocuments && <button type="button" aria-label={`Descargar ${document.nombre_original}`} onClick={() => void download(document)} disabled={Boolean(busy)}>{busy === `download:${document.id}` ? <LoaderCircle className={styles.spin} size={16} /> : <Download size={16} />}Descargar</button>}{canDeleteDocuments && document.can_delete && <button type="button" className={styles.documentDelete} aria-label={`Eliminar ${document.nombre_original}`} onClick={() => void removeDocument(document)} disabled={Boolean(busy)}>{busy === `delete:${document.id}` ? <LoaderCircle className={styles.spin} size={16} /> : <Trash2 size={16} />}Eliminar</button>}</div></li>)}</ul> : <p className={styles.sectionEmpty}>Sin documentos vinculados.</p>}</section>
      </aside>
    </div>

    {delivery && <RegisterDeliveryDialog quote={quote} target={delivery} onClose={() => setDelivery(null)} onDone={() => { setDelivery(null); void load(); notify(canonical && quote.workflow?.stage === 'ENVIADA_CLIENTE' ? 'Reenvío registrado sin cambiar el primer envío.' : 'Envío registrado con evidencia.'); }} />}
    {contractAction && <QuoteContractActionDialog quote={quote} action={contractAction} onClose={() => setContractAction(null)} onDone={() => { const completed = contractAction; setContractAction(null); void load(); notify(completed === 'ACEPTAR' ? 'Aceptación registrada.' : completed === 'SUSPENDER' ? 'Cotización suspendida.' : 'Acción registrada.'); }} />}
    {convert && <ConvertQuoteDialog quote={quote} onClose={() => setConvert(false)} onDone={(result) => { setConvert(false); notify(result.idempotent ? 'La cotización ya tenía expediente.' : 'Expediente creado correctamente.'); navigate(`/expedientes/${result.id}`); }} />}
    {viewer && <DocumentViewer open name={viewer.document.nombre_original} mimeType={viewer.document.mime_type} url={viewer.url} loading={viewer.loading} error={viewer.error} onClose={closeViewer} onDownload={() => void download(viewer.document)} />}
    <div className={`${styles.toast} ${toast ? styles.toastVisible : ''}`} role="status" aria-live="polite">{toast}</div>
  </div>;
}
