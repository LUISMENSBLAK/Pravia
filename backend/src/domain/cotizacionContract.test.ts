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
  it('nombra las seis etapas con etiquetas humanas', () => {
    expect([Stage.BORRADOR, Stage.ENVIADA_CLIENTE, Stage.ACEPTO_ANTICIPO, Stage.SUSPENDIDA, Stage.CANCELADA, Stage.CONVERTIDA_EXPEDIENTE].map(quoteStageLabel))
      .toEqual(['Borrador', 'Enviada al cliente', 'Aceptó / Anticipo', 'Suspendida', 'Cancelada', 'Convertida en expediente']);
  });
  it('sólo permite enviar, suspender o cancelar desde Borrador', () => expect(allowedQuoteActions(Stage.BORRADOR)).toEqual(['ENVIAR_CLIENTE', 'SUSPENDER', 'CANCELAR']));
  it('permite reenvío y un único hito Aceptó / Anticipo desde Enviada', () => expect(allowedQuoteActions(Stage.ENVIADA_CLIENTE)).toEqual(['REENVIAR_CLIENTE', 'REGISTRAR_ACEPTACION_ANTICIPO', 'SUSPENDER', 'CANCELAR']));
  it('habilita conversión sólo después del hito', () => expect(allowedQuoteActions(Stage.ACEPTO_ANTICIPO)).toContain('CONVERTIR'));
  it.each([Stage.SUSPENDIDA, Stage.CANCELADA, Stage.CONVERTIDA_EXPEDIENTE])('cierra acciones en %s', (stage) => expect(allowedQuoteActions(stage)).toEqual([]));
  it('distingue reenvío sin cambiar etapa', () => expect(quoteActionResult(Stage.ENVIADA_CLIENTE, 'REENVIAR_CLIENTE')).toEqual({ next: Stage.ENVIADA_CLIENTE, changesStage: false }));
  it('bloquea el bypass de transición', () => expect(() => quoteActionResult(Stage.BORRADOR, 'CONVERTIR')).toThrow(/no corresponde/i));
  it('proyecta el hito conjunto sin crear una etapa financiera', () => expect(quoteLegacyProjection(Stage.ACEPTO_ANTICIPO)).toBe(CotizacionEstado.ACEPTADA));
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
