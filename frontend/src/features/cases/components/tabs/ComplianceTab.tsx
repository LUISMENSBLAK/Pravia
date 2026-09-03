import { AlertTriangle, CheckCircle2, ChevronRight, Download, FileArchive, FileCheck2, FileWarning, LoaderCircle, ShieldCheck, Upload } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../../auth/AuthProvider';
import { complianceService, type BeneficialControllerEvaluation, type BeneficialControllerSummary } from '../../../compliance/compliance.service';
import type { ComplianceDocumentRequirement, ComplianceDocumentStructure, ComplianceScreeningOperation } from '../../../compliance/compliance.types';
import { humanComplianceLabel } from '../../../compliance/complianceLabels';
import type { ExpedienteDetail } from '../../expedientes.types';
import { dateTime } from '../../expedienteFormatters';
import { expedienteReturnParams } from '../../expedienteNavigation';
import styles from '../../Expedientes.module.css';

const evidenceStateLabel: Record<string, string> = {
  CANONICAL: 'Documento canónico', GENERATED: 'Generado · pendiente de firma', SIGNED_UPLOADED: 'Firmado cargado',
  AUTO_LINKED: 'Vinculado automáticamente', PENDING_HUMAN: 'Pendiente de validación humana', VALIDATED: 'Validado', REJECTED: 'Rechazado',
};
const futureActions = new Set(['GO_TO_QUESTIONNAIRE', 'GO_TO_PAYMENT_EVIDENCE', 'GO_TO_NOTICE']);
const bcRegimeLabel=(regime:string)=>regime==='LFPIORPI'?'LFPIORPI':'CFF / RMF';
const bcStatusLabel=(status:string)=>status==='NOT_CONFIGURED'?'Regla jurídica no configurada':status==='REQUIRES_REVIEW'?'Requiere revisión humana':status==='EVALUATED'?'Evaluación ejecutada':status==='NOT_APPLICABLE'?'No aplicable según regla verificada':humanComplianceLabel(status,'Revisión requerida');
const bcDeterminationLabel=(value:string)=>humanComplianceLabel(value,value.replaceAll('_',' ').toLocaleLowerCase('es-MX'));

function BeneficialControllerEvaluationCard({evaluation,historical=false,canWrite=false,busy=false,onReevaluate}:{evaluation:BeneficialControllerEvaluation;historical?:boolean;canWrite?:boolean;busy?:boolean;onReevaluate?:(evaluation:BeneficialControllerEvaluation)=>void}){
  if(evaluation.regime==='CFF_RMF'&&evaluation.status==='NOT_APPLICABLE'&&evaluation.rule_set_checksum)return null;
  const complete=evaluation.status==='EVALUATED';
  return <article className={styles.bcEvaluationCard}><span className={complete?styles.complianceOk:styles.complianceAlert}>{complete?<CheckCircle2/>:<ShieldCheck/>}</span><div><div className={styles.bcEvaluationTitle}><strong>{bcRegimeLabel(evaluation.regime)}{evaluation.target_name&&` · ${evaluation.target_name}`}</strong>{historical&&<em>Histórica</em>}{evaluation.reevaluation_required&&<em>Reevaluación requerida</em>}</div><small>{bcStatusLabel(evaluation.status)} · estructura v{evaluation.snapshot.structure_revision} · snapshot inmutable</small>{evaluation.snapshot.incomplete_markers.length>0&&<p>{evaluation.snapshot.incomplete_markers.length} señales de estructura incompleta</p>}{evaluation.results.length>0&&<ul>{evaluation.results.map(result=><li key={result.id}>{result.subject_path?<a href={result.subject_path}>{result.subject_name}</a>:<strong>{result.subject_name||'Identidad pendiente de revisión'}</strong>} · {bcDeterminationLabel(result.determination)}{!result.subject_compareciente_id&&' · dato estructurado'}</li>)}</ul>}
    <div className={styles.bcActions}>{evaluation.structure_path&&<a href={evaluation.structure_path}>Ir a Persona Moral / Estructura</a>}{(evaluation.supports||[]).map(support=><a key={support.document_id} href={support.path}>Ver soporte en ficha documental: {support.label}</a>)}{!historical&&evaluation.reevaluation_required&&canWrite&&onReevaluate&&<button type="button" disabled={busy} onClick={()=>onReevaluate(evaluation)}>Reevaluar cumplimiento</button>}</div>
  </div><b>{complete?`${evaluation.results.length} resultado${evaluation.results.length===1?'':'s'}`:'Pendiente'}</b></article>;
}

export function ComplianceTab({ expediente }: { expediente: ExpedienteDetail }) {
  const reviews = expediente.complianceReviews || [];
  const navigate = useNavigate();
  const { user } = useAuth();
  const returnQuery = expedienteReturnParams(expediente.id, 'cumplimiento');
  const reviewPath = (id: string) => `/riesgos/revisiones/${id}?${returnQuery}`;
  const [documental, setDocumental] = useState<ComplianceDocumentStructure | null>(null);
  const [screening, setScreening] = useState<ComplianceScreeningOperation | null>(null);
  const [beneficialController, setBeneficialController] = useState<BeneficialControllerSummary|null>(null);
  const [beneficialControllerStatus, setBeneficialControllerStatus] = useState<'loading'|'ready'|'error'>('loading');
  const [screeningStatus, setScreeningStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [busy, setBusy] = useState<string | null>(null);
  const [showMissing, setShowMissing] = useState(false);
  const [message, setMessage] = useState('');
  const [reevaluate, setReevaluate] = useState<BeneficialControllerEvaluation|null>(null);
  const [legalDate, setLegalDate] = useState('');
  const missingRef = useRef<HTMLDivElement | null>(null);
  const canWrite = Boolean(user?.permissions?.includes('compliance.write'));
  const canReview = Boolean(user?.permissions?.includes('compliance.review'));
  const canExport = Boolean(user?.permissions?.includes('documentos.read') && user?.permissions?.includes('compliance.sensitive.read'));
  const canReadScreening = Boolean(user?.permissions?.includes('expedientes.read') && user?.permissions?.includes('compliance.read') && user?.permissions?.includes('compliance.sensitive.read'));

  const load = useCallback(async (signal?: AbortSignal) => {
    try { setDocumental(await complianceService.documentStructure(expediente.id, signal)); setStatus('ready'); }
    catch (error) { if (!(error instanceof DOMException && error.name === 'AbortError')) setStatus('error'); }
  }, [expediente.id]);
  useEffect(() => { const controller = new AbortController(); void load(controller.signal); return () => controller.abort(); }, [load]);
  useEffect(() => {
    if (!canReadScreening) { setScreening(null); setScreeningStatus('idle'); return; }
    const controller = new AbortController(); setScreeningStatus('loading');
    void complianceService.screeningOperation(expediente.id, controller.signal).then((result) => { setScreening(result); setScreeningStatus('ready'); }).catch((error) => { if (!(error instanceof DOMException && error.name === 'AbortError')) setScreeningStatus('error'); });
    return () => controller.abort();
  }, [canReadScreening, expediente.id]);
  useEffect(()=>{const controller=new AbortController();setBeneficialControllerStatus('loading');void complianceService.beneficialController(expediente.id,controller.signal).then(result=>{setBeneficialController(result);setBeneficialControllerStatus('ready')}).catch(error=>{if(!(error instanceof DOMException&&error.name==='AbortError'))setBeneficialControllerStatus('error')});return()=>controller.abort()},[expediente.id]);

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
    if (requirement.missing_action === 'GO_TO_BENEFICIAL_OWNER') return <button type="button" className={styles.complianceDocumentAction} onClick={() => document.getElementById('beneficial-controller-title')?.scrollIntoView({block:'start'})}>Revisar beneficiario controlador <ChevronRight /></button>;
    if (requirement.missing_action === 'GO_TO_COMPARECIENTE') return <button type="button" className={styles.complianceDocumentAction} onClick={() => navigate('#comparecientes')}>Abrir Comparecientes <ChevronRight /></button>;
    if (requirement.missing_action === 'UPLOAD_DOCUMENT') return <button type="button" className={styles.complianceDocumentAction} onClick={() => navigate('#documentos')}>Cargar documento <ChevronRight /></button>;
    if (requirement.missing_action === 'UPLOAD_SIGNED' && canWrite) return <label className={styles.complianceDocumentUpload}><Upload />{busy === requirement.id ? 'Cargando…' : 'Cargar firmado'}<input aria-label={`Cargar PDF firmado para ${requirement.label}`} type="file" accept="application/pdf" disabled={busy === requirement.id} onChange={(event) => void uploadSigned(requirement, event.currentTarget.files?.[0])} /></label>;
    if (futureActions.has(requirement.missing_action)) return <span className={styles.complianceDeferred}>Acción disponible en la fase funcional correspondiente</span>;
    return null;
  };

  return <div className={styles.complianceWorkspace}>
    <section className={styles.sectionCard} aria-labelledby="beneficial-controller-title">
      <header><div><h2 id="beneficial-controller-title">Beneficiario controlador</h2><p>Estructura congelada por evaluación y conclusiones separadas por régimen jurídico.</p></div></header>
      {beneficialControllerStatus==='loading'&&<p className={styles.sectionEmpty} role="status"><LoaderCircle className={styles.spin}/>Consultando estructuras…</p>}
      {beneficialControllerStatus==='error'&&<p className={styles.sectionEmpty} role="alert">No pudimos consultar esta sección dentro de tus permisos.</p>}
      {beneficialControllerStatus==='ready'&&beneficialController?.evaluations.length===0&&<p className={styles.sectionEmpty}>Aún no existe una evaluación explícita de beneficiario controlador para este expediente.</p>}
      {beneficialControllerStatus==='ready'&&beneficialController&&beneficialController.evaluations.length>0&&<div className={styles.complianceList}>{beneficialController.evaluations.map(evaluation=><BeneficialControllerEvaluationCard key={evaluation.id} evaluation={evaluation} canWrite={canWrite} busy={busy==='bc-evaluate'} onReevaluate={item=>{setReevaluate(item);setLegalDate(item.legal_date?.slice(0,10)||'')}}/>)}</div>}
      {reevaluate&&canWrite&&<section className={styles.bcReevaluate} aria-label="Confirmar reevaluación"><p>Se evaluarán los hechos y requisitos actuales mediante el motor canónico. Confirma la fecha jurídica aplicable; el historial se conservará.</p><label>Fecha jurídica<input aria-label="Fecha jurídica de reevaluación" type="date" value={legalDate} onChange={event=>setLegalDate(event.target.value)}/></label><button type="button" disabled={Boolean(busy)} onClick={()=>setReevaluate(null)}>Cancelar reevaluación</button><button type="button" disabled={Boolean(busy)||!legalDate} onClick={()=>{setBusy('bc-evaluate');setMessage('');void complianceService.evaluateLegalCase(expediente.id,{idempotency_key:crypto.randomUUID(),fecha_juridica_confirmada:legalDate}).then(async()=>{setBeneficialController(await complianceService.beneficialController(expediente.id));await load();setReevaluate(null);setMessage('Cumplimiento reevaluado desde los requisitos actuales.')}).catch(error=>setMessage(error instanceof Error?error.message:'No fue posible reevaluar.')).finally(()=>setBusy(null))}}>Confirmar y reevaluar</button></section>}
      {beneficialControllerStatus==='ready'&&beneficialController&&!beneficialController.configured_legal_rules&&<p className={styles.complianceDocumentMessage}>No hay reglas legales activadas para esta materia. El sistema conserva los hechos sin inferir una conclusión.</p>}
      {beneficialControllerStatus==='ready'&&beneficialController&&beneficialController.history.length>0&&<details className={styles.bcHistory}><summary>Ver historial de evaluaciones ({beneficialController.history.length})</summary><div className={styles.complianceList}>{beneficialController.history.map(evaluation=><BeneficialControllerEvaluationCard key={evaluation.id} evaluation={evaluation} historical/>)}</div></details>}
    </section>
    {canReadScreening && <section className={styles.sectionCard} aria-labelledby="operation-screening-title">
      <header><div><h2 id="operation-screening-title">Consulta nominal de la operación</h2><p>Estado de las consultas vinculadas a las partes de esta operación.</p></div></header>
      {screeningStatus === 'loading' && <p className={styles.sectionEmpty} role="status"><LoaderCircle className={styles.spin} />Consultando estados…</p>}
      {screeningStatus === 'error' && <p className={styles.sectionEmpty} role="alert">No pudimos consultar los estados nominales dentro de tus permisos.</p>}
      {screeningStatus === 'ready' && !screening?.data.length && <p className={styles.sectionEmpty}>No hay obligaciones de consulta nominal vinculadas a esta operación.</p>}
      {screeningStatus === 'ready' && screening && screening.data.length > 0 && <div className={styles.screeningOperationList}>{screening.data.map((row) => <article key={row.requirement.id}><span className={row.requirement.status === 'CUMPLIDO' ? styles.complianceOk : styles.complianceAlert}>{row.requirement.status === 'CUMPLIDO' ? <CheckCircle2 /> : <ShieldCheck />}</span><div><strong>{row.requirement.target_name || row.requirement.label}</strong><small>{humanComplianceLabel(row.requirement.status, 'Pendiente')} · {row.query ? humanComplianceLabel(row.query.execution_state, 'Consulta pendiente') : 'Consulta pendiente'}</small>{row.snapshot && <em>Snapshot vinculado · {row.snapshot.unresolved_count} pendiente{row.snapshot.unresolved_count === 1 ? '' : 's'} de resolución</em>}</div>{row.action && <button type="button" onClick={() => navigate(`${row.action!.split('#')[0]}?${returnQuery}#screening`)}>Abrir ficha <ChevronRight /></button>}</article>)}</div>}
    </section>}
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
