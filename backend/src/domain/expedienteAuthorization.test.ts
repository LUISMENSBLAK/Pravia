import { describe, expect, it } from 'vitest';
import {
  assertPostfirmaReadyForDelivery,
  assertSpecializedTransition,
  validateDeliveryInput,
} from './expedienteAuthorization';

describe('autorización operativa de expedientes', () => {
  it('permite a recepción únicamente LISTO_ENTREGA → ENTREGADO', () => {
    expect(() => assertSpecializedTransition('RECEPCION', 'LISTO_ENTREGA', 'ENTREGADO')).not.toThrow();
    expect(() => assertSpecializedTransition('RECEPCION', 'POST_FIRMA', 'ENTREGADO')).toThrow(/solo puede registrar/i);
    expect(() => assertSpecializedTransition('RECEPCION', 'LISTO_ENTREGA', 'CANCELADO')).toThrow(/solo puede registrar/i);
  });

  it('exige los datos mínimos y documentos del mismo expediente en una entrega', () => {
    const valid = {
      receptor_nombre: 'Ana Pérez', receptor_caracter: 'Titular', fecha_efectiva: new Date('2026-08-12T12:00:00Z'),
      medio: 'Presencial', evidencia_documento_id: 'acuse',
      items: [{ documento_id: 'testimonio', tipo: 'TESTIMONIO' as const, cantidad: 1 }],
    };
    expect(() => validateDeliveryInput(valid, new Set(['acuse', 'testimonio']), new Date('2026-08-12T13:00:00Z'))).not.toThrow();
    expect(() => validateDeliveryInput(
      { ...valid, evidencia_documento_id: 'ajeno' },
      new Set(['acuse', 'testimonio']),
      new Date('2026-08-12T13:00:00Z'),
    )).toThrow(/evidencia vigente/i);
  });

  it('limita gestoría a FIRMADO → POST_FIRMA → LISTO_ENTREGA', () => {
    expect(() => assertSpecializedTransition('GESTORIA', 'FIRMADO', 'POST_FIRMA')).not.toThrow();
    expect(() => assertSpecializedTransition('GESTORIA', 'POST_FIRMA', 'LISTO_ENTREGA')).not.toThrow();
    expect(() => assertSpecializedTransition('GESTORIA', 'POST_FIRMA', 'ENTREGADO')).toThrow(/secuencia autorizada/i);
    expect(() => assertSpecializedTransition('GESTORIA', 'FIRMADO', 'FIRMA_PROGRAMADA')).toThrow(/secuencia autorizada/i);
  });

  it('impide cerrar postfirma con trámites o requisitos pendientes', () => {
    expect(() => assertPostfirmaReadyForDelivery([{ estatus: 'EN_PROCESO' }], [])).toThrow(/todos los trámites/i);
    expect(() => assertPostfirmaReadyForDelivery([{ estatus: 'COMPLETADA' }], [{ obligatorio: true, validado: false, omitido: false }])).toThrow(/requisitos documentales/i);
    expect(() => assertPostfirmaReadyForDelivery([{ estatus: 'COMPLETADA' }], [{ obligatorio: true, validado: true, omitido: false }])).not.toThrow();
  });
});
