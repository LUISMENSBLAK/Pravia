import { describe, it, expect, vi, beforeEach } from "vitest";
import { PDFDocument } from "pdf-lib";
import {
  KnowledgeDocumentService,
  legalDocumentText,
} from "./knowledgeDocument.service";
const mocks = vi.hoisted(() => ({
  upload: vi.fn(),
  remove: vi.fn(),
  url: vi.fn(),
}));
vi.mock("../storage/storage.service", () => ({
  uploadFile: mocks.upload,
  deleteFile: mocks.remove,
  getSignedUrl: mocks.url,
}));
const file = (data: Buffer, name = "ley.txt", mime = "text/plain") =>
  ({
    buffer: data,
    size: data.length,
    originalname: name,
    mimetype: mime,
  }) as Express.Multer.File;
const actor = { id: "qa", organizationId: "tenant-a" };
beforeEach(() => {
  vi.clearAllMocks();
  mocks.remove.mockResolvedValue(undefined);
});
describe("Carga jurídica privada y pendiente", () => {
  it("lee TXT sin inventar contenido", async () =>
    expect(
      await legalDocumentText(
        file(Buffer.from("Artículo 1. Fuente QA sin validez.")),
      ),
    ).toMatchObject({
      mime: "text/plain",
      text: "Artículo 1. Fuente QA sin validez.",
    }));
  it("PDF sin texto no se convierte en texto por sus marcadores de página", async () => {
    const pdf = await PDFDocument.create();
    pdf.addPage();
    expect(
      (
        await legalDocumentText(
          file(Buffer.from(await pdf.save()), "escaneo.pdf", "application/pdf"),
        )
      ).text.trim(),
    ).toBe("");
  });
  it("rechaza binario renombrado y formato no admitido", async () => {
    await expect(
      legalDocumentText(file(Buffer.from([0, 1, 2]))),
    ).rejects.toMatchObject({ code: "KNOW_FILE_INVALID" });
    await expect(
      legalDocumentText(
        file(Buffer.from("fake"), "fake.pdf", "application/pdf"),
      ),
    ).rejects.toMatchObject({ code: "KNOW_FILE_INVALID" });
  });
  function setup() {
    const tx: any = {
      $executeRaw: vi.fn(),
      $queryRaw:vi.fn(),
      storageProviderRecord:{findUniqueOrThrow:vi.fn().mockResolvedValue({id:'provider'})},
      storageBlobLocation:{findFirstOrThrow:vi.fn().mockResolvedValue({id:'location',blob_id:'blob'}),findFirst:vi.fn().mockResolvedValue({status:'AVAILABLE'})},
      storageBlobReference:{create:vi.fn()},
      knowledgeSource: { create: vi.fn().mockResolvedValue({ id: "source" }) },
      knowledgeSourceVersion: {
        aggregate: vi.fn().mockResolvedValue({ _max: { version: 2 } }),
        create: vi
          .fn()
          .mockImplementation(({ data }) => ({ ...data, id: "version" })),
      },
      knowledgeArticle: { createMany: vi.fn() },
      auditLog: { create: vi.fn() },
    };
    const db: any = {
      knowledgeSource: { findFirst: vi.fn().mockResolvedValue(null) },
      $transaction: vi.fn((cb) => cb(tx)),
    };
    return { tx, db, service: new KnowledgeDocumentService(db) };
  }
  const input = {
    title: "Ley QA",
    jurisdiction: "FEDERAL",
    category: "LEY",
    label: "Edición QA",
    source_url: "https://www.diputados.gob.mx/LeyesBiblio/",
  };
  it("conserva original, SHA, artículos y auditoría sin verificar ni activar", async () => {
    const { tx, service } = setup();
    const result = await service.upload(
      actor,
      input,
      file(Buffer.from("Artículo 1. Documento sintético.")),
    );
    expect(result).toMatchObject({
      version: 3,
      verification_status: "PENDIENTE",
      text_available: true,
    });
    expect(tx.knowledgeSourceVersion.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        organization_id: "tenant-a",
        verification_status: "PENDIENTE",
        review_required: true,
        checksum_sha256: expect.stringMatching(/^[a-f0-9]{64}$/),
        provenance: expect.objectContaining({ text_method: "TEXTO_NATIVO" }),
      }),
    });
    expect(mocks.upload).toHaveBeenCalledWith(
      expect.any(Buffer),
      expect.stringMatching(/^organizations\/tenant-a\/knowledge\//),
      "text/plain",
    );
    expect(tx.knowledgeArticle.createMany).toHaveBeenCalled();
    expect(tx.auditLog.create).toHaveBeenCalled();
  });
  it("no crea una versión en una fuente ajena ni sube bytes", async () => {
    const { service } = setup();
    await expect(
      service.upload(
        actor,
        { ...input, source_id: "foreign" },
        file(Buffer.from("Texto")),
      ),
    ).rejects.toMatchObject({ code: "KNOW_SOURCE_NOT_FOUND" });
    expect(mocks.upload).not.toHaveBeenCalled();
  });
  it("recupera el archivo temporal si la transacción falla", async () => {
    const { db, service } = setup();
    db.$transaction.mockRejectedValue(Error("QA_AUDIT_FAILURE"));
    await expect(
      service.upload(actor, input, file(Buffer.from("Texto QA"))),
    ).rejects.toThrow("QA_AUDIT_FAILURE");
    expect(mocks.remove).toHaveBeenCalledWith(
      expect.stringMatching(/^organizations\/tenant-a\/knowledge\//),
    );
  });
  it("URL javascript no se guarda como procedencia", async () => {
    const { service } = setup();
    await expect(
      service.upload(
        actor,
        { ...input, source_url: "javascript:alert(1)" },
        file(Buffer.from("Texto")),
      ),
    ).rejects.toMatchObject({ code: "KNOW_URL_INVALID" });
    expect(mocks.upload).not.toHaveBeenCalled();
  });
  it("no firma una clave de almacenamiento ajena aunque esté en provenance", async () => {
    const db: any = {
      knowledgeSourceVersion: {
        findFirst: vi
          .fn()
          .mockResolvedValue({
            id: "v",
            provenance: {
              storage_key: "organizations/tenant-b/knowledge/file",
            },
          }),
      },
    };
    await expect(
      new KnowledgeDocumentService(db).detail(actor, "s", "v"),
    ).rejects.toMatchObject({ code: "KNOW_FILE_SCOPE_DENIED" });
    expect(mocks.url).not.toHaveBeenCalled();
  });
  it.each([null, [], "inventario histórico"])("permite revisar versiones históricas sin metadatos de archivo (%j)", async (provenance) => {
    const db: any = { knowledgeSourceVersion: { findFirst: vi.fn().mockResolvedValue({ id: "v", content_text: "Texto histórico", provenance }) } };
    await expect(new KnowledgeDocumentService(db).detail(actor, "s", "v")).resolves.toMatchObject({ content_text: "Texto histórico", url: null, file_name: null });
    expect(mocks.url).not.toHaveBeenCalled();
  });
});
