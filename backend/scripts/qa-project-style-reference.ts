import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir, realpath } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { PrismaClient } from '@prisma/client';
import { Document, Packer, Paragraph, TextRun, Header, Footer } from 'docx';
import JSZip from 'jszip';

const url = process.env.QA_CLIENT_CASE_DATABASE_URL || '';
const target = new URL(url);
assert.equal(target.hostname, '127.0.0.1'); assert.equal(target.port, '55521'); assert.equal(target.pathname, '/pravia_client_qa'); assert.equal(target.searchParams.get('schema'), 'pravia_os');
const db = new PrismaClient({ datasourceUrl: url });
const org = '21110000-0000-4000-8000-000000000001', user = '21110000-0000-4000-8000-000000000002';
const caseId = '23110000-0000-4000-8000-000000000031', actId = '23110000-0000-4000-8000-000000000032';
const api = 'http://127.0.0.1:3011/api', DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const digest = (b: Buffer) => createHash('sha256').update(b).digest('hex');
const visible = (xml: string) => xml.replace(/<[^>]*>/g, '').replace(/&amp;/g, '&');
async function main() {
  const root = await realpath('/tmp/pravia-client-qa-20261121.amVOGW'); assert.ok(root.startsWith('/private/tmp/pravia-client-qa-20261121.'));
  const health: any = await (await fetch('http://127.0.0.1:3011/health')).json(); assert.equal(health.database_mode, 'local'); assert.equal(health.storage_mode, 'local'); assert.equal(health.database, 'ok');
  const login = async (email: string) => {
    const response = await fetch(`${api}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password: process.env.QA_LOCAL_PASSWORD }) });
    assert.equal(response.status, 200); return (await response.json() as any).access_token as string;
  };
  const token = await login('documentos.qa@pravia.test');
  const dir = path.join(root, 'projection-style'); await mkdir(dir, { recursive: true });
  if (process.env.QA_GENERATE_STYLE === 'true') {
    const file = await readFile(path.join(dir, 'Referencia-inmobiliaria-sintetica.docx'));
    const sources = await db.expedienteDocumento.findMany({ where: { expediente_id: caseId, tipo_vinculo: 'FUENTE_PROYECTO', estatus: 'ACTIVO' }, select: { documento_id: true } });
    const key = `qa-style-actual-${Date.now()}`;
    const form = new FormData(); form.set('file', new Blob([file], { type: DOCX }), 'Referencia-inmobiliaria-sintetica.docx');
    form.set('metadata', JSON.stringify({ template_purpose: 'STYLE_REFERENCE', template_source_act: 'Compraventa de inmueble', source_document_ids: sources.map((item) => item.documento_id), instructions: 'Adapta al acto real de embarcación usando sólo la fuente. Conserva el formato y estilo del machote, sin ISABI, predial ni inmueble ajenos a la operación. No inventes forma de pago ni fundamentos. No impongas letras al precio si el machote sólo utiliza números.' }));
    const response = await fetch(`${api}/expedientes/${caseId}/proyecto/generar-desde-machote`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Idempotency-Key': key }, body: form });
    const result: any = await response.json(); assert.equal(response.status, 201, `REAL_STYLE_GENERATION:${result.code || result.error}`);
    console.log(JSON.stringify({ real_generation: 'PASS', id: result.version.id, version: result.version.version_numero, pending: result.pending_count })); return;
  }
  if (process.env.QA_VERIFY_ONLY !== 'true') {
    // Dedicated synthetic case: never change the case certifying SAME_ACT.
    await db.tipoActo.upsert({ where: { id: actId }, update: {}, create: { id: actId, organization_id: org, nombre: 'COMPRAVENTA DE EMBARCACIÓN SINTÉTICA QA' } });
    await db.configuracionActo.upsert({ where: { organization_id_tipo_acto_id: { organization_id: org, tipo_acto_id: actId } }, update: {}, create: { organization_id: org, tipo_acto_id: actId, creado_por_id: user, actualizado_por_id: user, descripcion_personalizada: 'Configuración sintética QA, no establece obligación fiscal.' } });
    await db.expediente.upsert({ where: { id: caseId }, update: {}, create: { id: caseId, organization_id: org, numero_pravia: 'EXP-QA-STYLE-2026', abogado_id: user, creador_id: user, tipo_acto_id: actId, descripcion: 'QA sintético: otro acto como referencia de estilo, sin validez jurídica', valor_operacion: '80000' } });
    if (!await db.expedienteActo.findFirst({ where: { expediente_id: caseId, tipo_acto_id: actId } })) await db.expedienteActo.create({ data: { organization_id: org, expediente_id: caseId, tipo_acto_id: actId, origen: 'ADICIONAL', created_by: user } });
    const paragraph = (text: string, bold = false) => new Paragraph({ children: [new TextRun({ text, font: 'Times New Roman', size: 24, bold })] });
    const template = await Packer.toBuffer(new Document({ sections: [{ properties: { page: { margin: { top: 1200, bottom: 1200, left: 1440, right: 1440 } } }, headers: { default: new Header({ children: [paragraph('REFERENCIA SINTÉTICA · SIN VALIDEZ JURÍDICA', true)] }) }, footers: { default: new Footer({ children: [paragraph('QA PRAVIA · REVISIÓN HUMANA OBLIGATORIA')] }) }, children: [
      paragraph('COMPRAVENTA DE INMUEBLE', true),
      paragraph('COMPARECENCIA. Comparecen VENDEDOR EJEMPLO y COMPRADOR EJEMPLO para celebrar el acto descrito a continuación.'),
      paragraph('ANTECEDENTE PRIMERO. El vendedor es propietario de la casa ejemplo con superficie de 150.00 m², cuenta predial 1234-EJEMPLO y clave catastral 5678-EJEMPLO.'),
      paragraph('PRIMERA. El vendedor transmite el inmueble descrito y el comprador lo adquiere.'),
      paragraph('SEGUNDA. El comprador cubrirá ISABI, predial y derechos de agua del inmueble conforme al fundamento del ejemplo.'),
      paragraph('TERCERA. El precio de venta es de $999,999.00 y se paga de contado.'),
      paragraph('CIERRE. Leído que fue el presente instrumento, las partes manifiestan su conformidad.'),
    ] }] }));
    await writeFile(path.join(dir, 'Referencia-inmobiliaria-sintetica.docx'), template, { mode: 0o600 });
    const source = await Packer.toBuffer(new Document({ sections: [{ children: [paragraph('FUENTE SINTÉTICA QA · SIN VALIDEZ JURÍDICA', true), paragraph('Título y factura de prueba de embarcación. ROBERTO SINTÉTICO QA figura como titular de la embarcación QA-BOAT-001, marca QA AZUL, longitud 7.25 metros, año de fabricación 2020. El comprador de la operación es ELISA NUEVA DOCUMENTAL. El precio pactado es $80,000.00 MXN. No se ha aportado forma de pago, fecha de firma ni fundamento jurídico o fiscal. No existe inmueble objeto de esta operación. Este archivo es únicamente un caso sintético de QA.')] }] }));
    const name = 'Titulo-embarcacion-sintetico.docx';
    if (!await db.expedienteDocumento.findFirst({ where: { expediente_id: caseId, documento: { nombre_original: name } } })) {
      const form = new FormData(); form.set('file', new Blob([source], { type: DOCX }), name); form.set('carpeta', 'FUENTE_PROYECTO'); form.set('categoria', 'PROYECTO');
      const response = await fetch(`${api}/expedientes/${caseId}/documentos`, { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: form }); assert.equal(response.status, 201);
    }
    await writeFile(path.join(dir, 'manifest.json'), JSON.stringify({ caseId, template_sha: digest(template) }), { mode: 0o600 });
    console.log(JSON.stringify({ setup: 'PASS', caseId, url: `http://127.0.0.1:5176/expedientes/${caseId}#proyecto`, provider_calls: 0 })); return;
  }
  const manifest = JSON.parse(await readFile(path.join(dir, 'manifest.json'), 'utf8'));
  const original = await readFile(path.join(dir, 'Referencia-inmobiliaria-sintetica.docx')); assert.equal(digest(original), manifest.template_sha);
  const response = await fetch(`${api}/expedientes/${caseId}/proyecto`, { headers: { Authorization: `Bearer ${token}` } }); assert.equal(response.status, 200);
  const state: any = await response.json(); const current = state.vigente; assert.ok(current && state.ultimoReporte);
  assert.deepEqual(current.template_use, { purpose: 'STYLE_REFERENCE', source_act: 'Compraventa de inmueble', target_act: 'COMPRAVENTA DE EMBARCACIÓN SINTÉTICA QA' });
  const document = await db.documento.findUniqueOrThrow({ where: { id: current.id } });
  const content = await readFile(path.join(root, 'storage', document.storage_key)); assert.equal(digest(content), document.checksum_sha256);
  const a = await JSZip.loadAsync(original), b = await JSZip.loadAsync(content); const xml = await b.file('word/document.xml')!.async('string'); const text = visible(xml);
  assert.ok(text.includes('QA-BOAT-001')); assert.ok(text.includes('80,000') || text.includes('80000')); assert.ok(text.includes('ELISA NUEVA DOCUMENTAL')); assert.ok(text.includes('ROBERTO SINTÉTICO QA'));
  assert.ok(!/ISABI|cuenta predial 1234|5678-EJEMPLO|999,999|casa ejemplo|se paga de contado/i.test(text), 'INCOMPATIBLE_TEMPLATE_CONTENT_RETAINED');
  assert.ok(text.includes('PENDIENTE:')); assert.ok(xml.includes('w:highlight'));
  for (const name of Object.keys(a.files).filter((name) => !a.files[name].dir && name !== 'word/document.xml')) assert.deepEqual(await b.file(name)!.async('nodebuffer'), await a.file(name)!.async('nodebuffer'), `IMMUTABLE_PART:${name}`);
  assert.equal(state.ultimoReporte.proyecto_version_id, current.id); assert.equal((document.datos_extraidos as any).proyecto.mandatory_review_completed, true);
  if (process.env.QA_REQUIRE_TEMPLATE_STYLE === 'true') assert.equal(state.ultimoReporte.observaciones.filter((item: any) => item.tipo_discrepancia === 'CANTIDAD_FORMAL').length, 0, 'UNREQUESTED_NUMBER_WORDS_STYLE');
  assert.ok(await db.auditLog.count({ where: { organization_id: org, entidad_id: current.id, accion: 'PROYECTO_GENERADO_Y_REVISADO' } }));
  const foreign = await login('otrotenant.qa@pravia.test'); assert.equal((await fetch(`${api}/expedientes/${caseId}/proyecto`, { headers: { Authorization: `Bearer ${foreign}` } })).status, 403);
  await writeFile(path.join(dir, 'generated.docx'), content, { mode: 0o600 });
  console.log(JSON.stringify({ style_reference: 'PASS', immutable_word_parts: 'PASS', no_incompatible_substance: 'PASS', postgres_storage_api: 'PASS', source_template_unchanged: 'PASS', audit_tenant: 'PASS', project_id: current.id, report_id: state.ultimoReporte.id, pending: current.pending_count, legal_foundation: 'NOT VERIFIED — synthetic evidence' }));
}
main().finally(() => db.$disconnect()).catch((error) => { console.error(error.message); process.exitCode = 1; });
