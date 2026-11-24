import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CommercialPropertyPicker } from '../features/properties/CommercialPropertyPicker';
import { resolveCommercialPropertyReturn, type CommercialPropertyState } from '../features/properties/commercialProperty';
const mocks = vi.hoisted(() => ({ read: vi.fn(), options: vi.fn(), select: vi.fn() }));
vi.mock('../features/properties/commercialProperty', async original => ({
  ...await original<typeof import('../features/properties/commercialProperty')>(), commercialPropertyService: mocks,
}));
const property = { id: 'property-qa', apodo: 'SINTÉTICO QA', version: 1, valor_operacion: '123.45', valor_catastral: '0', valor_avaluo: null };
const state: CommercialPropertyState = { property: null, source: 'MANUAL', expected_updated_at: '2026-11-23T00:00:00Z', values: { operationValue: null, cadastralValue: null, appraisalValue: null }, capabilities: { canWrite: true, canCreateProperty: true, canOpenProperty: true } };
const mount = (props: Partial<React.ComponentProps<typeof CommercialPropertyPicker>> = {}) => render(<MemoryRouter>
  <CommercialPropertyPicker kind="cotizacion" id="quote-qa" {...props} />
</MemoryRouter>);

describe('Selector canónico de inmueble comercial', () => {
  beforeEach(() => { vi.clearAllMocks(); mocks.read.mockResolvedValue(state); mocks.options.mockResolvedValue([property]); mocks.select.mockResolvedValue({ ...state, property, source: 'PREDIO_MASTER' }); });
  it('busca y exige confirmar explícitamente; muestra valores y conserva cero vs dato ausente', async () => {
    const user = userEvent.setup(); mount();
    await user.type(await screen.findByRole('searchbox'), 'SINT');
    await user.click(await screen.findByRole('button', { name: 'SINTÉTICO QA Sin referencias adicionales' }));
    expect(screen.getByText('$123.45')).toBeInTheDocument(); expect(screen.getByText('$0.00')).toBeInTheDocument();
    expect(screen.getByText('Sin información')).toBeInTheDocument(); expect(mocks.select).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Confirmar vínculo' }));
    expect(mocks.select).toHaveBeenCalledWith('cotizacion', 'quote-qa', state, property);
    expect(await screen.findByRole('link', { name: 'Ver ficha maestra' })).toHaveAttribute('href', '/predios/property-qa?fromQuote=quote-qa');
  });
  it('conserva selección y error real ante un conflicto del servidor, sin fingir éxito', async () => {
    mocks.select.mockRejectedValue(new Error('La ficha cambió. Vuelve a seleccionarla.'));
    const user = userEvent.setup(); mount(); await user.type(await screen.findByRole('searchbox'), 'SINT');
    await user.click(await screen.findByRole('button', { name: 'SINTÉTICO QA Sin referencias adicionales' }));
    await user.click(screen.getByRole('button', { name: 'Confirmar vínculo' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('La ficha cambió.');
    expect(screen.getByRole('button', { name: 'Confirmar vínculo' })).toBeEnabled();
    expect(screen.getByText('Sin inmueble vinculado')).toBeInTheDocument();
  });
  it('lector compartido no puede buscar, crear, desvincular ni confirmar', async () => {
    mocks.read.mockResolvedValue({ ...state, property, source: 'PREDIO_MASTER', capabilities: { ...state.capabilities, canWrite: false, canCreateProperty: false } });
    mount(); await screen.findByText('SINTÉTICO QA');
    expect(screen.getByRole('link', { name: 'Ver ficha maestra' })).toBeInTheDocument();
    expect(screen.queryByRole('searchbox')).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Dar de alta inmueble' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });
  it('protege la captura pendiente y permite volver al origen correcto', async () => {
    mount({ kind: 'prospecto', id: 'prospect-qa', navigationBlocked: true });
    await screen.findByText('Sin inmueble vinculado');
    expect(screen.queryByRole('searchbox')).not.toBeInTheDocument();
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Guarda o descarta');
    expect(resolveCommercialPropertyReturn('?fromProspect=prospect-qa')?.returnPath).toBe('/prospectos/prospect-qa#inmueble');
    expect(resolveCommercialPropertyReturn('?fromQuote=quote-qa')?.returnPath).toBe('/cotizaciones/quote-qa#inmueble');
    expect(resolveCommercialPropertyReturn('?fromQuote=https://evil.test')).toBeNull();
    expect(resolveCommercialPropertyReturn('?fromQuote=a&fromProspect=b')).toBeNull();
  });
  it('informa carga y error de lectura sin ofrecer acciones a ciegas', async () => {
    let reject!: (cause: Error) => void;
    mocks.read.mockReturnValue(new Promise((_resolve, rejectPromise) => { reject = rejectPromise; }));
    mount(); expect(screen.getByRole('status')).toHaveTextContent('Consultando inmueble');
    reject(new Error('No tienes permiso para consultar el inmueble vinculado.'));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('No tienes permiso'));
    expect(screen.queryByRole('searchbox')).not.toBeInTheDocument();
  });
});
