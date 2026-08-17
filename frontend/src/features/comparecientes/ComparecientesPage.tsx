import { AlertTriangle, ChevronLeft, ChevronRight, Grid2X2, List, Plus, Users } from 'lucide-react';
import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { PageContainer } from '../../components/layout/PageContainer';
import { useAuth } from '../auth/AuthProvider';
import { ComparecienteCardMobile } from './components/ComparecienteCardMobile';
import { ComparecienteCards } from './components/ComparecienteCards';
import { ComparecienteFilters } from './components/ComparecienteFilters';
import { ComparecienteMetrics } from './components/ComparecienteMetrics';
import { ComparecienteTable } from './components/ComparecienteTable';
import { useComparecientes } from './useComparecientes';
import styles from './Comparecientes.module.css';

const fields = ['search', 'type', 'updated', 'sort'] as const;
export function ComparecientesPage() {
  const { user } = useAuth(); const navigate = useNavigate(); const [params, setParams] = useSearchParams();
  const [view, setViewState] = useState<'cards'|'list'>(() => window.localStorage.getItem('pravia:comparecientes:view') === 'list' ? 'list' : 'cards');
  const values = Object.fromEntries(fields.map((field) => [field, params.get(field) || (field === 'sort' ? 'updated_at:desc' : '')])) as Record<string, string>;
  const page = Math.max(1, Number.parseInt(params.get('page') || '1', 10) || 1);
  const { result, status, reload } = useComparecientes({ ...values, page, pageSize: 20 }); const canWrite = user?.permissions?.includes('comparecientes.write') || false;
  const metrics = result && (result.metrics.physical === undefined || result.metrics.legal === undefined) && result.meta.total === result.data.length
    ? { total: result.metrics.total, physical: result.data.filter((item) => item.tipo_persona === 'FISICA').length, legal: result.data.filter((item) => item.tipo_persona === 'MORAL').length }
    : result?.metrics;
  const change = (field: string, value: string) => { const next = new URLSearchParams(params); value && !(field === 'sort' && value === 'updated_at:desc') ? next.set(field, value) : next.delete(field); if (field !== 'page') next.delete('page'); next.delete('new'); setParams(next, { replace: true }); };
  const clear = () => setParams(new URLSearchParams(), { replace: true });
  const setView = (next: 'cards'|'list') => { setViewState(next); window.localStorage.setItem('pravia:comparecientes:view', next); };
  return <PageContainer title="Comparecientes" subtitle="Registro y administración segura de personas físicas y morales." action={canWrite && <button type="button" className={styles.primaryButton} onClick={() => navigate('/comparecientes/nuevo')}><Plus size={18} />Nuevo compareciente</button>}>
    {status === 'loading' && <div className={styles.loading} aria-label="Cargando comparecientes"><div className={styles.loadingMetrics}>{[1,2,3].map((item) => <span key={item} />)}</div><span className={styles.loadingFilters} /><span className={styles.loadingTable} /></div>}
    {status === 'error' && <section className={styles.pageState} role="alert"><span><AlertTriangle /></span><h2>No pudimos cargar los comparecientes.</h2><p>La información de personas no está disponible en este momento.</p><button type="button" className={styles.secondaryButton} onClick={reload}>Reintentar</button></section>}
    {status === 'ready' && result && metrics && <><ComparecienteMetrics metrics={metrics} active={values.type} onSelect={(value) => change('type', value)} /><ComparecienteFilters values={values} onChange={change} onClear={clear} />
      <div className={styles.resultsToolbar}><p><strong>{result.meta.total}</strong> compareciente{result.meta.total === 1 ? '' : 's'} dentro de tu alcance</p><div className={styles.viewSelector} role="group" aria-label="Vista de comparecientes"><button type="button" aria-pressed={view === 'cards'} onClick={() => setView('cards')}><Grid2X2 />Tarjetas</button><button type="button" aria-pressed={view === 'list'} onClick={() => setView('list')}><List />Lista</button></div></div>
      {!result.data.length && !Object.values(values).some((value) => value && value !== 'updated_at:desc') ? <section className={styles.pageState}><span><Users /></span><h2>No hay comparecientes.</h2><p>Cuando registres una persona aparecerá aquí.</p>{canWrite && <button type="button" className={styles.primaryButton} onClick={() => navigate('/comparecientes/nuevo')}><Plus size={18} />Crear primer compareciente</button>}</section> : <section className={`${styles.listCard} ${view === 'cards' ? styles.cardView : styles.tableView}`} aria-label="Lista de comparecientes">{result.data.length ? <><div className={styles.desktopCards}><ComparecienteCards items={result.data} /></div><ComparecienteTable items={result.data} /><div className={styles.mobileList}>{result.data.map((item) => <ComparecienteCardMobile key={item.id} item={item} />)}</div></> : <div className={styles.filteredEmpty}><strong>No encontramos comparecientes con estos filtros.</strong><button type="button" onClick={clear}>Limpiar filtros</button></div>}<nav className={styles.pagination} aria-label="Paginación de comparecientes"><span>Mostrando {result.data.length ? (page - 1) * result.meta.pageSize + 1 : 0} a {Math.min(page * result.meta.pageSize, result.meta.total)} de {result.meta.total}</span><div><button type="button" aria-label="Página anterior" disabled={!result.meta.hasPreviousPage} onClick={() => change('page', String(page - 1))}><ChevronLeft size={17} /></button><b>{page}</b><button type="button" aria-label="Página siguiente" disabled={!result.meta.hasNextPage} onClick={() => change('page', String(page + 1))}><ChevronRight size={17} /></button></div></nav></section>}
    </>}
  </PageContainer>;
}
