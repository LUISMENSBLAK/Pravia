import { describe, expect, it } from 'vitest';
import {
  assertExpedienteTransition,
  assertSignatureRequirements,
  ExpedienteWorkflowError,
  getAllowedExpedienteTransitions,
  resolveFrozenWorkflowTransitions,
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

  it('avanza por etapas congeladas consecutivas que comparten estado', () => {
    const stages = [
      { clave: 'REVISION', nombre: 'Revisión jurídica', orden: 3, estado_general_relacionado: 'EN_PROCESO' },
      { clave: 'AVALUO', nombre: 'Solicitud y gestión de avalúo', orden: 4, estado_general_relacionado: 'EN_PROCESO' },
      { clave: 'NOTARIA', nombre: 'Preparación notarial', orden: 5, estado_general_relacionado: 'PENDIENTE_NOTARIA' },
    ];

    const transitions = resolveFrozenWorkflowTransitions('EN_PROCESO', 3, stages);

    expect(transitions[0]).toMatchObject({
      status: 'EN_PROCESO',
      label: 'Continuar: Solicitud y gestión de avalúo',
      stage: { clave: 'AVALUO', orden: 4 },
    });
    expect(transitions.filter((transition) => transition.status === 'EN_PROCESO')).toHaveLength(1);
  });

  it('no salta una etapa congelada cuyo estado aún no está permitido', () => {
    const stages = [
      { clave: 'POST', nombre: 'Postfirma', orden: 11, estado_general_relacionado: 'POST_FIRMA' },
      { clave: 'ENTREGA', nombre: 'Entrega', orden: 12, estado_general_relacionado: 'ENTREGADO' },
    ];

    const transitions = resolveFrozenWorkflowTransitions('POST_FIRMA', 11, stages);

    expect(transitions[0]).toMatchObject({ status: 'LISTO_ENTREGA', label: 'Listo para entrega' });
    expect(transitions.some((transition) => transition.status === 'ENTREGADO')).toBe(false);
  });

  it('ignora relaciones desvinculadas al validar identidades para firma', () => {
    expect(() => assertSignatureRequirements({
      comparecientes: [
        { datos_validados: true, estatus: 'ACTIVO', archived_at: null },
        { datos_validados: false, estatus: 'INACTIVO', archived_at: new Date('2026-09-16T00:00:00Z') },
      ],
      requisitos_docs: [],
    }, { fechaFirma: new Date('2026-09-17T12:00:00Z') })).not.toThrow();
  });

  it('mantiene el bloqueo para una relación activa sin validar', () => {
    expect(() => assertSignatureRequirements({
      comparecientes: [{ datos_validados: false, estatus: 'ACTIVO', archived_at: null }],
      requisitos_docs: [],
    }, { fechaFirma: new Date('2026-09-17T12:00:00Z') })).toThrow(/1 compareciente/);
  });
});
