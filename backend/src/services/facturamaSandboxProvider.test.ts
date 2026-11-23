import { describe, expect, it, vi } from 'vitest';
import { FacturamaSandboxProvider, type FacturamaPayload } from './facturamaSandboxProvider';
import { runtimeCfdiProvider } from './cfdiProvider';

// Contract fixtures only: this UUID is never presented as a provider execution.
const uuid = '123E4567-E89B-42D3-A456-426614174000';
const payload = (): FacturamaPayload => ({ Folio: 'QA-001', Date: '2026-11-21T10:00:00', CfdiType: 'I', Currency: 'MXN', PaymentForm: '99', PaymentMethod: 'PPD', ExpeditionPlace: '42501', Exportation: '01',
  Issuer: { Rfc: 'EKU9003173C9', Name: 'ESCUELA KEMPER URGATE', FiscalRegime: '601' }, Receiver: { Rfc: 'URE180429TM6', Name: 'UNIVERSIDAD ROBOTICA ESPAÑOLA', FiscalRegime: '601', TaxZipCode: '86991', CfdiUse: 'G03' },
  Items: [{ ProductCode: '80121601', Description: 'Servicio sintético QA', UnitCode: 'E48', Quantity: 1, UnitPrice: 100, Subtotal: 100, TaxObject: '02', Total: 116, Taxes: [{ Name: 'IVA', Base: 100, Rate: 0.16, Total: 16, IsRetention: false }] }] });
const draft = () => ({ version: '4.0' as const, tipo: 'I' as const, emisorRfc: 'EKU9003173C9', receptorRfc: 'URE180429TM6', metodoPago: 'PPD' as const, total: '116.00', facturamaPayload: payload() });
const xml = () => Buffer.from(`<?xml version="1.0"?><cfdi:Comprobante xmlns:cfdi="http://www.sat.gob.mx/cfd/4" Version="4.0" Folio="QA-001" Fecha="2026-11-21T10:00:00" SubTotal="100.00" Total="116.00" Moneda="MXN" TipoDeComprobante="I"><cfdi:Emisor Rfc="EKU9003173C9" Nombre="ESCUELA KEMPER URGATE"/><cfdi:Receptor Rfc="URE180429TM6" Nombre="UNIVERSIDAD ROBOTICA ESPAÑOLA"/><cfdi:Complemento><tfd:TimbreFiscalDigital xmlns:tfd="http://www.sat.gob.mx/TimbreFiscalDigital" UUID="${uuid}" FechaTimbrado="2026-11-21T10:00:01"/></cfdi:Complemento></cfdi:Comprobante>`);
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status });
const success = () => json({ Id: 'provider-qa-id', XmlBase64: xml().toString('base64'), TaxStamp: { Uuid: uuid } });
const credentials = { username: 'SYNTHETIC-QA', password: 'NOT-A-REAL-CREDENTIAL' };
describe('Facturama sandbox · frontera aislada sin resultados fabricados', () => {
  it('runtime productivo permanece deshabilitado', () => { expect(runtimeCfdiProvider.configured).toBe(false); });
  it('envía sólo a sandbox, conserva folio/fecha y valida XML/PDF recibidos', async () => {
    const http = vi.fn().mockResolvedValueOnce(success()).mockResolvedValueOnce(json({ Content: Buffer.from('%PDF-1.7 synthetic').toString('base64') }));
    const data = draft(); (data.facturamaPayload as any).Email = 'DO-NOT-SEND@example.test'; (data.facturamaPayload.Issuer as any).LogoUrl = 'http://do-not-fetch.invalid';
    const result = await new FacturamaSandboxProvider(credentials, http).stamp(data);
    expect(result).toMatchObject({ uuid, providerReference: 'provider-qa-id' }); expect(result.xml.equals(xml())).toBe(true);
    expect(http.mock.calls.map((call) => call[0])).toEqual(['https://apisandbox.facturama.mx/api-lite/4/cfdis', 'https://apisandbox.facturama.mx/cfdi/pdf/issuedLite/provider-qa-id']);
    expect(http.mock.calls[0][1].body).not.toContain('DO-NOT-SEND'); expect(http.mock.calls[0][1].body).not.toContain('LogoUrl');
    expect(JSON.parse(http.mock.calls[0][1].body)).toMatchObject({ Folio: 'QA-001', Date: '2026-11-21T10:00:00' });
  });
  it.each(['total', 'receiver', 'date', 'tax', 'currency', 'method', 'quantity', 'missing'])('rechaza %s antes de invocar proveedor', async (kind) => {
    const data = draft(); const p = data.facturamaPayload;
    if (kind === 'total') data.total = '1.00'; if (kind === 'receiver') p.Receiver.Rfc = 'REAL010101AA1';
    if (kind === 'date') p.Date = '2026-02-30T10:00:00'; if (kind === 'tax') p.Items[0].Taxes![0].Total = 15;
    if (kind === 'currency') p.Currency = 'CAD'; if (kind === 'method') p.PaymentForm = '03';
    if (kind === 'quantity') p.Items[0].Quantity = 0; if (kind === 'missing') p.Receiver.TaxZipCode = '';
    const http = vi.fn(); await expect(new FacturamaSandboxProvider(credentials, http).stamp(data)).rejects.toMatchObject({ code: 'FACTURAMA_DRAFT_INVALID' }); expect(http).not.toHaveBeenCalled();
  });
  it('no fabrica UUID si el proveedor responde sin XML', async () => {
    const http = vi.fn().mockResolvedValue(json({ Id: 'provider-qa-id' }));
    await expect(new FacturamaSandboxProvider(credentials, http).stamp(draft())).rejects.toMatchObject({ code: 'FACTURAMA_STAMP_RESPONSE_INVALID' }); expect(http).toHaveBeenCalledTimes(1);
  });
  it('HTTP de error no filtra cuerpo ni reintenta el timbrado', async () => {
    const http = vi.fn().mockResolvedValue(json({ Password: 'DO-NOT-EXPOSE' }, 401));
    await expect(new FacturamaSandboxProvider(credentials, http).stamp(draft())).rejects.toMatchObject({ code: 'FACTURAMA_HTTP_401' }); expect(http).toHaveBeenCalledTimes(1);
  });
  it('resultado desconocido exige conciliar; no realiza un segundo POST', async () => {
    const http = vi.fn().mockRejectedValue(new Error('network'));
    await expect(new FacturamaSandboxProvider(credentials, http).stamp(draft())).rejects.toMatchObject({ code: 'FACTURAMA_OUTCOME_UNKNOWN' }); expect(http).toHaveBeenCalledTimes(1);
  });
  it('PDF fallido conserva referencia para recuperar sin otro timbrado', async () => {
    const http = vi.fn().mockResolvedValueOnce(success()).mockResolvedValueOnce(json({}, 503));
    await expect(new FacturamaSandboxProvider(credentials, http).stamp(draft())).rejects.toMatchObject({ code: 'FACTURAMA_PDF_RECOVERY_REQUIRED', providerReference: 'provider-qa-id' }); expect(http).toHaveBeenCalledTimes(2);
  });
  it('recupera por referencia con GET y valida los mismos folio/total/RFC',async()=>{
    const http=vi.fn().mockResolvedValueOnce(json({Content:xml().toString('base64')})).mockResolvedValueOnce(json({Content:Buffer.from('%PDF-1.7 synthetic').toString('base64')}));
    const result=await new FacturamaSandboxProvider(credentials,http).recover(draft(),'provider-qa-id');expect(result.uuid).toBe(uuid);
    expect(http.mock.calls.every(call=>call[1].method==='GET')).toBe(true);expect(http).toHaveBeenCalledTimes(2);
  });
  it('resultado incierto se concilia por folio sin volver a POST',async()=>{
    const http=vi.fn().mockResolvedValueOnce(json([{Id:'provider-qa-id'}])).mockResolvedValueOnce(json({Content:xml().toString('base64')})).mockResolvedValueOnce(json({Content:Buffer.from('%PDF-1.7 synthetic').toString('base64')}));
    await new FacturamaSandboxProvider(credentials,http).recover(draft(),'');expect(http.mock.calls.every(call=>call[1].method==='GET')).toBe(true);expect(http.mock.calls[0][0]).toContain('folio=QA-001');
  });
  it.each([{rows:[]},{rows:[{Id:'a'},{Id:'b'}]}])('no considera un resultado ambiguo como ausencia segura para reemitir',async({rows})=>{
    const http=vi.fn().mockResolvedValue(json(rows));await expect(new FacturamaSandboxProvider(credentials,http).recover(draft(),'')).rejects.toMatchObject({code:'FACTURAMA_RECONCILIATION_PENDING'});expect(http).toHaveBeenCalledTimes(1);
  });
});
