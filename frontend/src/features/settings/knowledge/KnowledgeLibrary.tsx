import { useEffect, useMemo, useState } from 'react';
import { BookOpenText, ChevronRight, CircleHelp, ExternalLink, Search, ShieldCheck } from 'lucide-react';
import { settingsService } from '../settings.service';
import styles from './KnowledgeLibrary.module.css';

type Version = { id: string; version: number; label: string; verification_status: string; effective_from?: string | null; effective_to?: string | null };
type Source = { id: string; inventory_code: string; title: string; jurisdiction: string; category: string; authority?: string | null; source_url?: string | null; applicability?: string | null; ingestion_status: string; versions: Version[] };
type Payload = { data: Source[]; pagination: { total: number; page: number; pages: number } };
type Evidence = { source_id: string; inventory_code: string; title: string; version: number; label: string; article_fragment: string; official_url?: string | null; jurisdiction: string; category: string; score: number };
type Criterion = { id: string; code: string; title: string; content: string; scope: Record<string, unknown>; active: boolean; created_at: string; updated_at: string };

const collections = ['TODAS', 'NAYARIT', 'JALISCO', 'FEDERAL', 'JURISPRUDENCIA', 'FUENTES ADMINISTRATIVAS', 'CRITERIOS INTERNOS', 'CONOCIMIENTO COTIZACIONES'];

export function KnowledgeLibrary() {
  const [query, setQuery] = useState('');
  const [collection, setCollection] = useState('TODAS');
  const [payload, setPayload] = useState<Payload | null>(null);
  const [selected, setSelected] = useState<Source | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [retrieval, setRetrieval] = useState<{ status: string; message?: string | null; evidence: Evidence[] } | null>(null);
  const [criteria, setCriteria] = useState<Criterion[]>([]);
  const [selectedCriterion, setSelectedCriterion] = useState<Criterion | null>(null);
  const [criteriaLoading, setCriteriaLoading] = useState(false);
  const jurisdiction = ['NAYARIT', 'JALISCO', 'FEDERAL'].includes(collection) ? collection : undefined;
  const category = collection === 'JURISPRUDENCIA' ? 'JURISPRUDENCIA' : undefined;
  useEffect(() => {
    const timer = window.setTimeout(() => {
      setLoading(true); setError('');
      settingsService.knowledgeSources({ search: query, jurisdiction, category, page_size: 100 })
        .then((result) => { setPayload(result); setSelected((current) => result.data.find((item: Source) => item.id === current?.id) || result.data[0] || null); })
        .catch((cause) => setError(cause instanceof Error ? cause.message : 'No fue posible abrir la Biblioteca.'))
        .finally(() => setLoading(false));
    }, 220);
    return () => window.clearTimeout(timer);
  }, [query, jurisdiction, category, collection]);
  useEffect(() => {
    if (collection !== 'CRITERIOS INTERNOS') return;
    setCriteriaLoading(true); setError('');
    settingsService.knowledgeCriteria()
      .then((result) => { setCriteria(result.data || []); setSelectedCriterion((current) => result.data?.find((item: Criterion) => item.id === current?.id) || result.data?.[0] || null); })
      .catch((cause) => setError(cause instanceof Error ? cause.message : 'No fue posible abrir los criterios internos.'))
      .finally(() => setCriteriaLoading(false));
  }, [collection]);
  const visible = useMemo(() => (payload?.data || []).filter((source) => {
    if (collection === 'CRITERIOS INTERNOS') return source.category.includes('CRITERIO');
    if (collection === 'CONOCIMIENTO COTIZACIONES') return /COTIZA|ARANCEL|HONORARIO/i.test(`${source.category} ${source.title}`);
    if (collection === 'FUENTES ADMINISTRATIVAS') return /ADMINISTRATIV/i.test(source.category);
    return true;
  }), [payload, collection]);
  const retrieve = async () => {
    if (query.trim().length < 3) return;
    setError('');
    try { setRetrieval(await settingsService.retrieveKnowledge({ query, jurisdiction, category })); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'No fue posible recuperar fundamento.'); }
  };
  return <section className={styles.library}>
    <aside className={styles.collections} aria-label="Colecciones de conocimiento"><header><BookOpenText /><div><strong>Biblioteca jurídica</strong><small>{payload?.pagination.total ?? 0} fuentes inventariadas</small></div></header>{collections.map((item) => <button type="button" key={item} aria-current={collection === item ? 'page' : undefined} onClick={() => setCollection(item)}><span>{item}</span><ChevronRight /></button>)}</aside>
    <main className={styles.explorer}>
      <div className={styles.searchBar}><Search /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar fuente, artículo o materia…" aria-label="Buscar en Biblioteca jurídica" /><button type="button" onClick={() => void retrieve()} disabled={query.trim().length < 3}>Buscar fundamento</button></div>
      {error && <div className={styles.error} role="alert">{error}</div>}
      {retrieval && <section className={styles.evidence} aria-label="Paquete de evidencia"><header><div><CircleHelp /><strong>Fundamento</strong></div><button type="button" onClick={() => setRetrieval(null)}>Cerrar</button></header>{retrieval.message ? <p className={styles.insufficient}>{retrieval.message}</p> : <ul>{retrieval.evidence.map((item, index) => <li key={`${item.source_id}-${item.version}-${index}`}><strong>{item.inventory_code} · {item.title}</strong><small>Versión {item.version} · {item.jurisdiction} · {item.category}</small><p>{item.article_fragment}</p>{item.official_url && <a href={item.official_url} target="_blank" rel="noreferrer">Ver fuente oficial <ExternalLink /></a>}</li>)}</ul>}<p className={styles.disclosure}>Se muestra evidencia verificable y explicación práctica; no razonamiento interno privado.</p></section>}
      {collection === 'CRITERIOS INTERNOS' ? <div className={styles.browser}>
        <section className={styles.sourceList} aria-label="Criterios internos">{criteriaLoading ? <p>Cargando criterios internos…</p> : criteria.length ? criteria.map((criterion) => <button type="button" key={criterion.id} aria-current={selectedCriterion?.id === criterion.id ? 'true' : undefined} onClick={() => setSelectedCriterion(criterion)}><span><b>{criterion.code}</b><strong>{criterion.title}</strong><small>Criterio de despacho · {criterion.active ? 'Activo' : 'Inactivo'}</small></span><i data-status={criterion.active ? 'VERIFICADA' : 'PENDIENTE'}>{criterion.active ? 'Activo' : 'Inactivo'}</i></button>) : <p>No hay criterios internos registrados.</p>}</section>
        <article className={styles.detail}>{selectedCriterion ? <><header><span>{selectedCriterion.code}</span><h2>{selectedCriterion.title}</h2><p className={styles.internalBadge}>CRITERIO INTERNO — NO ES NORMA.</p></header><dl><div><dt>Contenido</dt><dd>{selectedCriterion.content}</dd></div><div><dt>Alcance</dt><dd><code>{JSON.stringify(selectedCriterion.scope)}</code></dd></div><div><dt>Estado</dt><dd>{selectedCriterion.active ? 'Activo' : 'Inactivo'}</dd></div><div><dt>Actualización</dt><dd>{new Date(selectedCriterion.updated_at).toLocaleString('es-MX')}</dd></div></dl><p>Este contenido orienta la operación interna y nunca sustituye una fuente jurídica oficial ni jurisprudencia.</p></> : <p>Selecciona un criterio interno.</p>}</article>
      </div> : <div className={styles.browser}>
        <section className={styles.sourceList} aria-label="Fuentes">{loading ? <p>Cargando fuentes…</p> : visible.length ? visible.map((source) => <button type="button" key={source.id} aria-current={selected?.id === source.id ? 'true' : undefined} onClick={() => setSelected(source)}><span><b>{source.inventory_code}</b><strong>{source.title}</strong><small>{source.jurisdiction} · {source.category}</small></span><i data-status={source.versions[0]?.verification_status || 'PENDIENTE'}>{source.versions[0]?.verification_status === 'VERIFICADA' ? 'Verificada' : 'Pendiente'}</i></button>) : <p>No hay fuentes en esta colección.</p>}</section>
        <article className={styles.detail}>{selected ? <><header><span>{selected.inventory_code}</span><h2>{selected.title}</h2><p>{selected.authority || 'Autoridad no registrada'}</p></header><dl><div><dt>Jurisdicción</dt><dd>{selected.jurisdiction}</dd></div><div><dt>Categoría</dt><dd>{selected.category}</dd></div><div><dt>Estado de ingesta</dt><dd>{selected.ingestion_status.replaceAll('_', ' ')}</dd></div><div><dt>Aplicabilidad</dt><dd>{selected.applicability || 'Pendiente de clasificación'}</dd></div></dl><section><h3>Versiones</h3>{selected.versions.length ? selected.versions.map((version) => <div className={styles.version} key={version.id}><ShieldCheck /><span><strong>V{version.version} · {version.label}</strong><small>{version.verification_status} · {version.effective_from ? new Date(version.effective_from).toLocaleDateString('es-MX') : 'Vigencia pendiente'}</small></span></div>) : <p>La metadata está inventariada; todavía no existe texto oficial verificado.</p>}</section>{selected.source_url && <a className={styles.officialLink} href={selected.source_url} target="_blank" rel="noreferrer">Abrir URL oficial <ExternalLink /></a>}</> : <p>Selecciona una fuente.</p>}</article>
      </div>}
    </main>
  </section>;
}
