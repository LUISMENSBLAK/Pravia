import { describe, expect, it } from 'vitest';
import { resolveCurrentOperationalActivity } from './expedienteOperationalStage';

const activity = (id: string, name: string, order: number, estado = 'NO_INICIADO') => ({
  id, estado, etapa_orden_snapshot: order, orden_operativo: order,
  created_at: new Date(`2026-09-${String(order).padStart(2, '0')}T12:00:00Z`),
  actividad_nombre_snapshot: name, etapa_nombre_snapshot: `Etapa ${order}`,
});

describe('resolveCurrentOperationalActivity', () => {
  it('avanza de FIRMA a INGRESO A SOLVENCIA sólo por evento real completado', () => {
    const rows = [activity('firma', 'FIRMA', 1, 'COMPLETADO'), activity('solvencia', 'INGRESO A SOLVENCIA', 2)];
    expect(resolveCurrentOperationalActivity(rows, [{ actividad_id: 'solvencia', depende_actividad_id: 'firma', bloqueante: true }])?.actividad_nombre_snapshot).toBe('INGRESO A SOLVENCIA');
  });

  it('no activa una actividad futura mientras su dependencia siga pendiente', () => {
    const rows = [activity('firma', 'FIRMA', 1), activity('solvencia', 'INGRESO A SOLVENCIA', 2)];
    expect(resolveCurrentOperationalActivity(rows, [{ actividad_id: 'solvencia', depende_actividad_id: 'firma', bloqueante: true }])?.id).toBe('firma');
  });

  it('ignora No aplica y conserva orden configurado ante ramas paralelas', () => {
    const rows = [activity('na', 'Actividad omitida', 1, 'NO_APLICA'), activity('b', 'Segundo ramal', 3, 'EN_PROCESO'), activity('a', 'Primer ramal', 2, 'EN_PROCESO')];
    expect(resolveCurrentOperationalActivity(rows, [])?.id).toBe('a');
  });

  it('devuelve null cuando no queda trabajo operativo', () => {
    expect(resolveCurrentOperationalActivity([activity('done', 'Cierre', 1, 'COMPLETADO')], [])).toBeNull();
  });
});
