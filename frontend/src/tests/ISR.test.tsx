import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../app/App';
import { getAssistantActions, resolveAssistantContext } from '../features/assistant/assistantContext';

const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
const grants = ['mi_dia.read','expedientes.read','isr.read','isr.write','isr.calculate','documentos.read','documentos.write','ai.use','ai.isr.read'];
function mockSession(permissions = grants) {
  vi.stubGlobal('fetch', vi.fn(async (request: RequestInfo | URL) => {
    const url = String(request);
    if (url.endsWith('/auth/me')) return json({ user: { id: 'u-isr', name: 'Andrea Ruiz', role: 'ADMINISTRACION', permissions } });
    if (url.includes('/notifications')) return json({ data: [] });
    return json({ data: [], meta: { total: 0 }, kpis: { total: 0, calculated: 0, pending: 0 } });
  }));
}
const renderAt = (path: string) => render(<MemoryRouter initialEntries={[path]}><App/></MemoryRouter>);

describe('Cálculo ISR', () => {
  beforeEach(()=>{vi.restoreAllMocks();localStorage.clear();mockSession();});

  it('expone un módulo independiente, KPIs útiles y directorio en tarjetas', async () => {
    renderAt('/calculo-isr?fixture=directory');
    expect(await screen.findByRole('heading',{name:'Cálculo ISR'})).toBeInTheDocument();
    expect(screen.getByRole('link',{name:/Cálculo ISR/})).toHaveAttribute('href','/calculo-isr');
    expect(screen.getByText('Total de cálculos')).toBeInTheDocument();
    expect(screen.getByText('Federales calculados')).toBeInTheDocument();
    expect(screen.getByText('Pendientes de información')).toBeInTheDocument();
    expect(screen.getByText('ISR-2026-00418')).toBeInTheDocument();
    expect(screen.getAllByText('Federal calculado').length).toBeGreaterThan(0);
  });

  it('alterna Tarjetas/Lista y persiste la preferencia', async () => {
    const user=userEvent.setup();renderAt('/calculo-isr?fixture=directory');
    await screen.findByText('ISR-2026-00418'); await user.click(screen.getByRole('button',{name:'Lista'}));
    expect(screen.getByRole('columnheader',{name:'Folio'})).toBeInTheDocument();
    expect(localStorage.getItem('pravia-isr-view')).toBe('list');
  });

  it('abre una sola ficha completa directamente, sin wizard ni botón Editar', async () => {
    renderAt('/calculo-isr/nuevo?fixture=new');
    expect(await screen.findByRole('heading',{name:'Nuevo cálculo ISR'})).toBeInTheDocument();
    expect(screen.getByRole('heading',{name:'Contribuyente'})).toBeInTheDocument();
    expect(screen.getByRole('heading',{name:'Inmueble y operación'})).toBeInTheDocument();
    expect(screen.getByRole('heading',{name:'Deducciones'})).toBeInTheDocument();
    expect(screen.queryByText(/Paso 1/i)).not.toBeInTheDocument();
    expect(screen.queryByRole('button',{name:'Editar'})).not.toBeInTheDocument();
  });

  it('presenta documentos seguros y extracción IA como propuestas humanas', async () => {
    const user=userEvent.setup();renderAt('/calculo-isr/fixture?fixture=extraction-after');
    expect((await screen.findAllByText('Escritura_adquisicion.pdf')).length).toBeGreaterThan(0);
    expect(screen.getByText('Propone; tú confirmas.')).toBeInTheDocument();
    expect(screen.getAllByText(/Fuente: Escritura_adquisicion.pdf/).length).toBeGreaterThan(0);
    expect(screen.getByText('Se encontraron valores distintos')).toBeInTheDocument();
    const actions=screen.getAllByRole('button',{name:/Usar este dato/});expect(actions.length).toBeGreaterThan(0);await user.click(actions[0]);
    expect(screen.getAllByText('Confirmada').length).toBeGreaterThan(0);
  });

  it('muestra resultado, desglose reproducible y advertencia de no acuse SAT', async () => {
    renderAt('/calculo-isr/fixture?fixture=breakdown');
    expect((await screen.findAllByText('ISR provisional federal')).length).toBeGreaterThan(0);
    expect(screen.getAllByText('$46,659.42').length).toBeGreaterThan(0);
    expect(screen.getByText('Ganancia determinada')).toBeInTheDocument();
    expect(screen.getByText(/no es una declaración ni un acuse SAT/i)).toBeInTheDocument();
    expect(screen.getAllByText('2026.1-DOF-2025-12-28').length).toBeGreaterThan(0);
  });

  it('distingue el federal calculado de la determinación fiscal completa', async () => {
    renderAt('/calculo-isr/fixture?fixture=federal-result');
    expect(await screen.findByText('Resultado federal')).toBeInTheDocument();
    expect(screen.getAllByText('Federal calculado').length).toBeGreaterThan(0);
    expect(screen.getByText(/no incluye el pago a la entidad federativa previsto en el artículo 127/i)).toBeInTheDocument();
    expect(screen.queryByText(/ISR total/i)).not.toBeInTheDocument();
  });

  it('presenta la procedencia estructurada de cada deducción manual actualizada', async () => {
    renderAt('/calculo-isr/fixture?fixture=deduction-origin');
    expect((await screen.findAllByText('Origen de la actualización')).length).toBe(2);
    expect(screen.getAllByText('Importe histórico (MXN)').length).toBe(2);
    expect(screen.getAllByText('Importe actualizado utilizado (MXN)').length).toBe(2);
    expect(screen.getAllByText(/PRAVIA no calculó esta actualización/i).length).toBeGreaterThan(0);
    expect(screen.getByDisplayValue('LISR 121, fracción I y artículo 124')).toBeInTheDocument();
  });

  it('genera un resumen de determinación con alcance, tarifa y procedencia federal', async () => {
    renderAt('/calculo-isr/fixture?fixture=print-summary');
    expect(await screen.findByRole('region',{name:'Resumen de determinación federal'})).toBeInTheDocument();
    expect(screen.getByText('Resumen de determinación — ISR provisional federal')).toBeInTheDocument();
    expect(screen.getByText('Anexo 8 RMF 2026, apartado A.I')).toBeInTheDocument();
    expect(screen.getAllByText(/PRAVIA no calculó la actualización/i).length).toBeGreaterThan(0);
    expect(screen.getByText(/No constituye declaración, pago ni acuse del SAT/i)).toBeInTheDocument();
    expect(screen.getAllByText(/pago a la entidad federativa previsto en el artículo 127/i).length).toBeGreaterThan(0);
  });

  it('conserva historial de versiones y avisa datos modificados', async () => {
    renderAt('/calculo-isr/fixture?fixture=history');
    expect(await screen.findByText('Historial y versiones')).toBeInTheDocument();
    expect(screen.getByText('v1')).toBeInTheDocument(); expect(screen.getByText('v2')).toBeInTheDocument();
  });

  it('oculta navegación y bloquea el directorio sin isr.read', async () => {
    mockSession(['expedientes.read']); renderAt('/calculo-isr?fixture=directory');
    expect(await screen.findByText('No tienes permiso para consultar este módulo.')).toBeInTheDocument();
    await waitFor(()=>expect(screen.queryByRole('link',{name:/Cálculo ISR/})).not.toBeInTheDocument());
  });

  it('da contexto específico a PRAVIA IA sin acciones fiscales silenciosas', () => {
    const context=resolveAssistantContext({pathname:'/calculo-isr/fixture',hash:''});
    expect(context).toMatchObject({module:'isr',entityType:'isrCalculation',entityId:'fixture'});
    expect(getAssistantActions(context).map((action)=>action.label)).toEqual(['¿Qué falta?','Explicar cálculo','Ver fuentes','Deducciones usadas']);
    expect(getAssistantActions(context)[0].prompt).toContain('no modifiques nada');
  });
});
