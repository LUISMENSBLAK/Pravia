import { Prisma } from '@prisma/client';
import { describe, expect, it } from 'vitest';
import { cfdiSandboxPayload } from './cfdiSandboxPayload';
const d = (n: string) => new Prisma.Decimal(n);
const entity = {activa:true,rfc:'EKU9003173C9',regimen_fiscal:'601',regimenes_fiscales:[{clave:'601'}]} as any;
const row = () => ({tipo:'I',direccion:'EMITIDO',internal_folio:'FAC-BOR-000001',emisor_rfc:'EKU9003173C9',emisor_nombre:'ESCUELA KEMPER URGATE',receptor_rfc:'URE180429TM6',receptor_nombre:'UNIVERSIDAD ROBOTICA ESPAÑOLA',receptor_regimen:'601',receptor_codigo_postal:'86991',uso_cfdi:'G03',moneda:'MXN',metodo_pago:'PPD',forma_pago:'99',subtotal:d('100'),impuestos_trasladados:d('16'),impuestos_retenidos:d('0'),total:d('116'),draft_payload:{fiscal_comprobante:{lugar_expedicion:'42501',exportacion:'01'},concepts:[{clave_prod_serv:'80121601',clave_unidad:'E48',descripcion:'Prueba sintética',cantidad:'1',valor_unitario:'100',subtotal:'100',total:'116',objeto_impuesto:'02',iva_tasa:'0.16',iva:'16',iva_retencion:'0',iva_retencion_tasa:'0',isr_retencion:'0',isr_retencion_tasa:'0'}]}} as any);
describe('Persisted fiscal snapshot → sandbox', () => {
  it('uses confirmed data and persisted folio without inventing a regime, amount or date', () => {
    const p=cfdiSandboxPayload(row(),entity,'2026-11-23T10:00:00');expect(p).toMatchObject({Folio:'FAC-BOR-000001',Date:'2026-11-23T10:00:00',PaymentMethod:'PPD',Receiver:{Rfc:'URE180429TM6',FiscalRegime:'601'},Items:[{Total:116,Taxes:[{Rate:0.16,Total:16}]}]});
  });
  it.each(['inactive','issuer','regime','concepts','total','tax','complement','incomplete'])('rejects %s before provider call', (kind) => {
    const r=row(),e={...entity};if(kind==='inactive')e.activa=false;if(kind==='issuer')e.rfc='OTHER';if(kind==='regime')r.draft_payload.fiscal_comprobante.regimen_emisor='612';
    if(kind==='concepts')r.draft_payload.concepts=[];if(kind==='total')r.total=d('1');if(kind==='tax')r.draft_payload.concepts[0].iva=undefined;
    if(kind==='complement')r.draft_payload.complemento_notarios={solicitado:true};if(kind==='incomplete')r.draft_payload.incomplete_income=true;
    expect(()=>cfdiSandboxPayload(r,e as any,'2026-11-23T10:00:00')).toThrow();
  });
});
