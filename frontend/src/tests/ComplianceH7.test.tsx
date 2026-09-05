import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ExpedienteMobileCard } from '../features/cases/components/ExpedienteMobileCard';
import { ExpedienteTable } from '../features/cases/components/ExpedienteTable';
import { H7ClosureWorkspace } from '../features/cases/components/tabs/H7ClosureWorkspace';
import { complianceService } from '../features/compliance/compliance.service';

vi.mock('../features/auth/AuthProvider', () => ({ useAuth: () => ({ user: { permissions: ['compliance.read', 'compliance.review', 'compliance.sensitive.read'] } }) }));
vi.mock('../features/compliance/compliance.service', () => ({ complianceService: { h7Workspace: vi.fn(), h7AuthorizeException: vi.fn() } }));

const workspace = {
  state: 'PENDIENTE' as const, state_label: 'Pendiente', pending_count: 2, actionable_missing_count: 1, operational_status: 'ENTREGADO',
  providers: ['DOC', 'LEGAL', 'AVI'], requirements: [
    { id: 'doc', provider: 'DOC', key: 'DOC:ONE', label: 'Documento completo', status: 'CUMPLIDO', deadline: null, blocks_completion: true, missing_action: null, action_target: null, resolution: null },
    { id: 'legal', provider: 'LEGAL', key: 'LEGAL:ONE', label: 'Dato jurídico', status: 'PENDIENTE', deadline: null, blocks_completion: true, missing_action: 'GO_TO_COMPARECIENTE', action_target: null, resolution: null },
    { id: 'avi', provider: 'AVI', key: 'AVI:ONE', label: 'Acuse final', status: 'EN_PROCESO', deadline: null, blocks_completion: true, missing_action: null, action_target: null, resolution: null },
  ],
};

const item: any = { id: 'case-h7', numero_pravia: 'EXP-0001-2026', macrofase: 'ENTREGADO', tipo_acto: { id: 'act', nombre: 'Compraventa' }, cliente_principal: 'Persona sintética', comparecientes_adicionales: 0, etapa_actual_nombre: 'Entregado', abogado: null, updated_at: '2026-09-05T12:00:00.000Z', vulnerable: { value: true, label: 'Sí' }, cumplimiento: { state: 'VENCIDO', label: 'Vencido', pending_count: 1 } };

describe('H7 CUM-CIE frontend', () => {
  beforeEach(() => { vi.clearAllMocks(); vi.mocked(complianceService.h7Workspace).mockResolvedValue(workspace); });

  it('consumes the canonical backend header and exact counts while keeping Entregado independent', async () => {
    render(<H7ClosureWorkspace expedienteId="case-h7" />);
    expect(await screen.findByRole('heading', { name: 'Pendiente' })).toBeInTheDocument();
    expect(screen.getByText('Pendientes exactos').previousElementSibling).toHaveTextContent('2');
    expect(screen.getByText('Con acción disponible').previousElementSibling).toHaveTextContent('1');
    expect(screen.getByText('Entregado')).toBeInTheDocument(); expect(screen.getByText('Estado operativo independiente')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /marcar cumplimiento completo/i })).not.toBeInTheDocument();
  });

  it('orders populated blocks contractually and creates no universal empty block', async () => {
    const { container } = render(<H7ClosureWorkspace expedienteId="case-h7" />);
    await screen.findByText('Evaluación legal y hechos');
    const text = container.textContent || '';
    expect(text.indexOf('Evaluación legal y hechos')).toBeLessThan(text.indexOf('Documental'));
    expect(text.indexOf('Documental')).toBeLessThan(text.indexOf('Firma y avisos'));
    expect(screen.queryByText('Cuestionarios')).not.toBeInTheDocument();
  });

  it('requires explicit human confirmation and a substantive reason for an exception', async () => {
    vi.mocked(complianceService.h7AuthorizeException).mockResolvedValue({});
    vi.mocked(complianceService.h7Workspace).mockResolvedValueOnce(workspace).mockResolvedValueOnce({ ...workspace, state: 'EN_PROCESO', state_label: 'En proceso' });
    render(<H7ClosureWorkspace expedienteId="case-h7" />);
    const requirement = (await screen.findByText('Dato jurídico')).closest('article')!;
    fireEvent.click(within(requirement).getByRole('button', { name: 'Resolver excepción' }));
    const confirm = within(requirement).getByRole('button', { name: 'Confirmar excepción' });
    expect(confirm).toBeDisabled(); expect(complianceService.h7AuthorizeException).not.toHaveBeenCalled();
    fireEvent.change(within(requirement).getByLabelText('Motivo de la excepción'), { target: { value: 'Fundamento humano comprobado' } });
    fireEvent.click(confirm);
    await waitFor(() => expect(complianceService.h7AuthorizeException).toHaveBeenCalledWith('case-h7', 'legal', expect.objectContaining({ reason: 'Fundamento humano comprobado', idempotency_key: expect.any(String) })));
  });

  it.each([320, 390, 768, 1440])('keeps closure actions reachable at %d px', async (width) => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: width }); window.dispatchEvent(new Event('resize'));
    render(<H7ClosureWorkspace expedienteId="case-h7" />);
    const requirement = (await screen.findByText('Dato jurídico')).closest('article')!;
    const button = within(requirement).getByRole('button', { name: 'Resolver excepción' });
    expect(button).toBeVisible(); expect(button).toBeEnabled();
  });

  it('renders only simple Vulnerable and Cumplimiento indicators in desktop and mobile list surfaces', () => {
    const table = render(<MemoryRouter><ExpedienteTable items={[item]} /></MemoryRouter>);
    expect(screen.getByRole('columnheader', { name: 'Vulnerable' })).toBeInTheDocument(); expect(screen.getByRole('columnheader', { name: 'Cumplimiento' })).toBeInTheDocument();
    expect(screen.getByText('Sí')).toBeInTheDocument(); expect(screen.getByText('Vencido')).toBeInTheDocument();
    table.unmount(); render(<MemoryRouter><ExpedienteMobileCard item={item} /></MemoryRouter>);
    expect(screen.getByText('Vulnerable')).toBeInTheDocument(); expect(screen.getByText('Cumplimiento')).toBeInTheDocument();
  });
});
