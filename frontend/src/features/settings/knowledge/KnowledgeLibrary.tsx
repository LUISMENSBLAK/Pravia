import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { BookOpenText, ChevronRight, CircleHelp, ExternalLink, Pencil, Plus, Search, ShieldCheck, X } from 'lucide-react';
import { settingsService } from '../settings.service';
import { useAuth } from '../../auth/AuthProvider';
import styles from './KnowledgeLibrary.module.css';

type Version = { id: string; version: number; label: string; verification_status: string; effective_from?: string | null; effective_to?: string | null };
type Source = { id: string; inventory_code: string; title: string; jurisdiction: string; category: string; authority?: string | null; source_url?: string | null; applicability?: string | null; ingestion_status: string; versions: Version[] };
type Payload = { data: Source[]; pagination: { total: number; page: number; pages: number } };
type Evidence = { source_id: string; inventory_code: string; title: string; version: number; label: string; article_fragment: string; official_url?: string | null; jurisdiction: string; category: string; score: number };
type CriterionScope = { kind?: string; jurisdiction?: string; state?: string | null; municipality?: string | null; act?: string | null;
  effective_from?: string | null; effective_to?: string | null; source?: string; author?: string; review_status?: string;
  approval_status?: string; fixed_honorarium?: string | null; version?: number };
type Criterion = { id: string; code: string; title: string; content: string; scope: CriterionScope; active: boolean; created_at: string; updated_at: string };
const emptyCriterion = () => ({ code: '', title: '', content: '', kind: 'CRITERIO_INTERNO', jurisdiction: 'NAYARIT', state: '', municipality: '', act: '',
  effective_from: '', effective_to: '', source: '', author: '', review_status: 'PENDIENTE', approval_status: 'BORRADOR', fixed_honorarium: '' });

const collections = ['TODAS', 'NAYARIT', 'JALISCO', 'FEDERAL', 'JURISPRUDENCIA', 'FUENTES ADMINISTRATIVAS', 'CRITERIOS INTERNOS', 'CONOCIMIENTO COTIZACIONES'];

export function KnowledgeLibrary() {
  const { user } = useAuth();
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
  const [criteriaReload, setCriteriaReload] = useState(0);
  const [criterionForm, setCriterionForm] = useState<ReturnType<typeof emptyCriterion> | null>(null);
  const [editingCriterionId, setEditingCriterionId] = useState('');
  const [savingCriterion, setSavingCriterion] = useState(false);
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
  }, [collection, criteriaReload]);
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
  const canManage = Boolean(user?.permissions?.includes('configuracion.manage'));
  const editCriterion = (criterion?: Criterion) => {
    if (!criterion) { setEditingCriterionId(''); setCriterionForm(emptyCriterion()); return; }
    const scope = criterion.scope || {};
    setEditingCriterionId(criterion.id);
    setCriterionForm({ code: criterion.code, title: criterion.title, content: criterion.content,
      kind: scope.kind || 'CRITERIO_INTERNO', jurisdiction: scope.jurisdiction || 'NAYARIT', state: scope.state || '', municipality: scope.municipality || '', act: scope.act || '',
      effective_from: scope.effective_from || '', effective_to: scope.effective_to || '', source: scope.source || '', author: scope.author || '',
      review_status: scope.review_status || 'PENDIENTE', approval_status: scope.approval_status || 'BORRADOR', fixed_honorarium: scope.fixed_honorarium || '' });
  };
  const saveCriterion = async (event: FormEvent) => {
    event.preventDefault(); if (!criterionForm) return;
    setSavingCriterion(true); setError('');
    const input = { code: criterionForm.code, title: criterionForm.title, content: criterionForm.content, scope: {
      kind: criterionForm.kind, jurisdiction: criterionForm.jurisdiction, state: criterionForm.state, municipality: criterionForm.municipality,
      act: criterionForm.act, effective_from: criterionForm.effective_from, effective_to: criterionForm.effective_to,
      source: criterionForm.source, author: criterionForm.author, review_status: criterionForm.review_status,
      approval_status: criterionForm.approval_status, fixed_honorarium: criterionForm.fixed_honorarium,
    } };
    try {
      if (editingCriterionId) await settingsService.updateKnowledgeCriterion(editingCriterionId, input);
      else await settingsService.createKnowledgeCriterion(input);
      setCriterionForm(null); setEditingCriterionId(''); setCriteriaReload((value) => value + 1);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'No fue posible guardar el criterio interno.'); }
    finally { setSavingCriterion(false); }
  };
  return <section className={styles.library}>
    <aside className={styles.collections} aria-label="Colecciones de conocimiento"><header><BookOpenText /><div><strong>Biblioteca jurídica</strong><small>{payload?.pagination.total ?? 0} fuentes inventariadas</small></div></header>{collections.map((item) => <button type="button" key={item} aria-current={collection === item ? 'page' : undefined} onClick={() => setCollection(item)}><span>{item}</span><ChevronRight /></button>)}</aside>
    <main className={styles.explorer}>
      <div className={styles.searchBar}><Search /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar fuente, artículo o materia…" aria-label="Buscar en Biblioteca jurídica" /><button type="button" onClick={() => void retrieve()} disabled={query.trim().length < 3}>Buscar fundamento</button></div>
      {error && <div className={styles.error} role="alert">{error}</div>}
      {retrieval && <section className={styles.evidence} aria-label="Paquete de evidencia"><header><div><CircleHelp /><strong>Fundamento</strong></div><button type="button" onClick={() => setRetrieval(null)}>Cerrar</button></header>{retrieval.message ? <p className={styles.insufficient}>{retrieval.message}</p> : <ul>{retrieval.evidence.map((item, index) => <li key={`${item.source_id}-${item.version}-${index}`}><strong>{item.inventory_code} · {item.title}</strong><small>Versión {item.version} · {item.jurisdiction} · {item.category}</small><p>{item.article_fragment}</p>{item.official_url && <a href={item.official_url} target="_blank" rel="noreferrer">Ver fuente oficial <ExternalLink /></a>}</li>)}</ul>}<p className={styles.disclosure}>Se muestra evidencia verificable y explicación práctica; no razonamiento interno privado.</p></section>}
      {collection === 'CRITERIOS INTERNOS' ? <><div className={styles.criterionActions}>{canManage && <button type="button" onClick={() => editCriterion()}><Plus size={16} />Registrar criterio o arancel propio</button>}</div><div className={styles.browser}>
        <section className={styles.sourceList} aria-label="Criterios internos">{criteriaLoading ? <p>Cargando criterios internos…</p> : criteria.length ? criteria.map((criterion) => <button type="button" key={criterion.id} aria-current={selectedCriterion?.id === criterion.id ? 'true' : undefined} onClick={() => setSelectedCriterion(criterion)}><span><b>{criterion.code}</b><strong>{criterion.title}</strong><small>{criterion.scope.kind?.replaceAll('_', ' ') || 'Criterio interno'} · V{criterion.scope.version || 1}</small></span><i data-status={criterion.scope.approval_status === 'APROBADO' ? 'VERIFICADA' : 'PENDIENTE'}>{criterion.scope.approval_status || 'BORRADOR'}</i></button>) : <p>No hay criterios internos registrados.</p>}</section>
        <article className={styles.detail}>{selectedCriterion ? <><header><span>{selectedCriterion.code}</span><h2>{selectedCriterion.title}</h2><p className={styles.internalBadge}>CRITERIO INTERNO — NO ES NORMA.</p>{canManage && <button className={styles.editCriterion} type="button" onClick={() => editCriterion(selectedCriterion)}><Pencil size={15} />Editar y crear nueva versión</button>}</header><dl><div><dt>Contenido</dt><dd>{selectedCriterion.content}</dd></div><div><dt>Tipo / versión</dt><dd>{selectedCriterion.scope.kind?.replaceAll('_', ' ') || 'Criterio interno'} · V{selectedCriterion.scope.version || 1}</dd></div><div><dt>Aplicación</dt><dd>{[selectedCriterion.scope.jurisdiction, selectedCriterion.scope.state, selectedCriterion.scope.municipality, selectedCriterion.scope.act].filter(Boolean).join(' · ') || 'Sin alcance informado'}</dd></div><div><dt>Vigencia</dt><dd>{selectedCriterion.scope.effective_from || 'Sin inicio'} → {selectedCriterion.scope.effective_to || 'Abierta'}</dd></div><div><dt>Revisión</dt><dd>{selectedCriterion.scope.review_status || 'PENDIENTE'} · {selectedCriterion.scope.approval_status || 'BORRADOR'}</dd></div><div><dt>Fuente / autor</dt><dd>{selectedCriterion.scope.source || 'Sin fuente'} · {selectedCriterion.scope.author || 'Sin autor'}</dd></div>{selectedCriterion.scope.fixed_honorarium && <div><dt>Honorario explícito</dt><dd>${Number(selectedCriterion.scope.fixed_honorarium).toLocaleString('es-MX', { minimumFractionDigits: 2 })} MXN</dd></div>}<div><dt>Actualización</dt><dd>{new Date(selectedCriterion.updated_at).toLocaleString('es-MX')}</dd></div></dl><p>Este contenido orienta la operación interna y nunca sustituye una fuente jurídica oficial ni jurisprudencia.</p></> : <p>Selecciona un criterio interno.</p>}</article>
      </div>{criterionForm && <div className={styles.criterionOverlay} role="dialog" aria-modal="true" aria-label={editingCriterionId ? 'Editar criterio interno' : 'Registrar criterio interno'}><form className={styles.criterionForm} onSubmit={(event) => void saveCriterion(event)}><header><div><strong>{editingCriterionId ? 'Nueva versión del criterio' : 'Registrar criterio o arancel propio'}</strong><small>Contenido interno de la Notaría; nunca se presenta como legislación.</small></div><button type="button" aria-label="Cerrar" onClick={() => setCriterionForm(null)}><X /></button></header><div className={styles.formGrid}><label>Código<input required disabled={Boolean(editingCriterionId)} value={criterionForm.code} onChange={(event) => setCriterionForm({ ...criterionForm, code: event.target.value })} /></label><label>Tipo<select value={criterionForm.kind} onChange={(event) => setCriterionForm({ ...criterionForm, kind: event.target.value })}><option value="CRITERIO_INTERNO">Criterio interno</option><option value="ARANCEL_PROPIO">Arancel propio</option><option value="TABLA_HONORARIOS">Tabla de honorarios</option><option value="REGLA_FORMULA">Regla o fórmula interna</option></select></label><label className={styles.wide}>Título<input required value={criterionForm.title} onChange={(event) => setCriterionForm({ ...criterionForm, title: event.target.value })} /></label><label className={styles.wide}>Regla, tabla o fórmula<textarea required rows={4} value={criterionForm.content} onChange={(event) => setCriterionForm({ ...criterionForm, content: event.target.value })} /></label><label>Jurisdicción<input required value={criterionForm.jurisdiction} onChange={(event) => setCriterionForm({ ...criterionForm, jurisdiction: event.target.value })} /></label><label>Estado<input value={criterionForm.state} onChange={(event) => setCriterionForm({ ...criterionForm, state: event.target.value })} /></label><label>Municipio<input value={criterionForm.municipality} onChange={(event) => setCriterionForm({ ...criterionForm, municipality: event.target.value })} /></label><label>Acto aplicable<input value={criterionForm.act} onChange={(event) => setCriterionForm({ ...criterionForm, act: event.target.value })} /></label><label>Vigente desde<input type="date" value={criterionForm.effective_from} onChange={(event) => setCriterionForm({ ...criterionForm, effective_from: event.target.value })} /></label><label>Vigente hasta<input type="date" value={criterionForm.effective_to} onChange={(event) => setCriterionForm({ ...criterionForm, effective_to: event.target.value })} /></label><label>Fuente interna<input required value={criterionForm.source} onChange={(event) => setCriterionForm({ ...criterionForm, source: event.target.value })} /></label><label>Autor / aprobador<input required value={criterionForm.author} onChange={(event) => setCriterionForm({ ...criterionForm, author: event.target.value })} /></label>{['ARANCEL_PROPIO', 'TABLA_HONORARIOS'].includes(criterionForm.kind) && <label>Honorario fijo MXN<input required inputMode="decimal" value={criterionForm.fixed_honorarium} onChange={(event) => setCriterionForm({ ...criterionForm, fixed_honorarium: event.target.value })} /></label>}<label>Revisión<select value={criterionForm.review_status} onChange={(event) => setCriterionForm({ ...criterionForm, review_status: event.target.value })}><option value="PENDIENTE">Pendiente</option><option value="REVISADO">Revisado</option></select></label><label>Aprobación<select value={criterionForm.approval_status} onChange={(event) => setCriterionForm({ ...criterionForm, approval_status: event.target.value })}><option value="BORRADOR">Borrador</option><option value="APROBADO">Aprobado</option><option value="RECHAZADO">Rechazado</option></select></label></div><footer><button type="button" onClick={() => setCriterionForm(null)}>Cancelar</button><button type="submit" disabled={savingCriterion}>{savingCriterion ? 'Guardando…' : 'Guardar versión'}</button></footer></form></div>}</> : <div className={styles.browser}>
        <section className={styles.sourceList} aria-label="Fuentes">{loading ? <p>Cargando fuentes…</p> : visible.length ? visible.map((source) => <button type="button" key={source.id} aria-current={selected?.id === source.id ? 'true' : undefined} onClick={() => setSelected(source)}><span><b>{source.inventory_code}</b><strong>{source.title}</strong><small>{source.jurisdiction} · {source.category}</small></span><i data-status={source.versions[0]?.verification_status || 'PENDIENTE'}>{source.versions[0]?.verification_status === 'VERIFICADA' ? 'Verificada' : 'Pendiente'}</i></button>) : <p>No hay fuentes en esta colección.</p>}</section>
        <article className={styles.detail}>{selected ? <><header><span>{selected.inventory_code}</span><h2>{selected.title}</h2><p>{selected.authority || 'Autoridad no registrada'}</p></header><dl><div><dt>Jurisdicción</dt><dd>{selected.jurisdiction}</dd></div><div><dt>Categoría</dt><dd>{selected.category}</dd></div><div><dt>Estado de ingesta</dt><dd>{selected.ingestion_status.replaceAll('_', ' ')}</dd></div><div><dt>Aplicabilidad</dt><dd>{selected.applicability || 'Pendiente de clasificación'}</dd></div></dl><section><h3>Versiones</h3>{selected.versions.length ? selected.versions.map((version) => <div className={styles.version} key={version.id}><ShieldCheck /><span><strong>V{version.version} · {version.label}</strong><small>{version.verification_status} · {version.effective_from ? new Date(version.effective_from).toLocaleDateString('es-MX') : 'Vigencia pendiente'}</small></span></div>) : <p>La metadata está inventariada; todavía no existe texto oficial verificado.</p>}</section>{selected.source_url && <a className={styles.officialLink} href={selected.source_url} target="_blank" rel="noreferrer">Abrir URL oficial <ExternalLink /></a>}</> : <p>Selecciona una fuente.</p>}</article>
      </div>}
    </main>
  </section>;
}
