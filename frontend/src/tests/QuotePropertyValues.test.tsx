import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { QuotePropertyValues } from '../features/quotes/components/QuotePropertyValues';
import type { Quote } from '../features/quotes/quotes.types';
const mocks = vi.hoisted(() => ({ update: vi.fn() }));
vi.mock('../features/quotes/quotes.service', () => ({ quotesService: { updatePropertyValues: mocks.update } }));
const quote = { id: 'quote', estado: 'BORRADOR', updated_at: '2026-11-21T10:00:00Z', valor_operacion: null, valor_catastral: null, cuenta_predial: null, importe_predial: null } as Quote;
describe('Cotizaciones · valores opcionales y cuenta predial', () => {
  beforeEach(() => { vi.clearAllMocks(); mocks.update.mockResolvedValue({}); });
  it('guarda los cuatro datos sin exigir presupuesto y conserva los ceros de la cuenta', async () => {
    const user = userEvent.setup(); const saved = vi.fn(); const notify = vi.fn();
    render(<QuotePropertyValues quote={quote} canWrite onSaved={saved} notify={notify} />);
    for (const name of ['Valor de operación (MXN)', 'Valor catastral (MXN)', 'Cuenta o número predial', 'Importe del impuesto predial (MXN)']) expect(screen.getByLabelText(name)).not.toBeRequired();
    await user.type(screen.getByLabelText('Valor de operación (MXN)'), '2500000.50');
    await user.type(screen.getByLabelText('Valor catastral (MXN)'), '1200000.25');
    await user.type(screen.getByLabelText('Cuenta o número predial'), '0001-a/26');
    await user.type(screen.getByLabelText('Importe del impuesto predial (MXN)'), '0');
    await user.click(screen.getByRole('button', { name: 'Guardar datos del inmueble' }));
    await waitFor(() => expect(saved).toHaveBeenCalledTimes(1));
    // The native numeric input may normalize trailing zeroes; the backend stores fixed-scale decimals.
    expect(mocks.update).toHaveBeenCalledWith('quote', { operationValue: '2500000.5', cadastralValue: '1200000.25', propertyTaxAccount: '0001-a/26', predialAmount: '0' }, quote.updated_at);
  });
  it('permite borrar datos sin convertir los vacíos en cero', async () => {
    const user = userEvent.setup(); render(<QuotePropertyValues quote={{ ...quote, cuenta_predial: '001', importe_predial: '100.00' }} canWrite onSaved={vi.fn()} notify={vi.fn()} />);
    await user.clear(screen.getByLabelText('Cuenta o número predial')); await user.clear(screen.getByLabelText('Importe del impuesto predial (MXN)'));
    await user.click(screen.getByRole('button', { name: 'Guardar datos del inmueble' }));
    expect(mocks.update).toHaveBeenCalledWith('quote', { operationValue: null, cadastralValue: null, propertyTaxAccount: null, predialAmount: null }, quote.updated_at);
  });
  it('muestra el conflicto del servidor y conserva la captura para revisión', async () => {
    const user = userEvent.setup(); const saved = vi.fn(); mocks.update.mockRejectedValue(new Error('La cotización cambió en otra sesión.'));
    render(<QuotePropertyValues quote={quote} canWrite onSaved={saved} notify={vi.fn()} />);
    await user.type(screen.getByLabelText('Cuenta o número predial'), '0002'); await user.click(screen.getByRole('button', { name: 'Guardar datos del inmueble' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('La cotización cambió en otra sesión.');
    expect(screen.getByLabelText('Cuenta o número predial')).toHaveValue('0002'); expect(saved).not.toHaveBeenCalled();
  });
  it.each([['BORRADOR', false], ['ACEPTADA', true], ['CONVERTIDA_EXPEDIENTE', true]] as const)('respeta consulta e historia %s', (estado, canWrite) => {
    render(<QuotePropertyValues quote={{ ...quote, estado }} canWrite={canWrite} onSaved={vi.fn()} notify={vi.fn()} />);
    expect(screen.getByLabelText('Cuenta o número predial')).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Guardar datos del inmueble' })).not.toBeInTheDocument();
  });
});
