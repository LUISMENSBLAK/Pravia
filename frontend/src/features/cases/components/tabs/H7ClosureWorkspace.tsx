import { AlertTriangle, CheckCircle2, LoaderCircle, ShieldCheck } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAuth } from '../../../auth/AuthProvider';
import { complianceService, type H7ClosureWorkspace as Workspace } from '../../../compliance/compliance.service';
import { humanComplianceLabel } from '../../../compliance/complianceLabels';
import styles from '../../Expedientes.module.css';
import { activityValueLabel } from '../../expedienteFormatters';
import h7 from './H7ClosureWorkspace.module.css';

const providerOrder = ['LEGAL', 'LST', 'CUE', 'BC', 'PAG', 'DOC', 'FIR'];
const providerLabels: Record<string, string> = {
  LEGAL: 'Evaluación legal y hechos', LST: 'Identificación y consultas nominales', CUE: 'Cuestionarios',
  BC: 'Beneficiario controlador', PAG: 'Pagos', DOC: 'Documental', FIR: 'Firma y avisos',
};
const satisfied = new Set(['CUMPLIDO', 'NO_APLICA']);
type ExceptionDraft = { requirementId: string; reason: string; idempotencyKey: string };

export function H7ClosureWorkspace({ expedienteId }: { expedienteId: string }) {
  const { user } = useAuth();
  const canReview = Boolean(user?.permissions?.includes('compliance.review'));
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [draft, setDraft] = useState<ExceptionDraft | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  const load = useCallback(async (signal?: AbortSignal) => {
    try { setWorkspace(await complianceService.h7Workspace(expedienteId, signal)); setStatus('ready'); }
    catch (error) { if (!(error instanceof DOMException && error.name === 'AbortError')) setStatus('error'); }
  }, [expedienteId]);
  useEffect(() => { const controller = new AbortController(); void load(controller.signal); return () => controller.abort(); }, [load]);

  const groups = useMemo(() => {
    const grouped = new Map<string, Workspace['requirements']>();
    for (const requirement of workspace?.requirements || []) {
      const key = requirement.provider === 'AVI' || requirement.provider === 'FIR' ? 'FIR' : requirement.provider;
      grouped.set(key, [...(grouped.get(key) || []), requirement]);
    }
    return [...grouped.entries()].sort(([left], [right]) => {
      const a = providerOrder.indexOf(left); const b = providerOrder.indexOf(right);
      return (a < 0 ? 99 : a) - (b < 0 ? 99 : b) || left.localeCompare(right);
    });
  }, [workspace]);

  const openException = (requirementId: string) => { setMessage(''); setDraft({ requirementId, reason: '', idempotencyKey: crypto.randomUUID() }); };
  const authorizeException = async () => {
    if (!draft || draft.reason.trim().length < 10) return;
    setBusy(true); setMessage('');
    try {
      await complianceService.h7AuthorizeException(expedienteId, draft.requirementId, { reason: draft.reason.trim(), idempotency_key: draft.idempotencyKey });
      await load(); setDraft(null);
      setMessage('La excepción autorizada quedó registrada sin eliminar el requisito ni su evidencia.');
    } catch (error) { setMessage(error instanceof Error ? error.message : 'No fue posible registrar la excepción.'); }
    finally { setBusy(false); }
  };

  if (status === 'loading') return <section className={`${styles.sectionCard} ${h7.closure}`} aria-label="Cierre de cumplimiento"><p className={styles.sectionEmpty} role="status"><LoaderCircle className={styles.spin} />Calculando el estado canónico…</p></section>;
  if (status === 'error') return <section className={`${styles.sectionCard} ${h7.closure}`} aria-label="Cierre de cumplimiento"><div className={styles.sectionEmpty} role="alert"><p>No pudimos consultar el cierre de cumplimiento.</p><button type="button" onClick={() => { setStatus('loading'); void load(); }}>Reintentar</button></div></section>;
  if (!workspace) return null;
  const complete = workspace.state === 'CUMPLIMIENTO_COMPLETO' || workspace.state === 'NO_APLICA';

  return <section className={`${styles.sectionCard} ${h7.closure}`} aria-labelledby="h7-closure-title">
    <header className={h7.header}><div><span className={h7.eyebrow}>Cierre de cumplimiento</span><h2 id="h7-closure-title">{workspace.state_label}</h2><p>Estado derivado de todos los requisitos aplicables de la evaluación vigente.</p></div><span className={complete ? h7.stateComplete : h7.statePending}>{complete ? <CheckCircle2 /> : <AlertTriangle />}{workspace.state_label}</span></header>
    <div className={h7.metrics}><article><strong>{workspace.pending_count}</strong><span>Pendientes exactos</span></article><article><strong>{workspace.actionable_missing_count}</strong><span>Con acción disponible</span></article><article><strong>{activityValueLabel(workspace.operational_status)}</strong><span>Estado operativo independiente</span></article></div>
    {message && <p className={h7.message} role="status">{message}</p>}
    {groups.length === 0 ? <p className={styles.sectionEmpty}>Aún no existe una evaluación vigente con requisitos aplicables.</p> : <div className={h7.groups}>{groups.map(([provider, requirements]) => <section key={provider} className={h7.group}>
      <header><div><ShieldCheck /><h3>{providerLabels[provider] || `Requisitos ${provider}`}</h3></div><span>{requirements.length}</span></header>
      <div>{requirements.map((requirement) => { const isSatisfied = satisfied.has(requirement.status); const isEditing = draft?.requirementId === requirement.id; return <article key={requirement.id} className={h7.requirement} data-complete={isSatisfied}>
        <span>{isSatisfied ? <CheckCircle2 /> : <AlertTriangle />}</span><div><strong>{requirement.label}</strong><small>{requirement.resolution?.label || humanComplianceLabel(requirement.status, 'Pendiente')}</small>{requirement.resolution && <p>{requirement.resolution.reason}</p>}</div>
        {canReview && (!isSatisfied || requirement.resolution) && !isEditing && <button type="button" onClick={() => openException(requirement.id)}>{requirement.resolution ? 'Actualizar excepción' : 'Resolver excepción'}</button>}
        {isEditing && <div className={h7.exceptionForm}><p>Esta resolución marcará el requisito como no aplicable, conservará su historial y quedará auditada.</p><label htmlFor={`h7-reason-${requirement.id}`}>Motivo de la excepción</label><textarea id={`h7-reason-${requirement.id}`} value={draft.reason} maxLength={1500} onChange={(event) => setDraft({ ...draft, reason: event.target.value })} /><div><button type="button" disabled={busy} onClick={() => setDraft(null)}>Cancelar</button><button type="button" disabled={busy || draft.reason.trim().length < 10} onClick={() => void authorizeException()}>{busy ? 'Registrando…' : 'Confirmar excepción'}</button></div></div>}
      </article>; })}</div>
    </section>)}</div>}
  </section>;
}
