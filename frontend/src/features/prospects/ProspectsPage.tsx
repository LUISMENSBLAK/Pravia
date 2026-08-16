import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, ChevronLeft, ChevronRight, LayoutGrid, List, Plus, UsersRound } from 'lucide-react';
import { useSearchParams } from 'react-router-dom';
import { PageContainer } from '../../components/layout/PageContainer';
import { useAuth } from '../auth/AuthProvider';
import { ProspectActivitySummary } from './components/ProspectActivitySummary';
import { ProspectFilters } from './components/ProspectFilters';
import { ProspectMetrics } from './components/ProspectMetrics';
import { ProspectPipeline } from './components/ProspectPipeline';
import { ProspectList } from './components/ProspectList';
import { ProspectsLoading } from './components/ProspectsLoading';
import { NewProspectDrawer } from './components/NewProspectDrawer';
import { useProspects } from './useProspects';
import { settingsService } from '../settings/settings.service';
import type { ProspectPriority, ProspectStage } from './prospects.types';
import { stageForState } from './prospects.types';
import styles from './ProspectsPage.module.css';

export function ProspectsPage() {
  const { user } = useAuth();
  const [params, setParams] = useSearchParams();
  const search = params.get('search') ?? '';
  const stage = (params.get('stage') ?? '') as ProspectStage | '';
  const service = params.get('service') ?? '';
  const source = params.get('source') ?? '';
  const priority = (params.get('priority') ?? '') as ProspectPriority | '';
  const parsedPage = Number.parseInt(params.get('page') ?? '1', 10);
  const page = Number.isFinite(parsedPage) && parsedPage > 0 ? parsedPage : 1;
  const [mobileStage, setMobileStage] = useState<ProspectStage>((stage || 'new') as ProspectStage);
  const [view, setView] = useState<'cards' | 'list'>('cards');
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [toast, setToast] = useState('');
  const { prospects, status, meta, facets, reload, setProspects } = useProspects(search, priority, service, source, stage, page);
  const canWrite = user?.permissions?.includes('prospectos.write') ?? false;
  const persistViewPreference = import.meta.env.VITE_DISABLE_PREFERENCE_WRITES !== 'true';
  useEffect(() => {
    let active = true;
    settingsService.preferences().then((payload) => {
      if (active) setView(payload.preferences.default_view === 'LIST' ? 'list' : 'cards');
    }).catch(() => undefined);
    return () => { active = false; };
  }, []);
  const changeView = (next: 'cards' | 'list') => {
    setView(next);
    if (persistViewPreference) {
      void settingsService.updatePreferences({ default_view: next === 'list' ? 'LIST' : 'CARDS' }).catch(() => undefined);
    }
  };
  const updateFilter = (field: string, value: string) => {
    const next = new URLSearchParams(params);
    value ? next.set(field, value) : next.delete(field);
    if (field !== 'page') next.delete('page');
    setParams(next, { replace: true });
    if (field === 'stage' && value) setMobileStage(value as ProspectStage);
  };
  const clear = () => { setParams({}, { replace: true }); setMobileStage('new'); };
  const services = useMemo(() => facets.services.length ? facets.services : Array.from(new Set(prospects.map((item) => item.tipo_acto).filter((value): value is string => Boolean(value)))).sort(), [facets.services, prospects]);
  const sources = useMemo(() => facets.sources.length ? facets.sources : Array.from(new Set(prospects.map((item) => item.fuente).filter((value): value is string => Boolean(value)))).sort(), [facets.sources, prospects]);
  const visible = useMemo(() => prospects.filter((item) => (!stage || stageForState(item.estado) === stage) && (!service || item.tipo_acto === service) && (!source || item.fuente === source)), [prospects, service, source, stage]);
  const showCreate = () => setDrawerOpen(true);
  return (
    <PageContainer title="Prospectos" subtitle="Seguimiento comercial y conversión de oportunidades." action={canWrite && <button type="button" className={styles.primaryButton} onClick={showCreate}><Plus size={18} />Nuevo prospecto</button>}>
      {status === 'loading' && <ProspectsLoading />}
      {status === 'error' && <section className={styles.pageState} role="alert"><span><AlertTriangle /></span><h2>No pudimos cargar los prospectos.</h2><p>La información comercial no está disponible en este momento.</p><button type="button" className={styles.secondaryButton} onClick={reload}>Reintentar</button></section>}
      {status === 'ready' && <>
        <ProspectMetrics prospects={prospects} meta={meta} />
        <ProspectFilters search={search} stage={stage} service={service} priority={priority} source={source} services={services} sources={sources} onChange={updateFilter} onClear={clear} />
        <div className={styles.viewToolbar}>
          <span>Vista</span>
          <div className={styles.viewSwitch} role="group" aria-label="Vista de prospectos">
            <button type="button" aria-pressed={view === 'cards'} onClick={() => changeView('cards')}><LayoutGrid size={16} />Tarjetas</button>
            <button type="button" aria-pressed={view === 'list'} onClick={() => changeView('list')}><List size={17} />Lista</button>
          </div>
        </div>
        {!prospects.length && !search && !priority && !service && !source && !stage ? <section className={styles.pageState}><span><UsersRound /></span><h2>Aún no hay prospectos.</h2><p>Crea el primero para comenzar el seguimiento comercial.</p>{canWrite && <button type="button" className={styles.primaryButton} onClick={showCreate}><Plus size={18} />Crear primer prospecto</button>}</section> : <>
          {!visible.length && <div className={styles.noResults}>No hay resultados con los filtros seleccionados. <button type="button" onClick={clear}>Limpiar filtros</button></div>}
          {view === 'cards'
            ? <ProspectPipeline prospects={visible} meta={meta} mobileStage={mobileStage} onMobileStage={setMobileStage} onCreate={canWrite ? showCreate : undefined} />
            : <ProspectList prospects={visible} />}
          <ProspectActivitySummary prospects={visible} />
          {meta && meta.totalPages > 1 && <nav className={styles.pagination} aria-label="Paginación de prospectos">
            <span>Página {meta.page} de {meta.totalPages} · {meta.total} resultados</span>
            <div>
              <button type="button" aria-label="Página anterior" disabled={!meta.hasPreviousPage} onClick={() => updateFilter('page', String(page - 1))}><ChevronLeft size={17} /></button>
              <button type="button" aria-label="Página siguiente" disabled={!meta.hasNextPage} onClick={() => updateFilter('page', String(page + 1))}><ChevronRight size={17} /></button>
            </div>
          </nav>}
        </>}
      </>}
      {drawerOpen && <NewProspectDrawer onClose={() => setDrawerOpen(false)} onCreated={(created) => { setProspects((current) => [created, ...current]); setDrawerOpen(false); setToast('Prospecto creado.'); window.setTimeout(() => setToast(''), 3200); }} />}
      <div className={`${styles.toast} ${toast ? styles.toastVisible : ''}`} role="status" aria-live="polite">{toast}</div>
    </PageContainer>
  );
}
