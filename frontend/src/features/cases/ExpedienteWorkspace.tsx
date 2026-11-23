import { AlertTriangle, ArrowLeft, ArrowUp, ChevronLeft, ChevronRight, LoaderCircle } from 'lucide-react';
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import { useAssistant } from '../assistant/AssistantProvider';
import { useAuth } from '../auth/AuthProvider';
import { ActivityTab } from './components/tabs/ActivityTab';
import { ComplianceTab } from './components/tabs/ComplianceTab';
import { DocumentsTab } from './components/tabs/DocumentsTab';
import { FinanceTab } from './components/tabs/FinanceTab';
import { PartiesTab } from './components/tabs/PartiesTab';
import { ProjectTab } from './components/tabs/ProjectTab';
import { ActsTab } from './components/tabs/ActsTab';
import { WorkflowTab } from './components/tabs/WorkflowTab';
import { ISRTab } from './components/tabs/ISRTab';
import { TemplatesFormatsTab } from './components/tabs/TemplatesFormatsTab';
import { QuestionnairesTab } from './components/tabs/QuestionnairesTab';
import { BudgetTab } from './components/tabs/BudgetTab';
import { expedientesService } from './expedientes.service';
import { expedienteSections, normalizeExpedienteSection, type ExpedienteSection } from './expedienteNavigation';
import type { ExpedienteDetail, ProjectState } from './expedientes.types';
import styles from './Expedientes.module.css';
import { ExpedienteInformationHeader } from './components/ExpedienteInformationHeader';
import { ArchiveInstrument } from '../archive/ArchiveInstrument';
import { RecordCollaborators } from '../../components/collaboration/RecordCollaborators';

type TabKey = ExpedienteSection;
const tabLabels: Record<TabKey, string> = { actos: 'Actos', comparecientes: 'Comparecientes', predios: 'Predios / Inmuebles', documentos: 'Documentos', seguimiento: 'Seguimiento', plantillas: 'Plantillas y formatos', cuestionarios: 'Cuestionarios', presupuesto: 'Presupuesto', proyecto: 'Proyecto', finanzas: 'Finanzas', isr: 'Cálculo ISR', cumplimiento: 'Cumplimiento', archivo: 'Archivo', actividad: 'Actividad' };
const allTabs: Array<{ key: TabKey; label: string }> = expedienteSections.map((key) => ({ key, label: tabLabels[key] }));
const PropertiesTab = lazy(() => import('./components/tabs/PropertiesTab').then((module) => ({ default: module.PropertiesTab })));

const localISRExpediente = { id:'exp-isr-fixture', numero_pravia:'EXP-0318-2026', cliente_alias:'María Fernanda López', cliente_principal:'María Fernanda López', comparecientes_adicionales:0, estatus:'EN_PROCESO', macrofase:'PROYECTO', version:2, updated_at:'2026-08-17T16:30:00.000Z', created_at:'2026-06-10T15:00:00.000Z', fecha_apertura:'2026-06-10T15:00:00.000Z', fecha_estimada_firma:'2026-09-04T16:00:00.000Z', tipo_acto:{id:'acto-1',nombre:'Compraventa de inmueble'}, abogado:{id:'user-1',nombre:'Andrea',apellido:'Ruiz'}, notaria:{id:'notaria-1',nombre:'Notaría 12',numero_notaria:'12',municipio:'Tepic'}, etapaActual:{id:'etapa-1',clave_snapshot:'PROYECTO',nombre_snapshot:'Proyecto de escritura',orden_snapshot:2,fecha_inicio:'2026-08-12T15:00:00.000Z'}, riesgo:{label:'Bajo',requires_attention:false}, comparecientes:[], requisitos_docs:[], etapas:[], tareas:[], tareas_externas:[], tareas_postfirma:[], workflow:{current_status_label:'En proyecto',transitions:[],stages:[]}, progress:{documental:80,operativo:60,general:70}, readiness:{indicators:[],blockers:[],complete:4}, financialSummary:{ingresos_recibidos:'40000.00',honorarios_generados:'100000.00',honorarios_cobrados:'40000.00',honorarios_por_cobrar:'60000.00',fondos_terceros:'18500.00',otros_destinos:'0.00',fondos_terceros_pendientes:'18500.00',egresos:'450.00'}, movimientosFinancieros:[{id:'movement-fixture',folio:'MOV-2026-000142',naturaleza:'INGRESO',concepto:'Anticipo de honorarios',fecha_movimiento:'2026-08-28T16:30:00.000Z',estatus:'APLICADO',monto:'40000.00',movimientoDocumentos:[{id:'movement-doc'}]}], capabilities:{canWrite:true,canDeliver:false,canManagePostfirma:false,canReadProject:true,canReadFinance:true,canReadCaseFinance:true,canWriteFinance:false,canUploadDocuments:true,canReadDocuments:true,canDeleteDocuments:true} } as unknown as ExpedienteDetail;
export function ExpedienteWorkspace() {
  const { id = '' } = useParams(); const location = useLocation(); const navigate = useNavigate(); const { openAssistant } = useAssistant(); const { user } = useAuth(); const fixtureMode = import.meta.env.DEV ? new URLSearchParams(location.search).get('fixture') : null; const fixtureISR = fixtureMode === 'isr'; const fixtureFinance = fixtureMode === 'exp008'; const fixtureActivity = fixtureMode === 'exp009'; const localFixture = fixtureISR || fixtureFinance || fixtureActivity; const [expediente, setExpediente] = useState<ExpedienteDetail | null>(localFixture ? localISRExpediente : null); const [project, setProject] = useState<ProjectState | null>(null); const [status, setStatus] = useState<'loading' | 'ready' | 'error'>(localFixture ? 'ready' : 'loading');
  const tabRefs = useRef<Partial<Record<TabKey, HTMLButtonElement | null>>>({});
  const tabsContainerRef = useRef<HTMLElement | null>(null);
  const sectionsStart = useRef<HTMLDivElement>(null);
  const headerStart = useRef<HTMLDivElement>(null);
  const pendingJump = useRef(false);
  const [budgetDirty, setBudgetDirty] = useState(false);
  const requestedActive = normalizeExpedienteSection(location.hash.slice(1));
  const canReadCompliance = Boolean(user?.permissions?.includes('compliance.read'));
  const tabs = useMemo(() => allTabs.filter((tab) => tab.key !== 'finanzas' || expediente?.capabilities.canReadCaseFinance || expediente?.capabilities.canReadFinance).filter((tab) => !['proyecto', 'plantillas'].includes(tab.key) || expediente?.capabilities.canReadProject).filter((tab)=>tab.key!=='isr'||fixtureISR||!user?.permissions||user.permissions.includes('isr.read')).filter((tab)=>tab.key!=='cumplimiento'||canReadCompliance), [expediente,fixtureISR,user,canReadCompliance]);
  const active = tabs.some((tab) => tab.key === requestedActive) ? requestedActive : 'actos';
  const activeIndex = tabs.findIndex((tab) => tab.key === active);
  const load = useCallback(async (signal?: AbortSignal) => { if(localFixture){setExpediente(localISRExpediente);setStatus('ready');return;}try { const detail = await expedientesService.detail(id, signal); setExpediente(detail); if (detail.capabilities.canReadProject) { try { setProject(await expedientesService.project(id, signal)); } catch { setProject(null); } } setStatus('ready'); } catch (error) { if (!(error instanceof DOMException && error.name === 'AbortError')) setStatus('error'); } }, [localFixture,id]);
  useEffect(() => {
    const mainContent = document.getElementById('main-content');
    if (mainContent) mainContent.scrollTop = 0;
  }, [id]);
  useEffect(() => { if(localFixture)return;const controller = new AbortController(); void load(controller.signal); return () => controller.abort(); }, [localFixture,load]);
  useEffect(() => { if (location.hash.slice(1) === 'resumen') navigate({ hash: 'actos' }, { replace: true }); }, [location.hash, navigate]);
  useEffect(() => {
    if (status !== 'ready') return;
    const element = tabRefs.current[active];
    const container = tabsContainerRef.current;
    if (!element || !container) return;
    const target = container.scrollLeft + element.getBoundingClientRect().left - container.getBoundingClientRect().left - ((container.clientWidth - element.clientWidth) / 2);
    const left = Math.max(0, target);
    const motion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth';
    if (typeof container.scrollTo === 'function') container.scrollTo({ left, behavior: motion });
    else container.scrollLeft = left;
    if (pendingJump.current) { pendingJump.current = false; sectionsStart.current?.scrollIntoView?.({ block: 'start' }); }
  }, [active, status]);
  if (status === 'loading') return <div className={styles.workspaceLoading}><LoaderCircle className={styles.spin} /><span>Preparando el workspace…</span></div>;
  if (status === 'error' || !expediente) return <section className={styles.pageState} role="alert"><span><AlertTriangle /></span><h2>No pudimos abrir este expediente.</h2><p>La información no está disponible o ya no tienes acceso.</p><button type="button" className={styles.secondaryButton} onClick={() => { setStatus('loading'); void load(); }}>Reintentar</button></section>;
  const confirmLeaveBudget = () => !budgetDirty || window.confirm('Hay cambios sin guardar en el presupuesto. ¿Salir sin guardarlos?');
  const changeSection = (key: TabKey) => {
    if (key === active) { sectionsStart.current?.scrollIntoView?.({ block: 'start' }); return true; }
    if (!confirmLeaveBudget()) return false;
    pendingJump.current = true;
    navigate({ hash: key }, { replace: true });
    return true;
  };
  return <div className={styles.workspace}><div ref={headerStart} className={styles.sectionJump} /><Link className={styles.backLink} to="/expedientes" onClick={(event) => { if (!confirmLeaveBudget()) event.preventDefault(); }}><ArrowLeft size={17} />Volver a expedientes</Link>
    <ExpedienteInformationHeader expediente={expediente} onChanged={() => load()} onAssistant={() => openAssistant({ prefill: '¿Qué falta en este expediente?' })} onSeguimiento={() => changeSection('seguimiento')} />
    {!localFixture && <RecordCollaborators kind="expediente" recordId={expediente.id} canManage={user?.role === 'DIRECCION' || user?.role === 'ADMINISTRACION'} />}
    <div ref={sectionsStart} className={`${styles.sectionJump} ${styles.sectionAnchor}`} />
    <div className={styles.sectionNavigation}>
      <button type="button" className={styles.sectionStep} aria-label="Volver a información del expediente" title="Volver a la ficha" onClick={() => headerStart.current?.scrollIntoView?.({ block: 'start' })}><ArrowUp size={17} aria-hidden="true" /></button>
      <button type="button" className={styles.sectionStep} aria-label="Sección anterior" disabled={activeIndex <= 0} onClick={() => changeSection(tabs[activeIndex - 1].key)}><ChevronLeft size={17} aria-hidden="true" /></button>
      <nav ref={tabsContainerRef} className={styles.tabs} aria-label="Secciones del expediente" role="tablist" onKeyDown={(event) => {
        if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
        event.preventDefault();
        const index = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : (activeIndex + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
        const next = tabs[index];
        if (next && changeSection(next.key)) tabRefs.current[next.key]?.focus({ preventScroll: true });
      }}>{tabs.map((tab) => <button key={tab.key} id={`case-tab-${tab.key}`} ref={(element) => { tabRefs.current[tab.key] = element; }} type="button" role="tab" tabIndex={active === tab.key ? 0 : -1} aria-controls="case-section-panel" aria-selected={active === tab.key} className={active === tab.key ? styles.tabActive : ''} onClick={() => changeSection(tab.key)}>{tab.label}</button>)}</nav>
      <select className={styles.sectionPicker} aria-label="Ir a una sección del expediente" value={active} onChange={(event) => changeSection(event.target.value as TabKey)}>{tabs.map((tab) => <option key={tab.key} value={tab.key}>{tab.label}</option>)}</select>
      <button type="button" className={styles.sectionStep} aria-label="Sección siguiente" disabled={activeIndex >= tabs.length - 1} onClick={() => changeSection(tabs[activeIndex + 1].key)}><ChevronRight size={17} aria-hidden="true" /></button>
    </div>
    <section id="case-section-panel" className={styles.tabContent} role="tabpanel" aria-label={tabs.find((tab) => tab.key === active)?.label}>{active === 'actos' && <ActsTab expediente={expediente} onChanged={() => void load()} />}{active === 'comparecientes' && <PartiesTab expediente={expediente} />}{active === 'predios' && <Suspense fallback={<div role="status">Cargando predios…</div>}><PropertiesTab expediente={expediente} onChanged={() => void load()} /></Suspense>}{active === 'documentos' && <DocumentsTab expediente={expediente} onChanged={() => void load()} />}{active === 'seguimiento' && <WorkflowTab expediente={expediente} onChanged={() => void load()} />}{active === 'plantillas' && <TemplatesFormatsTab expediente={expediente} />}{active === 'cuestionarios' && <QuestionnairesTab expediente={expediente} />}{active === 'presupuesto' && <BudgetTab expedienteId={expediente.id} onDirtyChange={setBudgetDirty} />}{active === 'proyecto' && <ProjectTab expediente={expediente} project={project} onChanged={() => void load()} />}{active === 'finanzas' && (expediente.capabilities.canReadCaseFinance || expediente.capabilities.canReadFinance) && <FinanceTab expediente={expediente} onChanged={() => void load()} />}{active === 'isr' && <ISRTab expedienteId={expediente.id} canWrite={fixtureISR||!user?.permissions||user.permissions.includes('isr.write')} fixture={fixtureISR} />}{active === 'cumplimiento' && canReadCompliance && <ComplianceTab expediente={expediente} />}{active === 'archivo' && <ArchiveInstrument expedienteId={expediente.id} onSaved={() => void load()} />}{active === 'actividad' && <ActivityTab expediente={expediente} fixture={fixtureActivity} />}</section>
  </div>;
}
