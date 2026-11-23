import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NewQuoteFlow } from '../features/quotes/components/NewQuoteFlow';

const mocks = vi.hoisted(() => ({ create: vi.fn(), list: vi.fn() }));
vi.mock('../features/auth/AuthProvider', () => ({ useAuth: () => ({ user: { id: 'u', name: 'QA SINTÉTICO', permissions: ['cotizaciones.write', 'comparecientes.read'] } }) }));
vi.mock('../features/quotes/quotes.service', () => ({ quotesService: { createDirect: mocks.create } }));
vi.mock('../features/comparecientes/comparecientes.service', () => ({ comparecientesService: { list: mocks.list } }));
const mount = (done = vi.fn()) => { render(<MemoryRouter><NewQuoteFlow onClose={vi.fn()} onCreated={done} /></MemoryRouter>); return done; };
describe('Alta directa de Cotización', () => {
  beforeEach(() => { vi.clearAllMocks(); mocks.list.mockResolvedValue({ data: [{ id: 'party', nombre: 'CLIENTE SINTÉTICO' }] }); mocks.create.mockResolvedValue({ id: 'q', numero_cotizacion: 'COT-0001-2026' }); });
  it('crea sin Prospecto ni acto ni cliente obligatorio y entrega la ficha creada', async () => {
    const done = mount(), user = userEvent.setup();
    await user.type(screen.getByLabelText('Contexto de la operación (opcional)'), 'Prueba QA');
    await user.click(screen.getByRole('button', { name: 'Crear cotización' }));
    await waitFor(() => expect(done).toHaveBeenCalledWith(expect.objectContaining({ id: 'q' })));
    expect(mocks.create).toHaveBeenCalledWith({ formalApplicantId: null, operationContext: 'Prueba QA', confirm: true, idempotencyKey: expect.any(String) });
    expect(screen.queryByLabelText('Prospecto')).not.toBeInTheDocument();
  });
  it('busca y relaciona el cliente canónico por ID, no por nombre libre', async () => {
    mount(); const user = userEvent.setup();
    await screen.findByRole('option', { name: 'CLIENTE SINTÉTICO' });
    await user.selectOptions(screen.getByLabelText('Cliente / solicitante (opcional)'), 'party');
    await user.click(screen.getByRole('button', { name: 'Crear cotización' }));
    await waitFor(() => expect(mocks.create).toHaveBeenCalledWith(expect.objectContaining({ formalApplicantId: 'party' })));
  });
  it('doble click no duplica y retry después de error conserva idempotency key y datos', async () => {
    mount(); const user = userEvent.setup(); mocks.create.mockRejectedValueOnce(new Error('Fallo transitorio'));
    await user.click(screen.getByRole('button', { name: 'Crear cotización' }));
    await screen.findByRole('alert'); const key = mocks.create.mock.calls[0][0].idempotencyKey;
    let finish!: (q: unknown) => void; mocks.create.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    await user.dblClick(screen.getByRole('button', { name: 'Crear cotización' }));
    expect(mocks.create).toHaveBeenCalledTimes(2); expect(mocks.create.mock.calls[1][0].idempotencyKey).toBe(key);
    finish({ id: 'q' });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Crear cotización' })).toBeEnabled());
  });
});
