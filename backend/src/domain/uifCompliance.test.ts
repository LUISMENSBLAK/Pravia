import { describe, expect, it } from 'vitest';
import {
  canCreateUrgentNotice,
  evaluateInternalRisk,
  evaluateRealEstateCashRestriction,
  evaluateVulnerableActivity,
  ordinaryNoticeDeadline,
  resolveUma,
  retentionUntil,
  screeningStateFromTextMatch,
  validatePaymentDistribution,
} from './uifCompliance';

const uma = [
  { year: 2025, dailyValueMxn: 113.14, effectiveFrom: '2025-02-01', effectiveTo: '2026-01-31', sourceUrl: 'https://www.inegi.org.mx/' },
  { year: 2026, dailyValueMxn: 117.31, effectiveFrom: '2026-02-01', effectiveTo: '2027-01-31', sourceUrl: 'https://www.inegi.org.mx/' },
];
const base = { operationDate: '2026-08-17', clientId: 'party-1' };

describe('motor determinista LFPIORPI artículo 17 XII-A', () => {
  it('inmueble por debajo de 8,000 UMA requiere identificación, no Aviso', () => {
    const result = evaluateVulnerableActivity({ ...base, activity: 'TRANSMISION_DERECHOS_REALES_INMUEBLES', priceMxn: 938_479.99 }, uma);
    expect(result).toMatchObject({ activityVulnerable: 'SI', identificationRequired: 'SI', noticeRequired: 'NO', noticeThresholdMxn: 938_480 });
  });

  it('inmueble exactamente en 8,000 UMA requiere Aviso', () => {
    const result = evaluateVulnerableActivity({ ...base, activity: 'TRANSMISION_DERECHOS_REALES_INMUEBLES', priceMxn: 938_480 }, uma);
    expect(result.noticeRequired).toBe('SI');
    expect(result.channel).toBe('DECLARANOT');
  });

  it('inmueble un centavo por encima requiere Aviso', () => {
    expect(evaluateVulnerableActivity({ ...base, activity: 'TRANSMISION_DERECHOS_REALES_INMUEBLES', priceMxn: 938_480.01 }, uma).noticeRequired).toBe('SI');
  });

  it.each([
    'PODER_IRREVOCABLE_ADMINISTRACION_DOMINIO',
    'CONSTITUCION_MODIFICACION_PERSONA_MORAL',
    'MUTUO_CREDITO_NO_FINANCIERO',
  ] as const)('%s genera Aviso siempre', (activity) => {
    expect(evaluateVulnerableActivity({ ...base, activity }, uma)).toMatchObject({ noticeRequired: 'SI', noticeThresholdUma: null, channel: 'SPPLD' });
  });

  it('fideicomiso debajo de 4,000 UMA no genera Aviso por importe', () => {
    expect(evaluateVulnerableActivity({ ...base, activity: 'FIDEICOMISO_TRASLATIVO_GARANTIA', operationAmountMxn: 469_239.99 }, uma).noticeRequired).toBe('NO');
  });

  it('fideicomiso exactamente en 4,000 UMA genera Aviso', () => {
    const result = evaluateVulnerableActivity({ ...base, activity: 'FIDEICOMISO_TRASLATIVO_GARANTIA', operationAmountMxn: 469_240 }, uma);
    expect(result).toMatchObject({ noticeRequired: 'SI', noticeThresholdUma: 4_000, noticeThresholdMxn: 469_240 });
  });

  it('rechaza una fecha sin UMA versionada aplicable', () => {
    expect(() => resolveUma('2024-01-01', uma)).toThrowError(expect.objectContaining({ code: 'UIF_UMA_DATE_MISMATCH' }));
  });

  it('usa la UMA que corresponde a la fecha jurídica y no la más reciente', () => {
    const result = evaluateVulnerableActivity({ operationDate: '2025-12-10', clientId: 'p1', activity: 'TRANSMISION_DERECHOS_REALES_INMUEBLES', priceMxn: 905_120 }, uma);
    expect(result.uma.year).toBe(2025);
    expect(result.noticeThresholdMxn).toBe(905_120);
  });

  it('datos monetarios incompletos producen indeterminado sin inventar', () => {
    expect(evaluateVulnerableActivity({ ...base, activity: 'TRANSMISION_DERECHOS_REALES_INMUEBLES' }, uma)).toMatchObject({ activityVulnerable: 'SI', noticeRequired: 'INDETERMINADA', noticeStatus: 'POR_DETERMINAR' });
  });

  it('acto fuera del alcance no se fuerza a actividad vulnerable', () => {
    expect(evaluateVulnerableActivity({ ...base, activity: 'OTRA' }, uma)).toMatchObject({ activityVulnerable: 'NO', noticeRequired: 'INDETERMINADA' });
  });
});

describe('acumulación reglamentaria', () => {
  const operation = (id: string, date: string, amountMxn: number, overrides = {}) => ({ id, clientId: 'party-1', activity: 'TRANSMISION_DERECHOS_REALES_INMUEBLES' as const, operationDate: date, amountMxn, isIdentifiable: true, ...overrides });

  it('acumula por cliente y tipo dentro de seis meses y muestra integrantes', () => {
    const result = evaluateVulnerableActivity({ ...base, activity: 'TRANSMISION_DERECHOS_REALES_INMUEBLES', priceMxn: 500_000, relatedOperations: [operation('op-1', '2026-04-01', 438_480)] }, uma);
    expect(result).toMatchObject({ accumulatedAmountMxn: 938_480, noticeRequired: 'SI' });
    expect(result.includedOperations.map((item) => item.id)).toEqual(['op-1']);
  });

  it('no acumula fuera de ventana, otro cliente, otro tipo o no identificable', () => {
    const related = [
      operation('old', '2026-02-16', 500_000),
      operation('other-client', '2026-07-01', 500_000, { clientId: 'party-2' }),
      operation('other-type', '2026-07-01', 500_000, { activity: 'FIDEICOMISO_TRASLATIVO_GARANTIA' }),
      operation('not-identifiable', '2026-07-01', 500_000, { isIdentifiable: false }),
    ];
    const result = evaluateVulnerableActivity({ ...base, activity: 'TRANSMISION_DERECHOS_REALES_INMUEBLES', priceMxn: 100_000, relatedOperations: related }, uma);
    expect(result.includedOperations).toEqual([]);
    expect(result.accumulatedAmountMxn).toBe(100_000);
  });

  it('evita doble conteo por id', () => {
    const repeated = operation('same', '2026-07-01', 100_000);
    const result = evaluateVulnerableActivity({ ...base, activity: 'TRANSMISION_DERECHOS_REALES_INMUEBLES', priceMxn: 100_000, relatedOperations: [repeated, repeated] }, uma);
    expect(result.accumulatedAmountMxn).toBe(200_000);
  });
});

describe('forma de pago y restricción independiente de efectivo', () => {
  const cash = (amountMxn: number) => [{ id: 'p1', method: 'EFECTIVO_MXN' as const, amountMxn, paymentDate: '2026-08-17' }];

  it('valida que las formas de pago no excedan el total', () => {
    expect(() => validatePaymentDistribution(100, cash(100.01), false)).toThrowError(expect.objectContaining({ code: 'UIF_PAYMENT_SUM_EXCEEDED' }));
  });

  it('exige igualdad cuando la distribución se declara completa', () => {
    expect(() => validatePaymentDistribution(100, cash(99.99), true)).toThrowError(expect.objectContaining({ code: 'UIF_PAYMENT_SUM_INCOMPLETE' }));
    expect(validatePaymentDistribution(100, cash(100), true).remainingAmountMxn).toBe(0);
  });

  it('inmueble por debajo de 8,025 UMA cumple la prueba de umbral', () => {
    expect(evaluateRealEstateCashRestriction({ operationValueMxn: 941_412.74, payments: cash(10_000) }, uma).status).toBe('CUMPLE');
  });

  it('exactamente 8,025 UMA con efectivo requiere revisión', () => {
    const result = evaluateRealEstateCashRestriction({ operationValueMxn: 941_412.75, payments: cash(10_000) }, uma);
    expect(result).toMatchObject({ status: 'REQUIERE_REVISION', thresholdUma: 8_025, thresholdMxn: 941_412.75, excessMxn: 10_000 });
  });

  it('demuestra que 8,000 UMA y 8,025 UMA son reglas distintas', () => {
    const activity = evaluateVulnerableActivity({ ...base, activity: 'TRANSMISION_DERECHOS_REALES_INMUEBLES', priceMxn: 940_000 }, uma);
    const restriction = evaluateRealEstateCashRestriction({ operationValueMxn: 940_000, payments: cash(10_000) }, uma);
    expect(activity.noticeRequired).toBe('SI');
    expect(restriction.status).toBe('CUMPLE');
    expect(activity.noticeThresholdUma).not.toBe(restriction.thresholdUma);
  });

  it('no acusa incumplimiento si falta el valor de la operación', () => {
    expect(evaluateRealEstateCashRestriction({ payments: cash(10_000) }, uma).status).toBe('REQUIERE_INFORMACION');
  });
});

describe('controles humanos, riesgo y obligaciones', () => {
  it('una coincidencia textual nunca confirma PEP ni lista', () => expect(screeningStateFromTextMatch()).toBe('POTENTIAL_MATCH'));

  it('no crea aviso urgente sin match confirmado, evidencia y regla vigente', () => {
    expect(canCreateUrgentNotice({ screeningState: 'POTENTIAL_MATCH', evidenceVerified: true, ruleStatus: 'VIGENTE' })).toBe(false);
    expect(canCreateUrgentNotice({ screeningState: 'CONFIRMED_MATCH', evidenceVerified: false, ruleStatus: 'VIGENTE' })).toBe(false);
    expect(canCreateUrgentNotice({ screeningState: 'CONFIRMED_MATCH', evidenceVerified: true, ruleStatus: 'PENDIENTE_DE_IMPLEMENTACION_NORMATIVA' })).toBe(false);
    expect(canCreateUrgentNotice({ screeningState: 'CONFIRMED_MATCH', evidenceVerified: true, ruleStatus: 'VIGENTE' })).toBe(true);
  });

  it('separa score interno de probabilidad y declara el estado normativo pendiente', () => {
    const result = evaluateInternalRisk({ beneficialOwnerUndetermined: true, documentaryContradiction: true, pepConfirmedByHuman: true });
    expect(result).toMatchObject({ level: 'REQUIERE_REVISION', normativeStatus: 'PENDIENTE_DE_IMPLEMENTACION_NORMATIVA' });
    expect(result).not.toHaveProperty('probability');
    expect(result.disclaimer).toMatch(/No constituye una determinación de ilicitud/);
  });

  it('calcula plazo ordinario al día 17 del mes inmediato siguiente', () => {
    expect(ordinaryNoticeDeadline('2026-08-31').toISOString()).toBe('2026-09-17T23:59:59.999Z');
  });

  it('calcula conservación de diez años sin ordenar eliminación', () => {
    expect(retentionUntil('2026-08-17').toISOString().slice(0, 10)).toBe('2036-08-17');
  });
});
