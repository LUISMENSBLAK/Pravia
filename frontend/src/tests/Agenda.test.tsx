import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../app/App';
import { getAssistantActions, resolveAssistantContext } from '../features/assistant/assistantContext';
import { eventStatusLabel, formatPeriod } from '../features/agenda/agenda.utils';

const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const session = { user: { id: 'user-1', name: 'Andrea Ruiz', role: 'ADMINISTRACION', permissions: ['agenda.read', 'agenda.write'] } };
const notaria = { id: 'notaria-1', numero_notaria: '12', nombre: 'Notaría 12', ciudad: 'Tepic', municipio: 'Tepic', entidad_federativa: 'Nayarit' };
const expediente = { id: 'exp-1', numero_pravia: 'EXP-2026-0041', cliente_alias: 'Inmobiliaria del Valle', estatus: 'FIRMA', version: 2, abogado_id: 'user-1', fecha_estimada_firma: '2026-08-20T17:00:00.000Z', fecha_real_firma: null, tipo_acto: { id: 'acto-1', nombre: 'Compraventa' }, notaria };
const event = {
  id: 'event-1', titulo: 'Firma de escritura', descripcion: 'Llevar identificación oficial', tipo: 'FIRMA', estatus: 'ACTIVO',
  fecha_inicio: '2026-08-20T17:00:00.000Z', fecha_fin: '2026-08-20T18:00:00.000Z', todo_el_dia: false,
  user_id: 'user-1', expediente_id: 'exp-1', compareciente_id: 'party-1', recordatorios: [15], cancelado_at: null,
  motivo_cancelacion: null, created_at: '2026-08-10T15:00:00.000Z', updated_at: '2026-08-10T15:00:00.000Z',
  usuario: { id: 'user-1', nombre: 'Andrea', apellido: 'Ruiz', rol: 'ABOGADO' }, responsable_nombre: 'Andrea Ruiz',
  expediente, compareciente_nombre: 'Ana Pérez', notaria, color: '#4d97d3',
  firma: { programada: '2026-08-20T17:00:00.000Z', estimada_expediente: '2026-08-20T17:00:00.000Z', efectiva: null },
};
const mariaEvent = { ...event, id: 'event-2', titulo: 'Revisión de proyecto', tipo: 'AUDIENCIA', user_id: 'user-2', expediente_id: null, expediente: null, notaria: null, firma: null, compareciente_nombre: null, usuario: { id: 'user-2', nombre: 'María', apellido: 'López', rol: 'ABOGADO' }, responsable_nombre: 'María López', fecha_inicio: '2026-08-21T16:00:00.000Z', fecha_fin: '2026-08-21T17:00:00.000Z' };
const catalogs = {
  usuarios: [{ id: 'user-1', nombre: 'Andrea', apellido: 'Ruiz', rol: 'ABOGADO' }, { id: 'user-2', nombre: 'María', apellido: 'López', rol: 'ABOGADO' }],
  expedientes: [expediente], comparecientes: [{ id: 'party-1', tipo_persona: 'FISICA', nombre: 'Ana Pérez' }],
  tipos: ['PERSONAL', 'DESPACHO', 'FIRMA', 'AUDIENCIA', 'VENCIMIENTO', 'CITA', 'NOTARIA', 'SEGUIMIENTO', 'OTRO'].map((tipo) => ({ tipo, color: '#aaa' })),
  timezone: 'America/Mexico_City', permisos: { gestionar_equipo: true, escribir: true },
};
const task = { id: 'task-1', titulo: 'Subir constancia fiscal', descripcion: null, prioridad: 'ALTA', estatus: 'PENDIENTE', fecha_limite: '2026-08-21T18:00:00.000Z', asignado_a: catalogs.usuarios[0], expediente };

function mockApi(options: { empty?: boolean; fail?: boolean; readOnly?: boolean; conflict?: boolean } = {}) {
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.endsWith('/auth/me')) return response(session);
    if (url.endsWith('/agenda/catalogos')) return options.fail ? response({ error: 'unavailable' }, 500) : response({ success: true, catalogos: { ...catalogs, permisos: { ...catalogs.permisos, escribir: !options.readOnly } } });
    if (url.includes('/agenda/tareas')) return response({ success: true, tareas: options.empty ? [] : [task], meta: { total: options.empty ? 0 : 1 } });
    if (/\/agenda\?.*desde=/.test(url)) return response({ success: true, eventos: options.empty ? [] : [event, mariaEvent], meta: { total: options.empty ? 0 : 2, desde: '2026-08-17T00:00:00.000Z', hasta: '2026-08-24T00:00:00.000Z', timezone: catalogs.timezone } });
    if (url.includes('/agenda/conflictos')) return response({ success: true, conflictos: options.conflict ? [mariaEvent] : [], meta: { total: options.conflict ? 1 : 0, blocking: false, timezone: catalogs.timezone } });
    if (url.endsWith('/agenda/event-1') && (!init?.method || init.method === 'GET')) return response({ success: true, evento: event, meta: { timezone: catalogs.timezone } });
    if (url.endsWith('/agenda/event-1/cancelar') && init?.method === 'POST') return response({ success: true, evento: { ...event, estatus: 'CANCELADO' } });
    if (url.endsWith('/agenda/event-1') && init?.method === 'PATCH') return response({ success: true, evento: event, conflictos: [] });
    if (url.endsWith('/agenda') && init?.method === 'POST') return response({ success: true, evento: { ...event, id: 'event-created' }, conflictos: [] }, 201);
    return response({});
  }));
}

const renderAgenda = (path = '/agenda?date=2026-08-20') => render(<MemoryRouter initialEntries={[path]}><App /></MemoryRouter>);

describe('Agenda', () => {
  beforeEach(() => { vi.restoreAllMocks(); vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }))); });

  it('formatea periodos y estados con lenguaje natural en español', () => {
    expect(formatPeriod(new Date(2026, 7, 12), 'week')).toBe('10–16 de agosto de 2026');
    expect(eventStatusLabel('ACTIVO')).toBe('Activo');
    expect(eventStatusLabel('COMPLETADO')).toBe('Realizado');
    expect(eventStatusLabel('CANCELADO')).toBe('Cancelado');
  });

  it('renderiza semana, duración, equipo, próximos eventos y tareas por separado', async () => {
    mockApi(); renderAgenda();
    expect(await screen.findByRole('heading', { name: 'Agenda' })).toBeInTheDocument();
    expect(await screen.findByRole('region', { name: 'Calendario semanal' })).toBeInTheDocument();
    expect(screen.getAllByText('Firma de escritura').length).toBeGreaterThan(0);
    expect(screen.getByRole('button', {
      name: /Firma de escritura\. Abrir para ver el texto completo\./,
    })).toHaveAttribute('title', 'Firma de escritura');
    expect(screen.getByText('Subir constancia fiscal')).toBeInTheDocument();
    expect(screen.getByText(/America\/Mexico_City/)).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Próximos eventos' })).toBeInTheDocument();
  });

  it('navega periodos, vuelve a hoy y cambia entre día, mes y lista', async () => {
    mockApi(); const user = userEvent.setup(); renderAgenda(); await screen.findByLabelText('Calendario semanal');
    await user.click(screen.getByRole('button', { name: 'Periodo siguiente' }));
    await waitFor(() => expect(vi.mocked(fetch).mock.calls.some(([url]) => String(url).includes('desde=2026-08-24'))).toBe(true));
    await user.click(screen.getByRole('tab', { name: 'Día' })); expect(screen.getByLabelText('Agenda del día')).toBeInTheDocument();
    await user.click(screen.getByRole('tab', { name: 'Mes' })); expect(screen.getByLabelText('Vista mensual')).toBeInTheDocument();
    await user.click(screen.getByRole('tab', { name: 'Lista' })); expect(screen.getByLabelText('Lista cronológica de eventos')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Hoy' })); expect(localStorage.getItem('pravia-agenda-view')).toBe('list');
  });

  it('filtra por miembros reales dentro del scope', async () => {
    mockApi(); const user = userEvent.setup(); renderAgenda(); await screen.findByText('Subir constancia fiscal');
    await user.click(screen.getByRole('checkbox', { name: /María López/ }));
    expect(screen.queryByText('Subir constancia fiscal')).not.toBeInTheDocument();
    expect(screen.getAllByText('Revisión de proyecto').length).toBeGreaterThan(0);
  });

  it('respeta el permiso de solo lectura entregado por backend', async () => {
    mockApi({ readOnly: true }); renderAgenda(); await screen.findByLabelText('Calendario semanal');
    expect(screen.queryByRole('button', { name: 'Nueva cita' })).not.toBeInTheDocument();
  });

  it('valida el alta y exige expediente para una firma programada', async () => {
    mockApi(); const user = userEvent.setup(); renderAgenda(); await screen.findByLabelText('Calendario semanal');
    await user.click(screen.getByRole('button', { name: 'Nueva cita' }));
    const dialog = screen.getByRole('dialog', { name: 'Programar evento' });
    await user.click(within(dialog).getByRole('button', { name: 'Siguiente' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(/título/);
    await user.selectOptions(within(dialog).getByLabelText('Tipo de evento *'), 'FIRMA');
    await user.type(within(dialog).getByLabelText('Título *'), 'Firma programada');
    await user.click(within(dialog).getByRole('button', { name: 'Siguiente' }));
    await user.click(within(dialog).getByRole('button', { name: 'Siguiente' }));
    await user.click(within(dialog).getByRole('button', { name: 'Guardar evento' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(/requiere un expediente/);
  });

  it('crea evento relacionado con expediente y conserva la firma como programada', async () => {
    mockApi(); const user = userEvent.setup(); renderAgenda(); await screen.findByLabelText('Calendario semanal');
    await user.click(screen.getByRole('button', { name: 'Nueva cita' })); const dialog = screen.getByRole('dialog');
    await user.selectOptions(within(dialog).getByLabelText('Tipo de evento *'), 'FIRMA'); await user.type(within(dialog).getByLabelText('Título *'), 'Firma programada');
    await user.click(within(dialog).getByRole('button', { name: 'Siguiente' })); await user.selectOptions(within(dialog).getByLabelText(/Expediente/), 'exp-1');
    expect(within(dialog).getByText((_, element) => element?.tagName === 'SPAN' && element.textContent?.startsWith('Notaría 12 ·') === true)).toBeInTheDocument(); await user.click(within(dialog).getByRole('button', { name: 'Siguiente' }));
    await user.click(within(dialog).getByRole('button', { name: 'Guardar evento' }));
    await waitFor(() => expect(vi.mocked(fetch).mock.calls.some(([url, init]) => String(url).endsWith('/agenda') && init?.method === 'POST' && String(init.body).includes('"expediente_id":"exp-1"'))).toBe(true));
  });

  it('advierte conflictos sin bloquear el guardado permitido', async () => {
    mockApi({ conflict: true }); const user = userEvent.setup(); renderAgenda(); await screen.findByLabelText('Calendario semanal');
    await user.click(screen.getByRole('button', { name: 'Nueva cita' })); const dialog = screen.getByRole('dialog');
    await user.type(within(dialog).getByLabelText('Título *'), 'Reunión de preparación'); await user.click(within(dialog).getByRole('button', { name: 'Siguiente' })); await user.click(within(dialog).getByRole('button', { name: 'Siguiente' })); await user.click(within(dialog).getByRole('button', { name: 'Guardar evento' }));
    expect(await within(dialog).findByText(/Este horario tiene 1 conflicto/)).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Guardar de todos modos' })).toBeInTheDocument();
  });

  it('abre detalle real, diferencia fecha programada/efectiva y permite editar o cancelar', async () => {
    mockApi(); const user = userEvent.setup(); renderAgenda('/agenda?date=2026-08-20#evento=event-1');
    expect(await screen.findByRole('heading', { name: 'Firma de escritura' })).toBeInTheDocument();
    expect(screen.getByText('Firma · Activo')).toBeInTheDocument();
    expect(screen.getByText('Firma programada vs. efectiva')).toBeInTheDocument(); expect(screen.getByText('Aún no registrada')).toBeInTheDocument();
    expect(screen.getByText('Notaría 12')).toBeInTheDocument(); expect(screen.getByRole('button', { name: 'Reprogramar' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Cancelar evento' })); await user.type(screen.getByLabelText('Motivo de cancelación'), 'Cambio solicitado por cliente'); await user.click(screen.getByRole('button', { name: 'Confirmar cancelación' }));
    await waitFor(() => expect(vi.mocked(fetch).mock.calls.some(([url, init]) => String(url).endsWith('/cancelar') && init?.method === 'POST')).toBe(true));
  });

  it('muestra estado vacío y error humano con recuperación', async () => {
    mockApi({ empty: true }); const first = renderAgenda(); await screen.findByLabelText('Calendario semanal'); const user = userEvent.setup(); await user.click(screen.getByRole('tab', { name: 'Día' })); expect(screen.getByText('No hay eventos programados.')).toBeInTheDocument(); first.unmount();
    mockApi({ fail: true }); renderAgenda(); expect(await screen.findByText('No pudimos cargar la agenda.')).toBeInTheDocument(); expect(screen.getByRole('button', { name: 'Reintentar' })).toBeInTheDocument();
  });

  it('usa Día como preferencia inicial mobile y expone contexto IA por evento real', async () => {
    vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() }))); mockApi(); renderAgenda(); expect(await screen.findByLabelText('Agenda del día')).toBeInTheDocument();
    const list = resolveAssistantContext({ pathname: '/agenda', hash: '' }); const detail = resolveAssistantContext({ pathname: '/agenda', hash: '#evento=event-1' });
    expect(getAssistantActions(list).map((item) => item.label)).toEqual(['¿Qué tengo hoy?', 'Próximas firmas', 'Buscar espacio', 'Eventos esta semana']);
    expect(detail).toMatchObject({ module: 'agenda', entityType: 'evento', entityId: 'event-1' });
    expect(getAssistantActions(detail).map((item) => item.label)).toContain('¿Qué falta antes de esta firma?');
  });
});
