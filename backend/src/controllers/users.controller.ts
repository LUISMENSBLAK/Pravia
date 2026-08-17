import type { Request, Response } from 'express';
import { Role } from '@prisma/client';
import prisma from '../config/prisma';
import { hashOpaqueToken, newOpaqueToken } from '../auth/authTokens';

const selectUser = {
  id: true, email: true, nombre: true, apellido: true, rol: true, avatar_url: true, activo: true,
  requires_password_change: true, password_changed_at: true, last_login_at: true, locked_until: true,
  telefono: true, created_at: true, updated_at: true,
};

const validRole = (value: unknown): value is Role => Object.values(Role).includes(String(value) as Role);
const membershipWhere = (req: Request, extra: Record<string, unknown> = {}) => ({
  organization_id: req.user!.organizationId, status: 'ACTIVE', ...extra,
});
const tenantUserSelect = (req: Request) => ({ ...selectUser, organizationMemberships: {
  where: { organization_id: req.user!.organizationId }, select: { id: true, rol: true, status: true }, take: 1,
} });
const effectiveUser = (record: any) => {
  const membership = record.organizationMemberships?.[0];
  if (!membership) return null;
  const { organizationMemberships: _memberships, ...user } = record;
  return { ...user, rol: membership.rol, activo: user.activo && membership.status === 'ACTIVE', membership_status: membership.status };
};

export class UsersController {
  static async list(req: Request, res: Response) {
    const canManage = req.user?.permissions.includes('usuarios.manage');
    if (!canManage) {
      const users = await prisma.user.findMany({ where: { activo: true, organizationMemberships: { some: membershipWhere(req) } }, select: tenantUserSelect(req), orderBy: [{ nombre: 'asc' }, { apellido: 'asc' }] });
      return res.json(users.map(effectiveUser).filter(Boolean));
    }
    const page = Math.max(1, Math.floor(Number(req.query.page) || 1));
    const size = Math.min(50, Math.max(1, Math.floor(Number(req.query.page_size) || 10)));
    const search = String(req.query.search || '').trim().slice(0, 120);
    const role = String(req.query.role || 'TODOS');
    const status = String(req.query.status || 'TODOS');
    const sort = ['nombre', 'email', 'rol', 'created_at', 'last_login_at'].includes(String(req.query.sort)) ? String(req.query.sort) : 'nombre';
    const order = String(req.query.order).toLowerCase() === 'desc' ? 'desc' : 'asc';
    const membershipStatus = status === 'SUSPENDIDO' ? 'SUSPENDED' : ['ACTIVO', 'BLOQUEADO'].includes(status) ? 'ACTIVE' : undefined;
    const where: any = { AND: [
      { organizationMemberships: { some: { organization_id: req.user!.organizationId,
        ...(validRole(role) ? { rol: role } : {}),
        ...(membershipStatus ? { status: membershipStatus } : {}) } } },
      ...(search ? [{ OR: [{ nombre: { contains: search, mode: 'insensitive' } }, { apellido: { contains: search, mode: 'insensitive' } }, { email: { contains: search, mode: 'insensitive' } }] }] : []),
      ...(status === 'ACTIVO' ? [{ activo: true }, { OR: [{ locked_until: null }, { locked_until: { lte: new Date() } }] }] : status === 'BLOQUEADO' ? [{ activo: true, locked_until: { gt: new Date() } }] : []),
    ] };
    const [users, total, active, suspended, pendingInvitations] = await Promise.all([
      prisma.user.findMany({ where, select: tenantUserSelect(req), orderBy: { [sort]: order }, skip: (page - 1) * size, take: size }),
      prisma.user.count({ where }),
      prisma.organizationMembership.count({ where: membershipWhere(req, { user: { activo: true } }) }),
      prisma.organizationMembership.count({ where: { organization_id: req.user!.organizationId, status: 'SUSPENDED' } }),
      prisma.userInvitation.count({ where: { accepted_at: null, revoked_at: null, expires_at: { gt: new Date() } } }),
    ]);
    return res.json({
      data: users.map(effectiveUser).filter(Boolean).map((user: any) => ({ ...user, status: !user.activo ? 'SUSPENDIDO' : user.locked_until && user.locked_until > new Date() ? 'BLOQUEADO' : user.requires_password_change ? 'CAMBIO_REQUERIDO' : 'ACTIVO' })),
      metrics: { active, suspended, pending_invitations: pendingInvitations, total: active + suspended },
      meta: { page, page_size: size, total, total_pages: Math.max(1, Math.ceil(total / size)) },
    });
  }

  static async detail(req: Request, res: Response) {
    const userRecord = await prisma.user.findUnique({ where: { id: req.params.id }, select: tenantUserSelect(req) });
    const user = userRecord ? effectiveUser(userRecord) : null;
    if (!user) return res.status(404).json({ code: 'USER_NOT_FOUND', error: 'Usuario no encontrado.' });
    const [sessions, activity] = await Promise.all([
      prisma.authSession.count({ where: { user_id: user.id, organization_id: req.user!.organizationId, revoked_at: null, expires_at: { gt: new Date() } } }),
      prisma.auditLog.findMany({ where: { user_id: user.id }, select: { id: true, accion: true, entidad: true, entidad_id: true, created_at: true }, orderBy: { created_at: 'desc' }, take: 8 }),
    ]);
    return res.json({ user: { ...user, status: !user.activo ? 'SUSPENDIDO' : user.locked_until && user.locked_until > new Date() ? 'BLOQUEADO' : user.requires_password_change ? 'CAMBIO_REQUERIDO' : 'ACTIVO' }, active_sessions: sessions, recent_activity: activity });
  }

  static async impact(req: Request, res: Response) {
    const current = await prisma.user.findUnique({ where: { id: req.params.id }, select: { id: true, activo: true, rol: true, organizationMemberships: { where: { organization_id: req.user!.organizationId }, select: { rol: true }, take: 1 } } });
    if (!current) return res.status(404).json({ code: 'USER_NOT_FOUND', error: 'Usuario no encontrado.' });
    const [expedientes, tasks, events, reviews] = await Promise.all([
      prisma.expediente.count({ where: { archived_at: null, estatus: { notIn: ['ENTREGADO', 'CANCELADO'] }, OR: [{ abogado_id: current.id }, { gestor_id: current.id }] } }),
      prisma.tarea.count({ where: { asignado_a_id: current.id, estatus: { in: ['PENDIENTE', 'EN_PROCESO'] } } }),
      prisma.eventoAgenda.count({ where: { user_id: current.id, estatus: 'ACTIVO', fecha_inicio: { gte: new Date() } } }),
      prisma.complianceReview.count({ where: { OR: [{ creado_por_id: current.id }, { revisado_por_id: current.id }], estatus: { notIn: ['CERRADA', 'CANCELADA'] } } }),
    ]);
    return res.json({ user_id: current.id, active_assignments: { expedientes, tasks, events, reviews }, requires_confirmation: expedientes + tasks + events + reviews > 0, reassignment_supported: false });
  }

  static async invite(req: Request, res: Response) {
    if (!req.user) return res.status(401).json({ code: 'AUTH_REQUIRED', error: 'Inicia sesión para continuar.' });
    const email = String(req.body?.email || '').trim().toLocaleLowerCase('es-MX');
    const nombre = String(req.body?.nombre || '').trim().slice(0, 80);
    const apellido = String(req.body?.apellido || '').trim().slice(0, 100);
    const rol = String(req.body?.rol || 'ABOGADO');
    if (!/^\S+@\S+\.\S+$/.test(email) || nombre.length < 2 || apellido.length < 2 || !validRole(rol)) return res.status(400).json({ code: 'INVITATION_INPUT_INVALID', error: 'Correo, nombre, apellido o rol no son válidos.' });
    const [existingUser, existingInvite] = await Promise.all([
      prisma.user.findUnique({ where: { email }, select: { id: true } }),
      prisma.userInvitation.findFirst({ where: { email, accepted_at: null, revoked_at: null, expires_at: { gt: new Date() } }, select: { id: true } }),
    ]);
    if (existingUser) return res.status(409).json({ code: 'USER_EMAIL_EXISTS', error: 'Ya existe una cuenta con ese correo.' });
    if (existingInvite) return res.status(409).json({ code: 'INVITATION_EXISTS', error: 'Ya existe una invitación vigente para ese correo.' });
    const token = newOpaqueToken();
    const expiresAt = new Date(Date.now() + 72 * 60 * 60 * 1000);
    const invitation = await prisma.$transaction(async (tx) => {
      const created = await tx.userInvitation.create({ data: { organization_id: req.user!.organizationId, email, nombre, apellido, rol, token_hash: hashOpaqueToken(token), expires_at: expiresAt, created_by_id: req.user!.id }, select: { id: true, email: true, nombre: true, apellido: true, rol: true, expires_at: true, created_at: true } });
      await tx.auditLog.create({ data: { user_id: req.user!.id, accion: 'USER_INVITED', entidad: 'UserInvitation', entidad_id: created.id, valores_nuevos: { email, nombre, apellido, rol, expires_at: expiresAt }, correlation_id: req.correlationId, session_id: req.user!.sessionId } });
      return created;
    });
    const baseUrl = String(process.env.USER_ACTIVATION_URL || '').replace(/\/$/, '');
    const webhook = String(process.env.USER_INVITATION_WEBHOOK_URL || '').trim();
    const activationUrl = `${baseUrl || 'http://localhost:5173/activar'}?token=${encodeURIComponent(token)}`;
    if (webhook) {
      const delivery = await fetch(webhook, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ recipient: email, name: nombre, activation_url: activationUrl, expires_hours: 72 }) });
      if (!delivery.ok) return res.status(503).json({ code: 'INVITATION_DELIVERY_FAILED', error: 'La invitación fue registrada, pero no pudo entregarse. Revócala antes de volver a intentar.' });
    }
    const allowDevLink = process.env.NODE_ENV !== 'production' && process.env.AUTH_ALLOW_DEV_INVITATION_LINK === 'true';
    return res.status(201).json({ success: true, invitation, delivery: webhook ? 'WEBHOOK' : allowDevLink ? 'DEVELOPMENT_LINK' : 'PENDING_PROVIDER', ...(allowDevLink ? { development_activation_url: activationUrl } : {}) });
  }

  static async invitations(_req: Request, res: Response) {
    const records = await prisma.userInvitation.findMany({ where: { accepted_at: null, revoked_at: null }, select: { id: true, email: true, nombre: true, apellido: true, rol: true, expires_at: true, created_at: true, created_by: { select: { nombre: true, apellido: true } } }, orderBy: { created_at: 'desc' }, take: 50 });
    return res.json({ invitations: records.map((item) => ({ ...item, status: item.expires_at <= new Date() ? 'EXPIRADA' : 'PENDIENTE' })) });
  }

  static async revokeInvitation(req: Request, res: Response) {
    if (!req.user) return res.status(401).json({ code: 'AUTH_REQUIRED', error: 'Inicia sesión para continuar.' });
    const current = await prisma.userInvitation.findFirst({ where: { id: req.params.id, accepted_at: null, revoked_at: null } });
    if (!current) return res.status(404).json({ code: 'INVITATION_NOT_FOUND', error: 'La invitación ya no está vigente.' });
    await prisma.$transaction([
      prisma.userInvitation.update({ where: { id: current.id }, data: { revoked_at: new Date() } }),
      prisma.auditLog.create({ data: { user_id: req.user.id, accion: 'USER_INVITATION_REVOKED', entidad: 'UserInvitation', entidad_id: current.id, correlation_id: req.correlationId, session_id: req.user.sessionId } }),
    ]);
    return res.json({ success: true });
  }

  static async update(req: Request, res: Response) {
    if (!req.user) return res.status(401).json({ code: 'AUTH_REQUIRED', error: 'Inicia sesión para continuar.' });
    const current = await prisma.user.findUnique({ where: { id: req.params.id }, include: { organizationMemberships: { where: { organization_id: req.user.organizationId }, take: 1 } } });
    if (!current) return res.status(404).json({ code: 'USER_NOT_FOUND', error: 'Usuario no encontrado.' });
    const currentMembership = current.organizationMemberships[0];
    if (!currentMembership) return res.status(404).json({ code: 'USER_NOT_FOUND', error: 'Usuario no encontrado.' });
    const rol = req.body.rol === undefined ? currentMembership.rol : String(req.body.rol);
    const activo = req.body.activo === undefined ? currentMembership.status === 'ACTIVE' : req.body.activo === true;
    if (!validRole(rol)) return res.status(400).json({ code: 'USER_ROLE_INVALID', error: 'El rol no es válido.' });
    if (current.id === req.user.id && !activo) return res.status(409).json({ code: 'SELF_DEACTIVATION_DENIED', error: 'No puedes desactivar tu propia cuenta.' });
    if (currentMembership.rol === 'DIRECCION' && current.activo && (!activo || rol !== 'DIRECCION')) {
      const activeDirectors = await prisma.organizationMembership.count({ where: membershipWhere(req, { rol: 'DIRECCION', user: { activo: true } }) });
      if (activeDirectors <= 1) return res.status(409).json({ code: 'LAST_DIRECTOR_REQUIRED', error: 'Debe permanecer al menos una cuenta activa de Dirección.' });
    }
    if (current.activo && !activo && req.body.confirm_impact !== true) {
      const [expedientes, tasks, events] = await Promise.all([
        prisma.expediente.count({ where: { archived_at: null, estatus: { notIn: ['ENTREGADO', 'CANCELADO'] }, OR: [{ abogado_id: current.id }, { gestor_id: current.id }] } }),
        prisma.tarea.count({ where: { asignado_a_id: current.id, estatus: { in: ['PENDIENTE', 'EN_PROCESO'] } } }),
        prisma.eventoAgenda.count({ where: { user_id: current.id, estatus: 'ACTIVO', fecha_inicio: { gte: new Date() } } }),
      ]);
      if (expedientes + tasks + events > 0) return res.status(409).json({ code: 'USER_HAS_ACTIVE_ASSIGNMENTS', error: 'Confirma el impacto antes de suspender esta cuenta.', impact: { expedientes, tasks, events } });
    }
    const nombre = req.body.nombre === undefined ? current.nombre : String(req.body.nombre).trim();
    const apellido = req.body.apellido === undefined ? current.apellido : String(req.body.apellido).trim();
    if (nombre.length < 2 || apellido.length < 2) return res.status(400).json({ code: 'USER_NAME_INVALID', error: 'Nombre y apellido son obligatorios.' });
    const user = await prisma.$transaction(async (tx) => {
      const updated = await tx.user.update({ where: { id: current.id }, data: { nombre, apellido }, select: selectUser });
      await tx.organizationMembership.update({ where: { organization_id_user_id: { organization_id: req.user!.organizationId, user_id: current.id } }, data: { rol, status: activo ? 'ACTIVE' : 'SUSPENDED' } });
      if (!activo || rol !== currentMembership.rol) await tx.authSession.updateMany({ where: { user_id: current.id, organization_id: req.user!.organizationId, revoked_at: null }, data: { revoked_at: new Date(), revoked_reason: !activo ? 'USER_DEACTIVATED' : 'ROLE_CHANGED' } });
      await tx.auditLog.create({ data: {
        user_id: req.user!.id, accion: 'UPDATE_USER', entidad: 'User', entidad_id: current.id,
        valores_anteriores: { nombre: current.nombre, apellido: current.apellido, rol: currentMembership.rol, activo: currentMembership.status === 'ACTIVE' },
        valores_nuevos: { nombre, apellido, rol, activo }, correlation_id: req.correlationId, session_id: req.user!.sessionId,
      } });
      if (!activo || rol !== currentMembership.rol) await tx.notification.create({ data: { organization_id: req.user!.organizationId, recipient_id: current.id, created_by_id: req.user!.id, type: !activo ? 'ACCOUNT_SUSPENDED' : 'ROLE_CHANGED', title: !activo ? 'Cuenta suspendida' : 'Tu rol cambió', body: !activo ? 'Dirección suspendió el acceso a tu cuenta.' : `Tu rol ahora es ${rol}.`, href: '/configuracion/perfil' } });
      return updated;
    });
    return res.json({ success: true, usuario: { ...user, rol, activo } });
  }

}
