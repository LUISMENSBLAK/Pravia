import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../app/App';
import { getAssistantActions, resolveAssistantContext } from '../features/assistant/assistantContext';
import type { Prospect } from '../features/prospects/prospects.types';

const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const session = (permissions = ['prospectos.read', 'prospectos.write']) => ({ user: { id: 'user-1', name: 'Andrea Ruiz', role: 'ADMINISTRACION', permissions } });
const prospect = (overrides: Partial<Prospect> = {}): Prospect => ({
  id: 'prospect-1', nombre: 'Constructora Horizonte', telefono: '3111002000', email: 'contacto@horizonte.mx', tipo_acto: 'Compraventa',
  fuente: 'Referido', prioridad: 'ALTA', estado: 'NUEVO', created_at: '2026-08-01T10:00:00.000Z', updated_at: '2026-08-11T10:00:00.000Z',
  atendido_por: { nombre: 'Andrea Ruiz' }, cotizacion: null, documentos: [], seguimientos: [{ id: 'follow-1', tipo: 'Llamada', contenido: 'Primer contacto', proxima_accion: 'Validar documentos', created_at: '2026-08-11T10:00:00.000Z' }], ...overrides,
});

const mockApi = (prospects: Prospect[] = [prospect()], permissions?: string[], defaultView: 'CARDS' | 'LIST' = 'CARDS') => vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = String(input);
  if (url.endsWith('/auth/me')) return response(session(permissions));
  if (url.endsWith('/settings/preferences')) {
    const selected = init?.method === 'PATCH' ? JSON.parse(String(init.body)).default_view : defaultView;
    return response({ preferences: { default_view: selected, density: 'COMFORTABLE', timezone: 'America/Mexico_City', date_format: 'DD/MM/YYYY', theme: 'LIGHT', notifications_enabled: true, assistant_suggestions_enabled: true } });
  }
  if (url.includes('/prospectos') && init?.method === 'POST' && !url.includes('/seguimientos')) return response(prospect({ id: 'created', nombre: JSON.parse(String(init.body)).nombre }), 201);
  if (url.endsWith('/prospectos/prospect-1/seguimientos')) return response({ id: 'follow-2', tipo: 'Nota', contenido: 'Se recibió información', proxima_accion: 'Revisar alcance', created_at: '2026-08-12T10:00:00.000Z', usuario: { nombre: 'Andrea Ruiz' } }, 201);
  if (url.endsWith('/prospectos/prospect-1/documentos')) return response([]);
  if (url.endsWith('/prospectos/prospect-1')) return response(prospects[0]);
  if (url.includes('/prospectos')) return response(prospects);
  return response({}, 204);
}));

describe('Prospectos', () => {
  beforeEach(() => { vi.restoreAllMocks(); });

  it('renderiza el pipeline, KPIs y cards con datos reales del endpoint', async () => {
    mockApi([prospect(), prospect({ id: 'accepted', nombre: 'Grupo Aceptado', estado: 'ACEPTADO', cotizacion: { id: 'quote-1', estado: 'ACEPTADA' } })]);
    render(<MemoryRouter initialEntries={['/prospectos']}><App /></MemoryRouter>);
    expect(await screen.findByRole('heading', { name: 'Prospectos' })).toBeInTheDocument();
    expect((await screen.findAllByText('Constructora Horizonte')).length).toBeGreaterThan(0);
    expect(screen.getAllByText('2').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Cierre').length).toBeGreaterThan(0);
  });

  it('alterna Tarjetas y Lista con los mismos datos y abre el prospecto desde la tabla', async () => {
    mockApi();
    const user = userEvent.setup();
    render(<MemoryRouter initialEntries={['/prospectos']}><App /></MemoryRouter>);
    expect(await screen.findByRole('button', { name: 'Tarjetas' })).toHaveAttribute('aria-pressed', 'true');
    await user.click(screen.getByRole('button', { name: 'Lista' }));
    expect(screen.getByRole('button', { name: 'Lista' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('columnheader', { name: 'Prospecto' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Abrir prospecto Constructora Horizonte' }));
    expect(await screen.findByRole('heading', { name: 'Constructora Horizonte' })).toBeInTheDocument();
  });

  it('respeta Lista como vista predeterminada guardada en Preferencias', async () => {
    mockApi([prospect()], undefined, 'LIST');
    render(<MemoryRouter initialEntries={['/prospectos']}><App /></MemoryRouter>);
    expect(await screen.findByRole('button', { name: 'Lista' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('table')).toBeInTheDocument();
  });

  it('envía search y prioridad al backend y aplica filtros reales de servicio', async () => {
    mockApi([prospect(), prospect({ id: 'second', nombre: 'Corporativo Azul', tipo_acto: 'Hipoteca', prioridad: 'MEDIA' })]);
    const user = userEvent.setup();
    render(<MemoryRouter initialEntries={['/prospectos']}><App /></MemoryRouter>);
    await screen.findAllByText('Constructora Horizonte');
    await user.type(screen.getByLabelText('Buscar prospecto'), 'Horizonte');
    await waitFor(() => expect(fetch).toHaveBeenCalledWith(expect.stringContaining('busqueda=Horizonte'), expect.anything()));
    await user.selectOptions(screen.getByLabelText('Prioridad'), 'ALTA');
    await waitFor(() => expect(fetch).toHaveBeenCalledWith(expect.stringContaining('prioridad=ALTA'), expect.anything()));
    await user.selectOptions(screen.getByLabelText('Servicio'), 'Hipoteca');
    expect(screen.queryAllByText('Constructora Horizonte')).toHaveLength(0);
    expect(screen.getAllByText('Corporativo Azul').length).toBeGreaterThan(0);
  });

  it('selecciona etapa en filtros y cambia la etapa móvil', async () => {
    mockApi([prospect(), prospect({ id: 'quote', nombre: 'Cliente Cotización', estado: 'COTIZACION_ENVIADA' })]);
    const user = userEvent.setup();
    render(<MemoryRouter initialEntries={['/prospectos']}><App /></MemoryRouter>);
    await screen.findAllByText('Cliente Cotización');
    await user.selectOptions(screen.getByLabelText('Etapa'), 'quote');
    expect(screen.queryAllByText('Constructora Horizonte')).toHaveLength(0);
    const mobileTab = screen.getByRole('tab', { name: /Cotización/, hidden: true });
    await user.click(mobileTab);
    expect(mobileTab).toHaveAttribute('aria-selected', 'true');
  });

  it('valida el alta y actualiza el pipeline después de crear', async () => {
    mockApi([]); const user = userEvent.setup();
    render(<MemoryRouter initialEntries={['/prospectos']}><App /></MemoryRouter>);
    await screen.findByText('Aún no hay prospectos.');
    await user.click(screen.getByRole('button', { name: 'Nuevo prospecto' }));
    await user.click(screen.getByRole('button', { name: 'Crear prospecto' }));
    expect(screen.getByText('Escribe el nombre o razón social.')).toBeInTheDocument();
    await user.type(screen.getByLabelText(/Nombre o razón social/), 'Nueva Empresa');
    await user.click(screen.getByRole('button', { name: 'Crear prospecto' }));
    expect(await screen.findByText('Prospecto creado.')).toBeInTheDocument();
    expect(screen.getAllByText('Nueva Empresa').length).toBeGreaterThan(0);
  });

  it('abre el detalle y registra un seguimiento', async () => {
    mockApi(); const user = userEvent.setup();
    render(<MemoryRouter initialEntries={['/prospectos/prospect-1']}><App /></MemoryRouter>);
    expect(await screen.findByRole('heading', { name: 'Constructora Horizonte' })).toBeInTheDocument();
    expect(screen.getByText('Primer contacto')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Registrar seguimiento' }));
    await user.type(screen.getByLabelText(/Nota/), 'Se recibió información');
    await user.click(screen.getByRole('button', { name: 'Guardar seguimiento' }));
    expect(await screen.findByText('Seguimiento registrado.')).toBeInTheDocument();
    expect(screen.getByText('Se recibió información')).toBeInTheDocument();
  });

  it('respeta usuarios de solo lectura', async () => {
    mockApi([prospect()], ['prospectos.read']);
    render(<MemoryRouter initialEntries={['/prospectos']}><App /></MemoryRouter>);
    await screen.findAllByText('Constructora Horizonte');
    expect(screen.queryByRole('button', { name: 'Nuevo prospecto' })).not.toBeInTheDocument();
  });

  it('muestra estados vacío y error sin tumbar el shell', async () => {
    mockApi([]); const first = render(<MemoryRouter initialEntries={['/prospectos']}><App /></MemoryRouter>);
    expect(await screen.findByText('Aún no hay prospectos.')).toBeInTheDocument(); first.unmount();
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => String(input).endsWith('/auth/me') ? response(session()) : response({ error: 'Unavailable' }, 500)));
    render(<MemoryRouter initialEntries={['/prospectos']}><App /></MemoryRouter>);
    expect(await screen.findByText('No pudimos cargar los prospectos.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reintentar' })).toBeInTheDocument();
  });

  it('expone contexto y acciones IA distintas para lista y detalle', () => {
    const list = resolveAssistantContext({ pathname: '/prospectos', hash: '' });
    const detail = resolveAssistantContext({ pathname: '/prospectos/prospect-1', hash: '' });
    expect(list.module).toBe('prospectos');
    expect(getAssistantActions(list).map((action) => action.label)).toContain('Sin seguimiento');
    expect(detail).toMatchObject({ entityType: 'prospecto', entityId: 'prospect-1' });
    expect(getAssistantActions(detail).map((action) => action.label)).toContain('Preparar seguimiento');
  });
});
