/** Synthetic local fixtures for the November client extraction corrections.
 * Never a production seed or a commercial pricing configuration. */
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { createCanvas } from '@napi-rs/canvas';
import { mkdir, realpath, writeFile } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';

const target = new URL(process.env.DATABASE_URL || 'postgresql://blocked.invalid/blocked');
if (target.hostname !== '127.0.0.1' || target.port !== '55521' || target.pathname !== '/pravia_client_qa'
  || target.searchParams.get('schema') !== 'pravia_os' || process.env.PRAVIA_DATABASE_MODE !== 'local') {
  throw new Error('CLIENT_EXTRACTION_QA_REQUIRES_ISOLATED_LOCAL_DATABASE');
}
const db = new PrismaClient();
const org = '21110000-0000-4000-8000-000000000001';
const user = '21110000-0000-4000-8000-000000000002';
const person = '21110000-0000-4000-8000-000000000003';
const property = '21110000-0000-4000-8000-000000000004';
const secondOrg = '21110000-0000-4000-8000-000000000011';
const secondUser = '21110000-0000-4000-8000-000000000012';
const model = 'gpt-5.4-nano';

async function verifyPersistedFlow(root: string) {
  const [master, identity, propertySources, personSources, usage, wallet, debits, audit] = await Promise.all([
    db.predio.findUniqueOrThrow({ where: { id: property }, include: { documentos: true } }),
    db.personaFisica.findUniqueOrThrow({ where: { compareciente_id: person } }),
    db.predioDatoFuente.findMany({ where: { organization_id: org, predio_id: property } }),
    db.comparecienteDatoFuente.findMany({ where: { organization_id: org, compareciente_id: person } }),
    db.aiUsageEvent.findMany({ where: { organization_id: org, status: 'COMPLETED' } }),
    db.aiWallet.findUniqueOrThrow({ where: { organization_id: org } }),
    db.aiWalletTransaction.aggregate({ where: { organization_id: org }, _sum: { amount_minor: true } }),
    db.auditLog.findMany({ where: { organization_id: org, entidad_id: { in: [person, property] } } }),
  ]);
  assert.equal(master.clave_catastral, 'CAT-QA-371'); assert.equal(master.cuenta_predial, 'PRED-QA-841'); assert.equal(master.folio_real, 'REAL-QA-921');
  assert.equal(master.superficie_terreno_m2?.toString(), '350.25'); assert.equal(master.superficie_construccion_m2?.toString(), '180.5');
  assert.equal(master.valor_catastral?.toString(), '1200000'); assert.equal(master.valor_operacion, null); assert.equal(master.valor_avaluo, null);
  assert.equal(identity.ocupacion, 'ARQUITECTA');
  assert.ok(propertySources.length >= 11 && propertySources.every((source) => source.estado === 'CONFIRMADO'));
  assert.ok(personSources.some((source) => source.campo === 'ocupacion' && source.valor_detectado === 'ARQUITECTA'));
  assert.ok(usage.some((entry) => entry.operation_code === 'DOCUMENT_STRUCTURED_EXTRACTION' && entry.input_tokens > 0 && entry.output_tokens > 0));
  assert.ok(usage.some((entry) => entry.operation_code === 'PROPERTY_DOCUMENT_EXTRACTION' && entry.input_tokens > 0 && entry.output_tokens > 0));
  assert.ok(wallet.balance_minor >= 0n); assert.equal(wallet.balance_minor, 300_000n + (debits._sum.amount_minor || 0n));
  for (const action of ['EXTRAER_DATOS_COMPARECIENTE_IA', 'PROPOSE_PROPERTY_FIELDS_AI', 'ACCEPT_PROPERTY_AI_PROPOSAL']) assert.ok(audit.some((entry) => entry.accion === action));
  assert.equal(master.documentos.length, 1);
  const report = { local_only: true, postgres: 'PASS', property_fields: 'PASS', property_human_confirmation: 'PASS', person_saved_occupation: 'PASS',
    real_provider_usage: 'PASS', wallet_ledger: 'PASS', audit: 'PASS', provider: 'OPENAI', synthetic_fx: true,
    production_certification: false, browser_evidence: 'Recorded separately; this verifier does not automate or certify browser actions.' };
  await writeFile(path.join(root, 'postgres-verification.json'), JSON.stringify(report, null, 2), { mode: 0o600 });
  console.log(JSON.stringify(report));
}

async function image(root: string, name: string, lines: string[]) {
  const canvas = createCanvas(1400, 1000);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#e1ded8'; ctx.fillRect(0, 0, 1400, 1000);
  ctx.translate(700, 500); ctx.rotate(-0.025); ctx.translate(-660, -460);
  ctx.fillStyle = '#fffdf9'; ctx.fillRect(0, 0, 1320, 920);
  ctx.fillStyle = '#292b30'; ctx.font = '28px sans-serif';
  lines.forEach((line, index) => ctx.fillText(line, 55, 65 + index * 60));
  const output = path.join(root, name);
  await writeFile(output, canvas.toBuffer('image/png'), { mode: 0o600 });
  return output;
}

async function main() {
  const root = await realpath(String(process.env.QA_ARTIFACT_ROOT || ''));
  if (!root.startsWith('/private/tmp/pravia-client-qa-20261121.') && !root.startsWith('/tmp/pravia-client-qa-20261121.')) throw new Error('QA_ARTIFACT_ROOT_MUST_BE_SCOPED_TEMP_DIRECTORY');
  if (process.env.QA_VERIFY_ONLY === 'true') return verifyPersistedFlow(root);
  const password = String(process.env.QA_LOCAL_PASSWORD || '');
  if (password.length < 16) throw new Error('QA_LOCAL_PASSWORD_REQUIRED');
  const passwordHash = await bcrypt.hash(password, 12);
  for (const [organizationId, userId, email, role] of [
    [org, user, 'documentos.qa@pravia.test', 'ADMINISTRACION'],
    [secondOrg, secondUser, 'otrotenant.qa@pravia.test', 'ADMINISTRACION'],
    [org, '21110000-0000-4000-8000-000000000022', 'lectura.qa@pravia.test', 'CONSULTA'],
  ] as const) {
    await db.organization.upsert({ where: { id: organizationId }, update: {}, create: { id: organizationId, name: `NOTARÍA SINTÉTICA QA ${organizationId === org ? 'A' : 'B'}` } });
    await db.user.upsert({ where: { id: userId }, update: {}, create: { id: userId, email, password_hash: passwordHash, nombre: 'QA', apellido: 'SINTÉTICO', rol: role, activo: true, requires_password_change: false, password_changed_at: new Date() } });
    await db.organizationMembership.upsert({ where: { organization_id_user_id: { organization_id: organizationId, user_id: userId } }, update: {}, create: { organization_id: organizationId, user_id: userId, rol: role, status: 'ACTIVE' } });
    // Synthetic storage capacity; no subscription, cloud or billing provider.
    await db.tenantEntitlement.upsert({ where: { organization_id: organizationId }, update: {}, create: { organization_id: organizationId, included_storage_bytes: 1_073_741_824n, total_storage_capacity_bytes: 1_073_741_824n, features_json: { fixture: true } } });
    await db.tenantStorageUsage.upsert({ where: { organization_id: organizationId }, update: {}, create: { organization_id: organizationId } });
    await db.aiWallet.upsert({ where: { organization_id: organizationId }, update: {}, create: { organization_id: organizationId, balance_minor: 300_000n } });
  }
  await db.compareciente.upsert({ where: { id: person }, update: {}, create: { id: person, organization_id: org, tipo_persona: 'FISICA', nombre_busqueda: 'MARIANA SINTÉTICA QA', creado_por_id: user, personaFisica: { create: { organization_id: org, nombre: 'MARIANA', apellido_paterno: 'SINTÉTICA', apellido_materno: 'QA', nombre_completo_calculado: 'MARIANA SINTÉTICA QA' } } } });
  await db.predio.upsert({ where: { id: property }, update: {}, create: { id: property, organization_id: org, apodo: 'INMUEBLE SINTÉTICO QA', created_by: user, updated_by: user } });
  await db.aiModelRegistry.upsert({ where: { provider_code_model_code: { provider_code: 'OPENAI', model_code: model } }, update: {}, create: { provider_code: 'OPENAI', model_code: model, capabilities: ['text', 'image'], quality_tier: 'ECONOMY', pricing_reference: 'https://developers.openai.com/api/docs/models/gpt-5.4-nano' } });
  await db.resourceCostVersion.upsert({ where: { resource_code_provider_code_version: { resource_code: `AI_MODEL:${model}`, provider_code: 'OPENAI', version: 1 } }, update: {}, create: {
    resource_code: `AI_MODEL:${model}`, provider_code: 'OPENAI', unit: 'MILLION_TOKENS', cost_amount: '0.20', currency: 'USD', version: 1, effective_from: new Date('2026-11-21T00:00:00Z'),
    metadata: { output_per_million: '1.25', cached_input_per_million: '0.02', source: 'https://developers.openai.com/api/docs/models/gpt-5.4-nano',
      // Deliberately synthetic FX for local ledger tests, NOT an official FX
      // quote or a sale price. Actual provider USD cost is recorded separately.
      fx_rate: '1', fx_source: 'QA_SYNTHETIC_NOT_FOR_PRODUCTION', fx_as_of: '2026-11-21', fixture: true },
  } });
  for (const code of ['DOCUMENT_STRUCTURED_EXTRACTION', 'PROPERTY_DOCUMENT_EXTRACTION']) {
    await db.aiOperationCatalog.upsert({ where: { operation_code: code }, update: {}, create: { operation_code: code, billing_class: 'CUSTOMER_WALLET', required_capability: 'ia.execute', quality_tier: 'ECONOMY', max_input: 20_000, max_output: 8192, max_charge_minor: 1000n } });
    await db.aiRoutingPolicyVersion.upsert({ where: { operation_code_version: { operation_code: code, version: 1 } }, update: {}, create: { operation_code: code, version: 1, effective_from: new Date('2026-11-21T00:00:00Z'), routing_rules_json: { candidates: [{ providerCode: 'OPENAI', modelCode: model }] } } });
    await db.commercialSkuVersion.upsert({ where: { sku_version: { sku: `AI_USAGE:${code}`, version: 1 } }, update: {}, create: { sku: `AI_USAGE:${code}`, kind: 'AI_USAGE', quantity: 1, unit: 'CALL', sale_price_minor: null, min_markup_multiplier: 2, version: 1, effective_from: new Date('2026-11-21T00:00:00Z') } });
  }
  await mkdir(path.join(root, 'fixtures'), { recursive: true });
  const fixtures = [
    await image(path.join(root, 'fixtures'), 'persona-foto-sintetica.png', ['SINTÉTICO / SIN VALIDEZ JURÍDICA', 'FICHA INFORMATIVA DE QA — NO ES IDENTIFICACIÓN OFICIAL', 'Nombre: MARIANA', 'Apellido paterno: SINTÉTICA', 'Apellido materno: QA', 'Ocupación: ARQUITECTA', 'Nacionalidad: MEXICANA', 'Correo electrónico: mariana.sintetica@example.test']),
    await image(path.join(root, 'fixtures'), 'inmueble-foto-sintetica.png', ['SINTÉTICO / SIN VALIDEZ JURÍDICA', 'FICHA DOCUMENTAL DE INMUEBLE QA', 'Clave catastral: CAT-QA-371', 'Cuenta predial: PRED-QA-841', 'Folio real: REAL-QA-921', 'Superficie de terreno: 350.25 m2', 'Superficie de construcción: 180.50 m2', 'Valor catastral: 1,200,000.00 MXN', 'Calle: ENSAYO DOCUMENTAL', 'Número exterior: 42', 'Municipio: TEPIC', 'Estado: NAYARIT', 'País: MÉXICO']),
  ];
  console.log(JSON.stringify({ local_only: true, organization_id: org, person_id: person, property_id: property, email: 'documentos.qa@pravia.test', fixtures, synthetic_fx: true }));
}
main().catch((error) => { console.error(error instanceof Error ? error.message : 'QA_SETUP_FAILED'); process.exitCode = 1; }).finally(() => db.$disconnect());
