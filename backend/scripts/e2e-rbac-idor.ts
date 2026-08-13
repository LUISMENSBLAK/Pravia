import 'dotenv/config';
import bcrypt from 'bcryptjs';
import { PrismaClient, Role } from '@prisma/client';
import { randomUUID } from 'node:crypto';

const base = (process.env.E2E_API_URL || 'http://127.0.0.1:3001/api').replace(/\/$/, '');
const password = String(process.env.PRAVIA_E2E_PASSWORD || '');
const allowed = process.env.E2E_ALLOW_MUTATIONS === 'isolated-database-confirmed';
const hostname = new URL(base).hostname;
if (!allowed || !['localhost', '127.0.0.1', '::1'].includes(hostname)) {
  throw new Error('RBAC E2E solo se ejecuta en localhost con E2E_ALLOW_MUTATIONS=isolated-database-confirmed.');
}
if (!password) throw new Error('PRAVIA_E2E_PASSWORD es obligatoria para las identidades sintéticas.');

const prisma = new PrismaClient();
const suffix = randomUUID().slice(0, 8);
const checks: string[] = [];

async function syntheticUser(role: Role, label: string) {
  const email = `e2e-rbac-${label}-${suffix}@example.invalid`;
  return prisma.user.create({ data: {
    email,
    password_hash: await bcrypt.hash(password, 12),
    nombre: `E2E ${label}`,
    apellido: suffix,
    rol: role,
    activo: true,
    requires_password_change: false,
    password_changed_at: new Date(),
  } });
}

async function login(email: string) {
  const response = await fetch(`${base}/auth/login`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password }),
  });
  const body: any = await response.json();
  if (response.status !== 200 || !body.access_token) throw new Error(`Login RBAC falló para ${email}.`);
  return body.access_token as string;
}

async function api(token: string, path: string, init: RequestInit = {}, expected = 200) {
  const headers = new Headers(init.headers);
  headers.set('authorization', `Bearer ${token}`);
  if (init.body && !(init.body instanceof FormData)) headers.set('content-type', 'application/json');
  const response = await fetch(`${base}${path}`, { ...init, headers });
  const body: any = await response.json().catch(() => ({}));
  if (response.status !== expected) throw new Error(`${init.method || 'GET'} ${path}: esperado ${expected}, recibido ${response.status} (${body.code || body.error || ''}).`);
  if (!response.headers.get('x-correlation-id')) throw new Error(`${path} no devolvió correlation-id.`);
  return body;
}

async function main() {
  const [lawyerA, lawyerB, reception, management, readOnly] = await Promise.all([
    syntheticUser('ABOGADO', 'abogado-a'), syntheticUser('ABOGADO', 'abogado-b'),
    syntheticUser('RECEPCION', 'recepcion'), syntheticUser('GESTORIA', 'gestoria'), syntheticUser('CONSULTA', 'consulta'),
  ]);
  const [tokenA, tokenB, tokenReception, tokenManagement, tokenReadOnly] = await Promise.all([
    login(lawyerA.email), login(lawyerB.email), login(reception.email), login(management.email), login(readOnly.email),
  ]);
  checks.push('auth:roles-login');

  const [type, notary] = await Promise.all([
    prisma.tipoActo.findFirstOrThrow({ where: { activo: true } }),
    prisma.notaria.findFirstOrThrow({ where: { activa: true, archived_at: null } }),
  ]);
  const prospectB = await api(tokenB, '/prospectos', { method: 'POST', body: JSON.stringify({ nombre: `Prospecto B ${suffix}`, estado: 'NUEVO', prioridad: 'MEDIA' }) }, 201);
  await api(tokenA, `/prospectos/${prospectB.id}`, {}, 403);
  await api(tokenA, `/prospectos/${randomUUID()}`, {}, 403);
  checks.push('idor:prospecto-403-sin-filtrar-existencia');

  const quoteB = await api(tokenB, '/cotizaciones', { method: 'POST', body: JSON.stringify({ prospecto_id: prospectB.id, notaria_id: notary.id }) }, 201);
  await api(tokenA, `/cotizaciones/${quoteB.id}`, {}, 403);
  checks.push('idor:cotizacion-403');

  const expedienteB = await api(tokenB, '/expedientes', { method: 'POST', body: JSON.stringify({ tipo_acto_id: type.id, abogado_id: lawyerB.id, cliente_alias: `Cliente B ${suffix}` }) }, 201);
  await api(tokenA, `/expedientes/${expedienteB.id}`, {}, 403);
  await api(tokenReception, `/expedientes/${expedienteB.id}`, {}, 403);
  await api(tokenManagement, `/expedientes/${expedienteB.id}`, {}, 403);
  await api(tokenReadOnly, `/expedientes/${expedienteB.id}`, {}, 200);
  await api(tokenReadOnly, `/expedientes/${expedienteB.id}`, { method: 'PATCH', body: JSON.stringify({ version: expedienteB.version, cliente_alias: 'No permitido' }) }, 403);
  checks.push('scope:expediente-abogado-recepcion-gestoria-consulta');

  const pdf = Buffer.from('%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF');
  const form = new FormData();
  form.set('file', new Blob([pdf], { type: 'application/pdf' }), `idor-${suffix}.pdf`);
  form.set('categoria', 'PROYECTO');
  form.set('carpeta', 'Administrativo');
  const uploaded = await api(tokenB, `/expedientes/${expedienteB.id}/documentos`, { method: 'POST', body: form }, 201);
  await api(tokenA, `/documentos/${uploaded.documento.id}/url`, {}, 403);
  await api(tokenA, `/expedientes/${expedienteB.id}/documentos/${uploaded.documento.id}/visualizar`, {}, 403);
  checks.push('idor:documento-y-url-firmada-403');

  await api(tokenA, '/finanzas/resumen', {}, 403);
  await api(tokenReadOnly, '/users', {}, 403);
  await api(tokenReadOnly, '/notarias', { method: 'POST', body: JSON.stringify({ nombre: 'No permitida' }) }, 403);
  await api(tokenReadOnly, '/prospectos', { method: 'POST', body: JSON.stringify({ nombre: 'No permitido' }) }, 403);
  checks.push('rbac:consulta-no-muta-finanzas-y-usuarios-restringidos');

  const unauthenticated = await fetch(`${base}/expedientes/${expedienteB.id}`);
  if (unauthenticated.status !== 401) throw new Error(`Acceso sin token esperado 401, recibido ${unauthenticated.status}.`);
  checks.push('auth:sin-token-401');

  console.log(JSON.stringify({ ok: true, environment: 'local-isolated', checks }, null, 2));
}

main()
  .catch((error) => { console.error(JSON.stringify({ ok: false, checks, error: error.message }, null, 2)); process.exitCode = 1; })
  .finally(async () => prisma.$disconnect());
