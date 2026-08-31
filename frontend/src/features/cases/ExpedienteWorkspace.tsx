import { AlertTriangle, ArrowLeft, Bot, Building2, CalendarDays, ChevronDown, CircleGauge, LoaderCircle, MoreHorizontal, UserRound } from 'lucide-react';
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
import { SummaryTab } from './components/tabs/SummaryTab';
import { ActsTab } from './components/tabs/ActsTab';
import { WorkflowTab } from './components/tabs/WorkflowTab';
import { ISRTab } from './components/tabs/ISRTab';
import { TemplatesFormatsTab } from './components/tabs/TemplatesFormatsTab';
import { BudgetTab } from './components/tabs/BudgetTab';
import { expedientesService } from './expedientes.service';
import { fullName, macroLabels } from './expedienteFormatters';
import { expedienteSections, normalizeExpedienteSection, type ExpedienteSection } from './expedienteNavigation';
import type { ExpedienteDetail, ProjectState } from './expedientes.types';
import styles from './Expedientes.module.css';

type TabKey = ExpedienteSection;
const tabLabels: Record<TabKey, string> = { resumen: 'Resumen', actos: 'Actos', comparecientes: 'Comparecientes', predios: 'Predios / Inmuebles', documentos: 'Documentos', seguimiento: 'Seguimiento', plantillas: 'Plantillas y formatos', presupuesto: 'Presupuesto', proyecto: 'Proyecto', finanzas: 'Finanzas', isr: 'Cálculo ISR', cumplimiento: 'Cumplimiento', actividad: 'Actividad' };
const allTabs: Array<{ key: TabKey; label: string }> = expedienteSections.map((key) => ({ key, label: tabLabels[key] }));
const PropertiesTab = lazy(() => import('./components/tabs/PropertiesTab').then((module) => ({ default: module.PropertiesTab })));
const formatDate = (value?: string | null) => value ? new Intl.DateTimeFormat('es-MX', { dateStyle: 'medium' }).format(new Date(value)) : 'Sin fecha';

const localISRExpediente = { id:'exp-isr-fixture', numero_pravia:'EXP-2026-00318', cliente_alias:'María Fernanda López', cliente_principal:'María Fernanda López', comparecientes_adicionales:0, estatus:'EN_PROCESO', macrofase:'PROYECTO', version:2, updated_at:'2026-08-17T16:30:00.000Z', created_at:'2026-06-10T15:00:00.000Z', fecha_apertura:'2026-06-10T15:00:00.000Z', fecha_estimada_firma:'2026-09-04T16:00:00.000Z', tipo_acto:{id:'acto-1',nombre:'Compraventa de inmueble'}, abogado:{id:'user-1',nombre:'Andrea',apellido:'Ruiz'}, notaria:{id:'notaria-1',nombre:'Notaría 12',numero_notaria:'12',municipio:'Tepic'}, etapaActual:{id:'etapa-1',clave_snapshot:'PROYECTO',nombre_snapshot:'Proyecto de escritura',orden_snapshot:2,fecha_inicio:'2026-08-12T15:00:00.000Z'}, riesgo:{label:'Bajo',requires_attention:false}, comparecientes:[], requisitos_docs:[], etapas:[], tareas:[], tareas_externas:[], tareas_postfirma:[], workflow:{current_status_label:'En proyecto',transitions:[],stages:[]}, progress:{documental:80,operativo:60,general:70}, readiness:{indicators:[],blockers:[],complete:4}, financialSummary:{ingresos_recibidos:'40000.00',honorarios_generados:'100000.00',honorarios_cobrados:'40000.00',honorarios_por_cobrar:'60000.00',fondos_terceros:'18500.00',otros_destinos:'0.00',fondos_terceros_pendientes:'18500.00',egresos:'450.00'}, movimientosFinancieros:[{id:'movement-fixture',folio:'MOV-2026-000142',naturaleza:'INGRESO',concepto:'Anticipo de honorarios',fecha_movimiento:'2026-08-28T16:30:00.000Z',estatus:'APLICADO',monto:'40000.00',movimientoDocumentos:[{id:'movement-doc'}]}], capabilities:{canWrite:true,canDeliver:false,canManagePostfirma:false,canReadProject:true,canReadFinance:true,canReadCaseFinance:true,canWriteFinance:false,canUploadDocuments:true,canReadDocuments:true,canDeleteDocuments:true} } as unknown as ExpedienteDetail;
export function ExpedienteWorkspace() {
  const { id = '' } = useParams(); const location = useLocation(); const navigate = useNavigate(); const { openAssistant } = useAssistant(); const { user } = useAuth(); const fixtureMode = import.meta.env.DEV ? new URLSearchParams(location.search).get('fixture') : null; const fixtureISR = fixtureMode === 'isr'; const fixtureFinance = fixtureMode === 'exp008'; const localFixture = fixtureISR || fixtureFinance; const [expediente, setExpediente] = useState<ExpedienteDetail | null>(localFixture ? localISRExpediente : null); const [project, setProject] = useState<ProjectState | null>(null); const [status, setStatus] = useState<'loading' | 'ready' | 'error'>(localFixture ? 'ready' : 'loading');
  const tabRefs = useRef<Partial<Record<TabKey, HTMLButtonElement | null>>>({});
  const tabsContainerRef = useRef<HTMLElement | null>(null);
  const [budgetDirty, setBudgetDirty] = useState(false);
  const active = normalizeExpedienteSection(location.hash.slice(1));
  const load = useCallback(async (signal?: AbortSignal) => { if(localFixture){setExpediente(localISRExpediente);setStatus('ready');return;}try { const detail = await expedientesService.detail(id, signal); setExpediente(detail); if (detail.capabilities.canReadProject) { try { setProject(await expedientesService.project(id, signal)); } catch { setProject(null); } } setStatus('ready'); } catch (error) { if (!(error instanceof DOMException && error.name === 'AbortError')) setStatus('error'); } }, [localFixture,id]);
  useEffect(() => {
    const mainContent = document.getElementById('main-content');
    if (mainContent) mainContent.scrollTop = 0;
  }, [id]);
  useEffect(() => { if(localFixture)return;const controller = new AbortController(); void load(controller.signal); return () => controller.abort(); }, [localFixture,load]);
  useEffect(() => {
    if (status !== 'ready') return;
    const element = tabRefs.current[active];
    const container = tabsContainerRef.current;
    if (!element || !container) return;
    const target = element.offsetLeft - ((container.clientWidth - element.clientWidth) / 2);
    const left = Math.max(0, target);
    if (typeof container.scrollTo === 'function') container.scrollTo({ left, behavior: 'smooth' });
    else container.scrollLeft = left;
  }, [active, status]);
  const tabs = useMemo(() => allTabs.filter((tab) => tab.key !== 'finanzas' || expediente?.capabilities.canReadCaseFinance || expediente?.capabilities.canReadFinance).filter((tab) => !['proyecto', 'plantillas'].includes(tab.key) || expediente?.capabilities.canReadProject).filter((tab)=>tab.key!=='isr'||fixtureISR||!user?.permissions||user.permissions.includes('isr.read')), [expediente,fixtureISR,user]);
  if (status === 'loading') return <div className={styles.workspaceLoading}><LoaderCircle className={styles.spin} /><span>Preparando el workspace…</span></div>;
  if (status === 'error' || !expediente) return <section className={styles.pageState} role="alert"><span><AlertTriangle /></span><h2>No pudimos abrir este expediente.</h2><p>La información no está disponible o ya no tienes acceso.</p><button type="button" className={styles.secondaryButton} onClick={() => { setStatus('loading'); void load(); }}>Reintentar</button></section>;
  const notary = expediente.notaria ? `${expediente.notaria.numero_notaria ? `Notaría ${expediente.notaria.numero_notaria}` : expediente.notaria.nombre}${expediente.notaria.municipio ? ` · ${expediente.notaria.municipio}` : ''}` : 'Sin notaría asignada';
  const confirmLeaveBudget = () => !budgetDirty || window.confirm('Hay cambios sin guardar en el presupuesto. ¿Salir sin guardarlos?');
  return <div className={styles.workspace}><Link className={styles.backLink} to="/expedientes" onClick={(event) => { if (!confirmLeaveBudget()) event.preventDefault(); }}><ArrowLeft size={17} />Volver a expedientes</Link><header className={styles.workspaceHeader}><div className={styles.headerMain}><div className={styles.headerEyebrow}><span>{expediente.numero_pravia}</span><span>{expediente.workflow.current_status_label}</span><span className={`${styles.phaseBadge} ${styles[`phase${expediente.macrofase}`]}`}>{macroLabels[expediente.macrofase]}</span><span>{expediente.riesgo.label}</span></div><h1>{expediente.tipo_acto.nombre}</h1><p>{expediente.cliente_principal || expediente.cliente_alias}</p></div><div className={styles.workspaceActions}><button type="button" className={styles.secondaryButton} onClick={() => openAssistant({ prefill: '¿Qué falta en este expediente?' })}><Bot size={17} />¿Qué falta?</button>{expediente.capabilities.canWrite && <button type="button" className={styles.primaryButton} onClick={() => { if (confirmLeaveBudget()) navigate('#seguimiento'); }}><span>Acciones</span><ChevronDown size={16} /></button>}<button type="button" className={styles.iconButton} aria-label="Más opciones"><MoreHorizontal size={19} /></button></div></header>
    <section className={styles.headerFacts}><article><span><UserRound size={17} /></span><div><small>Responsable</small><strong>{fullName(expediente.abogado)}</strong></div></article><article><span><Building2 size={17} /></span><div><small>Notaría</small><strong>{notary}</strong></div></article><article><span><CircleGauge size={17} /></span><div><small>Etapa actual</small><strong>{expediente.etapaActual?.nombre_snapshot || expediente.etapa_actual_nombre || 'Sin etapa'}</strong></div></article><article><span><CalendarDays size={17} /></span><div><small>Fecha de apertura</small><strong>{formatDate(expediente.fecha_apertura)}</strong></div></article><article><span><CalendarDays size={17} /></span><div><small>Firma estimada</small><strong>{formatDate(expediente.fecha_estimada_firma)}</strong></div></article></section>
    <nav ref={tabsContainerRef} className={styles.tabs} aria-label="Secciones del expediente" role="tablist">{tabs.map((tab) => <button key={tab.key} ref={(element) => { tabRefs.current[tab.key] = element; }} type="button" role="tab" aria-selected={active === tab.key} className={active === tab.key ? styles.tabActive : ''} onClick={() => { if (tab.key === active || confirmLeaveBudget()) navigate({ hash: tab.key }, { replace: true }); }}>{tab.label}</button>)}</nav>
    <main className={styles.tabContent} role="tabpanel" aria-label={tabs.find((tab) => tab.key === active)?.label}>{active === 'resumen' && <SummaryTab expediente={expediente} onChanged={() => void load()} />}{active === 'actos' && <ActsTab expediente={expediente} onChanged={() => void load()} />}{active === 'comparecientes' && <PartiesTab expediente={expediente} />}{active === 'predios' && <Suspense fallback={<div role="status">Cargando predios…</div>}><PropertiesTab expediente={expediente} onChanged={() => void load()} /></Suspense>}{active === 'documentos' && <DocumentsTab expediente={expediente} onChanged={() => void load()} />}{active === 'seguimiento' && <WorkflowTab expediente={expediente} onChanged={() => void load()} />}{active === 'plantillas' && <TemplatesFormatsTab expediente={expediente} />}{active === 'presupuesto' && <BudgetTab expedienteId={expediente.id} onDirtyChange={setBudgetDirty} />}{active === 'proyecto' && <ProjectTab expediente={expediente} project={project} onChanged={() => void load()} />}{active === 'finanzas' && (expediente.capabilities.canReadCaseFinance || expediente.capabilities.canReadFinance) && <FinanceTab expediente={expediente} onChanged={() => void load()} />}{active === 'isr' && <ISRTab expedienteId={expediente.id} canWrite={fixtureISR||!user?.permissions||user.permissions.includes('isr.write')} fixture={fixtureISR} />}{active === 'cumplimiento' && <ComplianceTab expediente={expediente} />}{active === 'actividad' && <ActivityTab expediente={expediente} />}</main>
  </div>;
}
