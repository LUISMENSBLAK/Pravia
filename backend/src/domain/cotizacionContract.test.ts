import { CotizacionEtapaContractual as Stage, CotizacionEstado } from '@prisma/client';
import { describe, expect, it } from 'vitest';
import {
  allowedQuoteActions,
  assertQuoteFields,
  assertQuoteReplay,
  assertQuoteVersion,
  quoteActionResult,
  quoteEffectiveAt,
  quoteHash,
  quoteKey,
  quoteKnowledge,
  quoteLegacyProjection,
  quoteStageLabel,
} from './cotizacionContract';
import { evaluateConversionEligibility } from './cotizacionWorkflow';

describe('COT-001 contrato comercial canónico', () => {
  it('nombra las etapas operativas y conserva el hito anterior sólo como histórico', () => {
    expect([Stage.BORRADOR, Stage.EN_ELABORACION, Stage.ENVIADA_CLIENTE, Stage.EN_SEGUIMIENTO, Stage.ACEPTADA, Stage.RECHAZADA, Stage.ACEPTO_ANTICIPO, Stage.CANCELADA, Stage.CONVERTIDA_EXPEDIENTE].map(quoteStageLabel))
      .toEqual(['Borrador', 'En elaboración', 'Enviada al cliente', 'En seguimiento', 'Aceptada', 'Rechazada', 'Aceptó / Anticipo (histórico)', 'Cancelada', 'Convertida en expediente']);
  });
  it('comienza la elaboración desde Borrador', () => expect(allowedQuoteActions(Stage.BORRADOR)).toEqual(['COMENZAR_ELABORACION', 'SUSPENDER', 'CANCELAR']));
  it('envía al cliente sólo después de entrar en elaboración', () => expect(allowedQuoteActions(Stage.EN_ELABORACION)).toEqual(['ENVIAR_CLIENTE', 'SUSPENDER', 'CANCELAR']));
  it('permite seguimiento, reenvío y decisión humana desde Enviada', () => expect(allowedQuoteActions(Stage.ENVIADA_CLIENTE)).toEqual(['INICIAR_SEGUIMIENTO', 'REENVIAR_CLIENTE', 'ACEPTAR', 'RECHAZAR', 'SUSPENDER', 'CANCELAR']));
  it('mantiene las decisiones humanas durante seguimiento', () => expect(allowedQuoteActions(Stage.EN_SEGUIMIENTO)).toEqual(['REENVIAR_CLIENTE', 'ACEPTAR', 'RECHAZAR', 'SUSPENDER', 'CANCELAR']));
  it.each([Stage.ACEPTADA, Stage.ACEPTO_ANTICIPO])('habilita conversión desde aceptación canónica o histórica %s', (stage) => expect(allowedQuoteActions(stage)).toEqual(['CONVERTIR']));
  it.each([Stage.RECHAZADA, Stage.SUSPENDIDA, Stage.CANCELADA, Stage.CONVERTIDA_EXPEDIENTE])('cierra acciones en %s', (stage) => expect(allowedQuoteActions(stage)).toEqual([]));
  it('distingue reenvío sin cambiar etapa', () => expect(quoteActionResult(Stage.ENVIADA_CLIENTE, 'REENVIAR_CLIENTE')).toEqual({ next: Stage.ENVIADA_CLIENTE, changesStage: false }));
  it('un reenvío durante seguimiento tampoco altera la etapa', () => expect(quoteActionResult(Stage.EN_SEGUIMIENTO, 'REENVIAR_CLIENTE')).toEqual({ next: Stage.EN_SEGUIMIENTO, changesStage: false }));
  it('bloquea el bypass de transición', () => expect(() => quoteActionResult(Stage.BORRADOR, 'CONVERTIR')).toThrow(/no corresponde/i));
  it('proyecta el hito conjunto sin crear una etapa financiera', () => expect(quoteLegacyProjection(Stage.ACEPTO_ANTICIPO)).toBe(CotizacionEstado.ACEPTADA));
  it('proyecta las nuevas etapas al enum compartido sin cambiar el contrato persistido', () => {
    expect(quoteLegacyProjection(Stage.EN_ELABORACION)).toBe(CotizacionEstado.BORRADOR);
    expect(quoteLegacyProjection(Stage.EN_SEGUIMIENTO)).toBe(CotizacionEstado.EN_NEGOCIACION);
    expect(quoteLegacyProjection(Stage.ACEPTADA)).toBe(CotizacionEstado.ACEPTADA);
    expect(quoteLegacyProjection(Stage.RECHAZADA)).toBe(CotizacionEstado.RECHAZADA);
  });
  it('no mapea Rechazada ni Vencida a salidas canónicas', () => expect([CotizacionEstado.RECHAZADA, CotizacionEstado.VENCIDA]).not.toContain(quoteLegacyProjection(Stage.SUSPENDIDA)));
  it('marca legacy sin inventar estado', () => expect(quoteKnowledge(null)).toBe('UNKNOWN_LEGACY'));
  it('exige versión optimista', () => expect(() => assertQuoteVersion(undefined, 1)).toThrow(/actualiza/i));
  it('bloquea versión obsoleta', () => expect(() => assertQuoteVersion(1, 2)).toThrow(/otra sesión/i));
  it('acepta versión vigente', () => expect(() => assertQuoteVersion(2, 2)).not.toThrow());
  it('valida claves de idempotencia', () => expect(quoteKey('cot001:retry-01')).toBe('cot001:retry-01'));
  it('rechaza claves débiles', () => expect(() => quoteKey('x')).toThrow(/identificar/i));
  it('normaliza payload para replay estable', () => expect(quoteHash({ b: 2, a: 1 })).toBe(quoteHash({ a: 1, b: 2 })));
  it('detecta reuse de key con payload distinto', () => expect(() => assertQuoteReplay({ payload_hash: 'x', actor_id: 'u1' }, 'y', 'u1')).toThrow(/otros datos/i));
  it('prohíbe mass assignment', () => expect(() => assertQuoteFields({ action: 'CANCELAR', estado: 'BORRADOR' }, ['action'])).toThrow(/campos/i));
  it('acepta fecha efectiva pasada', () => expect(quoteEffectiveAt('2026-08-01T10:00:00Z', new Date('2026-08-01T11:00:00Z'), null)).toEqual(new Date('2026-08-01T10:00:00Z')));
  it('rechaza fecha futura', () => expect(() => quoteEffectiveAt('2026-08-01T12:00:00Z', new Date('2026-08-01T11:00:00Z'), null)).toThrow(/no futura/i));
  it('rechaza retroceder antes del hito anterior', () => expect(() => quoteEffectiveAt('2026-08-01T09:00:00Z', new Date('2026-08-01T11:00:00Z'), new Date('2026-08-01T10:00:00Z'))).toThrow(/hecho anterior/i));
  it('permite conversión canónica sin convertir un pago en requisito comercial', () => {
    const result = evaluateConversionEligibility({ estado: CotizacionEstado.ACEPTADA, etapa_contractual: Stage.ACEPTO_ANTICIPO, prospecto_id: 'p1', expediente: null, versiones: [{ aprobada: true }], pagos: [] });
    expect(result).toMatchObject({ eligible: true, accepted: true, validatedAdvance: false });
  });
  it('un pago aislado no fabrica el hito Aceptó / Anticipo', () => {
    const result = evaluateConversionEligibility({ estado: CotizacionEstado.BORRADOR, etapa_contractual: Stage.BORRADOR, prospecto_id: 'p1', expediente: null, versiones: [{ aprobada: true }], pagos: [{ categoria_ingreso: 'ANTICIPO_NOTARIA', estatus: 'VALIDADO', monto: 10 }] });
    expect(result.eligible).toBe(false); expect(result.accepted).toBe(false);
  });
});
