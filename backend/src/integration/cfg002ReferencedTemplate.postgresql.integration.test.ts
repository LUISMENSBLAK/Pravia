import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { runWithActorContext } from '../auth/actorContext';
import { projectTemplateAssignmentService } from '../services/projectTemplateAssignment.service';
import { templatesAndFormatsService } from '../services/configurationCatalog.service';

const url = process.env.CFG002_REFERENCE_DATABASE_URL || '';
const parsed = new URL(url || 'postgresql://invalid.invalid/blocked');
if (process.env.CFG002_REFERENCE_RUN_ISOLATED === '1' && (
  parsed.hostname !== '127.0.0.1'
  || parsed.port !== '55510'
  || parsed.pathname !== '/pravia_six_corr_qa'
  || process.env.DATABASE_URL !== url
  || process.env.DIRECT_URL !== url
  || process.env.STORAGE_MODE !== 'local'
)) throw new Error('CFG-002 reference test requires the isolated local PostgreSQL/Storage QA environment.');

const db = new PrismaClient({ datasources: { db: { url } } });
const ids = { organization: randomUUID(), user: randomUUID(), membership: randomUUID(), act: randomUUID(), artifact: randomUUID(), v1: randomUUID(), v2: randomUUID(), organizationB: randomUUID(), userB: randomUUID(), membershipB: randomUUID() };
const actor = {
  id: ids.user, organizationId: ids.organization, membershipId: ids.membership,
  sessionId: randomUUID(), rol: 'ADMINISTRACION', scope: 'GLOBAL',
  permissions: ['configuracion.catalogos.read', 'configuracion.plantillas_formatos.manage'],
} as any;
const actorB = { ...actor, id: ids.userB, organizationId: ids.organizationB, membershipId: ids.membershipB, sessionId: randomUUID() };
const runAs = <T>(who: typeof actor, work: () => T) => runWithActorContext({
  userId: who.id, organizationId: who.organizationId, membershipId: who.membershipId,
  sessionId: who.sessionId, role: who.rol, permissions: who.permissions, scope: who.scope,
}, work);
const run = <T>(work: () => T) => runAs(actor, work);

describe.runIf(process.env.CFG002_REFERENCE_RUN_ISOLATED === '1')('CFG2-13/18 · versiones y baja referenciada en PostgreSQL aislado', () => {
  beforeAll(async () => {
    await db.organization.create({ data: { id: ids.organization, name: 'CFG002 referenced template QA' } });
    await db.user.create({ data: {
      id: ids.user, email: `cfg002-reference-${randomUUID()}@example.test`, password_hash: 'synthetic-no-login',
      nombre: 'QA', apellido: 'CFG002', rol: 'ADMINISTRACION', activo: true, requires_password_change: false,
    } });
    await db.organizationMembership.create({ data: { id: ids.membership, organization_id: ids.organization, user_id: ids.user, rol: 'ADMINISTRACION', status: 'ACTIVE' } });
    await db.organization.create({ data: { id: ids.organizationB, name: 'CFG002 other tenant QA' } });
    await db.user.create({ data: {
      id: ids.userB, email: `cfg002-reference-b-${randomUUID()}@example.test`, password_hash: 'synthetic-no-login',
      nombre: 'QA', apellido: 'Tenant B', rol: 'ADMINISTRACION', activo: true, requires_password_change: false,
    } });
    await db.organizationMembership.create({ data: { id: ids.membershipB, organization_id: ids.organizationB, user_id: ids.userB, rol: 'ADMINISTRACION', status: 'ACTIVE' } });
    await db.tipoActo.create({ data: { id: ids.act, organization_id: ids.organization, nombre: 'Acto QA CFG002' } });
    await db.catalogoArtefacto.create({ data: {
      id: ids.artifact, organization_id: ids.organization, propietario_tipo: 'ORGANIZACION', tipo: 'PLANTILLA',
      nombre: 'Machote QA CFG002', creado_por_id: ids.user, actualizado_por_id: ids.user,
    } });
    for (const [id, version] of [[ids.v1, 1], [ids.v2, 2]] as const) {
      await db.catalogoArtefactoVersion.create({ data: {
        id, organization_id: ids.organization, artefacto_id: ids.artifact, version,
        nombre_original: `qa-v${version}.docx`, storage_key: `qa/cfg002-reference/${ids.artifact}/v${version}.docx`,
        mime_type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        size_bytes: 1, checksum_sha256: String(version).repeat(64), origen: 'QA_SYNTHETIC', creado_por_id: ids.user,
      } });
    }
  });
  afterAll(async () => { await db.$disconnect(); });

  it('reasigna v1→v2 con autorización, conserva ambas versiones y audita el reemplazo', async () => {
    const first = await run(() => projectTemplateAssignmentService.assign(actor, { actId: ids.act, artifactId: ids.artifact, versionId: ids.v1 }));
    expect(first.assignment.version_id).toBe(ids.v1);
    await expect(run(() => projectTemplateAssignmentService.assign(actor, { actId: ids.act, artifactId: ids.artifact, versionId: ids.v2 })))
      .rejects.toMatchObject({ code: 'PROJECT_TEMPLATE_CONFLICT' });
    const second = await run(() => projectTemplateAssignmentService.assign(actor, { actId: ids.act, artifactId: ids.artifact, versionId: ids.v2, replace: true }));
    expect(second.assignment.version_id).toBe(ids.v2);
    expect((await run(() => projectTemplateAssignmentService.resolve(actor, ids.act))).version_id).toBe(ids.v2);
    expect(await db.catalogoArtefactoVersion.count({ where: { artefacto_id: ids.artifact } })).toBe(2);
    expect(await db.auditLog.count({ where: { organization_id: ids.organization, accion: 'PROJECT_TEMPLATE_ASSIGNMENT_REPLACED' } })).toBe(1);
  });

  it('desactiva lógicamente el machote referenciado sin borrar versiones, asignación ni claves Storage', async () => {
    await run(() => templatesAndFormatsService.updateArtifact(actor, ids.artifact, { activo: false }));
    const artifact = await db.catalogoArtefacto.findUniqueOrThrow({ where: { id: ids.artifact }, include: { versiones: true } });
    expect(artifact.activo).toBe(false);
    expect(artifact.versiones.map((version) => version.id).sort()).toEqual([ids.v1, ids.v2].sort());
    expect(artifact.versiones.every((version) => Boolean(version.storage_key && version.checksum_sha256))).toBe(true);
    expect(await db.projectTemplateAssignment.count({ where: { organization_id: ids.organization, artefacto_id: ids.artifact } })).toBe(1);
    await expect(run(() => projectTemplateAssignmentService.resolve(actor, ids.act))).rejects.toMatchObject({ code: 'PROJECT_TEMPLATE_NOT_CONFIGURED' });
    await expect(run(() => projectTemplateAssignmentService.assign(actor, { actId: ids.act, artifactId: ids.artifact, versionId: ids.v1, replace: true })))
      .rejects.toMatchObject({ code: 'PROJECT_TEMPLATE_VERSION_NOT_FOUND' });
  });

  it('serializa baja y nueva asignación concurrentes sin referencias huérfanas ni reactivar el machote', async () => {
    const actId = randomUUID();
    const artifactId = randomUUID();
    const versionId = randomUUID();
    await db.tipoActo.create({ data: { id: actId, organization_id: ids.organization, nombre: 'Acto concurrencia QA' } });
    await db.catalogoArtefacto.create({ data: {
      id: artifactId, organization_id: ids.organization, propietario_tipo: 'ORGANIZACION', tipo: 'PLANTILLA',
      nombre: 'Machote concurrencia QA', creado_por_id: ids.user, actualizado_por_id: ids.user,
    } });
    await db.catalogoArtefactoVersion.create({ data: {
      id: versionId, organization_id: ids.organization, artefacto_id: artifactId, version: 1,
      nombre_original: 'concurrent-qa.docx', storage_key: `qa/cfg002-reference/${artifactId}/v1.docx`,
      mime_type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      size_bytes: 1, checksum_sha256: 'a'.repeat(64), origen: 'QA_SYNTHETIC', creado_por_id: ids.user,
    } });
    const [assignment, retirement] = await Promise.allSettled([
      run(() => projectTemplateAssignmentService.assign(actor, { actId, artifactId, versionId })),
      run(() => templatesAndFormatsService.updateArtifact(actor, artifactId, { activo: false })),
    ]);
    expect(retirement.status).toBe('fulfilled');
    if (assignment.status === 'rejected') expect(assignment.reason).toMatchObject({ code: 'PROJECT_TEMPLATE_VERSION_NOT_FOUND' });
    expect(await db.catalogoArtefacto.findUniqueOrThrow({ where: { id: artifactId }, select: { activo: true } })).toEqual({ activo: false });
    expect(await db.catalogoArtefactoVersion.count({ where: { id: versionId, artefacto_id: artifactId } })).toBe(1);
    expect(await db.projectTemplateAssignment.count({ where: { organization_id: ids.organization, tipo_acto_id: actId, artefacto_id: artifactId } }))
      .toBe(assignment.status === 'fulfilled' ? 1 : 0);
    await expect(run(() => projectTemplateAssignmentService.resolve(actor, actId))).rejects.toMatchObject({ code: 'PROJECT_TEMPLATE_NOT_CONFIGURED' });
  });

  it('no expone a tenant B metadatos de artefacto A por listado, ID, versión ni Acto', async () => {
    const explorer = await runAs(actorB, () => templatesAndFormatsService.explorer(actorB, 'ORGANIZACION', ids.organizationB, 'PLANTILLA'));
    expect(explorer.artifacts.map((item) => item.id)).not.toContain(ids.artifact);
    await expect(runAs(actorB, () => templatesAndFormatsService.updateArtifact(actorB, ids.artifact, { nombre: 'Ataque' })))
      .rejects.toMatchObject({ code: 'ARTIFACT_NOT_FOUND' });
    await expect(runAs(actorB, () => templatesAndFormatsService.signedUrl(actorB, ids.v1)))
      .rejects.toMatchObject({ code: 'ARTIFACT_VERSION_NOT_FOUND' });
    await expect(runAs(actorB, () => projectTemplateAssignmentService.resolve(actorB, ids.act)))
      .rejects.toMatchObject({ code: 'PROJECT_TEMPLATE_NOT_CONFIGURED' });
  });
});
