import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';

function isolatedTarget() {
  const raw = process.env.DATABASE_URL || '';
  const url = new URL(raw);
  if (
    process.env.NODE_ENV !== 'test'
    || process.env.H7_PG_TEST_CONFIRMATION !== 'RUN_ISOLATED_H7_POSTGRESQL'
    || raw !== process.env.DIRECT_URL
    || url.hostname !== '127.0.0.1'
    || !['55470', '55471'].includes(url.port)
    || !/^\/pravia_h7_[ab]$/.test(url.pathname)
  ) throw new Error('H7 PostgreSQL requires the explicit isolated local A/B target.');
  return { url: raw, target: url.port === '55470' ? 'A' as const : 'B' as const };
}

const target = isolatedTarget();
const db = new PrismaClient({ datasources: { db: { url: target.url } } });

describe(`H7 PostgreSQL ${target.target}`, () => {
  afterAll(async () => db.$disconnect());

  it('has one H7 migration in the complete 53-migration chain', async () => {
    const rows = await db.$queryRawUnsafe<Array<{ total: bigint; h7: bigint }>>(`
      SELECT count(*)::bigint total,
        count(*) FILTER (WHERE migration_name = '20260905020000_create_h7_compliance_closure')::bigint h7
      FROM pravia_os._prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL
    `);
    expect({ total: Number(rows[0].total), h7: Number(rows[0].h7) }).toEqual({ total: 53, h7: 1 });
  });

  it('physically enforces tenant lineage, append-only current identity and reason semantics', async () => {
    const constraints = await db.$queryRawUnsafe<Array<{ conname: string }>>(`
      SELECT conname FROM pg_constraint WHERE connamespace = 'pravia_os'::regnamespace
        AND conname LIKE 'h7_compliance_exception_%' ORDER BY conname
    `);
    expect(constraints.map((item) => item.conname)).toEqual([
      'h7_compliance_exception_actor_fkey', 'h7_compliance_exception_exp_fkey',
      'h7_compliance_exception_org_fkey', 'h7_compliance_exception_reason_check',
      'h7_compliance_exception_requirement_fkey', 'h7_compliance_exception_resolution_check',
      'h7_compliance_exception_review_fkey', 'h7_compliance_exception_supersedes_fkey',
    ]);
    const indexes = await db.$queryRawUnsafe<Array<{ indexname: string }>>(`
      SELECT indexname FROM pg_indexes WHERE schemaname='pravia_os'
        AND tablename='compliance_requirement_exceptions' ORDER BY indexname
    `);
    expect(indexes.map((item) => item.indexname)).toContain('h7_compliance_exception_one_current_key');
  });

  it('keeps an authorized current exception effective during provider refresh and rejects wrong lineage', async () => {
    const ids = { organization: randomUUID(), user: randomUUID(), membership: randomUUID(), expediente: randomUUID(), review: randomUUID(), otherReview: randomUUID(), state: randomUUID(), requirement: randomUUID(), exception: randomUUID() };
    await db.$executeRawUnsafe(`INSERT INTO pravia_os.organizations (id,name,updated_at) VALUES ('${ids.organization}','H7 synthetic',now())`);
    await db.$executeRawUnsafe(`INSERT INTO pravia_os.users (id,email,password_hash,nombre,apellido,updated_at) VALUES ('${ids.user}','${ids.user}@example.invalid','synthetic','H7','Actor',now())`);
    await db.$executeRawUnsafe(`INSERT INTO pravia_os.organization_memberships (id,organization_id,user_id,rol,updated_at) VALUES ('${ids.membership}','${ids.organization}','${ids.user}','DIRECCION',now())`);
    await db.$executeRawUnsafe(`INSERT INTO pravia_os.expedientes (id,organization_id,numero_pravia,abogado_id,creador_id) VALUES ('${ids.expediente}','${ids.organization}','EXP-H7-${ids.expediente.slice(0, 8)}','${ids.user}','${ids.user}')`);
    for (const reviewId of [ids.review, ids.otherReview]) await db.$executeRawUnsafe(`INSERT INTO pravia_os.compliance_reviews (id,organization_id,expediente_id,tipo,rule_version_snapshot,cuestionario_json,creado_por_id,rule_snapshot,master_snapshot) VALUES ('${reviewId}','${ids.organization}','${ids.expediente}','H7_SYNTHETIC','h7','{}','${ids.user}','{}','{}')`);
    await db.$executeRawUnsafe(`INSERT INTO pravia_os.expediente_compliance_states (id,organization_id,expediente_id,current_review_id,updated_by_id) VALUES ('${ids.state}','${ids.organization}','${ids.expediente}','${ids.review}','${ids.user}')`);
    await db.$executeRawUnsafe(`INSERT INTO pravia_os.compliance_requirements (id,organization_id,expediente_id,state_id,review_id,provider,requirement_key,label,status,source_snapshot) VALUES ('${ids.requirement}','${ids.organization}','${ids.expediente}','${ids.state}','${ids.review}','DOC','DOC:H7:SYNTHETIC','Requisito H7 sintético','PENDIENTE','{}')`);
    await db.$executeRawUnsafe(`INSERT INTO pravia_os.compliance_requirement_exceptions (id,organization_id,expediente_id,review_id,requirement_id,reason,authorization_permission,authorized_by_id,idempotency_key,payload_hash) VALUES ('${ids.exception}','${ids.organization}','${ids.expediente}','${ids.review}','${ids.requirement}','Fundamento humano sintético','compliance.review','${ids.user}','h7-pg-${ids.exception}','${'a'.repeat(64)}')`);
    await db.$executeRawUnsafe(`UPDATE pravia_os.compliance_requirements SET status='EN_PROCESO' WHERE id='${ids.requirement}'`);
    const state = await db.$queryRawUnsafe<Array<{ status: string }>>(`SELECT status::text FROM pravia_os.compliance_requirements WHERE id='${ids.requirement}'`);
    expect(state).toEqual([{ status: 'NO_APLICA' }]);
    await expect(db.$executeRawUnsafe(`INSERT INTO pravia_os.compliance_requirement_exceptions (organization_id,expediente_id,review_id,requirement_id,reason,authorization_permission,authorized_by_id,idempotency_key,payload_hash) VALUES ('${ids.organization}','${ids.expediente}','${ids.otherReview}','${ids.requirement}','Linaje sintético inválido','compliance.review','${ids.user}','h7-wrong-${ids.exception}','${'b'.repeat(64)}')`)).rejects.toBeTruthy();
  });
});
