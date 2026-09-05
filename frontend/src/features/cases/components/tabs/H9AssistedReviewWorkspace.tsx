import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle2, ChevronRight, History, LoaderCircle, RefreshCw, SearchCheck } from 'lucide-react';
import { useAuth } from '../../../auth/AuthProvider';
import { complianceService, type H9Finding, type H9ReviewItem, type H9Workspace } from '../../../compliance/compliance.service';
import styles from './H9AssistedReviewWorkspace.module.css';

const blockLabels: Record<string, string> = {
  IDENTIFICACION_COMPARECIENTES: 'Identificación / Comparecientes', SCREENING: 'Screening',
  CUESTIONARIOS_RIESGO: 'Cuestionarios / Riesgo', BENEFICIARIO_CONTROLADOR: 'Beneficiario Controlador',
  PAGOS: 'Pagos', DOCUMENTAL: 'Documental', AVISOS_DECLARACIONES: 'Avisos / Declaraciones',
  PROYECTO_ESCRITURA: 'Proyecto / Escritura',
};
const formatDate = (value: string) => new Intl.DateTimeFormat('es-MX', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));

function FindingCard({ finding, critical = false }: { finding: H9Finding; critical?: boolean }) {
  return <article className={critical ? styles.critical : styles.observation}>
    <span aria-hidden="true">{critical ? <AlertTriangle /> : <SearchCheck />}</span>
    <div><strong>{blockLabels[finding.affected_block] || finding.category}</strong><p>{finding.message}</p>
      <small>Fuente: {finding.source_refs.join(', ') || finding.provenance}</small>
      <a href={finding.action_target}>Ir a {blockLabels[finding.affected_block] || 'la fuente'} <ChevronRight /></a>
    </div>
  </article>;
}

function ReviewResult({ review }: { review: H9ReviewItem }) {
  const clean = review.observation_count === 0 && review.critical_count === 0;
  return <div className={styles.result}>
    <div className={styles.metrics}>
      <div><strong>{review.correct_count}</strong><span>Verificaciones correctas</span></div>
      <div><strong>{review.observation_count}</strong><span>Observaciones</span></div>
      <div><strong>{review.critical_count}</strong><span>Inconsistencias críticas</span></div>
    </div>
    {clean && <p className={styles.clean}><CheckCircle2 />No se detectaron inconsistencias en las verificaciones realizadas</p>}
    {review.result.critical_inconsistencies.length > 0 && <section aria-labelledby={`critical-${review.id}`}><h4 id={`critical-${review.id}`}>Inconsistencias críticas</h4><div className={styles.findings}>{review.result.critical_inconsistencies.map((item) => <FindingCard key={item.check_key} finding={item} critical />)}</div></section>}
    {review.result.observations.length > 0 && <section aria-labelledby={`observations-${review.id}`}><h4 id={`observations-${review.id}`}>Observaciones</h4><div className={styles.findings}>{review.result.observations.map((item) => <FindingCard key={item.check_key} finding={item} />)}</div></section>}
  </div>;
}

export function H9AssistedReviewWorkspace({ expedienteId }: { expedienteId: string }) {
  const { user } = useAuth();
  const [workspace, setWorkspace] = useState<H9Workspace | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error' | 'running'>('loading');
  const [error, setError] = useState('');
  const canRun = Boolean(user?.permissions?.includes('compliance.review') && user?.permissions?.includes('ia.execute'));
  const load = useCallback(async (signal?: AbortSignal) => {
    try { setWorkspace(await complianceService.h9Workspace(expedienteId, signal)); setStatus('ready'); }
    catch (cause) { if (!(cause instanceof DOMException && cause.name === 'AbortError')) { setError(cause instanceof Error ? cause.message : 'No fue posible consultar las revisiones.'); setStatus('error'); } }
  }, [expedienteId]);
  useEffect(() => { const controller = new AbortController(); void load(controller.signal); return () => controller.abort(); }, [load]);
  const run = async () => {
    setStatus('running'); setError('');
    try { await complianceService.h9Run(expedienteId, crypto.randomUUID()); await load(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'No fue posible completar la revisión asistida.'); setStatus('ready'); }
  };
  const latest = workspace?.latest;
  return <section className={styles.workspace} aria-labelledby="h9-assisted-review-title">
    <header><div><h2 id="h9-assisted-review-title">Revisión de Cumplimiento</h2><p>Revisión asistida de consistencias con fuentes actuales; no sustituye la revisión jurídica.</p></div>
      {canRun && <button type="button" onClick={() => void run()} disabled={status === 'running' || workspace?.readiness.status !== 'READY'}>{status === 'running' ? <LoaderCircle className={styles.spin} /> : latest?.freshness === 'DESACTUALIZADA' ? <RefreshCw /> : <SearchCheck />}{status === 'running' ? 'Revisando…' : latest?.freshness === 'DESACTUALIZADA' ? 'Revisar nuevamente' : 'Revisar Cumplimiento'}</button>}
    </header>
    {status === 'loading' && <p className={styles.empty} role="status"><LoaderCircle className={styles.spin} />Consultando revisiones…</p>}
    {error && <p className={styles.error} role="alert">{error}</p>}
    {workspace?.readiness.status === 'NOT_READY' && <div className={styles.notReady}><strong>Información insuficiente para una revisión útil</strong><ul>{workspace.readiness.causes.map((cause) => <li key={cause}>{cause}</li>)}</ul></div>}
    {status !== 'loading' && !latest && workspace?.readiness.status === 'READY' && <p className={styles.empty}>Aún no hay revisiones. Ejecuta una revisión asistida para contrastar las fuentes actuales.</p>}
    {latest && <>
      <div className={styles.latestMeta}><span className={latest.freshness === 'DESACTUALIZADA' ? styles.stale : styles.current}>{latest.freshness}</span><span>{formatDate(latest.created_at)}</span><span>{latest.executed_by.name}</span></div>
      {latest.freshness === 'DESACTUALIZADA' && <div className={styles.changes}><strong>Fuentes relevantes modificadas</strong><ul>{latest.changes.map((item) => <li key={`${item.source_ref}:${item.change}`}>{item.detail}</li>)}</ul></div>}
      <ReviewResult review={latest} />
    </>}
    {workspace && workspace.history.length > 1 && <details className={styles.history}><summary><History />Historial de revisiones ({workspace.history.length})</summary><div>{workspace.history.slice(1).map((item) => <details key={item.id} className={styles.historyItem}><summary><span>{formatDate(item.created_at)} · {item.executed_by.name}</span><span>{item.freshness} · {item.correct_count} correctas · {item.observation_count} observaciones · {item.critical_count} críticas</span></summary><ReviewResult review={item} /></details>)}</div></details>}
  </section>;
}
