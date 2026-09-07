import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../app/App';
import { getAssistantActions, resolveAssistantContext } from '../features/assistant/assistantContext';
import { isActiveProspect, isConvertedProspect, PIPELINE_STAGES, pipelineStageForProspect, pipelineStageForSubstatus, PROSPECT_SUBSTATUSES } from '../features/prospects/prospects.types';
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
  id: 'prospect-1', folio: 'PRO-0001-2026', etapa_contractual: 'NUEVO', version_operativa: 1, user_id: 'user-1', nombre: 'CONSTRUCTORA HORIZONTE', telefono: '3111002000', email: 'contacto@horizonte.mx', tipo_acto: 'Compraventa',
  servicio_catalogo_codigo: 'COMPRAVENTA', servicio_catalogo: catalogs.services[0], etapa_operativa_codigo: 'PROSPECTO_RECIBIDO', etapa_operativa: catalogs.stages[0],
  fuente: 'Referido', ciudad: 'Tepic', tiempo_estimado: 'Este mes', prioridad: 'ALTA', estado: 'NUEVO', tiene_predial: false, tiene_antecedente: true,
  created_at: '2026-08-01T10:00:00.000Z', updated_at: '2026-08-11T10:00:00.000Z', atendido_por: { nombre: 'Andrea Ruiz' }, cotizacion: null, documentos: [],
  seguimientos: [{ id: 'follow-1', tipo: 'Llamada', contenido: 'Primer contacto', proxima_accion: 'Validar documentos', created_at: '2026-08-11T10:00:00.000Z' }], ...overrides,
});

const meta = (items: Prospect[], total = items.length, page = 1, pageSize = 25) => ({
  page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)), hasNextPage: page * pageSize < total, hasPreviousPage: page > 1,
  countsByState: Object.fromEntries(items.map((item) => item.estado).map((state) => [state, items.filter((item) => item.estado === state).length])),
  metrics: { withQuote: items.filter((item) => item.cotizacion).length, accepted: items.filter(isConvertedProspect).length, active: items.filter(isActiveProspect).length },
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
    const operationMatch = url.pathname.match(/\/prospectos\/([^/]+)\/operacion$/);
    if (operationMatch) {
      const item = prospects.find((candidate) => candidate.id === operationMatch[1]) ?? prospects[0];
      const stage = item?.etapa_contractual ?? null;
      const action = stage === 'NUEVO' ? { code: 'COMENZAR_INTEGRACION', label: 'Comenzar integración' }
        : stage === 'EN_INTEGRACION' ? { code: 'MARCAR_LISTO_PARA_COTIZAR', label: 'Marcar listo para cotizar' }
          : stage === 'LISTO_PARA_COTIZAR' ? { code: 'CONVERTIR', label: 'Convertir en cotización' } : null;
      return response({
        stage, stageLabel: stage === 'NUEVO' ? 'Nuevo' : stage === 'EN_INTEGRACION' ? 'En integración' : stage === 'LISTO_PARA_COTIZAR' ? 'Listo para cotizar' : stage === 'CONVERTIDO_EN_COTIZACION' ? 'Convertido en cotización' : 'Etapa histórica',
        stageEnteredAt:'2026-08-01T10:00:00.000Z',knowledge:stage ? 'KNOWN' : 'UNKNOWN_LEGACY',version:item?.version_operativa ?? 0,folio:item?.folio ?? null,
        wait:{type:null,knowledge:'NOT_APPLICABLE',label:'Sin espera externa'},
        stages:[{code:'NUEVO',label:'Nuevo'},{code:'EN_INTEGRACION',label:'En integración'},{code:'LISTO_PARA_COTIZAR',label:'Listo para cotizar'},{code:'CONVERTIDO_EN_COTIZACION',label:'Cotización'}],
        actions:action ? [action] : [],notaria:null,notaries:[],responsibles:[{id:'user-1',nombre:'Andrea Ruiz'}],source:null,sourceHistory:[],events:[],quote:item?.cotizacion ?? null,canReadSource:true,
      });
    }
    if (url.pathname.endsWith('/documentos') && init?.method === 'POST') return failUploads ? response({ error: 'Upload failed' }, 500) : response({ id: `doc-${Date.now()}`, nombre_original: 'archivo.pdf', tipo: 'PREDIAL' }, 201);
    if (/\/documentos\/[^/]+\/url$/.test(url.pathname)) return response({ url: 'https://signed.example/document' });
    if (url.pathname.endsWith('/prospectos/prospect-1/seguimientos')) return response({ id: 'follow-2', tipo: 'Nota', contenido: 'Se recibió información', proxima_accion: 'Revisar alcance', created_at: '2026-08-12T10:00:00.000Z', usuario: { nombre: 'Andrea Ruiz' } }, 201);
    if (/\/prospectos\/[^/]+\/documentos$/.test(url.pathname)) return response([]);
    const detailMatch = url.pathname.match(/\/prospectos\/([^/]+)$/);
    if (detailMatch && init?.method === 'PUT') {
      const index = prospects.findIndex((candidate) => candidate.id === detailMatch[1]);
      const updated = { ...prospects[index], ...JSON.parse(String(init.body)) };
      prospects[index] = updated;
      return response(updated);
    }
    if (detailMatch) return response(prospects.find((candidate) => candidate.id === detailMatch[1]) ?? {}, prospects.some((candidate) => candidate.id === detailMatch[1]) ? 200 : 404);
    if (url.pathname.endsWith('/prospectos') && init?.method === 'POST') {
      createCount += 1;
      const body = JSON.parse(String(init.body));
      const created = prospect({ id: `created-${createCount}`, folio: `PRO-${String(createCount + 1).padStart(4, '0')}-2026`, etapa_contractual: 'NUEVO', version_operativa: 1, telefono: null, email: null, tipo_acto: null, servicio_catalogo: null, servicio_catalogo_codigo: null, etapa_operativa: null, etapa_operativa_codigo: null, ...body });
      prospects = [created, ...prospects];
      return response(created, 201);
    }
    if (url.pathname.endsWith('/prospectos')) {
      let filtered = [...prospects];
      const pipeline = url.searchParams.get('pipeline');
      if (pipeline) {
        const contractStages = {
          new: ['NUEVO'],
          progress: ['EN_INTEGRACION', 'RECABANDO_INFORMACION', 'LISTO_PARA_SOLICITAR', 'SOLICITUD_ENVIADA_NOTARIA', 'EN_ESPERA_COTIZACION'],
          quote: ['LISTO_PARA_COTIZAR', 'COTIZACION_RECIBIDA'],
          converted: ['CONVERTIDO_EN_COTIZACION', 'CONVERTIDO_COTIZACION', 'SUSPENDIDO', 'CANCELADO'],
        }[pipeline] ?? [];
        const legacyStates = PIPELINE_STAGES.find((item) => item.id === pipeline)?.substatuses ?? [];
        filtered = filtered.filter((item) => item.etapa_contractual
          ? contractStages.includes(item.etapa_contractual)
          : legacyStates.includes(item.estado));
      }
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

  it('ubica por etapa contractual aunque el subestado legacy sea divergente', async () => {
    const { fetchMock } = mockApi([prospect({ estado: 'NUEVO', etapa_contractual: 'CONVERTIDO_COTIZACION', cotizacion: { id: 'quote-1', estado: 'BORRADOR' } })]);
    render(<MemoryRouter initialEntries={['/prospectos']}><App /></MemoryRouter>);
    await screen.findAllByText('CONSTRUCTORA HORIZONTE');
    const requests = fetchMock.mock.calls.map(([url]) => String(url));
    expect(requests.some((url) => url.includes('pipeline=converted'))).toBe(true);
    expect(requests.some((url) => url.includes('pipeline=new'))).toBe(true);
    expect(requests.some((url) => url.includes('estado=NUEVO'))).toBe(false);
    expect(screen.getByText('Convertidos').closest('article')).toHaveTextContent('1');
    expect(screen.getAllByText('Subestado: Nuevo').length).toBeGreaterThan(0);
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

  it('nuevo prospecto solicita sólo el mínimo, asigna datos automáticos y abre la ficha', async () => {
    const { fetchMock } = mockApi([]); const user = userEvent.setup();
    render(<MemoryRouter initialEntries={['/prospectos']}><App /></MemoryRouter>);
    await screen.findByText('Aún no hay prospectos.');
    await user.click(screen.getByRole('button', { name: 'Nuevo prospecto' }));
    expect(screen.getAllByRole('textbox')).toHaveLength(2);
    expect(screen.getByText(/folio, la fecha y la etapa Nuevo se asignan automáticamente/i)).toBeInTheDocument();
    await user.type(screen.getByLabelText(/Nombre o razón social/), 'Francisco Javier Tapia López');
    await user.click(screen.getByRole('button', { name: 'Crear prospecto' }));
    await waitFor(() => {
      const createCall = fetchMock.mock.calls.find(([url, init]) => String(url).endsWith('/prospectos') && init?.method === 'POST');
      expect(JSON.parse(String(createCall?.[1]?.body))).toEqual({ nombre: 'FRANCISCO JAVIER TAPIA LÓPEZ' });
    });
    expect(await screen.findByRole('heading', { name: 'FRANCISCO JAVIER TAPIA LÓPEZ' })).toBeInTheDocument();
    expect(screen.getByText('PRO-0002-2026')).toBeInTheDocument();
  });

  it('crea una sola vez aunque el usuario haga doble click', async () => {
    const { getCreateCount } = mockApi([]); const user = userEvent.setup();
    render(<MemoryRouter initialEntries={['/prospectos']}><App /></MemoryRouter>);
    await screen.findByText('Aún no hay prospectos.'); await user.click(screen.getByRole('button', { name: 'Nuevo prospecto' }));
    await user.type(screen.getByLabelText(/Nombre o razón social/), 'josé ñuñez');
    const create = screen.getByRole('button', { name: 'Crear prospecto' });
    await Promise.all([user.click(create), user.click(create)]);
    expect(await screen.findByRole('heading', { name: 'JOSÉ ÑUÑEZ' })).toBeInTheDocument();
    expect(getCreateCount()).toBe(1);
  });

  it('detalle muestra modelo nuevo, oculta legacy y permite registrar seguimiento', async () => {
    mockApi([prospect({ estado: 'INFO_PENDIENTE' })]); const user = userEvent.setup();
    render(<MemoryRouter initialEntries={['/prospectos/prospect-1']}><App /></MemoryRouter>);
    expect(await screen.findByRole('heading', { name: 'CONSTRUCTORA HORIZONTE' })).toBeInTheDocument();
    expect(screen.getAllByText('Nuevo').length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: /Comenzar integración/i })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Datos del asunto' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Cliente / solicitante' })).toBeInTheDocument();
    expect(screen.queryByText('Ciudad')).not.toBeInTheDocument();
    expect(screen.queryByText('Origen')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Registrar seguimiento' }));
    await user.type(screen.getByRole('textbox', { name: /Nota/ }), 'Se recibió información');
    await user.click(screen.getByRole('button', { name: 'Guardar seguimiento' }));
    expect(await screen.findByText('Seguimiento registrado.')).toBeInTheDocument();
  });

  it('edita directamente por bloques, sin modal genérico', async () => {
    const { fetchMock } = mockApi(); const user = userEvent.setup();
    render(<MemoryRouter initialEntries={['/prospectos/prospect-1']}><App /></MemoryRouter>);
    await screen.findByRole('heading', { name: 'CONSTRUCTORA HORIZONTE' });
    expect(screen.queryByRole('button', { name: /^Editar$/ })).not.toBeInTheDocument();
    const clientSection = screen.getByRole('heading', { name: 'Cliente / solicitante' }).closest('section')!;
    await user.click(within(clientSection).getByRole('button', { name: 'Editar bloque' }));
    expect(screen.queryByLabelText('Origen')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Ciudad')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Tiempo estimado')).not.toBeInTheDocument();
    const name = screen.getByLabelText(/Nombre o razón social/); await user.clear(name); await user.type(name, 'josé ñuñez');
    await user.click(within(clientSection).getByRole('button', { name: 'Guardar' }));
    await waitFor(() => {
      const updateCall = fetchMock.mock.calls.find(([url, init]) => String(url).endsWith('/prospectos/prospect-1') && init?.method === 'PUT');
      expect(JSON.parse(String(updateCall?.[1]?.body))).toMatchObject({ nombre: 'JOSÉ ÑUÑEZ', expectedVersion: 1 });
    });
  });

  it('permite adjuntar después del alta y refleja disponibilidad sin exigir archivo para el checkbox', async () => {
    const { fetchMock } = mockApi(); const user = userEvent.setup();
    render(<MemoryRouter initialEntries={['/prospectos/prospect-1']}><App /></MemoryRouter>);
    await screen.findByRole('heading', { name: 'CONSTRUCTORA HORIZONTE' });
    await user.upload(screen.getByLabelText('Agregar documentos'), new File(['documento'], 'documento.pdf', { type: 'application/pdf' }));
    await user.click(screen.getByRole('button', { name: 'Subir seleccionados' }));
    expect(await screen.findByText('Documentación vinculada al prospecto.')).toBeInTheDocument();
    expect(fetchMock.mock.calls.some(([url, init]) => String(url).endsWith('/documentos') && init?.method === 'POST')).toBe(true);
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

  it('alta mínima conserva cierre Escape y no escribe al cancelar', async () => {
    const { fetchMock } = mockApi(); const user = userEvent.setup();
    render(<MemoryRouter initialEntries={['/prospectos']}><App /></MemoryRouter>);
    await screen.findAllByText('CONSTRUCTORA HORIZONTE');
    await user.click(screen.getByRole('button', { name: 'Nuevo prospecto' }));
    expect(screen.getByRole('dialog', { name: 'Nuevo prospecto' })).toBeInTheDocument();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog', { name: 'Nuevo prospecto' })).not.toBeInTheDocument();
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === 'POST')).toBe(false);
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
