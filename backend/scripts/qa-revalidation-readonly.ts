/** Local revalidation only. Does not create domain records or call providers.
 * Auth session rotation/logout and security audit records are expected writes. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { PrismaClient } from '@prisma/client';
import { PDFDocument } from 'pdf-lib';
import { permissionsForRole, type Permission } from '../src/auth/permissions';

const target = new URL(process.env.QA_CLIENT_CASE_DATABASE_URL || 'postgresql://invalid/invalid');
assert.deepEqual([target.hostname, target.port, target.pathname, target.searchParams.get('schema')], ['127.0.0.1', '55521', '/pravia_client_qa', 'pravia_os']);
assert.equal(process.env.STORAGE_MODE, 'local');
const api = 'http://127.0.0.1:3011/api';
const password = process.env.QA_LOCAL_PASSWORD;
assert.ok(password);
const db = new PrismaClient({ datasourceUrl: target.href });
type Session = { token: string; cookie: string; user: any };
const results: Array<{ check: string; status: string; expected?: number; actual?: number; code?: string }> = [];
const record = (check: string, pass: boolean, extra = {}) => results.push({ check, status: pass ? 'PASS' : 'FAIL', ...extra });
async function request(session: Session | null, route: string, expected: number, method = 'GET', body?: unknown) {
  const response = await fetch(`${api}${route}`, { method, headers: { ...(session ? { Authorization: `Bearer ${session.token}` } : {}), 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const value: any = await response.json();
  record(`${session?.user.rol ?? session?.user.role ?? 'ANONYMOUS'} ${method} ${route}`, response.status === expected, { expected, actual: response.status, ...(response.status !== expected ? { code: value.code ?? 'NO_CODE' } : {}) });
  assert.ok(response.headers.get('x-correlation-id'));
  return value;
}
async function login(email: string) {
  const response = await fetch(`${api}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }) });
  assert.equal(response.status, 200, 'LOCAL_QA_LOGIN_FAILED');
  const value: any = await response.json();
  assert.ok(value.access_token);
  return { token: value.access_token as string, cookie: response.headers.getSetCookie().map(item => item.split(';')[0]).join('; '), user: value.user };
}
async function main() {
  const health: any = await (await fetch('http://127.0.0.1:3011/health')).json();
  assert.equal(health.database_mode, 'local'); assert.equal(health.storage_mode, 'local'); assert.equal(health.database, 'ok');
  const admin = await login('documentos.qa@pravia.test');
  const reader = await login('lectura.qa@pravia.test');
  const foreign = await login('otrotenant.qa@pravia.test');
  const org = '21110000-0000-4000-8000-000000000001';
  for (const session of [admin, reader]) assert.equal(session.user.organization.id, org);
  assert.notEqual(foreign.user.organization.id, org);

  const reads: Array<[string, Permission]> = [
    ['/mi-dia', 'mi_dia.read'], ['/prospectos', 'prospectos.read'], ['/cotizaciones', 'cotizaciones.read'],
    ['/expedientes', 'expedientes.read'], ['/predios', 'expedientes.read'], ['/comparecientes', 'comparecientes.read'],
    ['/archivo', 'expedientes.read'], ['/agenda', 'agenda.read'], ['/isr', 'isr.read'],
    ['/finanzas/resumen', 'finanzas.read'], ['/finanzas/cartera', 'finanzas.read'],
    ['/finanzas/facturacion/estado', 'finanzas.read'], ['/finanzas/facturacion/entidades', 'finanzas.read'],
    ['/finanzas/facturacion/conceptos', 'finanzas.read'], ['/finanzas/facturacion/documentos', 'finanzas.read'],
    ['/reportes/resumen', 'reportes.read'], ['/cumplimiento/revisiones', 'compliance.read'],
    ['/ia/assistant/conversations', 'ai.use'], ['/ia/assistant/tools', 'ai.use'],
  ];
  for (const session of [admin, reader]) {
    const role = session.user.rol ?? session.user.role;
    const permissions = permissionsForRole(role);
    const me = await request(session, '/auth/me', 200);
    record(`${role} persisted role and Organization`, me.user.organization.id === org && (me.user.rol ?? me.user.role) === role);
    for (const [route, permission] of reads) await request(session, route, permissions.includes(permission) ? 200 : 403);
    await request(session, '/platform/admin/dashboard', 403);
    const policy = await request(session, '/upload-policy', 200);
    record(`${role} standard upload policy is 50 MiB`, policy.standard_file_max_bytes === 50 * 1024 * 1024);
  }
  for (const route of ['/prospectos', '/cotizaciones', '/comparecientes', '/predios', '/agenda', '/finanzas/movimientos', '/users/invitations']) await request(reader, route, 403, 'POST', {});
  await request(null, '/expedientes', 401);

  const resources = [
    ['expedientes', await db.expediente.findFirstOrThrow({ where: { organization_id: org, archived_at: null }, orderBy: { created_at: 'desc' }, select: { id: true } })],
    ['cotizaciones', await db.cotizacion.findFirstOrThrow({ where: { organization_id: org }, orderBy: { created_at: 'desc' }, select: { id: true } })],
    ['comparecientes', await db.compareciente.findFirstOrThrow({ where: { organization_id: org, archived_at: null }, select: { id: true } })],
    ['predios', await db.predio.findFirstOrThrow({ where: { organization_id: org, archived_at: null }, select: { id: true } })],
  ] as const;
  for (const [domain, entity] of resources) {
    await request(admin, `/${domain}/${entity.id}`, 200);
    await request(foreign, `/${domain}/${entity.id}`, 403);
  }
  const file = await db.documento.findFirstOrThrow({ where: { organization_id: org, estatus: 'VIGENTE', tipo: 'COTIZACION_GENERADA' }, select: { id: true }, orderBy: { fecha_carga: 'desc' } });
  await request(foreign, `/documentos/${file.id}/url`, 403);

  const since = new Date(Date.now() - 10 * 60_000);
  const denials = await db.auditLog.count({ where: { organization_id: org, user_id: reader.user.id, created_at: { gte: since } } });
  record('Restricted requests recorded in AuditLog', denials > 0);
  const preinvoices = await db.prefacturaRepresentacion.findMany({ where: { organization_id: org }, include: { documento: true }, orderBy: { created_at: 'desc' } });
  for (const version of preinvoices) {
    const root = path.resolve(process.env.LOCAL_STORAGE_PATH!);
    const filename = path.resolve(root, version.documento.storage_key);
    assert.ok(filename.startsWith(`${root}${path.sep}`));
    const bytes = await readFile(filename);
    const sha = createHash('sha256').update(bytes).digest('hex');
    const pdf = await PDFDocument.load(bytes);
    record(`Stored prefactura ${version.id} integrity and readable PDF`, sha === version.pdf_sha256 && sha === version.documento.checksum_sha256 && bytes.length === version.size_bytes && pdf.getPageCount() > 0);
  }
  for (const cfdiId of new Set(preinvoices.map(version => version.cfdi_id))) {
    await request(reader, `/finanzas/facturacion/borradores/${cfdiId}/prefacturas/1`, 403);
    // The canonical fiscal service scopes its lookup by Organization and returns
    // 404, deliberately not disclosing that the foreign draft exists.
    const denied = await request(foreign, `/finanzas/facturacion/borradores/${cfdiId}/prefacturas/1`, 404);
    assert.equal(denied.code, 'CFDI_DRAFT_NOT_FOUND');
    assert.equal(denied.url, undefined); assert.equal(denied.data?.url, undefined);
  }
  if (!preinvoices.length) results.push({ check: 'Existing prefactura PDF in current QA tenant', status: 'NOT_VERIFIED' });
  // Use the real cookie rotation flow. No token, cookie or password is logged.
  for (const session of [admin, reader, foreign]) {
    const refresh = await fetch(`${api}/auth/refresh`, { method: 'POST', headers: { Cookie: session.cookie } });
    assert.equal(refresh.status, 200, 'LOCAL_QA_REFRESH_FAILED');
    const rotated: any = await refresh.json();
    await request(session, '/auth/me', 401);
    session.token = rotated.access_token;
    session.cookie = refresh.headers.getSetCookie().map(item => item.split(';')[0]).join('; ');
    await request(session, '/auth/me', 200);
    const logout = await fetch(`${api}/auth/logout`, { method: 'POST', headers: { Cookie: session.cookie, Authorization: `Bearer ${session.token}` } });
    record('Logout accepted', logout.status === 200 || logout.status === 204);
    await request(session, '/auth/me', 401);
  }
  const again = await login('documentos.qa@pravia.test');
  await request(again, '/auth/me', 200);
  await fetch(`${api}/auth/logout`, { method: 'POST', headers: { Cookie: again.cookie, Authorization: `Bearer ${again.token}` } });
  console.log(JSON.stringify({ scope: 'LOCAL_CURRENT_QA_ONLY', provider_calls: 0, domain_records_created: 0, results, passed: results.filter(item => item.status === 'PASS').length, failed: results.filter(item => item.status === 'FAIL').length }, null, 2));
  if (results.some(item => item.status === 'FAIL')) process.exitCode = 1;
}
main().catch(error => { console.error(JSON.stringify({ status: 'FAIL', code: error.code ?? error.name, message: error.message, results })); process.exitCode = 1; }).finally(() => db.$disconnect());
