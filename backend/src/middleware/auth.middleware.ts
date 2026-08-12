import type { NextFunction, Request, Response } from 'express';
import prisma from '../config/prisma';
import type { Permission } from '../auth/permissions';
import { permissionsForRole } from '../auth/permissions';
import { verifyAccessToken } from '../auth/authTokens';

const bearerToken = (req: Request) => {
  const header = req.header('authorization') || '';
  return header.startsWith('Bearer ') ? header.slice(7).trim() : '';
};

export async function authenticate(req: Request, res: Response, next: NextFunction) {
  try {
    const token = bearerToken(req);
    if (!token) return res.status(401).json({ code: 'AUTH_REQUIRED', error: 'Inicia sesión para continuar.' });
    const claims = verifyAccessToken(token);
    if (claims.type !== 'access' || !claims.sub || !claims.sid) throw new Error('Token inválido');
    const session = await prisma.authSession.findFirst({
      where: { id: claims.sid, user_id: claims.sub, revoked_at: null, expires_at: { gt: new Date() } },
      include: { user: true },
    });
    if (!session || !session.user.activo) return res.status(401).json({ code: 'SESSION_INACTIVE', error: 'La sesión ya no está activa.' });
    req.user = {
      id: session.user.id,
      email: session.user.email,
      nombre: session.user.nombre,
      apellido: session.user.apellido,
      rol: session.user.rol,
      sessionId: session.id,
      permissions: permissionsForRole(session.user.rol),
      requiresPasswordChange: session.user.requires_password_change,
    };
    return next();
  } catch {
    return res.status(401).json({ code: 'TOKEN_INVALID', error: 'La sesión expiró o no es válida.' });
  }
}

export const requirePermission = (permission: Permission) => (req: Request, res: Response, next: NextFunction) => {
  if (!req.user?.permissions.includes(permission)) {
    return res.status(403).json({ code: 'PERMISSION_DENIED', error: 'No tienes permiso para realizar esta acción.' });
  }
  return next();
};

export function requirePasswordReady(req: Request, res: Response, next: NextFunction) {
  if (req.user?.requiresPasswordChange) {
    return res.status(403).json({ code: 'PASSWORD_CHANGE_REQUIRED', error: 'Debes establecer una contraseña definitiva antes de continuar.' });
  }
  return next();
}

export const authorizeByMethod = (read: Permission, write: Permission) => (req: Request, res: Response, next: NextFunction) =>
  requirePermission(['GET', 'HEAD'].includes(req.method) ? read : write)(req, res, next);

export function permissionForExpedienteRequest(method: string, path: string): Permission {
  if (['GET', 'HEAD'].includes(method.toUpperCase())) return 'expedientes.read';
  if (/^\/[^/]+\/entrega\/?$/.test(path)) return 'expedientes.deliver';
  if (/^\/[^/]+\/postfirma(?:\/|$)/.test(path)) return 'expedientes.postfirma.manage';
  return 'expedientes.write';
}

export const authorizeExpedienteRequest = (req: Request, res: Response, next: NextFunction) =>
  requirePermission(permissionForExpedienteRequest(req.method, req.path))(req, res, next);

export function expedienteAccessWhere(user: NonNullable<Request['user']>) {
  if (['DIRECCION', 'ADMINISTRACION', 'CONSULTA'].includes(user.rol)) return {};
  if (user.rol === 'ABOGADO') return { OR: [{ abogado_id: user.id }, { creado_por_id: user.id }] };
  if (user.rol === 'GESTORIA') return {
    OR: [
      { gestor_id: user.id },
      { tareas: { some: { asignado_a_id: user.id, estatus: { not: 'CANCELADA' as const } } } },
      { tareas_externas: { some: { gestionado_por_id: user.id } } },
    ],
  };
  if (user.rol === 'RECEPCION') return { estatus: { in: ['LISTO_ENTREGA' as const, 'ENTREGADO' as const] } };
  return { id: '00000000-0000-0000-0000-000000000000' };
}

export async function requireExpedienteAccess(req: Request, res: Response, next: NextFunction) {
  if (!req.user) return res.status(401).json({ code: 'AUTH_REQUIRED', error: 'Inicia sesión para continuar.' });
  if (['DIRECCION', 'ADMINISTRACION', 'CONSULTA'].includes(req.user.rol)) return next();
  if (!['ABOGADO', 'GESTORIA', 'RECEPCION'].includes(req.user.rol)) {
    return res.status(403).json({ code: 'EXPEDIENTE_ACCESS_DENIED', error: 'No tienes acceso a este expediente.' });
  }
  const expedienteId = req.params.id || req.body?.expediente_id;
  if (!expedienteId) return next();
  const expediente = await prisma.expediente.findFirst({
    where: {
      id: String(expedienteId), archived_at: null,
      ...expedienteAccessWhere(req.user),
    },
    select: { id: true },
  });
  if (!expediente) return res.status(403).json({ code: 'EXPEDIENTE_ACCESS_DENIED', error: 'No tienes acceso a este expediente.' });
  return next();
}
