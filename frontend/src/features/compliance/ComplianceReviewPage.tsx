import {
  AlertTriangle,
  ArrowLeft,
  Bot,
  CalendarClock,
  ChevronRight,
  CircleDollarSign,
  ClipboardCheck,
  ExternalLink,
  FileCheck2,
  FileSearch,
  Fingerprint,
  History,
  Landmark,
  Link2,
  RefreshCw,
  Scale,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  UserCheck,
  UsersRound,
  WalletCards,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { DocumentViewer } from "../../components/documents/DocumentViewer";
import { useAssistant } from "../assistant/AssistantProvider";
import { useAuth } from "../auth/AuthProvider";
import { resolveExpedienteReturn } from "../cases/expedienteNavigation";
import {
  fixtureComplianceDetail,
  fixtureH1ComplianceDetail,
} from "./compliance.fixtures";
import {
  activityLabels,
  evaluationLabels,
  noticeLabels,
} from "./CompliancePage";
import { complianceService } from "./compliance.service";
import { humanComplianceLabel } from "./complianceLabels";
import type { ComplianceDetail } from "./compliance.types";
import styles from "./Compliance.module.css";
import { H5QuestionnaireEditor } from "./components/H5QuestionnaireEditor";
import { H5PaymentEditor, H5PaymentVerification } from "./components/H5PaymentEditor";

const sections = [
  ["operacion", "01", "Operación"],
  ["actividad", "02", "Actividad vulnerable"],
  ["personas", "03", "Personas"],
  ["beneficiario", "04", "Beneficiario controlador"],
  ["pep", "05", "PEP y listas"],
  ["pagos", "06", "Pago y efectivo"],
  ["riesgo", "07", "Riesgo interno"],
  ["obligaciones", "08", "Obligaciones y Avisos"],
  ["evidencia", "09", "Evidencia"],
  ["historial", "10", "Historial"],
] as const;
const money = (value: unknown) =>
  Number(value || 0).toLocaleString("es-MX", {
    style: "currency",
    currency: "MXN",
  });
const date = (value: unknown) =>
  value
    ? new Date(String(value)).toLocaleDateString("es-MX", {
        year: "numeric",
        month: "short",
        day: "numeric",
      })
    : "Por determinar";
const text = (value: unknown, fallback = "Por determinar") =>
  value == null || value === ""
    ? fallback
    : String(value).replaceAll("_", " ").toLocaleLowerCase("es-MX");

export function ComplianceReviewPage() {
  const { id = "" } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const { user } = useAuth();
  const assistant = useAssistant();
  const returnPath = resolveExpedienteReturn(location.search);
  const fixtureName = new URLSearchParams(location.search).get("fixture");
  const fixture =
    import.meta.env.DEV && ["workspace", "h1"].includes(fixtureName || "");
  const localVisual =
    fixture && new URLSearchParams(location.search).get("visual") === "1";
  const [data, setData] = useState<ComplianceDetail | null>(
    fixture
      ? fixtureName === "h1"
        ? fixtureH1ComplianceDetail
        : fixtureComplianceDetail
      : null,
  );
  const [h5, setH5] = useState<any>(
    fixture
      ? {
          questionnaires: [],
          payments: [],
          provider_candidates: [],
          configuration: {
            questionnaire_definitions: 0,
            risk_methodologies: 0,
          },
          legacy: { ambiguous_payments_preserved: 0 },
        }
      : null,
  );
  const [status, setStatus] = useState<"loading" | "ready" | "error">(
    fixture ? "ready" : "loading",
  );
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [viewer, setViewer] = useState<{
    open: boolean;
    name: string;
    mime?: string;
    url?: string;
    loading?: boolean;
    error?: string;
  }>({ open: false, name: "" });
  const canWrite =
    localVisual ||
    Boolean(
      user?.permissions?.some((permission) =>
        ["compliance.write", "cumplimiento.write"].includes(permission),
      ),
    );
  const canReview =
    localVisual ||
    Boolean(
      user?.permissions?.some((permission) =>
        ["compliance.review", "cumplimiento.confirm"].includes(permission),
      ),
    );
  const canReadH5 = Boolean(user?.permissions?.includes("compliance.sensitive.read"));
  const load = useCallback(
    async (signal?: AbortSignal) => {
      if (fixture) return;
      setStatus("loading");
      try {
        const [detail, h5Workspace] = await Promise.all([
          complianceService.detail(id, signal),
          canReadH5 ? complianceService.h5Workspace(id, signal) : Promise.resolve({ sensitiveRedacted: true }),
        ]);
        setData(detail);
        setH5(h5Workspace);
        setStatus("ready");
      } catch (error) {
        if (!(error instanceof DOMException && error.name === "AbortError"))
          setStatus("error");
      }
    },
    [fixture, id, canReadH5],
  );
  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);
  useEffect(
    () => () => {
      if (viewer.url) URL.revokeObjectURL(viewer.url);
    },
    [viewer.url],
  );
  const openEvidence = async (evidence: any) => {
    const document = evidence.documento || {};
    setViewer({
      open: true,
      name: document.nombre_original || "Evidencia",
      mime: document.mime_type,
      loading: !fixture,
    });
    if (fixture) return;
    try {
      const blob = await complianceService.evidenceBlob(id, evidence.id);
      setViewer((current) => ({
        ...current,
        loading: false,
        url: URL.createObjectURL(blob),
      }));
    } catch {
      setViewer((current) => ({
        ...current,
        loading: false,
        error: "No fue posible mostrar este documento.",
      }));
    }
  };
  if (status === "loading")
    return (
      <main className={styles.workspacePage}>
        <div className={styles.reviewSkeleton}>
          <span />
          <span />
          <section />
          <section />
        </div>
      </main>
    );
  if (status === "error" || !data)
    return (
      <main className={styles.workspacePage}>
        <section className={styles.error}>
          <AlertTriangle />
          <h2>No pudimos cargar esta evaluación.</h2>
          <p>La información no está disponible en este momento.</p>
          <button type="button" onClick={() => void load()}>
            <RefreshCw />
            Reintentar
          </button>
        </section>
      </main>
    );
  const review = data.revision;
  const workspace = data.workspace || {
    parties: [],
    beneficialOwners: [],
    pepReviews: [],
    screenings: [],
    payments: [],
    obligations: [],
    events: [],
    aiProposals: [],
    sensitiveRedacted: false,
  };
  const result: any = review.resultado_json || {};
  const questionnaire = review.cuestionario_json || {};
  if (review.is_canonical_legal_engine || review.tipo === "LEGAL_H1")
    return (
      <CanonicalLegalReview
        data={data}
        h5={h5}
        onRefresh={() => load()}
        h5Permissions={{ write: canReadH5 && Boolean(user?.permissions?.includes("compliance.write")), confirm: canReadH5 && Boolean(user?.permissions?.includes("compliance.review")), documents: Boolean(user?.permissions?.includes("documentos.read")), documentsWrite: Boolean(user?.permissions?.includes("documentos.write")), ai: Boolean(user?.permissions?.includes("ia.execute")), provider: Boolean(user?.permissions?.includes("expedientes.write") && user?.permissions?.includes("comparecientes.read")) }}
        returnPath={returnPath}
        onBack={() => navigate(returnPath || "/riesgos")}
        onAssistant={() =>
          assistant.openAssistant({
            prefill:
              "Resume el estado jurídico de cumplimiento, los cuestionarios, pagos, proveedores de recursos, alertas y fundamentos de esta evaluación sin emitir un dictamen ni cambiar datos.",
          })
        }
      />
    );
  const operationValue =
    result.monto_base_mxn ??
    questionnaire.precio_pactado ??
    review.expediente.valor_operacion;
  const paymentTotal = workspace.payments.reduce(
    (sum: number, payment: any) => sum + Number(payment.amount_mxn || 0),
    0,
  );
  const evaluation =
    result.estado_evaluacion ||
    (review.estatus === "CONFIRMADO" ? "EVALUADO" : "SIN_EVALUAR");
  return (
    <main className={styles.workspacePage}>
      <header className={styles.workspaceHeader}>
        <button
          type="button"
          className={styles.backLink}
          onClick={() => navigate(returnPath || "/riesgos")}
        >
          <ArrowLeft />
          {returnPath ? "Volver al expediente" : "Riesgos / UIF"}
        </button>
        <div className={styles.workspaceTitle}>
          <div>
            <span>Evaluación histórica UIF · versión {review.rule_version_snapshot}</span>
            <h1>{review.expediente.numero_pravia}</h1>
            <p>
              {review.expediente.cliente_alias || "Cliente por confirmar"} ·{" "}
              {review.expediente.tipo_acto?.nombre || "Acto por determinar"}
            </p>
          </div>
          <div className={styles.workspaceActions}>
            <b data-tone={evaluation}>
              {evaluationLabels[evaluation] || text(evaluation)}
            </b>
          </div>
        </div>
        <div className={styles.workspaceMeta}>
          <span>
            <Landmark />
            Notaría {review.expediente.notaria?.numero_notaria || "sin asignar"}
          </span>
          <span>
            <UserCheck />
            {review.expediente.abogado
              ? `${review.expediente.abogado.nombre} ${review.expediente.abogado.apellido}`
              : "Sin responsable"}
          </span>
          <span>
            <CalendarClock />
            Operación: {date(review.fecha_operacion)}
          </span>
          <span>
            <History />
            Snapshot: {date(review.snapshot_captured_at)}
          </span>
        </div>
        <p className={styles.snapshotWarning}>
          <AlertTriangle />
          Registro histórico de consulta. Sus resultados no determinan el cumplimiento vigente;
          utiliza la evaluación canónica del expediente. No se modifica esta versión.
        </p>
      </header>
      <nav
        className={styles.sectionNav}
        aria-label="Secciones de la evaluación"
      >
        {sections.map(([key, number, label]) => (
          <a key={key} href={`#${key}`}>
            <span>{number}</span>
            {label}
          </a>
        ))}
      </nav>
      {message && (
        <p className={styles.inlineNotice} role="status">
          {message}
        </p>
      )}
      <div className={styles.workspaceLayout}>
        <div className={styles.workspaceSections}>
          <WorkspaceSection
            id="operacion"
            number="01"
            icon={FileCheck2}
            title="Operación y snapshot"
            subtitle="Datos jurídicos congelados para esta evaluación."
          >
            <KeyGrid
              items={[
                ["Expediente", review.expediente.numero_pravia],
                ["Acto", review.expediente.tipo_acto?.nombre],
                ["Valor de operación", money(operationValue)],
                ["Fecha jurídica", date(review.fecha_operacion)],
                [
                  "Versión del expediente",
                  review.master_snapshot?.expediente?.version
                    ? `v${review.master_snapshot.expediente.version}`
                    : "Snapshot registrado",
                ],
                ["Regla aplicable", review.rule_version_snapshot],
              ]}
            />
          </WorkspaceSection>
          <WorkspaceSection
            id="actividad"
            number="02"
            icon={Scale}
            title="Actividad vulnerable"
            subtitle="Determinación por supuesto legal, fecha y UMA aplicable."
          >
            <div className={styles.legalDecision}>
              <span data-state={result.actividad_vulnerable}>
                {result.actividad_vulnerable === "SI"
                  ? "Actividad vulnerable identificada"
                  : result.actividad_vulnerable === "NO"
                    ? "No identificada"
                    : "Información insuficiente"}
              </span>
              <h3>
                {activityLabels[result.acto] ||
                  "Supuesto pendiente de determinar"}
              </h3>
              <p>
                {result.fundamento ||
                  "La evaluación aún no cuenta con fundamento persistido."}
              </p>
            </div>
            <KeyGrid
              items={[
                ["Identificación", text(result.identificacion_requerida)],
                [
                  "Aviso",
                  noticeLabels[result.estado_aviso] || "Por determinar",
                ],
                ["Monto individual", money(result.monto_base_mxn)],
                ["Acumulado 6 meses", money(result.acumulado_seis_meses_mxn)],
                [
                  "Umbral de Aviso",
                  result.umbral_uma
                    ? `${Number(result.umbral_uma).toLocaleString("es-MX")} UMA · ${money(result.umbral_mxn)}`
                    : "Aviso en todos los casos",
                ],
                [
                  "UMA aplicable",
                  result.uma
                    ? `${money(result.uma.dailyValueMxn)} diarios · ${result.uma.year}`
                    : "Por determinar",
                ],
              ]}
            />
            <SourceNote result={result} />
          </WorkspaceSection>
          <WorkspaceSection
            id="personas"
            number="03"
            icon={UsersRound}
            title="Personas y comparecientes"
            subtitle="Snapshot de intervinientes; los cambios maestros no reescriben esta versión."
          >
            {workspace.sensitiveRedacted ? (
              <Restricted />
            ) : (
              <div className={styles.partyGrid}>
                {workspace.parties.map((party: any) => {
                  const snap = party.snapshot || {};
                  return (
                    <article key={party.id}>
                      <Fingerprint />
                      <div>
                        <strong>
                          {snap.nombre ||
                            snap.razon_social ||
                            "Persona registrada"}
                        </strong>
                        <p>
                          {text(snap.tipo_persona)} ·{" "}
                          {snap.rfc || "RFC pendiente"}
                        </p>
                        <small>
                          {text(party.role)} · snapshot v
                          {party.snapshot_version}
                        </small>
                      </div>
                    </article>
                  );
                })}
              </div>
            )}
          </WorkspaceSection>
          <WorkspaceSection
            id="beneficiario"
            number="04"
            icon={UserCheck}
            title="Beneficiario controlador"
            subtitle="Declaraciones y evidencia separadas de cualquier propuesta automatizada."
          >
            {workspace.sensitiveRedacted ? (
              <Restricted />
            ) : (
              <div className={styles.recordList}>
                {workspace.beneficialOwners.length ? (
                  workspace.beneficialOwners.map((owner: any) => (
                    <article key={owner.id}>
                      <div>
                        <strong>{text(owner.status)}</strong>
                        <p>
                          {owner.declaration || "Sin declaración documentada."}
                        </p>
                      </div>
                      <span>
                        {owner.confirmed_at
                          ? "Confirmado por persona autorizada"
                          : "Pendiente de confirmación humana"}
                      </span>
                    </article>
                  ))
                ) : (
                  <EmptyLine text="No se ha documentado la determinación del beneficiario controlador." />
                )}
              </div>
            )}
          </WorkspaceSection>
          <WorkspaceSection
            id="pep"
            number="05"
            icon={ShieldAlert}
            title="PEP y listas"
            subtitle="Una coincidencia potencial nunca equivale a una determinación de ilicitud."
          >
            {workspace.sensitiveRedacted ? (
              <Restricted />
            ) : (
              <>
                <div className={styles.integrationStatus}>
                  <AlertTriangle />
                  <div>
                    <strong>Consulta oficial PEP no configurada</strong>
                    <p>
                      No se simulan resultados ni se infieren coincidencias. La
                      declaración y revisión humana permanecen auditables.
                    </p>
                  </div>
                </div>
                <div className={styles.recordList}>
                  {workspace.pepReviews.map((pep: any) => (
                    <article key={pep.id}>
                      <div>
                        <strong>{text(pep.status)}</strong>
                        <p>{pep.notes || "Revisión sin observaciones."}</p>
                      </div>
                      <span>
                        {pep.human_reviewed_at
                          ? `Revisado ${date(pep.human_reviewed_at)}`
                          : "Revisión pendiente"}
                      </span>
                    </article>
                  ))}
                </div>
              </>
            )}
          </WorkspaceSection>
          <WorkspaceSection
            id="pagos"
            number="06"
            icon={WalletCards}
            title="Formas de pago y restricción de efectivo"
            subtitle="La obligación de Aviso y la restricción de efectivo se evalúan por separado."
          >
            <div className={styles.paymentSummary}>
              <div>
                <small>Valor de operación</small>
                <strong>{money(operationValue)}</strong>
              </div>
              <div>
                <small>Pagos documentados</small>
                <strong>{money(paymentTotal)}</strong>
              </div>
              <div>
                <small>Diferencia</small>
                <strong>
                  {money(Number(operationValue || 0) - paymentTotal)}
                </strong>
              </div>
            </div>
            <div className={styles.recordList}>
              {workspace.payments.map((payment: any) => (
                <article key={payment.id}>
                  <div>
                    <strong>{money(payment.amount_mxn)}</strong>
                    <p>
                      {text(payment.method)} · {date(payment.payment_date)}
                    </p>
                  </div>
                  <span>
                    {payment.masked_account ||
                      payment.reference ||
                      "Sin referencia visible"}
                  </span>
                </article>
              ))}
            </div>
            <div
              className={styles.cashRule}
              data-state={result.restriccion_efectivo?.status}
            >
              <CircleDollarSign />
              <div>
                <strong>
                  Resultado histórico de forma de pago — sin autoridad actual
                </strong>
                <p>
                  Esta información histórica no determina restricciones actuales. Consulta la regla jurídica
                  vigente en la evaluación canónica.{" "}
                  {result.restriccion_efectivo?.legalBasis}
                </p>
              </div>
            </div>
          </WorkspaceSection>
          <WorkspaceSection
            id="riesgo"
            number="07"
            icon={ShieldCheck}
            title="Evaluación interna de riesgo"
            subtitle="Metodología interna explicable; no constituye una probabilidad de ilicitud."
          >
            <div className={styles.riskScore}>
              <span data-level={result.evaluacion_riesgo?.level}>
                {text(result.evaluacion_riesgo?.level)}
              </span>
              <div>
                <strong>
                  {result.evaluacion_riesgo?.score ?? 0} puntos internos
                </strong>
                <p>
                  {result.evaluacion_riesgo?.methodology ||
                    "Metodología no registrada"}
                </p>
              </div>
            </div>
            <ul className={styles.factorList}>
              {(result.evaluacion_riesgo?.factors || []).map((factor: any) => (
                <li key={factor.key}>
                  <strong>+{factor.points}</strong>
                  <span>
                    {text(factor.key)}
                    <small>{factor.evidence}</small>
                  </span>
                </li>
              ))}
            </ul>
            <p className={styles.normativePending}>
              Estado normativo:{" "}
              {text(result.evaluacion_riesgo?.normativeStatus)}.{" "}
              {result.evaluacion_riesgo?.disclaimer}
            </p>
          </WorkspaceSection>
          <WorkspaceSection
            id="obligaciones"
            number="08"
            icon={CalendarClock}
            title="Obligaciones y Avisos"
            subtitle="PRAVIA prepara y controla; la presentación externa solo se marca con confirmación humana y acuse."
          >
            <div className={styles.obligationGrid}>
              {workspace.obligations.map((obligation: any) => (
                <article key={obligation.id}>
                  <header>
                    <span>
                      {noticeLabels[obligation.status] ||
                        text(obligation.status)}
                    </span>
                    <b>
                      {obligation.type === "AVISO_24H"
                        ? "24 horas"
                        : `Límite ${date(obligation.due_at)}`}
                    </b>
                  </header>
                  <h3>
                    {obligation.type === "AVISO_24H"
                      ? "Aviso prioritario condicionado"
                      : "Aviso ordinario"}
                  </h3>
                  <p>{obligation.legal_basis}</p>
                  <dl>
                    <div>
                      <dt>Canal</dt>
                      <dd>{obligation.channel}</dd>
                    </div>
                    <div>
                      <dt>Versión</dt>
                      <dd>{obligation.rule_version}</dd>
                    </div>
                    <div>
                      <dt>Presentación</dt>
                      <dd>
                        {obligation.external_folio
                          ? `Folio ${obligation.external_folio}`
                          : "No confirmada externamente"}
                      </dd>
                    </div>
                  </dl>
                  {canReview && !obligation.external_folio && (
                    <button
                      type="button"
                      disabled
                      title="Requiere fecha, folio y acuse vinculados"
                    >
                      Registrar presentación externa
                    </button>
                  )}
                </article>
              ))}
            </div>
            <p className={styles.humanGate}>
              <ShieldAlert />
              La coincidencia textual no genera por sí sola un Aviso de 24
              horas. Requiere supuesto vigente, evidencia y confirmación humana.
            </p>
          </WorkspaceSection>
          <WorkspaceSection
            id="evidencia"
            number="09"
            icon={FileSearch}
            title="Evidencia y conservación"
            subtitle="Documentos protegidos, vinculados al expediente y conservados al menos diez años."
          >
            <div className={styles.evidenceGrid}>
              {review.evidencias.map((evidence: any) => (
                <button
                  type="button"
                  key={evidence.id}
                  onClick={() => void openEvidence(evidence)}
                >
                  <FileSearch />
                  <span>
                    <strong>{evidence.documento.nombre_original}</strong>
                    <small>
                      {text(evidence.tipo_evidencia)} · conserva hasta{" "}
                      {date(evidence.retention_until)}
                    </small>
                  </span>
                  <ChevronRight />
                </button>
              ))}
            </div>
            {!review.evidencias.length && (
              <EmptyLine text="No hay evidencia vinculada a esta evaluación." />
            )}
          </WorkspaceSection>
          <WorkspaceSection
            id="historial"
            number="10"
            icon={History}
            title="Historial, versiones e integraciones"
            subtitle="Registro append-only de hechos, actores, decisiones y fuentes."
          >
            <div className={styles.timeline}>
              {workspace.events.map((event: any) => (
                <article key={event.id}>
                  <span />
                  <div>
                    <strong>{text(event.event_type)}</strong>
                    <p>{event.summary}</p>
                    <small>{date(event.created_at)}</small>
                  </div>
                </article>
              ))}
            </div>
            <h3 className={styles.subsectionTitle}>Versiones anteriores</h3>
            <div className={styles.versionGrid}>
              {data.historial.map((item: any) => (
                <article key={item.id}>
                  <strong>{item.rule_version_snapshot}</strong>
                  <p>
                    {evaluationLabels[item.resultado_json?.estado_evaluacion] ||
                      text(item.estatus)}
                  </p>
                  <small>{date(item.created_at)} · solo lectura</small>
                </article>
              ))}
            </div>
          </WorkspaceSection>
        </div>
        <aside className={styles.workspaceAside}>
          <section className={styles.assistantCard}>
            <header>
              <Sparkles />
              <span>PRAVIA IA</span>
              <b>Contextual</b>
            </header>
            <h2>Apoyo para esta evaluación</h2>
            <p>
              Consulta faltantes, alertas y fuentes de esta versión. PRAVIA IA
              no confirma personas, no presenta Avisos y no emite dictámenes.
            </p>
            <button
              type="button"
              onClick={() =>
                assistant.openAssistant({
                  prefill:
                    "Resume esta evaluación UIF, sus faltantes y fuentes, sin emitir un dictamen legal.",
                })
              }
            >
              <Bot />
              Abrir con contexto
            </button>
          </section>
          {workspace.aiProposals.map((proposal: any) => (
            <section className={styles.aiProposal} key={proposal.id}>
              <small>Propuesta automatizada</small>
              <strong>PROPUESTA — REQUIERE CONFIRMACIÓN HUMANA.</strong>
              <p>
                {proposal.content?.message ||
                  "Información extraída pendiente de revisión."}
              </p>
              <dl>
                <div>
                  <dt>Documento</dt>
                  <dd>{proposal.source_document_id || "Fuente registrada"}</dd>
                </div>
                <div>
                  <dt>Página</dt>
                  <dd>{proposal.source_page || "—"}</dd>
                </div>
                <div>
                  <dt>Modelo</dt>
                  <dd>{proposal.model}</dd>
                </div>
                <div>
                  <dt>Versión</dt>
                  <dd>{proposal.prompt_version}</dd>
                </div>
              </dl>
            </section>
          ))}
          <section className={styles.disclaimerCard}>
            <ShieldCheck />
            <div>
              <strong>Apoyo operativo, no dictamen</strong>
              <p>
                {result.disclaimer ||
                  "La decisión requiere revisión humana autorizada."}
              </p>
            </div>
          </section>
        </aside>
      </div>
      <DocumentViewer
        open={viewer.open}
        name={viewer.name}
        mimeType={viewer.mime}
        url={viewer.url}
        loading={viewer.loading}
        error={viewer.error}
        onClose={() => setViewer({ open: false, name: "" })}
      />
    </main>
  );
}

const legalSourceLabels: Record<string, string> = {
  EXPEDIENTE_FECHA_REAL_FIRMA:
    "Fecha real de firma registrada en el expediente",
  CONFIRMADA_POR_USUARIO:
    "Fecha jurídica confirmada por una persona autorizada",
};

function CanonicalLegalReview({
  data,
  h5,
  returnPath,
  onBack,
  onAssistant,
  onRefresh,
  h5Permissions,
}: {
  data: ComplianceDetail;
  h5?: any;
  returnPath?: string | null;
  onBack: () => void;
  onAssistant: () => void;
  onRefresh: () => Promise<void>;
  h5Permissions: H5Permissions;
}) {
  const review = data.revision;
  const workspace = data.workspace || {
    parties: [],
    beneficialOwners: [],
    pepReviews: [],
    screenings: [],
    payments: [],
    obligations: [],
    events: [],
    aiProposals: [],
    sensitiveRedacted: false,
  };
  const state: any = workspace.state || review.canonical_state_snapshot || {};
  const results = workspace.ruleResults || [];
  const requirements = workspace.requirements || [];
  const alerts = workspace.alerts || [];
  const operationSource =
    legalSourceLabels[String(review.legal_date_source || "")] ||
    "Fecha jurídica aún no confirmada";
  return (
    <main className={styles.workspacePage}>
      <header className={styles.workspaceHeader}>
        <button type="button" className={styles.backLink} onClick={onBack}>
          <ArrowLeft />
          {returnPath ? "Volver al expediente" : "Riesgos / UIF"}
        </button>
        <div className={styles.workspaceTitle}>
          <div>
            <span>Evaluación jurídica de cumplimiento</span>
            <h1>{review.expediente.numero_pravia}</h1>
            <p>
              {review.expediente.cliente_alias || "Cliente por confirmar"} ·
              evaluación determinista y versionada
            </p>
          </div>
          <div className={styles.workspaceActions}>
            <b data-tone={state.state}>{humanComplianceLabel(state.state)}</b>
          </div>
        </div>
        <div className={styles.workspaceMeta}>
          <span>
            <Landmark />
            Notaría {review.expediente.notaria?.numero_notaria || "sin asignar"}
          </span>
          <span>
            <UserCheck />
            {review.expediente.abogado
              ? `${review.expediente.abogado.nombre} ${review.expediente.abogado.apellido}`
              : "Sin responsable"}
          </span>
          <span>
            <CalendarClock />
            Fecha jurídica: {date(review.fecha_operacion)}
          </span>
          <span>
            <History />
            Evaluación: {date(review.snapshot_captured_at)}
          </span>
        </div>
        {review.master_data_changed && (
          <p className={styles.snapshotWarning}>
            <AlertTriangle />
            Los datos maestros cambiaron después de esta evaluación. El
            historial permanece intacto y una nueva evaluación podrá incorporar
            los cambios.
          </p>
        )}
      </header>
      <nav
        className={styles.sectionNav}
        aria-label="Secciones de la evaluación jurídica"
      >
        <a href="#estado">
          <span>01</span>Estado
        </a>
        <a href="#resultados">
          <span>02</span>Resultados
        </a>
        <a href="#requisitos">
          <span>03</span>Requisitos
        </a>
        <a href="#alertas">
          <span>04</span>Alertas
        </a>
        <a href="#historial">
          <span>05</span>Historial
        </a>
      </nav>
      <div className={styles.workspaceLayout}>
        <div className={styles.workspaceSections}>
          <WorkspaceSection
            id="cuestionarios"
            number="CUE"
            icon={ClipboardCheck}
            title="Cuestionarios de riesgo"
            subtitle="Versiones estructuradas, trazables y evaluadas únicamente con metodología activa compatible."
          >
            <H5Questionnaires data={h5} onRefresh={onRefresh} permissions={h5Permissions} />
          </WorkspaceSection>
          {requirements.some((item: any) => item.provider === "PAG" && item.status !== "NO_APLICA") && <WorkspaceSection
            id="pagos-h5"
            number="PAG"
            icon={WalletCards}
            title="Pagos de la operación"
            subtitle="Registro versionado por expediente; las restricciones jurídicas permanecen separadas de los hechos de pago."
          >
            <H5Payments data={h5} onRefresh={onRefresh} permissions={h5Permissions} />
          </WorkspaceSection>}
          <WorkspaceSection
            id="estado"
            number="01"
            icon={ShieldCheck}
            title="Estado actual de cumplimiento"
            subtitle="Estado derivado de requisitos y fechas; no puede marcarse completo manualmente."
          >
            <div className={styles.legalDecision}>
              <span>{humanComplianceLabel(state.state)}</span>
              <h3>
                {Number(state.pending_count || 0)
                  ? `${Number(state.pending_count)} requisitos requieren atención`
                  : "Sin pendientes derivados en esta evaluación"}
              </h3>
              <p>
                Este estado pertenece al expediente y conserva cada evaluación
                anterior como historial inmutable.
              </p>
            </div>
            <KeyGrid
              items={[
                ["Fecha jurídica", date(review.fecha_operacion)],
                ["Origen de la fecha", operationSource],
                ["Próximo vencimiento", date(state.next_deadline)],
                ["Resultados evaluados", results.length],
                ["Requisitos", requirements.length],
                [
                  "Alertas abiertas",
                  alerts.filter((item: any) => item.status === "ABIERTA")
                    .length,
                ],
              ]}
            />
          </WorkspaceSection>
          <WorkspaceSection
            id="resultados"
            number="02"
            icon={Scale}
            title="Detección jurídica"
            subtitle="Cada acto se contrasta con todas las reglas verificadas y vigentes para la fecha jurídica."
          >
            {results.length ? (
              <div className={styles.recordList}>
                {results.map((item: any, index: number) => {
                  const snapshot = item.result_snapshot || {};
                  const basis = item.legal_basis_snapshot || {};
                  return (
                    <article key={item.id}>
                      <div>
                        <strong>
                          {snapshot.requirementLabel ||
                            `Resultado jurídico ${index + 1}`}
                        </strong>
                        <p>
                          {humanComplianceLabel(item.applicability)}
                          {item.notice_required === true
                            ? " · genera obligación de aviso según la regla vigente"
                            : ""}
                        </p>
                        <LegalFoundation
                          text={
                            basis.legal_basis ||
                            snapshot.legalBasis ||
                            "El fundamento no está disponible en esta versión."
                          }
                        />
                      </div>
                      <span>
                        {item.vulnerable_activity === true
                          ? "Actividad identificada"
                          : item.vulnerable_activity === false
                            ? "Actividad no identificada"
                            : "Pendiente de información"}
                      </span>
                    </article>
                  );
                })}
              </div>
            ) : (
              <EmptyLine text="No se emitieron resultados legales: revisa los requisitos y alertas de información." />
            )}
          </WorkspaceSection>
          <WorkspaceSection
            id="requisitos"
            number="03"
            icon={ClipboardCheck}
            title="Requisitos derivados"
            subtitle="La conclusión general depende de estos requisitos y de los módulos que correspondan."
          >
            {requirements.length ? (
              <div className={styles.recordList}>
                {requirements.map((item: any) => (
                  <article key={item.id}>
                    <div>
                      <strong>
                        {item.label || "Requisito de cumplimiento"}
                      </strong>
                      <p>
                        {humanComplianceLabel(item.status)} · proveedor{" "}
                        {humanProvider(item.provider)}
                      </p>
                    </div>
                    <span>
                      {item.deadline
                        ? `Límite ${date(item.deadline)}`
                        : "Sin fecha inventada"}
                    </span>
                  </article>
                ))}
              </div>
            ) : (
              <EmptyLine text="Esta evaluación no generó requisitos." />
            )}
          </WorkspaceSection>
          <WorkspaceSection
            id="alertas"
            number="04"
            icon={ShieldAlert}
            title="Alertas fundacionales"
            subtitle="Las alertas informan y priorizan; no bloquean globalmente el expediente."
          >
            {alerts.length ? (
              <div className={styles.recordList}>
                {alerts.map((item: any) => (
                  <article key={item.id}>
                    <div>
                      <strong>
                        {humanComplianceLabel(item.level)} ·{" "}
                        {humanComplianceLabel(item.status)}
                      </strong>
                      <p>{item.message}</p>
                    </div>
                    <span>
                      {item.deadline
                        ? `Fecha ${date(item.deadline)}`
                        : "Sin fecha global"}
                    </span>
                  </article>
                ))}
              </div>
            ) : (
              <EmptyLine text="No hay alertas para esta evaluación." />
            )}
          </WorkspaceSection>
          <WorkspaceSection
            id="historial"
            number="05"
            icon={History}
            title="Historial de evaluaciones"
            subtitle="Cada reevaluación crea una versión nueva y no reescribe los resultados anteriores."
          >
            <div className={styles.timeline}>
              {workspace.events.map((event: any) => (
                <article key={event.id}>
                  <span />
                  <div>
                    <strong>{humanEvent(event.event_type)}</strong>
                    <p>{event.summary}</p>
                    <small>{date(event.created_at)}</small>
                  </div>
                </article>
              ))}
            </div>
            {!workspace.events.length && (
              <EmptyLine text="No hay eventos adicionales en esta versión." />
            )}
            <h3 className={styles.subsectionTitle}>Versiones anteriores</h3>
            <div className={styles.versionGrid}>
              {data.historial.map((item: any) => (
                <article key={item.id}>
                  <strong>
                    {humanComplianceLabel(
                      item.resultado_json?.estado || item.estatus,
                    )}
                  </strong>
                  <p>Evaluación jurídica conservada en solo lectura</p>
                  <small>{date(item.created_at)}</small>
                </article>
              ))}
            </div>
            {!data.historial.length && (
              <EmptyLine text="Esta es la primera evaluación jurídica del expediente." />
            )}
          </WorkspaceSection>
        </div>
        <aside className={styles.workspaceAside}>
          <section className={styles.assistantCard}>
            <header>
              <Sparkles />
              <span>PRAVIA IA</span>
              <b>Contextual</b>
            </header>
            <h2>Apoyo para esta evaluación</h2>
            <p>
              Consulta estados, faltantes, alertas y fundamentos. PRAVIA IA no
              decide aplicabilidad jurídica, no cambia el estado y no escribe
              datos maestros sin confirmación.
            </p>
            <button type="button" onClick={onAssistant}>
              <Bot />
              Abrir con contexto
            </button>
          </section>
          <section className={styles.disclaimerCard}>
            <ShieldCheck />
            <div>
              <strong>Motor determinista versionado</strong>
              <p>
                Solo usa reglas verificadas y vigentes. Si falta información, lo
                indica expresamente en lugar de asumir que no aplica.
              </p>
            </div>
          </section>
        </aside>
      </div>
    </main>
  );
}

type H5Permissions = { write?: boolean; confirm?: boolean; documents?: boolean; documentsWrite?: boolean; ai?: boolean; provider?: boolean };
type H5SurfaceProps = { data?: any; permissions?: H5Permissions; onRefresh?: () => Promise<void> };

export function H5Questionnaires({ data, permissions = {}, onRefresh }: H5SurfaceProps) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  if (!data) return <EmptyLine text="Cargando cuestionarios…" />;
  if (data.sensitiveRedacted) return <EmptyLine text="No tienes permiso para consultar los datos sensibles de cuestionarios." />;
  if (!data.questionnaires?.length && !data.configuration?.questionnaire_definitions)
    return (
      <div className={styles.integrationStatus}>
        <AlertTriangle />
        <div>
          <strong>Configuración pendiente</strong>
          <p>
            No existe una definición estructurada activa. PRAVIA no inventa
            preguntas ni una calificación.
          </p>
        </div>
      </div>
    );
  return (
    <>
    {permissions.write && data.is_current && onRefresh && <div className={styles.h5Editor}>
      <button disabled={busy} type="button" onClick={() => { setBusy(true); setMessage(""); void complianceService.ensureH5Questionnaires(data.review_id).then(onRefresh).catch((error) => setMessage(error.message)).finally(() => setBusy(false)); }}>Preparar cuestionarios de los requisitos vigentes</button>
    </div>}
    <p role="status" aria-live="polite">{busy ? "Procesando…" : message}</p>
    {!data.questionnaires?.length && <EmptyLine text="No hay cuestionarios derivados para los requisitos actuales." />}
    <div className={styles.h5Grid}>
      {data.questionnaires?.map((item: any) => (
        <article key={item.id}>
          <header>
            <strong>
              {item.requirement?.label ||
                (item.scope === "PERSONAL"
                  ? "Cuestionario personal"
                  : "Cuestionario general")}
            </strong>
            <span>
              {humanComplianceLabel(
                item.currentRevision?.status || "PENDIENTE",
              )}
            </span>
          </header>
          <p>
            {item.targetCompareciente?.nombre_busqueda ||
              "Alcance general del expediente"}
          </p>
          <dl>
            <div>
              <dt>Completitud</dt>
              <dd>
                {humanComplianceLabel(item.currentRevision?.completeness)}
              </dd>
            </div>
            <div>
              <dt>Evaluación</dt>
              <dd>
                {item.currentRevision?.evaluation_snapshot?.output_label || humanComplianceLabel(item.currentRevision?.evaluation_status)}
              </dd>
            </div>
            <div>
              <dt>Versión</dt>
              <dd>v{item.currentRevision?.revision_number || 1}</dd>
            </div>
          </dl>
          {permissions.write && permissions.documentsWrite && permissions.documents && item.currentRevision?.status === "FINALIZED" && <button type="button" disabled={busy} onClick={() => {
            setBusy(true); setMessage(""); void complianceService.generateH5QuestionnairePdf(item.id).then(async (blob) => {
              const url = URL.createObjectURL(blob); const link = document.createElement("a"); link.href = url; link.download = `cuestionario-interno-v${item.currentRevision.revision_number}.pdf`; link.click(); URL.revokeObjectURL(url);
              await onRefresh?.();
            }).catch((error) => setMessage(error.message)).finally(() => setBusy(false));
          }}>Registrar y descargar PDF interno, no oficial</button>}
          {permissions.write && data.is_current && onRefresh && item.currentRevision?.status !== "FINALIZED" && <H5QuestionnaireEditor assessment={item} canFinalize={Boolean(permissions.confirm)} onRefresh={onRefresh} />}
        </article>
      ))}
    </div>
    </>
  );
}

function decimalLabel(value: unknown) {
  const [whole, fraction = ""] = String(value).split(".");
  return `${whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",")}.${fraction.padEnd(2, "0")}`;
}

export function H5Payments({ data, permissions = {}, onRefresh }: H5SurfaceProps) {
  if (!data) return <EmptyLine text="Cargando pagos…" />;
  if (data.sensitiveRedacted) return <EmptyLine text="No tienes permiso para consultar los datos sensibles de pagos." />;
  const canEdit = Boolean(permissions.write && data.is_current && onRefresh);
  return (
    <>
      {canEdit && <H5PaymentEditor data={data} canConfirm={Boolean(permissions.confirm)} onRefresh={onRefresh!} />}
      {canEdit && permissions.documents && permissions.ai && <H5PaymentProposalControls data={data} onRefresh={onRefresh!} />}
      {canEdit && permissions.documents && data.proposals?.map((proposal: any) => <H5PaymentEditor key={proposal.id} data={data} proposal={proposal} payment={data.payments?.find((payment: any) => payment.id === proposal.payment_id)} canConfirm={Boolean(permissions.confirm)} onRefresh={onRefresh!} />)}
      <div className={styles.h5Grid}>
        {data.payments?.map((payment: any) => {
          const current = payment.currentRevision;
          return (
            <article key={payment.id}>
              <header>
                <strong>
                  {current?.amount_original != null
                    ? `${decimalLabel(current.amount_original)} ${current.currency_original || ""}`
                    : "Importe por confirmar"}
                </strong>
                <span>
                  {humanComplianceLabel(current?.status || "BORRADOR")}
                </span>
              </header>
              <p>
                {current?.method_raw || "Método por confirmar"} ·{" "}
                {date(current?.payment_date)}
              </p>
              <dl>
                <div>
                  <dt>Cuenta</dt>
                  <dd>
                    {current?.account_last4
                      ? `Terminación ${current.account_last4}`
                      : "No disponible"}
                  </dd>
                </div>
                <div>
                  <dt>Verificación</dt>
                  <dd>
                    {humanComplianceLabel(
                      current?.verifications?.[0]?.stale ? "DESACTUALIZADO" : current?.verifications?.[0]?.status || "PENDIENTE",
                    )}
                  </dd>
                </div>
                <div>
                  <dt>Alcance</dt>
                  <dd>
                    {current?.scope === "EXPLICIT_ACT_SET"
                      ? "Actos seleccionados"
                      : "Instrumento general"}
                  </dd>
                </div>
              </dl>
              {canEdit && <H5PaymentEditor data={data} payment={payment} canConfirm={Boolean(permissions.confirm)} onRefresh={onRefresh!} />}
              {data.is_current && permissions.confirm && permissions.documents && onRefresh && current?.status === "CONFIRMED" && <H5PaymentVerification data={data} payment={payment} onRefresh={onRefresh} />}
              {data.is_current && permissions.confirm && permissions.provider && onRefresh && current?.status === "CONFIRMED" && <H5ProviderConfirmation data={data} payment={payment} onRefresh={onRefresh} />}
            </article>
          );
        })}
      </div>
      {!data.payments?.length && (
        <EmptyLine text="No hay pagos versionados en este expediente." />
      )}
      {data.legacy?.ambiguous_payments_preserved > 0 && (
        <p className={styles.h5Warning}>
          <AlertTriangle />
          Hay {data.legacy.ambiguous_payments_preserved} registros históricos
          preservados que requieren clasificación humana.
        </p>
      )}
      <div className={styles.providerStrip}>
        <strong>Proveedores de recursos</strong>
        <span>
          {data.provider_candidates?.filter(
            (item: any) => item.es_proveedor_recursos,
          ).length || 0}{" "}
          confirmados · el rol adicional no sustituye su comparecencia.
        </span>
      </div>
    </>
  );
}

function H5PaymentProposalControls({ data, onRefresh }: { data: any; onRefresh: () => Promise<void> }) {
  const [selected, setSelected] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  return <details className={styles.h5Editor}><summary>Preparar propuesta desde recibos con PRAVIA IA</summary>
    <p>La lectura genera una propuesta revisable. No registra pagos ni modifica las finanzas del expediente.</p>
    <fieldset disabled={busy}><legend>Documentos de cumplimiento autorizados</legend>
      {data.evidence?.map((item: any) => <label className={styles.h5Check} key={item.id}><input type="checkbox" checked={selected.includes(item.documento.id)} onChange={(event) => setSelected((old) => event.target.checked ? [...new Set([...old, item.documento.id])] : old.filter((id) => id !== item.documento.id))} />{item.documento.nombre_original || "Soporte documental"}</label>)}
      <button type="button" disabled={!selected.length} onClick={() => { setBusy(true); setMessage(""); void complianceService.prepareH5PaymentProposal(data.review_id, { source_document_ids: selected, operation_id: crypto.randomUUID() }).then(onRefresh).catch((error) => setMessage(error.message)).finally(() => setBusy(false)); }}>Preparar propuesta sin guardar pagos</button>
    </fieldset><p role="status">{busy ? "Leyendo documentos y preparando propuesta…" : message}</p>
  </details>;
}

function H5ProviderConfirmation({ data, payment, onRefresh }: { data: any; payment: any; onRefresh: () => Promise<void> }) {
  const [selected, setSelected] = useState(""); const [confirmed, setConfirmed] = useState(false); const [busy, setBusy] = useState(false); const [message, setMessage] = useState("");
  const choices = (data.provider_results || []).flatMap((result: any) => {
    if (result.payment_revision_id !== payment.currentRevision.id || !["APLICA_SIN_AVISO", "APLICA_CON_AVISO"].includes(result.applicability)) return [];
    return (payment.currentRevision.parties || []).filter((party: any) => party.role === "PROVIDER_RESOURCE" && party.compareciente_id === result.subject_compareciente_id).map((party: any) => ({ result, party, key: `${result.id}:${party.expediente_compareciente_id}` }));
  });
  if (!choices.length) return <p>No hay una determinación verificada de proveedor aplicable a esta revisión. No se asignarán roles automáticamente.</p>;
  return <details className={styles.h5Editor}><summary>Confirmar rol adicional de proveedor de recursos</summary><form onSubmit={(event) => {
    event.preventDefault(); const choice = choices.find((item: any) => item.key === selected); if (!choice) return;
    setBusy(true); setMessage(""); void complianceService.confirmH5Provider(payment.currentRevision.id, choice.party.expediente_compareciente_id, { rule_result_id: choice.result.id, confirm: true }).then(onRefresh).catch((error) => setMessage(error.message)).finally(() => setBusy(false));
  }}>
    <label>Persona y determinación aplicable<select disabled={busy} required value={selected} onChange={(event) => { setSelected(event.target.value); setConfirmed(false); }}><option value="">Seleccionar determinación</option>{choices.map((choice: any, index: number) => <option key={choice.key} value={choice.key}>{data.provider_candidates?.find((item: any) => item.id === choice.party.expediente_compareciente_id)?.compareciente?.nombre_busqueda || "Persona vinculada"} · determinación {index + 1}</option>)}</select></label>
    <p>Se añadirá el rol sin sustituir comparecencias existentes. Se reutilizarán las consultas de listas y la evidencia documental del expediente.</p>
    <label className={styles.h5Check}><input type="checkbox" checked={confirmed} disabled={busy} onChange={(event) => setConfirmed(event.target.checked)} />Confirmo la vinculación adicional sustentada en esta determinación.</label>
    <button disabled={!selected || !confirmed || busy}>Confirmar rol adicional</button><p role="status">{busy ? "Confirmando…" : message}</p>
  </form></details>;
}

function humanProvider(value: unknown) {
  const labels: Record<string, string> = {
    LEGAL: "jurídico",
    DOC: "documental",
    LST: "listas",
    BC: "beneficiario controlador",
    CUE: "cuestionario",
    PAG: "pagos",
    FIR: "firma",
    AVI: "avisos",
  };
  return labels[String(value || "")] || "por determinar";
}

function humanEvent(value: unknown) {
  const labels: Record<string, string> = {
    EVALUACION_LEGAL_H1_CREADA: "Evaluación jurídica creada",
    REEVALUACION_CREADA: "Reevaluación creada",
    EVALUACION_CREADA: "Evaluación creada",
  };
  return labels[String(value || "")] || "Evento de cumplimiento";
}

function LegalFoundation({ text: foundation }: { text: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <button
        type="button"
        className={styles.foundationToggle}
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
      >
        Ver fundamento
      </button>
      {open && <p className={styles.foundationText}>{foundation}</p>}
    </div>
  );
}

function WorkspaceSection({
  id,
  number,
  icon: Icon,
  title,
  subtitle,
  children,
}: any) {
  return (
    <section className={styles.workspaceSection} id={id}>
      <header>
        <span>{number}</span>
        <Icon />
        <div>
          <h2>{title}</h2>
          <p>{subtitle}</p>
        </div>
      </header>
      <div className={styles.sectionBody}>{children}</div>
    </section>
  );
}
function KeyGrid({ items }: { items: Array<[string, unknown]> }) {
  return (
    <dl className={styles.keyGrid}>
      {items.map(([label, value]) => (
        <div key={label}>
          <dt>{label}</dt>
          <dd>
            {value == null || value === "" ? "Por determinar" : String(value)}
          </dd>
        </div>
      ))}
    </dl>
  );
}
function SourceNote({ result }: any) {
  return (
    <div className={styles.sourceNote}>
      <Link2 />
      <div>
        <strong>Fuente normativa verificada</strong>
        <p>
          {result.version_normativa || "Versión por determinar"} · consultada el
          17 de agosto de 2026.
        </p>
        <a
          href={
            result.uma?.sourceUrl ||
            "https://www.diputados.gob.mx/LeyesBiblio/pdf/LFPIORPI.pdf"
          }
          target="_blank"
          rel="noreferrer"
        >
          Abrir fuente oficial <ExternalLink />
        </a>
      </div>
    </div>
  );
}
function Restricted() {
  return (
    <div className={styles.restrictedInline}>
      <ShieldAlert />
      <p>
        Tu permiso permite ver la evaluación, pero no estos datos sensibles.
      </p>
    </div>
  );
}
function EmptyLine({ text: label }: { text: string }) {
  return (
    <div className={styles.emptyLine}>
      <FileCheck2 />
      <p>{label}</p>
    </div>
  );
}
