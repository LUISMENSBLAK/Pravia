import type { Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import prisma from '../config/prisma';
import { permissionsForRole, validatePasswordStrength } from '../auth/permissions';
import {
  ACCESS_TOKEN_TTL_SECONDS,
  getJwtSecret,
  hashOpaqueToken,
  newOpaqueToken,
  parseCookies,
  REFRESH_COOKIE,
  REFRESH_TOKEN_TTL_MS,
  signAccessToken,
} from '../auth/authTokens';

const BCRYPT_PATTERN = /^\$2[aby]\$\d{2}\$.{53}$/;
const COOKIE_PATH = '/api/auth';
const MAX_FAILED_LOGINS = 5;
const LOCKOUT_MS = 15 * 60 * 1000;

const requestContext = (req: Request) => ({
  ip: String(req.ip || req.socket.remoteAddress || '').slice(0, 100) || null,
  userAgent: String(req.header('user-agent') || '').slice(0, 500) || null,
  correlationId: req.correlationId,
});

const publicUser = (user: { id: string; email: string; nombre: string; apellido: string; rol: any; activo: boolean; requires_password_change: boolean }) => ({
  id: user.id,
  email: user.email,
  nombre: user.nombre,
  apellido: user.apellido,
  rol: user.rol,
  activo: user.activo,
  requires_password_change: user.requires_password_change,
  permissions: permissionsForRole(user.rol),
});

const setRefreshCookie = (res: Response, token: string) => res.cookie(REFRESH_COOKIE, token, {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'strict',
  path: COOKIE_PATH,
  maxAge: REFRESH_TOKEN_TTL_MS,
});

const clearRefreshCookie = (res: Response) => res.clearCookie(REFRESH_COOKIE, {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'strict',
  path: COOKIE_PATH,
});

async function issueSession(req: Request, res: Response, user: any, rotatedFromId?: string) {
  getJwtSecret();
  const refreshToken = newOpaqueToken();
  const context = requestContext(req);
  const expiresAt = new Date(Date.now() + REFRESH_TOKEN_TTL_MS);
  const session = await prisma.authSession.create({
    data: {
      user_id: user.id,
      refresh_token_hash: hashOpaqueToken(refreshToken),
      user_agent: context.userAgent,
      ip_address: context.ip,
      expires_at: expiresAt,
      rotated_from_id: rotatedFromId,
    },
  });
  const accessToken = signAccessToken({ sub: user.id, sid: session.id, role: user.rol });
  setRefreshCookie(res, refreshToken);
  return { access_token: accessToken, expires_in: ACCESS_TOKEN_TTL_SECONDS, user: publicUser(user) };
}

export class AuthController {
  static async login(req: Request, res: Response) {
    const email = String(req.body?.email || '').trim().toLocaleLowerCase('es-MX');
    const password = String(req.body?.password || '');
    const genericError = { code: 'INVALID_CREDENTIALS', error: 'Correo o contraseña incorrectos.' };
    if (!email || !password) return res.status(400).json({ code: 'CREDENTIALS_REQUIRED', error: 'Ingresa correo y contraseña.' });

    try {
      const user = await prisma.user.findUnique({ where: { email } });
      if (!user || !user.activo) {
        await bcrypt.compare(password, '$2a$12$012345678901234567890uK7QwZ9Z8r5n3xP8fT7nYx4wS8m1q2e.');
        return res.status(401).json(genericError);
      }
      if (user.locked_until && user.locked_until > new Date()) {
        return res.status(429).json({ code: 'ACCOUNT_TEMPORARILY_LOCKED', error: 'La cuenta está temporalmente bloqueada. Intenta más tarde.' });
      }
      const valid = BCRYPT_PATTERN.test(user.password_hash) && await bcrypt.compare(password, user.password_hash);
      if (!valid) {
        const failures = user.failed_login_attempts + 1;
        await prisma.user.update({
          where: { id: user.id },
          data: {
            failed_login_attempts: failures >= MAX_FAILED_LOGINS ? 0 : failures,
            locked_until: failures >= MAX_FAILED_LOGINS ? new Date(Date.now() + LOCKOUT_MS) : null,
          },
        });
        return res.status(401).json(genericError);
      }

      const payload = await prisma.$transaction(async (tx) => {
        const updated = await tx.user.update({
          where: { id: user.id },
          data: { failed_login_attempts: 0, locked_until: null, last_login_at: new Date() },
        });
        return updated;
      });
      const session = await issueSession(req, res, payload);
      const context = requestContext(req);
      await prisma.auditLog.create({ data: {
        user_id: user.id, accion: 'AUTH_LOGIN', entidad: 'User', entidad_id: user.id,
        correlation_id: context.correlationId, ip_address: context.ip, user_agent: context.userAgent,
      } });
      return res.json({ success: true, ...session });
    } catch (error: any) {
      const configuration = String(error.message || '').includes('AUTH_JWT_SECRET');
      return res.status(configuration ? 503 : 500).json({
        code: configuration ? 'AUTH_CONFIGURATION_REQUIRED' : 'AUTH_LOGIN_FAILED',
        error: configuration ? 'La autenticación requiere configuración segura del servidor.' : 'No fue posible iniciar sesión.',
      });
    }
  }

  static async refresh(req: Request, res: Response) {
    const token = parseCookies(req.header('cookie'))[REFRESH_COOKIE];
    if (!token) return res.status(401).json({ code: 'REFRESH_REQUIRED', error: 'La sesión expiró.' });
    try {
      getJwtSecret();
      const current = await prisma.authSession.findUnique({
        where: { refresh_token_hash: hashOpaqueToken(token) }, include: { user: true },
      });
      if (!current || current.revoked_at || current.expires_at <= new Date() || !current.user.activo) {
        clearRefreshCookie(res);
        return res.status(401).json({ code: 'REFRESH_INVALID', error: 'La sesión ya no es válida.' });
      }
      const claimed = await prisma.authSession.updateMany({
        where: { id: current.id, revoked_at: null },
        data: { revoked_at: new Date(), revoked_reason: 'ROTATED', last_used_at: new Date() },
      });
      if (claimed.count !== 1) {
        clearRefreshCookie(res);
        return res.status(401).json({ code: 'REFRESH_ALREADY_USED', error: 'La sesión ya fue renovada. Inicia sesión nuevamente.' });
      }
      const session = await issueSession(req, res, current.user, current.id);
      return res.json({ success: true, ...session });
    } catch (error: any) {
      clearRefreshCookie(res);
      const configuration = String(error.message || '').includes('AUTH_JWT_SECRET');
      return res.status(configuration ? 503 : 401).json({
        code: configuration ? 'AUTH_CONFIGURATION_REQUIRED' : 'REFRESH_FAILED',
        error: configuration ? 'La autenticación requiere configuración segura del servidor.' : 'La sesión no pudo renovarse.',
      });
    }
  }

  static async logout(req: Request, res: Response) {
    const token = parseCookies(req.header('cookie'))[REFRESH_COOKIE];
    clearRefreshCookie(res);
    if (token) {
      const session = await prisma.authSession.findUnique({ where: { refresh_token_hash: hashOpaqueToken(token) } }).catch(() => null);
      if (session && !session.revoked_at) await prisma.$transaction([
        prisma.authSession.update({ where: { id: session.id }, data: { revoked_at: new Date(), revoked_reason: 'LOGOUT' } }),
        prisma.auditLog.create({ data: { user_id: session.user_id, accion: 'AUTH_LOGOUT', entidad: 'AuthSession', entidad_id: session.id, correlation_id: req.correlationId, session_id: session.id } }),
      ]).catch(() => undefined);
    }
    return res.status(204).send();
  }

  static async me(req: Request, res: Response) {
    if (!req.user) return res.status(401).json({ code: 'AUTH_REQUIRED', error: 'Inicia sesión para continuar.' });
    return res.json({ success: true, user: {
      id: req.user.id, email: req.user.email, nombre: req.user.nombre, apellido: req.user.apellido,
      rol: req.user.rol, activo: true, requires_password_change: req.user.requiresPasswordChange,
      permissions: req.user.permissions,
    } });
  }

  static async changePassword(req: Request, res: Response) {
    if (!req.user) return res.status(401).json({ code: 'AUTH_REQUIRED', error: 'Inicia sesión para continuar.' });
    const currentPassword = String(req.body?.current_password || '');
    const newPassword = String(req.body?.new_password || '');
    const failures = validatePasswordStrength(newPassword);
    if (failures.length) return res.status(400).json({ code: 'PASSWORD_WEAK', error: failures.join(' '), requirements: failures });
    const user = await prisma.user.findUnique({ where: { id: req.user.id } });
    if (!user || !BCRYPT_PATTERN.test(user.password_hash) || !await bcrypt.compare(currentPassword, user.password_hash)) {
      return res.status(401).json({ code: 'CURRENT_PASSWORD_INVALID', error: 'La contraseña actual no es correcta.' });
    }
    if (await bcrypt.compare(newPassword, user.password_hash)) {
      return res.status(409).json({ code: 'PASSWORD_REUSED', error: 'La nueva contraseña debe ser diferente.' });
    }
    const passwordHash = await bcrypt.hash(newPassword, 12);
    await prisma.$transaction([
      prisma.user.update({ where: { id: user.id }, data: { password_hash: passwordHash, password_changed_at: new Date(), requires_password_change: false } }),
      prisma.authSession.updateMany({ where: { user_id: user.id, id: { not: req.user.sessionId }, revoked_at: null }, data: { revoked_at: new Date(), revoked_reason: 'PASSWORD_CHANGED' } }),
      prisma.auditLog.create({ data: { user_id: user.id, accion: 'AUTH_PASSWORD_CHANGED', entidad: 'User', entidad_id: user.id, correlation_id: req.correlationId, session_id: req.user.sessionId } }),
    ]);
    return res.json({ success: true, message: 'Contraseña actualizada.' });
  }

  static async requestRecovery(req: Request, res: Response) {
    const email = String(req.body?.email || '').trim().toLocaleLowerCase('es-MX');
    const generic = { success: true, message: 'Si la cuenta existe y está activa, recibirá instrucciones de recuperación.' };
    if (!email) return res.json(generic);
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user?.activo) return res.json(generic);
    const webhook = String(process.env.PASSWORD_RECOVERY_WEBHOOK_URL || '').trim();
    const allowDevToken = process.env.NODE_ENV !== 'production' && process.env.AUTH_ALLOW_DEV_RECOVERY_TOKEN === 'true';
    if (!webhook && !allowDevToken) return res.json(generic);
    const token = newOpaqueToken();
    await prisma.$transaction([
      prisma.passwordResetToken.updateMany({ where: { user_id: user.id, used_at: null }, data: { used_at: new Date() } }),
      prisma.passwordResetToken.create({ data: {
        user_id: user.id, token_hash: hashOpaqueToken(token), expires_at: new Date(Date.now() + 30 * 60 * 1000), requested_ip: requestContext(req).ip,
      } }),
    ]);
    if (webhook) {
      const resetBase = String(process.env.PASSWORD_RECOVERY_URL || '').replace(/\/$/, '');
      const response = await fetch(webhook, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({
        recipient: user.email, name: user.nombre, reset_url: `${resetBase}?token=${encodeURIComponent(token)}`, expires_minutes: 30,
      }) });
      if (!response.ok) return res.status(503).json({ code: 'RECOVERY_DELIVERY_FAILED', error: 'No fue posible entregar la recuperación. Contacta a Dirección.' });
    }
    return res.json({ ...generic, ...(allowDevToken ? { development_reset_token: token } : {}) });
  }

  static async resetPassword(req: Request, res: Response) {
    const token = String(req.body?.token || '');
    const password = String(req.body?.new_password || '');
    const failures = validatePasswordStrength(password);
    if (!token || failures.length) return res.status(400).json({ code: 'RESET_INPUT_INVALID', error: failures.join(' ') || 'El token es obligatorio.' });
    const record = await prisma.passwordResetToken.findUnique({ where: { token_hash: hashOpaqueToken(token) }, include: { user: true } });
    if (!record || record.used_at || record.expires_at <= new Date() || !record.user.activo) {
      return res.status(400).json({ code: 'RESET_TOKEN_INVALID', error: 'El enlace es inválido o expiró.' });
    }
    const passwordHash = await bcrypt.hash(password, 12);
    await prisma.$transaction([
      prisma.user.update({ where: { id: record.user_id }, data: { password_hash: passwordHash, password_changed_at: new Date(), requires_password_change: false, failed_login_attempts: 0, locked_until: null } }),
      prisma.passwordResetToken.updateMany({ where: { user_id: record.user_id, used_at: null }, data: { used_at: new Date() } }),
      prisma.authSession.updateMany({ where: { user_id: record.user_id, revoked_at: null }, data: { revoked_at: new Date(), revoked_reason: 'PASSWORD_RESET' } }),
      prisma.auditLog.create({ data: { user_id: record.user_id, accion: 'AUTH_PASSWORD_RESET', entidad: 'User', entidad_id: record.user_id, correlation_id: req.correlationId } }),
    ]);
    return res.json({ success: true, message: 'Contraseña restablecida. Ya puedes iniciar sesión.' });
  }
}
