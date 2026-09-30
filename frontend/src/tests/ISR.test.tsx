import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../app/App';
import { getAssistantActions, resolveAssistantContext } from '../features/assistant/assistantContext';

const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
const grants = ['mi_dia.read','expedientes.read','isr.read','isr.write','isr.calculate','isr.export','documentos.read','documentos.write','ai.use','ai.isr.read'];
const resources = {
  legal_date: '2026-08-17', references: [], export_profiles: [], rule_sets: [],
  acts: [{ id: 'type-1', name: 'Compraventa de inmueble', description: 'Acto configurado' }],
  catalogs: { countries: [{ code: 'MX', label: 'México' }, { code: 'US', label: 'Estados Unidos' }, { code: 'OTRO', label: 'Otro' }] },
};
function mockSession(permissions = grants) {
  vi.stubGlobal('fetch', vi.fn(async (request: RequestInfo | URL) => {
    const url = String(request);
    if (url.endsWith('/auth/me')) return json({ user: { id: 'u-isr', name: 'Andrea Ruiz', role: 'ADMINISTRACION', permissions } });
    if (url.includes('/notifications')) return json({ data: [] });
    if (url.includes('/isr/resources')) return json({ data: resources });
    return json({ data: [], meta: { total: 0 }, kpis: { total: 0, calculated: 0, pending: 0 } });
  }));
}
const renderAt = (path: string) => render(<MemoryRouter initialEntries={[path]}><App/></MemoryRouter>);

describe('Cálculo ISR v3', () => {
  beforeEach(() => { vi.restoreAllMocks(); localStorage.clear(); mockSession(); });

  it('expone el módulo independiente y el directorio con resultados v3', async () => {
    renderAt('/calculo-isr?fixture=directory');
    expect(await screen.findByRole('heading', { name: 'Cálculo ISR' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Cálculo ISR/ })).toHaveAttribute('href', '/calculo-isr');
    expect(screen.getByText('Total de cálculos')).toBeInTheDocument();
    expect(screen.getByText('ISR-2026-00418')).toBeInTheDocument();
    expect(screen.getByText('$46,659.42')).toBeInTheDocument();
  });

  it('alterna Tarjetas/Lista y persiste la preferencia', async () => {
    const user = userEvent.setup(); renderAt('/calculo-isr?fixture=directory');
    await screen.findByText('ISR-2026-00418'); await user.click(screen.getByRole('button', { name: 'Lista' }));
    expect(screen.getByRole('columnheader', { name: 'Folio' })).toBeInTheDocument();
    expect(localStorage.getItem('pravia-isr-view')).toBe('list');
  });

  it('presenta estados y resultados del directorio con etiquetas humanas v3', async () => {
    renderAt('/calculo-isr?fixture=directory');
    expect(await screen.findByText('Cálculos determinados', { exact: true })).toBeInTheDocument();
    expect(screen.getAllByText('Calculado', { exact: true }).length).toBeGreaterThan(0);
    expect(screen.queryByText('Federal calculado', { exact: true })).not.toBeInTheDocument();
    expect(screen.queryByText(/CALCULADO|LISTO_PARA_CALCULAR|REQUIERE_REVISION/, { exact: true })).not.toBeInTheDocument();
  });

  it('presenta una sola página vertical con los siete bloques contractuales exactos', async () => {
    renderAt('/calculo-isr/fixture?fixture=result');
    await screen.findByRole('heading', { name: 'ISR-2026-00418' });
    expect(Array.from(document.querySelectorAll('section[aria-labelledby^="isr-v3-"] > header h2')).map((heading) => heading.textContent)).toEqual([
      'Acto', 'Inmueble', 'Valores y adquisición', 'IVA', 'Comparecientes / partes', 'Deducciones y variables fiscales adicionales', 'Resultados',
    ]);
    expect(screen.queryByText(/Paso 1/i)).not.toBeInTheDocument();
    expect(screen.queryByText('Configuración fiscal avanzada')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Editar' })).not.toBeInTheDocument();
  });

  it('selecciona Acto desde el catálogo real y conserva fallback explícito Otro', async () => {
    const user = userEvent.setup(); renderAt('/calculo-isr/nuevo?fixture=new');
    const act = await screen.findByRole('combobox', { name: 'Acto' });
    expect(within(act).getByRole('option', { name: 'Compraventa de inmueble' })).toBeInTheDocument();
    await user.selectOptions(act, 'type-1');
    expect(screen.queryByLabelText('Especifique')).not.toBeInTheDocument();
    await user.selectOptions(act, '');
    expect(screen.getByLabelText('Especifique')).toBeInTheDocument();
  });

  it('captura valores de terreno y construcción sin esconder la conciliación total', async () => {
    renderAt('/calculo-isr/fixture?fixture=result');
    expect(await screen.findByLabelText('Valor de enajenación terreno')).toHaveValue('1200000.00');
    expect(screen.getByLabelText('Valor de enajenación construcción')).toHaveValue('800000.00');
    expect(screen.getByLabelText('Valor de operación')).toHaveValue('2000000.00');
    expect(screen.getByLabelText('Fecha fiscal de operación')).toHaveValue('2026-08-17');
  });

  it('mantiene nacionalidad, situación migratoria, residencia fiscal y tipo de sujeto como datos separados', async () => {
    renderAt('/calculo-isr/fixture?fixture=result');
    expect((await screen.findAllByLabelText('Nacionalidad')).length).toBe(2);
    expect(screen.getAllByLabelText('Situación migratoria')).toHaveLength(2);
    expect(screen.getAllByLabelText('Residencia fiscal')).toHaveLength(2);
    expect(screen.getAllByLabelText('Tipo de sujeto')).toHaveLength(2);
    expect(screen.getAllByRole('option', { name: 'Persona moral · Título II' }).length).toBeGreaterThan(0);
  });

  it('expone por enajenante las capas de adquisición y su fuente verificable', async () => {
    renderAt('/calculo-isr/fixture?fixture=result');
    expect(await screen.findByText('Capas de adquisición')).toBeInTheDocument();
    expect(screen.getByLabelText('Acto de adquisición')).toHaveValue('ONEROSA');
    expect(screen.getByLabelText('Costo terreno')).toHaveValue('650000.00');
    expect(screen.getByLabelText('Costo construcción')).toHaveValue('450000.00');
    expect(screen.getByLabelText('Fuente de adquisición')).toHaveValue('Escritura_adquisicion.pdf · cláusula quinta');
  });

  it('muestra opciones fiscales sólo cuando la ruta correspondiente se activa', async () => {
    const user = userEvent.setup(); renderAt('/calculo-isr/fixture?fixture=result');
    const residences = await screen.findAllByLabelText('Residencia fiscal');
    await user.selectOptions(residences[0], 'EXTRANJERO');
    await user.click(screen.getByLabelText('Solicitar opción de cálculo sobre ganancia'));
    expect(screen.getByLabelText('Requisitos de la opción verificados')).toBeInTheDocument();
    await user.click(screen.getByLabelText('Existe excepción legal de ISR por adquisición'));
    expect(screen.getByLabelText('Fundamento legal')).toBeInTheDocument();
    expect(screen.getByLabelText('Excepción verificada')).toBeInTheDocument();
  });

  it('permite confirmar cada requisito de casa habitación sin asumirlo', async () => {
    const user = userEvent.setup(); renderAt('/calculo-isr/fixture?fixture=result');
    await user.selectOptions(await screen.findByLabelText('Tipo de inmueble'), 'CASA_HABITACION');
    await user.click(screen.getByLabelText(/Analizar exención de casa habitación/));
    expect(screen.getByLabelText('Uso como casa habitación verificado')).not.toBeChecked();
    expect(screen.getByLabelText('Documentación comprobatoria verificada')).not.toBeChecked();
    expect(screen.getByLabelText('Sin exención en los tres años anteriores verificado')).not.toBeChecked();
  });

  it('presenta ISR enajenación, adquisición e IVA con etiquetas humanas', async () => {
    renderAt('/calculo-isr/fixture?fixture=result');
    expect(await screen.findByRole('heading', { name: 'ISR enajenación' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'ISR adquisición' })).toBeInTheDocument();
    expect(screen.getAllByText('Gravado').length).toBeGreaterThan(0);
    expect(screen.getByText('No generado')).toBeInTheDocument();
    expect(screen.queryByText('NO_GENERADO')).not.toBeInTheDocument();
    expect(screen.getAllByText('$128,000.00').length).toBeGreaterThan(0);
  });

  it('abre la trazabilidad legal estructurada desde la ayuda del resultado', async () => {
    const user = userEvent.setup(); renderAt('/calculo-isr/fixture?fixture=result');
    await user.click(await screen.findByRole('button', { name: 'Fundamento de ISR enajenación de María Fernanda López Ramírez' }));
    const dialog = screen.getByRole('dialog', { name: 'ISR enajenación de María Fernanda López Ramírez' });
    expect(dialog).toHaveTextContent('LISR artículos 119, 120, 121 y 126');
    expect(dialog).toHaveTextContent('tarifa(ganancia / años) × años = 46659.42');
    expect(dialog).toHaveTextContent('2026.1-DOF-2025-12-28');
  });

  it('conserva documentos y extracción IA como propuestas sujetas a decisión humana', async () => {
    const user = userEvent.setup(); renderAt('/calculo-isr/fixture?fixture=result');
    expect((await screen.findAllByText('Escritura_adquisicion.pdf')).length).toBeGreaterThan(0);
    expect(screen.getByText('Propone; tú confirmas.')).toBeInTheDocument();
    const actions = screen.getAllByRole('button', { name: 'Usar este dato' });
    await user.click(actions[0]);
    expect(screen.getAllByText('Confirmada').length).toBeGreaterThan(0);
  });

  it('genera documento mediante CFG-002 y no ofrece el antiguo PDF paralelo', async () => {
    const user = userEvent.setup(); renderAt('/calculo-isr/fixture?fixture=result');
    await user.click(await screen.findByRole('button', { name: 'Generar documento' }));
    expect(await screen.findByText('Documento de validación preparado con el formato CFG-002 activo.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Generar PDF' })).not.toBeInTheDocument();
  });

  it('conserva historial inmutable y versión normativa del motor v3', async () => {
    renderAt('/calculo-isr/fixture?fixture=history');
    expect(await screen.findByText('Historial inmutable')).toBeInTheDocument();
    expect(screen.getByText('2 versión(es) calculada(s). Recalcular nunca borra resultados ni documentos anteriores.')).toBeInTheDocument();
    expect(screen.getAllByText('ISR-V3.0').length).toBeGreaterThan(0);
    expect(screen.getByText(/reglas 2026.1-DOF-2025-12-28/)).toBeInTheDocument();
  });

  it('bloquea salida con cambios sin guardar', async () => {
    const user = userEvent.setup(); const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false); renderAt('/calculo-isr/fixture?fixture=result');
    const operation = await screen.findByLabelText('Valor de operación'); await user.clear(operation); await user.type(operation, '2100000');
    await user.click(screen.getByRole('button', { name: 'Cancelar' }));
    expect(confirm).toHaveBeenCalled(); expect(screen.getByRole('heading', { name: 'ISR-2026-00418' })).toBeInTheDocument();
  });

  it('oculta navegación y bloquea el directorio sin isr.read', async () => {
    mockSession(['expedientes.read']); renderAt('/calculo-isr?fixture=directory');
    expect(await screen.findByText('No tienes permiso para consultar este módulo.')).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole('link', { name: /Cálculo ISR/ })).not.toBeInTheDocument());
  });

  it('da contexto específico a PRAVIA IA sin acciones fiscales silenciosas', () => {
    const context = resolveAssistantContext({ pathname: '/calculo-isr/fixture', hash: '' });
    expect(context).toMatchObject({ module: 'isr', entityType: 'isrCalculation', entityId: 'fixture' });
    expect(getAssistantActions(context).map((action) => action.label)).toEqual(['¿Qué falta?','Explicar cálculo','Ver fuentes','Deducciones usadas']);
    expect(getAssistantActions(context)[0].prompt).toContain('no modifiques nada');
  });
});
