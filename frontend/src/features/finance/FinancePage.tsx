import { AlertTriangle, Plus, RefreshCw, ShieldX } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { PageContainer } from '../../components/layout/PageContainer';
import { useAuth } from '../auth/AuthProvider';
import { AccountForm } from './components/AccountForm';
import { AccountsView } from './components/AccountsView';
import { FinancePeriodFilter } from './components/FinancePeriodFilter';
import { FinanceSummaryView } from './components/FinanceSummaryView';
import { InvoicesView } from './components/InvoicesView';
import { MovementDetail } from './components/MovementDetail';
import { MovementsView } from './components/MovementsView';
import { NewMovementFlow } from './components/NewMovementFlow';
import { ReceiptsView } from './components/ReceiptsView';
import { ReceivablesView } from './components/ReceivablesView';
import { ReconciliationView } from './components/ReconciliationView';
import styles from './Finance.module.css';
import { financeService } from './finance.service';
import type {
  FinanceAccount,
  FinanceCatalogs,
  FinanceMovement,
  FinancePeriodKey,
  FinanceSummary,
  FinanceView,
  Paginated,
  Receipt,
  Receivable,
  ReconciliationData,
} from './finance.types';

const views: Array<{ key: FinanceView; label: string }> = [
  { key: 'resumen', label: 'Resumen' },
  { key: 'movimientos', label: 'Movimientos' },
  { key: 'comprobantes', label: 'Comprobantes' },
  { key: 'cuentas', label: 'Cuentas' },
  { key: 'conciliacion', label: 'Conciliación' },
  { key: 'facturacion', label: 'Facturación' },
  { key: 'cartera', label: 'Cartera' },
];
const periodViews = new Set<FinanceView>(['resumen', 'movimientos', 'comprobantes', 'conciliacion', 'cartera']);
const emptyPage = <T,>(): Paginated<T> => ({ items: [], meta: { page: 1, pageSize: 20, total: 0, totalPages: 1 } });
const localDate = (date: Date) => {
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 10);
};

export function FinancePage() {
  const { user } = useAuth();
  const [params, setParams] = useSearchParams();
  const current = (views.some((item) => item.key === params.get('view')) ? params.get('view') : 'resumen') as FinanceView;
  const period = (params.get('periodo') || 'ESTE_MES') as FinancePeriodKey;
  const periodFrom = params.get('fecha_desde') || '';
  const periodTo = params.get('fecha_hasta') || '';
  const page = Math.max(1, Number(params.get('page') || 1));
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const loaded = useRef(false);
  const tabRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const [catalogs, setCatalogs] = useState<FinanceCatalogs | null>(null);
  const [summary, setSummary] = useState<FinanceSummary | null>(null);
  const [movements, setMovements] = useState<Paginated<FinanceMovement>>(emptyPage);
  const [receipts, setReceipts] = useState<Paginated<Receipt>>(emptyPage);
  const [accounts, setAccounts] = useState<FinanceAccount[]>([]);
  const [receivables, setReceivables] = useState<Paginated<Receivable>>(emptyPage);
  const [reconciliation, setReconciliation] = useState<ReconciliationData | null>(null);
  const [selected, setSelected] = useState<FinanceMovement | null>(null);
  const [newOpen, setNewOpen] = useState(params.get('new') === '1');
  const [accountOpen, setAccountOpen] = useState(false);
  const [toast, setToast] = useState('');
  const canRead = Boolean(user?.permissions?.includes('finanzas.read'));
  const filters = useMemo(() => ({
    search: params.get('search') || '',
    naturaleza: params.get('naturaleza') || '',
    cuenta_id: params.get('cuenta_id') || '',
    estatus: params.get('estatus') || '',
    comprobante: params.get('comprobante') || '',
  }), [params]);
  const periodQuery = useMemo(() => ({
    periodo: period,
    ...(period === 'PERSONALIZADO' ? { fecha_desde: periodFrom, fecha_hasta: periodTo } : {}),
  }), [period, periodFrom, periodTo]);

  const load = useCallback(async (signal?: AbortSignal) => {
    if (!canRead) return;
    if (!loaded.current) setStatus('loading');
    try {
      const cat = await financeService.catalogs(signal);
      setCatalogs(cat);
      if (current === 'resumen') setSummary(await financeService.summary(periodQuery, signal));
      if (current === 'movimientos') setMovements(await financeService.movements({ ...periodQuery, ...filters, page, pageSize: 20 }, signal));
      if (current === 'comprobantes') setReceipts(await financeService.receipts({ ...periodQuery, page, pageSize: 20 }, signal));
      if (current === 'cuentas') setAccounts(await financeService.accounts(signal));
      if (current === 'cartera') setReceivables(await financeService.receivables({ ...periodQuery, page, pageSize: 20 }, signal));
      if (current === 'conciliacion') setReconciliation(await financeService.reconciliation({ ...periodQuery, cuenta_id: filters.cuenta_id }, signal));
      setStatus('ready');
      loaded.current = true;
    } catch (error) {
      if (!(error instanceof DOMException && error.name === 'AbortError')) setStatus('error');
    }
  }, [canRead, current, filters, page, periodQuery]);

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  useEffect(() => {
    const activeTab = tabRefs.current[current];
    if (typeof activeTab?.scrollIntoView === 'function') activeTab.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
  }, [current]);

  const navigate = (view: FinanceView) => {
    const next = new URLSearchParams(params);
    view === 'resumen' ? next.delete('view') : next.set('view', view);
    next.delete('page');
    setParams(next, { replace: true });
  };
  const change = (key: string, value: string) => {
    const next = new URLSearchParams(params);
    value ? next.set(key, value) : next.delete(key);
    if (key !== 'page') next.delete('page');
    setParams(next, { replace: true });
  };
  const changePeriod = (value: FinancePeriodKey) => {
    const next = new URLSearchParams(params);
    next.set('periodo', value);
    next.delete('page');
    if (value === 'PERSONALIZADO' && (!periodFrom || !periodTo)) {
      const today = new Date();
      next.set('fecha_desde', localDate(new Date(today.getFullYear(), today.getMonth(), 1)));
      next.set('fecha_hasta', localDate(today));
    }
    if (value !== 'PERSONALIZADO') {
      next.delete('fecha_desde');
      next.delete('fecha_hasta');
    }
    setParams(next, { replace: true });
  };
  const saved = (message = 'Movimiento guardado correctamente.') => {
    setToast(message);
    window.setTimeout(() => setToast(''), 2600);
    void load();
  };

  if (!canRead) {
    return <PageContainer title="Finanzas" subtitle="Movimientos, cobranza y control de recursos."><section className={styles.accessDenied}><span><ShieldX /></span><h2>Acceso financiero restringido</h2><p>Tu rol no incluye permiso para consultar importes financieros.</p></section></PageContainer>;
  }

  const periodControl = periodViews.has(current)
    ? <FinancePeriodFilter value={period} from={periodFrom} to={periodTo} onChange={changePeriod} onDateChange={change} />
    : null;
  return (
    <PageContainer
      title="Finanzas"
      subtitle="Movimientos, cobranza y control de recursos."
      action={<div className={styles.headerActions}>{periodControl}{catalogs?.permisos.escribir && <button type="button" className={styles.primaryButton} onClick={() => setNewOpen(true)}><Plus size={17} />Registrar movimiento</button>}</div>}
    >
      <nav className={styles.subnav} aria-label="Secciones de Finanzas">
        {views.map((item) => <button type="button" key={item.key} ref={(node) => { tabRefs.current[item.key] = node; }} data-active={current === item.key} aria-current={current === item.key ? 'page' : undefined} onClick={() => navigate(item.key)}>{item.label}</button>)}
      </nav>
      {status === 'loading' && <FinanceLoading view={current} />}
      {status === 'error' && <section className={styles.errorState} role="alert"><span><AlertTriangle /></span><h2>No pudimos cargar Finanzas.</h2><p>La información financiera no está disponible en este momento.</p><button type="button" className={styles.secondaryButton} onClick={() => load()}><RefreshCw size={16} />Reintentar</button></section>}
      {status === 'ready' && catalogs && <>
        {current === 'resumen' && summary && <FinanceSummaryView summary={summary} onOpen={navigate} />}
        {current === 'movimientos' && <MovementsView result={movements} catalogs={catalogs} filters={filters} onFilter={change} onPage={(value) => change('page', String(value))} onSelect={setSelected} onNew={() => setNewOpen(true)} />}
        {current === 'comprobantes' && <ReceiptsView result={receipts} />}
        {current === 'cuentas' && <AccountsView accounts={accounts} canWrite={catalogs.permisos.escribir} onNew={() => setAccountOpen(true)} />}
        {current === 'conciliacion' && reconciliation && <ReconciliationView data={reconciliation} canReconcile={catalogs.permisos.conciliar} onReconcile={async (movementId, bankId) => { await financeService.reconcile(movementId, bankId); saved('Conciliación registrada correctamente.'); }} />}
        {current === 'facturacion' && <InvoicesView />}
        {current === 'cartera' && <ReceivablesView result={receivables} />}
      </>}
      {newOpen && catalogs && <NewMovementFlow catalogs={catalogs} onClose={() => setNewOpen(false)} onSaved={() => saved()} />}
      {accountOpen && <AccountForm onClose={() => setAccountOpen(false)} onSaved={() => { setAccountOpen(false); saved('Cuenta guardada correctamente.'); }} />}
      {selected && <MovementDetail movement={selected} onClose={() => setSelected(null)} />}
      <div className={`${styles.toast} ${toast ? styles.toastVisible : ''}`} role="status">{toast}</div>
    </PageContainer>
  );
}

function FinanceLoading({ view }: { view: FinanceView }) {
  return <div className={styles.loading} aria-label={`Cargando ${view}`}><div className={styles.loadingMetrics}>{[1, 2, 3, 4, 5].map((item) => <span key={item} />)}</div><div className={styles.loadingBody}><span /><span /></div><span className={styles.loadingTable} /></div>;
}
