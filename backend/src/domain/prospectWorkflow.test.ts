import { describe, expect, it } from 'vitest';
import { ProspectoEtapaContractual as Stage } from '@prisma/client';
import { allowedProspectActions, nextProspectStage, prospectEffectiveAt, prospectWait } from './prospectWorkflow';

describe('PRO-001 effective business date', () => {
  const now = new Date('2026-08-31T20:00:00Z');
  it.each(['2026-02-30T12:00:00Z', '2026-02-29T12:00:00Z', '2026-04-31T12:00:00Z',
    '2026-08-30T24:00:00Z', '2026-08-30T12:60:00Z', '2026-08-30T12:00:00',
    '2026-08-30', '2026-08-30T12:00:00+24:00', false, 0])('rejects invalid calendar/zone instead of normalizing %s', (value) => {
    expect(() => prospectEffectiveAt(value, now, null)).toThrow();
  });
  it('accepts an actual leap day and preserves its instant', () => {
    expect(prospectEffectiveAt('2024-02-29T12:00:00-06:00', now, null).toISOString()).toBe('2024-02-29T18:00:00.000Z');
  });
  it('accepts seconds or milliseconds with an explicit zone', () => {
    expect(prospectEffectiveAt('2026-08-31T13:59:59.123-06:00', now, null).toISOString()).toBe('2026-08-31T19:59:59.123Z');
  });
  it('uses recording instant only for the explicit current action, never a historical fallback', () => {
    expect(prospectEffectiveAt(undefined, now, null)).toBe(now);
    expect(() => prospectEffectiveAt(undefined, now, null, true)).toThrow();
    expect(() => prospectEffectiveAt('2026-09-01T00:00:00Z', now, null)).toThrow();
    expect(() => prospectEffectiveAt('2026-08-30T00:00:00Z', now, now)).toThrow();
  });
});

describe('Corrección 001 · workflow operativo Prospecto → Cotización', () => {
  it('expone sólo la acción contextual de avance y las salidas excepcionales', () => {
    expect(allowedProspectActions(Stage.NUEVO, false)).toEqual(['COMENZAR_INTEGRACION', 'SUSPENDER', 'CANCELAR']);
    expect(allowedProspectActions(Stage.EN_INTEGRACION, false)).toEqual(['MARCAR_LISTO_PARA_COTIZAR', 'SUSPENDER', 'CANCELAR']);
    expect(allowedProspectActions(Stage.LISTO_PARA_COTIZAR, false)).toEqual(['CONVERTIR', 'SUSPENDER', 'CANCELAR']);
    expect(allowedProspectActions(Stage.CONVERTIDO_EN_COTIZACION, true)).toEqual([]);
  });

  it('produce exactamente la cadena aprobada y bloquea saltos o escrituras legacy', () => {
    expect(nextProspectStage(Stage.NUEVO, 'COMENZAR_INTEGRACION')).toBe(Stage.EN_INTEGRACION);
    expect(nextProspectStage(Stage.EN_INTEGRACION, 'MARCAR_LISTO_PARA_COTIZAR')).toBe(Stage.LISTO_PARA_COTIZAR);
    expect(nextProspectStage(Stage.LISTO_PARA_COTIZAR, 'CONVERTIR')).toBe(Stage.CONVERTIDO_EN_COTIZACION);
    expect(() => nextProspectStage(Stage.NUEVO, 'CONVERTIR')).toThrow();
    expect(allowedProspectActions(Stage.EN_ESPERA_COTIZACION, false)).toEqual([]);
  });

  it('distingue esperas nuevas de hechos legacy conservados sólo para lectura', () => {
    expect(prospectWait(Stage.EN_INTEGRACION)).toMatchObject({ type: 'CLIENTE_DOCUMENTOS', knowledge: 'KNOWN' });
    expect(prospectWait(Stage.LISTO_PARA_COTIZAR)).toMatchObject({ type: 'OFFICE_QUOTE', knowledge: 'KNOWN' });
    expect(prospectWait(Stage.EN_ESPERA_COTIZACION)).toMatchObject({ type: 'NOTARIA', label: expect.stringContaining('histórico') });
  });
});
