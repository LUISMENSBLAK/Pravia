import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { parseCfdi40Xml } from '../src/services/financeFiscal.service';

/** Creates only public provider test identities through the real local API.
 * Stamping is deliberately performed from Chrome, not bypassed by this setup. */
async function main() {
  const url = new URL(process.env.DATABASE_URL || '');
  assert.equal(url.hostname, '127.0.0.1'); assert.equal(url.port, '55521'); assert.equal(url.pathname, '/pravia_client_qa');
  const base = 'http://127.0.0.1:3011';
  const health: any = await (await fetch(`${base}/health`)).json();
  assert.equal(health.database_mode, 'local'); assert.equal(health.storage_mode, 'local'); assert.equal(health.replication_enabled, false);
  const login = async (email: string) => {
    const response = await fetch(`${base}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password: process.env.QA_LOCAL_PASSWORD }) });
    assert.equal(response.status, 200); return (await response.json() as any).access_token as string;
  };
  const token = await login('documentos.qa@pravia.test');
  const request = async (route: string, method = 'GET', body?: unknown) => {
    const response = await fetch(`${base}/api/finanzas/facturacion${route}`, { method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    const result: any = await response.json(); assert.equal(response.ok, true, `${route}: ${response.status} ${result.code || ''} ${result.error || ''}`); return result.data;
  };
  const status = await request('/estado'); assert.equal(status.environment, 'SANDBOX'); assert.equal(status.realStampingVerified, false);
  let entity = (await request('/entidades')).find((item: any) => item.rfc === 'EKU9003173C9');
  if (!entity) entity = await request('/entidades', 'POST', { razon_social: 'ESCUELA KEMPER URGATE', rfc: 'EKU9003173C9', regimen_fiscal: '601', regimenes_fiscales: [{ clave: '601' }], codigo_postal: '42501', manual_exception_reason: 'Identidad pública de prueba proporcionada por Facturama; sólo sandbox local, sin validez fiscal.' });
  let concept = (await request(`/conceptos?entidad_fiscal_id=${entity.id}`)).find((item: any) => item.descripcion === 'Servicio sintético QA Facturama — SIN VALIDEZ FISCAL');
  if (!concept) concept = await request('/conceptos', 'POST', { entidad_fiscal_id: entity.id, descripcion: 'Servicio sintético QA Facturama — SIN VALIDEZ FISCAL', clave_prod_serv: '80121601', clave_unidad: 'E48', objeto_impuesto: '02', iva_tasa: '0.16', iva_retencion_tasa: '0', isr_retencion_tasa: '0' });
  const { cfdi } = await request('/borradores', 'POST', { direccion: 'EMITIDO', tipo: 'I', entidad_fiscal_id: entity.id,
    receptor_rfc: 'URE180429TM6', receptor_nombre: 'UNIVERSIDAD ROBOTICA ESPAÑOLA', receptor_regimen: '601', receptor_codigo_postal: '86991', uso_cfdi: 'G03',
    subtotal: '100.00', impuestos_trasladados: '16.00', impuestos_retenidos: '0.00', total: '116.00', moneda: 'MXN', metodo_pago: 'PPD', forma_pago: '99',
    lugar_expedicion: '42501', exportacion: '01', regimen_emisor: '601', conceptos: [{ concepto_fiscal_id: concept.id, cantidad: '1', valor_unitario: '100.00' }],
    idempotency_key: 'client-sandbox-ui-20261123-v1', source_context: 'SYNTHETIC_SANDBOX_QA' });
  const selected = (await request('/documentos')).items.find((item: any) => item.id === cfdi.id);
  assert.ok(selected); assert.equal(selected.total, '116');
  if (process.env.QA_VERIFY_ONLY === 'true') {
    assert.equal(selected.estado, 'TIMBRADO_SANDBOX');assert.ok(selected.uuid_fiscal && selected.xmlDocumento && selected.pdfDocumento);
    const db=new PrismaClient({datasourceUrl:url.href});
    try {
      const saved=await db.documentoCfdi.findUniqueOrThrow({where:{id:cfdi.id},include:{xmlDocumento:true,pdfDocumento:true}});
      const files:Record<string,any>={};
      for(const kind of ['xml','pdf'] as const){
        const link=await request(`/documentos/${cfdi.id}/archivos/${kind}`);const fileUrl=new URL(link.url,base);assert.equal(fileUrl.origin,base);assert.equal(fileUrl.pathname,'/api/storage/local');
        const response=await fetch(fileUrl);assert.equal(response.ok,true);const buffer=Buffer.from(await response.arrayBuffer());
        const checksum=createHash('sha256').update(buffer).digest('hex');const doc=kind==='xml'?saved.xmlDocumento!:saved.pdfDocumento!;
        assert.equal(checksum,doc.checksum_sha256);assert.equal(buffer.length,doc.size_bytes);files[kind]={sha256:checksum,bytes:buffer.length};
        if(kind==='xml'){const parsed=parseCfdi40Xml(buffer);assert.equal(parsed.uuid,saved.uuid_fiscal);assert.equal(parsed.total.toFixed(2),'116.00');assert.equal(parsed.folio,saved.internal_folio);}
        else assert.equal(buffer.subarray(0,5).toString(),'%PDF-');
      }
      const repeated=await request(`/documentos/${cfdi.id}/timbrar`,'POST',{expected_updated_at:selected.updated_at});assert.equal(repeated.idempotent,true);assert.equal(repeated.cfdi.uuid_fiscal,saved.uuid_fiscal);
      assert.equal(await db.auditLog.count({where:{organization_id:saved.organization_id,entidad_id:saved.id,accion:'REQUEST_SANDBOX_CFDI'}}),1);
      assert.equal(await db.auditLog.count({where:{organization_id:saved.organization_id,entidad_id:saved.id,accion:'COMPLETE_SANDBOX_CFDI'}}),1);
      console.log(JSON.stringify({real_sandbox_ui_persistence:'PASS',private_download_hashes:'PASS',repeat_same_uuid:'PASS',audit:'PASS',cfdi_id:cfdi.id,files,production_writes:'NONE'}));
    }finally{await db.$disconnect();}
  }
  for (const email of ['otrotenant.qa@pravia.test', 'lectura.qa@pravia.test']) {
    const alternate = await login(email);
    const denied = await fetch(`${base}/api/finanzas/facturacion/documentos/${cfdi.id}/timbrar`, { method: 'POST', headers: { Authorization: `Bearer ${alternate}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ expected_updated_at: selected.updated_at }) });
    assert.ok([403, 404].includes(denied.status), `Expected denial for ${email}: ${denied.status}`);
  }
  await writeFile('/tmp/pravia-client-qa-20261121.amVOGW/facturama-ui-run.json', JSON.stringify({ cfdi_id: cfdi.id, entity_id: entity.id, concept_id: concept.id, state: selected.estado, total: selected.total, prepared_at: new Date().toISOString(), production_writes: 'NONE' }, null, 2));
  console.log(JSON.stringify({ local_isolation: 'PASS', provider: status.provider, realStampingVerified: false, cfdi_id: cfdi.id, folio: selected.internal_folio, state: selected.estado, total: selected.total, tenant_permissions: 'PASS', browser_url: `http://127.0.0.1:5176/finanzas?view=facturacion&cfdi_id=${cfdi.id}`, production_writes: 'NONE' }));
}
main().catch((error) => { console.error(error instanceof Error ? error.message : 'QA_FAILED'); process.exitCode = 1; });
