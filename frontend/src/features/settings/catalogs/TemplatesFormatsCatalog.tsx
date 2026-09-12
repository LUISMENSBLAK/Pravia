import { useEffect, useMemo, useState, type FormEvent } from "react";
import {
  ArrowLeft,
  Building2,
  ChevronRight,
  Download,
  FileStack,
  FileText,
  Folder,
  FolderPlus,
  Landmark,
  LoaderCircle,
  Plus,
  UploadCloud,
} from "lucide-react";
import { Button } from "../../../components/ui/Button";
import { Skeleton } from "../../../components/ui/Skeleton";
import { useAuth } from "../../auth/AuthProvider";
import { settingsService } from "../settings.service";
import type {
  ArtifactType,
  CatalogArtifact,
  CatalogOwner,
  ExplorerPayload,
  OwnerType,
  SupportingCatalogs,
  CatalogImportPreview,
} from "./catalogs.types";
import { CatalogModal } from "./CatalogModal";
import styles from "./Catalogs.module.css";

type Selection = {
  ownerType: OwnerType;
  owner: CatalogOwner;
  kind?: ArtifactType;
  folderId?: string | null;
};
type ModalState =
  "institution" | "folder" | "import" | { version: CatalogArtifact } | null;
type Multiplicity =
  "EXPEDIENTE" | "COMPARECIENTE" | "INMUEBLE" | "CANTIDAD_FIJA";
type FileOverride = {
  act_ids?: string[];
  obligatoria?: boolean;
  multiplicidad?: Multiplicity;
  etapa_requerida_id?: string;
  momento_limite_etapa_id?: string;
  caracter_compareciente_id?: string;
  tipo_persona?: "" | "FISICA" | "MORAL";
  cantidad_fija?: number;
  fundamento_normativo?: string;
  version_normativa?: string;
  vigencia_desde?: string;
  actividad_vulnerable?: boolean;
  regimen_simplificado?: boolean;
  requiere_bc?: boolean;
  requiere_riesgo?: boolean;
  requiere_pep?: boolean;
  requiere_perfil?: boolean;
  requiere_alto_riesgo?: boolean;
};
const ownerLabel = (owner: CatalogOwner) =>
  owner.numero_notaria
    ? `Notaría ${owner.numero_notaria} · ${owner.nombre}`
    : owner.nombre;
const RepositorySkeleton = () => (
  <div
    className={styles.repositorySkeleton}
    role="status"
    aria-label="Cargando repositorio"
  >
    <div className={styles.ownerColumns}>
      {[0, 1].map((item) => (
        <Skeleton key={item} className={styles.ownerSkeleton} />
      ))}
    </div>
  </div>
);

export function TemplatesFormatsCatalog() {
  const { user } = useAuth();
  const canManage = Boolean(
    user?.permissions?.includes("configuracion.plantillas_formatos.manage"),
  );
  const [root, setRoot] = useState<{
    notaria: CatalogOwner | null;
    institutions: CatalogOwner[];
  }>({ notaria: null, institutions: [] });
  const [support, setSupport] = useState<SupportingCatalogs | null>(null);
  const [selection, setSelection] = useState<Selection | null>(null);
  const [explorer, setExplorer] = useState<ExplorerPayload | null>(null);
  const [modal, setModal] = useState<ModalState>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [institutionForm, setInstitutionForm] = useState({
    nombre: "",
    tipo: "BANCO",
  });
  const [folderName, setFolderName] = useState("");
  const [versionFile, setVersionFile] = useState<File | null>(null);
  const [importFiles, setImportFiles] = useState<File[]>([]);
  const [preview, setPreview] = useState<CatalogImportPreview | null>(null);
  const [overrides, setOverrides] = useState<Record<string, FileOverride>>({});
  const [bulk, setBulk] = useState({
    act_ids: [] as string[],
    obligatoria: false,
    multiplicidad: "EXPEDIENTE" as Multiplicity,
    etapa_requerida_id: "",
    momento_limite_etapa_id: "",
    caracter_compareciente_id: "",
    tipo_persona: "" as "" | "FISICA" | "MORAL",
    cantidad_fija: 1,
    fundamento_normativo: "",
    version_normativa: "",
    vigencia_desde: "",
    actividad_vulnerable: false,
    regimen_simplificado: false,
    requiere_bc: false,
    requiere_riesgo: false,
    requiere_pep: false,
    requiere_perfil: false,
    requiere_alto_riesgo: false,
  });

  const loadRoot = async () => {
    setLoading(true);
    setError("");
    try {
      const [data, supporting] = await Promise.all([
        settingsService.catalogArtifactRoot(),
        settingsService.catalogSupporting(),
      ]);
      setRoot(data);
      setSupport(supporting);
    } catch {
      setError("No pudimos cargar el repositorio privado.");
    } finally {
      setLoading(false);
    }
  };
  const loadExplorer = async (next = selection) => {
    if (!next?.kind) return;
    setLoading(true);
    setError("");
    try {
      setExplorer(
        await settingsService.catalogExplorer(
          next.ownerType,
          next.owner.id,
          next.kind,
          next.folderId,
        ),
      );
    } catch {
      setError("No pudimos cargar esta carpeta.");
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    void loadRoot();
  }, []);
  useEffect(() => {
    if (selection?.kind) void loadExplorer(selection);
    else setExplorer(null);
  }, [
    selection?.owner.id,
    selection?.ownerType,
    selection?.kind,
    selection?.folderId,
  ]);

  const run = async (action: () => Promise<unknown>, message: string) => {
    setBusy(true);
    setError("");
    try {
      await action();
      setNotice(message);
      setModal(null);
      if (selection?.kind) await loadExplorer();
      else await loadRoot();
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "No fue posible completar la operación.",
      );
    } finally {
      setBusy(false);
    }
  };
  const bootstrap = () =>
    void run(
      () => settingsService.bootstrapCatalogLibraryV4(),
      "Biblioteca estándar verificada e inicializada.",
    );
  const createInstitution = (event: FormEvent) => {
    event.preventDefault();
    void run(
      () => settingsService.createCatalogInstitution(institutionForm),
      "Institución agregada.",
    );
  };
  const createFolder = (event: FormEvent) => {
    event.preventDefault();
    if (!selection?.kind) return;
    void run(
      () =>
        settingsService.createCatalogFolder({
          propietario_tipo: selection.ownerType,
          tipo: selection.kind,
          notaria_id:
            selection.ownerType === "NOTARIA" ? selection.owner.id : null,
          institucion_id:
            selection.ownerType === "INSTITUCION" ? selection.owner.id : null,
          parent_id: selection.folderId || null,
          nombre: folderName,
        }),
      "Carpeta creada.",
    );
  };
  const analyze = async () => {
    setBusy(true);
    setError("");
    try {
      setPreview(await settingsService.previewCatalogImport(importFiles));
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "No pudimos analizar los archivos.",
      );
    } finally {
      setBusy(false);
    }
  };
  const confirmImport = async () => {
    if (!selection?.kind || !preview) return;
    const makeRule = (override: FileOverride = {}) => ({
      obligatoria: override.obligatoria ?? bulk.obligatoria,
      multiplicidad: override.multiplicidad || bulk.multiplicidad,
      cantidad_fija:
        (override.multiplicidad || bulk.multiplicidad) === "CANTIDAD_FIJA"
          ? (override.cantidad_fija ?? bulk.cantidad_fija)
          : null,
      tipo_persona: override.tipo_persona || bulk.tipo_persona || null,
      caracter_compareciente_id:
        override.caracter_compareciente_id ||
        bulk.caracter_compareciente_id ||
        null,
      etapa_requerida_id:
        override.etapa_requerida_id || bulk.etapa_requerida_id || null,
      momento_limite_etapa_id:
        override.momento_limite_etapa_id ||
        bulk.momento_limite_etapa_id ||
        null,
    });
    const makeNormative = (override: FileOverride = {}) => ({
      fundamento_normativo:
        override.fundamento_normativo ?? bulk.fundamento_normativo,
      version_normativa: override.version_normativa ?? bulk.version_normativa,
      vigencia_desde: `${override.vigencia_desde ?? bulk.vigencia_desde}T00:00:00.000Z`,
      actividad_vulnerable:
        override.actividad_vulnerable ?? bulk.actividad_vulnerable,
      regimen_simplificado:
        override.regimen_simplificado ?? bulk.regimen_simplificado,
      requiere_bc: override.requiere_bc ?? bulk.requiere_bc,
      requiere_riesgo: override.requiere_riesgo ?? bulk.requiere_riesgo,
      requiere_pep: override.requiere_pep ?? bulk.requiere_pep,
      requiere_perfil: override.requiere_perfil ?? bulk.requiere_perfil,
      requiere_alto_riesgo:
        override.requiere_alto_riesgo ?? bulk.requiere_alto_riesgo,
    });
    const fileOverrides = Object.fromEntries(
      Object.entries(overrides).map(([filePath, override]) => [
        filePath,
        {
          act_ids: override.act_ids ?? bulk.act_ids,
          rules: [makeRule(override)],
          normative: makeNormative(override),
        },
      ]),
    );
    await run(
      () =>
        settingsService.confirmCatalogImport(
          {
            owner_type: selection.ownerType,
            owner_id: selection.owner.id,
            type: selection.kind,
            parent_id: selection.folderId || null,
            bulk: {
              act_ids: bulk.act_ids,
              rules: [makeRule()],
              normative: makeNormative(),
            },
            overrides: fileOverrides,
          },
          importFiles,
        ),
      `${preview.total_files} archivo(s) importados con trazabilidad y checksum.`,
    );
    setPreview(null);
    setImportFiles([]);
    setOverrides({});
  };
  const addVersion = (event: FormEvent) => {
    event.preventDefault();
    if (!versionFile || !modal || typeof modal === "string") return;
    void run(
      () =>
        settingsService.addCatalogArtifactVersion(
          modal.version.id,
          versionFile,
        ),
      "Nueva versión guardada sin sobrescribir el histórico.",
    );
  };
  const openVersion = async (id: string) => {
    try {
      const { url } = await settingsService.catalogArtifactVersionUrl(id);
      window.open(url, "_blank", "noopener,noreferrer");
    } catch {
      setError("No pudimos abrir el archivo privado.");
    }
  };
  const toggleAct = (id: string) =>
    setBulk((current) => ({
      ...current,
      act_ids: current.act_ids.includes(id)
        ? current.act_ids.filter((item) => item !== id)
        : [...current.act_ids, id],
    }));
  const patchOverride = (filePath: string, patch: Partial<FileOverride>) =>
    setOverrides((current) => ({
      ...current,
      [filePath]: { ...(current[filePath] || {}), ...patch },
    }));
  const toggleOverrideAct = (filePath: string, actId: string) => {
    const selected = overrides[filePath]?.act_ids ?? bulk.act_ids;
    patchOverride(filePath, {
      act_ids: selected.includes(actId)
        ? selected.filter((item) => item !== actId)
        : [...selected, actId],
    });
  };
  const selectedActs = useMemo(() => new Set(bulk.act_ids), [bulk.act_ids]);

  return renderCurrent();

  function renderCurrent() {
    if (!selection) return renderRoot();
    if (!selection.kind) return renderKinds();
    return renderExplorer();
  }

  function renderRoot() {
    return (
      <div className={styles.catalogPage}>
        <header className={styles.catalogHeader}>
          <div>
            <span>Repositorio maestro privado</span>
            <h2>Plantillas y formatos</h2>
            <p>
              Una biblioteca documental de la Notaría y los Formatos propios de
              Bancos o Fiduciarias.
            </p>
          </div>
          {canManage && (
            <div className={styles.headerActions}>
              <Button variant="secondary" onClick={bootstrap} disabled={busy}>
                {busy ? <LoaderCircle /> : <FileStack />}Inicializar biblioteca
                estándar
              </Button>
              <Button
                variant="secondary"
                onClick={() => setModal("institution")}
              >
                <Plus />
                Banco / Fiduciaria
              </Button>
            </div>
          )}
        </header>
        {notice && (
          <p className={styles.notice} role="status">
            {notice}
          </p>
        )}
        {error && (
          <div className={styles.error} role="alert">
            <span>{error}</span>
            <button type="button" onClick={() => void loadRoot()}>
              Reintentar
            </button>
          </div>
        )}
        {loading ? (
          <RepositorySkeleton />
        ) : (
          <div className={styles.ownerColumns}>
            <section>
              <header>
                <Building2 />
                <div>
                  <h3>Notaría</h3>
                  <p>Plantillas y Formatos</p>
                </div>
              </header>
              {root.notaria ? (
                <div className={styles.ownerGrid}>
                  <button
                    type="button"
                    onClick={() =>
                      setSelection({
                        ownerType: "NOTARIA",
                        owner: root.notaria!,
                        folderId: null,
                      })
                    }
                  >
                    <span>
                      <Building2 />
                    </span>
                    <div>
                      <strong>Notaría</strong>
                      <small>{ownerLabel(root.notaria)}</small>
                    </div>
                    <ChevronRight />
                  </button>
                </div>
              ) : (
                <div className={styles.sectionEmpty}>
                  <Building2 />
                  <strong>Biblioteca aún no inicializada</strong>
                  <p>
                    Inicializa la biblioteca estándar para crear la referencia
                    técnica canónica.
                  </p>
                  {canManage && (
                    <button type="button" onClick={bootstrap}>
                      Inicializar ahora
                    </button>
                  )}
                </div>
              )}
            </section>
            <section>
              <header>
                <Landmark />
                <div>
                  <h3>Bancos / Fiduciarias</h3>
                  <p>Únicamente Formatos</p>
                </div>
              </header>
              <div className={styles.ownerGrid}>
                {root.institutions.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() =>
                      setSelection({
                        ownerType: "INSTITUCION",
                        owner: item,
                        folderId: null,
                      })
                    }
                  >
                    <span>
                      <Landmark />
                    </span>
                    <div>
                      <strong>{item.nombre}</strong>
                      <small>
                        {item.tipo === "FIDUCIARIA"
                          ? "Fiduciaria"
                          : item.tipo === "BANCO"
                            ? "Banco"
                            : "Institución"}
                      </small>
                    </div>
                    <ChevronRight />
                  </button>
                ))}
              </div>
              {!root.institutions.length && (
                <div className={styles.sectionEmpty}>
                  <Landmark />
                  <strong>Sin instituciones</strong>
                  <p>No se inventan formatos bancarios.</p>
                </div>
              )}
            </section>
          </div>
        )}
        {modal === "institution" && (
          <CatalogModal
            title="Nuevo banco o fiduciaria"
            description="Reutiliza el catálogo institucional compartido con Actos y tiempos."
            onClose={() => setModal(null)}
          >
            <form className={styles.modalForm} onSubmit={createInstitution}>
              <label>
                Nombre
                <input
                  required
                  value={institutionForm.nombre}
                  onChange={(event) =>
                    setInstitutionForm({
                      ...institutionForm,
                      nombre: event.target.value,
                    })
                  }
                />
              </label>
              <label>
                Tipo
                <select
                  value={institutionForm.tipo}
                  onChange={(event) =>
                    setInstitutionForm({
                      ...institutionForm,
                      tipo: event.target.value,
                    })
                  }
                >
                  <option value="BANCO">Banco</option>
                  <option value="FIDUCIARIA">Fiduciaria</option>
                  <option value="OTRA">Otra institución</option>
                </select>
              </label>
              <footer>
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => setModal(null)}
                >
                  Cancelar
                </Button>
                <Button type="submit">Guardar</Button>
              </footer>
            </form>
          </CatalogModal>
        )}
      </div>
    );
  }

  function renderKinds() {
    const title = ownerLabel(selection!.owner);
    return (
      <div className={styles.catalogPage}>
        <button
          className={styles.backButton}
          type="button"
          onClick={() => setSelection(null)}
        >
          <ArrowLeft />
          Plantillas y formatos
        </button>
        <header className={styles.catalogHeader}>
          <div>
            <span>
              {selection!.ownerType === "NOTARIA"
                ? "Notaría"
                : "Banco / Fiduciaria"}
            </span>
            <h2>{title}</h2>
            <p>Selecciona el repositorio documental.</p>
          </div>
        </header>
        <section className={styles.kindGrid}>
          {selection!.ownerType === "NOTARIA" && (
            <button
              type="button"
              onClick={() => setSelection({ ...selection!, kind: "PLANTILLA" })}
            >
              <span>
                <FileStack />
              </span>
              <div>
                <small>MACHOTE JURÍDICO</small>
                <h3>Plantillas</h3>
                <p>Proyectos y machotes propios de la Notaría.</p>
              </div>
              <ChevronRight />
            </button>
          )}
          <button
            type="button"
            onClick={() => setSelection({ ...selection!, kind: "FORMATO" })}
          >
            <span>
              <FileText />
            </span>
            <div>
              <small>DOCUMENTO PARA LLENADO</small>
              <h3>Formatos</h3>
              <p>Formatos administrativos, PLD/UIF o institucionales.</p>
            </div>
            <ChevronRight />
          </button>
        </section>
        {selection!.ownerType === "INSTITUCION" && (
          <div className={styles.definitionNote}>
            <Landmark />
            <div>
              <strong>Las instituciones sólo contienen Formatos</strong>
              <p>Las Plantillas pertenecen exclusivamente a la Notaría.</p>
            </div>
          </div>
        )}
      </div>
    );
  }

  function renderExplorer() {
    const current = selection!;
    const title = ownerLabel(current.owner);
    return (
      <div className={styles.catalogPage}>
        <nav className={styles.breadcrumb} aria-label="Ruta de carpetas">
          <button type="button" onClick={() => setSelection(null)}>
            Plantillas y formatos
          </button>
          <ChevronRight />
          <button
            type="button"
            onClick={() =>
              setSelection({ ...current, kind: undefined, folderId: null })
            }
          >
            {current.ownerType === "NOTARIA" ? "Notaría" : title}
          </button>
          <ChevronRight />
          <button
            type="button"
            onClick={() => setSelection({ ...current, folderId: null })}
          >
            {current.kind === "PLANTILLA" ? "Plantillas" : "Formatos"}
          </button>
          {explorer?.breadcrumbs.map((item) => (
            <span key={item.id}>
              <ChevronRight />
              <button
                type="button"
                aria-current={current.folderId === item.id ? "page" : undefined}
                onClick={() => setSelection({ ...current, folderId: item.id })}
              >
                {item.name}
              </button>
            </span>
          ))}
        </nav>
        <header className={styles.catalogHeader}>
          <div>
            <span>{current.kind}</span>
            <h2>
              {explorer?.folder?.nombre ||
                (current.kind === "PLANTILLA" ? "Plantillas" : "Formatos")}
            </h2>
            <p>
              Los archivos maestros permanecen versionados; EXP-006 consume
              referencias y snapshots, no copias editables.
            </p>
          </div>
          {canManage && (
            <div className={styles.headerActions}>
              <Button variant="secondary" onClick={() => setModal("folder")}>
                <FolderPlus />
                Nueva carpeta
              </Button>
              <Button
                onClick={() => {
                  setError("");
                  setPreview(null);
                  setImportFiles([]);
                  setModal("import");
                }}
              >
                <UploadCloud />
                Importar archivos / ZIP
              </Button>
            </div>
          )}
        </header>
        {notice && (
          <p className={styles.notice} role="status">
            {notice}
          </p>
        )}
        {error && (
          <p className={styles.error} role="alert">
            {error}
          </p>
        )}
        {loading ? (
          <RepositorySkeleton />
        ) : (
          <section className={styles.explorerGrid}>
            {explorer?.folders.map((folder) => (
              <button
                className={styles.folderCard}
                key={folder.id}
                type="button"
                onClick={() =>
                  setSelection({ ...current, folderId: folder.id })
                }
              >
                <Folder />
                <div>
                  <strong>{folder.nombre}</strong>
                  <small>Carpeta</small>
                </div>
                <ChevronRight />
              </button>
            ))}
            {explorer?.artifacts.map((artifact) => (
              <ArtifactCard key={artifact.id} artifact={artifact} />
            ))}
            {!explorer?.folders.length && !explorer?.artifacts.length && (
              <div className={styles.sectionEmpty}>
                <Folder />
                <strong>Carpeta vacía</strong>
                <p>
                  Importa archivos o conserva esta carpeta para una organización
                  futura.
                </p>
              </div>
            )}
          </section>
        )}
        {renderModals(current)}
      </div>
    );
  }

  function ArtifactCard({ artifact }: { artifact: CatalogArtifact }) {
    return (
      <article className={styles.artifactCard}>
        <header>
          <span>
            {artifact.tipo === "PLANTILLA" ? <FileStack /> : <FileText />}
          </span>
          <div>
            <small>{artifact.codigo_biblioteca || "ARCHIVO PROPIO"}</small>
            <h3>{artifact.nombre}</h3>
            <p>{artifact.descripcion || "Sin descripción"}</p>
          </div>
          <em>{artifact.activo ? "Activo" : "Inactivo"}</em>
        </header>
        <div className={styles.artifactMeta}>
          <span>{artifact.actos.length} acto(s)</span>
          <span>
            {artifact.reglas.filter((rule) => rule.activa !== false).length}{" "}
            regla(s)
          </span>
          <span>
            {artifact.revisionesNormativas?.length || 0} revisión normativa
          </span>
        </div>
        <div className={styles.versionList}>
          {artifact.versiones.map((version) => (
            <div key={version.id}>
              <span>
                <strong>v{version.version}</strong>
                <small>{version.nombre_original}</small>
              </span>
              <button
                type="button"
                aria-label={`Descargar ${version.nombre_original}`}
                onClick={() => void openVersion(version.id)}
              >
                <Download />
              </button>
            </div>
          ))}
        </div>
        {canManage && (
          <footer>
            <button
              type="button"
              onClick={() => setModal({ version: artifact })}
            >
              <UploadCloud />
              Nueva versión
            </button>
          </footer>
        )}
      </article>
    );
  }

  function renderModals(current: Selection) {
    if (modal === "folder")
      return (
        <CatalogModal
          title="Nueva carpeta"
          description="La jerarquía y sus breadcrumbs se conservarán."
          onClose={() => setModal(null)}
        >
          <form className={styles.modalForm} onSubmit={createFolder}>
            <label>
              Nombre
              <input
                required
                value={folderName}
                onChange={(event) => setFolderName(event.target.value)}
              />
            </label>
            <footer>
              <Button
                type="button"
                variant="secondary"
                onClick={() => setModal(null)}
              >
                Cancelar
              </Button>
              <Button type="submit">Crear carpeta</Button>
            </footer>
          </form>
        </CatalogModal>
      );
    if (modal === "import")
      return (
        <CatalogModal
          title="Importar archivos o ZIP"
          description="Analiza primero. Nada se almacena definitivamente hasta confirmar."
          onClose={() => setModal(null)}
        >
          <div className={styles.modalForm}>
            <label className={styles.fileField}>
              Archivos o ZIP
              <input
                multiple
                type="file"
                accept=".zip,.docx,.pdf,.xlsx,.xls,.odt,.txt,.rtf"
                onChange={(event) => {
                  setImportFiles(Array.from(event.target.files || []));
                  setPreview(null);
                }}
              />
              <span>
                <UploadCloud />
                {importFiles.length
                  ? `${importFiles.length} selección(es)`
                  : "Seleccionar archivos"}
              </span>
            </label>
            {error && (
              <p className={styles.error} role="alert">
                {error}
              </p>
            )}
            {!preview ? (
              <Button
                type="button"
                disabled={!importFiles.length || busy}
                onClick={() => void analyze()}
              >
                {busy && <LoaderCircle />}Analizar
              </Button>
            ) : (
              <ImportPreview />
            )}
          </div>
        </CatalogModal>
      );
    if (modal && typeof modal !== "string")
      return (
        <CatalogModal
          title={`Nueva versión · ${modal.version.nombre}`}
          description="La versión anterior permanece disponible y no se sobrescribe."
          onClose={() => setModal(null)}
        >
          <form className={styles.modalForm} onSubmit={addVersion}>
            <label className={styles.fileField}>
              Archivo
              <input
                required
                type="file"
                onChange={(event) =>
                  setVersionFile(event.target.files?.[0] || null)
                }
              />
              <span>
                <UploadCloud />
                {versionFile?.name || "Seleccionar archivo"}
              </span>
            </label>
            <footer>
              <Button
                type="button"
                variant="secondary"
                onClick={() => setModal(null)}
              >
                Cancelar
              </Button>
              <Button type="submit" disabled={!versionFile || busy}>
                Guardar nueva versión
              </Button>
            </footer>
          </form>
        </CatalogModal>
      );
    return null;

    function ImportPreview() {
      return (
        <>
          <div className={styles.importSummary}>
            <strong>{preview!.total_files} archivos</strong>
            <span>
              {Math.ceil(preview!.total_bytes / 1024)} KB · sin persistir
            </span>
          </div>
          <div className={styles.importTree}>
            {preview!.files.map((file) => (
              <article key={file.path}>
                <header className={styles.importFileHeader}>
                  <div>
                    <strong>{file.name}</strong>
                    <span>
                      {file.folders.join(" / ") ||
                        (current.kind === "PLANTILLA"
                          ? "Plantillas"
                          : "Formatos")}
                    </span>
                    <small>SHA-256 {file.checksum}</small>
                  </div>
                  <label>
                    <input
                      type="checkbox"
                      checked={
                        overrides[file.path]?.obligatoria ?? bulk.obligatoria
                      }
                      onChange={(event) =>
                        patchOverride(file.path, {
                          obligatoria: event.target.checked,
                        })
                      }
                    />
                    Obligatorio
                  </label>
                </header>
                <details className={styles.importException}>
                  <summary>
                    Excepción individual
                    {overrides[file.path] && <em>Configurada</em>}
                  </summary>
                  <div className={styles.importExceptionBody}>
                    <fieldset className={styles.choiceList}>
                      <legend>Actos de este archivo</legend>
                      {support?.acts.map((act) => (
                        <label key={act.id}>
                          <input
                            type="checkbox"
                            checked={(
                              overrides[file.path]?.act_ids ?? bulk.act_ids
                            ).includes(act.id)}
                            onChange={() =>
                              toggleOverrideAct(file.path, act.id)
                            }
                          />
                          <span>{act.nombre}</span>
                        </label>
                      ))}
                    </fieldset>
                    <div className={styles.formColumns}>
                      <label>
                        Multiplicidad
                        <select
                          value={
                            overrides[file.path]?.multiplicidad ??
                            bulk.multiplicidad
                          }
                          onChange={(event) =>
                            patchOverride(file.path, {
                              multiplicidad: event.target.value as Multiplicity,
                            })
                          }
                        >
                          <option value="EXPEDIENTE">Por expediente</option>
                          <option value="COMPARECIENTE">
                            Por compareciente
                          </option>
                          <option value="INMUEBLE">Por inmueble</option>
                          <option value="CANTIDAD_FIJA">
                            Cantidad definida
                          </option>
                        </select>
                      </label>
                      {(overrides[file.path]?.multiplicidad ??
                        bulk.multiplicidad) === "CANTIDAD_FIJA" && (
                        <label>
                          Cantidad
                          <input
                            type="number"
                            min={1}
                            value={
                              overrides[file.path]?.cantidad_fija ??
                              bulk.cantidad_fija
                            }
                            onChange={(event) =>
                              patchOverride(file.path, {
                                cantidad_fija: Math.max(
                                  1,
                                  Number(event.target.value) || 1,
                                ),
                              })
                            }
                          />
                        </label>
                      )}
                      <label>
                        Etapa requerida
                        <select
                          value={
                            overrides[file.path]?.etapa_requerida_id ??
                            bulk.etapa_requerida_id
                          }
                          onChange={(event) =>
                            patchOverride(file.path, {
                              etapa_requerida_id: event.target.value,
                            })
                          }
                        >
                          <option value="">Cualquier etapa</option>
                          {support?.stages.map((stage) => (
                            <option key={stage.id} value={stage.id}>
                              {stage.nombre}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label>
                        Momento límite
                        <select
                          value={
                            overrides[file.path]?.momento_limite_etapa_id ??
                            bulk.momento_limite_etapa_id
                          }
                          onChange={(event) =>
                            patchOverride(file.path, {
                              momento_limite_etapa_id: event.target.value,
                            })
                          }
                        >
                          <option value="">Sin límite</option>
                          {support?.stages.map((stage) => (
                            <option key={stage.id} value={stage.id}>
                              {stage.nombre}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label>
                        Tipo de persona
                        <select
                          value={
                            overrides[file.path]?.tipo_persona ??
                            bulk.tipo_persona
                          }
                          onChange={(event) =>
                            patchOverride(file.path, {
                              tipo_persona: event.target.value as
                                "" | "FISICA" | "MORAL",
                            })
                          }
                        >
                          <option value="">Cualquiera</option>
                          <option value="FISICA">Física</option>
                          <option value="MORAL">Moral</option>
                        </select>
                      </label>
                      <label>
                        Rol de compareciente
                        <select
                          value={
                            overrides[file.path]?.caracter_compareciente_id ??
                            bulk.caracter_compareciente_id
                          }
                          onChange={(event) =>
                            patchOverride(file.path, {
                              caracter_compareciente_id: event.target.value,
                            })
                          }
                        >
                          <option value="">Cualquier rol</option>
                          {support?.characters.map((role) => (
                            <option key={role.id} value={role.id}>
                              {role.nombre}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label>
                        Versión normativa
                        <input
                          value={
                            overrides[file.path]?.version_normativa ??
                            bulk.version_normativa
                          }
                          onChange={(event) =>
                            patchOverride(file.path, {
                              version_normativa: event.target.value,
                            })
                          }
                        />
                      </label>
                      <label>
                        Vigencia desde
                        <input
                          type="date"
                          value={
                            overrides[file.path]?.vigencia_desde ??
                            bulk.vigencia_desde
                          }
                          onChange={(event) =>
                            patchOverride(file.path, {
                              vigencia_desde: event.target.value,
                            })
                          }
                        />
                      </label>
                    </div>
                    <fieldset className={styles.choiceList}>
                      <legend>Condiciones de este archivo</legend>
                      {(
                        [
                          ["actividad_vulnerable", "Actividad vulnerable"],
                          ["regimen_simplificado", "Régimen simplificado"],
                          ["requiere_bc", "Beneficiario controlador"],
                          ["requiere_riesgo", "Riesgo"],
                          ["requiere_pep", "PEP"],
                          ["requiere_perfil", "Perfil transaccional"],
                          ["requiere_alto_riesgo", "Alto riesgo"],
                        ] as const
                      ).map(([key, label]) => (
                        <label key={key}>
                          <input
                            type="checkbox"
                            checked={overrides[file.path]?.[key] ?? bulk[key]}
                            onChange={(event) =>
                              patchOverride(file.path, {
                                [key]: event.target.checked,
                              })
                            }
                          />
                          {label}
                        </label>
                      ))}
                    </fieldset>
                    <label>
                      Fundamento normativo de este archivo
                      <textarea
                        value={
                          overrides[file.path]?.fundamento_normativo ??
                          bulk.fundamento_normativo
                        }
                        onChange={(event) =>
                          patchOverride(file.path, {
                            fundamento_normativo: event.target.value,
                          })
                        }
                      />
                    </label>
                    <Button
                      type="button"
                      variant="secondary"
                      onClick={() =>
                        setOverrides((currentOverrides) => {
                          const next = { ...currentOverrides };
                          delete next[file.path];
                          return next;
                        })
                      }
                    >
                      Usar asignación masiva
                    </Button>
                  </div>
                </details>
              </article>
            ))}
          </div>
          <fieldset className={styles.choiceList}>
            <legend>Asignación masiva a actos</legend>
            {support?.acts.map((act) => (
              <label key={act.id}>
                <input
                  type="checkbox"
                  checked={selectedActs.has(act.id)}
                  onChange={() => toggleAct(act.id)}
                />
                <span>{act.nombre}</span>
              </label>
            ))}
          </fieldset>
          <div className={styles.formColumns}>
            <label>
              Multiplicidad
              <select
                value={bulk.multiplicidad}
                onChange={(event) =>
                  setBulk({
                    ...bulk,
                    multiplicidad: event.target.value as Multiplicity,
                  })
                }
              >
                <option value="EXPEDIENTE">Una vez por expediente</option>
                <option value="COMPARECIENTE">Una vez por compareciente</option>
                <option value="INMUEBLE">Una vez por inmueble</option>
                <option value="CANTIDAD_FIJA">Cantidad definida</option>
              </select>
            </label>
            <label>
              Etapa requerida
              <select
                value={bulk.etapa_requerida_id}
                onChange={(event) =>
                  setBulk({ ...bulk, etapa_requerida_id: event.target.value })
                }
              >
                <option value="">Cualquier etapa</option>
                {support?.stages.map((stage) => (
                  <option key={stage.id} value={stage.id}>
                    {stage.nombre}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Momento límite
              <select
                value={bulk.momento_limite_etapa_id}
                onChange={(event) =>
                  setBulk({
                    ...bulk,
                    momento_limite_etapa_id: event.target.value,
                  })
                }
              >
                <option value="">Sin límite configurado</option>
                {support?.stages.map((stage) => (
                  <option key={stage.id} value={stage.id}>
                    {stage.nombre}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Tipo de persona
              <select
                value={bulk.tipo_persona}
                onChange={(event) =>
                  setBulk({
                    ...bulk,
                    tipo_persona: event.target.value as "" | "FISICA" | "MORAL",
                  })
                }
              >
                <option value="">Cualquiera</option>
                <option value="FISICA">Física</option>
                <option value="MORAL">Moral</option>
              </select>
            </label>
            <label>
              Rol de compareciente
              <select
                value={bulk.caracter_compareciente_id}
                onChange={(event) =>
                  setBulk({
                    ...bulk,
                    caracter_compareciente_id: event.target.value,
                  })
                }
              >
                <option value="">Cualquier rol</option>
                {support?.characters.map((role) => (
                  <option key={role.id} value={role.id}>
                    {role.nombre}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Versión normativa
              <input
                required
                value={bulk.version_normativa}
                onChange={(event) =>
                  setBulk({ ...bulk, version_normativa: event.target.value })
                }
              />
            </label>
            <label>
              Vigencia desde
              <input
                required
                type="date"
                value={bulk.vigencia_desde}
                onChange={(event) =>
                  setBulk({ ...bulk, vigencia_desde: event.target.value })
                }
              />
            </label>
          </div>
          <fieldset className={styles.choiceList}>
            <legend>Condiciones jurídicas explícitas</legend>
            <label>
              <input
                type="checkbox"
                checked={bulk.actividad_vulnerable}
                onChange={(event) =>
                  setBulk({
                    ...bulk,
                    actividad_vulnerable: event.target.checked,
                  })
                }
              />
              Actividad vulnerable
            </label>
            <label>
              <input
                type="checkbox"
                checked={bulk.regimen_simplificado}
                onChange={(event) =>
                  setBulk({
                    ...bulk,
                    regimen_simplificado: event.target.checked,
                  })
                }
              />
              Régimen simplificado
            </label>
            <label>
              <input
                type="checkbox"
                checked={bulk.requiere_bc}
                onChange={(event) =>
                  setBulk({ ...bulk, requiere_bc: event.target.checked })
                }
              />
              Beneficiario controlador
            </label>
            <label>
              <input
                type="checkbox"
                checked={bulk.requiere_riesgo}
                onChange={(event) =>
                  setBulk({ ...bulk, requiere_riesgo: event.target.checked })
                }
              />
              Riesgo
            </label>
            <label>
              <input
                type="checkbox"
                checked={bulk.requiere_pep}
                onChange={(event) =>
                  setBulk({ ...bulk, requiere_pep: event.target.checked })
                }
              />
              PEP
            </label>
            <label>
              <input
                type="checkbox"
                checked={bulk.requiere_perfil}
                onChange={(event) =>
                  setBulk({ ...bulk, requiere_perfil: event.target.checked })
                }
              />
              Perfil transaccional
            </label>
            <label>
              <input
                type="checkbox"
                checked={bulk.requiere_alto_riesgo}
                onChange={(event) =>
                  setBulk({
                    ...bulk,
                    requiere_alto_riesgo: event.target.checked,
                  })
                }
              />
              Alto riesgo
            </label>
          </fieldset>
          <label>
            Fundamento normativo
            <textarea
              required
              value={bulk.fundamento_normativo}
              onChange={(event) =>
                setBulk({ ...bulk, fundamento_normativo: event.target.value })
              }
            />
          </label>
          <p className={styles.helper}>
            La aplicación jurídica usa reglas declarativas y hechos confirmados.
            El nombre del archivo no decide por sí solo.
          </p>
          <footer>
            <Button
              type="button"
              variant="secondary"
              onClick={() => setPreview(null)}
            >
              Volver
            </Button>
            <Button
              type="button"
              disabled={
                busy || !bulk.fundamento_normativo || !bulk.version_normativa
              }
              onClick={() => void confirmImport()}
            >
              {busy && <LoaderCircle />}Confirmar importación
            </Button>
          </footer>
        </>
      );
    }
  }
}
