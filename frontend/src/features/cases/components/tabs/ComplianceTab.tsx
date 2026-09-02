import { AlertTriangle, CheckCircle2, ChevronRight, Download, FileArchive, FileCheck2, FileWarning, LoaderCircle, ShieldCheck, Upload } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../../auth/AuthProvider';
import { complianceService } from '../../../compliance/compliance.service';
import type { ComplianceDocumentRequirement, ComplianceDocumentStructure } from '../../../compliance/compliance.types';
import { humanComplianceLabel } from '../../../compliance/complianceLabels';
import type { ExpedienteDetail } from '../../expedientes.types';
import { dateTime } from '../../expedienteFormatters';
import { expedienteReturnParams } from '../../expedienteNavigation';
import styles from '../../Expedientes.module.css';

const evidenceStateLabel: Record<string, string> = {
  CANONICAL: 'Documento canónico', GENERATED: 'Generado · pendiente de firma', SIGNED_UPLOADED: 'Firmado cargado',
  AUTO_LINKED: 'Vinculado automáticamente', PENDING_HUMAN: 'Pendiente de validación humana', VALIDATED: 'Validado', REJECTED: 'Rechazado',
};
const futureActions = new Set(['GO_TO_QUESTIONNAIRE', 'GO_TO_BENEFICIAL_OWNER', 'GO_TO_PAYMENT_EVIDENCE', 'GO_TO_NOTICE']);

export function ComplianceTab({ expediente }: { expediente: ExpedienteDetail }) {
  const reviews = expediente.complianceReviews || [];
  const navigate = useNavigate();
  const { user } = useAuth();
  const returnQuery = expedienteReturnParams(expediente.id, 'cumplimiento');
  const reviewPath = (id: string) => `/riesgos/revisiones/${id}?${returnQuery}`;
  const [documental, setDocumental] = useState<ComplianceDocumentStructure | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [busy, setBusy] = useState<string | null>(null);
  const [showMissing, setShowMissing] = useState(false);
  const [message, setMessage] = useState('');
  const missingRef = useRef<HTMLDivElement | null>(null);
  const canWrite = Boolean(user?.permissions?.includes('compliance.write'));
  const canReview = Boolean(user?.permissions?.includes('compliance.review'));
  const canExport = Boolean(user?.permissions?.includes('documentos.read') && user?.permissions?.includes('compliance.sensitive.read'));

  const load = useCallback(async (signal?: AbortSignal) => {
    try { setDocumental(await complianceService.documentStructure(expediente.id, signal)); setStatus('ready'); }
    catch (error) { if (!(error instanceof DOMException && error.name === 'AbortError')) setStatus('error'); }
  }, [expediente.id]);
  useEffect(() => { const controller = new AbortController(); void load(controller.signal); return () => controller.abort(); }, [load]);

  const revealMissing = () => { setShowMissing(true); window.setTimeout(() => missingRef.current?.focus(), 0); };
  const uploadSigned = async (requirement: ComplianceDocumentRequirement, file?: File) => {
    if (!file) return;
    setBusy(requirement.id); setMessage('');
    try { await complianceService.uploadSignedEvidence(expediente.id, requirement.id, file); await load(); setMessage('El PDF firmado quedó cargado y espera validación humana.'); }
    catch (error) { setMessage(error instanceof Error ? error.message : 'No fue posible cargar el archivo firmado.'); }
    finally { setBusy(null); }
  };
  const validateEvidence = async (evidenceId: string) => {
    setBusy(evidenceId); setMessage('');
    try { await complianceService.validateDocumentEvidence(expediente.id, evidenceId, 'VALIDATED'); await load(); setMessage('La evidencia quedó validada.'); }
    catch (error) { setMessage(error instanceof Error ? error.message : 'No fue posible validar la evidencia.'); }
    finally { setBusy(null); }
  };
  const exportZip = async () => {
    setBusy('export'); setMessage('');
    try {
      const blob = await complianceService.exportDocumentPackage(expediente.id); const url = URL.createObjectURL(blob);
      const link = document.createElement('a'); link.href = url; link.download = `cumplimiento-${expediente.numero_pravia}.zip`; link.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (error) { setMessage(error instanceof Error ? error.message : 'No fue posible exportar el paquete.'); }
    finally { setBusy(null); }
  };
  const requirementAction = (requirement: ComplianceDocumentRequirement) => {
    if (requirement.missing_action === 'GO_TO_COMPARECIENTE') return <button type="button" className={styles.complianceDocumentAction} onClick={() => navigate('#comparecientes')}>Abrir Comparecientes <ChevronRight /></button>;
    if (requirement.missing_action === 'UPLOAD_DOCUMENT') return <button type="button" className={styles.complianceDocumentAction} onClick={() => navigate('#documentos')}>Cargar documento <ChevronRight /></button>;
    if (requirement.missing_action === 'UPLOAD_SIGNED' && canWrite) return <label className={styles.complianceDocumentUpload}><Upload />{busy === requirement.id ? 'Cargando…' : 'Cargar firmado'}<input aria-label={`Cargar PDF firmado para ${requirement.label}`} type="file" accept="application/pdf" disabled={busy === requirement.id} onChange={(event) => void uploadSigned(requirement, event.currentTarget.files?.[0])} /></label>;
    if (futureActions.has(requirement.missing_action)) return <span className={styles.complianceDeferred}>Acción disponible en la fase funcional correspondiente</span>;
    return null;
  };

  return <div className={styles.complianceWorkspace}>
    <section className={styles.sectionCard}>
      <header><div><h2>Cumplimiento</h2><p>Evaluaciones y obligaciones realmente registradas para este expediente.</p></div><button type="button" onClick={() => navigate(`/riesgos?expediente_id=${expediente.id}&${returnQuery}`)}>Abrir Riesgos / UIF <ChevronRight /></button></header>
      {reviews.length ? <div className={styles.complianceList}>{reviews.map((review: any) => { const classification = review.resultado_json?.clasificacion; const attention = ['REQUIERE_AVISO', 'INCOMPLETO', 'INSUMOS_INCOMPLETOS'].includes(classification); return <article key={review.id} role="button" tabIndex={0} onClick={() => navigate(reviewPath(review.id))} onKeyDown={(event) => { if (event.key === 'Enter') navigate(reviewPath(review.id)); }}><span className={attention ? styles.complianceAlert : styles.complianceOk}>{attention ? <AlertTriangle /> : review.estatus === 'CONFIRMADO' ? <CheckCircle2 /> : <ShieldCheck />}</span><div><strong>{review.ruleSet?.nombre || (review.tipo === 'LEGAL_H1' ? 'Evaluación legal' : 'Evaluación de cumplimiento')}</strong><small>{humanComplianceLabel(review.estatus, 'En revisión')} · {dateTime(review.updated_at)}</small></div><b>{attention ? 'Atención' : review.estatus === 'CONFIRMADO' ? 'Confirmado' : 'En revisión'}</b></article>; })}</div> : <p className={styles.sectionEmpty}>No hay evaluaciones de cumplimiento para este expediente.</p>}
    </section>
    <section className={styles.sectionCard} aria-labelledby="compliance-documental-title">
      <header><div><h2 id="compliance-documental-title">Documental de cumplimiento</h2><p>Requisitos aplicables, evidencia estable y preparación previa a firma.</p></div><div className={styles.complianceDocumentHeaderActions}><button type="button" onClick={revealMissing} disabled={status !== 'ready'}><FileWarning />Ver faltantes de Cumplimiento</button>{canExport && <button type="button" onClick={() => void exportZip()} disabled={busy === 'export' || !documental?.groups.length}><Download />{busy === 'export' ? 'Preparando…' : 'Descargar ZIP'}</button>}</div></header>
      {message && <p className={styles.complianceDocumentMessage} role="status">{message}</p>}
      {status === 'loading' && <p className={styles.sectionEmpty} role="status"><LoaderCircle className={styles.spin} />Preparando la estructura documental…</p>}
      {status === 'error' && <div className={styles.sectionEmpty} role="alert"><p>No pudimos consultar el documental de cumplimiento.</p><button type="button" onClick={() => { setStatus('loading'); void load(); }}>Reintentar</button></div>}
      {status === 'ready' && documental && !documental.vulnerable && <p className={styles.sectionEmpty}>La evaluación actual no detecta una actividad vulnerable con estructura documental aplicable.</p>}
      {status === 'ready' && documental?.vulnerable && documental.groups.length === 0 && <p className={styles.sectionEmpty}>La actividad es vulnerable, pero la regla vigente todavía no define requisitos documentales verificables. No se generaron carpetas vacías.</p>}
      {status === 'ready' && documental && documental.groups.map((group) => <section key={group.category} className={styles.complianceDocumentGroup}><div className={styles.complianceDocumentGroupTitle}><FileArchive /><div><h3>{group.label}</h3><span>{group.requirements.length} {group.requirements.length === 1 ? 'requisito' : 'requisitos'}</span></div></div><div className={styles.complianceDocumentGrid}>{group.requirements.map((requirement) => <article key={requirement.id} className={styles.complianceDocumentCard}><div className={styles.complianceDocumentCardTitle}><span className={requirement.status === 'CUMPLIDO' ? styles.complianceOk : styles.complianceAlert}>{requirement.status === 'CUMPLIDO' ? <FileCheck2 /> : <FileWarning />}</span><div><h4>{requirement.label}</h4>{requirement.target_name && <p>{requirement.target_name}</p>}</div><strong>{humanComplianceLabel(requirement.status, 'Pendiente')}</strong></div>{requirement.evidence.length ? <ul className={styles.complianceEvidenceList}>{requirement.evidence.map((evidence) => <li key={evidence.id}><div><b>{evidence.document.nombre_original}</b><span>{evidenceStateLabel[evidence.document_state] || evidence.document_state} · {evidenceStateLabel[evidence.validation_status] || evidence.validation_status}</span><small>Versión estable {evidence.document_version.slice(0, 12)}</small></div>{canReview && evidence.validation_status !== 'VALIDATED' && <button type="button" onClick={() => void validateEvidence(evidence.id)} disabled={busy === evidence.id}>{busy === evidence.id ? 'Validando…' : 'Validar evidencia'}</button>}</li>)}</ul> : <p className={styles.complianceMissingReason}>{requirement.missing_reason}</p>}{requirement.status !== 'CUMPLIDO' && <div className={styles.complianceDocumentFooter}>{requirementAction(requirement)}</div>}</article>)}</div></section>)}
      {showMissing && documental && <div ref={missingRef} tabIndex={-1} className={styles.complianceMissingPanel} aria-live="polite"><h3>Faltantes de Cumplimiento</h3>{documental.missing.length ? <ul>{documental.missing.map((item) => <li key={item.id}><div><strong>{item.label}</strong>{item.target_name && <span>{item.target_name}</span>}<p>{item.missing_reason}</p></div>{requirementAction(item)}</li>)}</ul> : <p>No hay faltantes documentales en la evaluación actual.</p>}</div>}
    </section>
  </div>;
}
