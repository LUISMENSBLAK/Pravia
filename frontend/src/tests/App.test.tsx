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
    expect(screen.getAllByAltText('PRAVIA OS — Plataforma Notarial')[0]).toHaveAttribute('src', '/brand/pravia-os/pravia-os-lockup.png');
    expect(screen.getByText('PLATAFORMA NOTARIAL')).toBeInTheDocument();
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

  it('distingue un fallo de red de credenciales inválidas', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).endsWith('/auth/login')) throw new TypeError('Failed to fetch');
      return jsonResponse({ message: 'No session' }, 401);
    }));
    const user = userEvent.setup();
    render(<MemoryRouter initialEntries={['/login']}><App /></MemoryRouter>);
    await screen.findByRole('heading', { name: 'Bienvenido a PRAVIA OS' });
    await user.type(screen.getByLabelText('Correo electrónico'), 'persona@notaria.mx');
    await user.type(screen.getByLabelText('Contraseña'), 'contraseña-segura');
    await user.click(screen.getByRole('button', { name: 'Iniciar sesión' }));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('No fue posible conectar con el backend.'));
  });

  it('distingue un backend temporalmente no disponible', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).endsWith('/auth/login')) return jsonResponse({ code: 'SERVICE_UNAVAILABLE' }, 503);
      return jsonResponse({ message: 'No session' }, 401);
    }));
    const user = userEvent.setup();
    render(<MemoryRouter initialEntries={['/login']}><App /></MemoryRouter>);
    await screen.findByRole('heading', { name: 'Bienvenido a PRAVIA OS' });
    await user.type(screen.getByLabelText('Correo electrónico'), 'persona@notaria.mx');
    await user.type(screen.getByLabelText('Contraseña'), 'contraseña-segura');
    await user.click(screen.getByRole('button', { name: 'Iniciar sesión' }));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('El backend no está disponible en este momento.'));
  });
});
