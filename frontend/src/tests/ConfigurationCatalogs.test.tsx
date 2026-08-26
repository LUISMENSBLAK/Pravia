import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({
  catalogActs: vi.fn(), catalogAct: vi.fn(), catalogSupporting: vi.fn(), ensureActConfiguration: vi.fn(),
  createCatalogAct: vi.fn(), updateCatalogAct: vi.fn(), createCatalogStage: vi.fn(), updateCatalogStage: vi.fn(),
  deleteCatalogStage: vi.fn(), createCatalogActivity: vi.fn(), updateCatalogActivity: vi.fn(),
  setCatalogDependencies: vi.fn(), createCatalogException: vi.fn(), updateCatalogException: vi.fn(),
  catalogArtifactRoot: vi.fn(), createCatalogInstitution: vi.fn(), catalogExplorer: vi.fn(),
  createCatalogFolder: vi.fn(), createCatalogArtifact: vi.fn(), updateCatalogArtifact: vi.fn(),
  addCatalogArtifactVersion: vi.fn(), catalogArtifactVersionUrl: vi.fn(),
}));

vi.mock('../features/settings/settings.service', () => ({ settingsService: api }));
vi.mock('../features/auth/AuthProvider', () => ({
  useAuth: () => ({ user: { permissions: ['configuracion.catalogos.read', 'configuracion.actos_tiempos.manage', 'configuracion.plantillas_formatos.manage'] } }),
}));

import { ActsTimesCatalog } from '../features/settings/catalogs/ActsTimesCatalog';
import { TemplatesFormatsCatalog } from '../features/settings/catalogs/TemplatesFormatsCatalog';

const activities = [
  { id: 'activity-a', etapa_id: 'stage-a', nombre: 'A', descripcion: null, duracion_estimada: 2, tipo_dias: 'HABILES', margen_seguridad: 0, responsable_rol: null, responsable_usuario_id: null, aplica_por_defecto: true, activa: true, dependencias: [], excepciones: [] },
  { id: 'activity-b', etapa_id: 'stage-a', nombre: 'B', descripcion: null, duracion_estimada: 3, tipo_dias: 'HABILES', margen_seguridad: 1, responsable_rol: null, responsable_usuario_id: null, aplica_por_defecto: true, activa: true, dependencias: [], excepciones: [] },
];
const actDetail: any = {
  id: 'act-a', nombre: 'Compraventa', descripcion: 'Acto canónico', activo: true, complete: false,
  configuration: { id: 'config-a', activa: true, requiere_revision: true, revision: 1, created_at: '', updated_at: '', etapas: [{ id: 'stage-a', nombre: 'Prefirma', orden: 1, activa: true, actividades: activities }] },
};
const support: any = {
  acts: [
    { id: 'act-a', nombre: 'Compraventa' },
    { id: 'act-b', nombre: 'Fideicomiso de administración' },
    { id: 'act-c', nombre: 'Cancelación de hipoteca' },
    { id: 'act-d', nombre: 'Sucesorio intestamentario' },
    { id: 'act-e', nombre: 'Protocolización de acta' },
    { id: 'act-f', nombre: 'Constitución de servidumbre' },
  ], notarias: [{ id: 'notary-a', nombre: 'Notaría A', numero_notaria: '45' }],
  institutions: [{ id: 'bank-a', nombre: 'Banco A', tipo: 'BANCO' }], stages: [{ id: 'stage-a', nombre: 'Prefirma', configuracion: { tipo_acto_id: 'act-a' } }],
  users: [], roles: ['DIRECCION'], characters: [],
};

describe('Catálogos contractuales accesibles', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.catalogActs.mockResolvedValue({ data: [actDetail], metrics: { total: 1, complete: 0, edited: 0, pending: 1 } });
    api.catalogAct.mockResolvedValue(actDetail);
    api.catalogSupporting.mockResolvedValue(support);
    api.updateCatalogActivity.mockResolvedValue({});
    api.setCatalogDependencies.mockResolvedValue({});
    api.catalogArtifactRoot.mockResolvedValue({ notarias: support.notarias, institutions: support.institutions });
    api.catalogExplorer.mockImplementation(async (_ownerType: string, _ownerId: string, type: string, folderId?: string | null) => ({
      owner_type: 'NOTARIA', owner_id: 'notary-a', type,
      folder: folderId ? { id: folderId, tipo: type, nombre: folderId === 'folder-a' ? 'A' : 'B', parent_id: folderId === 'folder-b' ? 'folder-a' : null, created_at: '' } : null,
      breadcrumbs: folderId === 'folder-b' ? [{ id: 'folder-a', name: 'A' }, { id: 'folder-b', name: 'B' }] : folderId === 'folder-a' ? [{ id: 'folder-a', name: 'A' }] : [],
      folders: folderId ? (folderId === 'folder-a' ? [{ id: 'folder-b', tipo: type, nombre: 'B', parent_id: 'folder-a', created_at: '' }] : []) : [{ id: 'folder-a', tipo: type, nombre: 'A', parent_id: null, created_at: '' }],
      artifacts: folderId ? [] : [{ id: 'artifact-a', tipo: type, propietario_tipo: 'NOTARIA', nombre: 'Machote', descripcion: null, activo: true, actos: [{ tipo_acto_id: 'act-a' }], reglas: [{ obligatoria: false, multiplicidad: 'EXPEDIENTE' }], versiones: [{ id: 'v1', version: 1, nombre_original: 'machote.docx', mime_type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', size_bytes: 10, created_at: '' }] }],
      allows_templates: true,
    }));
  });

  it('permite por teclado abrir acto, editar actividad y guardar dependencias con diálogo etiquetado', async () => {
    const user = userEvent.setup();
    render(<ActsTimesCatalog />);
    await user.click(await screen.findByRole('button', { name: /Compraventa/ }));
    await user.click(await screen.findByRole('button', { name: 'Editar actividad A' }));
    const editDialog = screen.getByRole('dialog', { name: 'Editar actividad o hito' });
    expect(editDialog).toHaveAttribute('aria-modal', 'true');
    await waitFor(() => expect(screen.getByLabelText('Nombre')).toHaveFocus());
    expect(screen.getByLabelText('Duración estimada')).toBeInTheDocument();
    expect(screen.getByLabelText('Tipo de días')).toBeInTheDocument();
    await user.clear(screen.getByLabelText('Duración estimada'));
    await user.type(screen.getByLabelText('Duración estimada'), '4');
    await user.click(screen.getByRole('button', { name: 'Guardar actividad' }));
    await waitFor(() => expect(api.updateCatalogActivity).toHaveBeenCalledWith('activity-a', expect.objectContaining({ duracion_estimada: 4 })));

    await user.click(screen.getByRole('button', { name: '0 dependencias de A' }));
    expect(screen.getByRole('dialog', { name: 'Dependencias de A' })).toBeInTheDocument();
    await user.click(screen.getByRole('checkbox', { name: /B/ }));
    await user.click(screen.getByRole('button', { name: 'Guardar dependencias' }));
    await waitFor(() => expect(api.setCatalogDependencies).toHaveBeenCalledWith('activity-a', ['activity-b']));
  });

  it('navega por owner, tipo, carpetas y breadcrumb y expone upload/versionado en diálogos accesibles', async () => {
    const user = userEvent.setup();
    render(<TemplatesFormatsCatalog />);
    await user.click(await screen.findByRole('button', { name: /Notaría 45/ }));
    await user.click(screen.getByRole('button', { name: /Plantillas Machotes jurídicos/ }));
    await user.click(await screen.findByRole('button', { name: /A Carpeta/ }));
    await user.click(await screen.findByRole('button', { name: /B Carpeta/ }));
    const breadcrumb = await screen.findByRole('navigation', { name: 'Ruta de carpetas' });
    expect(breadcrumb).toHaveTextContent('Plantillas y formatos');
    expect(breadcrumb).toHaveTextContent('A');
    expect(breadcrumb).toHaveTextContent('B');

    await user.click(screen.getByRole('button', { name: 'Plantillas' }));
    await user.click(await screen.findByRole('button', { name: 'Nueva plantilla' }));
    expect(screen.getByRole('dialog', { name: 'Nueva plantilla' })).toHaveAttribute('aria-modal', 'true');
    await waitFor(() => expect(screen.getByLabelText('Nombre')).toHaveFocus());
    expect(screen.getByLabelText(/^Archivo maestro/, { selector: 'input[type="file"]' })).toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Actos aplicables' })).toBeInTheDocument();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog', { name: 'Nueva plantilla' })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Nueva versión' }));
    expect(screen.getByRole('dialog', { name: 'Nueva versión · Machote' })).toBeInTheDocument();
    expect(screen.getByLabelText(/^Archivo de nueva versión/, { selector: 'input[type="file"]' })).toBeInTheDocument();
  });

  it('mantiene la estructura del catálogo con skeleton accesible y sin textos de carga crudos', async () => {
    api.catalogActs.mockReturnValue(new Promise(() => undefined));
    render(<ActsTimesCatalog />);
    expect(screen.getByRole('status', { name: 'Cargando catálogo de actos' })).toBeInTheDocument();
    expect(screen.queryByText(/Cargando módulo/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Cargando catálogo…/i)).not.toBeInTheDocument();
  });

  it('ofrece un error contextual y reintento sin exponer detalles técnicos', async () => {
    api.catalogArtifactRoot.mockRejectedValueOnce(new Error('GET /api/catalogs 500 prisma'));
    const user = userEvent.setup();
    render(<TemplatesFormatsCatalog />);
    expect(await screen.findByRole('alert')).toHaveTextContent('No pudimos cargar el repositorio.');
    expect(screen.queryByText(/prisma|\/api\/catalogs|500/i)).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Reintentar' }));
    expect(await screen.findByRole('heading', { name: 'Notarías' })).toBeInTheDocument();
  });

  it('filtra el selector multi-acto ignorando mayúsculas y acentos y conserva la selección', async () => {
    const user = userEvent.setup();
    render(<TemplatesFormatsCatalog />);
    await user.click(await screen.findByRole('button', { name: /Notaría 45/ }));
    await user.click(screen.getByRole('button', { name: /Plantillas Machotes jurídicos/ }));
    await user.click(await screen.findByRole('button', { name: 'Nueva plantilla' }));
    const search = screen.getByLabelText('Buscar acto por nombre');
    await user.type(search, 'PROTOCOLIZACION');
    expect(search).toHaveValue('PROTOCOLIZACION');
    expect(screen.getByRole('checkbox', { name: 'Protocolización de acta' })).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole('checkbox', { name: 'Compraventa' })).not.toBeInTheDocument());
    await user.click(screen.getByRole('checkbox', { name: 'Protocolización de acta' }));
    expect(screen.getByRole('status', { name: '1 acto seleccionado' })).toBeInTheDocument();
    await user.clear(search);
    expect(screen.getByRole('checkbox', { name: 'Protocolización de acta' })).toBeChecked();
    await user.click(screen.getByRole('button', { name: 'Limpiar selección' }));
    expect(screen.getByRole('status', { name: '0 actos seleccionados' })).toBeInTheDocument();
  });

  it('usa un control de cierre accesible y conserva la navegación profunda etiquetada', async () => {
    const user = userEvent.setup();
    render(<TemplatesFormatsCatalog />);
    await user.click(await screen.findByRole('button', { name: /Notaría 45/ }));
    await user.click(screen.getByRole('button', { name: /Plantillas Machotes jurídicos/ }));
    await user.click(await screen.findByRole('button', { name: /A Carpeta/ }));
    await user.click(await screen.findByRole('button', { name: /B Carpeta/ }));
    expect(screen.getByRole('button', { name: 'B' })).toHaveAttribute('aria-current', 'page');
    await user.click(screen.getAllByRole('button', { name: 'Nueva carpeta' })[0]);
    expect(screen.getByRole('button', { name: 'Cerrar diálogo' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Cerrar diálogo' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});
