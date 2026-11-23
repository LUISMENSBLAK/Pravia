import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ISRWorkspacePage } from '../features/isr/ISRWorkspacePage';
import type { ISRInput } from '../features/isr/isr.types';

const api = vi.hoisted(() => ({ detail: vi.fn(), update: vi.fn(), resources: vi.fn(), calculate: vi.fn(), interpretOperation: vi.fn(), reviewProposal: vi.fn() }));
vi.mock('../features/isr/isr.service', () => ({ isrService: api }));
vi.mock('../features/auth/AuthProvider', () => ({ useAuth: () => ({ user: { permissions: ['isr.read', 'isr.write', 'isr.calculate', 'ia.execute'] } }) }));
const record = () => ({ id: 'calc-real-shape', folio: 'ISR-QA-PERSISTENCE', ejercicio: 2026, estado: 'BORRADOR', ultima_version: 0, datos_modificados: false, updated_at: '2026-11-21T00:00:00.000Z', input_data: { schemaVersion: 3, taxYear: 2026, operationDate: '', act: { name: '', fiscalClassification: 'OTRO', otherDescription: '' }, property: { type: 'TERRENO', sameAcquisitionDate: true }, values: { operation: '', appraisal: '', cadastral: '', landSale: '', constructionSale: '0' }, calculateIVA: false, parties: [], deductions: [] }, versiones: [], documentos: [], propuestas: [] });
const show = () => render(<MemoryRouter initialEntries={['/calculo-isr/calc-real-shape']}><Routes><Route path="/calculo-isr/:id" element={<ISRWorkspacePage />} /></Routes></MemoryRouter>);

describe('ISR · save/requery response real sin relaciones', () => {
  beforeEach(() => { vi.clearAllMocks(); api.detail.mockResolvedValue(record()); api.resources.mockResolvedValue({ acts: [], catalogs: {}, references: [], rule_sets: [], export_profiles: [] }); api.update.mockResolvedValue({ id: 'calc-real-shape', updated_at: '2026-11-21T00:00:01.000Z' }); api.calculate.mockResolvedValue({}); });
  it('Guardar vuelve a consultar detalle y no sustituye historial por el PATCH escalar', async () => {
    show(); const user = userEvent.setup(); await screen.findByRole('heading', { name: 'ISR-QA-PERSISTENCE' });
    await user.type(screen.getByLabelText('Valor de operación'), '746130');
    await user.click(screen.getByRole('button', { name: 'Guardar borrador' }));
    expect(await screen.findByText('Datos fiscales guardados.')).toBeInTheDocument();
    expect(screen.getByText('Historial inmutable')).toBeInTheDocument(); expect(api.detail).toHaveBeenCalledTimes(2);
    expect(api.update).toHaveBeenCalledWith('calc-real-shape', expect.objectContaining({ values: expect.objectContaining({ operation: '746130' }) }), expect.any(Object));
  });
  it('nacionalidad desconocida no aparenta ser México ni se inventa al añadir una parte', async () => {
    show(); await screen.findByRole('heading', { name: 'ISR-QA-PERSISTENCE' });
    await userEvent.click(screen.getAllByRole('button', { name: /^Agregar$/ })[0]);
    expect(screen.getByLabelText('Nacionalidad')).toHaveValue('');
    expect(screen.getByRole('option', { name: 'Sin información' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Guardar borrador' }));
    await screen.findByText('Datos fiscales guardados.');
    expect(api.update).toHaveBeenCalledWith('calc-real-shape', expect.objectContaining({ parties: [expect.objectContaining({ nationalityCode: '', fiscalResidence: 'POR_DETERMINAR' })] }), expect.any(Object));
  });
  it('Calcular espera guardar/reconsultar y después recarga el resultado', async () => {
    show(); await screen.findByRole('heading', { name: 'ISR-QA-PERSISTENCE' }); await userEvent.click(screen.getByRole('button', { name: 'Calcular' }));
    expect(await screen.findByText(/Cálculo v3 generado/)).toBeInTheDocument();
    expect(api.calculate).toHaveBeenCalledWith('calc-real-shape', 0); expect(api.detail).toHaveBeenCalledTimes(3);
  });
  it('interpretación guarda sólo borrador y deja las propuestas para revisión humana', async () => {
    api.interpretOperation.mockResolvedValue({}); show(); await screen.findByRole('heading', { name: 'ISR-QA-PERSISTENCE' });
    const description = screen.getByLabelText('Descripción de la operación');
    expect(description.closest('label')?.className).toMatch(/full/);
    expect(description.closest('label')?.parentElement?.className).toMatch(/formGrid/);
    await userEvent.type(screen.getByLabelText('Descripción de la operación'), 'Operación sintética de venta de terreno por $100.');
    await userEvent.click(screen.getByRole('button', { name: 'Interpretar con PRAVIA' }));
    expect(await screen.findByText(/Propuestas preparadas/)).toBeInTheDocument();
    expect(api.interpretOperation).toHaveBeenCalledWith('calc-real-shape', 'Operación sintética de venta de terreno por $100.', expect.any(String));
    expect(api.calculate).not.toHaveBeenCalled(); expect(api.reviewProposal).not.toHaveBeenCalled();
    await waitFor(() => expect(api.detail).toHaveBeenCalledTimes(2));
  });
  it.each([false, true])('adaptar histórico no inventa título fiscal, acto ni participación (contexto=%s)', async (withContext) => {
    const legacy: ISRInput = {
      operationType: 'ENAJENACION_INMUEBLE', taxYear: 2026,
      taxpayer: { fullName: 'SOCIEDAD SINTÉTICA QA', rfc: '', personType: 'MORAL', fiscalResidence: 'NO_CONFIRMADA', confirmed: false },
      property: { description: 'Terreno QA', landAndConstructionSameAcquisitionDate: true },
      acquisitionDate: '', saleDate: '', yearsElapsed: 0, salePrice: '', deductions: [],
      exemptionTreatment: 'PENDIENTE_REVISION', ordinaryCaseConfirmed: false, specialCases: [],
      ...(withContext ? { sourceContext: { capturedAt: '2026-11-21', acts: [], properties: [], parties: [{ relationId: 'rel', comparecienteId: 'master-qa', role: 'VENDEDOR', name: 'SOCIEDAD SINTÉTICA QA', personType: 'MORAL', fiscalResidence: 'NO_CONFIRMADA', validated: false }] } } : {}),
    };
    const snapshot = JSON.stringify(legacy);
    api.detail.mockResolvedValue({ ...record(), input_data: legacy });
    show(); await screen.findByRole('heading', { name: 'ISR-QA-PERSISTENCE' });
    expect(screen.getByLabelText('Tipo de sujeto')).toHaveValue('OTRO');
    expect(screen.getByLabelText('Nacionalidad')).toHaveValue('');
    expect(screen.getByLabelText('% enajena')).toHaveValue('');
    await userEvent.click(screen.getByRole('button', { name: 'Guardar borrador' }));
    await screen.findByText('Datos fiscales guardados.');
    expect(api.update).toHaveBeenCalledWith('calc-real-shape', expect.objectContaining({ parties: [expect.objectContaining({ subjectType: 'OTRO', percentage: '', acquisitionLayers: [expect.objectContaining({ percentage: '', acquisitionAct: 'OTRO', verified: false })] })] }), expect.any(Object));
    expect(JSON.stringify(legacy)).toBe(snapshot);
  });
});
