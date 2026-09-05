import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { H6NoticeWorkspace } from '../features/cases/components/tabs/H6NoticeWorkspace';
import { complianceService } from '../features/compliance/compliance.service';

vi.mock('../features/compliance/compliance.service', () => ({ complianceService: {
  h6Workspace: vi.fn(), h6EnsureFiche: vi.fn(), h6SaveFiche: vi.fn(), h6FinalizeFiche: vi.fn(), h6GenerateProduct: vi.fn(), h6RegisterPresentation: vi.fn(), h6RegisterAcknowledgement: vi.fn(),
} }));

const obligation = (overrides: Record<string, unknown> = {}) => ({
  id: 'obligation-test', legal_obligation_key: 'SYNTHETIC', channel_code: 'Canal configurado', obligation_type_code: 'NOTICE',
  avi_state: 'LISTO_PARA_PRESENTAR', freshness: 'CURRENT', review_needed: false, due_at: null,
  ficheRevisions: [{ id: 'fiche-test', status: 'VALIDATED', version: 2, revision_number: 1, local_values: {}, source_manifest: [{ entity: 'Expediente', path: 'expediente.id' }], officialRevision: { schema_json: { fields: [{ key: 'expediente', label: 'Expediente', authority: 'MASTER_SOURCE', required: true, path: 'expediente.id' }] } } }],
  officialProducts: [{ id: 'product-test', documento_id: 'doc-test', checksum: 'checksum', created_at: '2026-09-05T00:00:00.000Z' }],
  presentations: [], projectedRequirements: [{ id: 'requirement-test', label: 'Aviso sintético', status: 'EN_PROCESO' }],
  ...overrides,
});

describe('H6 CUM-FIR/AVI frontend', () => {
  beforeEach(() => vi.clearAllMocks());

  it('representa cero obligaciones sin inventar avisos', async () => {
    vi.mocked(complianceService.h6Workspace).mockResolvedValue({ post_sign_materialization: 'CURRENT', obligations: [], acknowledgement_documents: [] });
    render(<H6NoticeWorkspace expedienteId="exp-test" canWrite />);
    expect(await screen.findByText(/No hay avisos o declaraciones aplicables/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Registrar presentación' })).not.toBeInTheDocument();
  });

  it('muestra una obligación con etiquetas humanas, provenance y sin enum técnico', async () => {
    vi.mocked(complianceService.h6Workspace).mockResolvedValue({ post_sign_materialization: 'CURRENT', obligations: [obligation()] } as any);
    render(<H6NoticeWorkspace expedienteId="exp-test" canWrite={false} />);
    expect(await screen.findByText('Aviso sintético')).toBeInTheDocument();
    expect(screen.getByText('Listo para presentar')).toBeInTheDocument();
    expect(screen.queryByText('LISTO_PARA_PRESENTAR')).not.toBeInTheDocument();
    fireEvent.click(screen.getByText(/Fuentes utilizadas/));
    expect(screen.getByText(/expediente.id · solo lectura/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Ir al origen' })).toBeInTheDocument();
  });

  it('soporta N obligaciones y conserva revisión necesaria post-presentación', async () => {
    vi.mocked(complianceService.h6Workspace).mockResolvedValue({ post_sign_materialization: 'CURRENT', obligations: [obligation(), obligation({ id: 'obligation-two', projectedRequirements: [{ id: 'req-two', label: 'Segundo aviso', status: 'EN_PROCESO' }], freshness: 'STALE', review_needed: true })] } as any);
    render(<H6NoticeWorkspace expedienteId="exp-test" canWrite={false} />);
    expect(await screen.findByText('Segundo aviso')).toBeInTheDocument();
    expect(screen.getAllByText('Aviso sintético')).toHaveLength(1);
    expect(screen.getByText(/Las fuentes cambiaron después de presentar/)).toBeInTheDocument();
  });

  it('registra presentación sólo tras una acción humana explícita', async () => {
    vi.mocked(complianceService.h6Workspace).mockResolvedValue({ post_sign_materialization: 'CURRENT', obligations: [obligation()] } as any);
    vi.mocked(complianceService.h6RegisterPresentation).mockResolvedValue({});
    render(<H6NoticeWorkspace expedienteId="exp-test" canWrite />);
    const button = await screen.findByRole('button', { name: 'Registrar presentación' });
    expect(complianceService.h6RegisterPresentation).not.toHaveBeenCalled();
    fireEvent.click(button);
    await waitFor(() => expect(complianceService.h6RegisterPresentation).toHaveBeenCalledWith('obligation-test', expect.objectContaining({ product_id: 'product-test', kind: 'NORMAL', metadata: { explicit_human_action: true } })));
  });

  it('edita y guarda únicamente campos locales de una ficha borrador', async () => {
    const draft = obligation({ avi_state: 'PENDIENTE', officialProducts: [], ficheRevisions: [{ id: 'fiche-draft', status: 'DRAFT', version: 1, revision_number: 1, local_values: {}, source_manifest: [], officialRevision: { schema_json: { fields: [{ key: 'observacion', label: 'Observación del aviso', authority: 'NOTICE_LOCAL_FIELD', required: true, input_type: 'text' }] } } }] });
    vi.mocked(complianceService.h6Workspace).mockResolvedValue({ post_sign_materialization: 'CURRENT', obligations: [draft], acknowledgement_documents: [] } as any);
    vi.mocked(complianceService.h6SaveFiche).mockResolvedValue({ version: 2 });
    render(<H6NoticeWorkspace expedienteId="exp-test" canWrite />);
    fireEvent.change(await screen.findByLabelText(/Observación del aviso/), { target: { value: 'Dato confirmado' } });
    fireEvent.click(screen.getByRole('button', { name: 'Guardar ficha' }));
    await waitFor(() => expect(complianceService.h6SaveFiche).toHaveBeenCalledWith('obligation-test', 'fiche-draft', { expected_version: 1, local_values: { observacion: 'Dato confirmado' } }));
  });

  it('vincula un acuse a la presentación exacta mediante acción humana', async () => {
    const presented = obligation({ avi_state: 'PRESENTADO', presentations: [{ id: 'presentation-test', kind: 'NORMAL', presented_at: '2026-09-05T00:00:00.000Z', external_folio: null, acknowledgements: [] }] });
    vi.mocked(complianceService.h6Workspace).mockResolvedValue({ post_sign_materialization: 'CURRENT', obligations: [presented], acknowledgement_documents: [{ id: 'ack-doc', nombre_original: 'acuse.pdf', tipo: 'ACUSE', fecha_carga: '2026-09-05T00:00:00.000Z' }] } as any);
    vi.mocked(complianceService.h6RegisterAcknowledgement).mockResolvedValue({});
    render(<H6NoticeWorkspace expedienteId="exp-test" canWrite />);
    fireEvent.change(await screen.findByLabelText(/Documento de acuse/), { target: { value: 'ack-doc' } });
    fireEvent.click(screen.getByRole('button', { name: 'Registrar acuse' }));
    await waitFor(() => expect(complianceService.h6RegisterAcknowledgement).toHaveBeenCalledWith('presentation-test', expect.objectContaining({ documento_id: 'ack-doc', acknowledgement_type: 'Acuse de recepción' })));
  });

  it('muestra el historial append-only completo y permite complementaria/corrección con lineage opcional', async () => {
    const presentations = [
      { id: 'presentation-correction', kind: 'CORRECCION', presented_at: '2026-09-05T12:00:00.000Z', external_folio: 'COR-3', previous_presentation_id: 'presentation-normal', product: { id: 'product-correction', checksum: 'cccccccccccc', adapter_version: 'v3', created_at: '2026-09-05T11:00:00.000Z' }, ficheRevision: { revision_number: 3 }, acknowledgements: [] },
      { id: 'presentation-complement', kind: 'COMPLEMENTARIA', presented_at: '2026-09-04T12:00:00.000Z', external_folio: 'COM-2', previous_presentation_id: 'presentation-normal', product: { id: 'product-complement', checksum: 'bbbbbbbbbbbb', adapter_version: 'v2', created_at: '2026-09-04T11:00:00.000Z' }, ficheRevision: { revision_number: 2 }, acknowledgements: [{ id: 'ack-1' }] },
      { id: 'presentation-normal', kind: 'NORMAL', presented_at: '2026-09-03T12:00:00.000Z', external_folio: 'NOR-1', previous_presentation_id: null, product: { id: 'product-test', checksum: 'aaaaaaaaaaaa', adapter_version: 'v1', created_at: '2026-09-03T11:00:00.000Z' }, ficheRevision: { revision_number: 1 }, acknowledgements: [] },
    ];
    vi.mocked(complianceService.h6Workspace).mockResolvedValue({ post_sign_materialization: 'CURRENT', obligations: [obligation({ presentations })], acknowledgement_documents: [] } as any);
    vi.mocked(complianceService.h6RegisterPresentation).mockResolvedValue({});
    render(<H6NoticeWorkspace expedienteId="exp-test" canWrite />);
    const history = await screen.findByRole('region', { name: 'Historial de presentaciones de Aviso sintético' });
    expect(within(history).getAllByRole('listitem')).toHaveLength(3);
    for (const label of ['Normal', 'Complementaria', 'Corrección', 'NOR-1', 'COM-2', 'COR-3', 'v1 · aaaaaaaa', 'v2 · bbbbbbbb', 'v3 · cccccccc']) expect(within(history).getByText(label)).toBeInTheDocument();
    expect(within(history).getAllByText('#3')).toHaveLength(3);
    const form = screen.getByRole('group', { name: 'Nueva presentación' });
    fireEvent.change(within(form).getByLabelText('Tipo'), { target: { value: 'COMPLEMENTARIA' } });
    fireEvent.change(within(form).getByLabelText('Presentación anterior (opcional)'), { target: { value: 'presentation-normal' } });
    fireEvent.click(within(form).getByRole('button', { name: 'Registrar presentación' }));
    await waitFor(() => expect(complianceService.h6RegisterPresentation).toHaveBeenCalledWith('obligation-test', expect.objectContaining({ kind: 'COMPLEMENTARIA', previous_presentation_id: 'presentation-normal' })));
  });

  it.each([320, 390, 768, 1440])('mantiene historial y acciones alcanzables a %d px', async (width) => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: width });
    window.dispatchEvent(new Event('resize'));
    const presentations = [{
      id: `presentation-${width}`,
      kind: 'NORMAL',
      presented_at: '2026-09-05T12:00:00.000Z',
      external_folio: `FOL-${width}`,
      previous_presentation_id: null,
      product: { id: 'product-test', checksum: 'aaaaaaaaaaaa', adapter_version: 'v1', created_at: '2026-09-05T11:00:00.000Z' },
      ficheRevision: { revision_number: 1 },
      acknowledgements: [],
    }];
    vi.mocked(complianceService.h6Workspace).mockResolvedValue({
      post_sign_materialization: 'CURRENT',
      obligations: [obligation({ presentations })],
      acknowledgement_documents: [],
    } as any);
    render(<H6NoticeWorkspace expedienteId="exp-test" canWrite />);
    const history = await screen.findByRole('region', { name: 'Historial de presentaciones de Aviso sintético' });
    expect(within(history).getByText(`FOL-${width}`)).toBeVisible();
    const form = screen.getByRole('group', { name: 'Nueva presentación' });
    expect(within(form).getByLabelText('Tipo')).toBeVisible();
    expect(within(form).getByRole('button', { name: 'Registrar presentación' })).toBeEnabled();
  });
});
