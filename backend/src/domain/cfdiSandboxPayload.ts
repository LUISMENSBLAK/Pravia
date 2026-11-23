import { Prisma, type DocumentoCfdi, type EntidadFiscalCfdi } from '@prisma/client';
import type { FacturamaPayload } from '../services/facturamaSandboxProvider';

const object = (value: unknown): Record<string, any> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, any> : {};
const string = (value: unknown) => String(value ?? '').trim();

/** Maps only the persisted canonical snapshot. No injected defaults, guessed
 * fiscal regimes/tax rates or data from the caller's request body. */
export function cfdiSandboxPayload(row: DocumentoCfdi, entity: EntidadFiscalCfdi, date: string): FacturamaPayload {
  const payload = object(row.draft_payload), fiscal = object(payload.fiscal_comprobante);
  const fail = (message: string): never => { throw new Error(message); };
  if (!entity.activa || entity.rfc !== row.emisor_rfc) fail('El emisor activo no coincide con el borrador.');
  const issuerRegime = string(fiscal.regimen_emisor) || entity.regimen_fiscal;
  const regimes = Array.isArray(entity.regimenes_fiscales) ? entity.regimenes_fiscales.map((item) => string(object(item).clave)) : [entity.regimen_fiscal];
  if (!regimes.includes(issuerRegime)) fail('Confirma un régimen del emisor registrado.');
  if (!row.internal_folio || row.tipo !== 'I' || row.direccion !== 'EMITIDO' || payload.incomplete_income) fail('Completa y guarda una prefactura de ingreso.');
  if (payload.complemento_notarios || payload.retenciones) fail('Los complementos requieren una integración específica; no se omiten para timbrar.');
  if (!Array.isArray(payload.concepts) || !payload.concepts.length) fail('Faltan conceptos fiscales canónicos.');
  const number = (value: unknown) => {
    if (value === undefined || value === null || string(value) === '') return fail('Falta un importe o tasa fiscal del concepto.');
    const result = new Prisma.Decimal(string(value));
    if (!result.isFinite() || result.lt(0)) return fail('El concepto contiene un importe inválido.');
    return result.toNumber();
  };
  const Items = payload.concepts.map((raw: unknown) => {
    const item = object(raw), base = number(item.subtotal);
    const Taxes: NonNullable<FacturamaPayload['Items'][number]['Taxes']> = [];
    // A zero-rate IVA is distinct from a concept that is not subject to tax.
    if (string(item.objeto_impuesto) === '02') Taxes.push({ Name: 'IVA', Base: base, Rate: number(item.iva_tasa), Total: number(item.iva), IsRetention: false });
    for (const [amount, rate, Name] of [['iva_retencion', 'iva_retencion_tasa', 'IVA'], ['isr_retencion', 'isr_retencion_tasa', 'ISR']] as const) {
      if (number(item[amount]) > 0) Taxes.push({ Name, Base: base, Rate: number(item[rate]), Total: number(item[amount]), IsRetention: true });
    }
    return { ProductCode: string(item.clave_prod_serv), Description: string(item.descripcion), UnitCode: string(item.clave_unidad),
      Quantity: number(item.cantidad), UnitPrice: number(item.valor_unitario), Subtotal: base, TaxObject: string(item.objeto_impuesto),
      Total: number(item.total), ...(Taxes.length ? { Taxes } : {}) };
  });
  const sum = (key: 'Subtotal' | 'Total') => Items.reduce((total: Prisma.Decimal, item: FacturamaPayload['Items'][number]) => total.plus(item[key]), new Prisma.Decimal(0));
  const transferred = Items.flatMap((item: FacturamaPayload['Items'][number]) => item.Taxes || []).filter((tax: any) => !tax.IsRetention).reduce((total: Prisma.Decimal, tax: any) => total.plus(tax.Total), new Prisma.Decimal(0));
  const retained = Items.flatMap((item: FacturamaPayload['Items'][number]) => item.Taxes || []).filter((tax: any) => tax.IsRetention).reduce((total: Prisma.Decimal, tax: any) => total.plus(tax.Total), new Prisma.Decimal(0));
  if (!sum('Subtotal').eq(row.subtotal) || !sum('Total').eq(row.total) || !transferred.eq(row.impuestos_trasladados) || !retained.eq(row.impuestos_retenidos)) fail('Los conceptos no cuadran con los importes persistidos.');
  return { Folio: row.internal_folio!, Date: date, CfdiType: 'I', Currency: row.moneda,
    PaymentMethod: row.metodo_pago as 'PUE' | 'PPD', PaymentForm: string(row.forma_pago), ExpeditionPlace: string(fiscal.lugar_expedicion),
    Exportation: string(fiscal.exportacion), ...(fiscal.tipo_cambio ? { ExchangeRate: number(fiscal.tipo_cambio) } : {}),
    ...(fiscal.condiciones_pago ? { PaymentConditions: string(fiscal.condiciones_pago) } : {}),
    Observations: 'PRUEBA SANDBOX PRAVIA — SIN VALIDEZ FISCAL',
    Issuer: { Rfc: row.emisor_rfc, Name: row.emisor_nombre, FiscalRegime: issuerRegime },
    Receiver: { Rfc: row.receptor_rfc, Name: row.receptor_nombre, FiscalRegime: string(row.receptor_regimen), TaxZipCode: string(row.receptor_codigo_postal), CfdiUse: string(row.uso_cfdi) }, Items };
}
