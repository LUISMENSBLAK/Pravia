import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { QuotePropertyValues } from '../features/quotes/components/QuotePropertyValues';
import type { Quote } from '../features/quotes/quotes.types';
import type { CommercialPropertyState } from '../features/properties/commercialProperty';
const mocks = vi.hoisted(() => ({ update: vi.fn() }));
vi.mock('../features/quotes/quotes.service', () => ({ quotesService: { updatePropertyValues: mocks.update } }));
const quote = { id: 'quote', estado: 'BORRADOR', updated_at: '2026-11-21T10:00:00Z', valor_operacion: null, valor_catastral: null, cuenta_predial: null, importe_predial: null } as Quote;
describe('Cotizaciones · tres valores opcionales sin alterar predial histórico', () => {
  beforeEach(() => { vi.clearAllMocks(); mocks.update.mockResolvedValue({}); });
  it('guarda los tres valores sin exigir presupuesto ni enviar campos prediales', async () => {
    const user = userEvent.setup(); const saved = vi.fn(); const notify = vi.fn();
    render(<QuotePropertyValues quote={quote} canWrite onSaved={saved} notify={notify} />);
    for (const name of ['Valor de operación (MXN)', 'Valor catastral (MXN)', 'Valor de avalúo (MXN)']) expect(screen.getByLabelText(name)).not.toBeRequired();
    expect(screen.queryByLabelText('Cuenta o número predial')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Importe del impuesto predial (MXN)')).not.toBeInTheDocument();
    await user.type(screen.getByLabelText('Valor de operación (MXN)'), '2500000.50');
    await user.type(screen.getByLabelText('Valor catastral (MXN)'), '1200000.25');
    await user.type(screen.getByLabelText('Valor de avalúo (MXN)'), '0');
    await user.click(screen.getByRole('button', { name: 'Guardar datos del inmueble' }));
    await waitFor(() => expect(saved).toHaveBeenCalledTimes(1));
    // The native numeric input may normalize trailing zeroes; the backend stores fixed-scale decimals.
    expect(mocks.update).toHaveBeenCalledWith('quote', { operationValue: '2500000.5', cadastralValue: '1200000.25', appraisalValue: '0' }, quote.updated_at);
  });
  it('permite borrar datos sin convertir los vacíos en cero', async () => {
    const user = userEvent.setup(); render(<QuotePropertyValues quote={{ ...quote, valor_avaluo: '100.00', cuenta_predial: '001', importe_predial: '100.00' }} canWrite onSaved={vi.fn()} notify={vi.fn()} />);
    await user.clear(screen.getByLabelText('Valor de avalúo (MXN)'));
    await user.click(screen.getByRole('button', { name: 'Guardar datos del inmueble' }));
    expect(mocks.update).toHaveBeenCalledWith('quote', { operationValue: null, cadastralValue: null, appraisalValue: null }, quote.updated_at);
  });
  it('muestra el conflicto del servidor y conserva la captura para revisión', async () => {
    const user = userEvent.setup(); const saved = vi.fn(); mocks.update.mockRejectedValue(new Error('La cotización cambió en otra sesión.'));
    render(<QuotePropertyValues quote={quote} canWrite onSaved={saved} notify={vi.fn()} />);
    await user.type(screen.getByLabelText('Valor de avalúo (MXN)'), '200'); await user.click(screen.getByRole('button', { name: 'Guardar datos del inmueble' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('La cotización cambió en otra sesión.');
    expect(screen.getByLabelText('Valor de avalúo (MXN)')).toHaveValue(200); expect(saved).not.toHaveBeenCalled();
  });
  it.each([['BORRADOR', false], ['ACEPTADA', true], ['CONVERTIDA_EXPEDIENTE', true]] as const)('respeta consulta e historia %s', (estado, canWrite) => {
    render(<QuotePropertyValues quote={{ ...quote, estado }} canWrite={canWrite} onSaved={vi.fn()} notify={vi.fn()} />);
    expect(screen.getByLabelText('Valor de avalúo (MXN)')).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Guardar datos del inmueble' })).not.toBeInTheDocument();
  });
  it('usa únicamente valores del maestro y no sustituye sus vacíos por capturas históricas', () => {
    const linkedState = { source: 'PREDIO_MASTER', values: { operationValue: '0', cadastralValue: null, appraisalValue: '123.45' } } as CommercialPropertyState;
    render(<QuotePropertyValues quote={{ ...quote, valor_catastral: '999' }} canWrite linkedState={linkedState} onSaved={vi.fn()} notify={vi.fn()} />);
    expect(screen.getByLabelText('Valor de operación (MXN)')).toHaveValue(0);
    expect(screen.getByLabelText('Valor catastral (MXN)')).toHaveValue(null);
    expect(screen.getByLabelText('Valor de avalúo (MXN)')).toHaveValue(123.45);
    expect(screen.getByLabelText('Valor de avalúo (MXN)')).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Guardar datos del inmueble' })).not.toBeInTheDocument();
  });
});
