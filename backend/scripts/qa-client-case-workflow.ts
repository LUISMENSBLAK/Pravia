import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';

// Synthetic fixtures only. Never load .env or use a remote runtime here.
const target = process.env.QA_CLIENT_CASE_DATABASE_URL || '';
const parsed = new URL(target);
assert.equal(parsed.hostname, '127.0.0.1'); assert.equal(parsed.port, '55521');
assert.equal(parsed.pathname, '/pravia_client_qa'); assert.equal(parsed.searchParams.get('schema'), 'pravia_os');
const db = new PrismaClient({ datasources: { db: { url: target } } });
const base = 'http://127.0.0.1:3011/api', org = '21110000-0000-4000-8000-000000000001';
const adminId = '21110000-0000-4000-8000-000000000002', clientA = '21110000-0000-4000-8000-000000000003';
const clientB = '21110000-0000-4000-8000-000000000203', seller = '21110000-0000-4000-8000-000000000204';
const password = process.env.QA_LOCAL_PASSWORD;
assert.ok(password && password.length >= 16, 'QA_LOCAL_PASSWORD_REQUIRED');
async function login(email: string) {
  const r = await fetch(`${base}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }) });
  assert.equal(r.status, 200, `LOCAL_LOGIN_FAILED:${email}`); return (await r.json() as any).access_token as string;
}
async function request(token: string, path: string, method = 'GET', body?: unknown, expected?: number) {
  const r = await fetch(`${base}${path}`, { method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const data: any = await r.json();
  if (expected !== undefined) assert.equal(r.status, expected, `${method} ${path}:${data.code || data.error || 'unexpected HTTP'}`);
  else assert.ok(r.ok, `${method} ${path}:${r.status}:${data.code || data.error || 'operation failed'}`);
  return data;
}
async function main() {
  const health: any = await (await fetch('http://127.0.0.1:3011/health')).json();
  assert.equal(health.database_mode, 'local'); assert.equal(health.storage_mode, 'local'); assert.equal(health.database, 'ok');
  const token = await login('documentos.qa@pravia.test');
  if (process.env.QA_VERIFY_ONLY === 'true') {
    // Recheck existing evidence without changing the case used for Projection.
    const id = '2d49eeef-6757-4c35-84f5-9a046b47b982';
    const detail = await request(token, `/expedientes/${id}`);
    assert.ok(detail.cliente_compareciente_id);
    const client = await db.compareciente.findUniqueOrThrow({ where: { id: detail.cliente_compareciente_id } });
    assert.equal(client.organization_id, org); assert.equal(detail.cliente_principal, client.nombre_busqueda);
    const parties = await request(token, `/expedientes/${id}/comparecientes`);
    const summary = parties.validations[0];
    assert.equal(summary.transmitter_count, 1); assert.equal(summary.acquirer_count, 1);
    assert.equal(summary.transmitter_total, 100); assert.equal(summary.acquirer_total, 100);
    assert.equal(summary.consistent, true); assert.deepEqual(summary.warnings, []);
    const direct = await request(token, '/cotizaciones/93384f80-d8f7-4a99-be02-bcfa8c9b1277');
    assert.equal(direct.prospecto_id, null); assert.ok(direct.user_id);
    const values = await db.cotizacion.findUniqueOrThrow({ where: { id: '21110000-0000-4000-8000-000000000103' } });
    assert.equal(values.valor_operacion?.toFixed(2), '2500000.50');
    assert.equal(values.valor_catastral?.toFixed(2), '1200000.25');
    assert.equal(values.cuenta_predial, '0001-a/26'); assert.equal(values.importe_predial?.toFixed(2), '0.00');
    assert.ok(await db.auditLog.count({ where: { entidad_id: id, accion: 'UPDATE_EXPEDIENTE_HEADER' } }));
    const foreign = await login('otrotenant.qa@pravia.test');
    await request(foreign, `/expedientes/${id}`, 'GET', undefined, 403);
    console.log(JSON.stringify({ read_only_verification: 'PASS', canonical_client: 'PASS', direct_quote: 'PASS', optional_values: 'PASS', participation: summary, tenant: 'PASS', audit: 'PASS' }));
    return;
  }
  for (const [id, name] of [[clientB, 'ELENA SINTÉTICA CLIENTE QA'], [seller, 'ROBERTO SINTÉTICO VENDEDOR QA']]) {
    await db.compareciente.upsert({ where: { id }, update: {}, create: { id, organization_id: org, creado_por_id: adminId,
      tipo_persona: 'FISICA', nombre_busqueda: name, personaFisica: { create: { nombre: name.split(' ')[0], apellido_paterno: 'SINTÉTICO', nombre_completo_calculado: name } } } });
  }
  const act = await db.tipoActo.findFirstOrThrow({ where: { organization_id: org, nombre: 'COMPRAVENTA SINTÉTICA QA ACT4' } });
  for (const name of ['Vendedor', 'Comprador']) {
    const exists = await db.tipoActoCaracterCompareciente.findFirst({ where: { tipo_acto_id: act.id, caracter: { nombre: { equals: name, mode: 'insensitive' } } } });
    if (!exists) await request(token, `/settings/catalogs/acts/${act.id}/characters`, 'POST', { name, principal: name === 'Comprador' });
  }
  const quote = await request(token, '/cotizaciones', 'POST', { formalApplicantId: clientA, operationContext: 'SINTÉTICO QA ACTUALIZACIONES 5 Y 6', confirm: true, idempotencyKey: 'qa-client-case-20261121-56' });
  let q = await request(token, `/cotizaciones/${quote.id}`);
  const newCase = !q.expediente;
  if (!q.expediente) {
    await request(token, `/cotizaciones/${q.id}/actos`, 'POST', { tipo_acto_id: act.id });
    q = await request(token, `/cotizaciones/${q.id}`);
    if (['BORRADOR', 'EN_ELABORACION'].includes(q.workflow.stage)) {
      await request(token, `/cotizaciones/${q.id}/presupuesto`, 'PUT', { expectedUpdatedAt: q.updated_at, concepts: [{ categoria: 'HONORARIOS', concepto: 'HONORARIOS SINTÉTICOS QA', importe: '1000.00' }], operationContext: q.contexto_operacion, origin: 'MANUAL' });
    }
    const action = async (code: string, extra = {}) => {
      const current = await request(token, `/cotizaciones/${q.id}`);
      return request(token, `/cotizaciones/${q.id}/acciones`, 'POST', { action: code, expectedVersion: current.workflow.version,
        confirm: true, idempotencyKey: randomUUID(), effectiveAt: new Date().toISOString(), ...extra });
    };
    q = await request(token, `/cotizaciones/${q.id}`);
    if (q.workflow.stage === 'BORRADOR') await action('COMENZAR_ELABORACION');
    q = await request(token, `/cotizaciones/${q.id}`);
    if (q.workflow.stage === 'EN_ELABORACION') await action('ENVIAR_CLIENTE', { channel: 'entrega', recipient: 'DESTINATARIO SINTÉTICO LOCAL', evidence: 'Simulación de entrega exclusivamente local para QA. No se envió correo ni documento a un cliente.', deliveryMode: 'MANUAL_CONFIRMED' });
    q = await request(token, `/cotizaciones/${q.id}`);
    if (q.workflow.stage === 'ENVIADA_CLIENTE') await action('ACEPTAR', { confirmedActIds: q.actos.map((a: any) => a.id), formalApplicantId: clientA });
    q = await request(token, `/cotizaciones/${q.id}`);
    await request(token, `/cotizaciones/${q.id}/convertir`, 'POST', { expectedVersion: q.workflow.version, confirm: true,
      idempotencyKey: randomUUID(), effectiveAt: new Date().toISOString(), solicitante_caracter_por_acto: Object.fromEntries(q.actos.map((a: any) => [a.id, null])) });
    q = await request(token, `/cotizaciones/${q.id}`);
  }
  const id = q.expediente.id;
  let detail = await request(token, `/expedientes/${id}`);
  if (!newCase && detail.cliente_compareciente_id !== clientA) {
    await request(token, `/expedientes/${id}`, 'PATCH', { cliente_compareciente_id: clientA, version: detail.version });
    detail = await request(token, `/expedientes/${id}`);
  }
  assert.equal(detail.cliente_compareciente_id, clientA);
  assert.equal(detail.cliente_principal, (await db.compareciente.findUniqueOrThrow({ where: { id: clientA } })).nombre_busqueda);
  // Client is NOT forced into an act role. The conversion above explicitly chose no appearance.
  if (newCase) assert.equal(await db.expedienteCompareciente.count({ where: { expediente_id: id } }), 0);
  const version = detail.version;
  await request(token, `/expedientes/${id}`, 'PATCH', { cliente_alias: 'TEXTO LIBRE NO ADMITIDO', version }, 409);
  await request(token, `/expedientes/${id}`, 'PATCH', { cliente_compareciente_id: null, version }, 400);
  await request(token, `/expedientes/${id}`, 'PATCH', { cliente_compareciente_id: clientB, version });
  detail = await request(token, `/expedientes/${id}`);
  assert.equal(detail.cliente_compareciente_id, clientB); assert.equal(detail.cliente_principal, 'ELENA SINTÉTICA CLIENTE QA');
  await request(token, `/expedientes/${id}`, 'PATCH', { cliente_compareciente_id: clientA, version }, 409);
  const foreignToken = await login('otrotenant.qa@pravia.test'), readToken = await login('lectura.qa@pravia.test');
  await request(foreignToken, `/expedientes/${id}`, 'PATCH', { cliente_compareciente_id: clientB, version: detail.version }, 403);
  await request(readToken, `/expedientes/${id}`, 'PATCH', { cliente_compareciente_id: clientB, version: detail.version }, 403);
  const foreign = await db.compareciente.create({ data: { organization_id: '21110000-0000-4000-8000-000000000011', creado_por_id: '21110000-0000-4000-8000-000000000012', tipo_persona: 'FISICA', nombre_busqueda: 'SINTÉTICO OTRO TENANT' } });
  await request(token, `/expedientes/${id}`, 'PATCH', { cliente_compareciente_id: foreign.id, version: detail.version }, 400);
  await assert.rejects(db.expediente.update({ where: { id }, data: { cliente_compareciente_id: foreign.id } }));
  assert.ok(await db.auditLog.count({ where: { entidad_id: id, accion: 'UPDATE_EXPEDIENTE_HEADER' } }));
  const cases: any = await request(token, '/expedientes?search=ELENA%20SINT%C3%89TICA&page=1&pageSize=20');
  assert.ok(cases.data.some((row: any) => row.id === id && row.cliente_principal === detail.cliente_principal));
  const acts = await db.expedienteActo.findMany({ where: { expediente_id: id, estatus: 'ACTIVO', removed_at: null } });
  const roles = await db.tipoActoCaracterCompareciente.findMany({ where: { tipo_acto_id: act.id }, include: { caracter: true } });
  for (const [personId, roleName] of [[clientA, 'Comprador'], [seller, 'Vendedor']]) {
    const role = roles.find((row) => row.caracter.nombre.toLocaleLowerCase('es') === roleName.toLocaleLowerCase('es'))!;
    const exists = await db.expedienteCompareciente.findFirst({ where: { expediente_id: id, expediente_acto_id: acts[0].id, compareciente_id: personId, caracter_id: role.caracter_id, archived_at: null, estatus: 'ACTIVO' } });
    if (exists) { assert.equal(Number(exists.participacion_porcentaje), 100); continue; }
    const command = { operation: 'LINK', expediente_acto_id: acts[0].id, compareciente_id: personId, caracter_id: role.caracter_id, forma_comparecencia: 'PROPIO_DERECHO', participacion_porcentaje: 100 };
    const preview = await request(token, `/expedientes/${id}/comparecientes/preview`, 'POST', command);
    await request(token, `/expedientes/${id}/comparecientes/aplicar`, 'POST', { ...command, preview_fingerprint: preview.fingerprint, idempotency_key: randomUUID(), confirm_protected_work: false });
  }
  const parties = await request(token, `/expedientes/${id}/comparecientes`);
  const summary = parties.validations[0];
  assert.equal(summary.transmitter_count, 1); assert.equal(summary.acquirer_count, 1);
  assert.equal(summary.transmitter_total, 100); assert.equal(summary.acquirer_total, 100);
  assert.equal(summary.consistent, true); assert.deepEqual(summary.warnings, []);
  detail = await request(token, `/expedientes/${id}`);
  assert.equal(detail.cliente_compareciente_id, clientB, 'An appearance must not replace the selected client');
  console.log(JSON.stringify({ caseId: id, folio: detail.numero_pravia, quoteId: q.id, clientAfterChange: clientB, participation: summary, tests: 'client conversion/reload/change/conflict/RBAC/tenant/FK/audit/search/100-percent-per-side PASS' }));
}
main().catch((error) => { console.error(error.message); process.exitCode = 1; }).finally(() => db.$disconnect());
