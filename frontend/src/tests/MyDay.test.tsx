import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import userEvent from '@testing-library/user-event';
import { App } from '../app/App';
import { normalizeMyDay } from '../features/my-day/myDay.service';

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
      if (url.endsWith('/dashboard/mi-dia')) return response({ data: baseDashboard });
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
      if (url.endsWith('/dashboard/mi-dia')) return response({ data: { ...baseDashboard, errors: { agenda: 'Agenda unavailable' } } });
      return response({}, 204);
    }));
    render(<MemoryRouter initialEntries={['/mi-dia']}><App /></MemoryRouter>);
    expect(await screen.findByText('No pudimos cargar tus eventos.')).toBeInTheDocument();
    expect(screen.getByText('Sin firmas pendientes.')).toBeInTheDocument();
    expect(screen.getByText('Todo bajo control por ahora.')).toBeInTheDocument();
  });

  it('muestra skeletons por widget mientras el dashboard está cargando', async () => {
    vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/auth/me')) return Promise.resolve(response(session));
      if (url.endsWith('/dashboard/mi-dia')) return new Promise<Response>(() => undefined);
      return Promise.resolve(response({}, 204));
    }));
    render(<MemoryRouter initialEntries={['/mi-dia']}><App /></MemoryRouter>);
    expect((await screen.findAllByRole('status', { name: 'Cargando información' })).length).toBeGreaterThan(3);
  });

  it('abre la misma experiencia global de PRAVIA IA desde la card de Mi Día', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/auth/me')) return response(session);
      if (url.endsWith('/dashboard/mi-dia')) return response({ data: baseDashboard });
      return response({}, 204);
    }));
    const user = userEvent.setup();
    render(<MemoryRouter initialEntries={['/mi-dia']}><App /></MemoryRouter>);
    await screen.findByRole('heading', { name: /Usuario/ });
    await user.click(screen.getByRole('button', { name: 'Abrir PRAVIA IA para hacer una pregunta' }));
    expect(screen.getByRole('dialog', { name: 'PRAVIA IA' })).toBeInTheDocument();
  });
});
