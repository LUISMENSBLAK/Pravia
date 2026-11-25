import { Prisma } from '@prisma/client';
import type { CfdiProvider, CfdiProviderDraft, CfdiProviderStampResult } from './cfdiProvider';
import { parseCfdi40Xml } from './financeFiscal.service';

/** Complete CFDI input. Values come from the persisted fiscal snapshot, never
 * from DOM text, a chat answer, or provider defaults. Sandbox only. */
export type FacturamaPayload = {
  Folio: string; Date: string; Serie?: string; CfdiType: 'I'; Currency: string;
  PaymentForm: string; PaymentMethod: 'PUE' | 'PPD'; ExpeditionPlace: string; Exportation: string;
  ExchangeRate?: number; PaymentConditions?: string; Observations?: string;
  Issuer: { Rfc: string; Name: string; FiscalRegime: string };
  Receiver: { Rfc: string; Name: string; FiscalRegime: string; TaxZipCode: string; CfdiUse: string };
  Items: Array<{ ProductCode: string; Description: string; UnitCode: string; UnitPrice: number; Quantity: number;
    Subtotal: number; TaxObject: string; Total: number; Discount?: number;
    Taxes?: Array<{ Name: 'IVA' | 'ISR'; Base: number; Rate: number; Total: number; IsRetention: boolean }> }>;
};

export class FacturamaSandboxError extends Error {
  constructor(readonly code: string, message: string, readonly status = 502, readonly providerReference?: string, readonly validationFields: string[] = []) { super(message); }
}

const fail = (message: string): never => { throw new FacturamaSandboxError('FACTURAMA_DRAFT_INVALID', message, 422); };
const amount = (value: unknown) => {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return fail('El borrador contiene un importe inválido.');
  return new Prisma.Decimal(value);
};
export function validateFacturamaPayload(draft: CfdiProviderDraft, payload: FacturamaPayload) {
  if (!payload || draft.tipo !== 'I' || payload.CfdiType !== 'I' || draft.version !== '4.0') fail('Esta integración sandbox admite únicamente CFDI de ingreso 4.0.');
  if (!payload.Folio?.trim() || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(payload.Date)) fail('Folio y fecha persistentes son obligatorios; no se regeneran en un reintento.');
  const date = new Date(`${payload.Date}Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 19) !== payload.Date) fail('La fecha fiscal no existe.');
  if (payload.Issuer?.Rfc !== 'EKU9003173C9' || payload.Receiver?.Rfc !== 'URE180429TM6') fail('Esta fase sandbox sólo admite los dos RFC públicos de prueba del proveedor; no transmite receptores reales.');
  if (payload.Issuer?.Rfc !== draft.emisorRfc || payload.Receiver?.Rfc !== draft.receptorRfc || payload.PaymentMethod !== draft.metodoPago) fail('El payload no corresponde al borrador fiscal.');
  if (![payload.Issuer?.Name, payload.Receiver?.Name].every((item) => typeof item === 'string' && item.trim()) ||
      !/^\d{3}$/.test(payload.Issuer?.FiscalRegime) || !/^\d{3}$/.test(payload.Receiver?.FiscalRegime) ||
      !/^\d{5}$/.test(payload.Receiver?.TaxZipCode) || !/^\d{5}$/.test(payload.ExpeditionPlace) ||
      !/^[A-Z]\d{2}$/.test(payload.Receiver?.CfdiUse) || !/^\d{2}$/.test(payload.PaymentForm) || !/^\d{2}$/.test(payload.Exportation)) fail('Completa los datos fiscales confirmados.');
  if (!['MXN', 'USD', 'CAD'].includes(payload.Currency) || (payload.Currency !== 'MXN' && !(payload.ExchangeRate && payload.ExchangeRate > 0))) fail('Moneda o tipo de cambio incompletos.');
  if (!['PUE', 'PPD'].includes(payload.PaymentMethod) || (payload.PaymentMethod === 'PPD' && payload.PaymentForm !== '99')) fail('Método y forma de pago incompatibles.');
  if (!payload.Items?.length || payload.Items.length > 20) fail('Selecciona conceptos fiscales completos.');
  let total = new Prisma.Decimal(0);
  for (const item of payload.Items) {
    if (!/^\d{8}$/.test(item.ProductCode) || !/^[A-Z0-9]{2,3}$/.test(item.UnitCode) || !item.Description?.trim() || !['01', '02', '03', '04', '05', '06', '07', '08'].includes(item.TaxObject)) fail('Concepto fiscal incompleto.');
    const quantity = amount(item.Quantity); if (quantity.lte(0)) fail('La cantidad debe ser positiva.');
    const subtotal = amount(item.Subtotal), discount = amount(item.Discount || 0);
    if (!quantity.times(amount(item.UnitPrice)).toDecimalPlaces(2).equals(subtotal) || discount.gt(subtotal)) fail('El subtotal del concepto no cuadra.');
    let line = subtotal.minus(discount);
    for (const tax of item.Taxes || []) {
      const rate = amount(tax.Rate), base = amount(tax.Base), value = amount(tax.Total);
      if (!['IVA', 'ISR'].includes(tax.Name) || typeof tax.IsRetention !== 'boolean' || rate.gt(1) || !base.equals(subtotal.minus(discount)) || !base.times(rate).toDecimalPlaces(2).equals(value)) fail('Los impuestos deben coincidir con las tasas e importes canónicos.');
      line = tax.IsRetention ? line.minus(value) : line.plus(value);
    }
    if (item.TaxObject === '01' && item.Taxes?.length) fail('Un concepto no objeto no puede contener impuestos.');
    if (!line.equals(amount(item.Total))) fail('El total del concepto no cuadra.');
    total = total.plus(line);
  }
  if (!total.equals(draft.total) || total.lte(0)) fail('El total no coincide con el borrador persistido.');
}

/** Only the explicitly guarded local sandbox factory can select this adapter. */
export class FacturamaSandboxProvider implements CfdiProvider {
  readonly id = 'FACTURAMA_SANDBOX';
  readonly configured: boolean;
  private readonly authorization: string;
  constructor(credentials: { username: string; password: string }, private readonly http: typeof fetch = fetch) {
    this.configured = Boolean(credentials.username.trim() && credentials.password);
    this.authorization = `Basic ${Buffer.from(`${credentials.username}:${credentials.password}`).toString('base64')}`;
  }
  private async call(path: string, body?: unknown) {
    if (!this.configured) throw new FacturamaSandboxError('FACTURAMA_CREDENTIALS_REQUIRED', 'Faltan credenciales del ambiente sandbox.', 503);
    let response: Response;
    try { response = await this.http(`https://apisandbox.facturama.mx${path}`, { method: body ? 'POST' : 'GET', redirect: 'error', headers: { Authorization: this.authorization, 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(30000) }); }
    catch { throw new FacturamaSandboxError('FACTURAMA_OUTCOME_UNKNOWN', 'No se confirmó la respuesta del sandbox. Consulta el mismo folio/fecha antes de reintentar.'); }
    // Never expose provider bodies: they can contain credentials, personal data
    // or echoed XML. No automatic retry of a potentially successful stamp.
    if (!response.ok) {
      let fields: string[] = [];
      try { const error = await response.json() as { ModelState?: unknown }; fields = Object.keys(error.ModelState && typeof error.ModelState === 'object' ? error.ModelState : {}).filter((key) => /^[\w.\[\]]{1,160}$/.test(key)); } catch { /* no raw error body */ }
      throw new FacturamaSandboxError(`FACTURAMA_HTTP_${response.status}`, `Facturama sandbox rechazó la operación (HTTP ${response.status}). Revisa su validación sin cambiar el folio ni la fecha.`, response.status === 401 || response.status === 403 ? 503 : 422, undefined, fields);
    }
    const text = await response.text(); if (text.length > 20 * 1024 * 1024) throw new FacturamaSandboxError('FACTURAMA_RESPONSE_TOO_LARGE', 'La respuesta del sandbox excede el límite permitido.');
    try { return JSON.parse(text); } catch { throw new FacturamaSandboxError('FACTURAMA_RESPONSE_INVALID', 'El sandbox devolvió una respuesta no válida.'); }
  }
  async stamp(draft: CfdiProviderDraft): Promise<CfdiProviderStampResult> {
    const payload = draft.facturamaPayload; if (!payload) return fail('Falta el payload fiscal completo del borrador.');
    validateFacturamaPayload(draft, payload);
    // Explicit serialization prevents unexpected email, URL or complement
    // fields injected into a loosely typed request from reaching the provider.
    // Facturama's request field is CurrencyExchangeRate. ExchangeRate is a
    // response/internal snapshot name; sending it silently drops foreign FX.
    // Keep stored intents immutable and translate only at the API boundary.
    const body: Omit<FacturamaPayload, 'ExchangeRate'> & { CurrencyExchangeRate?: number } = {
      Folio: payload.Folio, Date: payload.Date, Serie: payload.Serie, CfdiType: payload.CfdiType, Currency: payload.Currency,
      PaymentForm: payload.PaymentForm, PaymentMethod: payload.PaymentMethod, ExpeditionPlace: payload.ExpeditionPlace,
      Exportation: payload.Exportation, CurrencyExchangeRate: payload.ExchangeRate, PaymentConditions: payload.PaymentConditions,
      Observations: payload.Observations,
      Issuer: { Rfc: payload.Issuer.Rfc, Name: payload.Issuer.Name, FiscalRegime: payload.Issuer.FiscalRegime },
      Receiver: { Rfc: payload.Receiver.Rfc, Name: payload.Receiver.Name, FiscalRegime: payload.Receiver.FiscalRegime, TaxZipCode: payload.Receiver.TaxZipCode, CfdiUse: payload.Receiver.CfdiUse },
      Items: payload.Items.map((item) => ({ ProductCode: item.ProductCode, Description: item.Description, UnitCode: item.UnitCode,
        UnitPrice: item.UnitPrice, Quantity: item.Quantity, Subtotal: item.Subtotal, TaxObject: item.TaxObject, Total: item.Total,
        Discount: item.Discount, Taxes: item.Taxes?.map((tax) => ({ Name: tax.Name, Base: tax.Base, Rate: tax.Rate, Total: tax.Total, IsRetention: tax.IsRetention })) })),
    };
    const result = await this.call('/api-lite/4/cfdis', body);
    if (typeof result.Id !== 'string' || !/^[A-Za-z0-9_-]{1,180}$/.test(result.Id) || typeof result.XmlBase64 !== 'string' || typeof result.TaxStamp?.Uuid !== 'string') throw new FacturamaSandboxError('FACTURAMA_STAMP_RESPONSE_INVALID', 'No se recibió un XML timbrado verificable; no se fabricó ningún UUID.');
    const xml = Buffer.from(result.XmlBase64, 'base64'); const parsed = parseCfdi40Xml(xml);
    if (parsed.uuid.toUpperCase() !== result.TaxStamp.Uuid.toUpperCase() || parsed.emisor.rfc !== draft.emisorRfc || parsed.receptor.rfc !== draft.receptorRfc || !parsed.total.equals(draft.total) || parsed.moneda !== payload.Currency || parsed.folio !== payload.Folio) throw new FacturamaSandboxError('FACTURAMA_XML_MISMATCH', 'El XML del sandbox no coincide con el borrador. Requiere conciliación; no se repetirá el timbrado automáticamente.', 502, result.Id);
    let file: any;
    try { file = await this.call(`/cfdi/pdf/issuedLite/${encodeURIComponent(result.Id)}`); }
    catch { throw new FacturamaSandboxError('FACTURAMA_PDF_RECOVERY_REQUIRED', 'El XML fue emitido en sandbox. Recupera su PDF por referencia; no vuelvas a timbrar.', 502, result.Id); }
    const pdf = typeof file.Content === 'string' ? Buffer.from(file.Content, 'base64') : Buffer.alloc(0);
    if (pdf.subarray(0, 5).toString() !== '%PDF-') throw new FacturamaSandboxError('FACTURAMA_PDF_INVALID', 'El XML fue emitido en sandbox pero su PDF no está disponible. Recupera el mismo documento, sin volver a timbrar.', 502, result.Id);
    return { uuid: parsed.uuid, xml, pdf, providerReference: result.Id };
  }
  async recover(draft: CfdiProviderDraft, reference: string): Promise<CfdiProviderStampResult> {
    if (!draft.facturamaPayload) return fail('Falta el snapshot inmutable del intento original.');
    validateFacturamaPayload(draft, draft.facturamaPayload);
    if (!reference) {
      const query = new URLSearchParams({ type: 'issuedLite', page: '0', folio: draft.facturamaPayload.Folio });
      const rows = await this.call(`/cfdi?${query}`);
      if (!Array.isArray(rows) || rows.length !== 1 || typeof rows[0]?.Id !== 'string') {
        throw new FacturamaSandboxError('FACTURAMA_RECONCILIATION_PENDING', 'No se encontró una referencia única verificable para este folio. No se emitirá otro CFDI. Requiere conciliación del intento guardado.', 409);
      }
      reference = rows[0].Id;
    }
    if (!/^[A-Za-z0-9_-]{1,180}$/.test(reference)) return fail('Referencia sandbox inválida.');
    const file = await this.call(`/cfdi/xml/issuedLite/${encodeURIComponent(reference)}`);
    const xml = typeof file.Content === 'string' ? Buffer.from(file.Content, 'base64') : Buffer.alloc(0);
    const parsed = parseCfdi40Xml(xml);
    if (parsed.emisor.rfc !== draft.emisorRfc || parsed.receptor.rfc !== draft.receptorRfc || !parsed.total.eq(draft.total)
      || parsed.moneda !== draft.facturamaPayload.Currency || parsed.folio !== draft.facturamaPayload.Folio) {
      throw new FacturamaSandboxError('FACTURAMA_XML_MISMATCH', 'La referencia recuperada no corresponde al intento original.', 502, reference);
    }
    const filePdf = await this.call(`/cfdi/pdf/issuedLite/${encodeURIComponent(reference)}`);
    const pdf = typeof filePdf.Content === 'string' ? Buffer.from(filePdf.Content, 'base64') : Buffer.alloc(0);
    if (pdf.subarray(0, 5).toString() !== '%PDF-') throw new FacturamaSandboxError('FACTURAMA_PDF_INVALID', 'El PDF sandbox todavía no está disponible.', 502, reference);
    return { uuid: parsed.uuid, xml, pdf, providerReference: reference };
  }
  async cancel(_uuid: string, _reason: string): Promise<never> {
    throw new FacturamaSandboxError('FACTURAMA_CANCELLATION_NOT_ENABLED', 'Cancelación sandbox no habilitada por esta integración.', 503);
  }
}
