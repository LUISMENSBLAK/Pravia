import { CircleCheck, Download, FilePenLine, FileSearch, FileStack, LoaderCircle, SlidersHorizontal, Sparkles, TriangleAlert, Upload } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { expedientesService } from "../../expedientes.service";
import type { ExpedienteDetail, ProjectState, ProjectWorkspace } from "../../expedientes.types";
import { dateTime } from "../../expedienteFormatters";
import styles from "../../Expedientes.module.css";
import { useAuth } from "../../../auth/AuthProvider";

const generationObservationLabel = (kind: string) => ({
  CONTRADICTION: "Contradicción documental",
  POSSIBLE_TEMPLATE_RESIDUE: "Posible dato residual del machote",
  CONTEXT_CHRONOLOGY: "Cronología de antecedentes",
}[kind] || "Observación de generación");

export function ProjectTab({ expediente, project, onChanged }: { expediente: ExpedienteDetail; project: ProjectState | null; onChanged(): void }) {
  const { user } = useAuth();
  const input = useRef<HTMLInputElement>(null);
  const templateInput = useRef<HTMLInputElement>(null);
  const [mode, setMode] = useState<"GENERAR_PROYECTO" | "REVISAR_PROYECTO">("GENERAR_PROYECTO");
  const [workspace, setWorkspace] = useState<ProjectWorkspace | null>(null);
  const [templateVersionId, setTemplateVersionId] = useState("");
  const [instructions, setInstructions] = useState("");
  const [selectedSourceIds, setSelectedSourceIds] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [savingTemplate, setSavingTemplate] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const canSaveTemplate = Boolean(user?.permissions?.includes("configuracion.plantillas_formatos.manage"));
  const versions = project ? ([project.vigente, ...project.historial].filter(Boolean) as any[]) : [];
  const report = project?.ultimoReporte || null;

  useEffect(() => {
    const controller = new AbortController();
    expedientesService.projectWorkspace(expediente.id, controller.signal).then((result) => {
      setWorkspace(result);
      setTemplateVersionId(result.templates.find((item) => item.default)?.versions[0]?.id || result.templates[0]?.versions[0]?.id || "");
      setSelectedSourceIds(result.sources.documents.filter((item) => item.selected_by_default).map((item) => item.documento.id));
    }).catch((reason) => { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "No fue posible preparar Proyecto."); });
    return () => controller.abort();
  }, [expediente.id]);

  const upload = async (file?: File) => {
    if (!file) return;
    setBusy(true); setError("");
    try { await expedientesService.uploadProject(expediente.id, file, "Nueva versión para revisión notarial"); setNotice("Nueva versión cargada."); onChanged(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "No fue posible cargar la versión."); }
    finally { setBusy(false); if (input.current) input.current.value = ""; }
  };
  const generate = async () => {
    setBusy(true); setError(""); setNotice("");
    try { const result = await expedientesService.generateProject(expediente.id, { templateVersionId, instructions, sourceDocumentIds: selectedSourceIds }); setNotice(`Proyecto generado con fidelidad estructural verificada. ${result.pending_count} dato(s) pendiente(s) y ${result.generation_observation_count} observación(es) requieren revisión.`); onChanged(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "No fue posible generar el proyecto."); }
    finally { setBusy(false); }
  };
  const generateFromTemplate = async (file?: File) => {
    if (!file) return; setBusy(true); setError(""); setNotice("");
    try { const result = await expedientesService.generateProjectFromTemplate(expediente.id, file, { instructions, sourceDocumentIds: selectedSourceIds }); setNotice(`Proyecto generado desde el machote exclusivo con fidelidad estructural verificada. ${result.pending_count} dato(s) pendiente(s) y ${result.generation_observation_count} observación(es) requieren revisión.`); onChanged(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "No fue posible usar el machote."); }
    finally { setBusy(false); if (templateInput.current) templateInput.current.value = ""; }
  };
  const review = async () => {
    setBusy(true); setError(""); setNotice("");
    try { await expedientesService.reviewProject(expediente.id); setNotice("Revisión terminada. Las observaciones quedaron separadas y no modificaron el proyecto."); onChanged(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "No fue posible revisar el proyecto."); }
    finally { setBusy(false); }
  };
  const saveAsTemplate = async (version: any) => {
    setSavingTemplate(version.id); setNotice(""); setError("");
    try { await expedientesService.saveProjectAsNotaryTemplate(expediente.id, version.id); setNotice("Plantilla guardada en Notaría → Plantillas."); }
    catch { setError("No fue posible guardar esta versión como plantilla."); }
    finally { setSavingTemplate(null); }
  };

  return <div className={styles.projectWorkspace}>
    <section className={styles.sectionCard}>
      <header><div><h2>Proyecto de escritura</h2><p>Genera desde un machote real o revisa una versión existente sin modificarla automáticamente.</p></div></header>
      <div className={styles.projectModeTabs} role="tablist" aria-label="Flujos de Proyecto">
        <button type="button" role="tab" aria-selected={mode === "GENERAR_PROYECTO"} onClick={() => setMode("GENERAR_PROYECTO")}><Sparkles size={17}/>Generar proyecto</button>
        <button type="button" role="tab" aria-selected={mode === "REVISAR_PROYECTO"} onClick={() => setMode("REVISAR_PROYECTO")}><FileSearch size={17}/>Revisar proyecto</button>
      </div>
      {notice && <p className={styles.notice} role="status">{notice}</p>}
      {error && <p className={styles.error} role="alert">{error}</p>}
      {mode === "GENERAR_PROYECTO" ? <div className={styles.projectActionPanel}>
        <div><strong>Machote CFG-002</strong><p>La estructura, estilos, tablas, imágenes, encabezados y pies permanecen en el DOCX seleccionado.</p></div>
        <label>Plantilla sugerida<select value={templateVersionId} onChange={(event) => setTemplateVersionId(event.target.value)}><option value="">Resolver la única predeterminada aplicable</option>{workspace?.templates.flatMap((item) => item.versions.map((version) => <option key={version.id} value={version.id}>{item.name} · v{version.version}{item.default ? " · sugerida" : ""}</option>))}</select></label>
        <label>Instrucciones opcionales<textarea rows={3} value={instructions} onChange={(event) => setInstructions(event.target.value)} placeholder="Indicaciones específicas para esta proyección. No sustituyen los datos maestros ni autorizan inventar hechos." /></label>
        <div className={styles.projectSourceSummary}><span>Fuentes estructuradas: {workspace?.sources.structured.join(", ") || "cargando…"}</span><span>{workspace?.sources.documents.length || 0} documento(s) fuente disponibles</span></div>
        <details className={styles.projectSources}><summary><SlidersHorizontal size={15}/>Ver / ajustar fuentes <small>{selectedSourceIds.length} seleccionada(s)</small></summary><p>Los datos estructurados siempre se incluyen. Selecciona únicamente documentos vigentes relevantes para esta proyección.</p><div>{workspace?.sources.documents.map((source) => <label key={source.documento.id}><input type="checkbox" checked={selectedSourceIds.includes(source.documento.id)} onChange={(event) => setSelectedSourceIds((current) => event.target.checked ? [...new Set([...current, source.documento.id])] : current.filter((id) => id !== source.documento.id))}/><span><strong>{source.documento.nombre_original}</strong><small>{source.tipo_vinculo}{source.source_context ? ` · ${source.source_context}` : ""}</small></span></label>)}</div>{workspace && !workspace.sources.documents.length && <p>No hay documentos fuente vigentes vinculados.</p>}</details>
        <input ref={templateInput} className={styles.srOnly} type="file" accept=".docx" onChange={(event) => void generateFromTemplate(event.target.files?.[0])}/>
        <div className={styles.projectReviewActions}><button className={styles.secondaryButton} type="button" disabled={busy} onClick={() => templateInput.current?.click()}><Upload size={16}/>Cargar machote DOCX exclusivo</button><button className={styles.primaryButton} type="button" disabled={busy || (!templateVersionId && !workspace?.templates.length)} onClick={() => void generate()}>{busy ? <LoaderCircle className={styles.spin} size={16}/> : <Sparkles size={16}/>}Generar desde machote</button></div>
      </div> : <div className={styles.projectActionPanel}>
        <div><strong>Revisión notarial asistida</strong><p>Compara el proyecto vigente contra fuentes del expediente. Reporta observaciones y contradicciones; no aplica cambios automáticos.</p></div>
        <input ref={input} className={styles.srOnly} type="file" accept=".docx" onChange={(event) => void upload(event.target.files?.[0])}/>
        <div className={styles.projectReviewActions}><button className={styles.secondaryButton} type="button" disabled={busy} onClick={() => input.current?.click()}><Upload size={16}/>Cargar nueva versión</button><button className={styles.primaryButton} type="button" disabled={busy || !project?.vigente} onClick={() => void review()}>{busy ? <LoaderCircle className={styles.spin} size={16}/> : <FileSearch size={16}/>}Revisar versión vigente</button></div>
      </div>}
    </section>
    {project?.vigente?.generation_observations && project.vigente.generation_observations.length > 0 && <section className={styles.sectionCard} aria-label="Observaciones automáticas de generación">
      <header><div><h2>Observaciones de generación</h2><p>Proyecto V{project.vigente.version_numero} · el machote no fue modificado automáticamente para resolver estas observaciones.</p></div></header>
      <div className={styles.projectReviewSummary}><TriangleAlert size={19}/><div><strong>{project.vigente.generation_observations.length} observación(es) para revisión humana</strong><p>Incluye contradicciones, cronología incierta o posibles datos residuales sin fuente actual.</p></div></div>
      <div className={styles.projectObservations}>{project.vigente.generation_observations.map((observation, index) => <article key={`${observation.kind}-${index}`} data-risk="MEDIO">
        <header><strong>OBSERVACIÓN {String(index + 1).padStart(2, "0")}</strong><span>{generationObservationLabel(observation.kind)}</span></header>
        <dl>
          {observation.field && <div><dt>Campo</dt><dd>{observation.field}</dd></div>}
          {observation.master_value && <div><dt>Dato maestro</dt><dd>{observation.master_value}</dd></div>}
          {observation.document_value && <div><dt>Dato documental</dt><dd>{observation.document_value}</dd></div>}
          {observation.value && <div><dt>Valor detectado</dt><dd>{observation.value}</dd></div>}
          <div><dt>Ubicación / detalle</dt><dd>{observation.location || observation.detail || "Requiere revisión humana."}</dd></div>
        </dl>
      </article>)}</div>
    </section>}
    {report && <section className={styles.sectionCard} aria-label="Resultado de la revisión notarial">
      <header><div><h2>Resultado de la revisión</h2><p>Proyecto V{report.proyecto_version_numero} · {report.documentos_analizados_count} de {report.documentos_totales_count} fuentes analizadas · {dateTime(report.created_at)}</p></div><button className={styles.secondaryButton} type="button" onClick={() => void expedientesService.downloadProjectReport(expediente.id, report.nombre_reporte)}><Download size={16}/>Descargar reporte</button></header>
      <div className={styles.projectReviewSummary}>
        {report.observaciones.length ? <><TriangleAlert size={19}/><div><strong>{report.observaciones.length} observación(es) para revisión humana</strong><p>Las observaciones no modifican el Word. Corrige o carga una nueva versión y vuelve a revisar.</p></div></> : <><CircleCheck size={19}/><div><strong>Sin discrepancias comprobables</strong><p>El resultado no sustituye la revisión profesional del abogado y del Notario.</p></div></>}
      </div>
      {report.documentos_no_leidos.length > 0 && <p className={styles.projectUnreadSources}><strong>Fuentes no leídas:</strong> {report.documentos_no_leidos.join(", ")}</p>}
      {report.observaciones.length > 0 && <div className={styles.projectObservations}>{report.observaciones.map((observation) => <article key={observation.id} data-risk={observation.nivel_riesgo}>
        <header><strong>{observation.titulo}</strong><span>{observation.tipo_discrepancia.replaceAll("_", " ")}</span></header>
        <dl><div><dt>Proyecto</dt><dd>{observation.dato_proyecto}</dd></div><div><dt>Fuente</dt><dd>{observation.dato_fuente}</dd></div><div><dt>Documento y ubicación</dt><dd>{observation.documento_fuente} · {observation.ubicacion}</dd></div><div><dt>Recomendación manual</dt><dd>{observation.recomendacion}</dd></div></dl>
      </article>)}</div>}
    </section>}
    <section className={styles.sectionCard}>
      <header><div><h2>Historial de versiones</h2><p>Procedencia, autor y versión persistidos.</p></div></header>
      {versions.length ? <div className={styles.projectList}>{versions.map((version) => <article key={version.id}><span><FilePenLine size={19}/></span><div><strong>Versión {version.version_numero}</strong><small>{version.nombre_original || version.nota_version || "Proyecto de escritura"} · {version.subido_por_nombre || version.cargado_por_nombre || "Autor no registrado"}</small></div><div><b>{version.es_vigente ? "Vigente" : version.es_version_final ? "Final" : "Histórica"}</b><time>{dateTime(version.created_at)}</time></div><button type="button" aria-label={`Descargar versión ${version.version_numero}`} onClick={() => void expedientesService.downloadProject(expediente.id, version.id, version.nombre_original || `proyecto-v${version.version_numero}.docx`)}><Download size={17}/></button>{version.es_vigente && canSaveTemplate && <button type="button" className={styles.projectTemplateAction} disabled={savingTemplate === version.id} onClick={() => void saveAsTemplate(version)}>{savingTemplate === version.id ? <LoaderCircle className={styles.spin} size={16}/> : <FileStack size={16}/>}Guardar como plantilla</button>}</article>)}</div> : <p className={styles.sectionEmpty}>Todavía no hay versiones del proyecto de escritura.</p>}
    </section>
  </div>;
}
