import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const explicitUrl = process.env.CFG002_DATABASE_URL || '';
const url = new URL(explicitUrl || 'postgresql://invalid.invalid/blocked');
if (process.env.CFG002_RUN_ISOLATED === '1' && (
  url.hostname !== '127.0.0.1'
  || url.port !== '55481'
  || !url.pathname.startsWith('/pravia_cfg002_')
)) {
  throw new Error('CFG-002 PostgreSQL tests only accept an explicit isolated local database.');
}

const db = new PrismaClient({ datasources: { db: { url: explicitUrl } } });
const orgA = randomUUID();
const orgB = randomUUID();
const userA = randomUUID();
const userB = randomUUID();
const notaryA = randomUUID();
const notaryB = randomUUID();

describe.runIf(process.env.CFG002_RUN_ISOLATED === '1')('CFG-002 v4 · PostgreSQL físico aislado', () => {
  beforeAll(async () => {
    for (const [organizationId, userId, suffix] of [[orgA, userA, 'a'], [orgB, userB, 'b']] as const) {
      await db.organization.create({ data: { id: organizationId, name: `CFG002 ${suffix}` } });
      await db.user.create({ data: {
        id: userId,
        email: `cfg002-${suffix}-${randomUUID()}@example.test`,
        password_hash: 'synthetic-not-a-login',
        nombre: 'CFG002',
        apellido: suffix,
        rol: 'ADMINISTRACION',
        activo: true,
        requires_password_change: false,
      } });
      await db.organizationMembership.create({ data: { organization_id: organizationId, user_id: userId, rol: 'ADMINISTRACION', status: 'ACTIVE' } });
      await db.notaria.create({ data: {
        id: suffix === 'a' ? notaryA : notaryB,
        organization_id: organizationId,
        nombre: `Notaría CFG002 ${suffix}`,
        predeterminada: true,
      } });
    }
  });

  afterAll(async () => { await db.$disconnect(); });

  it('contiene la migración, columnas, índices y políticas RLS esperadas', async () => {
    const [migration] = await db.$queryRaw<Array<{ count: bigint }>>`
      SELECT count(*)::bigint AS count
      FROM pravia_os._prisma_migrations
      WHERE migration_name = '20260911010000_cfg002_v4_legal_library'
        AND finished_at IS NOT NULL
        AND rolled_back_at IS NULL
    `;
    expect(Number(migration.count)).toBe(1);

    const [shape] = await db.$queryRaw<Array<{ tables: bigint; columns: bigint; rls: bigint; policies: bigint }>>`
      SELECT
        (SELECT count(*) FROM information_schema.tables WHERE table_schema = 'pravia_os' AND table_name IN ('catalogo_normativa_revisiones', 'catalogo_biblioteca_importaciones')) AS tables,
        (SELECT count(*) FROM information_schema.columns WHERE table_schema = 'pravia_os' AND (
          (table_name = 'catalogo_carpetas' AND column_name IN ('codigo_biblioteca', 'ruta_biblioteca')) OR
          (table_name = 'catalogo_artefactos' AND column_name IN ('codigo_biblioteca', 'ruta_biblioteca', 'revision')) OR
          (table_name = 'catalogo_artefacto_versiones' AND column_name = 'version_biblioteca') OR
          (table_name = 'catalogo_artefacto_reglas' AND column_name IN ('codigo_regla', 'revision', 'normativa_revision_id')) OR
          (table_name = 'expediente_artefactos_pendientes' AND column_name IN ('normativa_revision_id', 'hechos_evaluados_snapshot', 'condiciones_pendientes_snapshot'))
        )) AS columns,
        (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'pravia_os' AND c.relname IN ('catalogo_normativa_revisiones', 'catalogo_biblioteca_importaciones') AND c.relrowsecurity) AS rls,
        (SELECT count(*) FROM pg_policies WHERE schemaname = 'pravia_os' AND tablename IN ('catalogo_normativa_revisiones', 'catalogo_biblioteca_importaciones')) AS policies
    `;
    expect(Number(shape.tables)).toBe(2);
    expect(Number(shape.columns)).toBe(12);
    expect(Number(shape.rls)).toBe(2);
    expect(Number(shape.policies)).toBe(2);
  });

  it('impide relaciones normativas cross-tenant mediante FK compuesta', async () => {
    const artifact = await db.catalogoArtefacto.create({ data: {
      organization_id: orgA,
      tipo: 'FORMATO',
      propietario_tipo: 'NOTARIA',
      notaria_id: notaryA,
      nombre: 'Formato aislado',
      creado_por_id: userA,
      actualizado_por_id: userA,
    } });
    const normative = await db.catalogoNormativaRevision.create({ data: {
      organization_id: orgA,
      artefacto_id: artifact.id,
      codigo_revision: `CFG002-${randomUUID()}`,
      revision: 1,
      fundamento_normativo: 'Fixture contractual aislado',
      version_normativa: 'test',
      vigencia_desde: new Date('2026-01-01T00:00:00.000Z'),
      creado_por_id: userA,
    } });
    await expect(db.catalogoArtefactoRegla.create({ data: {
      organization_id: orgB,
      artefacto_id: artifact.id,
      obligatoria: true,
      codigo_regla: `CROSS-${randomUUID()}`,
      normativa_revision_id: normative.id,
    } })).rejects.toMatchObject({ code: 'P2003' });
  });

  it('hace idempotente la identidad de importación por organización', async () => {
    const key = `cfg002-test-${randomUUID()}`;
    const data = {
      organization_id: orgA,
      idempotency_key: key,
      codigo_biblioteca: 'PRAVIA_CFG002_STANDARD',
      version_biblioteca: 'v2-LEGAL',
      source_checksum: 'a'.repeat(64),
      estado: 'COMPLETED',
      creado_por_id: userA,
    };
    await db.catalogoBibliotecaImportacion.create({ data });
    await expect(db.catalogoBibliotecaImportacion.create({ data })).rejects.toMatchObject({ code: 'P2002' });
    await expect(db.catalogoBibliotecaImportacion.create({ data: { ...data, organization_id: orgB, creado_por_id: userB } })).resolves.toMatchObject({ organization_id: orgB });
  });
});
