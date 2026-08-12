import type { Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import { Role } from '@prisma/client';
import prisma from '../config/prisma';
import { validatePasswordStrength } from '../auth/permissions';

const selectUser = {
  id: true, email: true, nombre: true, apellido: true, rol: true, avatar_url: true, activo: true,
  requires_password_change: true, password_changed_at: true, last_login_at: true, locked_until: true,
  created_at: true, updated_at: true,
};

const validRole = (value: unknown): value is Role => Object.values(Role).includes(String(value) as Role);

export class UsersController {
  static async list(req: Request, res: Response) {
    const canManage = req.user?.permissions.includes('usuarios.manage');
    const users = await prisma.user.findMany({
      where: canManage ? {} : { activo: true },
      select: canManage ? selectUser : { id: true, nombre: true, apellido: true, email: true, rol: true },
      orderBy: [{ activo: 'desc' }, { nombre: 'asc' }, { apellido: 'asc' }],
    });
    return res.json(users);
  }

  static async create(req: Request, res: Response) {
    if (!req.user) return res.status(401).json({ code: 'AUTH_REQUIRED', error: 'Inicia sesión para continuar.' });
    const email = String(req.body?.email || '').trim().toLocaleLowerCase('es-MX');
    const nombre = String(req.body?.nombre || '').trim();
    const apellido = String(req.body?.apellido || '').trim();
    const rol = String(req.body?.rol || 'ABOGADO');
    const password = String(req.body?.initial_password || '');
    const passwordFailures = validatePasswordStrength(password);
    if (!/^\S+@\S+\.\S+$/.test(email) || nombre.length < 2 || apellido.length < 2 || !validRole(rol)) {
      return res.status(400).json({ code: 'USER_INPUT_INVALID', error: 'Correo, nombre, apellido o rol no son válidos.' });
    }
    if (passwordFailures.length) return res.status(400).json({ code: 'PASSWORD_WEAK', error: passwordFailures.join(' '), requirements: passwordFailures });
    try {
      const passwordHash = await bcrypt.hash(password, 12);
      const user = await prisma.$transaction(async (tx) => {
        const created = await tx.user.create({ data: {
          email, nombre, apellido, rol, password_hash: passwordHash,
          activo: true, requires_password_change: true,
        }, select: selectUser });
        await tx.auditLog.create({ data: {
          user_id: req.user!.id, accion: 'CREATE_USER', entidad: 'User', entidad_id: created.id,
          valores_nuevos: { email, nombre, apellido, rol, activo: true }, correlation_id: req.correlationId, session_id: req.user!.sessionId,
        } });
        return created;
      });
      return res.status(201).json({ success: true, usuario: user });
    } catch (error: any) {
      return res.status(error.code === 'P2002' ? 409 : 500).json({ code: error.code === 'P2002' ? 'USER_EMAIL_EXISTS' : 'USER_CREATE_FAILED', error: error.code === 'P2002' ? 'Ya existe una cuenta con ese correo.' : 'No fue posible crear la cuenta.' });
    }
  }

  static async update(req: Request, res: Response) {
    if (!req.user) return res.status(401).json({ code: 'AUTH_REQUIRED', error: 'Inicia sesión para continuar.' });
    const current = await prisma.user.findUnique({ where: { id: req.params.id } });
    if (!current) return res.status(404).json({ code: 'USER_NOT_FOUND', error: 'Usuario no encontrado.' });
    const rol = req.body.rol === undefined ? current.rol : String(req.body.rol);
    const activo = req.body.activo === undefined ? current.activo : Boolean(req.body.activo);
    if (!validRole(rol)) return res.status(400).json({ code: 'USER_ROLE_INVALID', error: 'El rol no es válido.' });
    if (current.id === req.user.id && !activo) return res.status(409).json({ code: 'SELF_DEACTIVATION_DENIED', error: 'No puedes desactivar tu propia cuenta.' });
    if (current.rol === 'DIRECCION' && current.activo && (!activo || rol !== 'DIRECCION')) {
      const activeDirectors = await prisma.user.count({ where: { rol: 'DIRECCION', activo: true } });
      if (activeDirectors <= 1) return res.status(409).json({ code: 'LAST_DIRECTOR_REQUIRED', error: 'Debe permanecer al menos una cuenta activa de Dirección.' });
    }
    const nombre = req.body.nombre === undefined ? current.nombre : String(req.body.nombre).trim();
    const apellido = req.body.apellido === undefined ? current.apellido : String(req.body.apellido).trim();
    if (nombre.length < 2 || apellido.length < 2) return res.status(400).json({ code: 'USER_NAME_INVALID', error: 'Nombre y apellido son obligatorios.' });
    const user = await prisma.$transaction(async (tx) => {
      const updated = await tx.user.update({ where: { id: current.id }, data: { nombre, apellido, rol, activo }, select: selectUser });
      if (!activo || rol !== current.rol) await tx.authSession.updateMany({ where: { user_id: current.id, revoked_at: null }, data: { revoked_at: new Date(), revoked_reason: !activo ? 'USER_DEACTIVATED' : 'ROLE_CHANGED' } });
      await tx.auditLog.create({ data: {
        user_id: req.user!.id, accion: 'UPDATE_USER', entidad: 'User', entidad_id: current.id,
        valores_anteriores: { nombre: current.nombre, apellido: current.apellido, rol: current.rol, activo: current.activo },
        valores_nuevos: { nombre, apellido, rol, activo }, correlation_id: req.correlationId, session_id: req.user!.sessionId,
      } });
      return updated;
    });
    return res.json({ success: true, usuario: user });
  }

  static async setTemporaryPassword(req: Request, res: Response) {
    if (!req.user) return res.status(401).json({ code: 'AUTH_REQUIRED', error: 'Inicia sesión para continuar.' });
    const password = String(req.body?.temporary_password || '');
    const failures = validatePasswordStrength(password);
    if (failures.length) return res.status(400).json({ code: 'PASSWORD_WEAK', error: failures.join(' '), requirements: failures });
    const current = await prisma.user.findUnique({ where: { id: req.params.id } });
    if (!current) return res.status(404).json({ code: 'USER_NOT_FOUND', error: 'Usuario no encontrado.' });
    const passwordHash = await bcrypt.hash(password, 12);
    await prisma.$transaction([
      prisma.user.update({ where: { id: current.id }, data: { password_hash: passwordHash, password_changed_at: new Date(), requires_password_change: true, failed_login_attempts: 0, locked_until: null } }),
      prisma.authSession.updateMany({ where: { user_id: current.id, revoked_at: null }, data: { revoked_at: new Date(), revoked_reason: 'ADMIN_PASSWORD_RESET' } }),
      prisma.auditLog.create({ data: { user_id: req.user.id, accion: 'ADMIN_RESET_USER_PASSWORD', entidad: 'User', entidad_id: current.id, correlation_id: req.correlationId, session_id: req.user.sessionId } }),
    ]);
    return res.json({ success: true, message: 'Contraseña temporal establecida; el usuario deberá cambiarla.' });
  }
}
