import { expect, test } from '@playwright/test';
import { createHash } from 'node:crypto';
import { PrismaClient } from '../../backend/node_modules/@prisma/client/default.js';
import { PDFDocument } from '../../backend/node_modules/pdf-lib/cjs/index.js';

test('Facturama real sandbox: timbrado desde Chrome, XML/PDF privados, monedas y repetición sin doble envío', async ({ page, baseURL }) => {
  expect(baseURL).toBe('http://127.0.0.1:5176');
  const url=new URL(process.env.QA_CLIENT_CASE_DATABASE_URL!);
  expect([url.hostname,url.port,url.pathname]).toEqual(['127.0.0.1','55521','/pravia_client_qa']);
  const db=new PrismaClient({datasourceUrl:url.href}),org='21110000-0000-4000-8000-000000000001';
  let authorization='';page.on('request',request=>{if(request.url().startsWith(baseURL+'/api/')&&request.headers().authorization)authorization=request.headers().authorization;});
  const errors:string[]=[];page.on('pageerror',error=>errors.push(error.name));
  try{
    const health=await page.request.get('http://127.0.0.1:3011/health');expect(health.status()).toBe(200);
    expect(await health.json()).toMatchObject({database_mode:'local',storage_mode:'local',replication_enabled:false});
    await page.goto('/login');await page.getByLabel('Correo electrónico').fill('documentos.qa@pravia.test');await page.getByLabel('Contraseña',{exact:true}).fill(process.env.QA_LOCAL_PASSWORD!);
    await page.getByRole('button',{name:'Iniciar sesión',exact:true}).click();await page.waitForURL('**/mi-dia');
    const headers=()=>({Authorization:authorization});
    const request=async(path:string,data?:unknown)=>{
      const response=await page.request.fetch('/api/finanzas/facturacion'+path,{method:data?'POST':'GET',headers:headers(),...(data?{data}:{}),timeout:90000});
      const payload=await response.json();expect(response.status(),payload.code||'Expected success').toBeGreaterThanOrEqual(200);expect(response.status(),payload.code||'Expected success').toBeLessThan(300);return payload.data;
    };
    const status=await request('/estado');expect(status).toMatchObject({provider:'FACTURAMA_SANDBOX',environment:'SANDBOX',sandboxStampingEnabled:true,realStampingVerified:false});
    const entity=(await request('/entidades')).find((item:any)=>item.rfc==='EKU9003173C9');expect(entity).toBeTruthy();
    const concept=(await request('/conceptos?entidad_fiscal_id='+entity.id)).find((item:any)=>item.activo&&item.iva_tasa==='0.16'&&item.iva_retencion_tasa==='0'&&item.isr_retencion_tasa==='0');expect(concept).toBeTruthy();
    const movements=await db.movimientoFinanciero.count({where:{organization_id:org}});
    for(const [currency,fx]of [['MXN',null],['USD','17'],['CAD','12.5']]as const){
      // Reuse the immutable intent on retries; never emit a second test CFDI
      // merely because an assertion after stamping failed.
      const run=currency==='MXN'?'948cebac-2f81-4d7e-9f62-131603602f29':'certification-nov25-fx-v2-'+currency;
      const result=await request('/borradores',{direccion:'EMITIDO',tipo:'I',entidad_fiscal_id:entity.id,receptor_rfc:'URE180429TM6',receptor_nombre:'UNIVERSIDAD ROBOTICA ESPAÑOLA',receptor_regimen:'601',receptor_codigo_postal:'86991',uso_cfdi:'G03',subtotal:'100.00',impuestos_trasladados:'16.00',impuestos_retenidos:'0.00',total:'116.00',moneda:currency,...(fx?{tipo_cambio:fx}:{}),metodo_pago:'PPD',forma_pago:'99',lugar_expedicion:'42501',exportacion:'01',regimen_emisor:'601',conceptos:[{concepto_fiscal_id:concept.id,cantidad:'1',valor_unitario:'100.00',descripcion:'SINTÉTICO QA NOV25 '+currency+' '+run+' SIN VALIDEZ FISCAL'}],idempotency_key:'qa-sandbox-nov25:'+run,source_context:'SYNTHETIC_SANDBOX_QA'});
      const id=result.cfdi.id;
      await page.goto('/finanzas?view=facturacion&cfdi_id='+id);await page.getByRole('tab',{name:'CFDI y cuentas'}).click();
      const card=page.locator('#cfdi-'+id);await expect(card).toBeVisible();
      const stamp=card.getByRole('region',{name:'Timbrado de prueba Facturama'});await expect(stamp).toBeVisible();
      const before=await db.documentoCfdi.findUniqueOrThrow({where:{id}});
      if(before.estado!=='TIMBRADO_SANDBOX'){
      await stamp.getByRole('checkbox',{name:'Confirmo que es una prueba sin validez fiscal y que guardé los datos.'}).check();
      const stamped=page.waitForResponse(response=>response.url().endsWith('/documentos/'+id+'/timbrar')&&response.request().method()==='POST',{timeout:180000});
      await stamp.getByRole('button',{name:'Timbrar PRUEBA sandbox',exact:true}).click();const stampedResponse=await stamped;const stampedPayload=await stampedResponse.json();
      expect(stampedResponse.status(),stampedPayload.code||'sandbox stamp').toBe(200);
      }
      const saved=await db.documentoCfdi.findUniqueOrThrow({where:{id},include:{xmlDocumento:true,pdfDocumento:true}});
      expect(saved.estado).toBe('TIMBRADO_SANDBOX');expect(saved.uuid_fiscal).toMatch(/^[0-9a-f-]{36}$/i);expect(saved.moneda).toBe(currency);expect(saved.total.toFixed(2)).toBe('116.00');
      for(const kind of ['xml','pdf']as const){
        const file=await request('/documentos/'+id+'/archivos/'+kind),target=new URL(file.url,'http://127.0.0.1:3011');expect(target.origin).toBe('http://127.0.0.1:3011');expect(target.pathname).toBe('/api/storage/local');
        const downloaded=await page.request.get(target.href);expect(downloaded.status()).toBe(200);const bytes=await downloaded.body(),doc=kind==='xml'?saved.xmlDocumento!:saved.pdfDocumento!;
        expect(createHash('sha256').update(bytes).digest('hex')).toBe(doc.checksum_sha256);expect(bytes.length).toBe(doc.size_bytes);
        if(kind==='pdf')expect((await PDFDocument.load(bytes)).getPageCount()).toBeGreaterThan(0);
        else{
          const xml=bytes.toString(),uuid=xml.match(/\bUUID="([0-9a-f-]{36})"/i)?.[1];
          expect(uuid?.toUpperCase()).toBe(saved.uuid_fiscal!.toUpperCase());
          expect(xml.match(/\bMoneda="([A-Z]{3})"/)?.[1]).toBe(currency);
          if(fx)expect(Number(xml.match(/\bTipoCambio="([\d.]+)"/)?.[1])).toBe(Number(fx));
        }
      }
      const replay=await request('/documentos/'+id+'/timbrar',{expected_updated_at:saved.updated_at.toISOString()});expect(replay.idempotent).toBe(true);expect(replay.cfdi.uuid_fiscal).toBe(saved.uuid_fiscal);
      expect(await db.auditLog.count({where:{organization_id:org,entidad_id:id,accion:'REQUEST_SANDBOX_CFDI'}})).toBe(1);expect(await db.auditLog.count({where:{organization_id:org,entidad_id:id,accion:'COMPLETE_SANDBOX_CFDI'}})).toBe(1);
      await page.reload();await page.getByRole('tab',{name:'CFDI y cuentas'}).click();await card.getByRole('button',{name:'Ver PDF de prueba',exact:true}).click();
      const viewer=page.getByRole('dialog',{name:/pdf/i});await expect(viewer.locator('canvas[data-preview-loaded="true"]').first()).toBeVisible();await page.screenshot({path:test.info().outputPath('timbrado-sandbox-'+currency+'.png')});await viewer.getByRole('button',{name:'Cerrar vista previa',exact:true}).click();
      expect(await db.movimientoFinanciero.count({where:{organization_id:org}})).toBe(movements);expect(await db.aplicacionPagoCfdi.count({where:{cfdi_id:id}})).toBe(0);
    }
    expect(errors).toEqual([]);
  }finally{await db.$disconnect();}
});
