import { AlertTriangle, CalendarClock, FileText, FolderOpen, Info, LoaderCircle, UserRound } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { PageContainer } from '../../components/layout/PageContainer';
import { ComparecienteHeader } from './components/ComparecienteHeader';
import { ComparecienteHealth } from './components/ComparecienteHealth';
import { EditComparecienteDialog } from './components/EditComparecienteDialog';
import { LinkCaseDialog } from './components/LinkCaseDialog';
import { comparecientesService } from './comparecientes.service';
import type { ComparecienteDetail } from './comparecientes.types';
import { ActivityTab } from './tabs/ActivityTab';
import { AddressTab } from './tabs/AddressTab';
import { ComplianceTab } from './tabs/ComplianceTab';
import { DocumentsTab } from './tabs/DocumentsTab';
import { ExpedientesTab } from './tabs/ExpedientesTab';
import { IdentityTab } from './tabs/IdentityTab';
import { RepresentationTab } from './tabs/RepresentationTab';
import { SummaryTab } from './tabs/SummaryTab';
import styles from './Comparecientes.module.css';

const tabs = [
  ['resumen','Resumen'], ['identificacion','Identidad y fiscal'], ['domicilio','Domicilio'], ['representacion','Representación'], ['expedientes','Expedientes'], ['cumplimiento','Cumplimiento'], ['actividad','Actividad'],
] as const;
const validTab = (value: string) => tabs.some(([key]) => key === value) ? value : 'resumen';
export function ComparecienteWorkspace() {
  const { id = '' } = useParams(); const location = useLocation(); const navigate = useNavigate(); const [item, setItem] = useState<ComparecienteDetail | null>(null); const [status, setStatus] = useState<'loading'|'ready'|'error'>('loading'); const [uploadSignal, setUploadSignal] = useState(0); const [editing,setEditing]=useState(false); const [linking,setLinking]=useState(false); const [selectedDocument,setSelectedDocument]=useState<string|null>(null); const tabList = useRef<HTMLDivElement>(null);
  const documentMode = location.hash === '#documentos' || location.hash.startsWith('#documento-'); const active = validTab(location.hash.slice(1));
  const load = async (signal?: AbortSignal) => { try { setItem(await comparecientesService.detail(id, signal)); setStatus('ready'); } catch (error) { if (!(error instanceof DOMException && error.name === 'AbortError')) setStatus('error'); } };
  useEffect(() => { document.documentElement.scrollTop = 0; document.body.scrollTop = 0; }, [id]);
  useEffect(() => { const controller = new AbortController(); void load(controller.signal); return () => controller.abort(); }, [id]);
  useEffect(() => { if (status !== 'ready') return; const tab = tabList.current?.querySelector<HTMLElement>(`[data-tab="${active}"]`); if (typeof tab?.scrollIntoView === 'function') tab.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' }); }, [active, status]);
  if (status === 'loading') return <PageContainer title="Compareciente"><div className={styles.workspaceLoading}><LoaderCircle className={styles.spin} />Cargando ficha…</div></PageContainer>;
  if (status === 'error' || !item) return <PageContainer title="Compareciente"><section className={styles.pageState} role="alert"><span><AlertTriangle /></span><h2>No pudimos cargar este compareciente.</h2><p>Revisa tus permisos o intenta nuevamente.</p><button type="button" className={styles.secondaryButton} onClick={() => navigate('/comparecientes')}>Volver al listado</button></section></PageContainer>;
  const content: Record<string, React.ReactNode> = { resumen: <SummaryTab item={item} />, identificacion: <IdentityTab item={item} onChanged={() => void load()} />, domicilio: <AddressTab item={item} />, representacion: <RepresentationTab item={item} />, expedientes: <ExpedientesTab item={item} />, cumplimiento: <ComplianceTab item={item} />, actividad: <ActivityTab item={item} /> };
  const documents = <DocumentsTab item={item} onChanged={() => void load()} uploadSignal={uploadSignal} selectedId={selectedDocument} onSelected={setSelectedDocument} />;
  return <PageContainer title=""><div className={styles.workspace}><ComparecienteHeader item={item} onEdit={()=>setEditing(true)} onUpload={() => { setUploadSignal((value) => value + 1); navigate('#documentos'); }} onLink={() => setLinking(true)} /><ComparecienteHealth item={item} /><div className={styles.mobileWorkspaceSwitch} role="tablist" aria-label="Vista de ficha"><button type="button" role="tab" aria-selected={!documentMode} onClick={() => navigate('#resumen')}><Info />Información</button><button type="button" role="tab" aria-selected={documentMode} onClick={() => navigate('#documentos')}><FileText />Documentos <span>{item.documentos.length}</span></button></div><div className={`${styles.workspaceColumns} ${documentMode ? styles.mobileDocumentsActive : styles.mobileInformationActive}`}><main className={styles.informationPanel}><header className={styles.panelTitle}><span className={styles.panelEyebrow}>Master data vivo</span><h2>Información</h2><p>Datos actuales, relaciones y trazabilidad del compareciente.</p></header><section className={styles.headerFacts}><article><span><UserRound /></span><div><small>Creado por</small><strong>{[item.creado_por?.nombre,item.creado_por?.apellido].filter(Boolean).join(' ') || 'Usuario no disponible'}</strong></div></article><article><span><FolderOpen /></span><div><small>Expedientes activos</small><strong>{item.expedientes.length}</strong></div></article><article><span><CalendarClock /></span><div><small>Última actualización</small><strong>{new Intl.DateTimeFormat('es-MX', { dateStyle: 'medium' }).format(new Date(item.updated_at_material))}</strong></div></article></section><div ref={tabList} className={styles.tabs} role="tablist" aria-label="Secciones de información">{tabs.map(([key,label]) => <button key={key} type="button" role="tab" data-tab={key} aria-selected={active === key && !documentMode} aria-controls={`panel-${key}`} className={active === key && !documentMode ? styles.tabActive : ''} onClick={() => navigate(`#${key}`)}>{label}</button>)}</div><section id={`panel-${active}`} role="tabpanel" className={styles.tabContent}>{content[active]}</section></main><aside className={styles.documentationColumn}>{documents}</aside></div>{editing&&<EditComparecienteDialog item={item} onClose={()=>setEditing(false)} onSaved={()=>{setEditing(false);void load();}}/>}{linking&&<LinkCaseDialog partyId={item.id} linkedIds={item.expedientes.map((link:any)=>link.expediente.id)} onClose={()=>setLinking(false)} onLinked={()=>{setLinking(false);void load();}}/>}</div></PageContainer>;
}
