import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runWithActorContext } from '../auth/actorContext';
import { functionalDestinationService } from '../services/functionalDestination.service';
import { questionnaireBanksService } from '../services/questionnaireBanks.service';
import { templatesAndFormatsService } from '../services/configurationCatalog.service';

const explicitUrl = process.env.CORRECTIONS_011_012_014_DATABASE_URL || '';
const target = new URL(explicitUrl || 'postgresql://invalid.invalid/blocked');
if (process.env.CORRECTIONS_011_012_014_RUN_ISOLATED === '1' && (
  target.hostname !== '127.0.0.1'
  || target.port !== '55433'
  || target.pathname !== '/pravia_corr011_012_014_qa'
  || process.env.DATABASE_URL !== explicitUrl
  || process.env.DIRECT_URL !== explicitUrl
)) throw new Error('Correcciones 011/012/014 sólo aceptan el PostgreSQL local aislado certificado.');

const db = new PrismaClient({ datasources: { db: { url: explicitUrl } } });
const ids = { org: randomUUID(), otherOrg: randomUUID(), user: randomUUID(), otherUser: randomUUID(), membership: randomUUID(), otherMembership: randomUUID(), notary: randomUUID(), otherNotary: randomUUID() };
const actor: any = { id: ids.user, organizationId: ids.org, membershipId: ids.membership, sessionId: randomUUID(), rol: 'ADMINISTRACION', scope: 'GLOBAL', permissions: ['configuracion.plantillas_formatos.manage', 'compliance.rules.manage'] };
const otherActor: any = { ...actor, id: ids.otherUser, organizationId: ids.otherOrg, membershipId: ids.otherMembership, sessionId: randomUUID() };
const run = <T>(who: any, work: () => T) => runWithActorContext({ userId: who.id, organizationId: who.organizationId, membershipId: who.membershipId, sessionId: who.sessionId, role: who.rol, permissions: who.permissions, scope: who.scope }, work);

describe.runIf(process.env.CORRECTIONS_011_012_014_RUN_ISOLATED === '1')('Correcciones 011/012/014 · PostgreSQL físico aislado', () => {
  beforeAll(async () => {
    for (const [organizationId, userId, membershipId, notaryId, suffix] of [
      [ids.org, ids.user, ids.membership, ids.notary, 'a'],
      [ids.otherOrg, ids.otherUser, ids.otherMembership, ids.otherNotary, 'b'],
    ] as const) {
      await db.organization.create({ data: { id: organizationId, name: `CORR-011-014-${suffix}` } });
      await db.user.create({ data: { id: userId, email: `corr-011-014-${suffix}-${randomUUID()}@example.test`, password_hash: 'synthetic-not-a-login', nombre: 'QA', apellido: suffix, rol: 'ADMINISTRACION', activo: true, requires_password_change: false } });
      await db.organizationMembership.create({ data: { id: membershipId, organization_id: organizationId, user_id: userId, rol: 'ADMINISTRACION', status: 'ACTIVE' } });
      await db.notaria.create({ data: { id: notaryId, organization_id: organizationId, nombre: `Notaría QA ${suffix}`, predeterminada: true } });
    }
  });

  afterAll(async () => { await db.$disconnect(); });

  it('aplicó físicamente la migración, enum, RLS, índices y FK tenant', async () => {
    const [shape] = await db.$queryRaw<Array<{ migrations: bigint; table_count: bigint; rls_count: bigint; policy_count: bigint; index_count: bigint; bank_index_count: bigint }>>`
      SELECT
        (SELECT count(*) FROM pravia_os._prisma_migrations WHERE migration_name='20260920010000_corrections011_012_014' AND finished_at IS NOT NULL AND rolled_back_at IS NULL) AS migrations,
        (SELECT count(*) FROM information_schema.tables WHERE table_schema='pravia_os' AND table_name='catalogo_artefacto_destinos') AS table_count,
        (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='pravia_os' AND c.relname='catalogo_artefacto_destinos' AND c.relrowsecurity) AS rls_count,
        (SELECT count(*) FROM pg_policies WHERE schemaname='pravia_os' AND tablename='catalogo_artefacto_destinos') AS policy_count,
        (SELECT count(*) FROM pg_indexes WHERE schemaname='pravia_os' AND tablename='catalogo_artefacto_destinos' AND indexname IN ('uq_catalogo_artefacto_destino','uq_catalogo_destino_default','idx_catalogo_destino_resolver')) AS index_count,
        (SELECT count(*) FROM pg_indexes WHERE schemaname='pravia_os' AND tablename='catalogo_artefactos' AND indexname='uq_catalogo_questionnaire_bank_purpose') AS bank_index_count
    `;
    expect(shape).toEqual({ migrations: 1n, table_count: 1n, rls_count: 1n, policy_count: 1n, index_count: 3n, bank_index_count: 1n });
  });

  it('asigna y resuelve el formato exacto por destino, versión y tenant sin inferir carpeta o nombre', async () => {
    const artifact = await db.catalogoArtefacto.create({ data: { organization_id: ids.org, tipo: 'PLANTILLA', propietario_tipo: 'NOTARIA', notaria_id: ids.notary, nombre: 'Nombre deliberadamente irrelevante', activo: true, creado_por_id: ids.user, actualizado_por_id: ids.user } });
    const version = await db.catalogoArtefactoVersion.create({ data: { organization_id: ids.org, artefacto_id: artifact.id, version: 1, nombre_original: 'witness.docx', storage_key: `qa/${randomUUID()}.docx`, mime_type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', size_bytes: 10, checksum_sha256: 'a'.repeat(64), origen: 'SYNTHETIC_QA', activa: true, creado_por_id: ids.user } });
    await run(actor, () => functionalDestinationService.assign(actor, artifact.id, { destinos: [{ destino: 'PROYECTO_MACHOTE', activo: true, predeterminado: true }] }));
    const resolved = await run(actor, () => functionalDestinationService.resolve(actor, 'PROYECTO_MACHOTE'));
    expect(resolved.provenance).toEqual({ artifact_id: artifact.id, version_id: version.id, version: 1, checksum_sha256: 'a'.repeat(64) });
    await expect(run(otherActor, () => functionalDestinationService.assign(otherActor, artifact.id, { destinos: [{ destino: 'PROYECTO_MACHOTE' }] }))).rejects.toMatchObject({ status: 404, code: 'ARTIFACT_NOT_FOUND' });

    const second = await db.catalogoArtefacto.create({ data: { organization_id: ids.org, tipo: 'PLANTILLA', propietario_tipo: 'NOTARIA', notaria_id: ids.notary, nombre: 'Segundo', activo: true, creado_por_id: ids.user, actualizado_por_id: ids.user } });
    await expect(run(actor, () => functionalDestinationService.assign(actor, second.id, { destinos: [{ destino: 'PROYECTO_MACHOTE', activo: true, predeterminado: true }] }))).rejects.toMatchObject({ code: 'P2002' });
  });

  it('mantiene exactamente dos bancos globales y publica revisiones inmutables de preguntas', async () => {
    expect((await run(actor, () => questionnaireBanksService.list(actor))).banks.map((bank) => bank.label)).toEqual(['Personal', 'Acto / Operación']);
    const personal = await run(actor, () => questionnaireBanksService.add(actor, 'PERSONAL', { label: '¿Cuál es su actividad?', type: 'TEXT', required: true }));
    await run(actor, () => questionnaireBanksService.update(actor, 'PERSONAL', personal.id, { active: false }));
    await run(actor, () => questionnaireBanksService.add(actor, 'OPERACION', { label: '¿Cuál es el origen de los recursos?', type: 'TEXT', required: true }));
    const listed = await run(actor, () => questionnaireBanksService.list(actor));
    expect(listed.banks).toHaveLength(2);
    expect(listed.banks.find((bank) => bank.key === 'PERSONAL')?.questions[0]).toMatchObject({ id: personal.id, active: false });
    const artifacts = await db.catalogoArtefacto.findMany({ where: { organization_id: ids.org, purpose: { in: ['CUE_PERSONAL', 'CUE_GENERAL'] } }, include: { versiones: { orderBy: { version: 'asc' } } } });
    expect(artifacts).toHaveLength(2);
    expect(artifacts.find((item) => item.purpose === 'CUE_PERSONAL')?.versiones.map((version) => ({ version: version.version, active: version.activa }))).toEqual([{ version: 1, active: false }, { version: 2, active: true }]);
    await expect(db.catalogoArtefacto.create({ data: { organization_id: ids.org, tipo: 'FORMATO', propietario_tipo: 'NOTARIA', notaria_id: ids.notary, nombre: 'Banco paralelo prohibido', purpose: 'CUE_PERSONAL', activo: true, creado_por_id: ids.user, actualizado_por_id: ids.user } })).rejects.toMatchObject({ code: 'P2002' });
  });

  it('renombrar carpeta y mover archivo conserva el destino funcional y su resolución exacta', async () => {
    const folder = await db.catalogoCarpeta.create({ data: { organization_id: ids.org, propietario_tipo: 'NOTARIA', tipo: 'FORMATO', notaria_id: ids.notary, nombre: 'ISR visual', activa: true } });
    const artifact = await db.catalogoArtefacto.create({ data: { organization_id: ids.org, tipo: 'FORMATO', propietario_tipo: 'NOTARIA', notaria_id: ids.notary, nombre: 'Archivo sin palabra ISR', activo: true, creado_por_id: ids.user, actualizado_por_id: ids.user } });
    const version = await db.catalogoArtefactoVersion.create({ data: { organization_id: ids.org, artefacto_id: artifact.id, version: 1, nombre_original: 'x.docx', storage_key: `qa/${randomUUID()}.docx`, mime_type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', size_bytes: 1, checksum_sha256: 'b'.repeat(64), origen: 'SYNTHETIC_QA', activa: true, creado_por_id: ids.user } });
    await run(actor, () => functionalDestinationService.assign(actor, artifact.id, { destinos: [{ destino: 'CALCULO_ISR_MEMORIA', activo: true, predeterminado: true }] }));
    await run(actor, () => templatesAndFormatsService.updateFolder(actor, folder.id, { nombre: 'Carpeta renombrada' }));
    await run(actor, () => templatesAndFormatsService.updateArtifact(actor, artifact.id, { carpeta_id: folder.id }));
    const resolved = await run(actor, () => functionalDestinationService.resolve(actor, 'CALCULO_ISR_MEMORIA'));
    expect(resolved.provenance).toMatchObject({ artifact_id: artifact.id, version_id: version.id });
    const persisted = await db.catalogoArtefacto.findUniqueOrThrow({ where: { id: artifact.id }, include: { destinosFuncionales: true } });
    expect(persisted).toMatchObject({ carpeta_id: folder.id, destinosFuncionales: [expect.objectContaining({ destino: 'CALCULO_ISR_MEMORIA', predeterminado: true })] });
  });
});
