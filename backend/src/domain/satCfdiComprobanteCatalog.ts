import catalog from './satCfdiComprobanteCatalog_20261029.json';

// Selección de comprobante derivada de las hojas c_FormaPago,
// c_Exportacion y c_Moneda del XLS indicado en fuente. La lista de monedas
// habilitadas es un subconjunto operativo; no se presenta como catálogo total.
export const SAT_COMPROBANTE_CATALOG_SOURCE = catalog.fuente;
export const SAT_PAYMENT_FORMS = catalog.formasPago;
export const SAT_EXPORT_CODES = catalog.exportaciones;
export const SAT_ENABLED_CURRENCIES = catalog.monedasHabilitadas;

export const satPaymentForm = (code: string) => SAT_PAYMENT_FORMS.find((item) => item.clave === code) || null;
export const satExportCode = (code: string) => SAT_EXPORT_CODES.find((item) => item.clave === code) || null;
export const satEnabledCurrency = (code: string) => SAT_ENABLED_CURRENCIES.find((item) => item.clave === code) || null;
