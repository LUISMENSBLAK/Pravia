import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../app/App';

const jsonResponse = (body: unknown, status: number) => new Response(JSON.stringify(body), {
  status,
  headers: { 'Content-Type': 'application/json' },
});

describe('App auth flow', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/auth/login')) return jsonResponse({ message: 'Unauthorized' }, 401);
      return jsonResponse({ message: 'No session' }, 401);
    }));
  });

  it('protege el shell y dirige a login sin parpadeo de contenido privado', async () => {
    render(<MemoryRouter initialEntries={['/mi-dia']}><App /></MemoryRouter>);
    expect(screen.getByRole('status', { name: 'Validando sesión' })).toBeInTheDocument();
    expect(await screen.findByRole('heading', { name: 'Bienvenido a PRAVIA OS' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Mi Día' })).not.toBeInTheDocument();
  });

  it('muestra un error humano cuando el backend rechaza el login', async () => {
    const user = userEvent.setup();
    render(<MemoryRouter initialEntries={['/login']}><App /></MemoryRouter>);
    await screen.findByRole('heading', { name: 'Bienvenido a PRAVIA OS' });
    await user.type(screen.getByLabelText('Correo electrónico'), 'persona@notaria.mx');
    await user.type(screen.getByLabelText('Contraseña'), 'contraseña-segura');
    await user.click(screen.getByRole('button', { name: 'Iniciar sesión' }));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('No pudimos iniciar sesión con esos datos.'));
  });
});
