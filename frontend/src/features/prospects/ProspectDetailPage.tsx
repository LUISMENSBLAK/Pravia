import { useEffect, useState } from 'react';
import { ArrowLeft, CalendarDays, Download, FileCheck2, FilePlus2, FileText, LoaderCircle, Mail, MessageSquarePlus, Pencil, Phone, UserRound, UsersRound } from 'lucide-react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '../auth/AuthProvider';
import { EditProspectDrawer } from './components/EditProspectDrawer';
import { FollowUpForm } from './components/FollowUpForm';
import { ProspectActivity } from './components/ProspectActivity';
import { ProspectDocumentPicker } from './components/ProspectDocumentPicker';
import { ProspectsLoading } from './components/ProspectsLoading';
import { prospectsService } from './prospects.service';
import type { Prospect, ProspectCatalogs, ProspectDocument } from './prospects.types';
import { displayProspectName, SUBSTATUS_LABELS } from './prospects.types';
import styles from './ProspectsPage.module.css';

const formatDate = (value?: string | null) => value ? new Intl.DateTimeFormat('es-MX', { dateStyle: 'medium' }).format(new Date(value)) : 'Sin actividad';
const priorityLabel = { ALTA: 'Alta', MEDIA: 'Media', BAJA: 'Baja' } as const;

export function ProspectDetailPage() {
  const { id = '' } = useParams();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [prospect, setProspect] = useState<Prospect | null>(null);
  const [documents, setDocuments] = useState<ProspectDocument[]>([]);
  const [catalogs, setCatalogs] = useState<ProspectCatalogs>({ stages: [], services: [] });
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [showFollowUp, setShowFollowUp] = useState(false);
  const [showEdit, setShowEdit] = useState(false);
  const [predialFiles, setPredialFiles] = useState<File[]>([]);
  const [antecedenteFiles, setAntecedenteFiles] = useState<File[]>([]);
  const [uploading, setUploading] = useState(false);
  const [toast, setToast] = useState('');
  const canWrite = user?.permissions?.includes('prospectos.write') ?? false;
  const canUpload = user?.permissions?.includes('documentos.write') ?? false;
  const canReadDocuments = user?.permissions?.includes('documentos.read') ?? false;

  const showToast = (message: string) => { setToast(message); window.setTimeout(() => setToast(''), 5200); };
  const loadDocuments = async () => setDocuments(await prospectsService.getDocuments(id));

  useEffect(() => {
    const controller = new AbortController();
    setStatus('loading');
    Promise.all([
      prospectsService.get(id, controller.signal),
      prospectsService.getDocuments(id, controller.signal).catch(() => []),
      prospectsService.catalogs(controller.signal),
    ]).then(([result, docs, catalogResult]) => {
      setProspect(result); setDocuments(docs); setCatalogs(catalogResult); setStatus('ready');
    }).catch((error) => { if (!(error instanceof DOMException && error.name === 'AbortError')) setStatus('error'); });
    return () => controller.abort();
  }, [id]);

  if (status === 'loading') return <ProspectsLoading />;
  if (status === 'error' || !prospect) return <section className={styles.pageState} role="alert"><UsersRound /><h1>No pudimos abrir este prospecto.</h1><p>Puede que ya no exista o que no tengas acceso.</p><Link className={styles.secondaryLink} to="/prospectos">Volver a Prospectos</Link></section>;
  const latest = prospect.seguimientos?.[0];
  const addFollowUp = (item: NonNullable<Prospect['seguimientos']>[number]) => {
    setProspect((current) => current ? { ...current, seguimientos: [item, ...(current.seguimientos ?? [])], updated_at: item.created_at } : current);
    setShowFollowUp(false); showToast('Seguimiento registrado.');
  };
  const uploadDocuments = async () => {
    const requests = [
      ...predialFiles.map((file) => prospectsService.uploadDocument(prospect.id, file, 'PREDIAL')),
      ...antecedenteFiles.map((file) => prospectsService.uploadDocument(prospect.id, file, 'ANTECEDENTE')),
    ];
    if (!requests.length) return;
    setUploading(true);
    const results = await Promise.allSettled(requests);
    const failed = results.filter((result) => result.status === 'rejected').length;
    const predialFailed = results.slice(0, predialFiles.length).filter((result) => result.status === 'rejected').length;
    const antecedenteFailed = results.slice(predialFiles.length).filter((result) => result.status === 'rejected').length;
    setPredialFiles((current) => current.filter((_, index) => results[index]?.status === 'rejected'));
    setAntecedenteFiles((current) => current.filter((_, index) => results[predialFiles.length + index]?.status === 'rejected'));
    setProspect((current) => current ? {
      ...current,
      tiene_predial: current.tiene_predial || predialFiles.length > predialFailed,
      tiene_antecedente: current.tiene_antecedente || antecedenteFiles.length > antecedenteFailed,
    } : current);
    await loadDocuments().catch(() => undefined);
    setUploading(false);
    showToast(failed ? `${failed} ${failed === 1 ? 'documento no pudo cargarse' : 'documentos no pudieron cargarse'}. Los demás se guardaron.` : 'Documentación vinculada al prospecto.');
  };
  const openDocument = async (document: ProspectDocument) => {
    try {
      const url = await prospectsService.getDocumentUrl(document.id);
      window.open(url, '_blank', 'noopener,noreferrer');
    } catch { showToast('No pudimos abrir el documento. Verifica tus permisos e inténtalo de nuevo.'); }
  };

  return <div className={styles.detailPage} data-ai-trigger={!latest?.proxima_accion ? 'SIN_SIGUIENTE_ACCION' : undefined}>
    <Link className={styles.backLink} to="/prospectos"><ArrowLeft size={17} />Prospectos</Link>
    <header className={styles.detailHeader}><div><div className={styles.detailEyebrow}><span className={`${styles.stateBadge} ${styles[`state${prospect.estado}`]}`}>{SUBSTATUS_LABELS[prospect.estado]}</span><span>Actualizado {formatDate(prospect.updated_at)}</span></div><h1>{displayProspectName(prospect.nombre)}</h1><p>{prospect.servicio_catalogo?.label || prospect.tipo_acto || 'Servicio por definir'}</p></div>{canWrite && <div className={styles.detailHeaderActions}><button className={styles.secondaryButton} type="button" onClick={() => setShowEdit(true)}><Pencil size={17} />Editar</button>{!prospect.cotizacion && <button className={styles.secondaryButton} type="button" onClick={() => navigate(`/cotizaciones?new=1&prospecto=${encodeURIComponent(prospect.id)}`)}><FilePlus2 size={18} />Crear cotización</button>}<button className={styles.primaryButton} type="button" onClick={() => setShowFollowUp(true)}><MessageSquarePlus size={18} />Registrar seguimiento</button></div>}</header>
    <section className={styles.detailOverview} aria-label="Resumen del prospecto"><article><span><UserRound size={18} /></span><div><small>Responsable</small><strong>{prospect.atendido_por?.nombre || 'Sin responsable visible'}</strong></div></article><article><span><CalendarDays size={18} /></span><div><small>Etapa documental</small><strong>{prospect.etapa_operativa?.label || 'Sin etapa asignada'}</strong></div></article><article><span><FileText size={18} /></span><div><small>Cotización</small><strong>{prospect.cotizacion ? prospect.cotizacion.estado || 'Vinculada' : 'Sin cotización'}</strong></div></article><article><span><MessageSquarePlus size={18} /></span><div><small>Siguiente acción</small><strong>{latest?.proxima_accion || 'Sin siguiente acción'}</strong></div></article></section>
    <div className={styles.detailGrid}>
      <main><section className={styles.detailSection}><header><div><h2>Seguimiento y actividad</h2><p>Historial ordenado por actividad más reciente.</p></div>{canWrite && !showFollowUp && <button type="button" onClick={() => setShowFollowUp(true)}>+ Registrar seguimiento</button>}</header>{showFollowUp && <FollowUpForm prospectId={prospect.id} onCancel={() => setShowFollowUp(false)} onCreated={addFollowUp} />}<ProspectActivity followUps={prospect.seguimientos ?? []} /></section></main>
      <aside className={styles.detailSidebar}>
        <section className={styles.detailSection}><h2>Datos del prospecto</h2><dl><div><dt><Phone size={16} />Teléfono</dt><dd>{prospect.telefono || 'No registrado'}</dd></div><div><dt><Mail size={16} />Correo</dt><dd>{prospect.email || 'No registrado'}</dd></div><div><dt>Servicio</dt><dd>{prospect.servicio_catalogo?.label || prospect.tipo_acto || 'No registrado'}</dd></div><div><dt>Subestado</dt><dd>{SUBSTATUS_LABELS[prospect.estado]}</dd></div><div><dt>Etapa</dt><dd>{prospect.etapa_operativa?.label || 'Sin etapa asignada'}</dd></div><div><dt>Prioridad</dt><dd>{priorityLabel[prospect.prioridad]}</dd></div><div><dt>Observaciones</dt><dd>{prospect.necesidad || 'Sin observaciones'}</dd></div><div><dt>Predial</dt><dd>{prospect.tiene_predial ? 'Sí' : 'No'}</dd></div><div><dt>Antecedente</dt><dd>{prospect.tiene_antecedente ? 'Sí' : 'No'}</dd></div></dl></section>
        <section className={styles.detailSection}><header><div><h2>Documentación ({documents.length})</h2><p>Archivos privados vinculados a este prospecto.</p></div></header>{documents.length ? <ul className={styles.documentList}>{documents.map((document) => <li key={document.id}><FileText size={16} /><span><strong>{document.nombre_original}</strong><small>{document.tipo || 'Documento'} · {formatDate(document.fecha_carga)}</small></span>{canReadDocuments && <button type="button" className={styles.documentOpen} aria-label={`Abrir ${document.nombre_original}`} onClick={() => openDocument(document)}><Download size={16} /></button>}</li>)}</ul> : <p className={styles.sectionEmpty}>Sin documentos vinculados.</p>}
          {canUpload && <div className={styles.detailUploader}><ProspectDocumentPicker id="detail-predial" label="Adjuntar predial" files={predialFiles} disabled={uploading} onChange={setPredialFiles} /><ProspectDocumentPicker id="detail-antecedente" label="Adjuntar antecedente" files={antecedenteFiles} disabled={uploading} onChange={setAntecedenteFiles} /><button type="button" className={styles.secondaryButton} disabled={uploading || (!predialFiles.length && !antecedenteFiles.length)} onClick={uploadDocuments}>{uploading ? <LoaderCircle className={styles.spin} size={16} /> : <FileCheck2 size={16} />}Subir seleccionados</button></div>}
        </section>
        {prospect.cotizacion && <section className={styles.detailSection}><h2>Cotización relacionada</h2><div className={styles.relatedQuote}><FileText size={20} /><div><strong>{prospect.cotizacion.estado || 'Cotización vinculada'}</strong><small>ID {prospect.cotizacion.id.slice(0, 8)}</small></div></div></section>}
      </aside>
    </div>
    {showEdit && <EditProspectDrawer prospect={prospect} catalogs={catalogs} canUpload={canUpload} onClose={() => setShowEdit(false)} onSaved={(updated, message) => { setProspect(updated); setShowEdit(false); void loadDocuments(); showToast(message); }} />}
    <div className={`${styles.toast} ${toast ? styles.toastVisible : ''}`} role="status" aria-live="polite">{toast}</div>
  </div>;
}
