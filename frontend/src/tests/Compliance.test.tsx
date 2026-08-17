import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../app/App';
import { getAssistantActions, resolveAssistantContext } from '../features/assistant/assistantContext';
import { fixtureComplianceDetail, fixtureComplianceDirectory } from '../features/compliance/compliance.fixtures';

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const permissions = ['compliance.read', 'compliance.write', 'compliance.review', 'compliance.rules.read', 'compliance.notice.prepare', 'compliance.sensitive.read', 'expedientes.read', 'documentos.read', 'ai.use', 'ai.cumplimiento.read'];
const catalogs = { reglas: [{ id: 'rule-1', tipo: 'UIF', nombre: 'Fe pública notarial', version: '2026.1' }], expedientes: [{ id: 'fixture-exp-141', numero_pravia: 'EXP-2026-0141', cliente_alias: 'María Fernanda López', tipo_acto: { nombre: 'Compraventa' }, notaria: { id: 'not-12', numero_notaria: '12' } }], usuarios: [{ id: 'u1', nombre: 'Andrea', apellido: 'Ruiz' }], documentos: [] };

function mockApi(options: { empty?: boolean; fail?: boolean; permissions?: string[]; redacted?: boolean } = {}) {
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.endsWith('/auth/me')) return json({ user: { id: 'u1', name: 'Andrea Ruiz', role: 'ADMINISTRACION', permissions: options.permissions ?? permissions } });
    if (url.includes('/cumplimiento/catalogos')) return json({ success: true, ...catalogs });
    if (/\/cumplimiento\/revisiones\/fixture-uif$/.test(url)) {
      if (options.fail) return json({ error: 'No disponible' }, 500);
      const detail = options.redacted ? { ...fixtureComplianceDetail, workspace: { ...fixtureComplianceDetail.workspace!, parties: [], beneficialOwners: [], pepReviews: [], screenings: [], aiProposals: [], sensitiveRedacted: true } } : fixtureComplianceDetail;
      return json({ success: true, ...detail });
    }
    if (url.includes('/cumplimiento/revisiones?')) {
      if (options.fail) return json({ error: 'No disponible' }, 500);
      return json({ success: true, ...(options.empty ? { ...fixtureComplianceDirectory, revisiones: [], meta: { ...fixtureComplianceDirectory.meta, total: 0 } } : fixtureComplianceDirectory) });
    }
    return json({ success: true });
  }));
}
const renderAt = (path: string) => render(<MemoryRouter initialEntries={[path]}><App/></MemoryRouter>);

describe('Riesgos / UIF canónico', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('muestra los cuatro KPI y filtros jurídicos del directorio', async () => {
    mockApi(); renderAt('/riesgos?actividad=TRANSMISION_DERECHOS_REALES_INMUEBLES');
    expect(await screen.findByRole('heading', { name: 'Riesgos / UIF' })).toBeInTheDocument();
    await screen.findAllByText('EXP-2026-0141');
    for (const label of ['Expedientes evaluados', 'Requieren revisión', 'Avisos por presentar', 'Obligaciones vencidas']) expect(screen.getByText(label)).toBeInTheDocument();
    expect(screen.getByLabelText('Actividad vulnerable')).toHaveValue('TRANSMISION_DERECHOS_REALES_INMUEBLES');
    await waitFor(() => expect(vi.mocked(fetch).mock.calls.some(([url]) => String(url).includes('actividad=TRANSMISION'))).toBe(true));
  });

  it('presenta tarjetas y cambia a lista sin mezclar ISR', async () => {
    mockApi(); const user = userEvent.setup(); renderAt('/riesgos');
    expect((await screen.findAllByText('EXP-2026-0141')).length).toBeGreaterThan(0);
    await user.click(screen.getByRole('button', { name: 'Lista' }));
    expect(screen.getByRole('columnheader', { name: 'Actividad vulnerable' })).toBeInTheDocument();
    expect(screen.queryByText('Cálculo ISR')).not.toBeInTheDocument();
  });

  it('abre un workspace único con las diez secciones trazables', async () => {
    mockApi(); renderAt('/riesgos/revisiones/fixture-uif');
    expect(await screen.findByRole('heading', { name: 'EXP-2026-0141' })).toBeInTheDocument();
    for (const title of ['Operación y snapshot', 'Actividad vulnerable', 'Personas y comparecientes', 'Beneficiario controlador', 'PEP y listas', 'Formas de pago y restricción de efectivo', 'Evaluación interna de riesgo', 'Obligaciones y Avisos', 'Evidencia y conservación', 'Historial, versiones e integraciones']) expect(screen.getByRole('heading', { name: title })).toBeInTheDocument();
  });

  it('separa Aviso, restricción de efectivo y riesgo interno', async () => {
    mockApi(); renderAt('/riesgos/revisiones/fixture-uif'); await screen.findByText('Actividad vulnerable identificada');
    expect(screen.getAllByText('Requiere Aviso').length).toBeGreaterThan(0);
    expect(screen.getByText(/Umbral independiente: 8,025 UMA/)).toBeInTheDocument();
    expect(screen.getByText(/no constituye una probabilidad de ilicitud/i)).toBeInTheDocument();
  });

  it('no simula PEP y conserva la compuerta humana', async () => {
    mockApi(); renderAt('/riesgos/revisiones/fixture-uif');
    expect((await screen.findAllByText('Consulta oficial PEP no configurada')).length).toBeGreaterThan(0);
    expect(screen.getByText(/La coincidencia textual no genera por sí sola un Aviso de 24 horas/)).toBeInTheDocument();
    expect(screen.getAllByText('PROPUESTA — REQUIERE CONFIRMACIÓN HUMANA.').length).toBeGreaterThan(0);
  });

  it('abre evidencia en el visor compartido sin Storage paralelo', async () => {
    mockApi(); const user = userEvent.setup(); renderAt('/riesgos/revisiones/fixture-uif');
    const evidence = await screen.findByRole('button', { name: /identificacion-maria.pdf/i }); await user.click(evidence);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(within(screen.getByRole('dialog')).getByText('identificacion-maria.pdf')).toBeInTheDocument();
  });

  it('respeta permisos de escritura y datos sensibles', async () => {
    mockApi({ permissions: ['compliance.read'], redacted: true }); renderAt('/riesgos/revisiones/fixture-uif');
    expect((await screen.findAllByText(/no estos datos sensibles/i)).length).toBeGreaterThanOrEqual(2);
    expect(screen.queryByRole('button', { name: 'Reevaluar' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Registrar presentación externa' })).not.toBeInTheDocument();
  });

  it('muestra empty y error sin filtrar detalles técnicos', async () => {
    mockApi({ empty: true }); const first = renderAt('/riesgos'); expect(await screen.findByText('No hay evaluaciones con estos filtros')).toBeInTheDocument(); first.unmount();
    mockApi({ fail: true }); renderAt('/riesgos'); expect(await screen.findByText('No pudimos cargar Riesgos / UIF.')).toBeInTheDocument(); expect(screen.queryByText(/Prisma|stack|endpoint/i)).not.toBeInTheDocument();
  });

  it('expone contexto PRAVIA IA por revisión real', () => {
    const context = resolveAssistantContext({ pathname: '/riesgos/revisiones/fixture-uif', hash: '' });
    expect(context).toMatchObject({ module: 'compliance', entityType: 'complianceReview', entityId: 'fixture-uif' });
    expect(getAssistantActions(context).map((item) => item.label)).toContain('¿Por qué esta alerta?');
  });
});
