import { AlertTriangle, Building2, ChevronLeft, ChevronRight, LayoutGrid, List, Plus } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { PageContainer } from '../../components/layout/PageContainer';
import { useAuth } from '../auth/AuthProvider';
import { settingsService } from '../settings/settings.service';
import { NewNotariaFlow } from './components/NewNotariaFlow';
import { NotariaFilters } from './components/NotariaFilters';
import { NotariaMetrics } from './components/NotariaMetrics';
import { NotariaCard } from './components/NotariaMobileCard';
import { NotariaTable } from './components/NotariaTable';
import { useNotarias } from './useNotarias';
import styles from './Notarias.module.css';

export function NotariasPage() {
  const { user } = useAuth();
  const [params, setParams] = useSearchParams();
  const [open, setOpen] = useState(params.get('new') === '1');
  const [toast, setToast] = useState('');
  const [view, setView] = useState<'cards' | 'list'>('cards');
  const search = params.get('search') || '';
  const state = params.get('state') || '';
  const page = Math.max(1, Number.parseInt(params.get('page') || '1', 10) || 1);
  const { result, status, reload } = useNotarias({ search, state, page, pageSize: 20 });
  const canWrite = user?.permissions?.includes('notarias.write') || false;
  const persistViewPreference = import.meta.env.VITE_DISABLE_PREFERENCE_WRITES !== 'true';

  useEffect(() => {
    let active = true;
    settingsService.preferences().then((payload) => { if (active) setView(payload.preferences.default_view === 'LIST' ? 'list' : 'cards'); }).catch(() => undefined);
    return () => { active = false; };
  }, []);

  const changeView = (next: 'cards' | 'list') => {
    setView(next);
    if (persistViewPreference) void settingsService.updatePreferences({ default_view: next === 'list' ? 'LIST' : 'CARDS' }).catch(() => undefined);
  };
  const change = (field: string, value: string) => {
    const next = new URLSearchParams(params);
    value ? next.set(field, value) : next.delete(field);
    if (field !== 'page') next.delete('page');
    next.delete('new');
    setParams(next, { replace: true });
  };
  const clear = () => setParams(new URLSearchParams(), { replace: true });
  const hasFilters = Boolean(search || state);

  return <PageContainer title="Notarías" subtitle="Directorio y operación de notarías vinculadas." action={canWrite && <button type="button" className={styles.primaryButton} onClick={() => setOpen(true)}><Plus size={18} />Nueva notaría</button>}>
    {status === 'loading' && <div className={styles.loading} aria-label="Cargando notarías"><div className={styles.loadingMetrics}>{[1, 2, 3].map((item) => <span key={item} />)}</div><span className={styles.loadingFilters} /><span className={styles.loadingTable} /></div>}
    {status === 'error' && <section className={styles.pageState} role="alert"><span><AlertTriangle /></span><h2>No pudimos cargar las notarías.</h2><p>El directorio no está disponible en este momento.</p><button type="button" className={styles.secondaryButton} onClick={reload}>Reintentar</button></section>}
    {status === 'ready' && result && <>
      <NotariaMetrics metrics={result.metrics} />
      <NotariaFilters values={{ search, state }} onChange={change} onClear={clear} />
      <div className={styles.viewToolbar}><span>Vista</span><div className={styles.viewSwitch} role="group" aria-label="Vista de notarías"><button type="button" aria-pressed={view === 'cards'} onClick={() => changeView('cards')}><LayoutGrid size={16} />Tarjetas</button><button type="button" aria-pressed={view === 'list'} onClick={() => changeView('list')}><List size={17} />Lista</button></div></div>
      {!result.data.length && !hasFilters ? <section className={styles.pageState}><span><Building2 /></span><h2>No hay notarías registradas.</h2><p>Cuando registres una oficina notarial aparecerá aquí.</p>{canWrite && <button type="button" className={styles.primaryButton} onClick={() => setOpen(true)}><Plus size={18} />Registrar primera notaría</button>}</section> : <section className={styles.listCard} aria-label="Directorio de notarías">
        {result.data.length ? view === 'cards' ? <div className={styles.cardsGrid}>{result.data.map((item) => <NotariaCard key={item.id} item={item} />)}</div> : <NotariaTable items={result.data} /> : <div className={styles.filteredEmpty}><strong>No encontramos notarías con estos filtros.</strong><button type="button" onClick={clear}>Limpiar filtros</button></div>}
        <nav className={styles.pagination} aria-label="Paginación de notarías"><span>Mostrando {result.data.length ? (page - 1) * result.meta.pageSize + 1 : 0} a {Math.min(page * result.meta.pageSize, result.meta.total)} de {result.meta.total}</span><div><button type="button" aria-label="Página anterior" disabled={!result.meta.hasPreviousPage} onClick={() => change('page', String(page - 1))}><ChevronLeft size={17} /></button><b>{page}</b><button type="button" aria-label="Página siguiente" disabled={!result.meta.hasNextPage} onClick={() => change('page', String(page + 1))}><ChevronRight size={17} /></button></div></nav>
      </section>}
    </>}
    {open && <NewNotariaFlow onClose={() => setOpen(false)} onSaved={() => { setOpen(false); setToast('Notaría guardada correctamente.'); void reload(); window.setTimeout(() => setToast(''), 2500); }} />}
    <div className={`${styles.toast} ${toast ? styles.toastVisible : ''}`} role="status">{toast}</div>
  </PageContainer>;
}
