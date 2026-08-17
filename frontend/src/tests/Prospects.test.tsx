import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../app/App';
import { getAssistantActions, resolveAssistantContext } from '../features/assistant/assistantContext';
import { PIPELINE_STAGES, pipelineStageForSubstatus, PROSPECT_SUBSTATUSES } from '../features/prospects/prospects.types';
import type { Prospect, ProspectCatalogs } from '../features/prospects/prospects.types';

const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const session = (permissions = ['prospectos.read', 'prospectos.write', 'documentos.read', 'documentos.write']) => ({ user: { id: 'user-1', name: 'Andrea Ruiz', role: 'ADMINISTRACION', permissions } });
const catalogs: ProspectCatalogs = {
  stages: [
    { code: 'PROSPECTO_RECIBIDO', label: 'Prospecto recibido', order: 1, active: true },
    { code: 'ANTECEDENTES_SOLICITADOS', label: 'Antecedentes solicitados', order: 2, active: true },
    { code: 'ANTECEDENTES_RECIBIDOS', label: 'Antecedentes recibidos', order: 3, active: true },
  ],
  services: [
    { code: 'COMPRAVENTA', label: 'Compraventa', order: 1, active: true, states: ['Nayarit', 'Jalisco'], personTypes: [] },
    { code: 'DONACION', label: 'Donación', order: 2, active: true, states: ['Nayarit', 'Jalisco'], personTypes: [] },
    { code: 'CESION_DERECHOS_FIDEICOMISARIOS', label: 'Cesión de derechos fideicomisarios', order: 3, active: true, states: ['Nayarit', 'Jalisco'], personTypes: [] },
    { code: 'CONSTITUCION_SERVIDUMBRE', label: 'Constitución de servidumbre', order: 8, active: true, states: ['Nayarit', 'Jalisco'], personTypes: [] },
    { code: 'CONSTITUCION_FIDEICOMISO_ADMINISTRACION', label: 'Constitución de fideicomiso de administración', order: 14, active: true, states: ['Nayarit', 'Jalisco'], personTypes: [] },
    { code: 'JUICIO_SUCESORIO_TESTAMENTARIO_PRIMERA_ETAPA', label: 'Juicio sucesorio testamentario — primera etapa', order: 19, active: true, states: [], personTypes: [] },
    { code: 'CONSTITUCION_HIPOTECA', label: 'Constitución de hipoteca', order: 30, active: true, states: ['Nayarit', 'Jalisco'], personTypes: [] },
    { code: 'PROTOCOLIZACION_DOCUMENTOS', label: 'Protocolización de documentos', order: 32, active: true, states: [], personTypes: [] },
  ],
};
const prospect = (overrides: Partial<Prospect> = {}): Prospect => ({
  id: 'prospect-1', nombre: 'CONSTRUCTORA HORIZONTE', telefono: '3111002000', email: 'contacto@horizonte.mx', tipo_acto: 'Compraventa',
  servicio_catalogo_codigo: 'COMPRAVENTA', servicio_catalogo: catalogs.services[0], etapa_operativa_codigo: 'PROSPECTO_RECIBIDO', etapa_operativa: catalogs.stages[0],
  fuente: 'Referido', ciudad: 'Tepic', tiempo_estimado: 'Este mes', prioridad: 'ALTA', estado: 'NUEVO', tiene_predial: false, tiene_antecedente: true,
  created_at: '2026-08-01T10:00:00.000Z', updated_at: '2026-08-11T10:00:00.000Z', atendido_por: { nombre: 'Andrea Ruiz' }, cotizacion: null, documentos: [],
  seguimientos: [{ id: 'follow-1', tipo: 'Llamada', contenido: 'Primer contacto', proxima_accion: 'Validar documentos', created_at: '2026-08-11T10:00:00.000Z' }], ...overrides,
});

const meta = (items: Prospect[], total = items.length, page = 1, pageSize = 25) => ({
  page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)), hasNextPage: page * pageSize < total, hasPreviousPage: page > 1,
  countsByState: Object.fromEntries(items.map((item) => item.estado).map((state) => [state, items.filter((item) => item.estado === state).length])),
  metrics: { withQuote: items.filter((item) => item.cotizacion).length, accepted: items.filter((item) => item.estado === 'ACEPTADO').length, active: items.filter((item) => !['ACEPTADO', 'PERDIDO', 'CANCELADO', 'ARCHIVADO'].includes(item.estado)).length },
});

const mockApi = (seed: Prospect[] = [prospect()], permissions?: string[], defaultView: 'CARDS' | 'LIST' = 'CARDS', failUploads = false) => {
  let prospects = [...seed];
  let createCount = 0;
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const raw = String(input);
    const url = new URL(raw, 'http://localhost');
    if (url.pathname.endsWith('/auth/me')) return response(session(permissions));
    if (url.pathname.endsWith('/settings/preferences')) {
      const selected = init?.method === 'PATCH' ? JSON.parse(String(init.body)).default_view : defaultView;
      return response({ preferences: { default_view: selected, density: 'COMFORTABLE', timezone: 'America/Mexico_City', date_format: 'DD/MM/YYYY', theme: 'LIGHT', notifications_enabled: true, assistant_suggestions_enabled: true } });
    }
    if (url.pathname.endsWith('/prospectos/catalogos')) return response(catalogs);
    if (url.pathname.endsWith('/documentos') && init?.method === 'POST') return failUploads ? response({ error: 'Upload failed' }, 500) : response({ id: `doc-${Date.now()}`, nombre_original: 'archivo.pdf', tipo: 'PREDIAL' }, 201);
    if (/\/documentos\/[^/]+\/url$/.test(url.pathname)) return response({ url: 'https://signed.example/document' });
    if (url.pathname.endsWith('/prospectos/prospect-1/seguimientos')) return response({ id: 'follow-2', tipo: 'Nota', contenido: 'Se recibió información', proxima_accion: 'Revisar alcance', created_at: '2026-08-12T10:00:00.000Z', usuario: { nombre: 'Andrea Ruiz' } }, 201);
    if (url.pathname.endsWith('/prospectos/prospect-1/documentos')) return response([]);
    if (url.pathname.endsWith('/prospectos/prospect-1') && init?.method === 'PUT') {
      const updated = { ...prospects[0], ...JSON.parse(String(init.body)) };
      prospects[0] = updated;
      return response(updated);
    }
    if (url.pathname.endsWith('/prospectos/prospect-1')) return response(prospects[0]);
    if (url.pathname.endsWith('/prospectos') && init?.method === 'POST') {
      createCount += 1;
      const body = JSON.parse(String(init.body));
      const service = catalogs.services.find((item) => item.code === body.servicio_catalogo_codigo);
      const created = prospect({ id: `created-${createCount}`, ...body, tipo_acto: service?.label, servicio_catalogo: service, etapa_operativa: catalogs.stages[0], etapa_operativa_codigo: catalogs.stages[0].code });
      prospects = [created, ...prospects];
      return response(created, 201);
    }
    if (url.pathname.endsWith('/prospectos')) {
      let filtered = [...prospects];
      const states = url.searchParams.get('estado')?.split(',').filter(Boolean);
      if (states?.length) filtered = filtered.filter((item) => states.includes(item.estado));
      const stage = url.searchParams.get('etapa');
      if (stage) filtered = filtered.filter((item) => item.etapa_operativa_codigo === stage);
      const serviceCode = url.searchParams.get('servicio');
      if (serviceCode) filtered = filtered.filter((item) => item.servicio_catalogo_codigo === serviceCode || item.tipo_acto === catalogs.services.find((service) => service.code === serviceCode)?.label);
      const priority = url.searchParams.get('prioridad');
      if (priority) filtered = filtered.filter((item) => item.prioridad === priority);
      const search = url.searchParams.get('busqueda')?.toLocaleLowerCase('es-MX');
      if (search) filtered = filtered.filter((item) => [item.nombre, item.telefono, item.email, item.tipo_acto].some((value) => value?.toLocaleLowerCase('es-MX').includes(search)));
      const page = Number(url.searchParams.get('page') ?? 1);
      const pageSize = Number(url.searchParams.get('pageSize') ?? 25);
      const data = filtered.slice((page - 1) * pageSize, page * pageSize);
      return response({ data, meta: meta(filtered, filtered.length, page, pageSize), facets: { services: [], sources: [] } });
    }
    return response({}, 204);
  });
  vi.stubGlobal('fetch', fetchMock);
  return { fetchMock, getCreateCount: () => createCount };
};

describe('Prospectos', () => {
  beforeEach(() => { vi.restoreAllMocks(); });

  it('mantiene KPIs y muestra las cuatro columnas comerciales aprobadas', async () => {
    expect(PIPELINE_STAGES.map((stage) => stage.label)).toEqual(['Nuevo', 'En proceso', 'Cotización', 'Convertido']);
    expect(pipelineStageForSubstatus('INFO_PENDIENTE')).toBe('new');
    expect(pipelineStageForSubstatus('EN_REVISION')).toBe('progress');
    expect(pipelineStageForSubstatus('COTIZACION_ENVIADA')).toBe('quote');
    expect(pipelineStageForSubstatus('ACEPTADO')).toBe('converted');
    const mappedSubstatuses = PIPELINE_STAGES.flatMap((stage) => stage.substatuses);
    expect(new Set(mappedSubstatuses).size).toBe(mappedSubstatuses.length);
    expect(mappedSubstatuses).toEqual(expect.arrayContaining(PROSPECT_SUBSTATUSES.filter((substatus) => substatus !== 'ARCHIVADO')));
    mockApi([prospect(), prospect({ id: 'accepted', nombre: 'GRUPO ACEPTADO', estado: 'ACEPTADO', cotizacion: { id: 'quote-1', estado: 'ACEPTADA' } })]);
    render(<MemoryRouter initialEntries={['/prospectos']}><App /></MemoryRouter>);
    expect(await screen.findByRole('heading', { name: 'Prospectos' })).toBeInTheDocument();
    await screen.findAllByText('CONSTRUCTORA HORIZONTE');
    for (const label of ['Nuevo', 'En proceso', 'Cotización', 'Convertido']) expect(screen.getAllByRole('heading', { name: new RegExp(label, 'i'), hidden: true }).length).toBeGreaterThan(0);
    expect(screen.queryByRole('heading', { name: /Seguimiento/i, hidden: true })).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: /Cierre/i, hidden: true })).not.toBeInTheDocument();
    expect(screen.getByText('Total prospectos')).toBeInTheDocument();
  });

  it('alterna Tarjetas y Lista, elimina Origen y mantiene acciones accesibles', async () => {
    mockApi(); const user = userEvent.setup();
    render(<MemoryRouter initialEntries={['/prospectos']}><App /></MemoryRouter>);
    await screen.findAllByText('CONSTRUCTORA HORIZONTE');
    await user.click(screen.getByRole('button', { name: 'Lista' }));
    expect(screen.getByRole('columnheader', { name: 'Prospecto' }).className).toContain('stickyProspect');
    expect(screen.queryByRole('columnheader', { name: 'Origen' })).not.toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Responsable' })).toBeInTheDocument();
    const openButton = screen.getByRole('button', { name: 'Abrir prospecto CONSTRUCTORA HORIZONTE' });
    expect(openButton.parentElement?.className).toContain('stickyActions');
    await user.click(openButton);
    expect(await screen.findByRole('heading', { name: 'CONSTRUCTORA HORIZONTE' })).toBeInTheDocument();
  });

  it('respeta Lista como preferencia existente', async () => {
    mockApi([prospect()], undefined, 'LIST');
    render(<MemoryRouter initialEntries={['/prospectos']}><App /></MemoryRouter>);
    expect(await screen.findByRole('button', { name: 'Lista' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('table')).toBeInTheDocument();
  });

  it('envía búsqueda, prioridad, etapa documental y servicio canónico al backend', async () => {
    const { fetchMock } = mockApi([prospect(), prospect({ id: 'second', nombre: 'CORPORATIVO AZUL', tipo_acto: 'Constitución de hipoteca', servicio_catalogo_codigo: 'CONSTITUCION_HIPOTECA', servicio_catalogo: catalogs.services.find((service) => service.code === 'CONSTITUCION_HIPOTECA'), prioridad: 'MEDIA', etapa_operativa_codigo: 'ANTECEDENTES_SOLICITADOS', etapa_operativa: catalogs.stages[1] })]);
    const user = userEvent.setup();
    render(<MemoryRouter initialEntries={['/prospectos']}><App /></MemoryRouter>);
    await screen.findAllByText('CONSTRUCTORA HORIZONTE');
    await user.type(screen.getByLabelText('Buscar prospecto'), 'Horizonte');
    await waitFor(() => expect(fetchMock.mock.calls.some(([url]) => String(url).includes('busqueda='))).toBe(true));
    await user.selectOptions(screen.getByLabelText('Prioridad'), 'ALTA');
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining('prioridad=ALTA'), expect.anything()));
    const serviceInput = screen.getByRole('combobox', { name: 'Servicio' });
    await user.click(serviceInput); await user.type(serviceInput, 'hipoteca');
    await user.click(screen.getByRole('option', { name: 'Constitución de hipoteca' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining('servicio=CONSTITUCION_HIPOTECA'), expect.anything()));
    const stageInput = screen.getByRole('combobox', { name: 'Etapa' });
    await user.click(stageInput); await user.type(stageInput, 'solicitados');
    await user.click(screen.getByRole('option', { name: 'Antecedentes solicitados' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining('etapa=ANTECEDENTES_SOLICITADOS'), expect.anything()));
  });

  it('limita cada lane a 10 y carga el siguiente bloque sin duplicados', async () => {
    mockApi(Array.from({ length: 15 }, (_, index) => prospect({ id: `new-${index + 1}`, nombre: `PROSPECTO ${String(index + 1).padStart(2, '0')}` })));
    const user = userEvent.setup();
    render(<MemoryRouter initialEntries={['/prospectos']}><App /></MemoryRouter>);
    const moreButtons = await screen.findAllByRole('button', { name: 'Ver 5 más', hidden: true });
    expect(screen.queryByText('PROSPECTO 15')).not.toBeInTheDocument();
    await user.click(moreButtons[0]);
    expect((await screen.findAllByText('PROSPECTO 15')).length).toBeGreaterThan(0);
    expect(screen.queryAllByRole('button', { name: 'Abrir prospecto PROSPECTO 15', hidden: true }).length).toBeLessThanOrEqual(2);
  });

  it('nuevo prospecto usa campos definitivos, catálogo y uppercase real', async () => {
    const { fetchMock } = mockApi([]); const user = userEvent.setup();
    render(<MemoryRouter initialEntries={['/prospectos']}><App /></MemoryRouter>);
    await screen.findByText('Aún no hay prospectos.');
    await user.click(screen.getByRole('button', { name: 'Nuevo prospecto' }));
    expect(screen.queryByLabelText('Origen')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Ciudad')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Tiempo estimado')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Necesidad inicial')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Observaciones')).toBeInTheDocument();
    expect(screen.getByLabelText('Cuenta con predial')).toBeInTheDocument();
    expect(screen.getByLabelText('Cuenta con antecedente')).toBeInTheDocument();
    await user.type(screen.getByLabelText(/Nombre o razón social/), 'Francisco Javier Tapia López');
    const serviceInput = screen.getByRole('combobox', { name: /Servicio \/ acto de interés/ });
    await user.click(serviceInput); await user.type(serviceInput, 'compra'); await user.click(screen.getByRole('option', { name: 'Compraventa' }));
    await user.click(screen.getByLabelText('Cuenta con predial'));
    await user.click(screen.getByRole('button', { name: 'Crear prospecto' }));
    await waitFor(() => {
      const createCall = fetchMock.mock.calls.find(([url, init]) => String(url).endsWith('/prospectos') && init?.method === 'POST');
      expect(JSON.parse(String(createCall?.[1]?.body))).toMatchObject({ nombre: 'FRANCISCO JAVIER TAPIA LÓPEZ', servicio_catalogo_codigo: 'COMPRAVENTA', tiene_predial: true });
    });
  });

  it('crea una sola vez y reporta upload parcial sin borrar el prospecto', async () => {
    const { getCreateCount } = mockApi([], undefined, 'CARDS', true); const user = userEvent.setup();
    render(<MemoryRouter initialEntries={['/prospectos']}><App /></MemoryRouter>);
    await screen.findByText('Aún no hay prospectos.'); await user.click(screen.getByRole('button', { name: 'Nuevo prospecto' }));
    await user.type(screen.getByLabelText(/Nombre o razón social/), 'josé ñuñez');
    const serviceInput = screen.getByRole('combobox', { name: /Servicio \/ acto de interés/ }); await user.click(serviceInput); await user.type(serviceInput, 'don'); await user.click(screen.getByRole('option', { name: 'Donación' }));
    await user.upload(screen.getByLabelText('Adjuntar predial'), new File(['predial'], 'predial.pdf', { type: 'application/pdf' }));
    await user.click(screen.getByRole('button', { name: 'Crear prospecto' }));
    expect(await screen.findByText(/Prospecto creado\. 1 documento no pudo cargarse/)).toBeInTheDocument();
    expect(getCreateCount()).toBe(1);
  });

  it('detalle muestra modelo nuevo, oculta legacy y permite registrar seguimiento', async () => {
    mockApi([prospect({ estado: 'INFO_PENDIENTE' })]); const user = userEvent.setup();
    render(<MemoryRouter initialEntries={['/prospectos/prospect-1']}><App /></MemoryRouter>);
    expect(await screen.findByRole('heading', { name: 'CONSTRUCTORA HORIZONTE' })).toBeInTheDocument();
    expect(screen.getAllByText('Prospecto recibido').length).toBeGreaterThan(0);
    expect(screen.getByText('Subestado').nextElementSibling).toHaveTextContent('Información pendiente');
    expect(screen.queryByText('Pipeline')).not.toBeInTheDocument();
    expect(screen.getByText('Antecedente').nextElementSibling).toHaveTextContent('Sí');
    expect(screen.queryByText('Ciudad')).not.toBeInTheDocument();
    expect(screen.queryByText('Origen')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Registrar seguimiento' }));
    await user.type(screen.getByLabelText(/Nota/), 'Se recibió información');
    await user.click(screen.getByRole('button', { name: 'Guardar seguimiento' }));
    expect(await screen.findByText('Seguimiento registrado.')).toBeInTheDocument();
  });

  it('edición usa catálogo, etapa documental, uppercase y no revive campos eliminados', async () => {
    const { fetchMock } = mockApi(); const user = userEvent.setup();
    render(<MemoryRouter initialEntries={['/prospectos/prospect-1']}><App /></MemoryRouter>);
    await screen.findByRole('heading', { name: 'CONSTRUCTORA HORIZONTE' });
    await user.click(screen.getByRole('button', { name: 'Editar' }));
    expect(screen.queryByLabelText('Origen')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Ciudad')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Tiempo estimado')).not.toBeInTheDocument();
    const name = screen.getByLabelText(/Nombre o razón social/); await user.clear(name); await user.type(name, 'josé ñuñez');
    const stage = screen.getByRole('combobox', { name: /Etapa documental/ }); await user.click(stage); await user.clear(stage); await user.type(stage, 'recibidos'); await user.click(screen.getByRole('option', { name: 'Antecedentes recibidos' }));
    await user.click(screen.getByRole('button', { name: 'Guardar cambios' }));
    await waitFor(() => {
      const updateCall = fetchMock.mock.calls.find(([url, init]) => String(url).endsWith('/prospectos/prospect-1') && init?.method === 'PUT');
      expect(JSON.parse(String(updateCall?.[1]?.body))).toMatchObject({ nombre: 'JOSÉ ÑUÑEZ', etapa_operativa_codigo: 'ANTECEDENTES_RECIBIDOS' });
    });
  });

  it('permite adjuntar después del alta y refleja disponibilidad sin exigir archivo para el checkbox', async () => {
    const { fetchMock } = mockApi(); const user = userEvent.setup();
    render(<MemoryRouter initialEntries={['/prospectos/prospect-1']}><App /></MemoryRouter>);
    await screen.findByRole('heading', { name: 'CONSTRUCTORA HORIZONTE' });
    await user.upload(screen.getByLabelText('Adjuntar predial'), new File(['predial'], 'predial.pdf', { type: 'application/pdf' }));
    await user.click(screen.getByRole('button', { name: 'Subir seleccionados' }));
    expect(await screen.findByText('Documentación vinculada al prospecto.')).toBeInTheDocument();
    expect(screen.getByText('Predial', { selector: 'dt' }).nextElementSibling).toHaveTextContent('Sí');
  });

  it('preserva y visualiza servicio legacy y etapa null sin inventar datos', async () => {
    mockApi([prospect({ tipo_acto: 'General / No Especificado', servicio_catalogo_codigo: null, servicio_catalogo: null, etapa_operativa_codigo: null, etapa_operativa: null })], undefined, 'LIST');
    render(<MemoryRouter initialEntries={['/prospectos']}><App /></MemoryRouter>);
    expect(await screen.findByText('General / No Especificado')).toBeInTheDocument();
    expect(screen.getByText('Sin etapa')).toBeInTheDocument();
  });

  it('respeta usuarios de solo lectura y permisos documentales', async () => {
    mockApi([prospect()], ['prospectos.read']);
    render(<MemoryRouter initialEntries={['/prospectos']}><App /></MemoryRouter>);
    await screen.findAllByText('CONSTRUCTORA HORIZONTE');
    expect(screen.queryByRole('button', { name: 'Nuevo prospecto' })).not.toBeInTheDocument();
  });

  it('muestra estados vacío y error sin tumbar el shell', async () => {
    mockApi([]); const first = render(<MemoryRouter initialEntries={['/prospectos']}><App /></MemoryRouter>);
    expect(await screen.findByText('Aún no hay prospectos.')).toBeInTheDocument(); first.unmount();
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => String(input).endsWith('/auth/me') ? response(session()) : response({ error: 'Unavailable' }, 500)));
    render(<MemoryRouter initialEntries={['/prospectos']}><App /></MemoryRouter>);
    expect(await screen.findByText('No pudimos cargar los prospectos.')).toBeInTheDocument();
  });

  it('expone contexto y acciones IA existentes sin modificar PRAVIA IA', () => {
    const list = resolveAssistantContext({ pathname: '/prospectos', hash: '' });
    const detail = resolveAssistantContext({ pathname: '/prospectos/prospect-1', hash: '' });
    expect(list.module).toBe('prospectos');
    expect(getAssistantActions(list).map((action) => action.label)).toContain('Sin seguimiento');
    expect(detail).toMatchObject({ entityType: 'prospecto', entityId: 'prospect-1' });
  });

  it('combobox searchable filtra los actos solicitados ignorando acentos y mayúsculas', async () => {
    const { fetchMock } = mockApi(); const user = userEvent.setup();
    render(<MemoryRouter initialEntries={['/prospectos']}><App /></MemoryRouter>); await screen.findAllByText('CONSTRUCTORA HORIZONTE');
    const serviceInput = screen.getByRole('combobox', { name: 'Servicio' });
    const searches = [
      ['fideicomiso', 'Constitución de fideicomiso de administración'],
      ['HIPOTECA', 'Constitución de hipoteca'],
      ['sucesorio', 'Juicio sucesorio testamentario — primera etapa'],
      ['protocolizacion', 'Protocolización de documentos'],
      ['SERVIDUMBRE', 'Constitución de servidumbre'],
    ] as const;
    for (const [term, match] of searches) {
      await user.click(serviceInput); await user.clear(serviceInput); await user.type(serviceInput, term);
      expect(within(screen.getByRole('listbox', { name: 'Opciones de Servicio' })).getByRole('option', { name: match })).toBeInTheDocument();
    }
    await user.clear(serviceInput); await user.type(serviceInput, 'compra'); await user.keyboard('{ArrowDown}{Enter}');
    await waitFor(() => expect(fetchMock.mock.calls.some(([url]) => String(url).includes('servicio=COMPRAVENTA'))).toBe(true));
  });
});
