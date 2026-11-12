import { describe, expect, it } from 'vitest';
import { SAT_COMPROBANTE_CATALOG_SOURCE, SAT_ENABLED_CURRENCIES, SAT_EXPORT_CODES, SAT_PAYMENT_FORMS,
  satEnabledCurrency, satExportCode, satPaymentForm } from './satCfdiComprobanteCatalog';

describe('Catálogos de comprobante SAT versionados', () => {
  it('conserva la procedencia del XLS local verificado y no se declara catálogo completo de monedas', () => {
    expect(SAT_COMPROBANTE_CATALOG_SOURCE).toMatchObject({ archivo: 'catCFDI_V_4_20261029.xls',
      sha256: 'ca9536cc4e4af64e2f2e0afc527f08bd0d1601e9d30a25d93dc4dcc4e256573b',
      bytes: 48773632 });
    expect(SAT_PAYMENT_FORMS).toHaveLength(22);
    expect(SAT_EXPORT_CODES).toHaveLength(4);
    expect(SAT_ENABLED_CURRENCIES.map((item) => item.clave)).toEqual(['MXN', 'USD', 'CAD']);
    expect(new Set(SAT_PAYMENT_FORMS.map((item) => item.clave)).size).toBe(22);
  });

  it('rechaza claves que no están en el snapshot y conserva el cero inicial', () => {
    expect(satPaymentForm('03')?.descripcion).toBe('Transferencia electrónica de fondos');
    expect(satPaymentForm('3')).toBeNull();
    expect(satPaymentForm('07')).toBeNull();
    expect(satExportCode('01')?.descripcion).toBe('No aplica');
    expect(satExportCode('99')).toBeNull();
    expect(satEnabledCurrency('CAD')?.descripcion).toBe('Dólar Canadiense');
    expect(satEnabledCurrency('ZZZ')).toBeNull();
  });
});
