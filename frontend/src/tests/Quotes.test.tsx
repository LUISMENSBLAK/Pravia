import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../app/App';
import { getAssistantActions, resolveAssistantContext } from '../features/assistant/assistantContext';
import { QuoteCardMobile } from '../features/quotes/components/QuoteCardMobile';
import type { Quote, QuoteListResult } from '../features/quotes/quotes.types';

const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const session = (permissions = ['cotizaciones.read', 'cotizaciones.write', 'prospectos.read', 'notarias.read', 'expedientes.write']) => ({ user: { id: 'user-1', name: 'Andrea Ruiz', role: 'ADMINISTRACION', permissions } });
const version = { id: 'version-1', version: 1, desglose_notaria: { rubros: [{ categoria: 'HONORARIOS', concepto: 'Honorarios notariales', monto: 120000 }] }, desglose_pravia: { participacion_pravia: 20000 }, total_notaria: 120000, honorarios_pravia: 20000, total_cliente: 120000, aprobada: true, created_at: '2026-08-01T10:00:00.000Z', pdf_url: null };
const quote = (overrides: Partial<Quote> = {}): Quote => ({
  id: 'quote-1', numero_solicitud: 'SOL-2026-001', numero_cotizacion: 'COT-2026-001', version_actual: 1, prospecto_id: 'prospect-1', user_id: 'user-1', notaria_id: 'notary-1', estado: 'ENVIADA_CLIENTE',
  fecha_solicitud_notaria: '2026-08-01T10:00:00.000Z', fecha_presupuesto_recibido: '2026-08-03T10:00:00.000Z', fecha_enviada_cliente: '2026-08-05T10:00:00.000Z', total_notaria: 120000, honorarios_pravia: 20000, total_cliente: 120000,
  created_at: '2026-08-01T10:00:00.000Z', updated_at: '2026-08-05T10:00:00.000Z', prospecto: { id: 'prospect-1', nombre: 'Constructora Horizonte', tipo_acto: 'Compraventa', email: 'cliente@horizonte.mx' }, notaria: { id: 'notary-1', nombre: 'Notaría 12', correo_proyectos: 'proyectos@notaria.mx' }, creada_por: { id: 'user-1', nombre: 'Andrea', apellido: 'Ruiz' }, versiones: [version], seguimientos: [], documentos: [], pagos: [], expediente: null,
  transiciones_permitidas: ['EN_NEGOCIACION', 'ACEPTADA', 'RECHAZADA', 'VENCIDA'], conversion: { eligible: false, accepted: false, approvedVersion: true, validatedAdvance: false, validatedAdvanceTotal: 0, notConverted: true, linkedProspect: true, failures: ['La cotización debe estar ACEPTADA por el cliente.'] }, ...overrides,
});
const list = (quotes = [quote()]): QuoteListResult => ({ data: quotes, meta: { page: 1, pageSize: 12, total: quotes.length, totalPages: 1, hasNextPage: false, hasPreviousPage: false, countsByState: { ENVIADA_CLIENTE: quotes.length }, metrics: { sent: quotes.length, accepted: 0, totalAmount: quotes.reduce((sum, item) => sum + Number(item.total_cliente || 0), 0), conversionRate: 0 } }, facets: { acts: ['Compraventa'], responsibles: [{ id: 'user-1', name: 'Andrea Ruiz' }] }, analytics: [{ key: '2026-08', label: 'ago', sentAmount: 120000, acceptedAmount: 0, sentCount: 1, acceptedCount: 0, rate: 0 }] });

type MockOptions = { quotes?: Quote[]; permissions?: string[]; listResult?: QuoteListResult; failList?: boolean; convertError?: boolean };
const mockApi = (options: MockOptions = {}) => {
  const quotes = options.quotes ?? [quote()]; const result = options.listResult ?? list(quotes);
  return vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.endsWith('/auth/me')) return response(session(options.permissions));
    if (url.includes('/prospectos?')) return response({ data: [{ id: 'prospect-2', nombre: 'Nueva Empresa', tipo_acto: 'Hipoteca', email: 'nueva@empresa.mx' }], meta: { total: 1 }, facets: { services: [], sources: [] } });
    if (url.includes('/notarias?')) return response([{ id: 'notary-1', nombre: 'Notaría 12', numero_notaria: '12', municipio: 'Tepic', entidad_federativa: 'Nayarit', activa: true }]);
    if (url.endsWith('/cotizaciones') && init?.method === 'POST') return response(quote({ id: 'created-quote', numero_cotizacion: 'COT-2026-002', prospecto_id: 'prospect-2', prospecto: { nombre: 'Nueva Empresa', tipo_acto: 'Hipoteca' }, versiones: [] }), 201);
    if (url.endsWith('/cotizaciones/created-quote/versiones')) return response({ version: { ...version, id: 'created-version' }, cotizacion: quote({ id: 'created-quote', numero_cotizacion: 'COT-2026-002' }) }, 201);
    if (url.endsWith('/cotizaciones/quote-1/seguimientos')) return response(quotes[0]?.seguimientos ?? []);
    if (url.endsWith('/cotizaciones/quote-1/documentos')) return response(quotes[0]?.documentos ?? []);
    if (url.endsWith('/cotizaciones/quote-1/registrar-envio')) return response({ cotizacion: quote({ estado: 'ENVIADA_CLIENTE' }), deliveryConfirmedByProvider: false }, 201);
    if (url.endsWith('/cotizaciones/quote-1/convertir')) return options.convertError ? response({ error: 'La cotización ya fue convertida.', code: 'CONVERSION_INTEGRITY_ERROR' }, 409) : response({ id: 'exp-1', numero_pravia: 'EXP-2026-001', idempotent: false }, 201);
    if (url.endsWith('/cotizaciones/quote-1/estado')) return response(quote({ estado: JSON.parse(String(init?.body)).estado }), 200);
    if (url.endsWith('/documentos/doc-pdf/url')) return response({ url: 'https://example.test/cotizacion.pdf' });
    if (url.endsWith('/cotizaciones/quote-1')) return response(quotes[0]);
    if (url.includes('/cotizaciones?')) return options.failList ? response({ error: 'Unavailable' }, 500) : response(result);
    return response({}, 204);
  }));
};

describe('Cotizaciones', () => {
  beforeEach(() => { vi.restoreAllMocks(); });

  it('renderiza cinco KPIs, lista, tabla y analítica con importes reales', async () => {
    mockApi(); render(<MemoryRouter initialEntries={['/cotizaciones']}><App /></MemoryRouter>);
    expect(await screen.findByRole('heading', { name: 'Cotizaciones' })).toBeInTheDocument(); await screen.findByText('Lista de cotizaciones');
    expect(screen.getByText('Total cotizaciones')).toBeInTheDocument(); expect(screen.getByText('Importe total')).toBeInTheDocument();
    expect(screen.getAllByText('$120,000.00').length).toBeGreaterThan(0); expect(screen.getByRole('heading', { name: 'Conversión de cotizaciones' })).toBeInTheDocument();
    const help = screen.getByRole('button', { name: 'Tasa = cotizaciones aceptadas / cotizaciones enviadas al cliente.' });
    help.focus();
    expect(help).toHaveFocus();
    expect(screen.getByRole('tooltip')).toHaveTextContent('Tasa = cotizaciones aceptadas / cotizaciones enviadas al cliente.');
  });

  it('consulta búsqueda y filtros en servidor', async () => {
    mockApi(); const user = userEvent.setup(); render(<MemoryRouter initialEntries={['/cotizaciones']}><App /></MemoryRouter>); await screen.findAllByText('Constructora Horizonte');
    await user.type(screen.getByLabelText('Buscar cotización'), 'COT-2026'); await waitFor(() => expect(fetch).toHaveBeenCalledWith(expect.stringContaining('busqueda=COT-2026'), expect.anything()));
    await user.selectOptions(screen.getByLabelText('Estado'), 'ENVIADA_CLIENTE'); await waitFor(() => expect(fetch).toHaveBeenCalledWith(expect.stringContaining('estado=ENVIADA_CLIENTE'), expect.anything()));
    await user.selectOptions(screen.getByLabelText('Tipo de acto'), 'Compraventa'); await waitFor(() => expect(fetch).toHaveBeenCalledWith(expect.stringContaining('acto=Compraventa'), expect.anything()));
  });

  it('pagina desde backend', async () => {
    const result = list(); result.meta = { ...result.meta, page: 1, total: 25, totalPages: 3, hasNextPage: true };
    mockApi({ listResult: result }); const user = userEvent.setup(); render(<MemoryRouter initialEntries={['/cotizaciones']}><App /></MemoryRouter>); await screen.findByText('Página 1 de 3');
    await user.click(screen.getByRole('button', { name: 'Página siguiente' })); await waitFor(() => expect(fetch).toHaveBeenCalledWith(expect.stringContaining('page=2'), expect.anything()));
  });

  it('oculta el CTA de alta sin permiso de escritura', async () => {
    mockApi({ permissions: ['cotizaciones.read'] }); render(<MemoryRouter initialEntries={['/cotizaciones']}><App /></MemoryRouter>); await screen.findByText('Lista de cotizaciones'); expect(screen.queryByRole('button', { name: 'Nueva cotización' })).not.toBeInTheDocument();
  });

  it('valida el primer paso del alta', async () => {
    mockApi(); const user = userEvent.setup(); render(<MemoryRouter initialEntries={['/cotizaciones']}><App /></MemoryRouter>); await screen.findByText('Lista de cotizaciones'); await user.click(screen.getByRole('button', { name: 'Nueva cotización' })); await user.click(screen.getByRole('button', { name: /Continuar/ })); expect(screen.getByRole('alert')).toHaveTextContent('Selecciona un prospecto');
  });

  it('crea borrador y versión 1 con total canónico', async () => {
    mockApi(); const user = userEvent.setup(); render(<MemoryRouter initialEntries={['/cotizaciones']}><App /></MemoryRouter>); await screen.findByText('Lista de cotizaciones'); await user.click(screen.getByRole('button', { name: 'Nueva cotización' }));
    await user.click(screen.getByRole('radio', { name: /Nueva Empresa/ })); await user.click(screen.getByRole('button', { name: /Continuar/ })); await user.click(screen.getByRole('radio', { name: /Notaría 12/ })); await user.click(screen.getByRole('button', { name: /Continuar/ }));
    await user.type(screen.getByLabelText('Descripción concepto 1'), 'Honorarios'); await user.type(screen.getByLabelText('Importe concepto 1'), '45000'); await user.click(screen.getByRole('button', { name: /Continuar/ })); await user.click(screen.getByRole('button', { name: /Continuar/ })); await user.click(screen.getByRole('button', { name: 'Crear cotización' }));
    expect(await screen.findByText(/Cotización COT-2026-002 creada/)).toBeInTheDocument();
    const versionCall = vi.mocked(fetch).mock.calls.find(([url]) => String(url).endsWith('/cotizaciones/created-quote/versiones')); expect(JSON.parse(String(versionCall?.[1]?.body))).toMatchObject({ total_notaria: 45000, honorarios_pravia: 0, aprobada: true });
  });

  it('muestra detalle, conceptos, versiones y actividad reales', async () => {
    mockApi(); render(<MemoryRouter initialEntries={['/cotizaciones/quote-1']}><App /></MemoryRouter>); expect(await screen.findByRole('heading', { name: 'COT-2026-001' })).toBeInTheDocument(); expect(screen.getByText('Honorarios notariales')).toBeInTheDocument(); expect(screen.getByText('v1 · Vigente')).toBeInTheDocument(); expect(screen.getByText('Envío a cliente registrado')).toBeInTheDocument();
  });

  it('abre el PDF real vinculado y no genera uno en frontend', async () => {
    const open = vi.fn(); vi.stubGlobal('open', open); mockApi({ quotes: [quote({ documentos: [{ id: 'doc-pdf', nombre_original: 'cotizacion.pdf', mime_type: 'application/pdf' }] })] }); const user = userEvent.setup(); render(<MemoryRouter initialEntries={['/cotizaciones/quote-1']}><App /></MemoryRouter>); await screen.findByRole('heading', { name: 'COT-2026-001' }); await user.click(screen.getByRole('button', { name: 'Descargar' })); await waitFor(() => expect(open).toHaveBeenCalledWith('https://example.test/cotizacion.pdf', '_blank', 'noopener,noreferrer'));
  });

  it('registra envío manual sin afirmar entrega del proveedor', async () => {
    mockApi({ quotes: [quote({ estado: 'EN_REVISION_ABOGADO', transiciones_permitidas: ['ENVIADA_CLIENTE'] })] }); const user = userEvent.setup(); render(<MemoryRouter initialEntries={['/cotizaciones/quote-1']}><App /></MemoryRouter>); await screen.findByRole('heading', { name: 'COT-2026-001' }); await user.click(screen.getByRole('button', { name: 'Enviar a cliente' })); expect(screen.getByText(/no garantiza que el destinatario haya recibido/i)).toBeInTheDocument(); await user.type(screen.getByLabelText('Evidencia / nota de entrega'), 'Enviado desde Outlook a las 10:00.'); await user.click(screen.getByRole('button', { name: 'Registrar envío' })); expect(await screen.findByText('Envío manual registrado con evidencia.')).toBeInTheDocument();
  });

  it('acepta mediante transición backend, no solo en UI', async () => {
    mockApi(); const user = userEvent.setup(); render(<MemoryRouter initialEntries={['/cotizaciones/quote-1']}><App /></MemoryRouter>); await screen.findByRole('heading', { name: 'COT-2026-001' }); await user.click(screen.getByRole('button', { name: 'Aceptar cotización' })); await waitFor(() => expect(fetch).toHaveBeenCalledWith(expect.stringContaining('/cotizaciones/quote-1/estado'), expect.objectContaining({ method: 'PUT', body: JSON.stringify({ estado: 'ACEPTADA' }) })));
  });

  it('confirma y ejecuta conversión idempotente por endpoint real', async () => {
    const accepted = quote({ estado: 'ACEPTADA', transiciones_permitidas: [], conversion: { eligible: true, accepted: true, approvedVersion: true, validatedAdvance: true, validatedAdvanceTotal: 30000, notConverted: true, linkedProspect: true, failures: [] } }); mockApi({ quotes: [accepted] }); const user = userEvent.setup(); render(<MemoryRouter initialEntries={['/cotizaciones/quote-1']}><App /></MemoryRouter>); await screen.findByRole('heading', { name: 'COT-2026-001' }); await user.click(screen.getByRole('button', { name: 'Convertir a expediente' })); const dialog = screen.getByRole('dialog'); expect(within(dialog).getByText('Constructora Horizonte')).toBeInTheDocument(); await user.click(within(dialog).getByRole('button', { name: 'Crear expediente' })); await waitFor(() => expect(fetch).toHaveBeenCalledWith(expect.stringContaining('/cotizaciones/quote-1/convertir'), expect.objectContaining({ method: 'POST' })));
  });

  it('explica humanamente el conflicto de conversión duplicada', async () => {
    const accepted = quote({ estado: 'ACEPTADA', transiciones_permitidas: [], conversion: { eligible: true, accepted: true, approvedVersion: true, validatedAdvance: true, validatedAdvanceTotal: 30000, notConverted: true, linkedProspect: true, failures: [] } }); mockApi({ quotes: [accepted], convertError: true }); const user = userEvent.setup(); render(<MemoryRouter initialEntries={['/cotizaciones/quote-1']}><App /></MemoryRouter>); await screen.findByRole('heading', { name: 'COT-2026-001' }); await user.click(screen.getByRole('button', { name: 'Convertir a expediente' })); await user.click(screen.getByRole('button', { name: 'Crear expediente' })); expect(await screen.findByRole('alert')).toHaveTextContent('ya fue convertida');
  });

  it('renderiza tarjetas móviles accesibles además de tabla desktop', async () => {
    const first = render(<MemoryRouter><QuoteCardMobile quote={quote()} /></MemoryRouter>); expect(screen.getByRole('button', { name: /COT-2026-001.*Constructora Horizonte/ })).toBeInTheDocument(); first.unmount(); mockApi(); render(<MemoryRouter initialEntries={['/cotizaciones']}><App /></MemoryRouter>); await screen.findByText('Lista de cotizaciones'); expect(screen.getByRole('table')).toBeInTheDocument();
  });

  it('muestra estados vacío, filtro vacío y error sin tumbar el shell', async () => {
    mockApi({ quotes: [] }); const first = render(<MemoryRouter initialEntries={['/cotizaciones']}><App /></MemoryRouter>); expect(await screen.findByText('No hay cotizaciones.')).toBeInTheDocument(); first.unmount();
    mockApi({ quotes: [], listResult: { ...list([]), meta: { ...list([]).meta, total: 0 } } }); const second = render(<MemoryRouter initialEntries={['/cotizaciones?search=nadie']}><App /></MemoryRouter>); expect(await screen.findByText('No encontramos cotizaciones con estos filtros.')).toBeInTheDocument(); second.unmount();
    mockApi({ failList: true }); render(<MemoryRouter initialEntries={['/cotizaciones']}><App /></MemoryRouter>); expect(await screen.findByText('No pudimos cargar las cotizaciones.')).toBeInTheDocument();
  });

  it('expone contexto y quick actions IA para lista y detalle', () => {
    const listContext = resolveAssistantContext({ pathname: '/cotizaciones', hash: '' }); const detailContext = resolveAssistantContext({ pathname: '/cotizaciones/quote-1', hash: '' }); expect(getAssistantActions(listContext).map((item) => item.label)).toContain('Por vencer'); expect(detailContext).toMatchObject({ entityType: 'cotizacion', entityId: 'quote-1' }); expect(getAssistantActions(detailContext).map((item) => item.label)).toContain('Explicar conceptos');
  });
});
