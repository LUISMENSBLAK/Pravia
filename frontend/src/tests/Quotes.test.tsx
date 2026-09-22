import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../app/App';
import { getAssistantActions, resolveAssistantContext } from '../features/assistant/assistantContext';
import { QuoteCardMobile } from '../features/quotes/components/QuoteCardMobile';
import type { Quote, QuoteContractStage, QuoteListResult, QuoteWorkflow } from '../features/quotes/quotes.types';
import quoteCss from '../features/quotes/Quotes.module.css?inline';

const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const session = (permissions = ['cotizaciones.read', 'cotizaciones.write', 'prospectos.read', 'notarias.read', 'expedientes.write', 'documentos.read', 'documentos.unlink']) => ({ user: { id: 'user-1', name: 'Andrea Ruiz', role: 'ADMINISTRACION', permissions } });
const version = { id: 'version-1', version: 1, desglose_notaria: { rubros: [{ categoria: 'HONORARIOS', concepto: 'Honorarios notariales', monto: 120000 }] }, desglose_pravia: { participacion_pravia: 20000 }, total_notaria: 120000, honorarios_pravia: 20000, total_cliente: 120000, aprobada: true, created_at: '2026-08-01T10:00:00.000Z', pdf_url: null };
const workflow = (stage: QuoteContractStage, actions: QuoteWorkflow['actions'], versionNumber = 1): QuoteWorkflow => ({
  stage, stageLabel: stage === 'ACEPTO_ANTICIPO' ? 'Aceptó / Anticipo (histórico)' : stage === 'ACEPTADA' ? 'Aceptada' : stage === 'EN_SEGUIMIENTO' ? 'En seguimiento' : stage === 'ENVIADA_CLIENTE' ? 'Enviada al cliente' : stage === 'EN_ELABORACION' ? 'En elaboración' : 'Borrador',
  stageEnteredAt: '2026-08-05T10:00:00.000Z', knowledge: 'KNOWN', version: versionNumber, actions, events: [],
  firstSentAt: stage === 'BORRADOR' ? null : '2026-08-05T10:00:00.000Z', acceptedAdvanceAt: stage === 'ACEPTO_ANTICIPO' ? '2026-08-06T10:00:00.000Z' : null,
});
const quote = (overrides: Partial<Quote> = {}): Quote => ({
  id: 'quote-1', numero_solicitud: 'SOL-2026-001', numero_cotizacion: 'COT-2026-001', version_actual: 1, prospecto_id: 'prospect-1', user_id: 'user-1', notaria_id: 'notary-1', estado: 'ENVIADA_CLIENTE',
  fecha_solicitud_notaria: '2026-08-01T10:00:00.000Z', fecha_presupuesto_recibido: '2026-08-03T10:00:00.000Z', fecha_enviada_cliente: '2026-08-05T10:00:00.000Z', total_notaria: 120000, honorarios_pravia: 20000, total_cliente: 120000,
  created_at: '2026-08-01T10:00:00.000Z', updated_at: '2026-08-05T10:00:00.000Z', prospecto: { id: 'prospect-1', nombre: 'Constructora Horizonte', tipo_acto: 'Compraventa', email: 'cliente@horizonte.mx' }, notaria: { id: 'notary-1', nombre: 'Notaría 12', correo_proyectos: 'proyectos@notaria.mx' }, creada_por: { id: 'user-1', nombre: 'Andrea', apellido: 'Ruiz' }, versiones: [version], seguimientos: [], documentos: [], pagos: [], expediente: null,
  presupuesto: { concepts: [{ id: 'c-1', concepto: 'Honorarios notariales', categoria: 'HONORARIOS', importe: 120000, orden: 0, origen: 'MANUAL' }], totals: { honorarios: '120000.00', iva_honorarios: '0.00', subtotal_honorarios: '120000.00', impuestos_derechos: '0.00', total: '120000.00' } },
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
    if (url.endsWith('/cotizaciones/quote-1/presupuesto') && init?.method === 'PUT') return response({ presupuesto: { concepts: JSON.parse(String(init.body)).concepts, totals: { honorarios: '0.00', iva_honorarios: '0.00', subtotal_honorarios: '0.00', impuestos_derechos: '8500.00', total: '8500.00' } }, updated_at: '2026-08-05T10:01:00.000Z', stage: quotes[0]?.workflow?.stage ?? null });
    if (url.endsWith('/cotizaciones/extraer-presupuesto')) return response({ rubros: [{ id: 'row-1', concepto: 'Derecho registral', nombre_original: 'Derecho registral', monto: 8500, categoria: 'PENDIENTE_CLASIFICACION' }], total_notaria: 8500, total_pdf_declarado: 8500, suma_valida: true, mensaje_validacion: 'Suma verificada', diferencia_monto: 0 });
    if (url.endsWith('/cotizaciones/quote-1/generar-documento')) return response({ id: 'generated-doc', nombre_original: 'COT-2026-001-v1.docx', mime_type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' }, 201);
    if (url.endsWith('/cotizaciones/quote-1/seguimientos')) return response(quotes[0]?.seguimientos ?? []);
    if (url.endsWith('/cotizaciones/quote-1/documentos')) return response(quotes[0]?.documentos ?? []);
    if (url.endsWith('/cotizaciones/quote-1/registrar-envio')) return response({ cotizacion: quote({ estado: 'ENVIADA_CLIENTE' }), deliveryConfirmedByProvider: false }, 201);
    if (url.endsWith('/cotizaciones/quote-1/acciones')) return response({ idempotent: false, eventId: 'event-1' }, 201);
    if (url.endsWith('/cotizaciones/quote-1/convertir')) return options.convertError ? response({ error: 'La cotización ya fue convertida.', code: 'CONVERSION_INTEGRITY_ERROR' }, 409) : response({ id: 'exp-1', numero_pravia: 'EXP-2026-001', idempotent: false }, 201);
    if (url.endsWith('/cotizaciones/quote-1/estado')) return response(quote({ estado: JSON.parse(String(init?.body)).estado }), 200);
    if (url.includes('/cotizaciones/quote-1/documentos/doc-pdf/') && init?.method !== 'DELETE') return new Response(new Blob(['documento'], { type: 'application/pdf' }), { status: 200, headers: { 'Content-Type': 'application/pdf' } });
    if (url.endsWith('/cotizaciones/quote-1/documentos/doc-pdf') && init?.method === 'DELETE') return response({ message: 'Documento retirado' });
    if (url.endsWith('/cotizaciones/quote-1')) return response(quotes[0]);
    if (url.includes('/cotizaciones?')) return options.failList ? response({ error: 'Unavailable' }, 500) : response(result);
    return response({}, 204);
  }));
};

describe('Cotizaciones', () => {
  it('mantiene objetivos táctiles de 44 px en las acciones contractuales móviles', () => {
    const mobileRules = quoteCss.slice(
      quoteCss.indexOf('@media (max-width: 767px)'),
      quoteCss.indexOf('@media (max-width: 520px)'),
    );
    expect(mobileRules).toMatch(/dangerButton[\s\S]*businessActions[\s\S]*min-height: 44px/);
    expect(mobileRules).toMatch(/dialog[\s\S]*header > button \{ width: 44px; height: 44px; \}/);
  });
  beforeEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

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

  it('alta compartida conduce a Prospectos, sin segunda solicitud a Notaría', async () => {
    mockApi(); const user = userEvent.setup(); render(<MemoryRouter initialEntries={['/cotizaciones']}><App /></MemoryRouter>);
    await screen.findByText('Lista de cotizaciones'); await user.click(screen.getByRole('button', { name: 'Nueva cotización' }));
    expect(screen.getByRole('link', {name:'Ir al prospecto de origen'})).toHaveAttribute('href','/prospectos');
    expect(screen.queryByRole('button',{name:'Crear cotización'})).not.toBeInTheDocument();
    expect(fetch).not.toHaveBeenCalledWith(expect.stringMatching(/\/cotizaciones$/),expect.objectContaining({method:'POST'}));
  });

  it('alta con prospecto conserva el enlace de origen y no genera presupuesto prematuro', async () => {
    mockApi(); render(<MemoryRouter initialEntries={['/cotizaciones?new=1&prospecto=prospect-1']}><App /></MemoryRouter>);
    expect(await screen.findByRole('link',{name:'Ir al prospecto de origen'})).toHaveAttribute('href','/prospectos/prospect-1');
    expect(screen.queryByText('La cotización se crea en borrador; el envío a notaría se registrará después con evidencia.')).not.toBeInTheDocument();
  });

  it('muestra una sola cotización estructurada editable y actividad real', async () => {
    mockApi(); render(<MemoryRouter initialEntries={['/cotizaciones/quote-1']}><App /></MemoryRouter>); expect(await screen.findByRole('heading', { name: 'COT-2026-001' })).toBeInTheDocument(); expect(screen.getByDisplayValue('Honorarios notariales')).toBeInTheDocument(); expect(screen.queryByText(/v1 · Vigente/i)).not.toBeInTheDocument(); expect(screen.queryByText(/Participación interna PRAVIA/i)).not.toBeInTheDocument(); expect(screen.getByText('Envío a cliente registrado')).toBeInTheDocument();
  });

  it('muestra el avance operativo desde la etapa contractual persistida', async () => {
    mockApi({ quotes: [quote({ workflow: workflow('EN_SEGUIMIENTO', ['ACEPTAR']) })] });
    render(<MemoryRouter initialEntries={['/cotizaciones/quote-1']}><App /></MemoryRouter>);
    await screen.findByRole('heading', { name: 'COT-2026-001' });
    const progress = screen.getByRole('region', { name: 'Avance operativo de la cotización' });
    expect(within(progress).getByText('Etapa persistida: En seguimiento')).toBeInTheDocument();
    expect(within(progress).getByText('En seguimiento').closest('li')).toHaveAttribute('aria-current', 'step');
    expect(within(progress).getByText('Enviada al cliente').closest('li')).toHaveAttribute('data-complete', 'true');
  });

  it('muestra subtotales humanos por rubro y el total general', async () => {
    mockApi({ quotes: [quote({ presupuesto: { concepts: [
      { id: 'c-1', concepto: 'Honorarios notariales', categoria: 'HONORARIOS', importe: 30000, orden: 0, origen: 'MANUAL' },
      { id: 'c-2', concepto: 'Registro Público', categoria: 'IMPUESTOS_DERECHOS', importe: 8500, orden: 1, origen: 'MANUAL' },
    ], totals: { honorarios: '30000.00', iva_honorarios: '0.00', subtotal_honorarios: '30000.00', impuestos_derechos: '8500.00', total: '38500.00' } } })] });
    render(<MemoryRouter initialEntries={['/cotizaciones/quote-1']}><App /></MemoryRouter>);
    await screen.findByRole('heading', { name: 'COT-2026-001' });
    expect(screen.getAllByText('Honorarios').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Impuestos y derechos').length).toBeGreaterThan(0);
    expect(screen.queryByText('IMPUESTOS_DERECHOS')).not.toBeInTheDocument();
  });

  it('importa al editor común, exige clasificación humana y persiste el origen importado', async () => {
    mockApi();
    const user = userEvent.setup();
    render(<MemoryRouter initialEntries={['/cotizaciones/quote-1']}><App /></MemoryRouter>);
    await screen.findByRole('heading', { name: 'COT-2026-001' });
    fireEvent.change(screen.getByLabelText(/Importar documento/i), { target: { files: [new File(['%PDF-test'], 'presupuesto.pdf', { type: 'application/pdf' })] } });
    expect(await screen.findByText(/1 renglones detectados/i)).toBeInTheDocument();
    expect(screen.getByLabelText('Categoría concepto 1')).toHaveValue('');
    await user.selectOptions(screen.getByLabelText('Categoría concepto 1'), 'IMPUESTOS_DERECHOS');
    await user.clear(screen.getByLabelText('Concepto 1'));
    await user.type(screen.getByLabelText('Concepto 1'), 'Derecho registral corregido');
    expect(screen.queryByText('Participación interna PRAVIA')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Guardar cambios' }));
    await waitFor(() => expect(fetch).toHaveBeenCalledWith(expect.stringContaining('/cotizaciones/quote-1/presupuesto'), expect.objectContaining({ method: 'PUT' })));
    const call = vi.mocked(fetch).mock.calls.find(([input]) => String(input).endsWith('/cotizaciones/quote-1/presupuesto'));
    expect(JSON.parse(String(call?.[1]?.body))).toMatchObject({ origin: 'IMPORTADO', concepts: [{ categoria: 'IMPUESTOS_DERECHOS', concepto: 'Derecho registral corregido', importe: 8500 }] });
  });

  it('genera el documento desde el endpoint canónico de CFG-002', async () => {
    mockApi();
    const user = userEvent.setup();
    render(<MemoryRouter initialEntries={['/cotizaciones/quote-1']}><App /></MemoryRouter>);
    await screen.findByRole('heading', { name: 'COT-2026-001' });
    await user.click(screen.getByRole('button', { name: 'Generar cotización' }));
    await waitFor(() => expect(fetch).toHaveBeenCalledWith(expect.stringContaining('/cotizaciones/quote-1/generar-documento'), expect.objectContaining({ method: 'POST' })));
    expect(await screen.findByText('Documento de cotización generado desde ADM-001.')).toBeInTheDocument();
  });

  it('ofrece ver, descargar y eliminar el documento real según permisos', async () => {
    vi.stubGlobal('URL', { ...URL, createObjectURL: vi.fn(() => 'blob:test'), revokeObjectURL: vi.fn() }); vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined); vi.spyOn(window, 'confirm').mockReturnValue(true);
    mockApi({ quotes: [quote({ documentos: [{ id: 'doc-pdf', nombre_original: 'cotizacion.pdf', mime_type: 'application/pdf', can_delete: true }] })] }); const user = userEvent.setup(); render(<MemoryRouter initialEntries={['/cotizaciones/quote-1']}><App /></MemoryRouter>); await screen.findByRole('heading', { name: 'COT-2026-001' });
    await user.click(screen.getByRole('button', { name: 'Ver cotizacion.pdf' })); await waitFor(() => expect(fetch).toHaveBeenCalledWith(expect.stringContaining('/cotizaciones/quote-1/documentos/doc-pdf/ver'), expect.anything()));
    expect(await screen.findByRole('dialog', { name: 'cotizacion.pdf' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Cerrar vista previa' }));
    await user.click(screen.getByRole('button', { name: 'Descargar cotizacion.pdf' })); await waitFor(() => expect(fetch).toHaveBeenCalledWith(expect.stringContaining('/cotizaciones/quote-1/documentos/doc-pdf/descargar'), expect.anything()));
    await user.click(screen.getByRole('button', { name: 'Eliminar cotizacion.pdf' })); await waitFor(() => expect(fetch).toHaveBeenCalledWith(expect.stringContaining('/cotizaciones/quote-1/documentos/doc-pdf'), expect.objectContaining({ method: 'DELETE' })));
  });

  it('registra envío manual sin afirmar entrega del proveedor', async () => {
    mockApi({ quotes: [quote({ estado: 'BORRADOR', workflow: workflow('EN_ELABORACION', ['ENVIAR_CLIENTE', 'SUSPENDER', 'CANCELAR']) })] }); const user = userEvent.setup(); render(<MemoryRouter initialEntries={['/cotizaciones/quote-1']}><App /></MemoryRouter>); await screen.findByRole('heading', { name: 'COT-2026-001' }); await user.click(screen.getByRole('button', { name: 'Registrar envío al cliente' })); expect(screen.getByText(/no garantiza que el destinatario haya recibido/i)).toBeInTheDocument(); await user.type(screen.getByLabelText('Evidencia / nota de entrega'), 'Enviado desde Outlook a las 10:00.'); await user.click(screen.getByRole('button', { name: 'Registrar envío' })); expect(await screen.findByText('Envío registrado con evidencia.')).toBeInTheDocument();
    const call = vi.mocked(fetch).mock.calls.find(([input]) => String(input).endsWith('/cotizaciones/quote-1/acciones'));
    expect(call?.[1]).toMatchObject({ method: 'POST' }); expect(JSON.parse(String(call?.[1]?.body))).toMatchObject({ action: 'ENVIAR_CLIENTE', expectedVersion: 1, confirm: true, channel: 'correo', recipient: 'cliente@horizonte.mx' });
  });

  it('registra la aceptación humana sin bloquear la edición inline ni aplicar finanzas', async () => {
    mockApi({ quotes: [quote({ workflow: workflow('EN_SEGUIMIENTO', ['REENVIAR_CLIENTE', 'ACEPTAR', 'RECHAZAR', 'SUSPENDER', 'CANCELAR'], 2) })] }); const user = userEvent.setup(); render(<MemoryRouter initialEntries={['/cotizaciones/quote-1']}><App /></MemoryRouter>); await screen.findByRole('heading', { name: 'COT-2026-001' }); await user.click(screen.getByRole('button', { name: 'Registrar aceptación' })); expect(screen.getByText(/no bloquea la edición del presupuesto vigente/i)).toBeInTheDocument(); await user.click(screen.getByRole('button', { name: 'Confirmar aceptación' }));
    await waitFor(() => expect(fetch).toHaveBeenCalledWith(expect.stringContaining('/cotizaciones/quote-1/acciones'), expect.objectContaining({ method: 'POST' })));
    const call = vi.mocked(fetch).mock.calls.find(([input]) => String(input).endsWith('/cotizaciones/quote-1/acciones'));
    expect(JSON.parse(String(call?.[1]?.body))).toMatchObject({ action: 'ACEPTAR', expectedVersion: 2, confirm: true });
    expect(fetch).not.toHaveBeenCalledWith(expect.stringContaining('/cotizaciones/quote-1/estado'), expect.anything());
  });

  it('mantiene el foco dentro del diálogo contractual y lo restaura al cerrar', async () => {
    mockApi({ quotes: [quote({ workflow: workflow('ENVIADA_CLIENTE', ['ACEPTAR'], 2) })] });
    const user = userEvent.setup();
    render(<MemoryRouter initialEntries={['/cotizaciones/quote-1']}><App /></MemoryRouter>);
    await screen.findByRole('heading', { name: 'COT-2026-001' });
    const trigger = screen.getByRole('button', { name: 'Registrar aceptación' });
    await user.click(trigger);
    const dialog = screen.getByRole('dialog');
    const close = within(dialog).getByRole('button', { name: 'Cerrar' });
    const submit = within(dialog).getByRole('button', { name: 'Confirmar aceptación' });
    expect(close).toHaveFocus();
    submit.focus();
    await user.tab();
    expect(close).toHaveFocus();
    await user.tab({ shift: true });
    expect(submit).toHaveFocus();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it('confirma y ejecuta conversión idempotente por endpoint real', async () => {
    const accepted = quote({ estado: 'ACEPTADA', workflow: workflow('ACEPTO_ANTICIPO', ['CONVERTIR'], 3), transiciones_permitidas: [], conversion: { eligible: true, accepted: true, approvedVersion: true, validatedAdvance: false, validatedAdvanceTotal: 0, notConverted: true, linkedProspect: true, failures: [] } }); mockApi({ quotes: [accepted] }); const user = userEvent.setup(); render(<MemoryRouter initialEntries={['/cotizaciones/quote-1']}><App /></MemoryRouter>); await screen.findByRole('heading', { name: 'COT-2026-001' }); await user.click(screen.getByRole('button', { name: 'Convertir en expediente' })); const dialog = screen.getByRole('dialog'); expect(within(dialog).getByText('Constructora Horizonte')).toBeInTheDocument(); expect(within(dialog).getByText(/sin aplicar movimientos financieros/i)).toBeInTheDocument(); await user.click(within(dialog).getByRole('button', { name: 'Convertir en expediente' })); await waitFor(() => expect(fetch).toHaveBeenCalledWith(expect.stringContaining('/cotizaciones/quote-1/convertir'), expect.objectContaining({ method: 'POST' })));
    const call = vi.mocked(fetch).mock.calls.find(([input]) => String(input).endsWith('/cotizaciones/quote-1/convertir'));
    expect(JSON.parse(String(call?.[1]?.body))).toMatchObject({ expectedVersion: 3, confirm: true });
  });

  it('explica humanamente el conflicto de conversión duplicada', async () => {
    const accepted = quote({ estado: 'ACEPTADA', workflow: workflow('ACEPTO_ANTICIPO', ['CONVERTIR'], 3), transiciones_permitidas: [], conversion: { eligible: true, accepted: true, approvedVersion: true, validatedAdvance: false, validatedAdvanceTotal: 0, notConverted: true, linkedProspect: true, failures: [] } }); mockApi({ quotes: [accepted], convertError: true }); const user = userEvent.setup(); render(<MemoryRouter initialEntries={['/cotizaciones/quote-1']}><App /></MemoryRouter>); await screen.findByRole('heading', { name: 'COT-2026-001' }); await user.click(screen.getByRole('button', { name: 'Convertir en expediente' })); const dialog = screen.getByRole('dialog'); await user.click(within(dialog).getByRole('button', { name: 'Convertir en expediente' })); expect(await screen.findByRole('alert')).toHaveTextContent('cambió o ya fue convertida');
  });

  it('muestra una sola acción cuando la cotización ya tiene expediente', async () => {
    const converted = quote({ estado: 'ACEPTADA', transiciones_permitidas: [], expediente: { id: 'exp-1', numero_pravia: 'EXP-2026-0001' }, conversion: { eligible: false, accepted: true, approvedVersion: true, validatedAdvance: true, validatedAdvanceTotal: 30000, notConverted: false, linkedProspect: true, failures: ['La cotización ya tiene expediente.'] } });
    mockApi({ quotes: [converted] }); render(<MemoryRouter initialEntries={['/cotizaciones/quote-1']}><App /></MemoryRouter>);
    await screen.findByRole('heading', { name: 'COT-2026-001' });
    expect(screen.getByRole('link', { name: 'Ir al expediente' })).toHaveAttribute('href', '/expedientes/exp-1');
    expect(screen.queryByRole('button', { name: 'Convertir en expediente' })).not.toBeInTheDocument();
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
