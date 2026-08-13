import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { PrismaClient } from '@prisma/client';

const base = (process.env.E2E_API_URL || 'http://127.0.0.1:3001/api').replace(/\/$/, '');
const hostname = new URL(base).hostname;
const allowed = process.env.E2E_ALLOW_MUTATIONS === 'isolated-database-confirmed';

if (!allowed || !['localhost', '127.0.0.1', '::1'].includes(hostname)) {
  throw new Error('Auth E2E solo se ejecuta en localhost con E2E_ALLOW_MUTATIONS=isolated-database-confirmed.');
}

const suffix = randomUUID().slice(0, 8);
const adminEmail = `e2e-auth-admin-${suffix}@example.invalid`;
const adminPassword = `Pravia!Admin-${suffix}-Z9`;
const invitedEmail = `e2e-auth-${suffix}@example.invalid`;
const initialPassword = `Pravia!Auth-${suffix}-A1`;
const recoveredPassword = `Pravia!Auth-${suffix}-B2`;
const finalPassword = `Pravia!Auth-${suffix}-C3`;
const checks: string[] = [];
const prisma = new PrismaClient();

type ApiResult = {
  status: number;
  body: any;
  cookie: string;
  setCookie: string;
};

const cookiePair = (setCookie: string) => setCookie.split(';', 1)[0] || '';

async function request(path: string, init: RequestInit = {}): Promise<ApiResult> {
  const response = await fetch(`${base}${path}`, init);
  const body = response.status === 204 ? {} : await response.json().catch(() => ({}));
  const setCookie = response.headers.get('set-cookie') || '';
  if (!response.headers.get('x-correlation-id')) throw new Error(`${path} no devolvió correlation-id.`);
  return { status: response.status, body, cookie: cookiePair(setCookie), setCookie };
}

async function expect(path: string, init: RequestInit, status: number) {
  const result = await request(path, init);
  if (result.status !== status) {
    throw new Error(`${init.method || 'GET'} ${path}: esperado ${status}, recibido ${result.status} (${result.body.code || result.body.error || ''}).`);
  }
  return result;
}

const json = (body: unknown, token?: string, cookie?: string, method = 'POST'): RequestInit => ({
  method,
  headers: {
    'content-type': 'application/json',
    ...(token ? { authorization: `Bearer ${token}` } : {}),
    ...(cookie ? { cookie } : {}),
  },
  body: JSON.stringify(body),
});

const auth = (token: string, method = 'GET'): RequestInit => ({ method, headers: { authorization: `Bearer ${token}` } });

async function login(email: string, password: string, remember = false) {
  return expect('/auth/login', json({ email, password, remember }), 200);
}

async function main() {
  await prisma.user.create({ data: {
    email: adminEmail,
    password_hash: await bcrypt.hash(adminPassword, 12),
    nombre: 'E2E Dirección',
    apellido: suffix,
    rol: 'DIRECCION',
    activo: true,
    requires_password_change: false,
    password_changed_at: new Date(),
  } });

  const temporary = await login(adminEmail, adminPassword, false);
  if (!temporary.body.access_token || !temporary.cookie) throw new Error('Login temporal no emitió tokens.');
  if (!/httponly/i.test(temporary.setCookie) || !/samesite=strict/i.test(temporary.setCookie)) throw new Error('Cookie temporal sin HttpOnly/SameSite=Strict.');
  if (/max-age=/i.test(temporary.setCookie) || /expires=/i.test(temporary.setCookie)) throw new Error('Cookie temporal se persistió indebidamente.');
  checks.push('session:cookie-temporal-http-only');

  await expect('/auth/me', auth(temporary.body.access_token), 200);
  const rotated = await expect('/auth/refresh', { method: 'POST', headers: { cookie: temporary.cookie } }, 200);
  if (!rotated.body.access_token || rotated.cookie === temporary.cookie) throw new Error('Refresh no rotó credenciales.');
  await expect('/auth/me', auth(temporary.body.access_token), 401);
  await expect('/auth/logout', { method: 'POST', headers: { cookie: rotated.cookie } }, 204);
  await expect('/auth/refresh', { method: 'POST', headers: { cookie: rotated.cookie } }, 401);
  checks.push('session:rotacion-logout-revocacion');

  const persistent = await login(adminEmail, adminPassword, true);
  if (!/max-age=/i.test(persistent.setCookie)) throw new Error('Recordarme no emitió cookie persistente.');
  checks.push('session:recordarme-persistente');

  const invitation = await expect('/users/invitations', json({
    email: invitedEmail,
    nombre: 'E2E Autenticación',
    apellido: suffix,
    rol: 'CONSULTA',
  }, persistent.body.access_token), 201);
  const activationUrl = String(invitation.body.development_activation_url || '');
  const activationToken = new URL(activationUrl).searchParams.get('token') || '';
  if (!activationToken) throw new Error('El entorno aislado no devolvió token de activación de desarrollo.');
  await expect(`/auth/activation?token=${encodeURIComponent(activationToken)}`, { method: 'GET' }, 200);
  const activated = await expect('/auth/activation', json({ token: activationToken, password: initialPassword }), 201);
  const userId = String(activated.body.user?.id || '');
  if (!userId || !activated.body.access_token) throw new Error('Activación no creó la cuenta/sesión esperada.');
  checks.push('account:invitacion-activacion');

  await expect(`/users/${userId}`, json({ activo: false, confirm_impact: true }, persistent.body.access_token, undefined, 'PATCH'), 200);
  await expect('/auth/me', auth(activated.body.access_token), 401);
  await expect(`/users/${userId}`, json({ activo: true }, persistent.body.access_token, undefined, 'PATCH'), 200);
  const reactivated = await login(invitedEmail, initialPassword);
  checks.push('account:suspension-revocacion-reactivacion');

  const recovery = await expect('/auth/request-recovery', json({ email: invitedEmail }), 200);
  const resetToken = String(recovery.body.development_reset_token || '');
  if (!resetToken) throw new Error('El entorno aislado no devolvió token de recuperación de desarrollo.');
  await expect('/auth/reset-password', json({ token: resetToken, new_password: recoveredPassword }), 200);
  await expect('/auth/me', auth(reactivated.body.access_token), 401);
  const afterRecovery = await login(invitedEmail, recoveredPassword);
  await expect('/auth/change-password', json({ current_password: recoveredPassword, new_password: finalPassword }, afterRecovery.body.access_token), 200);
  await expect('/auth/login', json({ email: invitedEmail, password: recoveredPassword }), 401);
  checks.push('password:recuperacion-cambio-revocacion');

  const deviceA = await login(invitedEmail, finalPassword);
  const sessionsA = await expect('/settings/sessions', auth(deviceA.body.access_token), 200);
  const currentA = sessionsA.body.sessions?.find((item: any) => item.current === true);
  if (!currentA?.id) throw new Error('No se identificó la sesión actual del dispositivo A.');
  const deviceB = await login(invitedEmail, finalPassword);
  const sessionsB = await expect('/settings/sessions', auth(deviceB.body.access_token), 200);
  if (!sessionsB.body.sessions?.some((item: any) => item.id === currentA.id && item.current === false)) throw new Error('La sesión A no aparece como otro dispositivo.');
  await expect(`/settings/sessions/${currentA.id}`, auth(deviceB.body.access_token, 'DELETE'), 200);
  await expect('/auth/me', auth(deviceA.body.access_token), 401);
  await expect('/auth/me', auth(deviceB.body.access_token), 200);
  checks.push('session:listado-y-revocacion-dispositivo');

  console.log(JSON.stringify({ ok: true, environment: 'local-isolated', checks }, null, 2));
}

main()
  .catch((error) => {
    console.error(JSON.stringify({ ok: false, checks, error: error.message }, null, 2));
    process.exitCode = 1;
  })
  .finally(async () => prisma.$disconnect());
