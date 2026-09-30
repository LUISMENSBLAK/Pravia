import { CircleCheck, Download, Eye, FilePenLine, FileSearch, FileStack, LoaderCircle, Plus, Settings2, Sparkles, Trash2, TriangleAlert, Upload } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { DocumentViewer } from '../../../../components/documents/DocumentViewer';
import { AIProcessingStatus } from '../../../../components/feedback/AIProcessingStatus';
import { ApiError } from '../../../../services/api/client';
import { useAuth } from '../../../auth/AuthProvider';
import { dateTime } from '../../expedienteFormatters';
import { expedientesService } from '../../expedientes.service';
import type { ExpedienteDetail, ProjectGenerationResult, ProjectState, ProjectVersion, ProjectWorkspace } from '../../expedientes.types';
import styles from '../../Expedientes.module.css';

const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const observationLabel = (kind: string) => ({
  CONTRADICTION: 'Contradicción documental', POSSIBLE_TEMPLATE_RESIDUE: 'Posible dato residual del machote', CONTEXT_CHRONOLOGY: 'Cronología de antecedentes',
}[kind] || 'Observación de generación');
type PreviewState = { open: boolean; loading: boolean; url?: string; error?: string; version?: ProjectVersion };

export function ProjectTab({ expediente, project, onChanged }: { expediente: ExpedienteDetail; project: ProjectState | null; onChanged(): void }) {
  const { user } = useAuth();
  const reviewInput = useRef<HTMLInputElement>(null);
  const templateInput = useRef<HTMLInputElement>(null);
  const [workspace, setWorkspace] = useState<ProjectWorkspace | null>(null);
  const [templateVersionId, setTemplateVersionId] = useState('');
  const [instructions, setInstructions] = useState('');
  const [selectedSourceIds, setSelectedSourceIds] = useState<string[]>([]);
  const [manualTemplate, setManualTemplate] = useState<File>();
  const [reviewOpen, setReviewOpen] = useState(false);
  const [busy, setBusy] = useState<'GENERATE' | 'APPLY' | 'UPLOAD' | 'REVIEW' | null>(null);
  const [patches, setPatches] = useState<Array<{ find: string; replace: string }>>([{ find: '', replace: '' }]);
  const [authorizeLearning, setAuthorizeLearning] = useState(false);
  const [learningScope, setLearningScope] = useState<'EXPEDIENTE' | 'TIPO_ACTO' | 'NOTARIA' | 'BANCO' | 'JURISDICCION' | 'ORGANIZACION'>('EXPEDIENTE');
  const [savingTemplate, setSavingTemplate] = useState<string | null>(null);
  const [promotionActId, setPromotionActId] = useState('');
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [result, setResult] = useState<ProjectGenerationResult | null>(null);
  const [preview, setPreview] = useState<PreviewState>({ open: false, loading: false });
  const permissions = user?.permissions;
  const allowed = (...required: string[]) => !permissions || required.every((permission) => permissions.includes(permission as never));
  const canGenerate = allowed('expedientes.write', 'documentos.write', 'ia.execute');
  const canReview = allowed('documentos.write', 'ia.execute');
  const canSaveTemplate = Boolean(permissions?.includes('configuracion.plantillas_formatos.manage'));
  const canAuthorizeLearning = Boolean(permissions?.includes('configuracion.manage'));
  const versions = project ? ([project.vigente, ...project.historial].filter(Boolean) as ProjectVersion[]) : [];
  const report = project?.ultimoReporte || null;

  useEffect(() => {
    const controller = new AbortController();
    expedientesService.projectWorkspace(expediente.id, controller.signal).then((next) => {
      setWorkspace(next);
      setPromotionActId(next.expediente.acts[0]?.id || '');
      setTemplateVersionId(next.suggested_template?.version_id || next.templates.find((item) => item.default)?.versions[0]?.id || next.templates[0]?.versions[0]?.id || '');
      setSelectedSourceIds(next.sources.documents.filter((item) => item.selected_by_default).map((item) => item.documento.id));
    }).catch((reason) => { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : 'No fue posible preparar Proyecto.'); });
    return () => controller.abort();
  }, [expediente.id]);

  useEffect(() => {
    window.dispatchEvent(new CustomEvent('pravia:assistant-project-draft', { detail: { instructions, templateVersionId, sourceDocumentIds: selectedSourceIds } }));
    return () => { window.dispatchEvent(new CustomEvent('pravia:assistant-project-draft')); };
  }, [instructions, selectedSourceIds, templateVersionId]);
  useEffect(() => {
    const openOptions = (event: Event) => {
      const detail = (event as CustomEvent<'sources' | 'template'>).detail;
      const advanced = document.getElementById('project-advanced-options');
      if (advanced instanceof HTMLDetailsElement) advanced.open = true;
      if (detail === 'sources') {
        const sources = document.getElementById('project-source-options');
        if (sources instanceof HTMLDetailsElement) sources.open = true;
      }
      requestAnimationFrame(() => advanced?.querySelector<HTMLElement>('summary')?.focus());
    };
    window.addEventListener('pravia:project-options', openOptions);
    return () => window.removeEventListener('pravia:project-options', openOptions);
  }, []);
  useEffect(() => () => { if (preview.url) URL.revokeObjectURL(preview.url); }, [preview.url]);

  const selectedTemplate = workspace?.templates.flatMap((artifact) => artifact.versions.map((version) => ({ artifact, version }))).find((item) => item.version.id === templateVersionId);
  const selectedTemplateLabel = manualTemplate ? `${manualTemplate.name} · exclusivo para esta proyección`
    : selectedTemplate ? `${selectedTemplate.artifact.name} · v${selectedTemplate.version.version}`
      : workspace?.suggested_template ? `${workspace.suggested_template.name} · v${workspace.suggested_template.version}` : 'Sin machote aplicable';

  const generate = async () => {
    setBusy('GENERATE'); setError(''); setNotice(''); setResult(null);
    try {
      const next = manualTemplate
        ? await expedientesService.generateProjectFromTemplate(expediente.id, manualTemplate, { instructions, sourceDocumentIds: selectedSourceIds })
        : await expedientesService.generateProject(expediente.id, { templateVersionId, instructions, sourceDocumentIds: selectedSourceIds });
      setResult(next); setNotice('Proyecto generado y persistido. La revisión automática terminó sin modificar silenciosamente el documento.'); onChanged();
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'No fue posible proyectar la escritura. Revisa el expediente y el machote e intenta de nuevo.'); }
    finally { setBusy(null); }
  };
  const upload = async (file?: File) => {
    if (!file) return; setBusy('UPLOAD'); setError(''); setNotice('');
    try { await expedientesService.uploadProject(expediente.id, file, 'Nueva versión para revisión notarial'); setNotice('La versión quedó cargada y disponible para revisión.'); onChanged(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'No fue posible cargar la versión.'); }
    finally { setBusy(null); if (reviewInput.current) reviewInput.current.value = ''; }
  };
  const review = async () => {
    setBusy('REVIEW'); setError(''); setNotice('');
    try { await expedientesService.reviewProject(expediente.id); setNotice('Revisión terminada. Las observaciones quedaron separadas y no modificaron el proyecto.'); onChanged(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'No fue posible revisar el proyecto.'); }
    finally { setBusy(null); }
  };
  const applyInstructions = async () => {
    setBusy('APPLY'); setError(''); setNotice('');
    try {
      await expedientesService.applyProjectInstructions(expediente.id, { instructions, patches, authorize_learning: authorizeLearning, learning_scope: learningScope, learning_content: authorizeLearning ? instructions : undefined });
      setNotice(authorizeLearning ? 'Indicaciones aplicadas y criterio interno guardado con autorización expresa.' : 'Indicaciones aplicadas en una nueva versión. La versión anterior permanece intacta.');
      setPatches([{ find: '', replace: '' }]); setAuthorizeLearning(false); onChanged();
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'No fue posible aplicar las indicaciones.'); }
    finally { setBusy(null); }
  };
  const openPreview = async (version: ProjectVersion) => {
    if (preview.url) URL.revokeObjectURL(preview.url); setPreview({ open: true, loading: true, version });
    try { setPreview({ open: true, loading: false, version, url: await expedientesService.projectPreviewUrl(expediente.id, version.id) }); }
    catch (reason) { setPreview({ open: true, loading: false, version, error: reason instanceof Error ? reason.message : 'No fue posible abrir la vista previa.' }); }
  };
  const saveAsTemplate = async (version: ProjectVersion) => {
    if (!promotionActId) { setError('Selecciona el Acto real al que se asignará este machote.'); return; }
    setSavingTemplate(version.id); setNotice(''); setError('');
    try {
      await expedientesService.saveProjectAsNotaryTemplate(expediente.id, version.id, { act_id: promotionActId });
      setNotice('Machote maestro registrado para el Acto seleccionado.');
    } catch (reason) {
      const code = reason instanceof ApiError && reason.payload && typeof reason.payload === 'object' ? String((reason.payload as { code?: string }).code || '') : '';
      const message = reason instanceof Error ? reason.message : 'No fue posible registrar esta versión como machote maestro.';
      if (code === 'PROJECT_TEMPLATE_CONFLICT' && window.confirm(`${message}\n\n¿Deseas reemplazar el machote maestro actual?`)) {
        await expedientesService.saveProjectAsNotaryTemplate(expediente.id, version.id, { act_id: promotionActId, replace: true });
        setNotice('El machote maestro anterior fue reemplazado; su histórico se conserva.');
      } else setError(message);
    }
    finally { setSavingTemplate(null); }
  };
  const updateLifecycle = async (version: ProjectVersion, action: 'MARCAR_FINAL' | 'REABRIR') => {
    setBusy('UPLOAD'); setNotice(''); setError('');
    try {
      await expedientesService.updateProjectVersion(expediente.id, version.id, { accion: action });
      setNotice(action === 'MARCAR_FINAL' ? 'Proyecto validado. PRAVIA IA no podrá alterarlo sin una reapertura explícita.' : 'Proyecto reabierto en una versión nueva; la versión validada permanece intacta.');
      onChanged();
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'No fue posible actualizar el ciclo del proyecto.'); }
    finally { setBusy(null); }
  };

  return <div className={styles.projectWorkspace}>
    <section className={`${styles.sectionCard} ${styles.projectPrimaryCard}`}>
      <header><div><h2>Proyecto de escritura</h2><p>PRAVIA utilizará automáticamente el machote correspondiente, la información del expediente y sus documentos vinculados.</p></div></header>
      {notice && <p className={styles.notice} role="status">{notice}</p>}{error && <p className={styles.error} role="alert">{error}</p>}
      <div className={styles.projectEasyFlow}>
        <div className={styles.projectSuggestedTemplate}><span>Machote</span><strong>{selectedTemplateLabel}</strong>{workspace && workspace.pending_detectable_count > 0 && <small>{workspace.pending_detectable_count} dato(s) detectable(s) podrían quedar marcados como [PENDIENTE].</small>}</div>
        <label className={styles.projectInstructions}>Indicaciones para la proyección <span>(opcional)</span><textarea rows={4} value={instructions} onChange={(event) => setInstructions(event.target.value)} placeholder="Escribe aquí cualquier indicación especial para este proyecto." maxLength={4000}/><small>Por ejemplo: poner especial atención al antecedente de subdivisión o conservar literalmente una cláusula determinada.</small></label>
        <button className={`${styles.primaryButton} ${styles.projectPrimaryAction}`} type="button" disabled={!canGenerate || busy !== null || (!manualTemplate && !templateVersionId)} onClick={() => void generate()}>{busy === 'GENERATE' ? <LoaderCircle className={styles.spin} aria-hidden="true"/> : <Sparkles aria-hidden="true"/>}{busy === 'GENERATE' ? 'Preparando proyecto…' : 'PROYECTAR CON IA'}</button>
        {busy === 'GENERATE' && <AIProcessingStatus label="Proyectando escritura con IA" detail="Integrando expediente, documentos seleccionados y machote sin alterar su estructura; después se ejecutará la revisión final."/>}
        {!canGenerate && <p className={styles.projectPermissionNote}>Tu función actual no permite generar proyectos.</p>}
        <details id="project-advanced-options" className={styles.projectAdvanced}><summary><Settings2 aria-hidden="true"/>Opciones avanzadas</summary><div className={styles.projectAdvancedBody}>
          <label>Cambiar machote<select value={templateVersionId} disabled={Boolean(manualTemplate)} onChange={(event) => { setTemplateVersionId(event.target.value); setManualTemplate(undefined); }}><option value="">Resolver machote sugerido</option>{workspace?.templates.flatMap((item) => item.versions.map((version) => <option key={version.id} value={version.id}>{item.name} · v{version.version}{item.default ? ' · sugerido' : ''}</option>))}</select></label>
          <input ref={templateInput} className={styles.srOnly} type="file" accept=".docx" onChange={(event) => { const file = event.target.files?.[0]; if (file) setManualTemplate(file); }}/>
          <div className={styles.projectManualTemplate}><button className={styles.secondaryButton} type="button" disabled={!canGenerate || busy !== null} onClick={() => templateInput.current?.click()}><Upload aria-hidden="true"/>Cargar machote DOCX exclusivo</button>{manualTemplate && <p><strong>{manualTemplate.name}</strong><button type="button" onClick={() => { setManualTemplate(undefined); if (templateInput.current) templateInput.current.value = ''; }}>Retirar</button></p>}</div>
          <details id="project-source-options" className={styles.projectSources}><summary><Settings2 aria-hidden="true"/>Ver / ajustar fuentes <small>{selectedSourceIds.length} seleccionada(s)</small></summary><p>Los datos estructurados siempre se incluyen. Selecciona documentos vigentes relevantes para esta proyección.</p><div>{workspace?.sources.documents.map((source) => <label key={source.documento.id}><input type="checkbox" checked={selectedSourceIds.includes(source.documento.id)} onChange={(event) => setSelectedSourceIds((current) => event.target.checked ? [...new Set([...current, source.documento.id])] : current.filter((id) => id !== source.documento.id))}/><span><strong>{source.documento.nombre_original}</strong><small>{source.tipo_vinculo}{source.source_context ? ` · ${source.source_context}` : ''}</small></span></label>)}</div>{workspace && !workspace.sources.documents.length && <p>No hay documentos fuente vigentes vinculados.</p>}</details>
        </div></details>
      </div>
    </section>

    {result && <section className={`${styles.sectionCard} ${styles.projectResultCard}`} aria-label="Proyecto generado"><header><div><span className={styles.projectResultEyebrow}><CircleCheck aria-hidden="true"/>Proyecto generado</span><h2>Versión {result.version.version_numero}</h2><p>La nueva versión quedó persistida y lista para revisión profesional.</p></div></header><dl><div><dt>Machote</dt><dd>{result.template.name || selectedTemplateLabel}{result.template.version ? ` · v${result.template.version}` : ''}</dd></div><div><dt>Pendientes</dt><dd>{result.pending_count}</dd></div><div><dt>Observaciones</dt><dd>{result.generation_observation_count + result.residual_observation_count}</dd></div><div><dt>Críticas</dt><dd>{result.critical_count}</dd></div></dl><div className={styles.projectResultActions}><button className={styles.primaryButton} type="button" onClick={() => void openPreview(result.version)}><Eye aria-hidden="true"/>Ver proyecto</button><button className={styles.secondaryButton} type="button" onClick={() => document.getElementById('project-observations')?.scrollIntoView({ behavior: 'smooth' })}><TriangleAlert aria-hidden="true"/>Revisar observaciones</button><button className={styles.secondaryButton} type="button" onClick={() => void expedientesService.downloadProject(expediente.id, result.version.id, result.version.nombre_original || `proyecto-v${result.version.version_numero}.docx`)}><Download aria-hidden="true"/>Descargar Word</button></div></section>}

    {project?.vigente && <section className={`${styles.sectionCard} ${styles.projectInstructionCard}`} aria-label="Aplicar indicaciones a la versión vigente"><header><div><h2>Aplicar indicaciones</h2><p>Corrige únicamente textos inequívocos de la versión {project.vigente.version_numero}. PRAVIA creará una versión nueva y conservará la anterior.</p></div></header><div className={styles.projectPatchList}>{patches.map((patch, index) => <div key={index}><label>Texto actual<input value={patch.find} onChange={(event) => setPatches((current) => current.map((item, row) => row === index ? { ...item, find: event.target.value } : item))} placeholder="Texto exacto en el proyecto" /></label><label>Texto corregido<input value={patch.replace} onChange={(event) => setPatches((current) => current.map((item, row) => row === index ? { ...item, replace: event.target.value } : item))} placeholder="Reemplazo autorizado" /></label><button type="button" aria-label={`Eliminar corrección ${index + 1}`} disabled={patches.length === 1} onClick={() => setPatches((current) => current.filter((_, row) => row !== index))}><Trash2 /></button></div>)}</div>{canAuthorizeLearning && <div className={styles.projectLearningControl}><label><input type="checkbox" checked={authorizeLearning} onChange={(event) => setAuthorizeLearning(event.target.checked)}/>Autorizar expresamente que esta indicación se guarde como criterio interno reutilizable</label>{authorizeLearning && <label>Alcance<select value={learningScope} onChange={(event) => setLearningScope(event.target.value as typeof learningScope)}><option value="EXPEDIENTE">Solo este expediente</option><option value="TIPO_ACTO">Este tipo de acto</option><option value="NOTARIA">Esta notaría</option><option value="BANCO">Este banco</option><option value="JURISDICCION">Esta jurisdicción</option><option value="ORGANIZACION">Toda la organización</option></select></label>}</div>}<div className={styles.projectInstructionActions}><button className={styles.secondaryButton} type="button" onClick={() => setPatches((current) => [...current, { find: '', replace: '' }])} disabled={patches.length >= 25 || busy !== null}><Plus />Agregar corrección</button><button className={styles.primaryButton} type="button" onClick={() => void applyInstructions()} disabled={!canGenerate || busy !== null || !instructions.trim() || patches.some((patch) => !patch.find.trim() || !patch.replace.trim())}>{busy === 'APPLY' ? <LoaderCircle className={styles.spin} /> : <FilePenLine />}APLICAR INDICACIONES</button></div></section>}

    <section className={`${styles.sectionCard} ${styles.projectReviewCard}`}><header><div><h2>¿Ya tienes un proyecto?</h2><p>Carga o selecciona un Word existente para que PRAVIA lo revise sin modificarlo automáticamente.</p></div><button className={styles.secondaryButton} type="button" aria-expanded={reviewOpen} onClick={() => setReviewOpen((current) => !current)}><FileSearch aria-hidden="true"/>REVISAR PROYECTO</button></header>{reviewOpen && <div className={styles.projectReviewBody}><input ref={reviewInput} className={styles.srOnly} type="file" accept=".docx" onChange={(event) => void upload(event.target.files?.[0])}/><button className={styles.secondaryButton} type="button" disabled={!canReview || busy !== null} onClick={() => reviewInput.current?.click()}><Upload aria-hidden="true"/>{busy === 'UPLOAD' ? 'Cargando…' : 'Cargar nueva versión'}</button><button className={styles.secondaryButton} type="button" disabled={!canReview || busy !== null || !project?.vigente} onClick={() => void review()}>{busy === 'REVIEW' ? <LoaderCircle className={styles.spin} aria-hidden="true"/> : <FileSearch aria-hidden="true"/>}Revisar versión vigente</button></div>}</section>

    {project?.vigente?.fact_snapshot && <details className={`${styles.sectionCard} ${styles.projectFactSheet}`}><summary><FileSearch aria-hidden="true"/><span><strong>Ver fuentes de los datos</strong><small>Ficha de hechos congelada de la versión {project.vigente.version_numero}</small></span><b>{project.vigente.fact_snapshot.facts.length} dato(s)</b></summary><div className={styles.projectFactGrid}>{project.vigente.fact_snapshot.facts.map((fact) => <article key={fact.field} data-status={fact.status}><header><code>{fact.field}</code><span>{fact.mutability === 'FIJO' ? 'Fijo' : 'Variable'} · {fact.status === 'CONFIRMADO' ? 'Confirmado' : fact.status === 'PENDIENTE' ? 'Pendiente' : 'Conflicto'}</span></header><p>{fact.value}</p><footer><strong>Procedencia:</strong> {fact.provenance.type === 'USER_CONFIRMED' ? 'Confirmación humana autorizada' : fact.provenance.type === 'STRUCTURED_AND_DOCUMENTARY' ? 'Maestros PRAVIA + documentos seleccionados' : 'Maestros estructurados PRAVIA'}{fact.provenance.document_ids.length > 0 && ` · ${fact.provenance.document_ids.length} documento(s)`}</footer></article>)}</div></details>}

    {project?.vigente && (Number(project.vigente.pending_count || 0) > 0 || Boolean(project.vigente.generation_observations?.length)) && <section id="project-observations" className={styles.sectionCard} aria-label="Observaciones automáticas de generación"><header><div><h2>Observaciones de generación</h2><p>Proyecto V{project.vigente.version_numero} · estos pendientes y observaciones pertenecen exclusivamente a esta versión.</p></div></header>{Number(project.vigente.pending_count || 0) > 0 && <div className={styles.projectReviewSummary}><TriangleAlert aria-hidden="true"/><div><strong>{project.vigente.pending_count} pendiente(s) explícito(s) dentro del proyecto</strong><p>Se conservaron como pendientes para revisión humana; PRAVIA no inventó ni los marcó como resueltos.</p></div></div>}{Boolean(project.vigente.generation_observations?.length) && <><div className={styles.projectReviewSummary}><TriangleAlert aria-hidden="true"/><div><strong>{project.vigente.generation_observations!.length} observación(es) para revisión humana</strong><p>El machote no fue modificado automáticamente para resolverlas.</p></div></div><div className={styles.projectObservations}>{project.vigente.generation_observations!.map((observation, index) => <article key={`${observation.kind}-${index}`} data-risk="MEDIO"><header><strong>OBSERVACIÓN {String(index + 1).padStart(2, '0')}</strong><span>{observationLabel(observation.kind)}</span></header><dl>{observation.field && <div><dt>Campo</dt><dd>{observation.field}</dd></div>}{observation.master_value && <div><dt>Dato maestro</dt><dd>{observation.master_value}</dd></div>}{observation.document_value && <div><dt>Dato documental</dt><dd>{observation.document_value}</dd></div>}{observation.value && <div><dt>Valor detectado</dt><dd>{observation.value}</dd></div>}<div><dt>Ubicación / detalle</dt><dd>{observation.location || observation.detail || 'Requiere revisión humana.'}</dd></div></dl></article>)}</div></>}</section>}

    {report && <section className={styles.sectionCard} aria-label="Resultado de la revisión notarial"><header><div><h2>Resultado de la revisión</h2><p>Proyecto V{report.proyecto_version_numero} · {report.documentos_analizados_count} de {report.documentos_totales_count} fuentes analizadas · {dateTime(report.created_at)}</p></div><button className={styles.secondaryButton} type="button" onClick={() => void expedientesService.downloadProjectReport(expediente.id, report.nombre_reporte)}><Download aria-hidden="true"/>Descargar reporte</button></header><div className={styles.projectReviewSummary}>{report.observaciones.length ? <><TriangleAlert aria-hidden="true"/><div><strong>{report.observaciones.length} observación(es) para revisión humana</strong><p>Las observaciones no modifican el Word.</p></div></> : <><CircleCheck aria-hidden="true"/><div><strong>Sin discrepancias comprobables</strong><p>El resultado no sustituye la revisión profesional del abogado y del Notario.</p></div></>}</div>{report.areas_revision?.length > 0 && <div className={styles.projectReviewAreas} aria-label="Cobertura de 17 áreas"><h3>Cobertura de las 17 áreas</h3><ol>{report.areas_revision.map((area) => <li key={area.area} data-status={area.estado}><div><strong>{area.etiqueta}</strong><span>{area.estado === 'REVISADO_SIN_HALLAZGOS' ? 'Revisado sin hallazgos' : area.estado === 'HALLAZGOS' ? `${area.hallazgos} hallazgo(s)` : 'No verificable'}</span></div><p>{area.resumen}</p></li>)}</ol></div>}{report.documentos_no_leidos.length > 0 && <><p className={styles.projectUnreadSources}><strong>Fuentes no leídas:</strong> {report.documentos_no_leidos.join(', ')}</p>{report.documentos_no_leidos.some((name) => /\.doc$/i.test(name)) && <p className={styles.projectUnreadSources}><strong>Formato .DOC antiguo:</strong> el original se conserva con trazabilidad, pero requiere revisión manual o una copia validada en .DOCX o PDF. PRAVIA no lo marca como leído.</p>}</>}{report.observaciones.length > 0 && <div className={styles.projectObservations}>{report.observaciones.map((observation) => <article key={observation.id} data-risk={observation.nivel_riesgo}><header><strong>{observation.titulo}</strong><span>{observation.tipo_discrepancia.replaceAll('_', ' ')}</span></header><dl><div><dt>Proyecto</dt><dd>{observation.dato_proyecto}</dd></div><div><dt>Fuente</dt><dd>{observation.dato_fuente}</dd></div><div><dt>Documento y ubicación</dt><dd>{observation.documento_fuente} · {observation.ubicacion}</dd></div><div><dt>Recomendación manual</dt><dd>{observation.recomendacion}</dd></div></dl></article>)}</div>}</section>}

    {versions.length > 0 && <section className={styles.sectionCard}><header><div><h2>Historial de versiones</h2><p>Procedencia, autor, machote y revisión persistidos por versión.</p></div></header><div className={styles.projectList}>{versions.map((version) => <article key={version.id}><span><FilePenLine aria-hidden="true"/></span><div><strong>Versión {version.version_numero}</strong><small>{version.nombre_original || version.nota_version || 'Proyecto de escritura'} · {version.subido_por_nombre || version.cargado_por_nombre || 'Autor no registrado'}</small><small>{version.generation_origin ? `Origen ${version.generation_origin}` : 'Origen histórico'}{version.template_name ? ` · ${version.template_name}${version.template_version ? ` v${version.template_version}` : ''}` : ''}</small>{version.instructions && <small>Indicaciones: {version.instructions}</small>}{version.validated_at && <small>Validado el {dateTime(version.validated_at)} · ciclo {version.validation_cycle || 1}</small>}</div><div><b>{version.es_vigente ? version.es_version_final ? 'Validada' : 'Vigente' : version.es_version_final ? 'Validada histórica' : 'Histórica'}</b><time>{dateTime(version.created_at)}</time></div><button type="button" aria-label={`Ver versión ${version.version_numero}`} onClick={() => void openPreview(version)}><Eye aria-hidden="true"/></button><button type="button" aria-label={`Descargar versión ${version.version_numero}`} onClick={() => void expedientesService.downloadProject(expediente.id, version.id, version.nombre_original || `proyecto-v${version.version_numero}.docx`)}><Download aria-hidden="true"/></button>{version.es_vigente && !version.es_version_final && <button type="button" className={styles.projectTemplateAction} disabled={busy !== null} onClick={() => void updateLifecycle(version, 'MARCAR_FINAL')}><CircleCheck aria-hidden="true"/>Validar proyecto</button>}{version.es_vigente && version.es_version_final && <button type="button" className={styles.projectTemplateAction} disabled={busy !== null} onClick={() => void updateLifecycle(version, 'REABRIR')}><FilePenLine aria-hidden="true"/>Reabrir nuevo ciclo</button>}{version.es_vigente && canSaveTemplate && <div className={styles.projectTemplatePromotion}><label>Acto para el machote<select aria-label="Acto para el machote maestro" value={promotionActId} onChange={(event) => setPromotionActId(event.target.value)}>{workspace?.expediente.acts.map((act) => <option key={act.id} value={act.id}>{act.name}</option>)}</select></label><button type="button" className={styles.projectTemplateAction} disabled={savingTemplate === version.id || !promotionActId} onClick={() => void saveAsTemplate(version)}>{savingTemplate === version.id ? <LoaderCircle className={styles.spin} aria-hidden="true"/> : <FileStack aria-hidden="true"/>}Registrar como machote maestro</button></div>}</article>)}</div></section>}

    <DocumentViewer open={preview.open} name={preview.version?.nombre_original || 'Proyecto de escritura.docx'} mimeType={DOCX} url={preview.url} loading={preview.loading} error={preview.error} onClose={() => { if (preview.url) URL.revokeObjectURL(preview.url); setPreview({ open: false, loading: false }); }} onDownload={preview.version ? () => void expedientesService.downloadProject(expediente.id, preview.version!.id, preview.version!.nombre_original || `proyecto-v${preview.version!.version_numero}.docx`) : undefined}/>
  </div>;
}
