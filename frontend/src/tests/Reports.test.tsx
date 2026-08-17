import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../app/App';
import { getAssistantActions, resolveAssistantContext } from '../features/assistant/assistantContext';

const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
const grants = ['reportes.read', 'reportes.global.read', 'reportes.financial.read', 'reportes.targets.manage', 'expedientes.read', 'ai.use', 'ai.reportes.read'];
const period = { key: 'ESTE_MES', label: '1 ago – 31 ago 2026', from: '2026-08-01', to: '2026-08-31', timezone: 'America/Mexico_City' };
const scope = { mode: 'GLOBAL', financial: true };
const financial = { honorarios_generados: 850_000, honorarios_cobrados: 620_000, honorarios_por_cobrar: 230_000, ingresos_recibidos: 1_300_000, fondos_terceros: 650_000, otros_destinos: 30_000, fondos_terceros_pendientes: 410_000, egresos: 220_000 };
const goal = { meta: 1_000_000, actual: 620_000, pendiente: 380_000, cumplimiento: 62, base: 'COBRADOS' };
const summary = { period, scope, financial, goal, operations: { firmas_realizadas: 18, firmas_restantes_semana: 5, honorarios_programados_semana: 280_000, presupuestos_solicitados: 34, importe_cotizado: 1_220_000, presupuestos_aceptados: 22, clientes_generados: 17 }, definitions: { programado: 'Honorarios programados hasta el domingo.', clientes: 'Cotizaciones aceptadas.' } };
const comparison = { id: 'u1', nombre: 'Andrea Ruiz', generated: 400_000, collected: 300_000, pending: 100_000, expedientes: 4, porcentaje_cobrado: 75 };
const finance = { period, scope, financial, goal, tendency: [{ periodo: '2026-03', generados: 500_000, cobrados: 400_000 }, { periodo: '2026-04', generados: 650_000, cobrados: 530_000 }, { periodo: '2026-05', generados: 720_000, cobrados: 580_000 }, { periodo: '2026-06', generados: 800_000, cobrados: 600_000 }, { periodo: '2026-07', generados: 780_000, cobrados: 610_000 }, { periodo: '2026-08', generados: 850_000, cobrados: 620_000 }], byLawyer: [comparison], byNotaria: [{ ...comparison, id: 'n1', nombre: 'Notaría 12' }] };
const collectionRow = { id: 'fee1', expediente_id: 'exp1', expediente: 'EXP-2026-0141', cliente: 'Inmobiliaria del Valle', abogado: 'Andrea Ruiz', notaria: 'Notaría 12', generated: 100_000, collected: 40_000, pending: 60_000, due: '2026-08-20', overdue: true, link: '/expedientes/exp1' };
const collections = { period, scope, totals: { generated: 850_000, collected: 620_000, pending: 230_000, overdue: 60_000 }, byLawyer: [comparison], byNotaria: [{ ...comparison, id: 'n1', nombre: 'Notaría 12' }], rows: [collectionRow] };
const lawyerRow = { id: 'u1', nombre: 'Andrea Ruiz', expedientes_periodo: 7, honorarios_generados: 350_000, honorarios_cobrados: 300_000, firmas_semana: 2, firmas_mes: 5, firmas_proximo_mes: 4, firmas_realizadas_semana_anterior: 3, honorarios_semana: 80_000, honorarios_mes: 350_000, goal: { meta: 500_000, actual: 350_000, pendiente: 150_000, cumplimiento: 70, base: 'GENERADOS' } };
const lawyers = { period, scope, rows: [lawyerRow, { ...lawyerRow, id: 'u2', nombre: 'Luis Paz', honorarios_generados: 100_000, goal: null }] };
const signatures = { period, scope, metrics: { realizadas_periodo: 18, realizadas_semana_anterior: 4, programadas_semana: 5, programadas_mes: 20, programadas_proximo_mes: 6, atrasadas_sin_confirmar: 2, honorarios_realizados_periodo: 850_000, honorarios_programados_semana: 280_000, honorarios_programados_mes: 720_000 }, definitions: { programada: 'Cuenta fecha estimada futura sin firma real.', realizada: 'Cuenta fecha real confirmada.' }, rows: [{ id: 'exp1', numero_pravia: 'EXP-2026-0141', cliente_alias: 'Inmobiliaria del Valle', fecha_estimada_firma: '2026-08-20', fecha_real_firma: null, honorarios: 100_000, abogado: 'Andrea Ruiz', estado: 'PROGRAMADA', link: '/expedientes/exp1' }, { id: 'exp2', numero_pravia: 'EXP-2026-0100', cliente_alias: 'Cliente firmado', fecha_estimada_firma: '2026-08-10', fecha_real_firma: '2026-08-10', honorarios: 80_000, abogado: 'Andrea Ruiz', estado: 'REALIZADA', link: '/expedientes/exp2' }, { id: 'exp3', numero_pravia: 'EXP-2026-0090', cliente_alias: 'Cliente atrasado', fecha_estimada_firma: '2026-08-01', fecha_real_firma: null, honorarios: 50_000, abogado: 'Luis Paz', estado: 'ATRASADA_SIN_CONFIRMAR', link: '/expedientes/exp3' }] };
const eighty = { period, scope, definition: 'Las 20 operaciones con mayor importe aplicado al despacho.', source: 'MovimientoFinanciero aplicado → MovimientoDistribucion de naturaleza DESPACHO → expediente.', limit: 20, rows: [{ id: 'exp1', expediente: 'EXP-2026-0141', cliente: 'Inmobiliaria del Valle', honorarios: 100_000, importe_computable: 80_000, cobrado_honorarios_acumulado: 80_000, pending: 20_000, fecha_firma: '2026-08-28', notaria: 'Notaría 12', abogado: 'Andrea Ruiz', status: 'EN_PROCESO', link: '/expedientes/exp1' }, { id: 'exp2', expediente: 'EXP-2026-0100', cliente: 'Corporativo Horizonte', honorarios: 900_000, importe_computable: 50_000, cobrado_honorarios_acumulado: 50_000, pending: 850_000, fecha_firma: null, notaria: 'Notaría 18', abogado: 'Luis Paz', status: 'ABIERTO', link: '/expedientes/exp2' }] };
const potential = { period, scope, definition: 'Cotizaciones vigentes no aceptadas; no se suman a honorarios generados.', metrics: { total: 42, honorarios: 2_400_000 }, meta: { page: 1, pageSize: 20, total: 42, totalPages: 3 }, rows: [{ id: 'q1', cliente: 'Corporativo Horizonte', honorarios: 92_000, notaria: 'Notaría 18', responsable: 'Andrea Ruiz', acto: 'Compraventa', fecha_cotizacion: '2026-07-20', link: '/cotizaciones/q1' }] };
const catalogs = { usuarios: [{ id: 'u1', nombre: 'Andrea', apellido: 'Ruiz', rol: 'ADMINISTRACION' }], notarias: [{ id: 'n1', nombre: 'Notaría 12', numero_notaria: 12 }], scope: { global: true, financial: true, targetsManage: true } };

function mockApi(options: { permissions?: string[]; fail?: string; empty?: boolean; defaultView?: 'CARDS' | 'LIST' } = {}) {
  const permissions = options.permissions ?? grants;
  const financialAllowed = permissions.includes('reportes.financial.read');
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.endsWith('/auth/me')) return json({ user: { id: 'u1', name: 'Andrea Ruiz', role: 'ADMINISTRACION', permissions } });
    if (url.endsWith('/settings/preferences') && init?.method === 'PATCH') return json({ preferences: { default_view: JSON.parse(String(init.body)).default_view } });
    if (url.endsWith('/settings/preferences')) return json({ preferences: { default_view: options.defaultView || 'LIST', density: 'COMFORTABLE', timezone: 'America/Mexico_City', date_format: 'DD/MM/YYYY', theme: 'LIGHT', notifications_enabled: true, assistant_suggestions_enabled: true } });
    if (url.includes('/reportes/catalogos')) return json({ success: true, data: { ...catalogs, scope: { global: permissions.includes('reportes.global.read'), financial: financialAllowed, targetsManage: permissions.includes('reportes.targets.manage') } } });
    if (url.includes(`/reportes/${options.fail}`)) return json({ error: 'No disponible' }, 500);
    if (url.includes('/reportes/resumen')) return json({ success: true, data: { ...summary, financial: financialAllowed ? financial : null, operations: financialAllowed ? summary.operations : { ...summary.operations, honorarios_programados_semana: null, importe_cotizado: null }, scope: { ...scope, financial: financialAllowed } } });
    if (url.includes('/reportes/finanzas')) return json({ success: true, data: financialAllowed ? finance : { period, scope: { ...scope, financial: false }, restricted: true } });
    if (url.includes('/reportes/cobranza')) return json({ success: true, data: financialAllowed ? { ...collections, rows: options.empty ? [] : collections.rows, byLawyer: options.empty ? [] : collections.byLawyer, byNotaria: options.empty ? [] : collections.byNotaria } : { period, scope: { ...scope, financial: false }, restricted: true } });
    if (url.includes('/reportes/abogados')) return json({ success: true, data: { ...lawyers, rows: options.empty ? [] : lawyers.rows } });
    if (url.includes('/reportes/firmas')) return json({ success: true, data: { ...signatures, rows: options.empty ? [] : signatures.rows } });
    if (url.includes('/reportes/80-20')) return json({ success: true, data: financialAllowed ? { ...eighty, rows: options.empty ? [] : eighty.rows } : { period, scope: { ...scope, financial: false }, restricted: true } });
    if (url.includes('/reportes/clientes-potenciales')) return json({ success: true, data: financialAllowed ? { ...potential, rows: options.empty ? [] : potential.rows } : { period, scope: { ...scope, financial: false }, restricted: true, definition: 'Acceso financiero requerido.', rows: [] } });
    if (url.includes('/reportes/metas')) return json({ success: true, data: { id: 'meta-1' } });
    return json({ success: true, data: {} });
  }));
}

const renderReports = (path = '/reportes') => render(<MemoryRouter initialEntries={[path]}><App /></MemoryRouter>);

describe('Reportes', () => {
  beforeEach(() => { vi.restoreAllMocks(); window.localStorage.clear(); });

  it('presenta resumen ejecutivo trazable, visualizaciones accesibles y drill-down', async () => {
    mockApi();
    const user = userEvent.setup();
    renderReports();
    expect(await screen.findByRole('heading', { name: 'Reportes' })).toBeInTheDocument();
    expect(await screen.findByText('Honorarios generados')).toBeInTheDocument();
    expect(screen.getByText('Honorarios cobrados')).toBeInTheDocument();
    expect(screen.getByText('Por cobrar')).toBeInTheDocument();
    expect(screen.getByRole('note', { name: /Definición de clientes generados: Cotizaciones aceptadas/ })).toBeInTheDocument();
    expect(screen.getByRole('img', { name: /Tendencia mensual/ })).toBeInTheDocument();
    expect(screen.getByRole('img', { name: /Top cinco abogados/ })).toBeInTheDocument();
    expect(screen.getByRole('img', { name: /Top cinco notarías/ })).toBeInTheDocument();
    expect(screen.getByRole('table', { name: /Top cinco abogados/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Configurar meta' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Honorarios generados/ }));
    expect(await screen.findByRole('heading', { name: 'Evolución financiera' })).toBeInTheDocument();
  });

  it('incluye Esta semana y envía el periodo al backend', async () => {
    mockApi();
    const user = userEvent.setup();
    renderReports();
    await screen.findByText('Honorarios generados');
    expect(screen.getByRole('option', { name: 'Esta semana' })).toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText('Periodo del reporte'), 'ESTA_SEMANA');
    await waitFor(() => expect(vi.mocked(fetch).mock.calls.some(([url]) => String(url).includes('periodo=ESTA_SEMANA'))).toBe(true));
  });

  it('mantiene periodo y filtros de alcance en todas las vistas', async () => {
    mockApi();
    const user = userEvent.setup();
    renderReports();
    await screen.findByText('Honorarios generados');
    await user.selectOptions(screen.getByLabelText('Periodo del reporte'), 'ESTE_TRIMESTRE');
    await user.selectOptions(screen.getByLabelText('Filtrar por abogado'), 'u1');
    await waitFor(() => expect(vi.mocked(fetch).mock.calls.some(([url]) => String(url).includes('periodo=ESTE_TRIMESTRE') && String(url).includes('abogado_id=u1'))).toBe(true));
    await user.click(screen.getByRole('button', { name: 'Cobranza' }));
    expect(await screen.findByRole('heading', { name: 'Cobranza por abogado' })).toBeInTheDocument();
    expect(screen.getByLabelText('Periodo del reporte')).toHaveValue('ESTE_TRIMESTRE');
  });

  it('Finanzas muestra comparativos por abogado, notaría, evolución y meta', async () => {
    mockApi();
    renderReports('/reportes?view=finanzas');
    expect(await screen.findByRole('heading', { name: 'Evolución financiera' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Honorarios por abogado' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Honorarios por notaría' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Progreso de meta' })).toBeInTheDocument();
    expect(screen.getByText('62.0%')).toBeInTheDocument();
  });

  it('Cobranza separa reconocido, aplicado, pendiente y vencido válido', async () => {
    mockApi();
    renderReports('/reportes?view=cobranza');
    expect(await screen.findByText('Cobrado y aplicado')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Cobranza por abogado' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Cobranza por notaría' })).toBeInTheDocument();
    const row = screen.getByRole('link', { name: 'EXP-2026-0141' }).closest('tr');
    expect(row && within(row).getByText('Vencido')).toBeInTheDocument();
  });

  it('Abogados alterna Lista/Tarjetas, persiste preferencia y aloja metas sólo aquí', async () => {
    mockApi({ defaultView: 'LIST' });
    const user = userEvent.setup();
    renderReports('/reportes?view=abogados');
    expect(await screen.findByRole('heading', { name: 'Operación por abogado' })).toBeInTheDocument();
    expect(screen.getByText('Sin meta configurada')).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Honorarios semana' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Honorarios mes' })).toBeInTheDocument();
    expect(screen.getByText('Falta 30.0%')).toBeInTheDocument();
    expect(screen.getByText('Faltan $150,000')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Configurar meta' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Tarjetas' }));
    expect(await screen.findByLabelText('Tarjetas de desempeño por abogado')).toBeInTheDocument();
    expect(screen.getAllByText('Honorarios esta semana').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Honorarios este mes').length).toBeGreaterThan(0);
    await waitFor(() => expect(vi.mocked(fetch).mock.calls.some(([url, init]) => String(url).endsWith('/settings/preferences') && init?.method === 'PATCH' && String(init.body).includes('CARDS'))).toBe(true));
  });

  it('Firmas no convierte una fecha estimada pasada en realizada', async () => {
    mockApi();
    renderReports('/reportes?view=firmas');
    expect(await screen.findByText('Programadas esta semana')).toBeInTheDocument();
    expect(screen.getByText('Atrasadas sin confirmar')).toBeInTheDocument();
    expect(screen.getByText('Atrasada sin confirmar')).toBeInTheDocument();
    expect(screen.getByText('Realizada')).toBeInTheDocument();
    expect(screen.getAllByText(/fecha real confirmada/i).length).toBeGreaterThan(0);
  });

  it('80/20 presenta el top económico ordenado, limitado y trazable', async () => {
    mockApi();
    renderReports('/reportes?view=80-20');
    expect(await screen.findByRole('heading', { name: 'Top 20 por importe computable 80/20' })).toBeInTheDocument();
    expect(screen.getByText('Importe computable 80/20')).toBeInTheDocument();
    expect(screen.getByText(/MovimientoFinanciero aplicado/)).toBeInTheDocument();
    const links = screen.getAllByRole('link').filter((link) => link.textContent?.startsWith('EXP-2026'));
    expect(links.map((link) => link.textContent)).toEqual(['EXP-2026-0141', 'EXP-2026-0100']);
    expect(screen.getByText('Máximo 20')).toBeInTheDocument();
  });

  it('Clientes potenciales etiqueta importes como potenciales y no generados', async () => {
    mockApi();
    const user = userEvent.setup();
    renderReports('/reportes?view=clientes-potenciales');
    expect(await screen.findByRole('heading', { name: 'Cotizaciones activas no aceptadas' })).toBeInTheDocument();
    expect(screen.getByText('No son honorarios generados')).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Fecha de cotización' })).toBeInTheDocument();
    expect(screen.queryByText('Prioridad alta')).not.toBeInTheDocument();
    expect(screen.queryByText('Más de 14 días')).not.toBeInTheDocument();
    expect(screen.queryByRole('columnheader', { name: 'Prioridad' })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Corporativo Horizonte' })).toHaveAttribute('href', '/cotizaciones/q1');
    expect(screen.getByText('Página 1 de 3 · 42 resultados')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Siguiente' }));
    await waitFor(() => expect(vi.mocked(fetch).mock.calls.some(([url]) => String(url).includes('/reportes/clientes-potenciales') && String(url).includes('page=2'))).toBe(true));
  });

  it('degrada un widget sin perder el resumen completo', async () => {
    mockApi({ fail: 'cobranza' });
    renderReports();
    expect(await screen.findByText('Honorarios generados')).toBeInTheDocument();
    expect(screen.getByText(/Algunos indicadores no pudieron actualizarse/)).toBeInTheDocument();
    expect(screen.getByText('No fue posible actualizar este bloque.')).toBeInTheDocument();
  });

  it('respeta lectura y confidencialidad financiera por rol', async () => {
    mockApi({ permissions: ['reportes.read'] });
    renderReports('/reportes?view=finanzas');
    expect(await screen.findByText('Vista financiera restringida')).toBeInTheDocument();
    expect(screen.queryByLabelText('Alcance del reporte')).not.toBeInTheDocument();
  });

  it('no presenta importes indirectos en resumen ni oportunidades sin permiso financiero', async () => {
    mockApi({ permissions: ['reportes.read', 'expedientes.read', 'agenda.read'] });
    const first = renderReports();
    expect(await screen.findByText('Firmas y cotizaciones')).toBeInTheDocument();
    expect(screen.getAllByText(/Sin acceso/).length).toBeGreaterThanOrEqual(2);
    first.unmount();
    mockApi({ permissions: ['reportes.read', 'expedientes.read', 'agenda.read'] });
    renderReports('/reportes?view=clientes-potenciales');
    expect(await screen.findByText('Vista financiera restringida')).toBeInTheDocument();
  });

  it('oculta el módulo sin permiso y ofrece empty state humano', async () => {
    mockApi({ permissions: ['expedientes.read'] });
    const first = renderReports();
    expect(await screen.findByText('Acceso a reportes restringido')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Reportes' })).not.toBeInTheDocument();
    first.unmount();
    mockApi({ empty: true });
    renderReports('/reportes?view=clientes-potenciales');
    expect(await screen.findByText('Sin cotizaciones potenciales')).toBeInTheDocument();
  });

  it('expone acciones de IA específicas de reportes', () => {
    const context = resolveAssistantContext({ pathname: '/reportes', hash: '' });
    expect(getAssistantActions(context).map((action) => action.label)).toEqual(['Resumen ejecutivo', 'Analizar cobranza', 'Analizar firmas', 'Clientes potenciales']);
  });
});
