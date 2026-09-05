import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../app/App';

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const row = { id: 'state-1', expediente_id: 'exp-1', expediente: 'EXP-0042-2026', escritura: null,
  compareciente_principal: { id: 'person-1', nombre: 'María López' }, abogado: { id: 'lawyer-1', nombre: 'Andrea Ruiz' },
  notaria: { id: 'not-1', nombre: 'Notaría 12', numero_notaria: '12' }, actos: [{ id: 'act-1', nombre: 'Compraventa' }, { id: 'act-2', nombre: 'Poder' }],
  cumplimiento: { code: 'PENDIENTE', pending_count: 3 }, aviso: { code: 'PENDIENTE', label: 'Aviso pendiente', count: 2, pending: 1 },
  urgency: 'PENDIENTE', next_deadline: '2026-09-08T00:00:00.000Z', operational_status: 'ENTREGADO', vulnerable: true };
const panel = { rows: [row], metrics: { pendientes: 1, avisos_pendientes: 1, por_vencer: 1, vencidos: 0 }, meta: { page: 1, page_size: 25, total: 1, total_pages: 1 }, filters: {
  lawyers: [{ id: 'lawyer-1', nombre: 'Andrea Ruiz' }], acts: [{ id: 'act-1', nombre: 'Compraventa' }],
  notaries: [{ id: 'not-1', nombre: 'Notaría 12', numero_notaria: '12' }, { id: 'not-2', nombre: 'Notaría 8', numero_notaria: '8' }], show_notaria: true,
} };

function mockApi(data = panel) {
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.endsWith('/auth/me')) return json({ user: { id: 'u1', name: 'Andrea Ruiz', role: 'ADMINISTRACION', permissions: ['compliance.read', 'compliance.write', 'compliance.sensitive.read', 'expedientes.read'] } });
    if (url.includes('/cumplimiento/panel?')) return json({ success: true, data });
    if (url.includes('/cumplimiento/screening/free')) return json({ success: true, data: { human_status: 'Posibles coincidencias', completed_at: '2026-09-05T12:00:00.000Z', sourceExecutions: [{ id: 'source-execution', execution_state: 'SUCCEEDED', source: { display_name: 'Lista oficial' }, sourceVersion: { version: '2026-09' } }], candidates: [{ id: 'candidate', display_name: 'Nombre similar', score: '0.74' }], request: init?.body } }, 201);
    return json({ success: true });
  }));
}
const renderPanel = (path = '/cumplimiento') => render(<MemoryRouter initialEntries={[path]}><App /></MemoryRouter>);

describe('H8 CUM-001 central panel', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('exposes the global route and sidebar entry through existing permissions', async () => {
    mockApi(); renderPanel();
    expect(await screen.findByRole('heading', { name: 'CUMPLIMIENTO' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Cumplimiento' })).toHaveAttribute('href', '/cumplimiento');
  });

  it('makes each KPI apply the corresponding server-side filter', async () => {
    mockApi(); const user = userEvent.setup(); renderPanel();
    await screen.findByText('EXP-0042-2026');
    await user.click(screen.getByRole('button', { name: /Avisos pendientes 1/ }));
    await waitFor(() => expect(vi.mocked(fetch).mock.calls.some(([url]) => String(url).includes('filter=AVISOS_PENDIENTES'))).toBe(true));
  });

  it('renders one compact row with canonical people, lawyer, multi-act, H7 and AVI summaries', async () => {
    mockApi(); renderPanel();
    const item = await screen.findByRole('listitem');
    expect(within(item).getByText('María López')).toBeInTheDocument();
    expect(within(item).getByText('Andrea Ruiz')).toBeInTheDocument();
    expect(within(item).getByText('Compraventa +1 más')).toBeInTheDocument();
    expect(within(item).getAllByText('Pendiente')).toHaveLength(2);
    expect(within(item).getByText('Actividad vulnerable')).toBeInTheDocument();
    expect(within(item).getByText('3 pendientes')).toBeInTheDocument();
    expect(within(item).getByText('Aviso pendiente')).toBeInTheDocument();
    expect(item).toHaveAttribute('href', '/expedientes/exp-1#cumplimiento');
  });

  it('keeps prefirma and delivered cases visible without inventing an escritura', async () => {
    mockApi(); renderPanel();
    await screen.findByText('EXP-0042-2026');
    expect(screen.getByText('Pendiente', { selector: 'strong' })).toBeInTheDocument();
  });

  it('sends expediente/escritura/compareciente search and secondary filters to backend', async () => {
    mockApi(); renderPanel(); const user = userEvent.setup();
    const search = await screen.findByPlaceholderText('Expediente, escritura o compareciente…');
    await user.type(search, 'Maria');
    await user.click(screen.getByText('Más filtros'));
    await user.selectOptions(screen.getByLabelText('Abogado responsable'), 'lawyer-1');
    await user.selectOptions(screen.getByLabelText('Acto'), 'act-1');
    fireEvent.change(screen.getByLabelText('Desde'), { target: { value: '2026-09-01' } });
    await waitFor(() => {
      const urls = vi.mocked(fetch).mock.calls.map(([url]) => String(url));
      expect(urls.some((url) => url.includes('search=Maria'))).toBe(true);
      expect(urls.some((url) => url.includes('lawyer_id=lawyer-1'))).toBe(true);
      expect(urls.some((url) => url.includes('act_id=act-1'))).toBe(true);
      expect(urls.some((url) => url.includes('from=2026-09-01'))).toBe(true);
    });
  });

  it('shows Notaría only when the accessible scope is genuinely multi-notary', async () => {
    mockApi(); renderPanel(); await screen.findByText('EXP-0042-2026');
    fireEvent.click(screen.getByText('Más filtros'));
    expect(screen.getByLabelText('Notaría')).toBeInTheDocument();
    vi.restoreAllMocks(); mockApi({ ...panel, filters: { ...panel.filters, notaries: panel.filters.notaries.slice(0, 1), show_notaria: false } });
    const second = renderPanel(); await screen.findAllByText('EXP-0042-2026');
    const details = second.container.querySelectorAll('details'); fireEvent.click(details[details.length - 1].querySelector('summary')!);
    expect(second.container.querySelector('select[aria-label="Notaría"]')).toBeNull();
  });

  it('reuses free H3 lookup for PF/PM and marks approximate results for human review', async () => {
    mockApi(); const user = userEvent.setup(); renderPanel();
    await user.click(await screen.findByRole('button', { name: 'Consultar listas' }));
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText(/no crea comparecientes ni expedientes/i)).toBeInTheDocument();
    await user.selectOptions(within(dialog).getByLabelText('Tipo de persona'), 'MORAL');
    await user.type(within(dialog).getByLabelText('Nombre o razón social'), 'Empresa Ejemplo');
    await user.click(within(dialog).getByRole('button', { name: 'Consultar' }));
    expect(await within(dialog).findByText('Lista oficial')).toBeInTheDocument();
    expect(within(dialog).getByText(/Coincidencia aproximada · requiere revisión humana/)).toBeInTheDocument();
    const call = vi.mocked(fetch).mock.calls.find(([url]) => String(url).includes('/screening/free'));
    expect(String(call?.[1]?.body)).toContain('"tipo_persona":"MORAL"');
  });

  it('distinguishes global empty state from filtered empty state', async () => {
    mockApi({ ...panel, rows: [], meta: { ...panel.meta, total: 0 } });
    const first = renderPanel(); expect(await screen.findByText('No hay casos de Cumplimiento')).toBeInTheDocument(); first.unmount();
    renderPanel('/cumplimiento?filter=VENCIDOS'); expect(await screen.findByText('No hay resultados con estos filtros')).toBeInTheDocument();
  });
});
