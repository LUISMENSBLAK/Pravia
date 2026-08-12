import { describe, expect, it } from 'vitest';
import { CotizacionEstado } from '@prisma/client';
import {
  CotizacionBusinessError,
  evaluateConversionEligibility,
  getAllowedCotizacionTransitions,
  validateCotizacionTransition,
} from './cotizacionWorkflow';

const candidate = (overrides: Record<string, unknown> = {}) => ({
  estado: CotizacionEstado.ACEPTADA,
  prospecto_id: 'prospecto-1',
  expediente: null,
  versiones: [{ aprobada: true }],
  pagos: [{ categoria_ingreso: 'ANTICIPO_NOTARIA', estatus: 'VALIDADO', monto: '15000.00' }],
  ...overrides,
});

describe('evaluateConversionEligibility', () => {
  it('permite convertir sólo con aceptación, versión aprobada y anticipo validado', () => {
    const result = evaluateConversionEligibility(candidate());
    expect(result).toMatchObject({
      eligible: true,
      accepted: true,
      approvedVersion: true,
      validatedAdvance: true,
      validatedAdvanceTotal: 15000,
      notConverted: true,
      linkedProspect: true,
    });
    expect(result.failures).toEqual([]);
  });

  it('no considera válido un anticipo solamente recibido', () => {
    const result = evaluateConversionEligibility(candidate({
      pagos: [{ categoria_ingreso: 'ANTICIPO_NOTARIA', estatus: 'RECIBIDO', monto: 15000 }],
    }));
    expect(result.eligible).toBe(false);
    expect(result.validatedAdvance).toBe(false);
    expect(result.failures).toContain('Debe existir un anticipo mayor a cero validado por administración.');
  });

  it('ignora pagos validados que no sean anticipo notarial', () => {
    const result = evaluateConversionEligibility(candidate({
      pagos: [{ categoria_ingreso: 'HONORARIOS_RECIBIDOS', estatus: 'VALIDADO', monto: 15000 }],
    }));
    expect(result.eligible).toBe(false);
    expect(result.validatedAdvanceTotal).toBe(0);
  });

  it('bloquea una segunda conversión aunque el estado se haya desincronizado', () => {
    const result = evaluateConversionEligibility(candidate({ expediente: { id: 'expediente-1' } }));
    expect(result.eligible).toBe(false);
    expect(result.notConverted).toBe(false);
  });

  it('informa acumulativamente todos los requisitos faltantes', () => {
    const result = evaluateConversionEligibility(candidate({
      estado: CotizacionEstado.BORRADOR,
      prospecto_id: null,
      versiones: [],
      pagos: [],
    }));
    expect(result.eligible).toBe(false);
    expect(result.failures).toHaveLength(4);
  });
});

describe('cotización state machine', () => {
  it('expone solamente la siguiente transición coherente desde borrador', () => {
    expect(getAllowedCotizacionTransitions(CotizacionEstado.BORRADOR)).toEqual([
      CotizacionEstado.ENVIADA_NOTARIA,
    ]);
  });

  it('requiere notaría antes de enviar la solicitud', () => {
    expect(() => validateCotizacionTransition({
      current: CotizacionEstado.BORRADOR,
      next: CotizacionEstado.ENVIADA_NOTARIA,
      hasNotaria: false,
      hasApprovedVersion: false,
    })).toThrowError(CotizacionBusinessError);
  });

  it('requiere versión aprobada antes de enviar al cliente', () => {
    expect(() => validateCotizacionTransition({
      current: CotizacionEstado.EN_REVISION_ABOGADO,
      next: CotizacionEstado.ENVIADA_CLIENTE,
      hasNotaria: true,
      hasApprovedVersion: false,
    })).toThrow('Debe existir una versión de presupuesto aprobada');
  });

  it('impide saltar de borrador a aceptada', () => {
    expect(() => validateCotizacionTransition({
      current: CotizacionEstado.BORRADOR,
      next: CotizacionEstado.ACEPTADA,
      hasNotaria: true,
      hasApprovedVersion: true,
    })).toThrow('no está permitida');
  });

  it('reserva CONVERTIDA_EXPEDIENTE para la operación transaccional', () => {
    expect(() => validateCotizacionTransition({
      current: CotizacionEstado.ACEPTADA,
      next: CotizacionEstado.CONVERTIDA_EXPEDIENTE,
      hasNotaria: true,
      hasApprovedVersion: true,
    })).toThrow('sólo puede realizarse mediante la acción de conversión');
  });
});
