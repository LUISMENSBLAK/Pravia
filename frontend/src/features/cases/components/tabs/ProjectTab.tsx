import { Download, FilePenLine, FileStack, LoaderCircle, Upload } from "lucide-react";
import { useRef, useState } from "react";
import { expedientesService } from "../../expedientes.service";
import type { ExpedienteDetail, ProjectState } from "../../expedientes.types";
import { dateTime } from "../../expedienteFormatters";
import styles from "../../Expedientes.module.css";
import { useAuth } from "../../../auth/AuthProvider";
export function ProjectTab({
  expediente,
  project,
  onChanged,
}: {
  expediente: ExpedienteDetail;
  project: ProjectState | null;
  onChanged(): void;
}) {
  const { user } = useAuth();
  const input = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [savingTemplate, setSavingTemplate] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const canSaveTemplate = Boolean(user?.permissions?.includes("configuracion.plantillas_formatos.manage"));
  const versions = project
    ? ([project.vigente, ...project.historial].filter(Boolean) as any[])
    : [];
  const upload = async (file?: File) => {
    if (!file) return;
    setUploading(true);
    try {
      await expedientesService.uploadProject(
        expediente.id,
        file,
        "Nueva versión desde el workspace",
      );
      onChanged();
    } finally {
      setUploading(false);
      if (input.current) input.current.value = "";
    }
  };
  const saveAsTemplate = async (version: any) => {
    setSavingTemplate(version.id); setNotice(""); setError("");
    try {
      await expedientesService.saveProjectAsNotaryTemplate(expediente.id, version.id);
      setNotice("Plantilla guardada en Notaría → Plantillas.");
    } catch {
      setError("No fue posible guardar esta versión como plantilla.");
    } finally { setSavingTemplate(null); }
  };
  return (
    <section className={styles.sectionCard}>
      <header>
        <div>
          <h2>Proyecto de escritura</h2>
          <p>Versiones resguardadas para esta operación.</p>
        </div>
        {expediente.capabilities.canWrite && (
          <>
            <input
              ref={input}
              className={styles.srOnly}
              type="file"
              accept=".docx"
              onChange={(event) => void upload(event.target.files?.[0])}
            />
            <button
              className={styles.secondaryButton}
              type="button"
              disabled={uploading}
              onClick={() => input.current?.click()}
            >
              {uploading ? (
                <LoaderCircle className={styles.spin} size={16} />
              ) : (
                <Upload size={16} />
              )}
              Nueva versión
            </button>
          </>
        )}
      </header>
      {notice && <p className={styles.notice} role="status">{notice}</p>}
      {error && <p className={styles.error} role="alert">{error}</p>}
      {versions.length ? (
        <div className={styles.projectList}>
          {versions.map((version) => (
            <article key={version.id}>
              <span>
                <FilePenLine size={19} />
              </span>
              <div>
                <strong>Versión {version.version_numero}</strong>
                <small>
                  {version.nombre_original ||
                    version.nota_version ||
                    "Proyecto de escritura"}{" "}
                  · {version.subido_por_nombre || "Autor no registrado"}
                </small>
              </div>
              <div>
                <b>
                  {version.es_vigente
                    ? "Vigente"
                    : version.es_version_final
                      ? "Final"
                      : "Histórica"}
                </b>
                <time>{dateTime(version.created_at)}</time>
              </div>
              <button
                type="button"
                aria-label={`Descargar versión ${version.version_numero}`}
                title="Descargar versión autorizada"
                onClick={() =>
                  void expedientesService.downloadProject(
                    expediente.id,
                    version.id,
                    version.nombre_original ||
                      `proyecto-v${version.version_numero}.docx`,
                  )
                }
              >
                <Download size={17} />
              </button>
              {version.es_vigente && canSaveTemplate && <button
                type="button"
                className={styles.projectTemplateAction}
                disabled={savingTemplate === version.id}
                onClick={() => void saveAsTemplate(version)}
              >
                {savingTemplate === version.id ? <LoaderCircle className={styles.spin} size={16} /> : <FileStack size={16} />}
                Guardar en Notaría como plantilla
              </button>}
            </article>
          ))}
        </div>
      ) : (
        <p className={styles.sectionEmpty}>
          Todavía no hay versiones del proyecto de escritura.
        </p>
      )}
    </section>
  );
}
