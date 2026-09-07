import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ProspectWorkflowPanel } from '../features/prospects/components/ProspectWorkflowPanel';
import { prospectsService } from '../features/prospects/prospects.service';
import type { Prospect, ProspectWorkflow, ProspectWorkflowAction } from '../features/prospects/prospects.types';

vi.mock('../features/prospects/prospects.service', () => ({ prospectsService: { act: vi.fn() } }));
const prospect = { id: 'p1', user_id: 'u1', nombre: 'CLIENTE', estado: 'NUEVO', prioridad: 'MEDIA', created_at: '2026-09-06', updated_at: '2026-09-06' } as Prospect;
const stages = [
  ['NUEVO', 'Nuevo'], ['EN_INTEGRACION', 'En integración'], ['LISTO_PARA_COTIZAR', 'Listo para cotizar'], ['CONVERTIDO_EN_COTIZACION', 'Convertido en cotización'],
].map(([code, label]) => ({ code, label }));
const workflow = (stage = 'NUEVO', action?: ProspectWorkflowAction, overrides: Partial<ProspectWorkflow> = {}): ProspectWorkflow => ({
  stage, stageLabel: stages.find((item) => item.code === stage)?.label ?? 'Etapa histórica', stageEnteredAt: '2026-09-06T10:00:00Z',
  knowledge: 'KNOWN', version: 1, folio: 'PRO-0001-2026', wait: { type: null, knowledge: 'NOT_APPLICABLE', label: 'Sin espera' }, stages,
  actions: action ? [{ code: action, label: ({ COMENZAR_INTEGRACION: 'Comenzar integración', MARCAR_LISTO_PARA_COTIZAR: 'Marcar listo para cotizar', CONVERTIR: 'Convertir en cotización', SUSPENDER: 'Suspender prospecto', CANCELAR: 'Cancelar prospecto' } as const)[action] }] : [],
  notaria: null, notaries: [], responsibles: [], source: null, sourceHistory: [], canReadSource: true, quote: null, events: [], ...overrides,
});
const changed = vi.fn().mockResolvedValue(undefined);
const show = (value: ProspectWorkflow, canWrite = true) => render(<MemoryRouter><ProspectWorkflowPanel prospect={prospect} workflow={value} canWrite={canWrite} onChanged={changed} /></MemoryRouter>);

describe('Corrección 001 · flujo Prospecto a Cotización', () => {
  beforeEach(() => { vi.clearAllMocks(); vi.mocked(prospectsService.act).mockResolvedValue({ idempotent: false, quoteId: null }); });

  it('muestra cuatro etapas humanas y no expone el flujo notarial retirado', () => {
    show(workflow('NUEVO', 'COMENZAR_INTEGRACION'));
    for (const item of stages) expect(screen.getAllByText(item.label).length).toBeGreaterThan(0);
    expect(document.body).not.toHaveTextContent(/solicitud a notaría|espera de cotización|cotización recibida/i);
    expect(document.body).not.toHaveTextContent('EN_INTEGRACION');
  });

  it.each([
    ['NUEVO', 'COMENZAR_INTEGRACION', 'Comenzar integración'],
    ['EN_INTEGRACION', 'MARCAR_LISTO_PARA_COTIZAR', 'Marcar listo para cotizar'],
    ['LISTO_PARA_COTIZAR', 'CONVERTIR', 'Convertir en cotización'],
  ] as const)('presenta una sola acción principal contextual en %s', (stage, action, label) => {
    show(workflow(stage, action));
    expect(screen.getByRole('button', { name: label })).toBeInTheDocument();
    expect(screen.queryByRole('combobox', { name: /estado/i })).not.toBeInTheDocument();
  });

  it('registra la acción con versión, confirmación e idempotencia', async () => {
    show(workflow('EN_INTEGRACION', 'MARCAR_LISTO_PARA_COTIZAR'));
    await userEvent.click(screen.getByRole('button', { name: 'Marcar listo para cotizar' }));
    await userEvent.click(screen.getByRole('button', { name: 'Confirmar' }));
    await waitFor(() => expect(prospectsService.act).toHaveBeenCalledWith('p1', expect.objectContaining({ action: 'MARCAR_LISTO_PARA_COTIZAR', expectedVersion: 1, confirm: true, idempotencyKey: expect.any(String) })));
    expect(changed).toHaveBeenCalledTimes(1);
  });

  it('protege el doble click en conversión desde la UI', async () => {
    let resolve!: () => void;
    vi.mocked(prospectsService.act).mockImplementation(() => new Promise((done) => { resolve = () => done({ idempotent: false, quoteId: 'q1' }); }));
    show(workflow('LISTO_PARA_COTIZAR', 'CONVERTIR'));
    await userEvent.click(screen.getByRole('button', { name: 'Convertir en cotización' }));
    const confirm = screen.getByRole('button', { name: 'Confirmar' });
    await userEvent.click(confirm);
    await userEvent.click(confirm);
    expect(prospectsService.act).toHaveBeenCalledTimes(1);
    resolve();
    await waitFor(() => expect(changed).toHaveBeenCalled());
  });

  it('después de convertir sólo ofrece Ir a cotización', () => {
    show(workflow('CONVERTIDO_EN_COTIZACION', undefined, { quote: { id: 'q1', estado: 'BORRADOR', numero_cotizacion: 'COT-0001-2026' } }));
    expect(screen.getByRole('link', { name: 'Ir a cotización' })).toHaveAttribute('href', '/cotizaciones/q1');
    expect(screen.queryByRole('button', { name: 'Convertir en cotización' })).not.toBeInTheDocument();
  });

  it('mantiene registros legacy sin transición nueva ni operación', () => {
    show(workflow('EN_ESPERA_COTIZACION', undefined, { knowledge: 'UNKNOWN_LEGACY', stages, stageLabel: 'Etapa por confirmar' }));
    expect(screen.getByText(/modo de consulta/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /convertir/i })).not.toBeInTheDocument();
  });
});
