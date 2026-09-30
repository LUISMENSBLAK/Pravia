import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { WorkflowTab } from '../features/cases/components/tabs/WorkflowTab';
import { expedientesService } from '../features/cases/expedientes.service';
import type { ExpedienteDetail, ExpedienteSeguimiento, SeguimientoActivity } from '../features/cases/expedientes.types';

vi.mock('../features/cases/expedientes.service', () => ({ expedientesService: {
  seguimiento: vi.fn(), materializeSeguimiento: vi.fn(), updateSeguimientoActivity: vi.fn(),
  transition: vi.fn(), documentAppendix: vi.fn(), signaturePreflight: vi.fn(), updateHeader: vi.fn(),
} }));

const activity = (overrides: Partial<SeguimientoActivity> = {}): SeguimientoActivity => ({
  id: 'activity-1', expediente_acto_id: 'act-1', proceso_clave: 'PROCESS:master-1', etapa_nombre_snapshot: 'Prefirma', actividad_nombre_snapshot: 'REVISAR DOCUMENTACIÓN',
  estado: 'NO_INICIADO', estado_operativo: 'NO_INICIADO', estado_efectivo: 'NO_INICIADO', estado_label: 'No iniciado', version: 1,
  en_alcance: true, requiere_revision: false, responsable_id: 'user-1', responsable: { id: 'user-1', nombre: 'Andrea', apellido: 'Ruiz' },
  aplica_por_defecto: true, resolucion_fuente: 'GENERAL', dependencias: [], bloqueada_por: [],
  actos_origen: [{ expediente_acto_id: 'act-1', tipo_acto_id: 'type-1', duracion_configurada: 3, tipo_dias_configurado: 'HABILES', configuracion_revision: 1 }],
  dias_restantes: { value: 3, due: '2026-09-29T00:00:00.000Z', label: '3 DÍAS', overdue: false },
  fecha_cumplimiento: null, estatus_presentacion: 'REALIZAR',
  tiempo: { estimado: 3, tipo_dias: 'HABILES', margen: 1, transcurrido: 0, atrasada: false, margen_consumido: false },
  ...overrides,
});

const tracking = (processes: SeguimientoActivity[] = [activity()]): ExpedienteSeguimiento => ({
  expediente_id: 'exp-1', configuracion_actual_no_reaplicada: true, fecha_firma_manual: '2026-09-01T17:00:00Z',
  firma: { programada: '2026-09-01T17:00:00Z', efectiva: null, snapshot_canonico: false },
  entrega: { completada: false, fecha: null, alertas_operativas_activas: true },
  procesos: processes,
  proyeccion: { dias_restantes_ruta_critica: 12, fecha_final_estimada: '2026-09-22T12:00:00.000Z', semantica_paralelo: 'MAX', altera_fecha_estimada_firma: false },
  resumen_temporal: { fuente: 'SEGUIMIENTO', dias_habiles_a_firma: 4, dias_habiles_a_entrega: 12 },
  actos: [{ expediente_acto_id: 'act-1', tipo_acto_id: 'type-1', nombre: 'Compraventa', estatus: 'ACTIVO', etapas: [{ nombre: 'Prefirma', orden: 1, actividades: processes }] }],
  responsables: [{ id: 'user-1', nombre: 'Andrea', apellido: 'Ruiz' }, { id: 'user-2', nombre: 'Mario', apellido: 'López' }],
  signals: { prefirm: processes, postfirm: [] },
});

const expediente = { id: 'exp-1', version: 1, estatus: 'ABIERTO', macrofase: 'APERTURA', etapas: [], workflow: { current_status_label: 'Abierto', transitions: [], stages: [] }, capabilities: { canWrite: true } } as unknown as ExpedienteDetail;

describe('Corrección 017 · Seguimiento operativo canónico', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(expedientesService.seguimiento).mockResolvedValue(tracking());
    vi.mocked(expedientesService.updateSeguimientoActivity).mockResolvedValue({} as never);
  });

  it('muestra exclusivamente las cinco columnas contractuales y una fila por proceso', async () => {
    render(<WorkflowTab expediente={expediente} onChanged={vi.fn()} />);
    expect(await screen.findByRole('table', { name: 'Procesos del expediente' })).toBeInTheDocument();
    expect(screen.getAllByRole('columnheader').map((node) => node.textContent)).toEqual(['Proceso', 'Días restantes', 'Fecha de cumplimiento', 'Responsable', 'Estatus']);
    expect(screen.getAllByRole('row')).toHaveLength(2);
    expect(screen.getByText('REVISAR DOCUMENTACIÓN')).toBeInTheDocument();
    expect(screen.queryByText('Compraventa')).not.toBeInTheDocument();
    expect(screen.queryByText('Ruta crítica restante')).not.toBeInTheDocument();
    expect(screen.queryByText('Fecha de firma manual')).not.toBeInTheDocument();
    expect(screen.queryByText('Estimado')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /ajustar|reabrir|actividad extraordinaria/i })).not.toBeInTheDocument();
  });

  it('presenta un proceso bloqueado con guion y PENDIENTE deshabilitado', async () => {
    vi.mocked(expedientesService.seguimiento).mockResolvedValue(tracking([activity({
      estado: 'NO_INICIADO', estado_operativo: 'NO_INICIADO', estado_efectivo: 'BLOQUEADO', estado_label: 'Bloqueado',
      dias_restantes: { value: null, due: null, label: '—', overdue: false }, estatus_presentacion: 'PENDIENTE',
    })]));
    render(<WorkflowTab expediente={expediente} onChanged={vi.fn()} />);
    expect(await screen.findByRole('button', { name: 'Pendiente' })).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Realizar' })).not.toBeInTheDocument();
    expect(screen.getAllByText('—').length).toBeGreaterThanOrEqual(2);
  });

  it('realiza directamente un proceso habilitado con concurrencia optimista', async () => {
    render(<WorkflowTab expediente={expediente} onChanged={vi.fn()} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Realizar' }));
    await waitFor(() => expect(expedientesService.updateSeguimientoActivity).toHaveBeenCalledWith('exp-1', 'activity-1', {
      expected_version: 1, estado: 'COMPLETADO', razon: 'Proceso realizado desde Seguimiento.',
    }));
  });

  it('muestra fecha y realizado sin permitir una segunda ejecución', async () => {
    vi.mocked(expedientesService.seguimiento).mockResolvedValue(tracking([activity({
      estado: 'COMPLETADO', estado_operativo: 'COMPLETADO', estado_efectivo: 'COMPLETADO', estado_label: 'Completado',
      dias_restantes: { value: null, due: null, label: '—', overdue: false }, fecha_cumplimiento: '2026-09-26T12:00:00.000Z', estatus_presentacion: 'REALIZADO',
    })]));
    render(<WorkflowTab expediente={expediente} onChanged={vi.fn()} />);
    expect(await screen.findByText('Realizado')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Realizar' })).not.toBeInTheDocument();
    expect(screen.getByText(/26/)).toBeInTheDocument();
  });

  it('actualiza el responsable desde la única columna operativa', async () => {
    render(<WorkflowTab expediente={expediente} onChanged={vi.fn()} />);
    fireEvent.change(await screen.findByRole('combobox', { name: 'Responsable de REVISAR DOCUMENTACIÓN' }), { target: { value: 'user-2' } });
    await waitFor(() => expect(expedientesService.updateSeguimientoActivity).toHaveBeenCalledWith('exp-1', 'activity-1', {
      expected_version: 1, responsable_id: 'user-2', razon: 'Responsable operativo actualizado.',
    }));
  });
});
