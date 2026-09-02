import { AlertTriangle, CheckCircle2, Clock3, FileDown, History, LoaderCircle, RefreshCw, ShieldCheck } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import type { ScreeningHistory, ScreeningQuery, ScreeningResolutionDecision } from '../comparecientes.types';
import { comparecientesService } from '../comparecientes.service';
import styles from '../Comparecientes.module.css';

const technicalLabels: Record<string, string> = {
  NOT_EXECUTED: 'Pendiente de ejecución', QUEUED: 'En cola', RUNNING: 'Consultando', NOT_CONFIGURED: 'Fuente no configurada',
  SUCCEEDED: 'Consulta completada', PARTIAL: 'Consulta parcial', ERROR: 'Error de consulta',
};
const decisionLabels: Record<ScreeningResolutionDecision, string> = {
  NO_CORRESPONDE: 'No corresponde', REVISION_ADICIONAL: 'Revisión adicional', COINCIDENCIA_CONFIRMADA: 'Coincidencia confirmada',
};
const uid = () => globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`;

export function ScreeningPanel({ comparecienteId, canRerun, canResolve, canReport }: { comparecienteId: string; canRerun: boolean; canResolve: boolean; canReport: boolean }) {
  const [data, setData] = useState<ScreeningHistory | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [busy, setBusy] = useState('');
  const [message, setMessage] = useState('');
  const [rationales, setRationales] = useState<Record<string, string>>({});
  const load = useCallback(async (signal?: AbortSignal) => {
    try { setData(await comparecientesService.screening(comparecienteId, signal)); setStatus('ready'); }
    catch (error) { if (!(error instanceof DOMException && error.name === 'AbortError')) setStatus('error'); }
  }, [comparecienteId]);
  useEffect(() => { const controller = new AbortController(); void load(controller.signal); return () => controller.abort(); }, [load]);
  const rerun = async () => { setBusy('rerun'); setMessage(''); try { await comparecientesService.rerunScreening(comparecienteId, uid()); await load(); setMessage('La nueva consulta quedó registrada en el historial.'); } catch (error) { setMessage(error instanceof Error ? error.message : 'No fue posible consultar nuevamente.'); } finally { setBusy(''); } };
  const resolve = async (query: ScreeningQuery, candidateId: string, decision: ScreeningResolutionDecision) => { const rationale = rationales[candidateId]?.trim(); if (!rationale) { setMessage('Documenta el motivo antes de guardar la resolución.'); return; } setBusy(candidateId); setMessage(''); try { await comparecientesService.resolveScreeningCandidate(comparecienteId, query.id, candidateId, decision, rationale); await load(); setMessage(`Resolución registrada: ${decisionLabels[decision]}.`); } catch (error) { setMessage(error instanceof Error ? error.message : 'No fue posible guardar la resolución.'); } finally { setBusy(''); } };
  const report = async (queryId: string) => { setBusy(`report:${queryId}`); setMessage(''); try { await comparecientesService.generateScreeningReport(comparecienteId, queryId, uid()); await load(); setMessage('Reporte de consulta generado y guardado en Documentos.'); } catch (error) { setMessage(error instanceof Error ? error.message : 'No fue posible generar el reporte.'); } finally { setBusy(''); } };
  const current = data?.current;
  return <section id="screening" className={styles.screeningPanel} aria-labelledby="screening-title">
    <header><div><span>CUM-LST-001</span><h2 id="screening-title">Consulta nominal</h2><p>Resultado actual e historial inmutable de fuentes configuradas.</p></div>{canRerun && <button type="button" className={styles.secondaryButton} disabled={Boolean(busy)} onClick={() => void rerun()}>{busy === 'rerun' ? <LoaderCircle className={styles.spin} /> : <RefreshCw />}Consultar nuevamente</button>}</header>
    {message && <p className={styles.screeningMessage} role="status">{message}</p>}
    {status === 'loading' && <p className={styles.screeningEmpty} role="status"><LoaderCircle className={styles.spin} />Cargando consulta…</p>}
    {status === 'error' && <p className={styles.screeningEmpty} role="alert"><AlertTriangle />No pudimos consultar esta información dentro de tus permisos.</p>}
    {status === 'ready' && !current && <p className={styles.screeningEmpty}><Clock3 />Todavía no existe una consulta nominal para este compareciente.</p>}
    {current && <div className={styles.screeningCurrent}>
      <div className={styles.screeningSummary}><span className={current.execution_state === 'SUCCEEDED' ? styles.screeningOk : styles.screeningPending}>{current.execution_state === 'SUCCEEDED' ? <CheckCircle2 /> : <ShieldCheck />}</span><div><strong>{current.human_status}</strong><small>{technicalLabels[current.execution_state] || current.execution_state} · {new Intl.DateTimeFormat('es-MX', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(current.created_at))}</small></div>{canReport && <button type="button" onClick={() => void report(current.id)} disabled={Boolean(busy)}><FileDown />{busy === `report:${current.id}` ? 'Generando…' : 'Generar reporte'}</button>}</div>
      {current.candidates.length > 0 && <div className={styles.screeningCandidates}>{current.candidates.map((candidate) => <article key={candidate.id}><div><strong>{candidate.display_name}</strong><span>Referencia {candidate.source_record_ref} · similitud {candidate.score ?? 'n/d'}</span><small>{candidate.latest_resolution ? decisionLabels[candidate.latest_resolution.decision] : 'Posible coincidencia · pendiente de revisión humana'}</small></div>{canResolve && <div className={styles.screeningResolution}><label>Motivo de la resolución<textarea value={rationales[candidate.id] || ''} onChange={(event) => setRationales((value) => ({ ...value, [candidate.id]: event.target.value }))} /></label><div>{(Object.keys(decisionLabels) as ScreeningResolutionDecision[]).map((decision) => <button type="button" key={decision} disabled={busy === candidate.id} onClick={() => void resolve(current, candidate.id, decision)}>{decisionLabels[decision]}</button>)}</div></div>}</article>)}</div>}
    </div>}
    {data && data.history.length > 0 && <details className={styles.screeningHistory}><summary><History />Historial de consultas ({data.history.length})</summary><ol>{data.history.map((query) => <li key={query.id}><span>{query.human_status}</span><small>{technicalLabels[query.execution_state]} · {new Intl.DateTimeFormat('es-MX', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(query.created_at))}</small>{canReport && <button type="button" onClick={() => void report(query.id)} disabled={Boolean(busy)}><FileDown />Reporte de consulta</button>}</li>)}</ol></details>}
  </section>;
}
