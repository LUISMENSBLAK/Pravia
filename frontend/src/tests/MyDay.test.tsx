import { act, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import userEvent from '@testing-library/user-event';
import { App } from '../app/App';
import { normalizeMyDay } from '../features/my-day/myDay.service';
import { formatOperationalStatus } from '../features/my-day/formatters';

const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { 'Content-Type': 'application/json' },
});

const session = { user: { id: 'qa', name: 'Usuario Prueba', email: 'qa@notaria.mx', role: 'Operación' } };

const baseDashboard = {
  permissions: { canViewFinance: false },
  kpis: {
    activeFiles: { value: 2, label: 'Expedientes activos' },
    signaturesToday: { value: 0, label: 'Firmas hoy' },
    urgentPending: { value: 0, label: 'Pendientes urgentes' },
    operationalFallback: { value: 3, label: 'Tareas del día' },
  },
  agenda: [], urgentSignatures: [], recentFiles: [], recommendation: null, reminders: [], urgentTasks: [], errors: {},
};

describe('Mi Día', () => {
  it('presenta estados operativos humanos sin modificar el valor canónico', () => {
    expect(formatOperationalStatus('EN_PROCESO')).toBe('En proceso');
    expect(formatOperationalStatus('PENDIENTE_CLIENTE')).toBe('Pendiente del cliente');
    expect(formatOperationalStatus('ESTADO_HISTORICO')).toBe('Estado historico');
  });

  it('normaliza un payload parcial sin inventar colecciones ni permisos', () => {
    const normalized = normalizeMyDay({ data: { permissions: {}, agenda: null } });
    expect(normalized.permissions.canViewFinance).toBe(false);
    expect(normalized.agenda).toEqual([]);
    expect(normalized.urgentTasks).toEqual([]);
  });

  it('muestra estados vacíos y sustituye el KPI financiero sin permiso', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/auth/me')) return response(session);
      if (url.endsWith('/mi-dia')) return response({ data: baseDashboard });
      return response({}, 204);
    }));
    render(<MemoryRouter initialEntries={['/mi-dia']}><App /></MemoryRouter>);
    expect(await screen.findByRole('heading', { name: /Usuario/ })).toBeInTheDocument();
    expect(await screen.findByText('Tareas del día')).toBeInTheDocument();
    expect(screen.getByText('No tienes eventos programados para hoy.')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Resumen financiero' })).not.toBeInTheDocument();
  });

  it('aísla el error de agenda y mantiene los demás widgets disponibles', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/auth/me')) return response(session);
      if (url.endsWith('/mi-dia')) return response({ data: { ...baseDashboard, errors: { agenda: 'Agenda unavailable' } } });
      return response({}, 204);
    }));
    render(<MemoryRouter initialEntries={['/mi-dia']}><App /></MemoryRouter>);
    expect(await screen.findByText('No pudimos cargar tus eventos.')).toBeInTheDocument();
    expect(screen.getByText('Sin firmas pendientes.')).toBeInTheDocument();
    expect(screen.getByText('Todo bajo control por ahora.')).toBeInTheDocument();
  });

  it('actualiza los datos reales al recibir un cambio sin recargar la página', async () => {
    let myDayCalls = 0;
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/auth/me')) return response(session);
      if (url.endsWith('/mi-dia')) {
        myDayCalls += 1;
        return response({ data: { ...baseDashboard, kpis: { ...baseDashboard.kpis, activeFiles: { value: myDayCalls === 1 ? 2 : 5, label: 'Expedientes activos' } } } });
      }
      return response({}, 204);
    }));
    render(<MemoryRouter initialEntries={['/mi-dia']}><App /></MemoryRouter>);
    expect(await screen.findByText('2')).toBeInTheDocument();
    act(() => window.dispatchEvent(new CustomEvent('pravia:data-changed', { detail: { path: '/agenda', method: 'POST' } })));
    await waitFor(() => expect(screen.getByText('5')).toBeInTheDocument());
    expect(myDayCalls).toBeGreaterThanOrEqual(2);
  });

  it('muestra skeletons por widget mientras el dashboard está cargando', async () => {
    vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/auth/me')) return Promise.resolve(response(session));
      if (url.endsWith('/mi-dia')) return new Promise<Response>(() => undefined);
      return Promise.resolve(response({}, 204));
    }));
    render(<MemoryRouter initialEntries={['/mi-dia']}><App /></MemoryRouter>);
    expect((await screen.findAllByRole('status', { name: 'Cargando información' })).length).toBeGreaterThan(3);
  });

  it('abre la misma experiencia global de PRAVIA IA desde la card de Mi Día', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/auth/me')) return response(session);
      if (url.endsWith('/mi-dia')) return response({ data: baseDashboard });
      return response({}, 204);
    }));
    const user = userEvent.setup();
    render(<MemoryRouter initialEntries={['/mi-dia']}><App /></MemoryRouter>);
    await screen.findByRole('heading', { name: /Usuario/ });
    expect(screen.getByRole('button', { name: 'Buscar expediente' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Ver pendientes' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Programar firma' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Resumen financiero' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Abrir PRAVIA IA para hacer una pregunta' }));
    expect(await screen.findByRole('dialog', { name: 'PRAVIA IA' })).toBeInTheDocument();
  });

  it('transfiere el foco al contenido principal desde el skip link', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/auth/me')) return response(session);
      if (url.endsWith('/mi-dia')) return response({ data: baseDashboard });
      return response({}, 204);
    }));
    const user = userEvent.setup();
    render(<MemoryRouter initialEntries={['/mi-dia']}><App /></MemoryRouter>);
    await screen.findByRole('heading', { name: /Usuario/ });
    const skipLink = screen.getByRole('link', { name: 'Saltar al contenido' });
    skipLink.focus();
    expect(skipLink).toHaveFocus();
    await user.keyboard('{Enter}');
    const main = document.getElementById('main-content');
    expect(main).toHaveAttribute('tabindex', '-1');
    expect(main).toHaveFocus();
    await user.tab();
    expect(main?.contains(document.activeElement)).toBe(true);
  });
});
