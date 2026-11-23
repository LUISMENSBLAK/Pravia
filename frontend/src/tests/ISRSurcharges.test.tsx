import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ISRSurcharges } from '../features/isr/ISRSurcharges';
import type { ISRV3PartyResult } from '../features/isr/isr.types';
const api = vi.hoisted(() => ({ surcharges: vi.fn() }));
vi.mock('../features/isr/isr.service', () => ({ isrService: api }));
const parties = [{ partyId: 'seller', partyName: 'Persona sintética QA', amount: '1000.00' }] as ISRV3PartyResult[];
async function fill() {
  await userEvent.click(screen.getByText('Calcular actualización y recargos'));
  await userEvent.selectOptions(screen.getByLabelText('Contribuyente e ISR original'), 'seller');
  await userEvent.type(screen.getByLabelText('Fecha legal de vencimiento confirmada'), '2026-01-31');
  await userEvent.type(screen.getByLabelText('Fecha hipotética de pago'), '2026-03-15');
}
describe('ISR · accesorios separados del original', () => {
  beforeEach(() => { vi.clearAllMocks(); api.surcharges.mockResolvedValue({ principal: '1000.00', updateAmount: '100.00', surcharges: '38.50', total: '1138.50', delayMonths: 2, updateFactor: '1.1' }); });
  it('usa sólo ID/versión/persona como autoridad, no envía un principal editable', async () => {
    render(<ISRSurcharges calculationId="calc" version={2} parties={parties} disabled={false} />); await fill();
    await userEvent.click(screen.getByRole('button', { name: 'Estimar actualización y recargos' }));
    expect(await screen.findByRole('region', { name: 'Estimación de actualización y recargos' })).toHaveTextContent('$1,138.50');
    expect(api.surcharges).toHaveBeenCalledWith({ calculation_id: 'calc', expected_version: 2, party_id: 'seller', due_date: '2026-01-31', payment_date: '2026-03-15' });
    expect(parties[0].amount).toBe('1000.00');
  });
  it('faltan referencias muestra causa, no un total ni cero falsos', async () => {
    api.surcharges.mockRejectedValue(new Error('Faltan INPC verificados'));
    render(<ISRSurcharges calculationId="calc" version={2} parties={parties} disabled={false} />); await fill();
    await userEvent.click(screen.getByRole('button', { name: 'Estimar actualización y recargos' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Faltan INPC'); expect(screen.queryByRole('region')).not.toBeInTheDocument();
  });
  it('permiso/versión sin vigencia bloquea la acción; sin ISR determinado no hay formulario', () => {
    const { rerender } = render(<ISRSurcharges calculationId="calc" version={2} parties={parties} disabled />);
    expect(screen.getByRole('button', { name: 'Estimar actualización y recargos', hidden: true })).toBeDisabled();
    rerender(<ISRSurcharges calculationId="calc" version={2} parties={[{ ...parties[0], amount: null }]} disabled={false} />); expect(screen.queryByText('Calcular actualización y recargos')).not.toBeInTheDocument();
  });
});
