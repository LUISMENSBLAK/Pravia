import { afterAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { canonicalDatabaseFingerprint, H6_DB_FINGERPRINT_ALGORITHM } from '../domain/complianceH6';

function isolatedTarget() {
  const raw = process.env.DATABASE_URL || '';
  const url = new URL(raw);
  if (
    process.env.NODE_ENV !== 'test'
    || process.env.H6_PG_TEST_CONFIRMATION !== 'RUN_ISOLATED_H6_POSTGRESQL'
    || raw !== process.env.DIRECT_URL
    || url.hostname !== '127.0.0.1'
    || !['55468', '55469'].includes(url.port)
    || !/^\/pravia_h6_forensic_[ab]$/.test(url.pathname)
  ) throw new Error('H6 PostgreSQL requires the explicit isolated local A/B target.');
  return { url: raw, target: url.port === '55468' ? 'A' as const : 'B' as const };
}

const target = isolatedTarget();
const db = new PrismaClient({ datasources: { db: { url: target.url } } });

async function fingerprint() {
  const columns = await db.$queryRawUnsafe<Array<Record<string, unknown>>>(`
    SELECT table_name, column_name, data_type, udt_name, is_nullable, column_default
    FROM information_schema.columns
    WHERE table_schema = 'pravia_os' AND (table_name LIKE 'compliance_notice_%'
      OR table_name LIKE 'compliance_official_%' OR table_name = 'compliance_obligation_triggers'
      OR table_name IN ('compliance_obligations', 'compliance_requirements', 'expediente_documentos'))
    ORDER BY table_name, column_name
  `);
  const constraints = await db.$queryRawUnsafe<Array<Record<string, unknown>>>(`
    SELECT c.conname AS name, c.contype AS type, pg_get_constraintdef(c.oid, true) AS definition
    FROM pg_constraint c JOIN pg_namespace n ON n.oid = c.connamespace JOIN pg_class t ON t.oid = c.conrelid
    WHERE n.nspname = 'pravia_os' AND (t.relname LIKE 'compliance_notice_%'
      OR t.relname LIKE 'compliance_official_%' OR t.relname = 'compliance_obligation_triggers'
      OR t.relname IN ('compliance_obligations', 'compliance_requirements', 'expediente_documentos'))
    ORDER BY c.conname
  `);
  const indexes = await db.$queryRawUnsafe<Array<Record<string, unknown>>>(`
    SELECT tablename, indexname, indexdef FROM pg_indexes WHERE schemaname = 'pravia_os'
      AND (tablename LIKE 'compliance_notice_%' OR tablename LIKE 'compliance_official_%'
        OR tablename = 'compliance_obligation_triggers'
        OR tablename IN ('compliance_obligations', 'compliance_requirements', 'expediente_documentos'))
    ORDER BY indexname
  `);
  const enums = await db.$queryRawUnsafe<Array<Record<string, unknown>>>(`
    SELECT t.typname AS enum_name, e.enumlabel AS enum_value
    FROM pg_type t JOIN pg_enum e ON e.enumtypid = t.oid JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE n.nspname = 'pravia_os' AND (t.typname LIKE 'Compliance%'
      OR t.typname = 'ExpedienteDocumentoRole' OR t.typname = 'CatalogoArtefactoPurpose')
    ORDER BY t.typname, e.enumsortorder
  `);
  return { value: canonicalDatabaseFingerprint({ columns, constraints, indexes, enums }), counts: { columns: columns.length, constraints: constraints.length, indexes: indexes.length, enums: enums.length } };
}

describe(`H6 PostgreSQL ${target.target}`, () => {
  afterAll(async () => db.$disconnect());

  it('has the complete 52-migration bootstrap including one H6 migration', async () => {
    const rows = await db.$queryRawUnsafe<Array<{ total: bigint; h6: bigint }>>(`
      SELECT count(*)::bigint total,
        count(*) FILTER (WHERE migration_name = '20260905010000_create_h6_signature_notices')::bigint h6
      FROM pravia_os._prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL
    `);
    expect(Number(rows[0].total)).toBe(52);
    expect(Number(rows[0].h6)).toBe(1);
  });

  it('has the physical H6 trigger lineage and signable-purpose authority', async () => {
    const constraints = await db.$queryRawUnsafe<Array<{ conname: string }>>(`
      SELECT conname FROM pg_constraint WHERE connamespace = 'pravia_os'::regnamespace
        AND conname IN ('h6_obligation_trigger_review_fkey','h6_obligation_trigger_result_fkey',
          'h6_obligation_trigger_revision_fkey','h6_obligation_trigger_act_fkey') ORDER BY conname
    `);
    expect(constraints.map((item) => item.conname)).toEqual([
      'h6_obligation_trigger_act_fkey', 'h6_obligation_trigger_result_fkey',
      'h6_obligation_trigger_review_fkey', 'h6_obligation_trigger_revision_fkey',
    ]);
    const enumRows = await db.$queryRawUnsafe<Array<{ enumlabel: string }>>(`
      SELECT e.enumlabel FROM pg_enum e JOIN pg_type t ON t.oid=e.enumtypid
      JOIN pg_namespace n ON n.oid=t.typnamespace
      WHERE n.nspname='pravia_os' AND t.typname='CatalogoArtefactoPurpose' AND e.enumlabel='FIR_SIGNATURE_RELEVANT'
    `);
    expect(enumRows).toEqual([{ enumlabel: 'FIR_SIGNATURE_RELEVANT' }]);
  });

  it('reproduces the canonical logical fingerprint independently of physical column order', async () => {
    const result = await fingerprint();
    expect(H6_DB_FINGERPRINT_ALGORITHM).toBe('h6-schema-logical-v1');
    expect(result.counts).toEqual({ columns: 186, constraints: 61, indexes: 89, enums: 170 });
    expect(result.value).toBe('cea7ac3254c9c4b693ea21a6ea86ce179092027a876e11dfe197b36fab26d820');
  });

  it.runIf(target.target === 'B')('materializes deterministic legacy A/B and preserves C/D without loss', async () => {
    const rows = await db.$queryRawUnsafe<Array<{ id: string; h6_migration_status: string; presentations: bigint; acknowledgements: bigint }>>(`
      SELECT o.id::text, o.h6_migration_status,
        count(DISTINCT p.id)::bigint presentations, count(DISTINCT a.id)::bigint acknowledgements
      FROM pravia_os.compliance_obligations o
      LEFT JOIN pravia_os.compliance_notice_presentations p ON p.obligation_id=o.id
      LEFT JOIN pravia_os.compliance_notice_acknowledgements a ON a.presentation_id=p.id
      WHERE o.id::text IN ('a0000000-0000-4000-8000-000000000001','b0000000-0000-4000-8000-000000000002',
        'c0000000-0000-4000-8000-000000000003','d0000000-0000-4000-8000-000000000004')
      GROUP BY o.id,o.h6_migration_status ORDER BY o.id
    `);
    expect(rows.map((row) => ({ ...row, presentations: Number(row.presentations), acknowledgements: Number(row.acknowledgements) }))).toEqual([
      { id: 'a0000000-0000-4000-8000-000000000001', h6_migration_status: 'A_PRESENTATION_ACK_READY', presentations: 1, acknowledgements: 1 },
      { id: 'b0000000-0000-4000-8000-000000000002', h6_migration_status: 'B_PRESENTATION_READY', presentations: 1, acknowledgements: 0 },
      { id: 'c0000000-0000-4000-8000-000000000003', h6_migration_status: 'C_AMBIGUOUS_INCOMPLETE', presentations: 0, acknowledgements: 0 },
      { id: 'd0000000-0000-4000-8000-000000000004', h6_migration_status: 'D_HISTORICAL_ONLY_INCOMPATIBLE', presentations: 0, acknowledgements: 0 },
    ]);
  });
});
