import { Prisma } from '@prisma/client';
import { describe, expect, it } from 'vitest';
import annex from '../../data/fiscal/isr-annex9-2026-20260717.json';
import { fullFiscalYears, updateISRAcquisition } from './isrAcquisitionUpdate';
import type { ISRRuleSetSnapshot } from './isrTaxEngine';

type Reference = NonNullable<ISRRuleSetSnapshot['referenceTables']>[number];
const ref = (code: string, value: unknown, patch: Partial<Reference> = {}): Reference => ({ id: code, type: 'SYNTHETIC_QA', code, version: 1, effectiveFrom: '2026-01-01', effectiveTo: '2026-12-31', sourceTitle: 'Parámetros sintéticos QA; no autoridad fiscal', sourceUrl: 'https://qa.example.test/not-official', value, ...patch });
const policy = ref('ISR_ACQUISITION_UPDATE_POLICY', { statutoryLandPercent: '20', constructionAnnualDepreciationPercent: '3', constructionMinimumRemainingPercent: '20', minimumUpdateFactor: '1', factorDecimals: 4, factorRounding: 'DOWN', annex9ConstructionBase: 'APPLY_BEFORE_FACTOR' });
const series = ref('ISR_INPC_SERIES', { base: 'SYNTHETIC_QA_COMMON_BASE', months: { '2025-05': '100', '2026-10': '105.12345' } });
const table = ref(annex.code, annex, { type: 'FACTOR', version: annex.version, effectiveFrom: annex.effectiveFrom, effectiveTo: annex.effectiveTo, sourceUrl: annex.sourceUrl, sourceTitle: annex.sourceTitle });
const sample = () => ({ historical: { method: 'AUTO' as const, separation: 'EXPLICIT' as const, land: '1000' }, acquisitionDate: '2025-05-26', operationDate: '2026-11-11', propertyIsLand: true, references: [policy, series, table] });

describe('ISR · actualización histórica dentro del motor canónico', () => {
  it('compara INPC y Anexo 9 realmente y conserva ambas alternativas/procedencia', () => {
    const result = updateISRAcquisition(sample());
    expect(result).toMatchObject({ missing: [], land: '1051.20', construction: '0.00', chosenMethod: 'INPC' });
    expect(result.alternatives.map((item) => [item.method, item.factor, item.total])).toEqual([['INPC', '1.0512', '1051.20'], ['FACTORES', '1.04', '1040.00']]);
    expect(result.inputs).toMatchObject({ inpcFromMonth: '2025-05', inpcToMonth: '2026-10', policyVersion: '1' });
  });
  it('método explícito no necesita la otra tabla; AUTO no presume mejor resultado sin ella', () => {
    expect(updateISRAcquisition({ ...sample(), historical: { method: 'FACTORES', separation: 'EXPLICIT', land: '1000' }, references: [policy, table] })).toMatchObject({ missing: [], chosenMethod: 'FACTORES', land: '1040.00' });
    const incomplete = updateISRAcquisition({ ...sample(), references: [policy, series] });
    expect(incomplete.chosenMethod).toBeNull(); expect(incomplete.land).toBeNull(); expect(incomplete.missing.join(' ')).toContain('Anexo 9'); expect(incomplete.alternatives).toHaveLength(1);
  });
  it('20/80, depreciación anual y mínimo vienen de una política versionada, no del input', () => {
    const result = updateISRAcquisition({ ...sample(), propertyIsLand: false, historical: { method: 'INPC', separation: 'STATUTORY', total: '1000000' } });
    expect(result.inputs).toMatchObject({ historicalLand: '200000.00', historicalConstruction: '800000.00', depreciatedConstruction: '776000.00' });
    expect(result).toMatchObject({ land: '210240.00', construction: '815731.20', missing: [] });
    expect(updateISRAcquisition({ ...sample(), references: [series, table] }).land).toBeNull();
  });
  it('piso de construcción evita costos negativos, según política verificada', () => {
    const result = updateISRAcquisition({ ...sample(), acquisitionDate: '1980-11-11', propertyIsLand: false, historical: { method: 'FACTORES', separation: 'EXPLICIT', land: '1000', construction: '1000' } });
    expect(result.inputs.depreciatedConstruction).toBe('200.00'); expect(result.missing).toEqual([]);
  });
  it('fecha inexistente, índice cero y tablas ambiguas producen faltante, nunca valor inventado', () => {
    expect(updateISRAcquisition({ ...sample(), acquisitionDate: '2025-02-30' }).land).toBeNull();
    expect(updateISRAcquisition({ ...sample(), references: [policy, ref('ISR_INPC_SERIES', { base: 'QA', months: { '2025-05': '0', '2026-10': '105' } }), table] }).chosenMethod).toBeNull();
    const overlap = ref('ISR_ANNEX9_FACTORS', { taxYear: 2026, rows: [annex.rows[1], annex.rows[1]] });
    expect(updateISRAcquisition({ ...sample(), references: [policy, series, overlap] }).missing.join(' ')).toContain('intervalo único');
  });
  it('no utiliza una revisión vencida ni mezcla versiones por orden incidental', () => {
    const expired = { ...series, effectiveTo: '2026-01-01' };
    expect(updateISRAcquisition({ ...sample(), references: [policy, expired, table] }).land).toBeNull();
    const updated = ref('ISR_INPC_SERIES', { base: 'QA', months: { '2025-05': '100', '2026-10': '110' } }, { version: 2 });
    expect(updateISRAcquisition({ ...sample(), references: [policy, series, updated, table] })).toMatchObject({ land: '1100.00', chosenMethod: 'INPC' });
  });
  it('tabla oficial completa conserva 97 intervalos, cifras no monótonas y huella del PDF', () => {
    expect(annex.rows).toHaveLength(97); expect(annex.sourceSha256).toBe('9f12f91583bd9caaf8e2185e72bb9d66b9e98bc98aa43322bf0d159a92503181');
    expect(annex.rows[65].factor).toBe('14384.83'); expect(annex.rows[64].factor).toBe('14489.13');
    expect(annex.rows[96]).toEqual({ moreThanYears: 96, upToYears: null, factor: '144500.58' });
  });
  it.each(annex.rows.map((row, index) => ({ ...row, index })))('resuelve intervalo oficial $index sin redondear años hacia arriba', (row) => {
    const years = row.upToYears ?? 97;
    const result = updateISRAcquisition({ ...sample(), acquisitionDate: `${2026 - years}-11-11`, historical: { method: 'FACTORES', separation: 'EXPLICIT', land: '1000' }, references: [policy, table] });
    expect(result.missing).toEqual([]); expect(result.land).toBe(new Prisma.Decimal(row.factor).times(1000).toFixed(2));
  });
  it('límites exactos de aniversario y febrero bisiesto son determinísticos', () => {
    expect(fullFiscalYears(new Date('2024-02-29T00:00:00Z'), new Date('2025-02-28T00:00:00Z'))).toBe(1);
    const exact = updateISRAcquisition({ ...sample(), acquisitionDate: '2025-11-11', historical: { method: 'FACTORES', separation: 'EXPLICIT', land: '1000' }, references: [policy, table] });
    expect(exact.land).toBe('1000.00');
    const after = updateISRAcquisition({ ...sample(), acquisitionDate: '2025-11-10', historical: { method: 'FACTORES', separation: 'EXPLICIT', land: '1000' }, references: [policy, table] });
    expect(after.land).toBe('1040.00');
  });
});
