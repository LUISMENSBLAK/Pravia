import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ProjectTab } from '../features/cases/components/tabs/ProjectTab';

const api = vi.hoisted(() => ({
  projectWorkspace: vi.fn(),
  uploadProject: vi.fn(),
  generateProject: vi.fn(),
  generateProjectFromTemplate: vi.fn(),
  reviewProject: vi.fn(),
  saveProjectAsNotaryTemplate: vi.fn(),
  downloadProject: vi.fn(),
  downloadProjectReport: vi.fn(),
  projectPreviewUrl: vi.fn(),
}));
const auth = vi.hoisted(() => ({ permissions: ['configuracion.plantillas_formatos.manage', 'expedientes.write', 'documentos.write', 'ia.execute'] }));

vi.mock('../features/cases/expedientes.service', () => ({ expedientesService: api }));
vi.mock('../features/auth/AuthProvider', () => ({ useAuth: () => ({ user: { permissions: auth.permissions } }) }));

const workspace = {
  modes: ['GENERAR_PROYECTO', 'REVISAR_PROYECTO'],
  expediente: { id: 'exp-1', folio: 'EXP-0001-2026', acts: [{ id: 'act-1', name: 'Compraventa' }] },
  templates: [{ id: 'artifact-1', name: 'Machote QA', default: true, applicable_act_ids: [], versions: [{ id: 'template-v1', version: 1, name: 'machote.docx', checksum: 'a'.repeat(64) }] }],
  suggested_template: { artifact_id: 'artifact-1', name: 'Machote QA', version_id: 'template-v1', version: 1 },
  pending_detectable_count: 2,
  sources: { structured: ['comparecientes', 'predios', 'expediente', 'actos'], documents: [{ id: 'link-1', tipo_vinculo: 'FUENTE_PROYECTO', selected_by_default: true, documento: { id: 'source-1', nombre_original: 'certificado.docx', mime_type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' } }] },
};

describe('EXP-010 · Proyecto y revisión notarial', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    auth.permissions = ['configuracion.plantillas_formatos.manage', 'expedientes.write', 'documentos.write', 'ia.execute'];
    api.projectWorkspace.mockResolvedValue(workspace);
  });

  it('presenta un solo CTA principal, mantiene avanzadas cerradas y propaga indicaciones a EXP-010', async () => {
    api.generateProject.mockResolvedValue({ version: { id: 'v3', version_numero: 3, nombre_original: 'Proyecto.docx', es_vigente: true, created_at: '2026-09-23T12:00:00.000Z' }, pending_count: 2, contradiction_count: 0, generation_observation_count: 1, residual_observation_count: 0, critical_count: 0, instructions_consumed: true, instruction_focus: ['ANTECEDENTE'], generation_origin: 'UI', docx_structural_fidelity: 'PASS', template: { artifact_id: 'artifact-1', version_id: 'template-v1', version: 1, name: 'Machote QA', exclusive: false }, review_required: true, idempotent: false });
    render(<ProjectTab expediente={{ id: 'exp-1' } as any} onChanged={vi.fn()} project={{ vigente: null, historial: [], ultimoReporte: null }} />);
    expect(await screen.findByRole('button', { name: 'PROYECTAR ESCRITURA' })).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'PROYECTAR ESCRITURA' })).toHaveLength(1);
    expect(screen.queryByRole('button', { name: /Generar desde machote/i })).not.toBeInTheDocument();
    expect(screen.getByText('Opciones avanzadas').closest('details')).not.toHaveAttribute('open');
    expect(screen.getAllByText(/Machote QA · v1/).length).toBeGreaterThan(0);
    await userEvent.type(screen.getByLabelText(/Indicaciones para la proyección/i), 'Revisa especialmente el antecedente.');
    await userEvent.click(screen.getByRole('button', { name: 'PROYECTAR ESCRITURA' }));
    await waitFor(() => expect(api.generateProject).toHaveBeenCalledWith('exp-1', expect.objectContaining({ templateVersionId: 'template-v1', instructions: 'Revisa especialmente el antecedente.', sourceDocumentIds: ['source-1'] })));
    expect(await screen.findByRole('heading', { name: 'Versión 3' })).toBeInTheDocument();
  });

  it('presenta observaciones persistidas sin ofrecer mutación automática del Word', async () => {
    render(<ProjectTab expediente={{ id: 'exp-1' } as any} onChanged={vi.fn()} project={{
      vigente: { id: 'project-v2', version_numero: 2, nombre_original: 'Proyecto.docx', es_vigente: true, created_at: '2026-09-21T12:00:00.000Z', generation_observations: [{ kind: 'POSSIBLE_TEMPLATE_RESIDUE', value: 'Persona anterior', location: 'Antecedente primero', detail: 'Sin fuente actual' }] },
      historial: [],
      ultimoReporte: {
        id: 'report-1', proyecto_version_id: 'project-v2', proyecto_version_numero: 2,
        nombre_reporte: 'Revision.docx', documentos_analizados_count: 2, documentos_totales_count: 2,
        documentos_no_leidos: [], solicitado_por: 'QA Local', created_at: '2026-09-21T12:01:00.000Z',
        observaciones: [{ id: 'obs-1', titulo: 'OBSERVACIÓN 01 — Riesgo Alto', nivel_riesgo: 'ALTO', tipo_discrepancia: 'TRANSCRIPCION_INCOMPLETA', dato_proyecto: 'Texto truncado', dato_fuente: 'Texto íntegro', documento_fuente: 'certificado.docx', ubicacion: 'Antecedente tercero', recomendacion: 'Completar manualmente la transcripción.' }],
      },
    }} />);
    expect(await screen.findByRole('heading', { name: 'Resultado de la revisión' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Observaciones de generación' })).toBeInTheDocument();
    expect(screen.getByText('Posible dato residual del machote')).toBeInTheDocument();
    expect(screen.getByText('Persona anterior')).toBeInTheDocument();
    expect(screen.getByText('Texto truncado')).toBeInTheDocument();
    expect(screen.getByText('Texto íntegro')).toBeInTheDocument();
    expect(screen.getByText(/no modifican el Word/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Aplicar observación/i })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Descargar reporte' }));
    expect(api.downloadProjectReport).toHaveBeenCalledWith('exp-1', 'Revision.docx');
  });

  it('mantiene el CTA inejecutable para un usuario sin permiso de proyección', async () => {
    auth.permissions = ['expedientes.project.read'];
    render(<ProjectTab expediente={{ id: 'exp-1' } as any} onChanged={vi.fn()} project={{ vigente: null, historial: [], ultimoReporte: null }} />);
    expect(await screen.findByRole('button', { name: 'PROYECTAR ESCRITURA' })).toBeDisabled();
    expect(screen.getByText('Tu función actual no permite generar proyectos.')).toBeInTheDocument();
  });

  it('preselecciona sólo las fuentes marcadas por el backend', async () => {
    render(<ProjectTab expediente={{ id: 'exp-1' } as any} onChanged={vi.fn()} project={{ vigente: null, historial: [], ultimoReporte: null }} />);
    await waitFor(() => expect(api.projectWorkspace).toHaveBeenCalledWith('exp-1', expect.any(AbortSignal)));
    await userEvent.click(screen.getByText(/Ver \/ ajustar fuentes/i));
    expect(screen.getByRole('checkbox', { name: /certificado\.docx/i })).toBeChecked();
    expect(screen.getByText('1 seleccionada(s)')).toBeInTheDocument();
  });
});
