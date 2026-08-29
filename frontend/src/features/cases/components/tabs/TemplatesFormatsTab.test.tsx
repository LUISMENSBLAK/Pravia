import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ExpedienteArtifacts, ExpedienteDetail } from '../../expedientes.types';
import { TemplatesFormatsTab } from './TemplatesFormatsTab';

const mocks = vi.hoisted(() => ({
  artifacts: vi.fn(), materializeArtifacts: vi.fn(), previewArtifactGeneration: vi.fn(), generateArtifact: vi.fn(),
  uploadArtifact: vi.fn(), validateArtifact: vi.fn(), artifactUrl: vi.fn(),
}));

vi.mock('../../../auth/AuthProvider', () => ({ useAuth: () => ({ user: { id: 'user-1', permissions: ['ia.execute'] } }) }));
vi.mock('../../expedientes.service', () => ({ expedientesService: mocks }));

const detail = {
  id: 'exp-1', capabilities: { canWrite: true, canUploadDocuments: true },
} as unknown as ExpedienteDetail;

const payload: ExpedienteArtifacts = {
  source: 'CFG-002', master_rules_editable: false, auto_generated_documents: 0,
  preview: { revision: 'revision-1', applicable: 2, creates: 0 },
  data: [
    { id: 'pending-party', artifact_id: 'artifact-1', rule_id: 'rule-1', master_version_id: 'version-1', act_id: 'act-1', subject_type: 'COMPARECIENTE', subject_id: 'relation-1', ordinal: 1, estado: 'PENDIENTE', obligatoria: true, explanation: { artifact_name: 'Anexo 3 UIF', artifact_type: 'FORMATO', owner_type: 'INSTITUCION', act_names: ['Compraventa'], subject_name: 'Juan Pérez', master_version: 2 }, source_revision: 'source-1', version: 1, in_scope: true, review_required: false, document_id: null },
    { id: 'pending-property', artifact_id: 'artifact-2', rule_id: 'rule-2', master_version_id: 'version-2', act_id: 'act-1', subject_type: 'INMUEBLE', subject_id: 'property-1', ordinal: 1, estado: 'PENDIENTE_REVISION', obligatoria: false, explanation: { artifact_name: 'Solicitud registral', artifact_type: 'PLANTILLA', owner_type: 'NOTARIA', act_names: ['Compraventa'], subject_name: 'Casa Centro', master_version: 4 }, source_revision: 'source-2', version: 3, in_scope: true, review_required: true, review_reason: 'Requiere revisar un dato contradictorio.', document_id: 'doc-1' },
  ],
};

describe('Plantillas y formatos EXP-006', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.artifacts.mockResolvedValue(payload);
    mocks.materializeArtifacts.mockResolvedValue({});
    mocks.previewArtifactGeneration.mockResolvedValue({
      pending_id: 'pending-party', pending_version: 1, source_revision: 'sources-v1',
      source_manifest: { policy: 'SAME_PARTY_CURRENT_ONLY', subjectComparecienteId: 'party-1', structuredFieldsUsed: ['rfc'], currentDocumentIds: ['doc-a', 'doc-b'], masterArtifactId: 'artifact-1', masterVersionId: 'version-1' },
      missing: ['Domicilio fiscal'], conflicts: [], can_generate: true,
    });
    mocks.generateArtifact.mockResolvedValue({});
    mocks.uploadArtifact.mockResolvedValue({});
    mocks.validateArtifact.mockResolvedValue({});
    mocks.artifactUrl.mockResolvedValue({ url: 'https://private.invalid/signed', file_name: 'documento.docx' });
  });

  it('muestra la experiencia operativa y distingue tipo, sujeto, obligatoriedad y estado', async () => {
    render(<TemplatesFormatsTab expediente={detail} />);
    expect(await screen.findByRole('heading', { name: 'Plantillas y formatos' })).toBeInTheDocument();
    expect(screen.getByText('Anexo 3 UIF')).toBeInTheDocument();
    expect(screen.getByText('Juan Pérez')).toBeInTheDocument();
    expect(screen.getByText('Obligatorio')).toBeInTheDocument();
    expect(screen.getByText('Solicitud registral')).toBeInTheDocument();
    expect(screen.getByText('Pendiente de revisión')).toBeInTheDocument();
    expect(screen.getByText(/Aquí no se editan reglas ni archivos maestros/)).toBeInTheDocument();
  });

  it('presenta el manifiesto estricto antes de IA y nunca permite inyectar documentos', async () => {
    const user = userEvent.setup();
    render(<TemplatesFormatsTab expediente={detail} />);
    await user.click(await screen.findByRole('button', { name: 'Generar con IA' }));
    const dialog = await screen.findByRole('dialog', { name: 'Generar con fuentes estrictas' });
    expect(within(dialog).getByText('2 documento(s) vigente(s)')).toBeInTheDocument();
    expect(within(dialog).getByText(/únicamente datos estructurados y documentos vigentes/)).toBeInTheDocument();
    expect(within(dialog).queryByRole('checkbox')).not.toBeInTheDocument();
    expect(within(dialog).queryByRole('combobox')).not.toBeInTheDocument();
    expect(within(dialog).getByText(/Faltan: Domicilio fiscal/)).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Generar borrador' }));
    await waitFor(() => expect(mocks.generateArtifact).toHaveBeenCalledWith('exp-1', 'pending-party', expect.objectContaining({ expected_version: 1, source_revision: 'sources-v1' })));
  });

  it('carga externo y valida sólo mediante acciones humanas explícitas', async () => {
    const user = userEvent.setup();
    render(<TemplatesFormatsTab expediente={detail} />);
    await screen.findByText('Solicitud registral');
    const cards = screen.getAllByRole('article');
    const reviewCard = cards.find((card) => within(card).queryByText('Solicitud registral'))!;
    await user.click(within(reviewCard).getByRole('button', { name: 'Validar' }));
    await waitFor(() => expect(mocks.validateArtifact).toHaveBeenCalledWith('exp-1', 'pending-property', 3, expect.any(String)));
    await waitFor(() => expect(mocks.artifacts.mock.calls.length).toBeGreaterThanOrEqual(2));
    const pendingCard = screen.getByText('Anexo 3 UIF').closest('article')!;
    await user.click(within(pendingCard).getByRole('button', { name: 'Cargar externo' }));
    await user.upload(screen.getByLabelText('Cargar documento externo'), new File(['docx'], 'anexo.docx', { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' }));
    await waitFor(() => expect(mocks.uploadArtifact).toHaveBeenCalledWith('exp-1', 'pending-party', expect.any(File), 1, expect.any(String)));
  });

  it('actualiza únicamente pendientes con la revisión de preview vigente', async () => {
    const user = userEvent.setup();
    render(<TemplatesFormatsTab expediente={detail} />);
    await user.click(await screen.findByRole('button', { name: 'Actualizar pendientes' }));
    await waitFor(() => expect(mocks.materializeArtifacts).toHaveBeenCalledWith('exp-1', 'revision-1'));
    expect(mocks.generateArtifact).not.toHaveBeenCalled();
    expect(mocks.uploadArtifact).not.toHaveBeenCalled();
  });
});
