import { afterAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { canonicalDatabaseFingerprint } from '../domain/complianceH6';

function isolatedTarget() {
  const raw = process.env.DATABASE_URL || '';
  const url = new URL(raw);
  if (
    process.env.NODE_ENV !== 'test'
    || process.env.H10_PG_TEST_CONFIRMATION !== 'RUN_ISOLATED_H10_POSTGRESQL'
    || raw !== process.env.DIRECT_URL
    || url.hostname !== '127.0.0.1'
    || !['55474', '55475', '55476'].includes(url.port)
    || !/^\/pravia_h10_[abc]$/.test(url.pathname)
  ) throw new Error('H10 PostgreSQL requires the explicit isolated local A/B/C target.');
  return { url: raw, target: ({ '55474': 'A', '55475': 'B', '55476': 'C' } as const)[url.port as '55474'] };
}

const target = isolatedTarget();
const db = new PrismaClient({ datasources: { db: { url: target.url } } });
const expectedFingerprint = '60917aa17ecd859ce401d71a3ccc59d5de5dd6a6d57ff02f00f200660d180d58';

async function fingerprint() {
  const columns = await db.$queryRawUnsafe<Array<Record<string, unknown>>>(`
    SELECT table_name, column_name, data_type, udt_name, is_nullable, column_default
    FROM information_schema.columns WHERE table_schema='pravia_os' ORDER BY table_name,column_name`);
  const constraints = await db.$queryRawUnsafe<Array<Record<string, unknown>>>(`
    SELECT t.relname table_name,c.conname name,c.contype type,pg_get_constraintdef(c.oid,true) definition
    FROM pg_constraint c JOIN pg_namespace n ON n.oid=c.connamespace JOIN pg_class t ON t.oid=c.conrelid
    WHERE n.nspname='pravia_os' AND c.contype<>'u' ORDER BY t.relname,c.conname`);
  const indexes = await db.$queryRawUnsafe<Array<Record<string, unknown>>>(`
    SELECT tablename,indexname,indexdef FROM pg_indexes WHERE schemaname='pravia_os' ORDER BY tablename,indexname`);
  const enums = await db.$queryRawUnsafe<Array<Record<string, unknown>>>(`
    SELECT t.typname enum_name,e.enumlabel enum_value,e.enumsortorder::text enum_order
    FROM pg_type t JOIN pg_enum e ON e.enumtypid=t.oid JOIN pg_namespace n ON n.oid=t.typnamespace
    WHERE n.nspname='pravia_os' ORDER BY t.typname,e.enumsortorder`);
  const functions = await db.$queryRawUnsafe<Array<Record<string, unknown>>>(`
    SELECT p.proname function_name,pg_get_function_identity_arguments(p.oid) arguments,pg_get_functiondef(p.oid) definition
    FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='pravia_os'
    ORDER BY p.proname,pg_get_function_identity_arguments(p.oid)`);
  const triggers = await db.$queryRawUnsafe<Array<Record<string, unknown>>>(`
    SELECT t.relname table_name,g.tgname trigger_name,pg_get_triggerdef(g.oid,true) definition
    FROM pg_trigger g JOIN pg_class t ON t.oid=g.tgrelid JOIN pg_namespace n ON n.oid=t.relnamespace
    WHERE n.nspname='pravia_os' AND NOT g.tgisinternal ORDER BY t.relname,g.tgname`);
  return { value: canonicalDatabaseFingerprint({ columns, constraints, indexes, enums, functions, triggers }), counts: { columns: columns.length, constraints: constraints.length, indexes: indexes.length, enums: enums.length, functions: functions.length, triggers: triggers.length } };
}

describe(`H10 global PostgreSQL certification DB ${target.target}`, () => {
  afterAll(async () => db.$disconnect());

  it('has the exact 55-migration chain through the single H10 correction', async () => {
    const rows = await db.$queryRawUnsafe<Array<{ total: bigint; h1_h9: bigint; h10: bigint }>>(`
      SELECT count(*)::bigint total,
        count(*) FILTER (WHERE migration_name IN (
          '20260831050000_create_h1_compliance_legal_engine','20260901010000_create_h2_compliance_document_evidence',
          '20260901020000_create_h3_compliance_screening','20260902010000_create_h4_beneficial_controller',
          '20260903010000_create_h5_questionnaires_payments_provider','20260905010000_create_h6_signature_notices',
          '20260905020000_create_h7_compliance_closure','20260905030000_create_h9_assisted_compliance_review'))::bigint h1_h9,
        count(*) FILTER (WHERE migration_name='20260905040000_add_h10_compliance_fk_indexes')::bigint h10
      FROM pravia_os._prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL`);
    expect({ total: Number(rows[0].total), h1_h9: Number(rows[0].h1_h9), h10: Number(rows[0].h10) }).toEqual({ total: 55, h1_h9: 8, h10: 1 });
  });

  it('matches the independently rebuilt canonical global schema fingerprint', async () => {
    const result = await fingerprint();
    expect(result.counts).toEqual({ columns: 2777, constraints: 879, indexes: 1057, enums: 588, functions: 97, triggers: 346 });
    expect(result.value).toBe(expectedFingerprint);
  });

  it('has no unindexed foreign key after H10 parity remediation', async () => {
    const rows = await db.$queryRawUnsafe<Array<{ count: bigint }>>(`
      SELECT count(*)::bigint count FROM pg_constraint c
      JOIN pg_namespace n ON n.oid=c.connamespace
      WHERE c.contype='f' AND n.nspname='pravia_os' AND NOT EXISTS (
        SELECT 1 FROM pg_index i WHERE i.indrelid=c.conrelid AND i.indisvalid AND i.indisready
          AND c.conkey <@ i.indkey::smallint[])`);
    expect(Number(rows[0].count)).toBe(0);
  });

  it('keeps exactly six general states and eight AVI states with freshness separate', async () => {
    const rows = await db.$queryRawUnsafe<Array<{ enum_name: string; values: string[] }>>(`
      SELECT t.typname enum_name,array_agg(e.enumlabel ORDER BY e.enumsortorder) values
      FROM pg_type t JOIN pg_enum e ON e.enumtypid=t.oid JOIN pg_namespace n ON n.oid=t.typnamespace
      WHERE n.nspname='pravia_os' AND t.typname IN ('ComplianceGeneralState','ComplianceAviState','ComplianceFreshness')
      GROUP BY t.typname ORDER BY t.typname`);
    expect(Object.fromEntries(rows.map((row) => [row.enum_name, row.values]))).toEqual({
      ComplianceAviState: ['NO_APLICA','PENDIENTE','INFORMACION_INCOMPLETA','VALIDADO','LISTO_PARA_PRESENTAR','PRESENTADO','ACUSE_CARGADO','CUMPLIDO'],
      ComplianceFreshness: ['CURRENT','STALE'],
      ComplianceGeneralState: ['NO_APLICA','PENDIENTE','EN_PROCESO','LISTO','CUMPLIMIENTO_COMPLETO','VENCIDO'],
    });
  });

  it('keeps H9 completed history append-only and tenant-linked', async () => {
    const rows = await db.$queryRawUnsafe<Array<{ trigger_name: string }>>(`
      SELECT tgname trigger_name FROM pg_trigger
      WHERE tgrelid='pravia_os.compliance_assisted_reviews'::regclass AND NOT tgisinternal ORDER BY tgname`);
    expect(rows.map((row) => row.trigger_name)).toEqual(expect.arrayContaining(['h9_assisted_review_append_only']));
    const fks = await db.$queryRawUnsafe<Array<{ conname: string }>>(`
      SELECT conname FROM pg_constraint WHERE conrelid='pravia_os.compliance_assisted_reviews'::regclass AND contype='f' ORDER BY conname`);
    expect(fks.map((row) => row.conname)).toEqual(expect.arrayContaining(['h9_assisted_review_actor_fkey','h9_assisted_review_context_fkey']));
  });

  it.runIf(target.target === 'B')('preserves representative legacy data, checksum and deterministic A/B/C/D cutover', async () => {
    const rows = await db.$queryRawUnsafe<Array<{ id: string; h6_migration_status: string; presentations: bigint; acknowledgements: bigint }>>(`
      SELECT o.id::text,o.h6_migration_status,count(DISTINCT p.id)::bigint presentations,count(DISTINCT a.id)::bigint acknowledgements
      FROM pravia_os.compliance_obligations o LEFT JOIN pravia_os.compliance_notice_presentations p ON p.obligation_id=o.id
      LEFT JOIN pravia_os.compliance_notice_acknowledgements a ON a.presentation_id=p.id
      WHERE o.id::text IN ('a0000000-0000-4000-8000-000000000001','b0000000-0000-4000-8000-000000000002','c0000000-0000-4000-8000-000000000003','d0000000-0000-4000-8000-000000000004')
      GROUP BY o.id,o.h6_migration_status ORDER BY o.id`);
    expect(rows.map((row) => ({ ...row, presentations: Number(row.presentations), acknowledgements: Number(row.acknowledgements) }))).toEqual([
      { id: 'a0000000-0000-4000-8000-000000000001', h6_migration_status: 'A_PRESENTATION_ACK_READY', presentations: 1, acknowledgements: 1 },
      { id: 'b0000000-0000-4000-8000-000000000002', h6_migration_status: 'B_PRESENTATION_READY', presentations: 1, acknowledgements: 0 },
      { id: 'c0000000-0000-4000-8000-000000000003', h6_migration_status: 'C_AMBIGUOUS_INCOMPLETE', presentations: 0, acknowledgements: 0 },
      { id: 'd0000000-0000-4000-8000-000000000004', h6_migration_status: 'D_HISTORICAL_ONLY_INCOMPATIBLE', presentations: 0, acknowledgements: 0 },
    ]);
    const preserved = await db.$queryRawUnsafe<Array<{ documents: bigint; evidence: bigint; payments: bigint; checksum_ok: boolean }>>(`
      SELECT (SELECT count(*) FROM pravia_os.documentos WHERE id='a1000000-0000-4000-8000-000000000010')::bigint documents,
        (SELECT count(*) FROM pravia_os.compliance_evidence WHERE id='a1000000-0000-4000-8000-000000000011')::bigint evidence,
        (SELECT count(*) FROM pravia_os.compliance_payments WHERE id='a1000000-0000-4000-8000-000000000012')::bigint payments,
        EXISTS(SELECT 1 FROM pravia_os.documentos d JOIN pravia_os.compliance_evidence e ON e.documento_id=d.id
          WHERE d.id='a1000000-0000-4000-8000-000000000010' AND d.checksum_sha256=repeat('a',64)
            AND e.document_checksum_snapshot=d.checksum_sha256) checksum_ok`);
    expect({ documents: Number(preserved[0].documents), evidence: Number(preserved[0].evidence), payments: Number(preserved[0].payments), checksum_ok: preserved[0].checksum_ok }).toEqual({ documents: 1, evidence: 1, payments: 1, checksum_ok: true });
  });
});
