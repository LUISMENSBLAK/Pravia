import { AlertTriangle, CalendarClock, CheckCircle2, ChevronLeft, ChevronRight, CircleAlert, FileSearch, RefreshCw, Search, ShieldCheck, X } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { PageContainer } from '../../components/layout/PageContainer';
import { useAuth } from '../auth/AuthProvider';
import { complianceService } from './compliance.service';
import type { H8Panel, H8PanelFilter, H8PanelRow } from './compliance.types';
import styles from './Compliance.module.css';

const empty: H8Panel = {
  rows: [], metrics: { pendientes: 0, avisos_pendientes: 0, por_vencer: 0, vencidos: 0 },
  meta: { page: 1, page_size: 25, total: 0, total_pages: 1 },
  filters: { lawyers: [], acts: [], notaries: [], show_notaria: false },
};
const primaryFilters: Array<{ code: H8PanelFilter; label: string }> = [
  { code: 'TODOS', label: 'Todos' }, { code: 'INCOMPLETOS', label: 'Incompletos' },
  { code: 'AVISOS_PENDIENTES', label: 'Avisos pendientes' }, { code: 'POR_VENCER', label: 'Por vencer' },
  { code: 'VENCIDOS', label: 'Vencidos' }, { code: 'PRESENTADOS', label: 'Presentados' },
  { code: 'COMPLETOS', label: 'Completos' },
];
const stateLabels: Record<string, string> = {
  NO_APLICA: 'No aplica', PENDIENTE: 'Pendiente', EN_PROCESO: 'En proceso', LISTO: 'Listo',
  CUMPLIMIENTO_COMPLETO: 'Cumplimiento completo', VENCIDO: 'Vencido',
};
// The legacy review workspace remains read-only and consumes these canonical human labels.
export const activityLabels: Record<string, string> = { TRANSMISION_DERECHOS_REALES_INMUEBLES: 'Derechos reales sobre inmuebles', PODER_IRREVOCABLE_ADMINISTRACION_DOMINIO: 'Poder irrevocable', CONSTITUCION_MODIFICACION_PERSONA_MORAL: 'Operación societaria', FIDEICOMISO_TRASLATIVO_GARANTIA: 'Fideicomiso traslativo o de garantía', MUTUO_CREDITO_NO_FINANCIERO: 'Mutuo o crédito' };
export const evaluationLabels: Record<string, string> = { SIN_EVALUAR: 'Sin evaluar', EN_REVISION: 'En revisión', INFORMACION_INCOMPLETA: 'Información incompleta', EVALUADO: 'Evaluado', REQUIERE_REVISION: 'Requiere revisión' };
export const noticeLabels: Record<string, string> = { NO_APLICA: 'No aplica', POR_DETERMINAR: 'Por determinar', REQUIERE_AVISO: 'Requiere Aviso', EN_PREPARACION: 'En preparación', PRESENTADO_EXTERNAMENTE: 'Presentado externamente', VENCIDO: 'Vencido' };

export function CompliancePage() {
  const { user } = useAuth();
  const [params, setParams] = useSearchParams();
  const [data, setData] = useState<H8Panel>(empty);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [lookupOpen, setLookupOpen] = useState(false);
  const [searchDraft, setSearchDraft] = useState(() => params.get('search') || '');
  const canRead = Boolean(user?.permissions?.some((permission) => ['compliance.read', 'cumplimiento.read'].includes(permission)));
  const canLookup = Boolean(user?.permissions?.includes('compliance.write') && user?.permissions?.includes('compliance.sensitive.read'));
  const filters = useMemo(() => ({
    filter: (params.get('filter') || 'TODOS') as H8PanelFilter,
    search: params.get('search') || '', lawyer_id: params.get('lawyer_id') || '', act_id: params.get('act_id') || '',
    notaria_id: params.get('notaria_id') || '', from: params.get('from') || '', to: params.get('to') || '',
    page: Number(params.get('page') || 1), page_size: 25,
  }), [params]);
  const load = useCallback(async (signal?: AbortSignal) => {
    if (!canRead) return;
    setStatus('loading');
    try { setData(await complianceService.h8Panel(filters, signal)); setStatus('ready'); }
    catch (error) { if (!(error instanceof DOMException && error.name === 'AbortError')) setStatus('error'); }
  }, [canRead, filters]);
  useEffect(() => { const controller = new AbortController(); void load(controller.signal); return () => controller.abort(); }, [load]);
  const change = (key: string, value: string) => {
    setParams((current) => {
      const next = new URLSearchParams(current);
      if (value && value !== 'TODOS') next.set(key, value); else next.delete(key);
      if (key !== 'page') next.delete('page');
      return next;
    }, { replace: true });
  };
  useEffect(() => {
    const timeout = window.setTimeout(() => {
      if (searchDraft === (params.get('search') || '')) return;
      change('search', searchDraft);
    }, 250);
    return () => window.clearTimeout(timeout);
  }, [searchDraft, params]);
  if (!canRead) return <PageContainer title="Cumplimiento" subtitle="Seguimiento transversal de requisitos, avisos y vencimientos."><section className={styles.restricted}><ShieldCheck/><h2>Acceso restringido</h2><p>Tu rol no incluye permiso para consultar Cumplimiento.</p></section></PageContainer>;
  return <PageContainer title="CUMPLIMIENTO" subtitle="Seguimiento transversal de requisitos, avisos y vencimientos." action={canLookup ? <button type="button" className={styles.h8SecondaryAction} onClick={() => setLookupOpen(true)}><FileSearch/>Consultar listas</button> : undefined}>
    {status === 'loading' && <ComplianceLoading/>}
    {status === 'error' && <section className={styles.error} role="alert"><AlertTriangle/><h2>No pudimos cargar Cumplimiento.</h2><p>La información no está disponible en este momento.</p><button type="button" onClick={() => void load()}><RefreshCw/>Reintentar</button></section>}
    {status === 'ready' && <>
      <section className={styles.h8Metrics} aria-label="Indicadores de Cumplimiento">
        <Kpi icon={CircleAlert} label="Pendientes" value={data.metrics.pendientes} active={filters.filter === 'INCOMPLETOS'} onClick={() => change('filter', 'INCOMPLETOS')}/>
        <Kpi icon={FileSearch} label="Avisos pendientes" value={data.metrics.avisos_pendientes} active={filters.filter === 'AVISOS_PENDIENTES'} onClick={() => change('filter', 'AVISOS_PENDIENTES')}/>
        <Kpi icon={CalendarClock} label="Por vencer" value={data.metrics.por_vencer} active={filters.filter === 'POR_VENCER'} onClick={() => change('filter', 'POR_VENCER')}/>
        <Kpi icon={AlertTriangle} label="Vencidos" value={data.metrics.vencidos} active={filters.filter === 'VENCIDOS'} onClick={() => change('filter', 'VENCIDOS')}/>
      </section>
      <section className={styles.h8Panel}>
        <div className={styles.h8PrimaryFilters} role="group" aria-label="Estado de Cumplimiento">{primaryFilters.map((item) => <button type="button" key={item.code} aria-pressed={filters.filter === item.code} onClick={() => change('filter', item.code)}>{item.label}</button>)}</div>
        <div className={styles.h8Tools}>
          <label className={styles.h8Search}><span className="sr-only">Buscar por expediente, escritura o compareciente</span><Search/><input value={searchDraft} onChange={(event) => setSearchDraft(event.target.value)} placeholder="Expediente, escritura o compareciente…"/></label>
          <details className={styles.h8MoreFilters}><summary>Más filtros</summary><div>
            <label>Abogado responsable<select aria-label="Abogado responsable" value={filters.lawyer_id} onChange={(event) => change('lawyer_id', event.target.value)}><option value="">Todos</option>{data.filters.lawyers.map((item) => <option value={item.id} key={item.id}>{item.nombre}</option>)}</select></label>
            <label>Acto<select aria-label="Acto" value={filters.act_id} onChange={(event) => change('act_id', event.target.value)}><option value="">Todos</option>{data.filters.acts.map((item) => <option value={item.id} key={item.id}>{item.nombre}</option>)}</select></label>
            {data.filters.show_notaria && <label>Notaría<select aria-label="Notaría" value={filters.notaria_id} onChange={(event) => change('notaria_id', event.target.value)}><option value="">Todas</option>{data.filters.notaries.map((item) => <option value={item.id} key={item.id}>{item.numero_notaria ? `Notaría ${item.numero_notaria}` : item.nombre}</option>)}</select></label>}
            <label>Desde<input aria-label="Desde" type="date" value={filters.from} onChange={(event) => change('from', event.target.value)}/></label>
            <label>Hasta<input aria-label="Hasta" type="date" value={filters.to} onChange={(event) => change('to', event.target.value)}/></label>
          </div></details>
        </div>
        <div className={styles.h8Count}><strong>{data.meta.total}</strong> expedientes dentro de tu alcance</div>
        {!data.rows.length ? <section className={styles.h8Empty}><CheckCircle2/><h2>{filters.filter === 'TODOS' && !filters.search ? 'No hay casos de Cumplimiento' : 'No hay resultados con estos filtros'}</h2><p>{filters.filter === 'TODOS' && !filters.search ? 'Los expedientes aparecerán cuando exista una evaluación de Cumplimiento.' : 'Ajusta los filtros o la búsqueda para ampliar los resultados.'}</p></section> : <div className={styles.h8Rows} role="list" aria-label="Expedientes de Cumplimiento">{data.rows.map((row) => <PanelRow key={row.id} row={row}/>)}</div>}
        <nav className={styles.h8Pagination} aria-label="Paginación"><span>Página {data.meta.page} de {data.meta.total_pages}</span><div><button type="button" aria-label="Página anterior" disabled={data.meta.page <= 1} onClick={() => change('page', String(data.meta.page - 1))}><ChevronLeft/></button><button type="button" aria-label="Página siguiente" disabled={data.meta.page >= data.meta.total_pages} onClick={() => change('page', String(data.meta.page + 1))}><ChevronRight/></button></div></nav>
      </section>
    </>}
    {lookupOpen && <FreeListLookup onClose={() => setLookupOpen(false)}/>}
  </PageContainer>;
}

function Kpi({ icon: Icon, label, value, active, onClick }: { icon: typeof CircleAlert; label: string; value: number; active: boolean; onClick(): void }) {
  return <button type="button" aria-pressed={active} onClick={onClick}><span><Icon/></span><div><small>{label}</small><strong>{value}</strong></div></button>;
}

function actsLabel(acts: H8PanelRow['actos']) {
  if (!acts.length) return 'Sin acto activo';
  return acts.length === 1 ? acts[0].nombre : `${acts[0].nombre} +${acts.length - 1} más`;
}

function PanelRow({ row }: { row: H8PanelRow }) {
  return <Link role="listitem" className={styles.h8Row} to={`/expedientes/${row.expediente_id}#cumplimiento`}>
    <div><small>Escritura</small><strong>{row.escritura || 'Pendiente'}</strong><span>{row.expediente}</span></div>
    <div className={styles.h8Priority}><small>Compareciente principal</small><strong>{row.compareciente_principal?.nombre || 'Sin compareciente principal'}</strong><span>{actsLabel(row.actos)}</span></div>
    <div className={styles.h8Priority}><small>Abogado responsable</small><strong>{row.abogado?.nombre || 'Sin asignar'}</strong><span>{row.notaria?.numero_notaria ? `Notaría ${row.notaria.numero_notaria}` : row.notaria?.nombre || 'Sin notaría'}</span></div>
    <div><small>Cumplimiento</small><b data-state={row.cumplimiento.code}>{stateLabels[row.cumplimiento.code] || row.cumplimiento.code}</b>{row.vulnerable && <span>Actividad vulnerable</span>}<span>{row.cumplimiento.pending_count ? `${row.cumplimiento.pending_count} pendientes` : 'Sin pendientes'}</span></div>
    <div><small>Aviso</small><b data-state={row.aviso.code}>{row.aviso.label}</b><span>{row.next_deadline ? `Próximo plazo ${new Date(row.next_deadline).toLocaleDateString('es-MX')}` : 'Sin plazo pendiente'}</span></div>
  </Link>;
}

function FreeListLookup({ onClose }: { onClose(): void }) {
  const [type, setType] = useState<'FISICA' | 'MORAL'>('FISICA');
  const [name, setName] = useState('');
  const [result, setResult] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const submit = async (event: React.FormEvent) => {
    event.preventDefault(); setBusy(true); setError('');
    try { setResult(await complianceService.freeScreening({ identity: { tipo_persona: type, primary_name: name, aliases: [], birth_date: null, birth_place: null, birth_country: null, nationality: null, curp: null, rfc: null, identification: null, incorporation_date: null, commercial_name: null, commercial_folio: null, corporate_type: null }, idempotency_key: crypto.randomUUID() })); }
    catch { setError('No fue posible completar la consulta de listas.'); }
    finally { setBusy(false); }
  };
  return <div className={styles.h8DialogBackdrop}><section className={styles.h8Dialog} role="dialog" aria-modal="true" aria-labelledby="h8-lookup-title"><header><div><h2 id="h8-lookup-title">Consultar listas</h2><p>Búsqueda libre; no crea comparecientes ni expedientes.</p></div><button type="button" aria-label="Cerrar consulta" onClick={onClose}><X/></button></header><form onSubmit={submit}><label>Tipo de persona<select value={type} onChange={(event) => setType(event.target.value as typeof type)}><option value="FISICA">Persona física</option><option value="MORAL">Persona moral</option></select></label><label>Nombre o razón social<input required value={name} onChange={(event) => setName(event.target.value)} /></label><button className={styles.primary} disabled={busy || !name.trim()} type="submit">{busy ? 'Consultando…' : 'Consultar'}</button></form>{error && <p role="alert" className={styles.h8LookupError}>{error}</p>}{result && <section className={styles.h8LookupResults} aria-live="polite"><h3>{result.human_status || 'Resultado de la consulta'}</h3><p>Consulta: {result.completed_at ? new Date(result.completed_at).toLocaleString('es-MX') : 'en proceso'}</p>{result.sourceExecutions?.map((source: any) => <article key={source.id}><strong>{source.source?.display_name || 'Fuente configurada'}</strong><span>{source.sourceVersion?.version ? `Versión ${source.sourceVersion.version}` : 'Sin versión activa'} · {source.execution_state}</span></article>)}{result.candidates?.map((candidate: any) => <article key={candidate.id}><strong>{candidate.display_name}</strong><span>{Number(candidate.score) >= .96 ? 'Coincidencia alta' : 'Coincidencia aproximada · requiere revisión humana'}</span></article>)}</section>}</section></div>;
}

export function ComplianceLoading() { return <div className={styles.loading} aria-label="Cargando Cumplimiento"><div>{[1,2,3,4].map((item) => <span key={item}/>)}</div><section><i/><i/><i/><i/></section></div>; }
