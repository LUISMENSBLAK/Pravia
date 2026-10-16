import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import userEvent from '@testing-library/user-event';
import { App } from '../app/App';
import { normalizeMyDay } from '../features/my-day/myDay.service';
import { formatCurrency, formatOperationalStatus } from '../features/my-day/formatters';
import { UrgentSignatures } from '../features/my-day/components/UrgentSignatures';
import { TodayAgenda } from '../features/my-day/components/TodayAgenda';
import { FollowUpReminders } from '../features/my-day/components/FollowUpReminders';
import { ProcessCard } from '../features/my-day/components/ProcessCard';
import { CaseCard } from '../features/my-day/components/CaseCard';
import { CardDetailDialog } from '../features/my-day/components/CardDetailDialog';
import { buildOwnDaySummary } from '../features/my-day/components/DaySummary';
import type { MyDayData } from '../features/my-day/myDay.types';
import type { MiDiaLayoutItem } from '../features/my-day/miDiaConfiguration.service';

const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { 'Content-Type': 'application/json' },
});

const session = { user: { id: 'qa', name: 'Usuario Prueba', email: 'qa@notaria.mx', role: 'Operación' } };

const baseDashboard = {
  permissions: { canViewFinance: false },
  kpis: {
    activeFiles: { value: 2, label: 'Expedientes activos' },
    signaturesToday: { value: 0, label: 'Firmas hoy' },
    urgentPending: { value: 0, label: 'Pendientes urgentes' },
    operationalFallback: { value: 3, label: 'Tareas del día' },
  },
  agenda: [], urgentSignatures: [], recentFiles: [], recommendation: null, reminders: [], urgentTasks: [], errors: {},
};

const defaultCardKeys = ['URGENT_TASKS', 'TODAY_AGENDA', 'UPCOMING_SIGNINGS', 'CASES', 'FOLLOWUP_REMINDERS', 'PERSONAL_NOTEBOOK', 'RECEIVABLE', 'PRAVIA_ASSISTANT'];
const miDiaConfig = {
  catalog: defaultCardKeys.map((key) => ({ key, name: key, family: 'OPERACION', sourceModule: 'QA',
    allowedSizes: ['S', 'M', 'L', 'V'], allowedScopes: ['OWN'], defaultSize: 'M',
    drillDown: '/mi-dia', parameters: [], maxScope: 'OWN', recommended: true })),
  layout: defaultCardKeys.map((key) => ({ key, size: 'M', scope: 'OWN', parameters: {} })),
  layoutVersion: 0, tenantVersion: 0, personalized: false,
};
const configResponse = (url: string) => url.endsWith('/mi-dia/config') ? response({ success: true, data: miDiaConfig }) : null;

describe('Mi Día', () => {
  it('pagina el detalle canónico, conserva el total y abre el objeto exacto', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      const page = new URL(url, 'http://local.test').searchParams.get('page');
      return response({ success: true, data: {
        key: 'INCOME_COLLECTED', title: 'Ingreso cobrado', scope: 'OWN', parameters: { period: 'MONTH' },
        totalCount: 3, totalAmount: '600.66', available: true, message: null,
        page: Number(page), pageSize: 20, totalPages: 2,
        items: page === '1' ? [{ id: 'm1', folio: 'MOV-1', nombre: 'Ingreso 1', amount: '100.11', href: '/finanzas?movimiento_id=m1' }]
          : [{ id: 'm2', folio: 'MOV-2', nombre: 'Ingreso 2', amount: '500.55', href: '/finanzas?movimiento_id=m2' }],
      } });
    });
    vi.stubGlobal('fetch', fetchMock);
    render(<MemoryRouter><CardDetailDialog cardKey="INCOME_COLLECTED" title="Ingreso cobrado" onClose={() => undefined} /></MemoryRouter>);
    expect(await screen.findByRole('dialog', { name: 'Ingreso cobrado' })).toBeInTheDocument();
    expect(screen.getByText('3')).toBeInTheDocument();
    expect(screen.getByText(/600\.66/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Abrir MOV-1' })).toHaveAttribute('href', '/finanzas?movimiento_id=m1');
    await userEvent.click(screen.getByRole('button', { name: /Siguiente/ }));
    expect(await screen.findByText('MOV-2')).toBeInTheDocument();
    expect(screen.getByText('Página 2 de 2')).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('no resume un anticipo sin fuente como si fuese un cero financiero real', () => {
    const layout: MiDiaLayoutItem[] = [{ key: 'ADVANCES_PENDING', size: 'S', scope: 'OWN', parameters: {} }];
    const data = { financeCards: { ADVANCES_PENDING: { count: 0, amount: '0.00', items: [], available: false } },
      processCards: {}, caseCards: {}, commercialCards: {}, documentCards: {}, complianceCards: {}, errors: {} } as unknown as MyDayData;
    expect(buildOwnDaySummary(data, layout, {})).toEqual({ items: [], failed: 1, connected: 1 });
  });
  it('resume sólo fuentes OWN visibles y declara las fallidas sin presentarlas como cero', () => {
    const layout: MiDiaLayoutItem[] = [
      { key: 'MY_PENDING', size: 'M', scope: 'OWN', parameters: {} },
      { key: 'NOTICES_OVERDUE', size: 'M', scope: 'ORGANIZATION', parameters: {} },
      { key: 'CRITICAL_ALERTS', size: 'M', scope: 'OWN', parameters: {} },
      { key: 'DAY_SUMMARY', size: 'M', scope: 'OWN', parameters: {} },
    ];
    const data = { processCards: { MY_PENDING: { count: 3, items: [{ href: '/expedientes/own#seguimiento' }] } },
      complianceCards: { NOTICES_OVERDUE: { count: 50, items: [{ href: '/expedientes/other#cumplimiento' }] },
        CRITICAL_ALERTS: null }, errors: { CRITICAL_ALERTS: 'Sin fuente' } } as unknown as MyDayData;
    expect(buildOwnDaySummary(data, layout, { MY_PENDING: 'Mis procesos pendientes' })).toEqual({
      connected: 2, failed: 1, items: [{ key: 'MY_PENDING', name: 'Mis procesos pendientes', count: 3,
        href: '/expedientes/own#seguimiento' }],
    });
  });

  it('separa señales que requieren atención de un resumen general sin sumar tarjetas ocultas', () => {
    const layout: MiDiaLayoutItem[] = [
      { key: 'MY_PENDING', size: 'M', scope: 'OWN', parameters: {} },
      { key: 'OVERDUE_PROCESSES', size: 'M', scope: 'OWN', parameters: {} },
      { key: 'CRITICAL_ALERTS', size: 'M', scope: 'ORGANIZATION', parameters: {} },
      { key: 'NEEDS_ATTENTION', size: 'M', scope: 'OWN', parameters: {} },
    ];
    const data = { processCards: {
      MY_PENDING: { count: 6, items: [{ href: '/expedientes/general#seguimiento' }] },
      OVERDUE_PROCESSES: { count: 2, items: [{ href: '/expedientes/overdue#seguimiento' }] },
    }, complianceCards: { CRITICAL_ALERTS: { count: 4, items: [{ href: '/expedientes/org#cumplimiento' }] } },
    errors: {} } as unknown as MyDayData;
    expect(buildOwnDaySummary(data, layout, { OVERDUE_PROCESSES: 'Procesos vencidos' }, 'attention')).toEqual({
      connected: 1, failed: 0, items: [{ key: 'OVERDUE_PROCESSES', name: 'Procesos vencidos', count: 2,
        href: '/expedientes/overdue#seguimiento' }],
    });
  });
  it('presenta estados operativos humanos sin modificar el valor canónico', () => {
    expect(formatOperationalStatus('EN_PROCESO')).toBe('En proceso');
    expect(formatOperationalStatus('PENDIENTE_CLIENTE')).toBe('Pendiente del cliente');
    expect(formatOperationalStatus('ESTADO_HISTORICO')).toBe('Estado historico');
    expect(formatCurrency(146934.3)).toContain('146,934.30');
  });

  it('normaliza un payload parcial sin inventar colecciones ni permisos', () => {
    const normalized = normalizeMyDay({ data: { permissions: {}, agenda: null } });
    expect(normalized.permissions.canViewFinance).toBe(false);
    expect(normalized.agenda).toEqual([]);
    expect(normalized.urgentTasks).toEqual([]);
  });

  it('no convierte una fuente fallida en KPI cero', () => {
    const normalized = normalizeMyDay({ data: {
      metricas: { tareas_vencidas: null, expedientes_bloqueados: 2, firmas_proximas: null, saldo_pendiente_total: null },
      operacion: {}, eventos: {}, tareas: {}, permissions: { canViewFinance: true },
      errors: { tasks: 'Tareas no disponibles', signatures: 'Firmas no disponibles', finance: 'Finanzas no disponibles' },
    } });
    expect(normalized.kpis.urgentPending).toBeUndefined();
    expect(normalized.kpis.signaturesToday).toBeUndefined();
    expect(normalized.kpis.financial).toBeUndefined();
    expect(normalized.finance).toBeNull();
    expect(normalized.errors.finance).toBe('Finanzas no disponibles');
  });

  it('no presenta expedientes cero como dato real cuando falta permiso', () => {
    const normalized = normalizeMyDay({ data: {
      metricas: {}, operacion: { recientes: [] }, eventos: {}, tareas: {},
      permissions: { canViewCases: false, canViewFinance: true }, errors: {},
    } });
    expect(normalized.kpis.activeFiles).toBeUndefined();
    expect(normalized.permissions.canViewCases).toBe(false);
  });

  it('abre el objeto fuente exacto de cada recordatorio comercial', () => {
    const normalized = normalizeMyDay({ data: {
      metricas: {}, eventos: {}, tareas: {}, operacion: { cotizaciones_seguimiento_count: 4, cotizaciones_seguimiento: [
        { id: 'p1', tipo: 'PROSPECTO', numero: 'Cliente A', fecha_seguimiento: '2026-10-12T10:00:00Z' },
        { id: 'c1', tipo: 'COTIZACION', numero: 'COT-0001-2026', fecha_seguimiento: '2026-10-12T11:00:00Z' },
      ] },
    } });
    expect(normalized.reminders.map((item) => item.href)).toEqual(['/prospectos/p1', '/cotizaciones/c1']);
    expect(normalized.reminderCount).toBe(4);
  });

  it('conserva el conteo completo de Agenda del día separado de las filas limitadas', () => {
    const normalized = normalizeMyDay({ data: {
      metricas: { citas_hoy: 23 }, operacion: {}, tareas: {},
      eventos: { hoy: [{ id: 'event-1', titulo: 'Cita', fecha_inicio: '2026-10-14T18:00:00Z' }] },
    } });
    expect(normalized.agendaCount).toBe(23);
    expect(normalized.agenda).toHaveLength(1);
    render(<MemoryRouter><TodayAgenda items={normalized.agenda} count={normalized.agendaCount}
      visibleLimit={5} loading={false} onRetry={() => undefined} /></MemoryRouter>);
    expect(screen.getByText('23')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Cita' })).toHaveAttribute('href', '/agenda#evento=event-1');
  });

  it('muestra todas las filas autorizadas por el límite y el conteo completo de seguimientos', () => {
    const items = Array.from({ length: 5 }, (_, index) => ({ id: `p${index}`, title: `Prospecto ${index}`,
      href: `/prospectos/p${index}`, kind: 'call' as const }));
    render(<MemoryRouter><FollowUpReminders items={items} count={8} loading={false}
      onRetry={() => undefined} /></MemoryRouter>);
    expect(screen.getByText('8')).toBeInTheDocument();
    expect(screen.getAllByRole('link')).toHaveLength(5);
    expect(screen.getByRole('link', { name: 'Prospecto 4' })).toHaveAttribute('href', '/prospectos/p4');
  });

  it('enlaza un evento real de Mi Día con su ficha exacta de Agenda', () => {
    const normalized = normalizeMyDay({ data: {
      metricas: { firmas_hoy_agenda: 1, citas_proximas: 1 }, operacion: {}, tareas: {},
      eventos: {
        hoy: [{ id: 'evento-qa', titulo: 'Firma con cliente', fecha_inicio: '2026-10-13T10:00:00.000Z', estatus: 'ACTIVO' }],
        firmas_hoy: [{ id: 'firma-qa', titulo: 'Firma', fecha_inicio: '2026-10-13T10:00:00.000Z', tipo: 'FIRMA' }],
        citas_proximas: [{ id: 'cita-qa', titulo: 'Cita', fecha_inicio: '2026-10-14T10:00:00.000Z', tipo: 'CITA' }],
      },
    } });
    expect(normalized.agenda[0].href).toBe('/agenda#evento=evento-qa');
    expect(normalized.todaySignings[0].href).toBe('/agenda#evento=firma-qa');
    expect(normalized.upcomingAppointments[0].href).toBe('/agenda#evento=cita-qa');
    expect(normalized.kpis.todaySignings?.value).toBe(1);
    expect(normalized.kpis.upcomingAppointments?.value).toBe(1);
  });

  it('abre el expediente exacto desde una firma próxima', () => {
    render(<MemoryRouter><UrgentSignatures items={[{
      id: 'exp-qa-firma', fileNumber: 'EXP-0001-2026', dueAt: '2026-10-15T10:00:00.000Z',
    }]} count={9} visibleLimit={5} loading={false} onRetry={() => undefined} /></MemoryRouter>);
    expect(screen.getByRole('heading', { name: 'Firmas próximas' })).toBeInTheDocument();
    expect(screen.getByText('9')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'EXP-0001-2026' })).toHaveAttribute('href', '/expedientes/exp-qa-firma');
  });

  it('presenta un proceso real con total no truncado y enlace exacto a Seguimiento', () => {
    const href = '/expedientes/case-1?process_id=activity-1#seguimiento';
    render(<MemoryRouter><ProcessCard title="Mis pendientes" loading={false} onRetry={() => undefined}
      data={{ count: 12, items: [{ id: 'activity-1', expediente_id: 'case-1', folio: 'EXP-0001-2026',
        nombre: 'Revisar antecedentes', estado: 'EN_PROCESO', responsable_id: 'qa',
        fecha_objetivo: '2026-10-13T00:00:00.000Z', dias_restantes: 0, href }] }} /></MemoryRouter>);
    expect(screen.getByText('12 procesos en total')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Abrir Revisar antecedentes en EXP-0001-2026' })).toHaveAttribute('href', href);
  });

  it('distingue cero verificado de error en la fuente de procesos', () => {
    const { rerender } = render(<MemoryRouter><ProcessCard title="Vencen hoy" loading={false} onRetry={() => undefined}
      data={{ count: 0, items: [] }} /></MemoryRouter>);
    expect(screen.getByText('No hay procesos en esta condición dentro de tu alcance.')).toBeInTheDocument();
    rerender(<MemoryRouter><ProcessCard title="Vencen hoy" loading={false} onRetry={() => undefined}
      data={null} error="Fuente no disponible" /></MemoryRouter>);
    expect(screen.getByRole('alert')).toHaveTextContent('Fuente no disponible');
    expect(screen.queryByText('No hay procesos en esta condición dentro de tu alcance.')).not.toBeInTheDocument();
  });

  it('presenta el conteo exacto de expedientes y abre la vista de actividad fuente', () => {
    render(<MemoryRouter><CaseCard title="Expedientes sin movimiento" inactive loading={false} onRetry={() => undefined}
      data={{ count: 8, items: [{ id: 'case-1', folio: 'EXP-0001-2026', cliente: 'Cliente QA',
        estado: 'EN_PROCESO', contexto: null, href: '/expedientes/case-1#actividad' }] }} /></MemoryRouter>);
    expect(screen.getByText('8 expedientes en total')).toBeInTheDocument();
    expect(screen.getByText('Sin actividad registrada')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Abrir EXP-0001-2026' })).toHaveAttribute('href', '/expedientes/case-1#actividad');
  });

  it('respeta el límite visible configurado de Agenda del día', () => {
    const items = Array.from({ length: 8 }, (_, index) => ({
      id: `event-${index}`, title: `Evento ${index + 1}`, startsAt: `2026-10-13T${String(index + 8).padStart(2, '0')}:00:00.000Z`,
    }));
    render(<MemoryRouter><TodayAgenda items={items} visibleLimit={10} loading={false} onRetry={() => undefined} /></MemoryRouter>);
    expect(screen.getAllByRole('listitem')).toHaveLength(8);
    expect(screen.getByText('Evento 8')).toBeInTheDocument();
  });

  it('muestra estados vacíos y sustituye el KPI financiero sin permiso', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/auth/me')) return response(session);
      if (url.endsWith('/mi-dia')) return response({ data: baseDashboard });
      if (configResponse(url)) return configResponse(url)!;
      return response({}, 204);
    }));
    render(<MemoryRouter initialEntries={['/mi-dia']}><App /></MemoryRouter>);
    expect(await screen.findByRole('heading', { name: /Usuario/ })).toBeInTheDocument();
    expect(await screen.findByText('Tareas del día')).toBeInTheDocument();
    expect(screen.getByText('No tienes eventos programados para hoy.')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Resumen financiero' })).not.toBeInTheDocument();
  });

  it('aísla el error de agenda y mantiene los demás widgets disponibles', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/auth/me')) return response(session);
      if (url.endsWith('/mi-dia')) return response({ data: { ...baseDashboard, errors: { agenda: 'Agenda unavailable' } } });
      if (configResponse(url)) return configResponse(url)!;
      return response({}, 204);
    }));
    render(<MemoryRouter initialEntries={['/mi-dia']}><App /></MemoryRouter>);
    expect(await screen.findByText('No pudimos cargar tus eventos.')).toBeInTheDocument();
    expect(screen.getByText('Sin firmas pendientes.')).toBeInTheDocument();
    expect(screen.getByText('No tienes tareas urgentes.')).toBeInTheDocument();
  });

  it('actualiza los datos reales al recibir un cambio sin recargar la página', async () => {
    let myDayCalls = 0;
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/auth/me')) return response(session);
      if (configResponse(url)) return configResponse(url)!;
      if (url.endsWith('/mi-dia')) {
        myDayCalls += 1;
        return response({ data: { ...baseDashboard, kpis: { ...baseDashboard.kpis, activeFiles: { value: myDayCalls === 1 ? 2 : 5, label: 'Expedientes activos' } } } });
      }
      return response({}, 204);
    }));
    render(<MemoryRouter initialEntries={['/mi-dia']}><App /></MemoryRouter>);
    expect(await screen.findByText('2')).toBeInTheDocument();
    act(() => window.dispatchEvent(new CustomEvent('pravia:data-changed', { detail: { path: '/agenda', method: 'POST' } })));
    await waitFor(() => expect(screen.getByText('5')).toBeInTheDocument());
    expect(myDayCalls).toBeGreaterThanOrEqual(2);
  });

  it('muestra skeletons por widget mientras el dashboard está cargando', async () => {
    vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/auth/me')) return Promise.resolve(response(session));
      if (configResponse(url)) return Promise.resolve(configResponse(url)!);
      if (url.endsWith('/mi-dia')) return new Promise<Response>(() => undefined);
      return Promise.resolve(response({}, 204));
    }));
    render(<MemoryRouter initialEntries={['/mi-dia']}><App /></MemoryRouter>);
    expect((await screen.findAllByRole('status', { name: 'Cargando información' })).length).toBeGreaterThan(3);
  });

  it('abre la misma experiencia global de PRAVIA IA desde la card de Mi Día', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/auth/me')) return response(session);
      if (url.endsWith('/mi-dia')) return response({ data: baseDashboard });
      if (configResponse(url)) return configResponse(url)!;
      return response({}, 204);
    }));
    render(<MemoryRouter initialEntries={['/mi-dia']}><App /></MemoryRouter>);
    await screen.findByRole('heading', { name: /Usuario/ });
    expect(await screen.findByRole('button', { name: 'Buscar expediente' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Ver pendientes' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Programar firma' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Resumen financiero' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Abrir PRAVIA IA para hacer una pregunta' }));
    expect(await screen.findByRole('dialog', { name: 'PRAVIA IA' })).toBeInTheDocument();
  });

  it('transfiere el foco al contenido principal desde el skip link', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/auth/me')) return response(session);
      if (url.endsWith('/mi-dia')) return response({ data: baseDashboard });
      if (configResponse(url)) return configResponse(url)!;
      return response({}, 204);
    }));
    const user = userEvent.setup();
    render(<MemoryRouter initialEntries={['/mi-dia']}><App /></MemoryRouter>);
    await screen.findByRole('heading', { name: /Usuario/ });
    const skipLink = screen.getByRole('link', { name: 'Saltar al contenido' });
    skipLink.focus();
    expect(skipLink).toHaveFocus();
    await user.keyboard('{Enter}');
    const main = document.getElementById('main-content');
    expect(main).toHaveAttribute('tabindex', '-1');
    expect(main).toHaveFocus();
    await user.tab();
    expect(main?.contains(document.activeElement)).toBe(true);
  });
});
