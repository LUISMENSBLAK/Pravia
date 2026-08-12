import { describe, expect, it } from 'vitest';
import { ExpedienteProgressService } from './expedienteProgress.service';

describe('progreso con workflow congelado', () => {
  it('calcula el avance operativo desde etapas_json de la versión del expediente', async () => {
    const tx = { expediente: { findUnique: async () => ({
      valor_operacion: 9_999_999,
      datos_operacion: {}, cotizacion: null,
      flujoVersion: { etapas_json: [{ clave: 'A' }, { clave: 'B' }], ponderaciones_json: { operativo: 1, documental: 0, financiero: 0 } },
      etapas: [{ completada: true }], requisitos_docs: [], movimientosFinancieros: [],
    }) } } as any;
    const progress = await ExpedienteProgressService.calcularAvances(tx, 'exp-1');
    expect(progress.operativo).toBe(50);
    expect(progress.configuration.operativo).toBe('EN_PROGRESO');
  });

  it('no convierte valor_operacion en presupuesto ni avance financiero', async () => {
    const tx = { expediente: { findUnique: async () => ({
      valor_operacion: 9_999_999,
      datos_operacion: {}, cotizacion: null,
      flujoVersion: { etapas_json: [], ponderaciones_json: null },
      etapas: [], requisitos_docs: [], movimientosFinancieros: [{ naturaleza: 'INGRESO', tipo_movimiento: 'ABONO', monto: 500 }],
    }) } } as any;
    const progress = await ExpedienteProgressService.calcularAvances(tx, 'exp-1');
    expect(progress.financiero).toBe(0);
    expect(progress.configuration.financiero).toBe('NO_CONFIGURADO');
  });
});
