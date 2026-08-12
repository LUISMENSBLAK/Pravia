import { useEffect, useState } from 'react';
import { ArrowLeft, CalendarDays, FilePlus2, FileText, Mail, MapPin, MessageSquarePlus, Phone, UserRound, UsersRound } from 'lucide-react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '../auth/AuthProvider';
import { FollowUpForm } from './components/FollowUpForm';
import { ProspectActivity } from './components/ProspectActivity';
import { ProspectsLoading } from './components/ProspectsLoading';
import { prospectsService } from './prospects.service';
import type { Prospect, ProspectDocument } from './prospects.types';
import { STATE_LABELS } from './prospects.types';
import styles from './ProspectsPage.module.css';

const formatDate = (value?: string | null) => value ? new Intl.DateTimeFormat('es-MX', { dateStyle: 'medium' }).format(new Date(value)) : 'Sin actividad';

export function ProspectDetailPage() {
  const { id = '' } = useParams(); const { user } = useAuth();
  const navigate = useNavigate();
  const [prospect, setProspect] = useState<Prospect | null>(null); const [documents, setDocuments] = useState<ProspectDocument[]>([]);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading'); const [showFollowUp, setShowFollowUp] = useState(false); const [toast, setToast] = useState('');
  const canWrite = user?.permissions?.includes('prospectos.write') ?? false;
  useEffect(() => {
    const controller = new AbortController(); setStatus('loading');
    Promise.all([prospectsService.get(id, controller.signal), prospectsService.getDocuments(id, controller.signal).catch(() => [])])
      .then(([result, docs]) => { setProspect(result); setDocuments(docs); setStatus('ready'); })
      .catch((error) => { if (!(error instanceof DOMException && error.name === 'AbortError')) setStatus('error'); });
    return () => controller.abort();
  }, [id]);
  if (status === 'loading') return <ProspectsLoading />;
  if (status === 'error' || !prospect) return <section className={styles.pageState} role="alert"><UsersRound /><h1>No pudimos abrir este prospecto.</h1><p>Puede que ya no exista o que no tengas acceso.</p><Link className={styles.secondaryLink} to="/prospectos">Volver a Prospectos</Link></section>;
  const latest = prospect.seguimientos?.[0];
  const addFollowUp = (item: NonNullable<Prospect['seguimientos']>[number]) => {
    setProspect((current) => current ? { ...current, seguimientos: [item, ...(current.seguimientos ?? [])], updated_at: item.created_at } : current);
    setShowFollowUp(false); setToast('Seguimiento registrado.'); window.setTimeout(() => setToast(''), 3000);
  };
  return <div className={styles.detailPage} data-ai-trigger={!latest?.proxima_accion ? 'SIN_SIGUIENTE_ACCION' : undefined}>
    <Link className={styles.backLink} to="/prospectos"><ArrowLeft size={17} />Prospectos</Link>
    <header className={styles.detailHeader}><div><div className={styles.detailEyebrow}><span className={`${styles.stateBadge} ${styles[`state${prospect.estado}`]}`}>{STATE_LABELS[prospect.estado]}</span><span>Actualizado {formatDate(prospect.updated_at)}</span></div><h1>{prospect.nombre}</h1><p>{prospect.tipo_acto || 'Servicio por definir'}</p></div>{canWrite && <div className={styles.detailHeaderActions}>{!prospect.cotizacion && <button className={styles.secondaryButton} type="button" onClick={() => navigate(`/cotizaciones?new=1&prospecto=${encodeURIComponent(prospect.id)}`)}><FilePlus2 size={18} />Crear cotización</button>}<button className={styles.primaryButton} type="button" onClick={() => setShowFollowUp(true)}><MessageSquarePlus size={18} />Registrar seguimiento</button></div>}</header>
    <section className={styles.detailOverview} aria-label="Resumen del prospecto"><article><span><UserRound size={18} /></span><div><small>Responsable</small><strong>{prospect.atendido_por?.nombre || 'Sin responsable visible'}</strong></div></article><article><span><CalendarDays size={18} /></span><div><small>Última actividad</small><strong>{formatDate(latest?.created_at ?? prospect.updated_at)}</strong></div></article><article><span><FileText size={18} /></span><div><small>Cotización</small><strong>{prospect.cotizacion ? prospect.cotizacion.estado || 'Vinculada' : 'Sin cotización'}</strong></div></article><article><span><MessageSquarePlus size={18} /></span><div><small>Siguiente acción</small><strong>{latest?.proxima_accion || 'Sin siguiente acción'}</strong></div></article></section>
    <div className={styles.detailGrid}>
      <main><section className={styles.detailSection}><header><div><h2>Seguimiento y actividad</h2><p>Historial ordenado por actividad más reciente.</p></div>{canWrite && !showFollowUp && <button type="button" onClick={() => setShowFollowUp(true)}>+ Registrar seguimiento</button>}</header>{showFollowUp && <FollowUpForm prospectId={prospect.id} onCancel={() => setShowFollowUp(false)} onCreated={addFollowUp} />}<ProspectActivity followUps={prospect.seguimientos ?? []} /></section></main>
      <aside className={styles.detailSidebar}>
        <section className={styles.detailSection}><h2>Contacto</h2><dl><div><dt><Phone size={16} />Teléfono</dt><dd>{prospect.telefono || 'No registrado'}</dd></div><div><dt><Mail size={16} />Correo</dt><dd>{prospect.email || 'No registrado'}</dd></div><div><dt><MapPin size={16} />Ciudad</dt><dd>{prospect.ciudad || 'No registrada'}</dd></div></dl></section>
        <section className={styles.detailSection}><h2>Resumen</h2><dl><div><dt>Origen</dt><dd>{prospect.fuente || 'No registrado'}</dd></div><div><dt>Prioridad</dt><dd>{prospect.prioridad.charAt(0) + prospect.prioridad.slice(1).toLowerCase()}</dd></div><div><dt>Necesidad</dt><dd>{prospect.necesidad || 'Sin notas iniciales'}</dd></div></dl></section>
        <section className={styles.detailSection}><h2>Documentos ({documents.length})</h2>{documents.length ? <ul className={styles.documentList}>{documents.map((document) => <li key={document.id}><FileText size={16} /><span><strong>{document.nombre_original}</strong><small>{document.tipo || 'Documento'}</small></span></li>)}</ul> : <p className={styles.sectionEmpty}>Sin documentos vinculados.</p>}</section>
        {prospect.cotizacion && <section className={styles.detailSection}><h2>Cotización relacionada</h2><div className={styles.relatedQuote}><FileText size={20} /><div><strong>{prospect.cotizacion.estado || 'Cotización vinculada'}</strong><small>ID {prospect.cotizacion.id.slice(0, 8)}</small></div></div></section>}
      </aside>
    </div>
    <div className={`${styles.toast} ${toast ? styles.toastVisible : ''}`} role="status" aria-live="polite">{toast}</div>
  </div>;
}
