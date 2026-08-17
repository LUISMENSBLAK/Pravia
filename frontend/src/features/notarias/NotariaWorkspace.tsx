import { AlertTriangle, ArrowLeft, CalendarClock, FileClock, FolderKanban, History, LoaderCircle } from 'lucide-react';
import { type KeyboardEvent, useCallback, useEffect, useRef, useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import { PageContainer } from '../../components/layout/PageContainer';
import { useAuth } from '../auth/AuthProvider';
import { AddNotariaContactDialog } from './components/AddNotariaContactDialog';
import { NotariaActivity } from './components/NotariaActivity';
import { NotariaConfiguration } from './components/NotariaConfiguration';
import { NotariaContacts } from './components/NotariaContacts';
import { NotariaExpedientes } from './components/NotariaExpedientes';
import { NotariaHeader } from './components/NotariaHeader';
import { NotariaSummary } from './components/NotariaSummary';
import { notariasService } from './notarias.service';
import type { NotariaCase, NotariaDetail } from './notarias.types';
import styles from './Notarias.module.css';

const tabs = [['resumen', 'Resumen'], ['contactos', 'Contactos'], ['expedientes', 'Expedientes'], ['actividad', 'Actividad'], ['configuracion', 'Configuración']] as const;

export function NotariaWorkspace() {
  const { id = '' } = useParams(); const location = useLocation(); const navigate = useNavigate(); const { user } = useAuth();
  const hash = location.hash.slice(1); const active = tabs.some(([key]) => key === hash) ? hash : 'resumen';
  const [item, setItem] = useState<NotariaDetail | null>(null); const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [edit, setEdit] = useState(false); const [contact, setContact] = useState(false); const [casePage, setCasePage] = useState(1);
  const [changingContact, setChangingContact] = useState<string | null>(null); const [toast, setToast] = useState('');
  const [cases, setCases] = useState<NotariaCase[]>([]); const [caseMeta, setCaseMeta] = useState({ total: 0, hasPreviousPage: false, hasNextPage: false });
  const tabRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const canWrite = user?.permissions?.includes('notarias.write') || false;
  const load = useCallback(async () => {
    setStatus('loading');
    try {
      const [detail, caseResult] = await Promise.all([notariasService.detail(id), notariasService.cases(id, 1)]);
      setItem(detail); setCases(caseResult.data); setCaseMeta(caseResult.meta); setCasePage(1); setStatus('ready');
    } catch { setStatus('error'); }
  }, [id]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    if (active !== 'expedientes' || casePage === 1) return;
    const controller = new AbortController();
    notariasService.cases(id, casePage, controller.signal).then((result) => { setCases(result.data); setCaseMeta(result.meta); }).catch(() => {});
    return () => controller.abort();
  }, [active, casePage, id]);
  const goTab = (key: string) => { if (key !== 'resumen') setEdit(false); navigate(`${location.pathname}#${key}`, { replace: true }); };
  const startEdit = () => { goTab('resumen'); setEdit(true); };
  const markPrimary = async (contactId: string) => {
    setChangingContact(contactId);
    try { await notariasService.setMainContact(id, contactId); setToast('Contacto principal actualizado.'); await load(); window.setTimeout(() => setToast(''), 2500); }
    catch (reason) { setToast(reason instanceof Error ? reason.message : 'No pudimos actualizar el contacto principal.'); }
    finally { setChangingContact(null); }
  };
  useEffect(() => {
    tabRefs.current[active]?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
  }, [active]);
  const moveTab = (event: KeyboardEvent<HTMLButtonElement>, current: string) => {
    const index = tabs.findIndex(([key]) => key === current);
    const direction = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
    if (!direction && event.key !== 'Home' && event.key !== 'End') return;
    event.preventDefault();
    const nextIndex = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : (index + direction + tabs.length) % tabs.length;
    const next = tabs[nextIndex][0];
    goTab(next);
    requestAnimationFrame(() => tabRefs.current[next]?.focus());
  };
  return <PageContainer title="" subtitle=""><Link to="/notarias" className={styles.backLink}><ArrowLeft size={15} />Volver a notarías</Link>
    {status === 'loading' && <div className={styles.workspaceLoading}><LoaderCircle className={styles.spin} size={20} />Cargando ficha de notaría...</div>}
    {status === 'error' && <section className={styles.pageState} role="alert"><span><AlertTriangle /></span><h2>No pudimos cargar la notaría.</h2><p>La ficha no está disponible en este momento.</p><button type="button" className={styles.secondaryButton} onClick={() => void load()}>Reintentar</button></section>}
    {status === 'ready' && item && <div className={styles.workspace}><NotariaHeader item={item} canWrite={canWrite && !edit} onEdit={startEdit} onContact={() => setContact(true)} /><section className={styles.detailMetrics} aria-label="Resumen operativo"><article><span><FolderKanban /></span><div><small>Expedientes activos</small><strong>{item.metrics.activeCases}</strong><em>No archivados, salvo entregados o cancelados</em></div></article><article><span><History /></span><div><small>Expedientes históricos</small><strong>{item.metrics.historicalCases}</strong><em>No archivados dentro de tu alcance</em></div></article><article><span><CalendarClock /></span><div><small>Próximas firmas</small><strong>{item.metrics.upcomingSignatures}</strong><em>Fecha estimada futura; no realizada</em></div></article><article><span><FileClock /></span><div><small>Última actividad</small><strong>{new Intl.DateTimeFormat('es-MX', { dateStyle: 'medium' }).format(new Date(item.metrics.lastActivity))}</strong><em>Última actualización visible de ficha o expediente</em></div></article></section><div className={styles.tabs} role="tablist" aria-label="Secciones de la notaría">{tabs.map(([key, label]) => <button key={key} id={`notaria-tab-${key}`} ref={(node) => { tabRefs.current[key] = node; }} type="button" role="tab" tabIndex={active === key ? 0 : -1} aria-selected={active === key} aria-controls={`notaria-panel-${key}`} className={active === key ? styles.tabActive : ''} onKeyDown={(event) => moveTab(event, key)} onClick={() => goTab(key)}>{label}</button>)}</div><main id={`notaria-panel-${active}`} aria-labelledby={`notaria-tab-${active}`} className={styles.tabContent} role="tabpanel" tabIndex={0}>{active === 'resumen' && <NotariaSummary item={item} editing={edit} canWrite={canWrite} onEdit={startEdit} onCancel={() => setEdit(false)} onSaved={() => { setEdit(false); void load(); }} onContacts={() => goTab('contactos')} />}{active === 'contactos' && <NotariaContacts item={item} canWrite={canWrite} changing={changingContact} onSetPrimary={(contactId) => void markPrimary(contactId)} />}{active === 'expedientes' && <NotariaExpedientes items={cases} page={casePage} meta={caseMeta} onPage={setCasePage} />}{active === 'actividad' && <NotariaActivity item={item} />}{active === 'configuracion' && <NotariaConfiguration item={item} canWrite={canWrite} onSaved={() => void load()} />}</main></div>}
    {contact && item && <AddNotariaContactDialog notariaId={item.id} onClose={() => setContact(false)} onSaved={() => { setContact(false); void load(); }} />}
    <div className={`${styles.toast} ${toast ? styles.toastVisible : ''}`} role="status">{toast}</div>
  </PageContainer>;
}
