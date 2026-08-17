import { AlertTriangle, CalendarRange, RefreshCw, ShieldX } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { PageContainer } from '../../components/layout/PageContainer';
import { useAuth } from '../auth/AuthProvider';
import {
  CollectionsView,
  EightyTwentyView,
  FinanceView,
  LawyersView,
  PotentialClientsView,
  SignaturesView,
  SummaryView,
} from './ReportViews';
import styles from './Reports.module.css';
import { reportingService } from './reporting.service';
import { TargetDialog } from './TargetDialog';
import type {
  CollectionsReport,
  EightyTwentyReport,
  FinanceReport,
  LawyersReport,
  PotentialClientsReport,
  ReportPeriodKey,
  ReportView,
  ReportingCatalogs,
  SignaturesReport,
  SummaryReport,
} from './reporting.types';

const views: Array<{ key: ReportView; label: string }> = [
  { key: 'resumen', label: 'Resumen' },
  { key: 'finanzas', label: 'Finanzas' },
  { key: 'cobranza', label: 'Cobranza' },
  { key: 'abogados', label: 'Abogados' },
  { key: 'firmas', label: 'Firmas' },
  { key: '80-20', label: '80/20' },
  { key: 'clientes-potenciales', label: 'Clientes potenciales' },
];

const periods: Array<{ key: ReportPeriodKey; label: string }> = [
  { key: 'ESTA_SEMANA', label: 'Esta semana' },
  { key: 'ESTE_MES', label: 'Este mes' },
  { key: 'MES_ANTERIOR', label: 'Mes anterior' },
  { key: 'ESTE_TRIMESTRE', label: 'Este trimestre' },
  { key: 'ESTE_ANO', label: 'Este año' },
  { key: 'PERSONALIZADO', label: 'Personalizado' },
];

type ReportData = {
  summary?: SummaryReport;
  finance?: FinanceReport;
  collections?: CollectionsReport;
  lawyers?: LawyersReport;
  signatures?: SignaturesReport;
  eightyTwenty?: EightyTwentyReport;
  potential?: PotentialClientsReport;
};

const localDate = (date: Date) => new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 10);

export function ReportsPage() {
  const { user } = useAuth();
  const [params, setParams] = useSearchParams();
  const current = (views.some((view) => view.key === params.get('view')) ? params.get('view') : 'resumen') as ReportView;
  const period = (params.get('periodo') || 'ESTE_MES') as ReportPeriodKey;
  const [catalogs, setCatalogs] = useState<ReportingCatalogs | null>(null);
  const [data, setData] = useState<ReportData>({});
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [errors, setErrors] = useState<Set<string>>(new Set());
  const [targetOpen, setTargetOpen] = useState(false);
  const loaded = useRef(false);
  const tabs = useRef<Record<string, HTMLButtonElement | null>>({});
  const canRead = Boolean(user?.permissions?.includes('reportes.read'));
  const filters = useMemo(() => ({
    periodo: period,
    ...(period === 'PERSONALIZADO' ? {
      fecha_desde: params.get('fecha_desde') || '',
      fecha_hasta: params.get('fecha_hasta') || '',
    } : {}),
    abogado_id: params.get('abogado_id') || '',
    notaria_id: params.get('notaria_id') || '',
    ...(current === 'clientes-potenciales' ? { page: params.get('page') || '1', page_size: '20' } : {}),
  }), [current, params, period]);

  const load = useCallback(async (signal?: AbortSignal) => {
    if (!canRead) return;
    if (!loaded.current) setStatus('loading');
    setErrors(new Set());
    try {
      const cat = await reportingService.catalogs(signal);
      setCatalogs(cat);
      if (current === 'resumen') {
        const results = await Promise.allSettled([
          reportingService.summary(filters, signal),
          reportingService.finance(filters, signal),
          reportingService.collections(filters, signal),
          reportingService.signatures(filters, signal),
          reportingService.eightyTwenty(filters, signal),
          reportingService.potentialClients(filters, signal),
        ]);
        if (results[0].status === 'rejected') throw results[0].reason;
        const next: ReportData = { summary: results[0].value };
        const failed = new Set<string>();
        if (results[1].status === 'fulfilled') next.finance = results[1].value;
        else failed.add('finance');
        if (results[2].status === 'fulfilled') next.collections = results[2].value;
        else failed.add('collections');
        if (results[3].status === 'fulfilled') next.signatures = results[3].value;
        else failed.add('signatures');
        if (results[4].status === 'fulfilled') next.eightyTwenty = results[4].value;
        else failed.add('eightyTwenty');
        if (results[5].status === 'fulfilled') next.potential = results[5].value;
        else failed.add('potential');
        setErrors(failed);
        setData(next);
      } else if (current === 'finanzas') setData({ finance: await reportingService.finance(filters, signal) });
      else if (current === 'cobranza') setData({ collections: await reportingService.collections(filters, signal) });
      else if (current === 'abogados') setData({ lawyers: await reportingService.lawyers(filters, signal) });
      else if (current === 'firmas') setData({ signatures: await reportingService.signatures(filters, signal) });
      else if (current === '80-20') setData({ eightyTwenty: await reportingService.eightyTwenty(filters, signal) });
      else setData({ potential: await reportingService.potentialClients(filters, signal) });
      setStatus('ready');
      loaded.current = true;
    } catch (error) {
      if (!(error instanceof DOMException && error.name === 'AbortError')) setStatus('error');
    }
  }, [canRead, current, filters]);

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  useEffect(() => {
    tabs.current[current]?.scrollIntoView?.({ behavior: 'smooth', block: 'nearest', inline: 'center' });
  }, [current]);

  const change = (key: string, value: string) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    if (key !== 'page') next.delete('page');
    setParams(next, { replace: true });
  };
  const open = (view: string) => {
    const next = new URLSearchParams(params);
    if (view === 'resumen') next.delete('view');
    else next.set('view', view);
    next.delete('page');
    setParams(next, { replace: true });
  };
  const changePeriod = (value: ReportPeriodKey) => {
    const next = new URLSearchParams(params);
    next.set('periodo', value);
    if (value === 'PERSONALIZADO' && (!next.get('fecha_desde') || !next.get('fecha_hasta'))) {
      const today = new Date();
      next.set('fecha_desde', localDate(new Date(today.getFullYear(), today.getMonth(), 1)));
      next.set('fecha_hasta', localDate(today));
    }
    if (value !== 'PERSONALIZADO') {
      next.delete('fecha_desde');
      next.delete('fecha_hasta');
    }
    next.delete('page');
    setParams(next, { replace: true });
  };

  if (!canRead) {
    return <PageContainer title="Reportes" subtitle="Inteligencia operativa y financiera trazable.">
      <section className={styles.restricted}><ShieldX /><h2>Acceso a reportes restringido</h2><p>Tu rol no incluye permiso para consultar este módulo.</p></section>
    </PageContainer>;
  }

  return <PageContainer
    title="Reportes"
    subtitle="Indicadores operativos, comerciales y financieros."
    action={<div className={styles.headerTools}>
      <div className={styles.periodControl}>
        <CalendarRange />
        <label><span>Periodo</span><select aria-label="Periodo del reporte" value={period} onChange={(event) => changePeriod(event.target.value as ReportPeriodKey)}>{periods.map((item) => <option key={item.key} value={item.key}>{item.label}</option>)}</select></label>
        {period === 'PERSONALIZADO' && <div className={styles.customDates}>
          <input aria-label="Fecha inicial" type="date" value={filters.fecha_desde || ''} onChange={(event) => change('fecha_desde', event.target.value)} />
          <span>–</span>
          <input aria-label="Fecha final" type="date" value={filters.fecha_hasta || ''} onChange={(event) => change('fecha_hasta', event.target.value)} />
        </div>}
      </div>
    </div>}
  >
    <nav className={styles.subnav} aria-label="Vistas de Reportes">
      {views.map((view) => <button type="button" key={view.key} ref={(node) => { tabs.current[view.key] = node; }} data-active={current === view.key} aria-current={current === view.key ? 'page' : undefined} onClick={() => open(view.key)}>{view.label}</button>)}
    </nav>
    {catalogs?.scope.global && <section className={styles.filters} aria-label="Alcance del reporte">
      <label><span>Abogado</span><select aria-label="Filtrar por abogado" value={filters.abogado_id} onChange={(event) => change('abogado_id', event.target.value)}><option value="">Todos</option>{catalogs.usuarios.map((item) => <option key={item.id} value={item.id}>{item.nombre} {item.apellido}</option>)}</select></label>
      <label><span>Notaría</span><select aria-label="Filtrar por notaría" value={filters.notaria_id} onChange={(event) => change('notaria_id', event.target.value)}><option value="">Todas</option>{catalogs.notarias.map((item) => <option key={item.id} value={item.id}>{item.nombre}</option>)}</select></label>
      {(filters.abogado_id || filters.notaria_id) && <button type="button" onClick={() => {
        const next = new URLSearchParams(params);
        next.delete('abogado_id');
        next.delete('notaria_id');
        setParams(next, { replace: true });
      }}>Limpiar filtros</button>}
    </section>}
    {status === 'loading' && <ReportsLoading />}
    {status === 'error' && <section className={styles.error} role="alert"><AlertTriangle /><h2>No pudimos cargar Reportes</h2><p>La información no está disponible en este momento.</p><button type="button" onClick={() => load()}><RefreshCw />Reintentar</button></section>}
    {status === 'ready' && <>
      {current === 'resumen' && data.summary && <SummaryView summary={data.summary} finance={data.finance} collections={data.collections} signatures={data.signatures} eightyTwenty={data.eightyTwenty} potential={data.potential} errors={errors} onOpen={open} />}
      {current === 'finanzas' && data.finance && <FinanceView data={data.finance} />}
      {current === 'cobranza' && data.collections && <CollectionsView data={data.collections} />}
      {current === 'abogados' && data.lawyers && <LawyersView data={data.lawyers} canManageTargets={Boolean(catalogs?.scope.targetsManage)} onConfigureTarget={() => setTargetOpen(true)} />}
      {current === 'firmas' && data.signatures && <SignaturesView data={data.signatures} />}
      {current === '80-20' && data.eightyTwenty && <EightyTwentyView data={data.eightyTwenty} />}
      {current === 'clientes-potenciales' && data.potential && <PotentialClientsView data={data.potential} onPageChange={(page) => change('page', String(page))} />}
    </>}
    {targetOpen && catalogs && <TargetDialog catalogs={catalogs} onClose={() => setTargetOpen(false)} onSaved={() => { setTargetOpen(false); loaded.current = false; void load(); }} />}
  </PageContainer>;
}

function ReportsLoading() {
  return <div className={styles.loading} aria-label="Cargando reportes"><div>{[1, 2, 3, 4].map((item) => <span key={item} />)}</div><section><i /><i /><i /></section></div>;
}
