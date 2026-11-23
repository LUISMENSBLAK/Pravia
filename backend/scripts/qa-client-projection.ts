import assert from 'node:assert/strict';
import { readFile, realpath, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { PrismaClient } from '@prisma/client';
import JSZip from 'jszip';
import { createHash } from 'node:crypto';

// The URL is a separate opt-in, never read from a production .env.
const url = process.env.QA_CLIENT_CASE_DATABASE_URL || '';
const target = new URL(url);
assert.equal(target.hostname, '127.0.0.1'); assert.equal(target.port, '55521');
assert.equal(target.pathname, '/pravia_client_qa'); assert.equal(target.searchParams.get('schema'), 'pravia_os');
const db = new PrismaClient({ datasources: { db: { url } } });
const org = '21110000-0000-4000-8000-000000000001', user = '21110000-0000-4000-8000-000000000002';
const caseId = '2d49eeef-6757-4c35-84f5-9a046b47b982', api = 'http://127.0.0.1:3011/api';
const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const password = process.env.QA_LOCAL_PASSWORD;
assert.ok(password && password.length >= 16);

async function main() {
  const root = await realpath('/tmp/pravia-client-qa-20261121.amVOGW');
  assert.ok(root.startsWith('/private/tmp/pravia-client-qa-20261121.'));
  const health: any = await (await fetch('http://127.0.0.1:3011/health')).json();
  assert.equal(health.database_mode, 'local'); assert.equal(health.storage_mode, 'local'); assert.equal(health.database, 'ok');
  const login = async (email: string) => {
    const response = await fetch(`${api}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }) });
    assert.equal(response.status, 200); return (await response.json() as any).access_token as string;
  };
  const token = await login('documentos.qa@pravia.test');
  const request = async (route: string, method = 'GET', body?: unknown, actor = token) => {
    const response = await fetch(`${api}${route}`, { method, headers: { Authorization: `Bearer ${actor}`, 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    const value: any = await response.json();
    assert.ok(response.ok, `${route}:${response.status}:${value.code || value.error}`); return value;
  };
  if (process.env.QA_GENERATE_ONLY === 'true') {
    const form = new FormData();
    form.append('file', new Blob([await readFile(path.join(root, 'projection', 'Machote-sintetico-proyeccion.docx'))], { type: DOCX }), 'Machote-sintetico-proyeccion.docx');
    form.append('metadata', JSON.stringify({ instructions: 'Conserva la cláusula tercera sin alterarla. Coteja todas las fuentes; conserva la descripción del antecedente y reporta la discrepancia de superficie sin resolverla por intuición. No inventes datos faltantes.' }));
    const response = await fetch(`${api}/expedientes/${caseId}/proyecto/generar-desde-machote`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Idempotency-Key': `qa-project-specific-pending-${Date.now()}` }, body: form });
    const result: any = await response.json();
    assert.equal(response.status, 201, `QA_PROJECT_GENERATE:${result.code || result.error}`);
    console.log(JSON.stringify({ generation: 'PASS', version: result.version.version_numero, pending: result.pending_count, critical: result.critical_count, id: result.version.id }));
    return;
  }
  if (process.env.QA_REVIEW_CORRECTION === 'true') {
    const application = await db.projectInstructionApplication.findFirstOrThrow({ where: { organization_id: org, expediente_id: caseId }, orderBy: { created_at: 'desc' } });
    const [before, after] = await Promise.all([application.source_project_document_id, application.result_project_document_id].map((id) => db.documento.findUniqueOrThrow({ where: { id } })));
    const textOf = async (key: string) => {
      const zipped = await JSZip.loadAsync(await readFile(path.join(root, 'storage', key)));
      return (await zipped.file('word/document.xml')!.async('string')).replace(/<[^>]*>/g, '');
    };
    const oldText = await textOf(before.storage_key), newText = await textOf(after.storage_key);
    assert.ok(oldText.includes('MARIANA SINTETICA QA') && newText.includes('MARIANA SINTÉTICA QA'));
    assert.ok(newText.includes('347.50') && newText.includes('[PENDIENTE: RFC DEL COMPRADOR]'));
    assert.equal((after.datos_extraidos as any).proyecto.mandatory_review_completed, false);
    assert.ok(await db.auditLog.count({ where: { organization_id: org, accion: 'APLICAR_INDICACIONES_PROYECTO', entidad_id: application.id } }));
    const response = await fetch(`${api}/expedientes/${caseId}/proyecto/analizar-ia`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'Idempotency-Key': `qa-corrected-review-${after.id}` }, body: '{}' });
    const result: any = await response.json();
    assert.ok(response.ok, `QA_CORRECTED_REVIEW:${result.code || result.error}`);
    assert.equal(result.proyecto_version_id, after.id);
    console.log(JSON.stringify({ correction_versioning: 'PASS', old_version_unchanged: 'PASS', unresolved_data_preserved: 'PASS', audit: 'PASS', corrected_version_review: 'PASS', version: result.proyecto_version_numero }));
    return;
  }
  if (process.env.QA_VERIFY_ONLY !== 'true') {
    const model = 'gpt-5.4-mini';
    await db.aiModelRegistry.upsert({ where: { provider_code_model_code: { provider_code: 'OPENAI', model_code: model } }, update: {}, create: {
      provider_code: 'OPENAI', model_code: model, capabilities: ['text', 'image'], quality_tier: 'PREMIUM', pricing_reference: 'https://developers.openai.com/api/docs/models/gpt-5.4-mini',
    } });
    await db.resourceCostVersion.upsert({ where: { resource_code_provider_code_version: { resource_code: `AI_MODEL:${model}`, provider_code: 'OPENAI', version: 1 } }, update: {}, create: {
      resource_code: `AI_MODEL:${model}`, provider_code: 'OPENAI', unit: 'MILLION_TOKENS', cost_amount: '0.75', currency: 'USD', version: 1, effective_from: new Date('2026-11-21T00:00:00Z'),
      metadata: { output_per_million: '4.50', cached_input_per_million: '0.075', source: 'https://developers.openai.com/api/docs/models/gpt-5.4-mini',
        fx_rate: '1', fx_source: 'QA_SYNTHETIC_NOT_FOR_PRODUCTION', fx_as_of: '2026-11-21', fixture: true },
    } });
    for (const [code, chosen, tier, output] of [['PROJECT_LITERAL_PATCH_PLAN', 'gpt-5.4-nano', 'ECONOMY', 16384], ['PROJECT_LEGAL_REVIEW', model, 'PREMIUM', 24576]] as const) {
      await db.aiOperationCatalog.upsert({ where: { operation_code: code }, update: {}, create: { operation_code: code, billing_class: 'CUSTOMER_WALLET', required_capability: 'ia.execute', quality_tier: tier,
        max_input: 100_000, max_output: output, max_charge_minor: 1000n } });
      await db.aiRoutingPolicyVersion.upsert({ where: { operation_code_version: { operation_code: code, version: 1 } }, update: {}, create: {
        operation_code: code, version: 1, effective_from: new Date('2026-11-21T00:00:00Z'), routing_rules_json: { candidates: [{ providerCode: 'OPENAI', modelCode: chosen }] },
      } });
      await db.commercialSkuVersion.upsert({ where: { sku_version: { sku: `AI_USAGE:${code}`, version: 1 } }, update: {}, create: {
        sku: `AI_USAGE:${code}`, kind: 'AI_USAGE', quantity: 1, unit: 'CALL', sale_price_minor: null, min_markup_multiplier: 2, version: 1, effective_from: new Date('2026-11-21T00:00:00Z'),
      } });
    }
    for (const file of ['Fuente-sintetica-compraventa.docx', '../fixtures/inmueble-foto-sintetica.png']) {
      const name = path.basename(file);
      if (await db.expedienteDocumento.findFirst({ where: { expediente_id: caseId, tipo_vinculo: 'FUENTE_PROYECTO', documento: { nombre_original: name } } })) continue;
      const form = new FormData(); form.append('file', new Blob([await readFile(path.join(root, 'projection', file))], { type: name.endsWith('.docx') ? DOCX : 'image/png' }), name);
      form.append('carpeta', 'FUENTE_PROYECTO'); form.append('categoria', 'PROYECTO'); form.append('observaciones', 'Fixture sintética autorizada de QA, sin validez jurídica.');
      const response = await fetch(`${api}/expedientes/${caseId}/documentos`, { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: form });
      assert.equal(response.status, 201, `QA_SOURCE_UPLOAD_FAILED:${response.status}`);
    }
    console.log(JSON.stringify({ setup: 'PASS', local_only: true, case_id: caseId, frontend: `http://127.0.0.1:5176/expedientes/${caseId}#proyecto`, no_provider_call_in_setup: true }));
    return;
  }
  const state = await request(`/expedientes/${caseId}/proyecto`);
  const current = state.vigente, report = state.ultimoReporte;
  assert.ok(current && report); assert.equal(report.proyecto_version_id, current.id);
  const document = await db.documento.findUniqueOrThrow({ where: { id: current.id } });
  const metadata: any = document.datos_extraidos;
  assert.equal(metadata.proyecto.mandatory_review_completed, true);
  const content = await readFile(path.join(root, 'storage', document.storage_key));
  if (current.id === '949f2251-9a6b-4471-80c0-d58de9249b4a') {
    // Baseline captured after V5 generation, before its independent reviews.
    assert.equal(createHash('sha256').update(content).digest('hex'), '3ad56ed01f70a1f50329fd43ecd50b3a154f4fac73a0862cba64b2af8714d7c4', 'REVIEW_CHANGED_PROJECT_WORD');
  }
  const zip = await JSZip.loadAsync(content); const xml = await zip.file('word/document.xml')!.async('string');
  assert.ok(xml.includes('w:highlight'));
  assert.ok(!xml.includes('PERSONA ANTERIOR DEL EJEMPLO') && !xml.includes('COMPRADOR ANTERIOR DEL EJEMPLO'));
  assert.ok(xml.includes('FUNDAMENTO QA NO ACREDITADO'));
  const reportDocument = await db.documento.findUniqueOrThrow({ where: { id: report.id } });
  const reportContent = await readFile(path.join(root, 'storage', reportDocument.storage_key));
  const reportZip = await JSZip.loadAsync(reportContent); const reportXml = await reportZip.file('word/document.xml')!.async('string');
  for (const group of ['CRÍTICAS', 'REVISAR', 'PENDIENTES', 'INFORMATIVAS']) assert.ok(reportXml.includes(group));
  const template = await JSZip.loadAsync(await readFile(path.join(root, 'projection', 'Machote-sintetico-proyeccion.docx')));
  for (const name of Object.keys(template.files).filter((name) => !template.files[name].dir && name !== 'word/document.xml')) {
    assert.deepEqual(await zip.files[name].async('nodebuffer'), await template.files[name].async('nodebuffer'), `IMMUTABLE_PART_CHANGED:${name}`);
  }
  await writeFile(path.join(root, 'projection', 'Proyecto-generado-QA.docx'), content, { mode: 0o600 });
  await writeFile(path.join(root, 'projection', 'Observaciones-proyeccion-QA.docx'), reportContent, { mode: 0o600 });
  const usages = await db.aiUsageEvent.findMany({ where: { organization_id: org, operation_code: { in: ['PROJECT_LITERAL_PATCH_PLAN', 'PROJECT_LEGAL_REVIEW'] }, status: 'COMPLETED' } });
  for (const operation of ['PROJECT_LITERAL_PATCH_PLAN', 'PROJECT_LEGAL_REVIEW']) assert.ok(usages.some((item) => item.operation_code === operation && item.input_tokens > 0 && item.output_tokens > 0));
  assert.ok(await db.auditLog.count({ where: { organization_id: org, user_id: user, accion: 'PROYECTO_GENERADO_Y_REVISADO', entidad_id: current.id } }));
  for (const email of ['otrotenant.qa@pravia.test', 'lectura.qa@pravia.test']) {
    const actor = await login(email);
    const denied = await fetch(`${api}/expedientes/${caseId}/proyecto/generar`, { method: 'POST', headers: { Authorization: `Bearer ${actor}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ idempotency_key: 'qa-should-not-run' }) });
    assert.equal(denied.status, 403);
  }
  console.log(JSON.stringify({ postgres_storage: 'PASS', mandatory_real_model_review: 'PASS', separate_report: 'PASS', package_parts: 'PASS', tenant_permissions: 'PASS', audit: 'PASS', project_id: current.id,
    report_id: report.id, pending_count: current.pending_count, observations: report.observaciones.length, legal_foundation: 'NOT VERIFIED: synthetic sources contain no legislation', rendering: 'PENDING separate visual inspection' }));
}
main().finally(() => db.$disconnect()).catch((error) => { console.error(error.message); process.exitCode = 1; });
