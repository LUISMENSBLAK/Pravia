import { useState } from 'react';
import { AlertTriangle, ChevronLeft, ChevronRight, FileText, Plus } from 'lucide-react';
import { useSearchParams } from 'react-router-dom';
import { PageContainer } from '../../components/layout/PageContainer';
import { useAuth } from '../auth/AuthProvider';
import { NewQuoteFlow } from './components/NewQuoteFlow';
import { QuoteAnalytics } from './components/QuoteAnalytics';
import { QuoteCardMobile } from './components/QuoteCardMobile';
import { QuoteFilters } from './components/QuoteFilters';
import { QuoteMetrics } from './components/QuoteMetrics';
import { QuoteTable } from './components/QuoteTable';
import { QuotesLoading } from './components/QuotesLoading';
import { useQuotes } from './useQuotes';
import type { QuoteState } from './quotes.types';
import styles from './Quotes.module.css';

export function QuotesPage() {
  const { user } = useAuth(); const [params, setParams] = useSearchParams();
  const search = params.get('search') ?? ''; const state = (params.get('state') ?? '') as QuoteState | ''; const act = params.get('act') ?? ''; const responsible = params.get('responsible') ?? '';
  const dateFrom = params.get('dateFrom') ?? ''; const dateTo = params.get('dateTo') ?? ''; const period = params.get('period') === 'year' ? 'year' : '6m';
  const parsedPage = Number.parseInt(params.get('page') ?? '1', 10); const page = Number.isFinite(parsedPage) && parsedPage > 0 ? parsedPage : 1;
  const [newOpen, setNewOpen] = useState(params.get('new') === '1'); const [toast, setToast] = useState('');
  const { result, status, reload } = useQuotes({ search, state, act, responsible, dateFrom, dateTo, period, page });
  const canWrite = user?.permissions?.includes('cotizaciones.write') ?? false;
  const change = (field: string, value: string) => { const next = new URLSearchParams(params); value ? next.set(field, value) : next.delete(field); if (field !== 'page') next.delete('page'); next.delete('new'); setParams(next, { replace: true }); };
  const clear = () => { const next = new URLSearchParams(); if (period === 'year') next.set('period', 'year'); setParams(next, { replace: true }); };
  return <PageContainer title="Cotizaciones" subtitle="Presupuestos, seguimiento y conversión comercial." action={canWrite && <button type="button" className={styles.primaryButton} onClick={() => setNewOpen(true)}><Plus size={18} />Nueva cotización</button>}>
    {status === 'loading' && <QuotesLoading />}
    {status === 'error' && <section className={styles.pageState} role="alert"><span><AlertTriangle /></span><h2>No pudimos cargar las cotizaciones.</h2><p>La información comercial no está disponible en este momento.</p><button type="button" className={styles.secondaryButton} onClick={reload}>Reintentar</button></section>}
    {status === 'ready' && result && <>
      <QuoteMetrics meta={result.meta} />
      <QuoteFilters search={search} state={state} act={act} responsible={responsible} dateFrom={dateFrom} dateTo={dateTo} acts={result.facets.acts} responsibles={result.facets.responsibles} onChange={change} onClear={clear} />
      {!result.data.length && !search && !state && !act && !responsible && !dateFrom && !dateTo ? <section className={styles.pageState}><span><FileText /></span><h2>No hay cotizaciones.</h2><p>Crea la primera a partir de un prospecto disponible.</p>{canWrite && <button type="button" className={styles.primaryButton} onClick={() => setNewOpen(true)}><Plus size={18} />Crear primera cotización</button>}</section> : <div className={styles.contentGrid}>
        <section className={styles.listCard} aria-labelledby="quote-list-title"><header><div><h2 id="quote-list-title">Lista de cotizaciones</h2><p>{result.meta.total} resultado{result.meta.total === 1 ? '' : 's'} con los filtros actuales.</p></div></header>
          {!result.data.length ? <div className={styles.filteredEmpty}><strong>No encontramos cotizaciones con estos filtros.</strong><button type="button" onClick={clear}>Limpiar filtros</button></div> : <><QuoteTable quotes={result.data} /><div className={styles.mobileList}>{result.data.map((quote) => <QuoteCardMobile key={quote.id} quote={quote} />)}</div></>}
          {result.meta.totalPages > 1 && <nav className={styles.pagination} aria-label="Paginación de cotizaciones"><span>Página {result.meta.page} de {result.meta.totalPages}</span><div><button type="button" aria-label="Página anterior" disabled={!result.meta.hasPreviousPage} onClick={() => change('page', String(page - 1))}><ChevronLeft size={17} /></button><button type="button" aria-label="Página siguiente" disabled={!result.meta.hasNextPage} onClick={() => change('page', String(page + 1))}><ChevronRight size={17} /></button></div></nav>}
        </section>
        <QuoteAnalytics data={result.analytics} period={period} onPeriod={(value) => change('period', value)} />
      </div>}
    </>}
    {newOpen && <NewQuoteFlow initialProspectId={params.get('prospecto') ?? undefined} onClose={() => setNewOpen(false)} onCreated={(quote) => { setNewOpen(false); setToast(`Cotización ${quote.numero_cotizacion || ''} creada.`); void reload(); window.setTimeout(() => setToast(''), 3500); }} />}
    <div className={`${styles.toast} ${toast ? styles.toastVisible : ''}`} role="status" aria-live="polite">{toast}</div>
  </PageContainer>;
}
