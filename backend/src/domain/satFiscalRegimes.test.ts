import { describe, expect, it } from 'vitest';
import { SAT_CFDI_CATALOG_SOURCE, SAT_CFDI_USES, SAT_FISCAL_REGIMES, mapLiteralSatRegime, satCfdiUse,
  satCfdiUseCompatible, satRegime } from './satFiscalRegimes';

describe('catálogo fiscal verificado para alta de emisor', () => {
  it('mapea una denominación literal exacta sin inventar una clave impresa', () => {
    expect(mapLiteralSatRegime('Régimen de Sueldos y Salarios e Ingresos Asimilados a Salarios')?.clave).toBe('605');
    expect(mapLiteralSatRegime('Régimen desconocido de prueba')).toBeNull();
  });
  it('no acepta una clave arbitraria o fixture sintética como régimen oficial', () => {
    expect(satRegime('601')?.tipo).toBe('MORAL');
    expect(satRegime('605')?.tipo).toBe('FISICA');
    expect(satRegime('999')).toBeNull();
    expect(satRegime('901')).toBeNull();
  });
  it('importa el snapshot oficial completo, versionado y sin claves duplicadas', () => {
    expect(SAT_CFDI_CATALOG_SOURCE.archivo).toBe('catCFDI_V_4_20261029.xls');
    expect(SAT_CFDI_CATALOG_SOURCE.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(SAT_FISCAL_REGIMES).toHaveLength(19);
    expect(SAT_CFDI_USES).toHaveLength(24);
    expect(new Set(SAT_FISCAL_REGIMES.map(item => item.clave)).size).toBe(19);
    expect(new Set(SAT_CFDI_USES.map(item => item.clave)).size).toBe(24);
    expect(SAT_CFDI_USES.flatMap(item => item.regimenesReceptor).every(code => satRegime(code))).toBe(true);
    expect(satRegime('616')?.descripcion).toBe('Sin obligaciones fiscales');
    expect(satRegime('601', '2021-12-31')).toBeNull();
  });
  it('aplica vigencia, tipo de persona y compatibilidad real de Uso CFDI', () => {
    expect(satCfdiUse('G03')?.descripcion).toBe('Gastos en general.');
    expect(satCfdiUse('ZZZ')).toBeNull();
    expect(satCfdiUseCompatible('G03', '601', 'MORAL')).toBe(true);
    expect(satCfdiUseCompatible('G03', '612', 'FISICA')).toBe(true);
    expect(satCfdiUseCompatible('G03', '605', 'FISICA')).toBe(false);
    expect(satCfdiUseCompatible('G03', '601', 'FISICA')).toBe(false);
    expect(satCfdiUseCompatible('G03', '601', 'MORAL', '2021-12-31')).toBe(false);
  });
});
