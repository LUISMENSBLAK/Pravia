import { Prisma } from '@prisma/client';
import prisma from '../config/prisma';
import { CatalogConfigurationError } from './configurationCatalogError';

type Actor = NonNullable<Express.Request['user']>;
type AssignInput = { actId: string; artifactId: string; versionId: string; replace?: boolean };

const json = (value: unknown) => JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;

async function validateTarget(actor: Actor, input: AssignInput) {
  const [act, version] = await Promise.all([
    prisma.tipoActo.findFirst({
      where: { id: input.actId, activo: true, archived_at: null, OR: [{ organization_id: actor.organizationId }, { organization_id: null }] },
      select: { id: true, nombre: true },
    }),
    prisma.catalogoArtefactoVersion.findFirst({
      where: {
        id: input.versionId,
        organization_id: actor.organizationId,
        artefacto_id: input.artifactId,
        activa: true,
        storage_key: { not: null },
        artefacto: { activo: true, tipo: 'PLANTILLA' },
      },
      include: { artefacto: true },
    }),
  ]);
  if (!act) throw new CatalogConfigurationError(404, 'PROJECT_TEMPLATE_ACT_NOT_FOUND', 'El Acto no existe, está retirado o no pertenece a esta organización.');
  if (!version) throw new CatalogConfigurationError(404, 'PROJECT_TEMPLATE_VERSION_NOT_FOUND', 'El machote o su versión no existe, está inactivo o no pertenece a esta organización.');
  return { act, version };
}

export const projectTemplateAssignmentService = {
  async list(actor: Actor, actIds?: string[]) {
    return prisma.projectTemplateAssignment.findMany({
      where: { organization_id: actor.organizationId, active: true, ...(actIds?.length ? { tipo_acto_id: { in: actIds } } : {}) },
      include: {
        tipoActo: { select: { id: true, nombre: true } },
        artefacto: { select: { id: true, nombre: true, descripcion: true } },
        version: { select: { id: true, version: true, nombre_original: true, checksum_sha256: true, mime_type: true, storage_key: true } },
      },
      orderBy: [{ updated_at: 'desc' }],
    });
  },

  async resolve(actor: Actor, actId: string) {
    const assignment = await prisma.projectTemplateAssignment.findUnique({
      where: { organization_id_tipo_acto_id: { organization_id: actor.organizationId, tipo_acto_id: actId } },
      include: { artefacto: true, version: true, tipoActo: { select: { id: true, nombre: true } } },
    });
    if (!assignment?.active || !assignment.artefacto.activo || !assignment.version.activa || !assignment.version.storage_key) {
      throw new CatalogConfigurationError(409, 'PROJECT_TEMPLATE_NOT_CONFIGURED', 'No existe un machote de Proyecto activo para el Acto de este expediente.');
    }
    if (assignment.version.artefacto_id !== assignment.artefacto_id || assignment.version.organization_id !== actor.organizationId) {
      throw new CatalogConfigurationError(409, 'PROJECT_TEMPLATE_ASSIGNMENT_INVALID', 'La asignación del machote no conserva integridad estructural.');
    }
    return assignment;
  },

  async assign(actor: Actor, input: AssignInput) {
    const target = await validateTarget(actor, input);
    return prisma.$transaction(async (tx) => {
      await tx.$executeRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${`project-template:${actor.organizationId}:${input.actId}`}))`);
      const current = await tx.projectTemplateAssignment.findUnique({
        where: { organization_id_tipo_acto_id: { organization_id: actor.organizationId, tipo_acto_id: input.actId } },
        include: { artefacto: { select: { nombre: true } }, version: { select: { version: true } } },
      });
      const unchanged = current?.active && current.artefacto_id === input.artifactId && current.version_id === input.versionId;
      if (unchanged) return { assignment: current, idempotent: true, replaced: false };
      if (current?.active && !input.replace) {
        throw new CatalogConfigurationError(409, 'PROJECT_TEMPLATE_CONFLICT', `El Acto ya utiliza “${current.artefacto.nombre}” v${current.version.version}. Elige Cancelar o Reemplazar.`);
      }

      const assignment = await tx.projectTemplateAssignment.upsert({
        where: { organization_id_tipo_acto_id: { organization_id: actor.organizationId, tipo_acto_id: input.actId } },
        update: { artefacto_id: input.artifactId, version_id: input.versionId, active: true, updated_by_id: actor.id },
        create: {
          organization_id: actor.organizationId,
          tipo_acto_id: input.actId,
          artefacto_id: input.artifactId,
          version_id: input.versionId,
          created_by_id: actor.id,
          updated_by_id: actor.id,
        },
      });
      await tx.catalogoArtefactoActo.upsert({
        where: { artefacto_id_tipo_acto_id: { artefacto_id: input.artifactId, tipo_acto_id: input.actId } },
        update: { organization_id: actor.organizationId },
        create: { organization_id: actor.organizationId, artefacto_id: input.artifactId, tipo_acto_id: input.actId },
      });
      await tx.catalogoArtefactoDestino.upsert({
        where: { organization_id_artefacto_id_destino: { organization_id: actor.organizationId, artefacto_id: input.artifactId, destino: 'PROYECTO_MACHOTE' } },
        update: { activo: true, predeterminado: false, actualizado_por_id: actor.id },
        create: {
          organization_id: actor.organizationId,
          artefacto_id: input.artifactId,
          destino: 'PROYECTO_MACHOTE',
          activo: true,
          predeterminado: false,
          creado_por_id: actor.id,
          actualizado_por_id: actor.id,
        },
      });
      await tx.auditLog.create({ data: {
        organization_id: actor.organizationId,
        user_id: actor.id,
        accion: current ? 'PROJECT_TEMPLATE_ASSIGNMENT_REPLACED' : 'PROJECT_TEMPLATE_ASSIGNMENT_CREATED',
        entidad: 'ProjectTemplateAssignment',
        entidad_id: assignment.id,
        valores_anteriores: current ? json({ artifact_id: current.artefacto_id, version_id: current.version_id, active: current.active }) : undefined,
        valores_nuevos: json({ act_id: input.actId, act_name: target.act.nombre, artifact_id: input.artifactId, version_id: input.versionId }),
        session_id: actor.sessionId,
      } });
      return { assignment, idempotent: false, replaced: Boolean(current) };
    });
  },

  async remove(actor: Actor, actId: string) {
    return prisma.$transaction(async (tx) => {
      await tx.$executeRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${`project-template:${actor.organizationId}:${actId}`}))`);
      const current = await tx.projectTemplateAssignment.findUnique({ where: { organization_id_tipo_acto_id: { organization_id: actor.organizationId, tipo_acto_id: actId } } });
      if (!current?.active) return { removed: false, idempotent: true };
      const assignment = await tx.projectTemplateAssignment.update({ where: { id: current.id }, data: { active: false, updated_by_id: actor.id } });
      await tx.auditLog.create({ data: {
        organization_id: actor.organizationId, user_id: actor.id, accion: 'PROJECT_TEMPLATE_ASSIGNMENT_REMOVED',
        entidad: 'ProjectTemplateAssignment', entidad_id: assignment.id,
        valores_anteriores: json({ act_id: actId, artifact_id: current.artefacto_id, version_id: current.version_id }),
        valores_nuevos: json({ active: false }), session_id: actor.sessionId,
      } });
      return { removed: true, idempotent: false };
    });
  },
};
