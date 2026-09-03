import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ScreeningPanel } from '../features/comparecientes/components/ScreeningPanel';
import { ComplianceTab } from '../features/cases/components/tabs/ComplianceTab';

const mocks = vi.hoisted(() => ({
  screening: vi.fn(), rerunScreening: vi.fn(), resolveScreeningCandidate: vi.fn(), generateScreeningReport: vi.fn(),
  documentStructure: vi.fn(), screeningOperation: vi.fn(), beneficialController: vi.fn(), permissions: ['expedientes.read', 'compliance.read', 'compliance.sensitive.read'],
}));
vi.mock('../features/comparecientes/comparecientes.service', () => ({ comparecientesService: mocks }));
vi.mock('../features/compliance/compliance.service', () => ({ complianceService: mocks }));
vi.mock('../features/auth/AuthProvider', () => ({ useAuth: () => ({ user: { permissions: mocks.permissions } }) }));

const query = (overrides: any = {}) => ({
  id: 'query-1', query_kind: 'MASTER', execution_state: 'SUCCEEDED', human_status: 'Sin posibles coincidencias',
  created_at: '2026-09-01T12:00:00.000Z', completed_at: '2026-09-01T12:00:01.000Z', candidates: [], sourceExecutions: [], reports: [], ...overrides,
});
const history = (current: any) => ({ current, history: current ? [current, query({ id: 'query-0', created_at: '2026-08-31T12:00:00.000Z' })] : [] });
const renderPanel = (props: Partial<React.ComponentProps<typeof ScreeningPanel>> = {}) => render(<MemoryRouter><ScreeningPanel comparecienteId="party-1" canRerun canResolve canReport {...props} /></MemoryRouter>);

describe('H3 CUM-LST-001 frontend', () => {
  beforeEach(() => {
    vi.clearAllMocks(); mocks.permissions = ['expedientes.read', 'compliance.read', 'compliance.sensitive.read'];
    mocks.rerunScreening.mockResolvedValue({}); mocks.resolveScreeningCandidate.mockResolvedValue({}); mocks.generateScreeningReport.mockResolvedValue({});
    mocks.documentStructure.mockResolvedValue({ vulnerable: false, automatic_structure: true, groups: [], requirements: [], missing: [] });
    mocks.beneficialController.mockResolvedValue({ current_review_id:null, configured_legal_rules:false, evaluations:[], history:[], snapshots:[], legacy_promoted:false });
  });

  it('01 muestra estado actual, fecha e historial separado', async () => {
    mocks.screening.mockResolvedValue(history(query())); renderPanel();
    expect((await screen.findAllByText('Sin posibles coincidencias')).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Consulta completada/).length).toBeGreaterThan(0);
    expect(screen.getByText('Historial de consultas (2)')).toBeInTheDocument();
  });

  it('02 presenta NOT_CONFIGURED como indisponibilidad, nunca como limpio', async () => {
    mocks.screening.mockResolvedValue(history(query({ execution_state: 'NOT_CONFIGURED', human_status: 'Fuente no configurada' })));
    renderPanel(); expect((await screen.findAllByText('Fuente no configurada')).length).toBeGreaterThan(0); expect(screen.getAllByText(/Fuente no configurada/).length).toBeGreaterThan(0);
  });

  it('03 presenta ERROR como fallo técnico humano, nunca como limpio', async () => {
    mocks.screening.mockResolvedValue(history(query({ execution_state: 'ERROR', human_status: 'No fue posible completar la consulta' })));
    renderPanel(); expect((await screen.findAllByText('No fue posible completar la consulta')).length).toBeGreaterThan(0); expect(screen.getAllByText(/Error de consulta/).length).toBeGreaterThan(0);
  });

  it('04 muestra candidato pendiente y exige revisión humana explícita', async () => {
    mocks.screening.mockResolvedValue(history(query({ human_status: 'Posible coincidencia · revisión adicional', candidates: [{ id: 'candidate-1', display_name: 'REGISTRO SINTÉTICO', source_record_ref: 'SYNTH-1', score: '0.750000', latest_resolution: null }] })));
    renderPanel(); expect(await screen.findByText('REGISTRO SINTÉTICO')).toBeInTheDocument(); expect(screen.getByText('Posible coincidencia · pendiente de revisión humana')).toBeInTheDocument(); expect(screen.getByLabelText('Motivo de la resolución')).toBeInTheDocument();
  });

  it.each([
    ['NO_CORRESPONDE', 'No corresponde'],
    ['REVISION_ADICIONAL', 'Revisión adicional'],
    ['COINCIDENCIA_CONFIRMADA', 'Coincidencia confirmada'],
  ])('05-07 presenta decisión %s con etiqueta humana %s', async (decision, label) => {
    mocks.screening.mockResolvedValue(history(query({ candidates: [{ id: 'candidate-1', display_name: 'REGISTRO SINTÉTICO', source_record_ref: 'SYNTH-1', score: null, latest_resolution: { decision } }] })));
    renderPanel({ canResolve: false }); expect(await screen.findByText(label)).toBeInTheDocument(); expect(screen.queryByText(decision)).not.toBeInTheDocument();
  });

  it('08 reconsulta manualmente y vuelve a cargar la historia', async () => {
    mocks.screening.mockResolvedValue(history(query())); renderPanel();
    await userEvent.click(await screen.findByRole('button', { name: 'Consultar nuevamente' }));
    await waitFor(() => expect(mocks.rerunScreening).toHaveBeenCalledWith('party-1', expect.any(String)));
    expect(mocks.screening).toHaveBeenCalledTimes(2); expect(await screen.findByText('La nueva consulta quedó registrada en el historial.')).toBeInTheDocument();
  });

  it('09 genera REPORTE DE CONSULTA sobre la Query seleccionada', async () => {
    mocks.screening.mockResolvedValue(history(query())); renderPanel();
    await userEvent.click((await screen.findAllByRole('button', { name: 'Generar reporte' }))[0]);
    await waitFor(() => expect(mocks.generateScreeningReport).toHaveBeenCalledWith('party-1', 'query-1', expect.any(String)));
    expect(await screen.findByText('Reporte de consulta generado y guardado en Documentos.')).toBeInTheDocument();
  });

  it('10 oculta reconsulta, resolución y reporte cuando los permisos no los conceden', async () => {
    mocks.screening.mockResolvedValue(history(query({ candidates: [{ id: 'candidate-1', display_name: 'REGISTRO SINTÉTICO', source_record_ref: 'SYNTH-1', score: null, latest_resolution: null }] })));
    renderPanel({ canRerun: false, canResolve: false, canReport: false }); await screen.findByText('REGISTRO SINTÉTICO');
    expect(screen.queryByRole('button', { name: 'Consultar nuevamente' })).not.toBeInTheDocument(); expect(screen.queryByLabelText('Motivo de la resolución')).not.toBeInTheDocument(); expect(screen.queryByText('Generar reporte')).not.toBeInTheDocument();
  });

  it('11 Expediente muestra snapshot/status y sólo acción contextual hacia Compareciente', async () => {
    mocks.screeningOperation.mockResolvedValue({ data: [{ requirement: { id: 'req-1', status: 'EN_PROCESO', label: 'Consulta nominal', target_name: 'Persona sintética', target_compareciente_id: 'party-1' }, snapshot: { unresolved_count: 1 }, query: { id: 'q1', execution_state: 'PARTIAL', completed_at: '2026-09-01T12:00:00Z' }, action: '/comparecientes/party-1#screening' }] });
    render(<MemoryRouter><ComplianceTab expediente={{ id: 'exp-1', numero_pravia: 'EXP-0001-2026', complianceReviews: [] } as any} /></MemoryRouter>);
    expect(await screen.findByRole('heading', { name: 'Consulta nominal de la operación' })).toBeInTheDocument();
    expect(screen.getByText('Persona sintética')).toBeInTheDocument(); expect(screen.getByText(/Snapshot vinculado · 1 pendiente de resolución/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Abrir ficha/ })).toBeInTheDocument(); expect(screen.queryByLabelText('Motivo de la resolución')).not.toBeInTheDocument();
  });

  it('12 distingue current de history, ambos regímenes y una regla no configurada sin falsa conclusión', async () => {
    mocks.screeningOperation.mockResolvedValue({ data: [] });
    const snapshot = { id: 'snapshot-1', structure_revision: 3, structure_fingerprint: 'a'.repeat(64), incomplete_markers: [] };
    mocks.beneficialController.mockResolvedValue({ current_review_id: 'review-current', configured_legal_rules: false, snapshots: [snapshot], legacy_promoted: false,
      evaluations: [
        { id: 'eval-lfpiorpi', review_id: 'review-current', regime: 'LFPIORPI', status: 'NOT_CONFIGURED', results: [], snapshot, reevaluation_required: false },
        { id: 'eval-cff', review_id: 'review-current', regime: 'CFF_RMF', status: 'REQUIRES_REVIEW', results: [], snapshot: { ...snapshot, id: 'snapshot-2', incomplete_markers: ['UNKNOWN_PERCENTAGE'] }, reevaluation_required: true },
      ],
      history: [{ id: 'eval-old', review_id: 'review-old', regime: 'LFPIORPI', status: 'EVALUATED', results: [{ id: 'result-old', determination: 'IDENTIFIED', subject_compareciente_id: 'party-1' }], snapshot: { ...snapshot, id: 'snapshot-old', structure_revision: 2 }, reevaluation_required: false }],
    });
    render(<MemoryRouter><ComplianceTab expediente={{ id: 'exp-1', numero_pravia: 'EXP-0001-2026', complianceReviews: [] } as any} /></MemoryRouter>);
    expect(await screen.findByText('Regla jurídica no configurada · estructura v3 · snapshot inmutable')).toBeInTheDocument();
    expect(screen.getByText('CFF / RMF')).toBeInTheDocument();
    expect(screen.getByText('Reevaluación requerida')).toBeInTheDocument();
    expect(screen.getByText('Ver historial de evaluaciones (1)')).toBeInTheDocument();
    expect(screen.queryByText(/sin beneficiario controlador/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/no aplica/i)).not.toBeInTheDocument();
  });
});
