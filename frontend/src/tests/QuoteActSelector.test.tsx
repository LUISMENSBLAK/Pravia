import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { QuoteActSelector } from '../features/quotes/components/QuoteActSelector';
import type { Quote } from '../features/quotes/quotes.types';
const mocks = vi.hoisted(() => ({ list: vi.fn(), attach: vi.fn() }));
vi.mock('../features/quotes/quotes.service', () => ({ quotesService: { actTypes: mocks.list, attachAct: mocks.attach } }));
describe('Selección de acto en Cotización directa', () => {
  it('busca y vincula un acto existente sin crear uno nuevo ni necesitar Prospecto', async () => {
    mocks.list.mockResolvedValue([{ id: 'a1', nombre: 'Compraventa QA' }, { id: 'a2', nombre: 'Donación QA' }]); mocks.attach.mockResolvedValue({ idempotent: false });
    const saved = vi.fn(), user = userEvent.setup();
    render(<QuoteActSelector quote={{ id: 'q', actos: [], prospecto_id: null } as unknown as Quote} onSaved={saved} />);
    await screen.findByRole('option', { name: 'Compraventa QA' });
    await user.type(screen.getByLabelText('Buscar acto existente'), 'compra');
    expect(screen.queryByRole('option', { name: 'Donación QA' })).not.toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText('Acto del catálogo'), 'a1');
    await user.click(screen.getByRole('button', { name: 'Agregar acto a la cotización' }));
    await waitFor(() => expect(saved).toHaveBeenCalledTimes(1)); expect(mocks.attach).toHaveBeenCalledWith('q', 'a1');
  });
});
