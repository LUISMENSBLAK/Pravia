import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { H5PaymentEditor, H5PaymentVerification } from "../features/compliance/components/H5PaymentEditor";
import { complianceService } from "../features/compliance/compliance.service";
vi.mock("../features/compliance/compliance.service", () => ({ complianceService: {
  saveH5Payment: vi.fn(), confirmH5PaymentProposal: vi.fn(), verifyH5Payment: vi.fn(),
  saveH5Questionnaire: vi.fn(), ensureH5Questionnaires: vi.fn(),
  confirmH5Provider: vi.fn(),
} }));
beforeEach(() => vi.clearAllMocks());
import {
  H5Payments,
  H5Questionnaires,
} from "../features/compliance/ComplianceReviewPage";

const workspace = {
  configuration: { questionnaire_definitions: 1, risk_methodologies: 1 },
  questionnaires: [
    {
      id: "cue-1",
      scope: "GENERAL",
      targetCompareciente: null,
      requirement: { label: "Cuestionario general", status: "PENDIENTE" },
      currentRevision: {
        status: "DRAFT",
        completeness: "INCOMPLETE",
        evaluation_status: "PENDING",
        revision_number: 2,
      },
    },
  ],
  payments: [
    {
      id: "pag-1",
      currentRevision: {
        amount_original: "1000.10",
        currency_original: "MXN",
        method_raw: "Transferencia declarada",
        payment_date: "2026-09-03T12:00:00.000Z",
        account_last4: "4321",
        status: "CONFIRMED",
        scope: "EXPLICIT_ACT_SET",
        verifications: [{ status: "OBSERVATION" }],
      },
    },
  ],
  provider_candidates: [{ id: "party-1", es_proveedor_recursos: true }],
  legacy: { ambiguous_payments_preserved: 1 },
};

describe("H5 CUM-CUE/PAG frontend", () => {
  it("uses the canonical provider result subject to offer human confirmation", async () => {
    const refresh = vi.fn().mockResolvedValue(undefined);
    vi.mocked(complianceService.confirmH5Provider).mockResolvedValue({});
    const data = { ...workspace, is_current: true, review_id: "review-test", provider_results: [{ id: "result-test", payment_revision_id: "revision-test", subject_compareciente_id: "person-test", applicability: "APLICA_SIN_AVISO" }],
      provider_candidates: [{ id: "relation-test", compareciente: { nombre_busqueda: "Persona sintética" } }], payments: [{ id: "payment-test", currentRevision: { id: "revision-test", status: "CONFIRMED", parties: [{ role: "PROVIDER_RESOURCE", compareciente_id: "person-test", expediente_compareciente_id: "relation-test" }] } }] };
    render(<H5Payments data={data} permissions={{ confirm: true, provider: true }} onRefresh={refresh} />);
    fireEvent.click(screen.getByText("Confirmar rol adicional de proveedor de recursos"));
    fireEvent.change(screen.getByLabelText("Persona y determinación aplicable"), { target: { value: "result-test:relation-test" } });
    fireEvent.click(screen.getByRole("checkbox", { name: /Confirmo la vinculación adicional/ }));
    fireEvent.click(screen.getByRole("button", { name: "Confirmar rol adicional" }));
    await waitFor(() => expect(refresh).toHaveBeenCalledOnce());
    expect(complianceService.confirmH5Provider).toHaveBeenCalledWith("revision-test", "relation-test", { rule_result_id: "result-test", confirm: true });
  });
  it("does not present a historical match as current after a source change", () => {
    render(<H5Payments data={{ ...workspace, payments: [{ id: "payment-test", currentRevision: { verifications: [{ status: "MATCH", stale: true }] } }] }} />);
    expect(screen.getByText("Desactualizado")).toBeInTheDocument();
    expect(screen.queryByText("Coincide")).not.toBeInTheDocument();
  });
  it("invalidates human approval when a payment party is added or removed", () => {
    render(<H5PaymentEditor data={{ review_id: "review-test" }} canConfirm onRefresh={vi.fn()} />);
    const checkbox = screen.getByRole("checkbox", { name: /He revisado los datos/ });
    fireEvent.click(checkbox); fireEvent.click(screen.getByText("Añadir persona al pago"));
    expect(checkbox).not.toBeChecked();
    fireEvent.click(checkbox); fireEvent.click(screen.getByText("Quitar persona 1"));
    expect(checkbox).not.toBeChecked();
  });
  it("presents missing configured content honestly without inventing questions or risk", () => {
    render(
      <H5Questionnaires
        data={{
          ...workspace,
          questionnaires: [],
          configuration: {
            questionnaire_definitions: 0,
            risk_methodologies: 0,
          },
        }}
      />,
    );
    expect(screen.getByText("Configuración pendiente")).toBeInTheDocument();
    expect(
      screen.getByText(/no inventa preguntas ni una calificación/i),
    ).toBeInTheDocument();
  });

  it("keeps a pinned questionnaire readable after its definition is retired", () => {
    render(<H5Questionnaires data={{ ...workspace, configuration: { questionnaire_definitions: 0 } }} />);
    expect(screen.getByText("Cuestionario general")).toBeInTheDocument();
    expect(screen.queryByText("Configuración pendiente")).not.toBeInTheDocument();
  });
  it("shows the configured human risk output without exposing its technical code", () => {
    render(<H5Questionnaires data={{ ...workspace, questionnaires: [{ ...workspace.questionnaires[0], currentRevision: { ...workspace.questionnaires[0].currentRevision, evaluation_status: "EVALUATED", evaluation_snapshot: { output_code: "SYNTHETIC_INTERNAL_CODE", output_label: "Clasificación configurada sintética" } } }] }} />);
    expect(screen.getByText("Clasificación configurada sintética")).toBeInTheDocument();
    expect(screen.queryByText("SYNTHETIC_INTERNAL_CODE")).not.toBeInTheDocument();
  });

  it("does not expose sensitive questionnaires or payments when redacted", () => {
    render(<><H5Questionnaires data={{ ...workspace, sensitiveRedacted: true }} /><H5Payments data={{ ...workspace, sensitiveRedacted: true }} /></>);
    expect(screen.queryByText("Terminación 4321")).not.toBeInTheDocument();
    expect(screen.queryByText("Cuestionario general")).not.toBeInTheDocument();
    expect(screen.queryByText("Registrar pago de la operación")).not.toBeInTheDocument();
  });

  it("shows large exact monetary values without Number rounding", () => {
    render(<H5Payments data={{ ...workspace, payments: [{ id: "large", currentRevision: { amount_original: "90071992547409.123456", currency_original: "MXN" } }] }} />);
    expect(screen.getByText("90,071,992,547,409.123456 MXN")).toBeInTheDocument();
  });

  it("requires human confirmation, keeps it checked, and invalidates it on a fact change", async () => {
    const refresh = vi.fn().mockResolvedValue(undefined);
    vi.mocked(complianceService.saveH5Payment).mockResolvedValue({});
    render(<H5PaymentEditor data={{ review_id: "review-test" }} canConfirm onRefresh={refresh} />);
    fireEvent.click(screen.getByText("Registrar pago de la operación"));
    const confirm = screen.getByRole("button", { name: "Confirmar revisión del pago" });
    const checkbox = screen.getByRole("checkbox", { name: /He revisado los datos/ });
    expect(confirm).toBeDisabled();
    fireEvent.click(checkbox);
    expect(checkbox).toBeChecked(); expect(confirm).toBeEnabled();
    fireEvent.change(screen.getByLabelText("Importe original", { exact: true }), { target: { value: "123.456789" } });
    expect(confirm).toBeDisabled();
    fireEvent.click(checkbox); fireEvent.click(confirm);
    await waitFor(() => expect(refresh).toHaveBeenCalledOnce());
    expect(complianceService.saveH5Payment).toHaveBeenCalledWith("review-test", expect.objectContaining({ amount_original: "123.456789", confirm: true, field_states: { amount_original: "VALUE" } }));
  });

  it("does not offer confirmation without review authority and never saves an AI proposal on render", () => {
    render(<H5PaymentEditor data={{}} proposal={{ id: "proposal-test", content: { amount_original: "1.00" } }} canConfirm={false} onRefresh={vi.fn()} />);
    expect(screen.queryByRole("button", { name: "Confirmar revisión del pago" })).not.toBeInTheDocument();
    expect(complianceService.saveH5Payment).not.toHaveBeenCalled();
    expect(complianceService.confirmH5PaymentProposal).not.toHaveBeenCalled();
  });

  it("sends the selected instrument checksum and exact human facts, not derived price", async () => {
    const refresh = vi.fn().mockResolvedValue(undefined);
    vi.mocked(complianceService.verifyH5Payment).mockResolvedValue({});
    render(<H5PaymentVerification data={{ project_versions: [{ id: "project-test", nombre_original: "Proyecto sintético", checksum_sha256: "checksum-test" }] }} payment={{ currentRevision: { id: "revision-test" } }} onRefresh={refresh} />);
    fireEvent.click(screen.getByText("Verificar contra proyecto o escritura"));
    fireEvent.change(screen.getByLabelText("Proyecto o escritura"), { target: { value: "project-test" } });
    for (const [name, value] of [["Contraprestación confirmada", "1200"], ["Moneda de comparación (ISO)", "MXN"], ["Pagado declarado en instrumento", "1000"], ["Pendiente declarado en instrumento", "200"]]) fireEvent.change(screen.getByLabelText(name), { target: { value } });
    fireEvent.click(screen.getByRole("checkbox")); fireEvent.click(screen.getByRole("button", { name: "Registrar verificación" }));
    await waitFor(() => expect(refresh).toHaveBeenCalledOnce());
    expect(complianceService.verifyH5Payment).toHaveBeenCalledWith("revision-test", expect.objectContaining({ project_document_id: "project-test", project_document_checksum: "checksum-test", consideration_amount: "1200", instrument_paid: "1000", instrument_pending: "200", confirm: true }));
  });

  it("shows questionnaire scope, backend completeness, evaluation and immutable revision number", () => {
    render(<H5Questionnaires data={workspace} />);
    expect(screen.getByText("Cuestionario general")).toBeInTheDocument();
    expect(
      screen.getByText("Alcance general del expediente"),
    ).toBeInTheDocument();
    expect(screen.getByText("Incompleto")).toBeInTheDocument();
    expect(screen.getByText("Pendiente")).toBeInTheDocument();
    expect(screen.getByText("v2")).toBeInTheDocument();
    expect(
      screen.queryByText(/GENERAL|INCOMPLETE|PENDING/),
    ).not.toBeInTheDocument();
  });

  it("shows original amount/currency, masked account, verification and multi-act scope", () => {
    render(<H5Payments data={workspace} />);
    expect(screen.getByText(/1,000\.10 MXN/)).toBeInTheDocument();
    expect(screen.getByText("Terminación 4321")).toBeInTheDocument();
    expect(screen.getByText("Observación")).toBeInTheDocument();
    expect(screen.getByText("Actos seleccionados")).toBeInTheDocument();
    expect(
      screen.queryByText(/account_fingerprint|43214321/),
    ).not.toBeInTheDocument();
  });

  it("preserves ambiguous legacy records for human classification and additional provider role", () => {
    render(<H5Payments data={workspace} />);
    expect(
      screen.getByText(
        /1 registros históricos preservados que requieren clasificación humana/i,
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        /1 confirmados · el rol adicional no sustituye su comparecencia/i,
      ),
    ).toBeInTheDocument();
  });

  it("keeps empty payment state explicit", () => {
    render(
      <H5Payments
        data={{
          ...workspace,
          payments: [],
          provider_candidates: [],
          legacy: { ambiguous_payments_preserved: 0 },
        }}
      />,
    );
    expect(
      screen.getByText("No hay pagos versionados en este expediente."),
    ).toBeInTheDocument();
    expect(screen.getByText(/0 confirmados/)).toBeInTheDocument();
  });
});
