import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({
  catalogActs: vi.fn(),
  catalogAct: vi.fn(),
  catalogSupporting: vi.fn(),
  ensureActConfiguration: vi.fn(),
  createCatalogAct: vi.fn(),
  updateCatalogAct: vi.fn(),
  createCatalogStage: vi.fn(),
  updateCatalogStage: vi.fn(),
  deleteCatalogStage: vi.fn(),
  createCatalogActivity: vi.fn(),
  updateCatalogActivity: vi.fn(),
  setCatalogDependencies: vi.fn(),
  createCatalogException: vi.fn(),
  updateCatalogException: vi.fn(),
  catalogArtifactRoot: vi.fn(),
  createCatalogInstitution: vi.fn(),
  catalogExplorer: vi.fn(),
  createCatalogFolder: vi.fn(),
  createCatalogArtifact: vi.fn(),
  updateCatalogArtifact: vi.fn(),
  addCatalogArtifactVersion: vi.fn(),
  catalogArtifactVersionUrl: vi.fn(),
  catalogActivityConcepts: vi.fn(),
  createCatalogActivityConcept: vi.fn(),
  updateCatalogActivityConcept: vi.fn(),
  addCatalogConceptApplication: vi.fn(),
  inheritCatalogActivityAttribute: vi.fn(),
  duplicateCatalogAct: vi.fn(),
  bootstrapCatalogV2: vi.fn(),
  upsertInstitutionResponseTime: vi.fn(),
  bootstrapCatalogLibraryV4: vi.fn(),
  previewCatalogImport: vi.fn(),
  confirmCatalogImport: vi.fn(),
}));

vi.mock("../features/settings/settings.service", () => ({
  settingsService: api,
}));
vi.mock("../features/auth/AuthProvider", () => ({
  useAuth: () => ({
    user: {
      permissions: [
        "configuracion.catalogos.read",
        "configuracion.actos_tiempos.manage",
        "configuracion.plantillas_formatos.manage",
      ],
    },
  }),
}));

import { ActsTimesCatalog } from "../features/settings/catalogs/ActsTimesCatalog";
import { TemplatesFormatsCatalog } from "../features/settings/catalogs/TemplatesFormatsCatalog";

const activities = [
  {
    id: "activity-a",
    etapa_id: "stage-a",
    nombre: "A",
    descripcion: null,
    duracion_estimada: 2,
    tipo_dias: "HABILES",
    margen_seguridad: 0,
    responsable_rol: null,
    responsable_usuario_id: null,
    aplica_por_defecto: true,
    activa: true,
    dependencias: [],
    excepciones: [],
  },
  {
    id: "activity-b",
    etapa_id: "stage-a",
    nombre: "B",
    descripcion: null,
    duracion_estimada: 3,
    tipo_dias: "HABILES",
    margen_seguridad: 1,
    responsable_rol: null,
    responsable_usuario_id: null,
    aplica_por_defecto: true,
    activa: true,
    dependencias: [],
    excepciones: [],
  },
];
const actDetail: any = {
  id: "act-a",
  nombre: "Compraventa",
  descripcion: "Acto canónico",
  activo: true,
  complete: false,
  configuration: {
    id: "config-a",
    activa: true,
    requiere_revision: true,
    revision: 1,
    created_at: "",
    updated_at: "",
    etapas: [
      {
        id: "stage-a",
        nombre: "Prefirma",
        orden: 1,
        activa: true,
        actividades: activities,
      },
    ],
  },
};
const support: any = {
  acts: [
    { id: "act-a", nombre: "Compraventa" },
    { id: "act-b", nombre: "Fideicomiso de administración" },
    { id: "act-c", nombre: "Cancelación de hipoteca" },
    { id: "act-d", nombre: "Sucesorio intestamentario" },
    { id: "act-e", nombre: "Protocolización de acta" },
    { id: "act-f", nombre: "Constitución de servidumbre" },
  ],
  notarias: [{ id: "notary-a", nombre: "Notaría A", numero_notaria: "45" }],
  institutions: [{ id: "bank-a", nombre: "Banco A", tipo: "BANCO" }],
  stages: [
    {
      id: "stage-a",
      nombre: "Prefirma",
      configuracion: { tipo_acto_id: "act-a" },
    },
  ],
  users: [],
  roles: ["DIRECCION"],
  characters: [],
};

describe("Catálogos contractuales accesibles", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.catalogActs.mockResolvedValue({
      data: [actDetail],
      metrics: { total: 1, complete: 0, edited: 0, pending: 1 },
    });
    api.catalogAct.mockResolvedValue(actDetail);
    api.catalogSupporting.mockResolvedValue(support);
    api.catalogActivityConcepts.mockResolvedValue([]);
    api.updateCatalogActivity.mockResolvedValue({});
    api.setCatalogDependencies.mockResolvedValue({});
    api.catalogArtifactRoot.mockResolvedValue({
      notaria: support.notarias[0],
      institutions: support.institutions,
    });
    api.previewCatalogImport.mockResolvedValue({
      total_files: 1,
      total_bytes: 10,
      requires_confirmation: true,
      persisted: false,
      folders: [],
      files: [
        {
          path: "machote.docx",
          name: "machote.docx",
          extension: "docx",
          mimeType:
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
          checksum: "abc",
          size: 10,
          folders: [],
        },
      ],
    });
    api.catalogExplorer.mockImplementation(
      async (
        _ownerType: string,
        _ownerId: string,
        type: string,
        folderId?: string | null,
      ) => ({
        owner_type: "NOTARIA",
        owner_id: "notary-a",
        type,
        folder: folderId
          ? {
              id: folderId,
              tipo: type,
              nombre: folderId === "folder-a" ? "A" : "B",
              parent_id: folderId === "folder-b" ? "folder-a" : null,
              created_at: "",
            }
          : null,
        breadcrumbs:
          folderId === "folder-b"
            ? [
                { id: "folder-a", name: "A" },
                { id: "folder-b", name: "B" },
              ]
            : folderId === "folder-a"
              ? [{ id: "folder-a", name: "A" }]
              : [],
        folders: folderId
          ? folderId === "folder-a"
            ? [
                {
                  id: "folder-b",
                  tipo: type,
                  nombre: "B",
                  parent_id: "folder-a",
                  created_at: "",
                },
              ]
            : []
          : [
              {
                id: "folder-a",
                tipo: type,
                nombre: "A",
                parent_id: null,
                created_at: "",
              },
            ],
        artifacts: folderId
          ? []
          : [
              {
                id: "artifact-a",
                tipo: type,
                propietario_tipo: "NOTARIA",
                nombre: "Machote",
                descripcion: null,
                activo: true,
                actos: [{ tipo_acto_id: "act-a" }],
                reglas: [{ obligatoria: false, multiplicidad: "EXPEDIENTE" }],
                versiones: [
                  {
                    id: "v1",
                    version: 1,
                    nombre_original: "machote.docx",
                    mime_type:
                      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
                    size_bytes: 10,
                    created_at: "",
                  },
                ],
              },
            ],
        allows_templates: true,
      }),
    );
  });

  it("permite por teclado abrir acto, editar actividad y guardar dependencias con diálogo etiquetado", async () => {
    const user = userEvent.setup();
    render(<ActsTimesCatalog />);
    await user.click(
      await screen.findByRole("button", { name: /Compraventa/ }),
    );
    await user.click(
      await screen.findByRole("button", { name: "Editar actividad A" }),
    );
    const editDialog = screen.getByRole("dialog", {
      name: "Editar actividad o hito",
    });
    expect(editDialog).toHaveAttribute("aria-modal", "true");
    await waitFor(() => expect(screen.getByLabelText("Nombre")).toHaveFocus());
    expect(screen.getByLabelText("Duración estimada")).toBeInTheDocument();
    expect(screen.getByLabelText("Tipo de días")).toBeInTheDocument();
    await user.clear(screen.getByLabelText("Duración estimada"));
    await user.type(screen.getByLabelText("Duración estimada"), "4");
    await user.click(screen.getByRole("button", { name: "Guardar actividad" }));
    await waitFor(() =>
      expect(api.updateCatalogActivity).toHaveBeenCalledWith(
        "activity-a",
        expect.objectContaining({ duracion_estimada: 4 }),
      ),
    );

    await user.click(
      screen.getByRole("button", { name: "0 dependencias de A" }),
    );
    expect(
      screen.getByRole("dialog", { name: "Dependencias de A" }),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("checkbox", { name: /B/ }));
    await user.click(
      screen.getByRole("button", { name: "Guardar dependencias" }),
    );
    await waitFor(() =>
      expect(api.setCatalogDependencies).toHaveBeenCalledWith("activity-a", [
        "activity-b",
      ]),
    );
  });

  it("navega por la Notaría única, carpetas y expone importación/versionado accesibles", async () => {
    const user = userEvent.setup();
    render(<TemplatesFormatsCatalog />);
    expect(
      await screen.findByRole("heading", { name: "Notaría" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: "Notarías" }),
    ).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /Notaría 45/ }));
    await user.click(screen.getByRole("button", { name: /MACHOTE JURÍDICO/ }));
    await user.click(await screen.findByRole("button", { name: /A Carpeta/ }));
    await user.click(await screen.findByRole("button", { name: /B Carpeta/ }));
    const breadcrumb = await screen.findByRole("navigation", {
      name: "Ruta de carpetas",
    });
    expect(breadcrumb).toHaveTextContent("Plantillas y formatos");
    expect(breadcrumb).toHaveTextContent("A");
    expect(breadcrumb).toHaveTextContent("B");

    await user.click(
      screen.getByRole("button", { name: "Importar archivos / ZIP" }),
    );
    expect(
      screen.getByRole("dialog", { name: "Importar archivos o ZIP" }),
    ).toHaveAttribute("aria-modal", "true");
    expect(
      screen.getByLabelText(/^Archivos o ZIP/, {
        selector: 'input[type="file"]',
      }),
    ).toHaveAttribute("multiple");
    await user.keyboard("{Escape}");
    expect(
      screen.queryByRole("dialog", { name: "Importar archivos o ZIP" }),
    ).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Plantillas" }));
    await user.click(screen.getByRole("button", { name: "Nueva versión" }));
    expect(
      screen.getByRole("dialog", { name: "Nueva versión · Machote" }),
    ).toBeInTheDocument();
    expect(
      screen.getByLabelText(/^Archivo/, { selector: 'input[type="file"]' }),
    ).toBeInTheDocument();
  });

  it("mantiene la estructura del catálogo con skeleton accesible y sin textos de carga crudos", async () => {
    api.catalogActs.mockReturnValue(new Promise(() => undefined));
    render(<ActsTimesCatalog />);
    expect(
      screen.getByRole("status", { name: "Cargando catálogo de actos" }),
    ).toBeInTheDocument();
    expect(screen.queryByText(/Cargando módulo/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Cargando catálogo…/i)).not.toBeInTheDocument();
  });

  it("presenta cantidades singulares con concordancia humana", async () => {
    api.catalogActivityConcepts.mockResolvedValue([
      {
        id: "concept-a",
        nombre: "Concepto breve",
        descripcion: null,
        duracion_estimada: 1,
        tipo_dias: "HABILES",
        margen_seguridad: 0,
        naturaleza: "INTERNA",
        fuente_tiempo: "GENERAL",
        activa: true,
        revision: 1,
      },
    ]);
    api.catalogSupporting.mockResolvedValue({
      ...support,
      institutions: [
        {
          id: "bank-a",
          nombre: "Banco A",
          tipo: "BANCO",
          tipos_respuesta: [
            {
              id: "response-a",
              nombre: "Respuesta",
              duracion: 1,
              tipo_dias: "HABILES",
            },
          ],
        },
      ],
    });
    render(<ActsTimesCatalog />);
    expect(await screen.findByText("1 activo")).toBeInTheDocument();
    expect(screen.getByText("1 día hábil · revisión 1")).toBeInTheDocument();
    expect(
      screen.getByText("BANCO · 1 tiempo configurado"),
    ).toBeInTheDocument();
    expect(screen.getByText("Respuesta: 1 día hábil")).toBeInTheDocument();
    expect(screen.getByText("1 etapa · Sin familia")).toBeInTheDocument();
    expect(
      screen.queryByText(/1 días|1 etapas|1 tiempos configurados/),
    ).not.toBeInTheDocument();
  });

  it("precarga el tiempo institucional persistido al abrir su configuración", async () => {
    const user = userEvent.setup();
    api.catalogSupporting.mockResolvedValue({
      ...support,
      institutions: [
        {
          id: "bank-a",
          nombre: "Banco A",
          tipo: "BANCO",
          tipos_respuesta: [
            {
              id: "response-a",
              codigo: "VOBO_ACREEDOR",
              nombre: "Vo.Bo. acreedor",
              duracion: 10,
              tipo_dias: "HABILES",
              margen_seguridad: 2,
              activa: true,
              revision: 3,
            },
          ],
        },
      ],
    });
    render(<ActsTimesCatalog />);
    await user.click(
      await screen.findByRole("button", { name: "Configurar tiempo" }),
    );
    expect(
      screen.getByRole("dialog", { name: "Tiempo de respuesta" }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Tipo de respuesta")).toHaveValue(
      "Vo.Bo. acreedor",
    );
    expect(screen.getByLabelText("Duración")).toHaveValue(10);
    expect(screen.getByLabelText("Tipo de días")).toHaveValue("HABILES");
    expect(screen.getByLabelText("Margen")).toHaveValue(2);
  });

  it("ofrece un error contextual y reintento sin exponer detalles técnicos", async () => {
    api.catalogArtifactRoot.mockRejectedValueOnce(
      new Error("GET /api/catalogs 500 prisma"),
    );
    const user = userEvent.setup();
    render(<TemplatesFormatsCatalog />);
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "No pudimos cargar el repositorio privado.",
    );
    expect(
      screen.queryByText(/prisma|\/api\/catalogs|500/i),
    ).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Reintentar" }));
    expect(
      await screen.findByRole("heading", { name: "Notaría" }),
    ).toBeInTheDocument();
  });

  it("analiza importación y expone asignación masiva, excepción individual y metadatos jurídicos", async () => {
    const user = userEvent.setup();
    render(<TemplatesFormatsCatalog />);
    await user.click(await screen.findByRole("button", { name: /Notaría 45/ }));
    await user.click(screen.getByRole("button", { name: /MACHOTE JURÍDICO/ }));
    await user.click(
      await screen.findByRole("button", { name: "Importar archivos / ZIP" }),
    );
    const input = screen.getByLabelText(/^Archivos o ZIP/, {
      selector: 'input[type="file"]',
    });
    await user.upload(
      input,
      new File(["doc"], "machote.docx", {
        type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      }),
    );
    await user.click(screen.getByRole("button", { name: "Analizar" }));
    expect(await screen.findByText("SHA-256 abc")).toBeInTheDocument();
    expect(
      screen.getByRole("group", { name: "Asignación masiva a actos" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("group", { name: "Condiciones jurídicas explícitas" }),
    ).toBeInTheDocument();
    expect(screen.getAllByLabelText("Etapa requerida")).toHaveLength(2);
    expect(screen.getAllByLabelText("Rol de compareciente")).toHaveLength(2);
    expect(screen.getAllByLabelText("Vigencia desde")[0]).toHaveValue("");
    expect(
      screen.getByRole("checkbox", { name: "Obligatorio" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Excepción individual")).toBeInTheDocument();
    expect(
      screen.getByRole("group", { name: "Actos de este archivo" }),
    ).toBeInTheDocument();
  });

  it("muestra dentro del diálogo el error de un archivo no permitido", async () => {
    api.previewCatalogImport.mockRejectedValueOnce(
      new Error("Tipo de archivo no permitido."),
    );
    const user = userEvent.setup();
    render(<TemplatesFormatsCatalog />);
    await user.click(await screen.findByRole("button", { name: /Notaría 45/ }));
    await user.click(screen.getByRole("button", { name: /MACHOTE JURÍDICO/ }));
    await user.click(
      await screen.findByRole("button", { name: "Importar archivos / ZIP" }),
    );
    const dialog = screen.getByRole("dialog", {
      name: "Importar archivos o ZIP",
    });
    const input = screen.getByLabelText(/^Archivos o ZIP/, {
      selector: 'input[type="file"]',
    });
    fireEvent.change(input, {
      target: {
        files: [
          new File(["invalid"], "archivo.exe", {
            type: "application/octet-stream",
          }),
        ],
      },
    });
    await user.click(screen.getByRole("button", { name: "Analizar" }));
    expect(await within(dialog).findByRole("alert")).toHaveTextContent(
      "Tipo de archivo no permitido.",
    );
    expect(api.confirmCatalogImport).not.toHaveBeenCalled();
  });

  it("usa un control de cierre accesible y conserva la navegación profunda etiquetada", async () => {
    const user = userEvent.setup();
    render(<TemplatesFormatsCatalog />);
    await user.click(await screen.findByRole("button", { name: /Notaría 45/ }));
    await user.click(screen.getByRole("button", { name: /MACHOTE JURÍDICO/ }));
    await user.click(await screen.findByRole("button", { name: /A Carpeta/ }));
    await user.click(await screen.findByRole("button", { name: /B Carpeta/ }));
    expect(screen.getByRole("button", { name: "B" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    await user.click(
      screen.getAllByRole("button", { name: "Nueva carpeta" })[0],
    );
    expect(
      screen.getByRole("button", { name: "Cerrar diálogo" }),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Cerrar diálogo" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});
