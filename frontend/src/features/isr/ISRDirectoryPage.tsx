import { useEffect, useMemo, useState } from 'react';
import { Calculator, FileClock, Grid2X2, List, Plus, Search, Sigma } from 'lucide-react';
import { useLocation, useNavigate } from 'react-router-dom';
import { PageContainer } from '../../components/layout/PageContainer';
import { Button } from '../../components/ui/Button';
import { Badge } from '../../components/ui/Badge';
import { useAuth } from '../auth/AuthProvider';
import { fixtureDirectory } from './isr.fixtures';
import { isrService } from './isr.service';
import type { ISRListResponse, ISRStatus, ISRView } from './isr.types';
import styles from './ISR.module.css';

const statusLabel: Record<ISRStatus, string> = { BORRADOR: 'Borrador', LISTO_PARA_CALCULAR: 'Listo para calcular', CALCULADO: 'Federal calculado', REQUIERE_REVISION: 'Requiere revisión' };
const operationLabel = { ENAJENACION_INMUEBLE: 'Enajenación de inmueble', ADQUISICION_INMUEBLE: 'Adquisición de inmueble', CASO_ESPECIAL: 'Caso especial' };
const tone = (status: ISRStatus) => status === 'CALCULADO' ? 'success' : status === 'LISTO_PARA_CALCULAR' ? 'neutral' : status === 'REQUIERE_REVISION' ? 'danger' : 'warning';
const money = (value?: string) => value ? new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' }).format(Number(value)) : '—';

export function ISRDirectoryPage() {
  const navigate = useNavigate(); const location = useLocation(); const { user } = useAuth();
  const query = new URLSearchParams(location.search);
  const fixture = import.meta.env.DEV && query.get('fixture') === 'directory';
  const localVisualAccess = fixture && query.get('visual') === '1';
  const [data, setData] = useState<ISRListResponse | null>(fixture ? fixtureDirectory : null);
  const [loading, setLoading] = useState(!fixture); const [error, setError] = useState('');
  const [search, setSearch] = useState(''); const [status, setStatus] = useState(''); const [type, setType] = useState(''); const [exercise, setExercise] = useState('2026'); const [order, setOrder] = useState('newest');
  const [view, setView] = useState<ISRView>(() => localStorage.getItem('pravia-isr-view') === 'list' ? 'list' : 'cards');
  const canRead = localVisualAccess || !user?.permissions || user.permissions.includes('isr.read'); const canWrite = localVisualAccess || !user?.permissions || user.permissions.includes('isr.write');

  useEffect(() => {
    if (fixture || !canRead) return;
    const controller = new AbortController(); setLoading(true); setError('');
    const params = new URLSearchParams({ page: '1', pageSize: '20', order });
    if (search) params.set('search', search); if (status) params.set('estado', status); if (type) params.set('tipo_operacion', type); if (exercise) params.set('ejercicio', exercise);
    const timer = window.setTimeout(() => isrService.list(params, controller.signal).then(setData).catch((reason) => { if (reason?.name !== 'AbortError') setError(reason instanceof Error ? reason.message : 'No fue posible cargar los cálculos.'); }).finally(() => setLoading(false)), 180);
    return () => { controller.abort(); window.clearTimeout(timer); };
  }, [canRead, exercise, fixture, order, search, status, type]);

  const setPreferredView = (next: ISRView) => { setView(next); localStorage.setItem('pravia-isr-view', next); };
  const items = useMemo(() => data?.data || [], [data]);
  const newCalculation = () => navigate(fixture ? '/calculo-isr/nuevo?fixture=new&visual=1' : '/calculo-isr/nuevo');
  if (!canRead) return <PageContainer title="Cálculo ISR"><div className={styles.notice} role="alert">No tienes permiso para consultar este módulo.</div></PageContainer>;

  return <PageContainer title="Cálculo ISR" subtitle="Determinaciones fiscales documentadas, reproducibles y sujetas a revisión humana." action={canWrite && <Button onClick={newCalculation}><Plus size={18}/>Nuevo cálculo</Button>}>
    <section className={styles.kpiGrid} aria-label="Resumen de cálculos ISR">
      <article className={styles.kpi}><span><Calculator/></span><div><p>Total de cálculos</p><strong>{data?.kpis.total ?? '—'}</strong><small>Registros dentro de tu alcance</small></div></article>
      <article className={styles.kpi}><span className={styles.green}><Sigma/></span><div><p>Federales calculados</p><strong>{data?.kpis.calculated ?? '—'}</strong><small>Artículo 126 · versión inmutable</small></div></article>
      <article className={styles.kpi}><span className={styles.amber}><FileClock/></span><div><p>Pendientes de información</p><strong>{data?.kpis.pending ?? '—'}</strong><small>Borrador o en revisión</small></div></article>
    </section>

    <section className={styles.directoryPanel}>
      <div className={styles.filters}>
        <label className={styles.search}><span className="sr-only">Buscar cálculo ISR</span><Search/><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar folio, expediente, contribuyente, RFC o inmueble…"/></label>
        <label><span>Tipo</span><select value={type} onChange={(event) => setType(event.target.value)}><option value="">Todos</option><option value="ENAJENACION_INMUEBLE">Enajenación</option><option value="ADQUISICION_INMUEBLE">Adquisición</option><option value="CASO_ESPECIAL">Caso especial</option></select></label>
        <label><span>Estado</span><select value={status} onChange={(event) => setStatus(event.target.value)}><option value="">Todos</option>{Object.entries(statusLabel).map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></label>
        <label><span>Ejercicio</span><select value={exercise} onChange={(event) => setExercise(event.target.value)}><option value="">Todos</option><option>2026</option></select></label>
        <label><span>Orden</span><select value={order} onChange={(event) => setOrder(event.target.value)}><option value="newest">Más reciente</option><option value="oldest">Más antiguo</option></select></label>
        <div className={styles.viewToggle} role="group" aria-label="Vista de resultados"><button aria-pressed={view==='cards'} onClick={()=>setPreferredView('cards')}><Grid2X2/><span>Tarjetas</span></button><button aria-pressed={view==='list'} onClick={()=>setPreferredView('list')}><List/><span>Lista</span></button></div>
      </div>

      {error && <div className={styles.notice} role="alert">{error}<button onClick={()=>setSearch((value)=>`${value} ` .trim())}>Reintentar</button></div>}
      {loading && <div className={styles.loading} role="status">Cargando cálculos ISR…</div>}
      {!loading && !items.length && <div className={styles.empty}><Calculator/><h2>Aún no hay cálculos con estos filtros</h2><p>Crea un borrador para comenzar a reunir datos y documentos.</p></div>}
      {!loading && view === 'cards' && <div className={styles.cardGrid}>{items.map((item) => <button type="button" className={styles.calculationCard} key={item.id} onClick={()=>navigate(`/calculo-isr/${item.id}${fixture?'?fixture=result':''}`)}>
        <header><div><span>{item.folio}</span><h2>{item.contribuyente_nombre || 'Contribuyente pendiente'}</h2></div><Badge tone={tone(item.estado)}>{statusLabel[item.estado]}</Badge></header>
        <dl><div><dt>Operación</dt><dd>{operationLabel[item.tipo_operacion]}</dd></div><div><dt>Expediente</dt><dd>{item.expediente?.numero_pravia || 'Sin vincular'}</dd></div><div><dt>Inmueble</dt><dd>{item.inmueble_descripcion || 'Información pendiente'}</dd></div></dl>
        <footer><span>{new Date(item.updated_at).toLocaleDateString('es-MX')}</span><strong>{item.estado==='CALCULADO'?money(item.versiones?.[0]?.result.provisionalFederalISR):'Resultado pendiente'}</strong></footer>
      </button>)}</div>}
      {!loading && view === 'list' && <div className={styles.tableWrap}><table><thead><tr><th>Folio</th><th>Contribuyente</th><th>Operación</th><th>Expediente</th><th>Actualización</th><th>Resultado federal</th><th>Estado</th></tr></thead><tbody>{items.map((item)=><tr key={item.id} tabIndex={0} onClick={()=>navigate(`/calculo-isr/${item.id}${fixture?'?fixture=result':''}`)} onKeyDown={(event)=>{if(event.key==='Enter')navigate(`/calculo-isr/${item.id}`)}}><td><strong>{item.folio}</strong></td><td>{item.contribuyente_nombre || 'Pendiente'}<small>{item.contribuyente_rfc}</small></td><td>{operationLabel[item.tipo_operacion]}</td><td>{item.expediente?.numero_pravia || 'Sin vincular'}</td><td>{new Date(item.updated_at).toLocaleDateString('es-MX')}</td><td>{item.estado==='CALCULADO'?money(item.versiones?.[0]?.result.provisionalFederalISR):'—'}</td><td><Badge tone={tone(item.estado)}>{statusLabel[item.estado]}</Badge></td></tr>)}</tbody></table></div>}
    </section>
  </PageContainer>;
}
