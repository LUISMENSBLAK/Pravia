import { describe, expect, it } from 'vitest';
import {
  assertExpedienteTransition,
  ExpedienteWorkflowError,
  getAllowedExpedienteTransitions,
} from './expedienteWorkflow';

describe('flujo operativo del expediente', () => {
  it('inicia integración desde un expediente abierto', () => {
    expect(() => assertExpedienteTransition('ABIERTO', 'EN_INTEGRACION')).not.toThrow();
  });

  it('impide saltar directamente de abierto a firmado', () => {
    expect(() => assertExpedienteTransition('ABIERTO', 'FIRMADO')).toThrow(ExpedienteWorkflowError);
  });

  it('permite programar firma desde proceso o pendiente de notaría', () => {
    expect(() => assertExpedienteTransition('EN_PROCESO', 'FIRMA_PROGRAMADA')).not.toThrow();
    expect(() => assertExpedienteTransition('PENDIENTE_NOTARIA', 'FIRMA_PROGRAMADA')).not.toThrow();
  });

  it('exige registrar firma antes de postfirma', () => {
    expect(() => assertExpedienteTransition('FIRMA_PROGRAMADA', 'POST_FIRMA')).toThrow(ExpedienteWorkflowError);
    expect(() => assertExpedienteTransition('FIRMADO', 'POST_FIRMA')).not.toThrow();
  });

  it('mantiene secuencial la entrega', () => {
    expect(() => assertExpedienteTransition('POST_FIRMA', 'ENTREGADO')).toThrow(ExpedienteWorkflowError);
    expect(() => assertExpedienteTransition('POST_FIRMA', 'LISTO_ENTREGA')).not.toThrow();
    expect(() => assertExpedienteTransition('LISTO_ENTREGA', 'ENTREGADO')).not.toThrow();
  });

  it('bloquea estados finales', () => {
    expect(getAllowedExpedienteTransitions('ENTREGADO')).toEqual([]);
    expect(getAllowedExpedienteTransitions('CANCELADO')).toEqual([]);
  });

  it('permite reanudar un expediente suspendido por el flujo ordinario', () => {
    expect(getAllowedExpedienteTransitions('SUSPENDIDO')).toContain('EN_PROCESO');
  });
});
