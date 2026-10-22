import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runWithActorContext } from '../auth/actorContext';
import { templatesAndFormatsService } from '../services/configurationCatalog.service';

const explicitUrl = process.env.CFG002_ORG_DATABASE_URL || '';
const target = new URL(explicitUrl || 'postgresql://invalid.invalid/blocked');
if (process.env.CFG002_ORG_RUN_ISOLATED === '1' && (
  target.hostname !== '127.0.0.1'
  || target.port !== '55510'
  || target.pathname !== '/pravia_cfg002_qa'
  || process.env.DATABASE_URL !== explicitUrl
  || process.env.DIRECT_URL !== explicitUrl
  || process.env.STORAGE_MODE !== 'local'
)) throw new Error('CFG-002 owner tests require the isolated local QA database and storage.');

const db = new PrismaClient({ datasources: { db: { url: explicitUrl } } });
const ids = { orgA: randomUUID(), orgB: randomUUID(), userA: randomUUID(), userB: randomUUID(), memberA: randomUUID(), memberB: randomUUID() };
const actor = (organizationId: string, userId: string, membershipId: string) => ({
  id: userId, organizationId, membershipId, sessionId: randomUUID(), rol: 'ADMINISTRACION', scope: 'GLOBAL',
  permissions: ['configuracion.catalogos.read', 'configuracion.plantillas_formatos.manage'],
}) as any;
const actorA = actor(ids.orgA, ids.userA, ids.memberA);
const actorB = actor(ids.orgB, ids.userB, ids.memberB);
const run = <T>(who: any, work: () => T) => runWithActorContext({
  userId: who.id, organizationId: who.organizationId, membershipId: who.membershipId,
  sessionId: who.sessionId, role: who.rol, permissions: who.permissions, scope: who.scope,
}, work);
const file = (name: string) => {
  const buffer = Buffer.from(`Synthetic CFG-002 QA ${name}`);
  return { buffer, originalname: name, mimetype: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', size: buffer.length } as Express.Multer.File;
};

describe.runIf(process.env.CFG002_ORG_RUN_ISOLATED === '1')('CFG-002 Organization owner · isolated PostgreSQL', () => {
  beforeAll(async () => {
    for (const [organizationId, userId, memberId, suffix] of [
      [ids.orgA, ids.userA, ids.memberA, 'a'], [ids.orgB, ids.userB, ids.memberB, 'b'],
    ] as const) {
      await db.organization.create({ data: { id: organizationId, name: `CFG002 owner QA ${suffix}` } });
      await db.user.create({ data: { id: userId, email: `cfg002-owner-${suffix}-${randomUUID()}@example.test`, password_hash: 'synthetic-no-login', nombre: 'QA', apellido: suffix, rol: 'ADMINISTRACION', activo: true, requires_password_change: false } });
      await db.organizationMembership.create({ data: { id: memberId, organization_id: organizationId, user_id: userId, rol: 'ADMINISTRACION', status: 'ACTIVE' } });
      await db.tenantEntitlement.create({ data: { organization_id: organizationId, included_storage_bytes: 1024n * 1024n, total_storage_capacity_bytes: 1024n * 1024n } });
      await db.tenantStorageUsage.create({ data: { organization_id: organizationId } });
    }
  });
  afterAll(async () => { await db.$disconnect(); });

  it('aplicó las dos migraciones incrementales y conservó las filas originales', async () => {
    const migrations = await db.$queryRaw<Array<{ count: bigint }>>`
      SELECT count(*)::bigint AS count FROM pravia_os._prisma_migrations
      WHERE migration_name IN ('20261020100000_cfg002_organization_owner_enum', '20261020101000_cfg002_organization_owner_backfill')
        AND finished_at IS NOT NULL AND rolled_back_at IS NULL`;
    expect(migrations[0].count).toBe(2n);
    expect(await db.catalogoArtefacto.count({ where: { propietario_tipo: 'NOTARIA' } })).toBe(0);
    expect(await db.catalogoArtefacto.count({ where: { propietario_tipo: 'ORGANIZACION' } })).toBeGreaterThanOrEqual(10);
  });

  it('el explorador de la organización conserva visibles los artefactos migrados con procedencia notarial', async () => {
    const migrated = await db.catalogoArtefacto.findFirst({
      where: { propietario_tipo: 'ORGANIZACION', notaria_id: { not: null }, carpeta_id: null },
      select: { id: true, organization_id: true, tipo: true, notaria_id: true },
    });
    expect(migrated).not.toBeNull();
    const membership = await db.organizationMembership.findFirst({
      where: { organization_id: migrated!.organization_id, status: 'ACTIVE' },
      select: { id: true, user_id: true },
    });
    expect(membership).not.toBeNull();
    const owner = actor(migrated!.organization_id, membership!.user_id, membership!.id);
    const explorer = await run(owner, () => templatesAndFormatsService.explorer(owner, 'ORGANIZACION', owner.organizationId, migrated!.tipo));
    expect(explorer.artifacts.map((item) => item.id)).toContain(migrated!.id);
    expect(explorer.artifacts.find((item) => item.id === migrated!.id)?.notaria_id).toBe(migrated!.notaria_id);
  });

  it('muestra la organización activa y niega la organización ajena o la titularidad legacy', async () => {
    expect(await run(actorA, () => templatesAndFormatsService.root(actorA))).toMatchObject({ organization: { id: ids.orgA, nombre: 'CFG002 owner QA a' } });
    await expect(run(actorA, () => templatesAndFormatsService.explorer(actorA, 'ORGANIZACION', ids.orgB, 'FORMATO'))).rejects.toMatchObject({ code: 'ORGANIZATION_OUTSIDE_TENANT' });
    await expect(run(actorA, () => templatesAndFormatsService.createFolder(actorA, { propietario_tipo: 'NOTARIA', notaria_id: randomUUID(), tipo: 'FORMATO', nombre: 'Legacy' }))).rejects.toMatchObject({ code: 'CFG002_LEGACY_OWNER_READ_ONLY' });
  });

  it('crea carpeta, artefacto y versión en tenant A sin hacerlos visibles a tenant B', async () => {
    const folder = await run(actorA, () => templatesAndFormatsService.createFolder(actorA, { propietario_tipo: 'ORGANIZACION', organization_id: ids.orgA, tipo: 'PLANTILLA', nombre: 'QA Organización' }));
    const artifact = await run(actorA, () => templatesAndFormatsService.createArtifact(actorA, {
      propietario_tipo: 'ORGANIZACION', organization_id: ids.orgA, tipo: 'PLANTILLA', carpeta_id: folder.id,
      nombre: 'Machote QA', act_ids: [], rules: [], destinos_funcionales: [],
    }, file('cfg002-org-v1.docx')));
    expect(artifact).toMatchObject({ organization_id: ids.orgA, propietario_tipo: 'ORGANIZACION', notaria_id: null, carpeta_id: folder.id });
    const first = artifact.versiones[0];
    expect(first.checksum_sha256).toMatch(/^[a-f0-9]{64}$/);
    const second = await run(actorA, () => templatesAndFormatsService.addVersion(actorA, artifact.id, {}, file('cfg002-org-v2.docx')));
    expect(second.version).toBe(2);
    const explorerA = await run(actorA, () => templatesAndFormatsService.explorer(actorA, 'ORGANIZACION', ids.orgA, 'PLANTILLA', folder.id));
    expect(explorerA.artifacts.map((item) => item.id)).toContain(artifact.id);
    const explorerB = await run(actorB, () => templatesAndFormatsService.explorer(actorB, 'ORGANIZACION', ids.orgB, 'PLANTILLA'));
    expect(explorerB.artifacts.map((item) => item.id)).not.toContain(artifact.id);
    await expect(run(actorB, () => templatesAndFormatsService.addVersion(actorB, artifact.id, {}, file('blocked.docx')))).rejects.toMatchObject({ code: 'ARTIFACT_NOT_FOUND' });
    await expect(run(actorB, () => templatesAndFormatsService.signedUrl(actorB, first.id))).rejects.toMatchObject({ code: 'ARTIFACT_VERSION_NOT_FOUND' });
    expect(await db.auditLog.count({ where: { organization_id: ids.orgA, entidad_id: artifact.id, accion: 'CFG_ARTIFACT_CREATED' } })).toBe(1);
  });

  it('migra dos jerarquías notariales homónimas sin fusionar IDs, versiones ni SHA', async () => {
    const owners = await Promise.all([1, 2].map((number) => db.notaria.create({
      data: { organization_id: ids.orgA, nombre: `Notaría histórica CFG002 ${number}` },
      select: { id: true },
    })));
    const fixtures = [];
    for (const owner of owners) {
      const root = await db.catalogoCarpeta.create({ data: {
        organization_id: ids.orgA, propietario_tipo: 'NOTARIA', tipo: 'PLANTILLA',
        notaria_id: owner.id, nombre: 'Machotes históricos',
      } });
      const child = await db.catalogoCarpeta.create({ data: {
        organization_id: ids.orgA, propietario_tipo: 'NOTARIA', tipo: 'PLANTILLA',
        notaria_id: owner.id, parent_id: root.id, nombre: 'Compraventas',
      } });
      const artifact = await db.catalogoArtefacto.create({ data: {
        organization_id: ids.orgA, propietario_tipo: 'NOTARIA', tipo: 'PLANTILLA',
        notaria_id: owner.id, carpeta_id: child.id, nombre: 'Machote compraventa',
        creado_por_id: ids.userA, actualizado_por_id: ids.userA,
      } });
      const checksum = randomUUID().replaceAll('-', '').repeat(2);
      const version = await db.catalogoArtefactoVersion.create({ data: {
        organization_id: ids.orgA, artefacto_id: artifact.id, version: 1,
        nombre_original: 'machote.docx', storage_key: `qa/cfg002/${artifact.id}.docx`,
        mime_type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', size_bytes: 1,
        checksum_sha256: checksum, origen: 'QA_SYNTHETIC', creado_por_id: ids.userA,
      } });
      fixtures.push({ ownerId: owner.id, rootId: root.id, childId: child.id, artifactId: artifact.id, versionId: version.id, checksum });
    }
    const url = new URL(explicitUrl);
    execFileSync('psql', ['-v', 'ON_ERROR_STOP=1', '-f', fileURLToPath(new URL('../../prisma/migrations/20261020101000_cfg002_organization_owner_backfill/migration.sql', import.meta.url))], {
      env: { ...process.env, PGHOST: url.hostname, PGPORT: url.port, PGUSER: decodeURIComponent(url.username), PGPASSWORD: decodeURIComponent(url.password), PGDATABASE: url.pathname.slice(1) },
      stdio: 'pipe',
    });
    for (const fixture of fixtures) {
      const root = await db.catalogoCarpeta.findUniqueOrThrow({ where: { id: fixture.rootId } });
      const child = await db.catalogoCarpeta.findUniqueOrThrow({ where: { id: fixture.childId } });
      const artifact = await db.catalogoArtefacto.findUniqueOrThrow({ where: { id: fixture.artifactId } });
      const version = await db.catalogoArtefactoVersion.findUniqueOrThrow({ where: { id: fixture.versionId } });
      expect(root).toMatchObject({ propietario_tipo: 'ORGANIZACION', notaria_id: fixture.ownerId });
      expect(child).toMatchObject({ propietario_tipo: 'ORGANIZACION', notaria_id: fixture.ownerId, parent_id: fixture.rootId });
      expect(artifact).toMatchObject({ propietario_tipo: 'ORGANIZACION', notaria_id: fixture.ownerId, carpeta_id: fixture.childId });
      expect(version).toMatchObject({ artefacto_id: fixture.artifactId, checksum_sha256: fixture.checksum });
    }
    expect(new Set(fixtures.map((item) => item.artifactId)).size).toBe(2);
  });
});
