import { AlertTriangle, ChevronLeft, ChevronRight, FolderOpen, Plus } from 'lucide-react';
import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { PageContainer } from '../../components/layout/PageContainer';
import { useAuth } from '../auth/AuthProvider';
import { ExpedienteFilters } from './components/ExpedienteFilters';
import { ExpedienteMetrics } from './components/ExpedienteMetrics';
import { ExpedienteMobileCard } from './components/ExpedienteMobileCard';
import { ExpedienteTable } from './components/ExpedienteTable';
import { ExpedientesLoading } from './components/ExpedientesLoading';
import { NewExpedienteFlow } from './components/NewExpedienteFlow';
import { useExpedientes } from './useExpedientes';
import styles from './Expedientes.module.css';

const fields = ['search', 'macrophase', 'stage', 'responsible', 'notary', 'risk', 'dateFrom', 'dateTo', 'actType', 'client', 'status', 'sort'] as const;
export function ExpedientesPage() {
  const { user } = useAuth(); const navigate = useNavigate(); const [params, setParams] = useSearchParams(); const [open, setOpen] = useState(params.get('new') === '1'); const [toast, setToast] = useState('');
  const values = Object.fromEntries(fields.map((field) => [field, params.get(field) || ''])) as Record<string, string>; const page = Math.max(1, Number.parseInt(params.get('page') || '1', 10) || 1);
  const { result, status, reload } = useExpedientes({ ...values, page, pageSize: 20 }); const canWrite = user?.permissions?.includes('expedientes.write') || false;
  const change = (field: string, value: string) => { const next = new URLSearchParams(params); value ? next.set(field, value) : next.delete(field); if (field !== 'page') next.delete('page'); next.delete('new'); setParams(next, { replace: true }); };
  const clear = () => setParams(new URLSearchParams(), { replace: true }); const selectMetric = (key: string) => change('macrophase', key === 'TOTAL' ? '' : key);
  return <PageContainer title="Expedientes" subtitle="Control y seguimiento integral de operaciones notariales." action={canWrite && <button type="button" className={styles.primaryButton} onClick={() => setOpen(true)}><Plus size={18} />Nuevo expediente</button>}>
    {status === 'loading' && <ExpedientesLoading />}
    {status === 'error' && <section className={styles.pageState} role="alert"><span><AlertTriangle /></span><h2>No pudimos cargar los expedientes.</h2><p>La información operativa no está disponible en este momento.</p><button type="button" className={styles.secondaryButton} onClick={reload}>Reintentar</button></section>}
    {status === 'ready' && result && <><ExpedienteMetrics metrics={result.metrics} active={values.macrophase} onSelect={selectMetric} /><ExpedienteFilters values={values} facets={result.facets} onChange={change} onClear={clear} />
      {!result.data.length && !Object.values(values).some(Boolean) ? <section className={styles.pageState}><span><FolderOpen /></span><h2>No hay expedientes.</h2><p>Cuando abras una operación aparecerá aquí.</p>{canWrite && <button type="button" className={styles.primaryButton} onClick={() => setOpen(true)}><Plus size={18} />Crear primer expediente</button>}</section> : <section className={styles.listCard} aria-label="Lista de expedientes">{result.data.length ? <><ExpedienteTable items={result.data} /><div className={styles.mobileList}>{result.data.map((item) => <ExpedienteMobileCard key={item.id} item={item} />)}</div></> : <div className={styles.filteredEmpty}><strong>No encontramos expedientes con estos filtros.</strong><button type="button" onClick={clear}>Limpiar filtros</button></div>}<nav className={styles.pagination} aria-label="Paginación de expedientes"><span>Mostrando {result.data.length ? (page - 1) * result.meta.pageSize + 1 : 0} a {Math.min(page * result.meta.pageSize, result.meta.total)} de {result.meta.total}</span><div><button type="button" aria-label="Página anterior" disabled={!result.meta.hasPreviousPage} onClick={() => change('page', String(page - 1))}><ChevronLeft size={17} /></button><b>{page}</b><button type="button" aria-label="Página siguiente" disabled={!result.meta.hasNextPage} onClick={() => change('page', String(page + 1))}><ChevronRight size={17} /></button></div></nav></section>}
    </>}
    {open && <NewExpedienteFlow onClose={() => setOpen(false)} onCreated={(expediente) => { setOpen(false); setToast(`Expediente ${expediente.numero_pravia} creado correctamente.`); void reload(); window.setTimeout(() => { setToast(''); navigate(`/expedientes/${expediente.id}`); }, 1200); }} />}
    <div className={`${styles.toast} ${toast ? styles.toastVisible : ''}`} role="status" aria-live="polite">{toast}</div>
  </PageContainer>;
}
