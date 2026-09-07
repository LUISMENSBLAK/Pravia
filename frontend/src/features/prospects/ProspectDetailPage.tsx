import { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, CalendarDays, Download, FileCheck2, FileText, LoaderCircle, MessageSquarePlus, Unlink, UserRound, UsersRound } from 'lucide-react';
import { Link, useParams } from 'react-router-dom';
import { useAuth } from '../auth/AuthProvider';
import { FollowUpForm } from './components/FollowUpForm';
import { ProspectActivity } from './components/ProspectActivity';
import { ProspectDocumentPicker } from './components/ProspectDocumentPicker';
import { ProspectInlineEditor } from './components/ProspectInlineEditor';
import { ProspectsLoading } from './components/ProspectsLoading';
import { ProspectWorkflowPanel } from './components/ProspectWorkflowPanel';
import { prospectsService } from './prospects.service';
import type { Prospect, ProspectCatalogs, ProspectDocument, ProspectWorkflow } from './prospects.types';
import { displayProspectName, SUBSTATUS_LABELS } from './prospects.types';
import { QUOTE_STATE_LABELS } from '../quotes/quoteFormatters';
import styles from './ProspectsPage.module.css';

const formatDate = (value?: string | null, withTime = false) => value
  ? new Intl.DateTimeFormat('es-MX', withTime ? { dateStyle: 'medium', timeStyle: 'short' } : { dateStyle: 'medium' }).format(new Date(value))
  : 'Sin actividad';

export function ProspectDetailPage() {
  const { id = '' } = useParams();
  const { user } = useAuth();
  const [prospect, setProspect] = useState<Prospect | null>(null);
  const [workflow, setWorkflow] = useState<ProspectWorkflow | null>(null);
  const [documents, setDocuments] = useState<ProspectDocument[]>([]);
  const [catalogs, setCatalogs] = useState<ProspectCatalogs>({ stages: [], services: [] });
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [showFollowUp, setShowFollowUp] = useState(false);
  const [files, setFiles] = useState<File[]>([]);
  const [uploading, setUploading] = useState(false);
  const [documentError, setDocumentError] = useState('');
  const [toast, setToast] = useState('');
  const [unlinkTarget, setUnlinkTarget] = useState<ProspectDocument | null>(null);
  const [unlinking, setUnlinking] = useState(false);
  const canWrite = user?.permissions?.includes('prospectos.write') ?? false;
  const canUpload = user?.permissions?.includes('documentos.write') ?? false;
  const canReadDocuments = user?.permissions?.includes('documentos.read') ?? false;
  const canUnlink = canWrite && (user?.permissions?.includes('documentos.unlink') ?? false);
  const notify = (message: string) => { setToast(message); window.setTimeout(() => setToast(''), 5200); };

  const loadDocuments = async (signal?: AbortSignal) => {
    if (!canReadDocuments) return [];
    try { const result = await prospectsService.getDocuments(id, signal); setDocuments(result); setDocumentError(''); return result; }
    catch (error) { if (!(error instanceof DOMException && error.name === 'AbortError')) setDocumentError('No pudimos cargar los documentos. Reintenta.'); return []; }
  };
  const reload = async () => {
    const [result, operation] = await Promise.all([prospectsService.get(id), prospectsService.workflow(id)]);
    setProspect(result);
    setWorkflow(operation);
    await loadDocuments();
  };
  useEffect(() => {
    const controller = new AbortController();
    setStatus('loading');
    Promise.all([
      prospectsService.get(id, controller.signal),
      prospectsService.catalogs(controller.signal),
      prospectsService.workflow(id, controller.signal),
      loadDocuments(controller.signal),
    ]).then(([result, catalogResult, operation]) => {
      setProspect(result); setCatalogs(catalogResult); setWorkflow(operation); setStatus('ready');
    }).catch((error) => { if (!(error instanceof DOMException && error.name === 'AbortError')) setStatus('error'); });
    return () => controller.abort();
  }, [id, canReadDocuments]);

  const latestActivity = useMemo(() => {
    const candidates = [
      ...(prospect?.seguimientos ?? []).map((item) => item.created_at),
      ...(workflow?.events ?? []).map((item) => item.recordedAt),
    ].filter(Boolean).map((value) => new Date(value).getTime()).filter(Number.isFinite);
    return candidates.length ? new Date(Math.max(...candidates)).toISOString() : prospect?.created_at ?? null;
  }, [prospect, workflow]);

  if (status === 'loading') return <ProspectsLoading />;
  if (status === 'error' || !prospect || !workflow) return <section className={styles.pageState} role="alert"><UsersRound /><h1>No pudimos abrir este prospecto.</h1><p>Puede que ya no exista o que no tengas acceso.</p><Link className={styles.secondaryLink} to="/prospectos">Volver a Prospectos</Link></section>;
  const latest = prospect.seguimientos?.[0];
  const sourceIds = new Set(workflow.sourceHistory.map((source) => source.documento.id));
  const visibleDocuments = documents.filter((document) => !sourceIds.has(document.id));
  const quoteLabel = prospect.cotizacion?.estado ? QUOTE_STATE_LABELS[prospect.cotizacion.estado as keyof typeof QUOTE_STATE_LABELS] || 'Cotización vinculada' : 'Cotización vinculada';
  const upload = async () => {
    if (!files.length) return;
    setUploading(true);
    const results = await Promise.allSettled(files.map((file) => prospectsService.uploadDocument(prospect.id, file, 'INICIAL')));
    setFiles((current) => current.filter((_, index) => results[index]?.status === 'rejected'));
    await loadDocuments();
    setUploading(false);
    const failed = results.filter((result) => result.status === 'rejected').length;
    notify(failed ? `${failed} documento${failed === 1 ? '' : 's'} no pudo guardarse.` : 'Documentación vinculada al prospecto.');
  };
  const openDocument = async (document: ProspectDocument) => {
    try { window.open(await prospectsService.getDocumentUrl(document.id), '_blank', 'noopener,noreferrer'); }
    catch { notify('No pudimos abrir el documento.'); }
  };
  const unlink = async () => {
    if (!unlinkTarget || unlinking) return;
    setUnlinking(true);
    try { await prospectsService.unlinkDocument(id, unlinkTarget.id); setUnlinkTarget(null); await loadDocuments(); notify('Documento desvinculado; el archivo maestro se conserva.'); }
    catch { notify('No pudimos desvincular el documento.'); }
    finally { setUnlinking(false); }
  };
  const addFollowUp = (item: NonNullable<Prospect['seguimientos']>[number]) => {
    setProspect((current) => current ? { ...current, seguimientos: [item, ...(current.seguimientos ?? [])] } : current);
    setShowFollowUp(false);
    notify('Seguimiento registrado.');
  };

  return <div className={styles.detailPage} data-ai-trigger={!latest?.proxima_accion ? 'SIN_SIGUIENTE_ACCION' : undefined}>
    <Link className={styles.backLink} to="/prospectos"><ArrowLeft size={17} />Prospectos</Link>
    <header className={styles.detailHeader}><div><div className={styles.detailEyebrow}><span className={styles.stateBadge}>{workflow.stageLabel}</span>{workflow.knowledge === 'UNKNOWN_LEGACY' && <span>Histórico · {SUBSTATUS_LABELS[prospect.estado]}</span>}</div><h1>{displayProspectName(prospect.nombre)}</h1><p>{workflow.folio || 'Folio histórico no asignado'} · {prospect.servicio_catalogo?.label || prospect.tipo_acto || 'Acto por definir'}</p></div>{canWrite && <button className={styles.secondaryButton} type="button" onClick={() => setShowFollowUp(true)}><MessageSquarePlus size={18} />Registrar seguimiento</button>}</header>
    <section className={styles.detailOverview} aria-label="Resumen del prospecto">
      <article><span><FileText size={18} /></span><div><small>Folio</small><strong>{workflow.folio || 'Sin folio canónico'}</strong></div></article>
      <article><span><UserRound size={18} /></span><div><small>Responsable</small><strong>{prospect.atendido_por?.nombre || 'Sin responsable visible'}</strong></div></article>
      <article><span><CalendarDays size={18} /></span><div><small>Creado</small><strong>{formatDate(prospect.created_at)}</strong></div></article>
      <article><span><MessageSquarePlus size={18} /></span><div><small>Última actividad</small><strong>{formatDate(latestActivity, true)}</strong></div></article>
    </section>
    <div className={styles.detailGrid}>
      <main>
        <ProspectWorkflowPanel prospect={prospect} workflow={workflow} canWrite={canWrite} onChanged={reload} />
        <ProspectInlineEditor prospect={prospect} workflow={workflow} catalogs={catalogs} canWrite={canWrite} onChanged={reload} notify={notify} />
        <section className={styles.detailSection}><header><div><h2>Actividad / seguimiento</h2><p>Historial informativo; las etapas se cambian únicamente con sus acciones contextuales.</p></div>{canWrite && !showFollowUp && <button type="button" onClick={() => setShowFollowUp(true)}>+ Registrar seguimiento</button>}</header>{showFollowUp && <FollowUpForm prospectId={prospect.id} onCancel={() => setShowFollowUp(false)} onCreated={addFollowUp} />}<ProspectActivity followUps={prospect.seguimientos ?? []} /></section>
      </main>
      <aside className={styles.detailSidebar}>
        <section className={styles.detailSection}><header><div><h2>Documentación inicial ({visibleDocuments.length})</h2><p>Archivos persistentes de la operación.</p></div></header>
          {documentError && <p className={styles.sectionEmpty} role="alert">{documentError} <button type="button" onClick={() => void loadDocuments()}>Reintentar</button></p>}
          {visibleDocuments.length ? <ul className={styles.documentList}>{visibleDocuments.map((document) => <li key={document.id}><FileText size={16} /><span><strong>{document.nombre_original}</strong><small>{document.tipo || 'Documento inicial'} · {formatDate(document.fecha_carga)}</small></span>{canReadDocuments && <button type="button" className={styles.documentOpen} aria-label={`Ver o descargar ${document.nombre_original}`} onClick={() => void openDocument(document)}><Download size={16} /></button>}{canUnlink && <button type="button" className={styles.documentOpen} aria-label={`Eliminar vínculo de ${document.nombre_original}`} onClick={() => setUnlinkTarget(document)}><Unlink size={16} /></button>}</li>)}</ul> : <p className={styles.sectionEmpty}>Sin documentos vinculados.</p>}
          {unlinkTarget && <div className={styles.unlinkConfirmation} role="group" aria-label="Confirmar desvinculación"><p>¿Desvincular {unlinkTarget.nombre_original}? No se eliminará el blob ni otras relaciones.</p><button type="button" disabled={unlinking} onClick={() => void unlink()}>Confirmar</button><button type="button" disabled={unlinking} onClick={() => setUnlinkTarget(null)}>Cancelar</button></div>}
          {canUpload && <div className={styles.detailUploader}><ProspectDocumentPicker id="initial-document" label="Agregar documentos" files={files} disabled={uploading} onChange={setFiles} /><button type="button" className={styles.secondaryButton} disabled={uploading || !files.length} onClick={() => void upload()}>{uploading ? <LoaderCircle className={styles.spin} size={16} /> : <FileCheck2 size={16} />}Subir seleccionados</button></div>}
        </section>
        {prospect.cotizacion && <section className={styles.detailSection}><h2>Cotización relacionada</h2><div className={styles.relatedQuote}><FileText size={20} /><div><strong>{quoteLabel}</strong><Link to={`/cotizaciones/${encodeURIComponent(prospect.cotizacion.id)}`}>Ir a cotización</Link></div></div></section>}
      </aside>
    </div>
    <div className={`${styles.toast} ${toast ? styles.toastVisible : ''}`} role="status" aria-live="polite">{toast}</div>
  </div>;
}
