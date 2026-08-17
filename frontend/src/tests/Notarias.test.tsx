import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../app/App';
import { getAssistantActions, resolveAssistantContext } from '../features/assistant/assistantContext';

const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const session = { user: { id: 'user-1', name: 'Andrea Ruiz', role: 'ADMINISTRACION', permissions: ['notarias.read', 'notarias.write', 'expedientes.read'] } };
const row = { id: 'notaria-1', numero_notaria: '12', nombre: 'Notaría Pública 12', etiqueta: 'Notaría 12', titular: 'Lic. Ana Pérez', ciudad: 'Tepic', municipio: 'Tepic', entidad_federativa: 'Nayarit', demarcacion: 'Tepic', contacto: { id: 'contact-1', nombre: 'Recepción', cargo: 'Recepción', telefono: '311 555 0000', correo: 'recepcion@notaria.mx', es_principal: true }, expedientes_activos: 4, estatus: 'ACTIVA', predeterminada: false, updated_at: '2026-08-12T18:00:00.000Z' };
const jalisco = { ...row, id: 'notaria-2', numero_notaria: '18', nombre: 'Notaría Pública 18', etiqueta: 'Notaría 18', titular: 'Lic. Jorge Ruiz', ciudad: 'Puerto Vallarta', municipio: 'Puerto Vallarta', entidad_federativa: 'Jalisco', contacto: { ...row.contacto, id: 'contact-2', nombre: 'Proyectos' } };
const legacy = { ...row, id: 'notaria-3', numero_notaria: '7', nombre: 'Notaría Pública 7', etiqueta: 'Notaría 7', titular: 'Lic. Laura Sol', ciudad: 'Hermosillo', municipio: 'Hermosillo', entidad_federativa: 'Sonora', contacto: { ...row.contacto, id: null, nombre: null, telefono: null, correo: null, es_principal: false } };
const list = { data: [row, jalisco, legacy], metrics: { total: 3, nayarit: 1, jalisco: 1 }, facets: { states: ['Nayarit', 'Jalisco'] }, meta: { total: 3, page: 1, limit: 20, pageSize: 20, totalPages: 1, hasPreviousPage: false, hasNextPage: false }, definitions: { activeCases: 'No incluye entregados', geography: 'El total conserva todas las notarías registradas' } };
const detail: any = { ...row, direccion: 'Av. México 100, Centro', codigo_postal: '63000', telefono: '311 555 0000', whatsapp: '311 999 9999', correo_general: 'contacto@notaria.mx', correo_proyectos: null, pagina_web: null, contacto_principal: 'Recepción', contacto_principal_id: 'contact-1', horario: '09:00 a 17:00', horario_semanal: { lunes: { cerrado: false, apertura: '09:00', cierre: '17:00' }, domingo: { cerrado: true } }, dias_atencion: 'Lunes a viernes', tiempo_respuesta: '2 días', tiempo_presupuesto: '3 días', tiempo_firma: null, instrucciones_especiales: null, observaciones_generales: 'Confirmar recepción de proyectos.', requisitos_frecuentes: null, dias_respuesta_estimados: 5, dias_presupuesto_estimados: 3, dias_firma_estimados: null, activa: true, color_identificador: '#D4AF37', tipos_acto_json: ['Compraventa'], instituciones_json: [], municipios_atendidos_json: ['Tepic'], created_at: '2026-06-01T10:00:00.000Z', contactos: [{ id: 'contact-1', nombre: 'Recepción', cargo: 'Recepción', telefono: '311 555 0000', whatsapp: '311 999 9999', correo: 'recepcion@notaria.mx', observaciones: null, activo: true, created_at: '2026-06-01T10:00:00.000Z' }, { id: 'contact-2', nombre: 'Proyectos', cargo: null, telefono: null, whatsapp: null, correo: 'proyectos@notaria.mx', observaciones: null, activo: true, created_at: '2026-06-02T10:00:00.000Z' }], metrics: { activeCases: 4, historicalCases: 9, quotes: 3, upcomingSignatures: 1, lastActivity: '2026-08-12T18:00:00.000Z' }, expedientes: [], proximasFirmas: [{ id: 'exp-1', numero_pravia: 'EXP-2026-0041', fecha_estimada_firma: '2026-08-20T17:00:00.000Z', cliente_alias: 'Inmobiliaria del Valle' }], responsables: [{ id: 'user-1', nombre: 'Andrea', apellido: 'Ruiz', rol: 'ABOGADO', expedientes: 4 }], actividad: [{ id: 'audit-1', accion: 'EDITAR_NOTARIA', created_at: '2026-08-12T18:00:00.000Z', usuario: { nombre: 'Andrea', apellido: 'Ruiz' } }], definitions: {} };
const caseRow = { id: 'exp-1', numero_pravia: 'EXP-2026-0041', cliente_alias: 'Inmobiliaria del Valle', estatus: 'EN_PROCESO', etapa_actual_nombre: 'Proyecto', updated_at: '2026-08-12T18:00:00.000Z', tipo_acto: { nombre: 'Compraventa' }, abogado: { id: 'user-1', nombre: 'Andrea', apellido: 'Ruiz' }, gestor: null };

const mockApi = (options: { empty?: boolean; fail?: boolean; grants?: string[]; duplicate?: boolean; updateFail?: boolean; noSchedule?: boolean; defaultView?: 'CARDS' | 'LIST' } = {}) => vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = String(input);
  const currentDetail = options.noSchedule ? { ...detail, horario: null, horario_semanal: null, dias_atencion: null } : detail;
  if (url.endsWith('/auth/me')) return response(options.grants ? { user: { ...session.user, permissions: options.grants } } : session);
  if (url.endsWith('/settings/preferences') && init?.method === 'PATCH') return response({ preferences: { default_view: 'LIST' } });
  if (url.endsWith('/settings/preferences')) return response({ preferences: { default_view: options.defaultView || 'CARDS' } });
  if (url.includes('/notarias?portfolio=true')) return options.fail ? response({ error: 'No disponible' }, 500) : response(options.empty ? { ...list, data: [], metrics: { total: 0, nayarit: 0, jalisco: 0 }, meta: { ...list.meta, total: 0 } } : list);
  if (url.endsWith('/notarias/notaria-1/expedientes?page=1&pageSize=10&sort=updated_at%3Adesc')) return response({ data: [caseRow], meta: { total: 1, page: 1, totalPages: 1, hasPreviousPage: false, hasNextPage: false } });
  if (url.endsWith('/notarias/notaria-1/contactos/contact-2/principal') && init?.method === 'PATCH') return response({ ...currentDetail, contacto_principal_id: 'contact-2' });
  if (url.endsWith('/notarias/notaria-1/contactos') && init?.method === 'POST') return response({ id: 'contact-3' }, 201);
  if (url.endsWith('/notarias/notaria-1') && init?.method === 'PUT') return options.updateFail ? response({ error: 'No pudimos guardar los cambios.' }, 500) : response(currentDetail);
  if (url.endsWith('/notarias/notaria-1')) return response(currentDetail);
  if (url.endsWith('/notarias') && init?.method === 'POST') return options.duplicate ? response({ error: 'Ya existe la Notaría No. 12 en Nayarit' }, 400) : response({ ...currentDetail, id: 'created-notaria' }, 201);
  return response({}, 204);
}));

async function showList() {
  const user = userEvent.setup();
  await screen.findByRole('button', { name: /Lista/ });
  await user.click(screen.getByRole('button', { name: /Lista/ }));
  return user;
}

async function reachReview(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: 'Nueva notaría' }));
  await user.type(screen.getByLabelText('Denominación *'), 'Notaría Pública 18');
  await user.type(screen.getByLabelText('Entidad federativa *'), 'Nayarit');
  expect(screen.getByLabelText('Demarcación o distrito')).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Siguiente' }));
  await user.type(screen.getByLabelText('Municipio *'), 'Tepic');
  await user.click(screen.getByRole('button', { name: 'Siguiente' }));
  await user.click(screen.getByRole('button', { name: 'Siguiente' }));
}

describe('Notarías', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('muestra solo Total, Nayarit y Jalisco, conservando legacy en el total', async () => {
    mockApi(); render(<MemoryRouter initialEntries={['/notarias']}><App /></MemoryRouter>);
    expect(await screen.findByText('Total de notarías')).toBeInTheDocument();
    expect(screen.getByText('Todas las notarías registradas')).toBeInTheDocument();
    expect(screen.queryByText(/legacy/i)).not.toBeInTheDocument();
    expect(screen.getByText('Notarías Nayarit')).toBeInTheDocument();
    expect(screen.getByText('Notarías Jalisco')).toBeInTheDocument();
    expect(screen.queryByText('Distribución por estado')).not.toBeInTheDocument();
    expect(await screen.findByRole('link', { name: 'Abrir Notaría 7' })).toHaveTextContent('Sonora');
  });

  it('alterna Tarjetas y Lista usando los mismos resultados', async () => {
    mockApi(); render(<MemoryRouter initialEntries={['/notarias']}><App /></MemoryRouter>);
    expect(await screen.findByRole('link', { name: 'Abrir Notaría 12' })).toBeInTheDocument();
    await showList();
    expect(await screen.findByRole('table')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Notaría 12' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Lista/ })).toHaveAttribute('aria-pressed', 'true');
  });

  it('envía solo búsqueda y Estado al servidor y permite limpiar', async () => {
    mockApi(); const user = userEvent.setup(); render(<MemoryRouter initialEntries={['/notarias']}><App /></MemoryRouter>);
    await screen.findByRole('link', { name: 'Abrir Notaría 12' });
    await user.type(screen.getByPlaceholderText('Buscar por número, titular, correo o teléfono...'), 'Ana');
    await waitFor(() => expect(fetch).toHaveBeenCalledWith(expect.stringContaining('search=Ana'), expect.anything()));
    await user.selectOptions(screen.getByLabelText('Estado'), 'Nayarit');
    await waitFor(() => expect(fetch).toHaveBeenCalledWith(expect.stringContaining('estado=Nayarit'), expect.anything()));
    expect(screen.queryByLabelText(/Ciudad|Estatus|Ordenar/)).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Limpiar' }));
    expect(screen.getByPlaceholderText('Buscar por número, titular, correo o teléfono...')).toHaveValue('');
  });

  it('respeta permisos de solo lectura', async () => {
    mockApi({ grants: ['notarias.read'] }); render(<MemoryRouter initialEntries={['/notarias']}><App /></MemoryRouter>);
    await screen.findByRole('link', { name: 'Abrir Notaría 12' });
    expect(screen.queryByRole('button', { name: 'Nueva notaría' })).not.toBeInTheDocument();
  });

  it('conserva el asistente de alta con demarcación y sin WhatsApp', async () => {
    mockApi(); const user = userEvent.setup(); render(<MemoryRouter initialEntries={['/notarias']}><App /></MemoryRouter>);
    await screen.findByRole('link', { name: 'Abrir Notaría 12' }); await reachReview(user);
    expect(screen.queryByLabelText(/WhatsApp/i)).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Guardar notaría' }));
    await waitFor(() => expect(vi.mocked(fetch).mock.calls.some(([url, init]) => String(url).endsWith('/notarias') && init?.method === 'POST')).toBe(true));
  });

  it('muestra conflicto de duplicidad sin detalles técnicos', async () => {
    mockApi({ duplicate: true }); const user = userEvent.setup(); render(<MemoryRouter initialEntries={['/notarias']}><App /></MemoryRouter>);
    await screen.findByRole('link', { name: 'Abrir Notaría 12' }); await reachReview(user);
    await user.click(screen.getByRole('button', { name: 'Guardar notaría' }));
    expect(await screen.findByText(/Ya existe la Notaría/)).toBeInTheDocument();
  });

  it('abre una ficha sin demarcación ni WhatsApp y mantiene tabs accesibles', async () => {
    mockApi(); const user = userEvent.setup(); render(<MemoryRouter initialEntries={['/notarias/notaria-1']}><App /></MemoryRouter>);
    expect(await screen.findByRole('heading', { name: 'Notaría 12' })).toBeInTheDocument();
    expect(screen.getByText('Lunes: 09:00–17:00')).toBeInTheDocument();
    expect(screen.queryByText('Demarcación')).not.toBeInTheDocument();
    expect(screen.queryByText('311 999 9999')).not.toBeInTheDocument();
    const summaryTab = screen.getByRole('tab', { name: 'Resumen' }); summaryTab.focus(); await user.keyboard('{ArrowRight}');
    expect(await screen.findByRole('tab', { name: 'Contactos', selected: true })).toBeInTheDocument();
    await user.click(screen.getByRole('tab', { name: 'Expedientes' })); expect(await screen.findByText('EXP-2026-0041')).toBeInTheDocument();
    await user.click(screen.getByRole('tab', { name: 'Actividad' })); expect(await screen.findByText('Información actualizada')).toBeInTheDocument();
  });

  it('edita la ficha y horario en la misma pantalla sin drawer', async () => {
    mockApi(); const user = userEvent.setup(); render(<MemoryRouter initialEntries={['/notarias/notaria-1']}><App /></MemoryRouter>);
    await screen.findByRole('heading', { name: 'Notaría 12' }); await user.click(screen.getAllByRole('button', { name: /Editar/ })[0]);
    expect(screen.getByRole('heading', { name: 'Editar ficha' })).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    await user.clear(screen.getByLabelText('Titular')); await user.type(screen.getByLabelText('Titular'), 'Lic. María Sol');
    await user.click(screen.getByRole('button', { name: 'Guardar cambios' }));
    await waitFor(() => expect(vi.mocked(fetch).mock.calls.some(([url, init]) => String(url).endsWith('/notarias/notaria-1') && init?.method === 'PUT' && String(init.body).includes('María Sol'))).toBe(true));
  });

  it('mantiene el formulario cuando la edición falla', async () => {
    mockApi({ updateFail: true }); const user = userEvent.setup(); render(<MemoryRouter initialEntries={['/notarias/notaria-1']}><App /></MemoryRouter>);
    await screen.findByRole('heading', { name: 'Notaría 12' }); await user.click(screen.getAllByRole('button', { name: /Editar/ })[0]);
    await user.click(screen.getByRole('button', { name: 'Guardar cambios' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('No pudimos guardar');
    expect(screen.getByRole('heading', { name: 'Editar ficha' })).toBeInTheDocument();
  });

  it('carga una notaría legacy sin horario y permite configurar o cancelar sin inventar datos', async () => {
    mockApi({ noSchedule: true }); const user = userEvent.setup(); render(<MemoryRouter initialEntries={['/notarias/notaria-1']}><App /></MemoryRouter>);
    await screen.findByText('Sin horario registrado'); await user.click(screen.getAllByRole('button', { name: /Editar/ })[0]);
    expect(screen.getByText('No existe un horario estructurado.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Configurar horario semanal' }));
    await user.click(screen.getByRole('checkbox', { name: 'Lunes' }));
    expect(screen.getByLabelText('Apertura Lunes')).toHaveValue('09:00');
    await user.click(screen.getByRole('button', { name: 'Cancelar' }));
    expect(await screen.findByText('Sin horario registrado')).toBeInTheDocument();
    expect(vi.mocked(fetch).mock.calls.some(([, init]) => init?.method === 'PUT')).toBe(false);
  });

  it('edita tiempos operativos en días y valida rangos', async () => {
    mockApi(); const user = userEvent.setup(); render(<MemoryRouter initialEntries={['/notarias/notaria-1#configuracion']}><App /></MemoryRouter>);
    await screen.findByRole('heading', { name: 'Configuración operativa' });
    await user.click(screen.getByRole('button', { name: /Editar configuración/ }));
    await user.clear(screen.getByLabelText('Tiempo de respuesta (días) *')); await user.type(screen.getByLabelText('Tiempo de respuesta (días) *'), '0');
    await user.click(screen.getByRole('button', { name: 'Guardar' })); expect(await screen.findByRole('alert')).toHaveTextContent('entre 1 y 365');
    await user.clear(screen.getByLabelText('Tiempo de respuesta (días) *')); await user.type(screen.getByLabelText('Tiempo de respuesta (días) *'), '7');
    await user.type(screen.getByLabelText('Tiempo de firma (días)'), '10'); await user.click(screen.getByRole('button', { name: 'Guardar' }));
    await waitFor(() => expect(vi.mocked(fetch).mock.calls.some(([, init]) => init?.method === 'PUT' && String(init.body).includes('"dias_firma_estimados":10'))).toBe(true));
  });

  it('agrega contacto opcionalmente principal y permite cambiar el principal', async () => {
    mockApi(); const user = userEvent.setup(); render(<MemoryRouter initialEntries={['/notarias/notaria-1#contactos']}><App /></MemoryRouter>);
    await screen.findByRole('heading', { name: 'Contactos operativos' });
    expect(screen.queryByText('311 999 9999')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Agregar contacto/ }));
    const dialog = screen.getByRole('dialog', { name: 'Agregar contacto' });
    await user.type(within(dialog).getByLabelText('Nombre *'), 'Archivo');
    await user.click(within(dialog).getByRole('checkbox', { name: /Contacto principal/ }));
    await user.click(within(dialog).getByRole('button', { name: 'Agregar contacto' }));
    await waitFor(() => expect(vi.mocked(fetch).mock.calls.some(([url, init]) => String(url).endsWith('/contactos') && init?.method === 'POST' && String(init.body).includes('"principal":true'))).toBe(true));
    await user.click(screen.getByRole('button', { name: 'Marcar como principal' }));
    await waitFor(() => expect(vi.mocked(fetch).mock.calls.some(([url, init]) => String(url).includes('/contactos/contact-2/principal') && init?.method === 'PATCH')).toBe(true));
  });

  it('muestra estados vacío y error humanos', async () => {
    mockApi({ empty: true }); const first = render(<MemoryRouter initialEntries={['/notarias']}><App /></MemoryRouter>);
    expect(await screen.findByText('No hay notarías registradas.')).toBeInTheDocument(); first.unmount();
    mockApi({ fail: true }); render(<MemoryRouter initialEntries={['/notarias']}><App /></MemoryRouter>);
    expect(await screen.findByText('No pudimos cargar las notarías.')).toBeInTheDocument();
  });

  it('expone contexto IA distinto para lista y entidad real', () => {
    const listContext = resolveAssistantContext({ pathname: '/notarias', hash: '' }); const detailContext = resolveAssistantContext({ pathname: '/notarias/notaria-1', hash: '#contactos' });
    expect(getAssistantActions(listContext).map((action) => action.label)).toContain('Buscar notaría');
    expect(detailContext).toMatchObject({ module: 'notarias', entityType: 'notaria', entityId: 'notaria-1', subview: 'contactos' });
    expect(getAssistantActions(detailContext).map((action) => action.label)).toContain('Próximas firmas');
  });
});
