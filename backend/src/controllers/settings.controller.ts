import type { Request, Response } from 'express';
import { Role } from '@prisma/client';
import prisma from '../config/prisma';
import { PERMISSIONS, ROLE_PERMISSIONS } from '../auth/permissions';
import { expedienteAccessWhere } from '../middleware/auth.middleware';
import { comparecienteObjectWhere, cotizacionObjectWhere, prospectoObjectWhere } from '../services/objectAccess.service';

const PREFERENCE_VALUES = {
  default_view: new Set(['CARDS', 'LIST']),
  density: new Set(['COMFORTABLE', 'COMPACT']),
  timezone: new Set(['America/Mexico_City', 'America/Bahia_Banderas', 'America/Cancun', 'America/Tijuana']),
  date_format: new Set(['DD/MM/YYYY', 'YYYY-MM-DD']),
  theme: new Set(['SYSTEM', 'LIGHT']),
};

const pageNumber = (value: unknown, fallback = 1) => Math.max(1, Math.floor(Number(value) || fallback));
const pageSize = (value: unknown, fallback = 20) => Math.min(50, Math.max(1, Math.floor(Number(value) || fallback)));
const text = (value: unknown, max = 160) => String(value || '').trim().slice(0, max);

const deviceLabel = (userAgent: string | null) => {
  if (!userAgent) return 'Dispositivo desconocido';
  const browser = /Edg\//.test(userAgent) ? 'Edge' : /Firefox\//.test(userAgent) ? 'Firefox' : /Chrome\//.test(userAgent) ? 'Chrome' : /Safari\//.test(userAgent) ? 'Safari' : 'Navegador';
  const os = /iPhone|iPad/.test(userAgent) ? 'iOS' : /Android/.test(userAgent) ? 'Android' : /Macintosh|Mac OS/.test(userAgent) ? 'macOS' : /Windows/.test(userAgent) ? 'Windows' : /Linux/.test(userAgent) ? 'Linux' : 'sistema desconocido';
  return `${browser} en ${os}`;
};

const approximateIp = (ip: string | null) => {
  if (!ip) return 'No disponible';
  if (ip.includes(':')) return `${ip.split(':').slice(0, 3).join(':')}:…`;
  const parts = ip.split('.');
  return parts.length === 4 ? `${parts.slice(0, 3).join('.')}.…` : 'Red privada';
};

const preferenceSelect = {
  default_view: true, density: true, timezone: true, date_format: true, theme: true,
  notifications_enabled: true, assistant_suggestions_enabled: true, updated_at: true,
};

export class SettingsController {
  static async overview(req: Request, res: Response) {
    if (!req.user) return res.status(401).json({ code: 'AUTH_REQUIRED', error: 'Inicia sesión para continuar.' });
    const [sessions, unread, activeUsers, primaryNotary] = await Promise.all([
      prisma.authSession.count({ where: { user_id: req.user.id, revoked_at: null, expires_at: { gt: new Date() } } }),
      prisma.notification.count({ where: { recipient_id: req.user.id, read_at: null } }),
      req.user.permissions.includes('usuarios.read') ? prisma.user.count({ where: { activo: true } }) : Promise.resolve(0),
      prisma.notaria.findFirst({ where: { activa: true, predeterminada: true }, select: { id: true, nombre: true, numero_notaria: true, ciudad: true, entidad_federativa: true } }),
    ]);
    return res.json({
      profile: { id: req.user.id, nombre: req.user.nombre, apellido: req.user.apellido, email: req.user.email, rol: req.user.rol },
      metrics: { active_sessions: sessions, unread_notifications: unread, active_users: activeUsers },
      organization: { primary_notary: primaryNotary, scope: ['DIRECCION', 'ADMINISTRACION', 'CONSULTA'].includes(req.user.rol) ? 'GLOBAL' : 'ASSIGNED_OBJECTS' },
      access: { permissions: req.user.permissions },
    });
  }

  static async profile(req: Request, res: Response) {
    if (!req.user) return res.status(401).json({ code: 'AUTH_REQUIRED', error: 'Inicia sesión para continuar.' });
    const user = await prisma.user.findUnique({ where: { id: req.user.id }, select: {
      id: true, email: true, nombre: true, apellido: true, telefono: true, avatar_url: true, rol: true,
      activo: true, last_login_at: true, password_changed_at: true, created_at: true,
    } });
    return res.json({ user: user ? { ...user, rol: req.user.rol } : null, permissions: req.user.permissions, scope: req.user.scope });
  }

  static async updateProfile(req: Request, res: Response) {
    if (!req.user) return res.status(401).json({ code: 'AUTH_REQUIRED', error: 'Inicia sesión para continuar.' });
    const nombre = text(req.body?.nombre, 80);
    const apellido = text(req.body?.apellido, 100);
    const telefono = text(req.body?.telefono, 30) || null;
    if (nombre.length < 2 || apellido.length < 2) return res.status(400).json({ code: 'PROFILE_NAME_INVALID', error: 'Nombre y apellido son obligatorios.' });
    if (telefono && !/^[+\d()\s.-]{7,30}$/.test(telefono)) return res.status(400).json({ code: 'PROFILE_PHONE_INVALID', error: 'El teléfono no tiene un formato válido.' });
    const before = await prisma.user.findUnique({ where: { id: req.user.id }, select: { nombre: true, apellido: true, telefono: true } });
    const user = await prisma.$transaction(async (tx) => {
      const updated = await tx.user.update({ where: { id: req.user!.id }, data: { nombre, apellido, telefono }, select: { id: true, email: true, nombre: true, apellido: true, telefono: true, avatar_url: true, rol: true } });
      await tx.auditLog.create({ data: { user_id: req.user!.id, accion: 'PROFILE_UPDATED', entidad: 'User', entidad_id: req.user!.id, valores_anteriores: before ?? undefined, valores_nuevos: { nombre, apellido, telefono }, correlation_id: req.correlationId, session_id: req.user!.sessionId } });
      return updated;
    });
    return res.json({ success: true, user: { ...user, rol: req.user.rol } });
  }

  static async preferences(req: Request, res: Response) {
    if (!req.user) return res.status(401).json({ code: 'AUTH_REQUIRED', error: 'Inicia sesión para continuar.' });
    const preferences = await prisma.userPreference.upsert({ where: { user_id: req.user.id }, create: { user_id: req.user.id }, update: {}, select: preferenceSelect });
    return res.json({ preferences });
  }

  static async updatePreferences(req: Request, res: Response) {
    if (!req.user) return res.status(401).json({ code: 'AUTH_REQUIRED', error: 'Inicia sesión para continuar.' });
    const data: Record<string, string | boolean> = {};
    for (const [key, values] of Object.entries(PREFERENCE_VALUES)) {
      if (req.body?.[key] !== undefined) {
        const value = String(req.body[key]);
        if (!values.has(value)) return res.status(400).json({ code: 'PREFERENCE_INVALID', error: `La preferencia ${key} no es válida.` });
        data[key] = value;
      }
    }
    for (const key of ['notifications_enabled', 'assistant_suggestions_enabled']) if (req.body?.[key] !== undefined) data[key] = Boolean(req.body[key]);
    const preferences = await prisma.$transaction(async (tx) => {
      const updated = await tx.userPreference.upsert({ where: { user_id: req.user!.id }, create: { user_id: req.user!.id, ...data }, update: data, select: preferenceSelect });
      await tx.auditLog.create({ data: { user_id: req.user!.id, accion: 'PREFERENCES_UPDATED', entidad: 'User', entidad_id: req.user!.id, detalles: { changed_keys: Object.keys(data) }, correlation_id: req.correlationId, session_id: req.user!.sessionId } });
      return updated;
    });
    return res.json({ success: true, preferences });
  }

  static async sessions(req: Request, res: Response) {
    if (!req.user) return res.status(401).json({ code: 'AUTH_REQUIRED', error: 'Inicia sesión para continuar.' });
    const records = await prisma.authSession.findMany({ where: { user_id: req.user.id, revoked_at: null, expires_at: { gt: new Date() } }, select: { id: true, user_agent: true, ip_address: true, expires_at: true, last_used_at: true, created_at: true }, orderBy: { last_used_at: 'desc' } });
    return res.json({ sessions: records.map((item) => ({ id: item.id, device: deviceLabel(item.user_agent), ip_approximate: approximateIp(item.ip_address), expires_at: item.expires_at, last_used_at: item.last_used_at, created_at: item.created_at, current: item.id === req.user!.sessionId })) });
  }

  static async revokeSession(req: Request, res: Response) {
    if (!req.user) return res.status(401).json({ code: 'AUTH_REQUIRED', error: 'Inicia sesión para continuar.' });
    const target = await prisma.authSession.findFirst({ where: { id: req.params.id, user_id: req.user.id, revoked_at: null } });
    if (!target) return res.status(404).json({ code: 'SESSION_NOT_FOUND', error: 'La sesión ya no está activa.' });
    await prisma.$transaction([
      prisma.authSession.update({ where: { id: target.id }, data: { revoked_at: new Date(), revoked_reason: target.id === req.user.sessionId ? 'SELF_CURRENT_REVOKED' : 'SELF_REVOKED' } }),
      prisma.auditLog.create({ data: { user_id: req.user.id, accion: 'SESSION_REVOKED', entidad: 'AuthSession', entidad_id: target.id, detalles: { current: target.id === req.user.sessionId }, correlation_id: req.correlationId, session_id: req.user.sessionId } }),
    ]);
    return res.json({ success: true, current_session_revoked: target.id === req.user.sessionId });
  }

  static async revokeOtherSessions(req: Request, res: Response) {
    if (!req.user) return res.status(401).json({ code: 'AUTH_REQUIRED', error: 'Inicia sesión para continuar.' });
    const result = await prisma.authSession.updateMany({ where: { user_id: req.user.id, id: { not: req.user.sessionId }, revoked_at: null }, data: { revoked_at: new Date(), revoked_reason: 'SELF_REVOKED_OTHERS' } });
    await prisma.auditLog.create({ data: { user_id: req.user.id, accion: 'OTHER_SESSIONS_REVOKED', entidad: 'User', entidad_id: req.user.id, detalles: { revoked_count: result.count }, correlation_id: req.correlationId, session_id: req.user.sessionId } });
    return res.json({ success: true, revoked_count: result.count });
  }

  static async roles(_req: Request, res: Response) {
    return res.json({ roles: Object.values(Role).map((role) => ({ role, permissions: ROLE_PERMISSIONS[role] })), permissions: PERMISSIONS });
  }

  static async audit(req: Request, res: Response) {
    const page = pageNumber(req.query.page); const size = pageSize(req.query.page_size);
    const action = text(req.query.action, 80); const entity = text(req.query.entity, 80); const userId = text(req.query.user_id, 64);
    const where = { ...(action ? { accion: action } : {}), ...(entity ? { entidad: entity } : {}), ...(userId ? { user_id: userId } : {}) };
    const [items, total] = await Promise.all([
      prisma.auditLog.findMany({ where, select: { id: true, accion: true, entidad: true, entidad_id: true, correlation_id: true, session_id: true, created_at: true, usuario: { select: { id: true, nombre: true, apellido: true, email: true } } }, orderBy: { created_at: 'desc' }, skip: (page - 1) * size, take: size }),
      prisma.auditLog.count({ where }),
    ]);
    return res.json({ data: items, meta: { page, page_size: size, total, total_pages: Math.max(1, Math.ceil(total / size)) } });
  }

  static async notifications(req: Request, res: Response) {
    if (!req.user) return res.status(401).json({ code: 'AUTH_REQUIRED', error: 'Inicia sesión para continuar.' });
    const records = await prisma.notification.findMany({ where: { recipient_id: req.user.id }, select: { id: true, type: true, title: true, body: true, href: true, read_at: true, created_at: true }, orderBy: { created_at: 'desc' }, take: 50 });
    return res.json({ notifications: records, unread: records.filter((item) => !item.read_at).length });
  }

  static async readNotification(req: Request, res: Response) {
    if (!req.user) return res.status(401).json({ code: 'AUTH_REQUIRED', error: 'Inicia sesión para continuar.' });
    const result = await prisma.notification.updateMany({ where: { id: req.params.id, recipient_id: req.user.id }, data: { read_at: new Date() } });
    if (!result.count) return res.status(404).json({ code: 'NOTIFICATION_NOT_FOUND', error: 'Notificación no encontrada.' });
    return res.json({ success: true });
  }

  static async readAllNotifications(req: Request, res: Response) {
    if (!req.user) return res.status(401).json({ code: 'AUTH_REQUIRED', error: 'Inicia sesión para continuar.' });
    const result = await prisma.notification.updateMany({ where: { recipient_id: req.user.id, read_at: null }, data: { read_at: new Date() } });
    return res.json({ success: true, updated: result.count });
  }

  static async search(req: Request, res: Response) {
    if (!req.user) return res.status(401).json({ code: 'AUTH_REQUIRED', error: 'Inicia sesión para continuar.' });
    const query = text(req.query.q, 120); const limit = Math.min(8, pageSize(req.query.limit, 5));
    if (query.length < 2) return res.json({ data: [], query });
    const [expedientes, comparecientes, prospectos, cotizaciones, notarias] = await Promise.all([
      req.user.permissions.includes('expedientes.read') ? prisma.expediente.findMany({ where: { archived_at: null, ...expedienteAccessWhere(req.user), OR: [{ numero_pravia: { contains: query, mode: 'insensitive' } }, { cliente_alias: { contains: query, mode: 'insensitive' } }] }, select: { id: true, numero_pravia: true, cliente_alias: true }, take: limit }) : [],
      req.user.permissions.includes('comparecientes.read') ? prisma.compareciente.findMany({ where: { archived_at: null, ...comparecienteObjectWhere(req.user), nombre_busqueda: { contains: query, mode: 'insensitive' } }, select: { id: true, nombre_busqueda: true }, take: limit }) : [],
      req.user.permissions.includes('prospectos.read') ? prisma.prospecto.findMany({ where: { archived_at: null, ...prospectoObjectWhere(req.user), OR: [{ nombre: { contains: query, mode: 'insensitive' } }, { email: { contains: query, mode: 'insensitive' } }] }, select: { id: true, nombre: true, tipo_acto: true }, take: limit }) : [],
      req.user.permissions.includes('cotizaciones.read') ? prisma.cotizacion.findMany({ where: { ...cotizacionObjectWhere(req.user), OR: [{ numero_cotizacion: { contains: query, mode: 'insensitive' } }, { numero_solicitud: { contains: query, mode: 'insensitive' } }, { prospecto: { is: { nombre: { contains: query, mode: 'insensitive' } } } }] }, select: { id: true, numero_cotizacion: true, numero_solicitud: true, prospecto: { select: { nombre: true } } }, take: limit }) : [],
      req.user.permissions.includes('notarias.read') ? prisma.notaria.findMany({ where: { activa: true, OR: [{ nombre: { contains: query, mode: 'insensitive' } }, { numero_notaria: { contains: query, mode: 'insensitive' } }] }, select: { id: true, nombre: true, numero_notaria: true }, take: limit }) : [],
    ]);
    const data = [
      ...expedientes.map((item) => ({ type: 'EXPEDIENTE', id: item.id, title: item.numero_pravia, subtitle: item.cliente_alias, href: `/expedientes/${item.id}` })),
      ...comparecientes.map((item) => ({ type: 'COMPARECIENTE', id: item.id, title: item.nombre_busqueda, subtitle: 'Compareciente', href: `/comparecientes/${item.id}` })),
      ...prospectos.map((item) => ({ type: 'PROSPECTO', id: item.id, title: item.nombre, subtitle: item.tipo_acto, href: `/prospectos/${item.id}` })),
      ...cotizaciones.map((item) => ({ type: 'COTIZACION', id: item.id, title: item.numero_cotizacion || item.numero_solicitud || 'Cotización', subtitle: item.prospecto?.nombre, href: `/cotizaciones/${item.id}` })),
      ...notarias.map((item) => ({ type: 'NOTARIA', id: item.id, title: item.nombre, subtitle: item.numero_notaria ? `Notaría ${item.numero_notaria}` : 'Notaría', href: `/notarias/${item.id}` })),
    ];
    return res.json({ data: data.slice(0, 25), query });
  }
}
