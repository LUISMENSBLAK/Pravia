import { Prisma, type PrismaClient } from '@prisma/client';
import type { Request } from 'express';
import { roleHasPermission, type Permission } from '../auth/permissions';

type Actor = NonNullable<Request['user']>;
export type CollaboratedKind = 'prospecto' | 'cotizacion' | 'expediente';
const permissions: Record<CollaboratedKind, { read: Permission; write: Permission }> = {
  prospecto: { read: 'prospectos.read', write: 'prospectos.write' },
  cotizacion: { read: 'cotizaciones.read', write: 'cotizaciones.write' },
  expediente: { read: 'expedientes.read', write: 'expedientes.write' },
};
const targetColumn = (kind: CollaboratedKind) => `${kind}_id` as const;

export class RecordCollaborationError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) { super(message); }
}

export class RecordCollaborationService {
  constructor(private readonly db: PrismaClient) {}

  private assertPermission(actor: Actor, kind: CollaboratedKind, write = false) {
    if (!actor.permissions.includes(permissions[kind][write ? 'write' : 'read'])) {
      throw new RecordCollaborationError(403, 'COLLAB_PERMISSION_DENIED', 'No tienes permiso para este módulo.');
    }
    if (write && !['DIRECCION', 'ADMINISTRACION'].includes(actor.rol)) {
      throw new RecordCollaborationError(403, 'COLLAB_ASSIGNMENT_DENIED', 'Sólo Dirección o Administración puede asignar colaboradores.');
    }
  }

  private async assertTarget(db: PrismaClient | Prisma.TransactionClient, actor: Actor, kind: CollaboratedKind, id: string) {
    const where = { id, organization_id: actor.organizationId, archived_at: null };
    const target = kind === 'prospecto'
      ? await db.prospecto.findFirst({ where, select: { id: true } })
      : kind === 'cotizacion'
        ? await db.cotizacion.findFirst({ where: { id, organization_id: actor.organizationId }, select: { id: true } })
        : await db.expediente.findFirst({ where, select: { id: true } });
    if (!target) throw new RecordCollaborationError(404, 'COLLAB_TARGET_NOT_FOUND', 'El registro no existe en esta notaría.');
  }

  async list(actor: Actor, kind: CollaboratedKind, id: string) {
    this.assertPermission(actor, kind);
    await this.assertTarget(this.db, actor, kind, id);
    return this.db.recordCollaboration.findMany({
      where: { organization_id: actor.organizationId, [targetColumn(kind)]: id, active: true },
      select: { id: true, user_id: true, assigned_at: true,
        membership: { select: { rol: true, user: { select: { nombre: true, apellido: true } } } } },
      orderBy: { assigned_at: 'asc' },
    });
  }

  async candidates(actor: Actor, kind: CollaboratedKind, id: string) {
    this.assertPermission(actor, kind, true);
    await this.assertTarget(this.db, actor, kind, id);
    const memberships = await this.db.organizationMembership.findMany({
      where: { organization_id: actor.organizationId, status: 'ACTIVE', user: { activo: true } },
      select: { user_id: true, rol: true, user: { select: { nombre: true, apellido: true } } },
      orderBy: { user: { nombre: 'asc' } },
    });
    return memberships.filter((member) => roleHasPermission(member.rol, permissions[kind].write));
  }

  async assign(actor: Actor, kind: CollaboratedKind, id: string, userId: string) {
    this.assertPermission(actor, kind, true);
    return this.db.$transaction(async (tx) => {
      await tx.$executeRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${`pravia:collab:${actor.organizationId}:${kind}:${id}`}))`);
      await this.assertTarget(tx, actor, kind, id);
      const member = await tx.organizationMembership.findFirst({
        where: { organization_id: actor.organizationId, user_id: userId, status: 'ACTIVE', user: { activo: true } },
        select: { user_id: true, rol: true },
      });
      if (!member || !roleHasPermission(member.rol, permissions[kind].write)) {
        throw new RecordCollaborationError(400, 'COLLAB_MEMBER_INELIGIBLE', 'El colaborador debe estar activo y contar con permiso de edición del módulo.');
      }
      const filter = { organization_id: actor.organizationId, [targetColumn(kind)]: id, user_id: userId, active: true };
      const existing = await tx.recordCollaboration.findFirst({ where: filter, select: { id: true } });
      if (existing) return { id: existing.id, idempotent: true };
      const created = await tx.recordCollaboration.create({ data: {
        organization_id: actor.organizationId, [targetColumn(kind)]: id,
        user_id: userId, active: true, assigned_by_id: actor.id,
      } });
      await tx.auditLog.create({ data: {
        organization_id: actor.organizationId, user_id: actor.id, session_id: actor.sessionId,
        accion: 'COLLABORATOR_ASSIGNED', entidad: kind, entidad_id: id,
        valores_nuevos: { collaborator_id: userId, assignment_id: created.id },
      } });
      return { id: created.id, idempotent: false };
    });
  }

  async revoke(actor: Actor, kind: CollaboratedKind, id: string, userId: string) {
    this.assertPermission(actor, kind, true);
    return this.db.$transaction(async (tx) => {
      await tx.$executeRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${`pravia:collab:${actor.organizationId}:${kind}:${id}`}))`);
      await this.assertTarget(tx, actor, kind, id);
      const assignment = await tx.recordCollaboration.findFirst({ where: {
        organization_id: actor.organizationId, [targetColumn(kind)]: id, user_id: userId, active: true,
      } });
      if (!assignment) throw new RecordCollaborationError(404, 'COLLAB_ASSIGNMENT_NOT_FOUND', 'La asignación ya no está activa.');
      await tx.recordCollaboration.update({ where: { id: assignment.id }, data: {
        active: false, revoked_at: new Date(), revoked_by_id: actor.id,
      } });
      await tx.auditLog.create({ data: {
        organization_id: actor.organizationId, user_id: actor.id, session_id: actor.sessionId,
        accion: 'COLLABORATOR_REVOKED', entidad: kind, entidad_id: id,
        valores_anteriores: { collaborator_id: userId, assignment_id: assignment.id },
      } });
      return { revoked: true };
    });
  }
}
