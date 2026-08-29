import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BudgetTab } from '../features/cases/components/tabs/BudgetTab';
import type { ExpedienteBudget } from '../features/cases/expedientes.types';

const api = vi.hoisted(() => ({
  budget: vi.fn(), saveBudget: vi.fn(), generateBudgetPdf: vi.fn(), budgetPdfUrl: vi.fn(), deleteBudgetPdf: vi.fn(),
}));
vi.mock('../features/cases/expedientes.service', () => ({ expedientesService: api }));

const fixture = (overrides: Partial<ExpedienteBudget> = {}): ExpedienteBudget => ({
  id: 'budget-1', version: 1, origin: 'COTIZACION_ESTRUCTURADA',
  quote_origin: { quote_id: 'quote-1', quote_version_id: 'quote-version-1', quote_version: 2, immutable: true },
  concepts: [
    { id: 'concept-1', concepto: 'Honorarios profesionales', categoria: 'HONORARIOS', importe: '1000.00', orden: 0 },
    { id: 'concept-2', concepto: 'IVA de honorarios', categoria: 'IVA_HONORARIOS', importe: '160.00', orden: 1 },
    { id: 'concept-3', concepto: 'Derechos registrales', categoria: 'IMPUESTOS_DERECHOS', importe: '340.00', orden: 2 },
  ],
  totals: { honorarios: '1000.00', iva_honorarios: '160.00', subtotal_honorarios: '1160.00', subtotal_impuestos_derechos: '340.00', total: '1500.00' },
  internal_distribution: {
    pravia: { honorarios: '600.00', honorarios_porcentaje: '60.0000', iva: '96.00', iva_porcentaje: '60.0000' },
    notaria: { honorarios: '400.00', honorarios_porcentaje: '40.0000', iva: '64.00', iva_porcentaje: '40.0000' },
    canonical_values: 'AMOUNTS', closed: true,
  },
  requires_classification: false, distribution_requires_review: false,
  pdf_history: [{ id: 'pdf-1', document_id: 'document-1', generated_at: '2026-08-29T12:00:00.000Z', total: '1500.00', budget_version: 1, note: null, file_name: 'Presupuesto_EXP-0001-2026.pdf', mime_type: 'application/pdf', immutable: true }],
  capabilities: { can_edit: true, can_view_internal_distribution: true, can_edit_internal_distribution: true, can_generate_pdf: true, can_view_pdf: true, can_delete_pdf: true },
  editable_history_versions: 0, canonical_source: 'ExpedientePresupuesto', legacy_json_writer_enabled: false,
  ...overrides,
});

describe('EXP-007 · Presupuesto operativo UI', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.budget.mockResolvedValue(fixture()); api.saveBudget.mockResolvedValue(fixture({ version: 2 }));
    api.generateBudgetPdf.mockResolvedValue({ item: {}, idempotent: false });
    api.budgetPdfUrl.mockResolvedValue({ url: 'https://signed.invalid/budget.pdf', expires_in: 600, file_name: 'Presupuesto.pdf', mime_type: 'application/pdf' });
    api.deleteBudgetPdf.mockResolvedValue({ deleted: true, idempotent: false });
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
    vi.spyOn(window, 'confirm').mockReturnValue(true);
  });

  it('precarga conceptos, agrupaciones y total desde el presupuesto canónico', async () => {
    render(<BudgetTab expedienteId="exp-1" />);
    expect(await screen.findByRole('heading', { name: 'Presupuesto' })).toBeInTheDocument();
    expect(screen.getByDisplayValue('Honorarios profesionales')).toBeInTheDocument();
    expect(screen.getAllByText('IVA de honorarios').length).toBeGreaterThan(0);
    expect(screen.getAllByText('$1,500.00').length).toBeGreaterThan(0);
  });

  it('mantiene la distribución interna colapsada y la abre de forma accesible', async () => {
    render(<BudgetTab expedienteId="exp-1" />); const toggle = await screen.findByRole('button', { name: /Distribución interna/ });
    expect(toggle).toHaveAttribute('aria-expanded', 'false'); expect(screen.queryByText('PRAVIA')).not.toBeInTheDocument();
    await userEvent.click(toggle); expect(toggle).toHaveAttribute('aria-expanded', 'true'); expect(screen.getByText('PRAVIA')).toBeInTheDocument();
    await userEvent.click(toggle); expect(screen.queryByText('PRAVIA')).not.toBeInTheDocument();
  });

  it('edita inline, muestra dirty state y guarda con versión optimista', async () => {
    const dirty = vi.fn(); render(<BudgetTab expedienteId="exp-1" onDirtyChange={dirty} />);
    const concept = await screen.findByDisplayValue('Honorarios profesionales'); fireEvent.change(concept, { target: { value: 'Honorarios actualizados' } });
    expect(screen.getByText('Cambios sin guardar')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Guardar cambios' }));
    await waitFor(() => expect(api.saveBudget).toHaveBeenCalledWith('exp-1', expect.objectContaining({ expected_version: 1, concepts: expect.arrayContaining([expect.objectContaining({ concepto: 'Honorarios actualizados' })]) })));
    expect(dirty).toHaveBeenCalledWith(true);
  });

  it('agrega y elimina conceptos sin modal ni wizard', async () => {
    render(<BudgetTab expedienteId="exp-1" />); await screen.findByDisplayValue('Honorarios profesionales');
    const groups = screen.getAllByRole('article'); await userEvent.click(within(groups[0]).getByRole('button', { name: 'Agregar concepto' }));
    expect(screen.getByLabelText('Importe de concepto 4')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Eliminar concepto 4' }));
    expect(screen.queryByLabelText('Importe de concepto 4')).not.toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('recalcula importes y porcentaje de la distribución en pantalla', async () => {
    render(<BudgetTab expedienteId="exp-1" />); await userEvent.click(await screen.findByRole('button', { name: /Distribución interna/ }));
    fireEvent.change(screen.getByLabelText(/Honorarios PRAVIA en porcentaje/), { target: { value: '33.3333' } });
    expect(screen.getByLabelText(/Honorarios PRAVIA en MXN/)).toHaveValue('333.33');
    fireEvent.change(screen.getByLabelText(/IVA PRAVIA en MXN/), { target: { value: '80.00' } });
    expect(screen.getByLabelText(/IVA PRAVIA en porcentaje/)).toHaveValue('50.0000');
  });

  it('no genera mientras hay cambios pendientes y genera después de guardar', async () => {
    render(<BudgetTab expedienteId="exp-1" />); const concept = await screen.findByDisplayValue('Honorarios profesionales');
    const generate = screen.getByRole('button', { name: 'Generar presupuesto' }); fireEvent.change(concept, { target: { value: 'Honorarios ajustados' } }); expect(generate).toBeDisabled();
    await userEvent.click(screen.getByRole('button', { name: 'Guardar cambios' })); await waitFor(() => expect(generate).not.toBeDisabled());
    await userEvent.click(generate); await waitFor(() => expect(api.generateBudgetPdf).toHaveBeenCalledWith('exp-1', expect.objectContaining({ expected_version: 2 })));
  });

  it('conserva historial inmutable y ofrece ver, descargar y retirar por permiso', async () => {
    render(<BudgetTab expedienteId="exp-1" />); expect(await screen.findByText('Presupuesto_EXP-0001-2026.pdf')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /Ver presupuesto/ }));
    await userEvent.click(screen.getByRole('button', { name: /Descargar presupuesto/ }));
    expect(api.budgetPdfUrl).toHaveBeenCalledTimes(2);
    await userEvent.click(screen.getByRole('button', { name: /Eliminar presupuesto/ }));
    await waitFor(() => expect(api.deleteBudgetPdf).toHaveBeenCalledWith('exp-1', 'pdf-1'));
  });

  it('preserva el borrador ante conflicto de concurrencia', async () => {
    const { ApiError } = await import('../services/api/client'); api.saveBudget.mockRejectedValueOnce(new ApiError('stale', 409));
    render(<BudgetTab expedienteId="exp-1" />); const concept = await screen.findByDisplayValue('Honorarios profesionales'); fireEvent.change(concept, { target: { value: 'Mi cambio local' } });
    await userEvent.click(screen.getByRole('button', { name: 'Guardar cambios' }));
    expect(await screen.findByText(/cambió en otra sesión/)).toBeInTheDocument(); expect(screen.getByDisplayValue('Mi cambio local')).toBeInTheDocument();
  });

  it('oculta distribución y acciones no autorizadas desde capacidades server-side', async () => {
    api.budget.mockResolvedValueOnce(fixture({ internal_distribution: null, capabilities: { can_edit: false, can_view_internal_distribution: false, can_edit_internal_distribution: false, can_generate_pdf: false, can_view_pdf: false, can_delete_pdf: false } }));
    render(<BudgetTab expedienteId="exp-1" />); await screen.findByRole('heading', { name: 'Presupuesto' });
    expect(screen.queryByRole('button', { name: /Distribución interna/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Guardar cambios' })).not.toBeInTheDocument(); expect(screen.queryByRole('button', { name: 'Generar presupuesto' })).not.toBeInTheDocument();
  });
});
