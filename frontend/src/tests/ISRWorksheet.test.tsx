import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { ISRWorksheet } from '../features/isr/ISRWorksheet';
import { ISRAcquisitionEditor } from '../features/isr/ISRAcquisitionEditor';
import type { ISRVersion, ISRV3Input, ISRV3Party } from '../features/isr/isr.types';

const input: ISRV3Input = { schemaVersion: 3, taxYear: 2026, operationDate: '2026-11-11', act: { name: 'QA sintético', fiscalClassification: 'OTRO' }, property: { type: 'TERRENO', sameAcquisitionDate: true }, values: { operation: '746130', appraisal: '746130', cadastral: '', landSale: '746130', constructionSale: '0' }, calculateIVA: false, deductions: [], parties: [] };
type Layer = NonNullable<ISRV3Party['acquisitionLayers']>[number];
const layer: Layer = { id: 'qa', percentage: '100', fiscalDate: '2025-05-26', legalDate: '2025-05-26', acquisitionAct: 'ONEROSA', adjustedLandCost: '', adjustedConstructionCost: '', source: 'Antecedente QA', verified: true, historical: { method: 'AUTO', separation: 'EXPLICIT', land: '2034.65', construction: '0' } };
function Acquisition({ construction = false }: { construction?: boolean }) {
  const [current, setCurrent] = useState(layer);
  return <ISRAcquisitionEditor input={{ ...input, property: { ...input.property, type: construction ? 'TERRENO_CONSTRUCCION' : 'TERRENO' } }} layer={current} disabled={false} onChange={(patch) => setCurrent({ ...current, ...patch })} />;
}
describe('ISR · hoja técnica inmutable y adquisición progresiva', () => {
  it('sólo terreno oculta construcción y separación; adquisición/enajenación están juntas', async () => {
    render(<Acquisition />);
    expect(screen.getByRole('heading', { name: 'Adquisición' })).toBeInTheDocument(); expect(screen.getByRole('heading', { name: 'Enajenación' })).toBeInTheDocument();
    expect(screen.getByLabelText('Costo histórico terreno')).toHaveValue('2034.65');
    expect(screen.queryByLabelText('Costo histórico construcción')).not.toBeInTheDocument(); expect(screen.queryByLabelText('Separación del costo')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Método de actualización')).toHaveValue('AUTO');
    await userEvent.selectOptions(screen.getByLabelText('Método de actualización'), 'FACTORES');
    expect(screen.getByLabelText('Datos y fuente de adquisición verificados')).not.toBeChecked();
  });
  it('separación supletoria pide un total, no obliga a inventar dos importes', async () => {
    render(<Acquisition construction />);
    await userEvent.selectOptions(screen.getByLabelText('Separación del costo'), 'STATUTORY');
    expect(screen.getByLabelText('Costo histórico total')).toBeInTheDocument(); expect(screen.queryByLabelText('Costo histórico terreno')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Costo histórico construcción')).not.toBeInTheDocument();
  });
  it('hoja muestra snapshot, alternativas, parámetros y distribución sin recalcular', async () => {
    const close = vi.fn(); const version = { version: 2, calculated_at: '2026-11-21T00:00:00Z', input_snapshot: input, result: { schemaVersion: 3, ruleVersion: 'QA-2026', saleISR: [{ partyId: 'qa', partyName: 'Persona sintética QA', amount: '126288.13', taxableBase: '671517.00', missing: [], acquisitionWorksheet: { updatedCost: '2116.04', minimumCost: '74613.00', appliedCost: '74613.00', appliedDeductions: '0.00', taxableRatio: '1' }, traces: [{ ruleId: 'ANEXO_QA', legalReference: 'Fuente sintética', ruleVersion: '1', inputsUsed: { factor: '1.04', historicalLand: '2034.65', fullYears: '1' }, calculation: 'costo × factor', result: '2116.04', explanation: 'Alternativa seleccionada' }], distribution: { statePayment: '33575.85', federalRemainder: '92712.28', status: 'DETERMINADO', traces: [] } }], acquisitionISR: [], missing: [] } } as unknown as ISRVersion;
    render(<ISRWorksheet version={version} onClose={close} />);
    expect(screen.getByRole('dialog', { name: 'Hoja de trabajo ISR' })).toHaveTextContent('Snapshot inmutable');
    expect(screen.getByText('Factor')).toBeInTheDocument(); expect(screen.getByText('1.04')).toBeInTheDocument();
    expect(screen.getByText('$33,575.85')).toBeInTheDocument(); expect(screen.getByText('$92,712.28')).toBeInTheDocument();
    await userEvent.keyboard('{Escape}'); expect(close).toHaveBeenCalledOnce();
  });
});
