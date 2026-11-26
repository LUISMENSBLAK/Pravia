import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, it, expect, vi } from "vitest";
import {
  KnowledgeDocumentUpload,
  KnowledgeVersionReview,
} from "../features/settings/knowledge/KnowledgeDocumentUpload";
const mocks = vi.hoisted(() => ({
  uploadKnowledgeDocument: vi.fn(),
  knowledgeVersion: vi.fn(),
  verifyKnowledgeVersion: vi.fn(),
}));
vi.mock("../features/settings/settings.service", () => ({
  settingsService: mocks,
}));
beforeEach(() => {
  vi.clearAllMocks();
  mocks.uploadKnowledgeDocument.mockResolvedValue({
    verification_status: "PENDIENTE",
  });
});
describe("Biblioteca carga y revisión documental", () => {
  it("permite cargar una ley fuera de criterios y nunca la verifica por subirla", async () => {
    const u = userEvent.setup(),
      saved = vi.fn();
    render(<KnowledgeDocumentUpload onClose={() => {}} onSaved={saved} />);
    await u.upload(
      screen.getByLabelText("Archivo jurídico"),
      new File(["Artículo 1. QA"], "ley.txt", { type: "text/plain" }),
    );
    await u.type(screen.getByLabelText("Título"), "Ley QA");
    await u.type(
      screen.getByLabelText("Edición / etiqueta de versión"),
      "QA 2026",
    );
    expect((screen.getByLabelText('Archivo jurídico') as HTMLInputElement).files).toHaveLength(1);
    expect(screen.getByRole('button',{name:'Cargar como pendiente'})).toBeEnabled();
    // JSDOM marks userEvent's populated file input as valueMissing; the real
    // native submit button/required constraint is covered in Chrome QA.
    fireEvent.submit(screen.getByRole('button',{name:'Cargar como pendiente'}).closest('form')!);
    await waitFor(() => expect(saved).toHaveBeenCalledOnce());
    const form = mocks.uploadKnowledgeDocument.mock.calls[0][0] as FormData;
    expect(form.get("title")).toBe("Ley QA");
    expect(form.get("file")).toBeInstanceOf(File);
    expect(mocks.verifyKnowledgeVersion).not.toHaveBeenCalled();
  });
  it("mantiene datos y explica un fallo de carga sin éxito falso", async () => {
    mocks.uploadKnowledgeDocument.mockRejectedValue(
      Error("El PDF está protegido."),
    );
    const u = userEvent.setup(),
      saved = vi.fn();
    render(
      <KnowledgeDocumentUpload
        source={{ id: "s", title: "Ley QA" }}
        onClose={() => {}}
        onSaved={saved}
      />,
    );
    await u.upload(
      screen.getByLabelText("Archivo jurídico"),
      new File(["pdf"], "ley.pdf", { type: "application/pdf" }),
    );
    await u.type(
      screen.getByLabelText("Edición / etiqueta de versión"),
      "Otra edición",
    );
    fireEvent.submit(screen.getByRole('button',{name:'Cargar como pendiente'}).closest('form')!);
    expect(await screen.findByRole("alert")).toHaveTextContent("protegido");
    expect(saved).not.toHaveBeenCalled();
    expect(screen.getByLabelText("Edición / etiqueta de versión")).toHaveValue(
      "Otra edición",
    );
  });
  it("exige texto, fecha y cotejo explícito antes de verificar", async () => {
    mocks.knowledgeVersion.mockResolvedValue({
      content_text: "Artículo 1. QA",
    });
    mocks.verifyKnowledgeVersion.mockResolvedValue({});
    const u = userEvent.setup(),
      done = vi.fn();
    render(
      <KnowledgeVersionReview
        sourceId="s"
        version={{ id: "v", label: "QA", verification_status: "PENDIENTE" }}
        canManage
        onClose={() => {}}
        onVerified={done}
      />,
    );
    const button = await screen.findByRole("button", {
      name: "Verificar y habilitar para consultas",
    });
    expect(button).toBeDisabled();
    await u.type(screen.getByLabelText("Vigente desde"), "2026-01-01");
    await u.click(screen.getByRole("checkbox"));
    await u.click(button);
    await waitFor(() =>
      expect(mocks.verifyKnowledgeVersion).toHaveBeenCalledWith(
        "s",
        "v",
        "2026-01-01",
      ),
    );
  });
  it("un lector puede cotejar texto pero no verificarlo", async () => {
    mocks.knowledgeVersion.mockResolvedValue({ content_text: "Artículo QA" });
    render(
      <KnowledgeVersionReview
        sourceId="s"
        version={{ id: "v", label: "QA", verification_status: "PENDIENTE" }}
        canManage={false}
        onClose={() => {}}
        onVerified={() => {}}
      />,
    );
    await screen.findByText("Artículo QA");
    expect(
      screen.queryByRole("button", {
        name: "Verificar y habilitar para consultas",
      }),
    ).not.toBeInTheDocument();
  });
});
