import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';

function isolatedTarget() {
  const raw = process.env.DATABASE_URL || '';
  const url = new URL(raw);
  if (process.env.NODE_ENV !== 'test' || process.env.H9_PG_TEST_CONFIRMATION !== 'RUN_ISOLATED_H9_POSTGRESQL' || raw !== process.env.DIRECT_URL || url.hostname !== '127.0.0.1' || !['55472', '55473'].includes(url.port) || !/^\/pravia_h9_[ab]$/.test(url.pathname)) throw new Error('H9 PostgreSQL requires the explicit isolated local A/B target.');
  return { url: raw, target: url.port === '55472' ? 'A' as const : 'B' as const };
}
const target = isolatedTarget();
const db = new PrismaClient({ datasources: { db: { url: target.url } } });

describe(`H9 PostgreSQL ${target.target}`, () => {
  afterAll(async () => db.$disconnect());
  it('has exactly one H9 migration in the complete chain', async () => {
    const rows = await db.$queryRawUnsafe<Array<{ total: bigint; h9: bigint }>>(`SELECT count(*)::bigint total, count(*) FILTER (WHERE migration_name='20260905030000_create_h9_assisted_compliance_review')::bigint h9 FROM pravia_os._prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL`);
    expect(Number(rows[0].h9)).toBe(1); expect(Number(rows[0].total)).toBeGreaterThanOrEqual(54);
  });
  it('enforces tenant-aware case, review and actor lineage plus append-only history', async () => {
    const ids = { org: randomUUID(), otherOrg: randomUUID(), user: randomUUID(), otherUser: randomUUID(), membership: randomUUID(), otherMembership: randomUUID(), exp: randomUUID(), otherExp: randomUUID(), review: randomUUID(), otherReview: randomUUID(), assisted: randomUUID() };
    await db.$transaction([
      db.$executeRawUnsafe(`INSERT INTO pravia_os.organizations(id,name,updated_at) VALUES ('${ids.org}','H9 A',now()),('${ids.otherOrg}','H9 B',now())`),
      db.$executeRawUnsafe(`INSERT INTO pravia_os.users(id,email,password_hash,nombre,apellido,updated_at) VALUES ('${ids.user}','${ids.user}@example.invalid','x','H9','Actor',now()),('${ids.otherUser}','${ids.otherUser}@example.invalid','x','Other','Actor',now())`),
      db.$executeRawUnsafe(`INSERT INTO pravia_os.organization_memberships(id,organization_id,user_id,rol,updated_at) VALUES ('${ids.membership}','${ids.org}','${ids.user}','ABOGADO',now()),('${ids.otherMembership}','${ids.otherOrg}','${ids.otherUser}','ABOGADO',now())`),
      db.$executeRawUnsafe(`INSERT INTO pravia_os.expedientes(id,organization_id,numero_pravia,abogado_id,creador_id) VALUES ('${ids.exp}','${ids.org}','EXP-H9-${ids.exp.slice(0,8)}','${ids.user}','${ids.user}'),('${ids.otherExp}','${ids.otherOrg}','EXP-H9-${ids.otherExp.slice(0,8)}','${ids.otherUser}','${ids.otherUser}')`),
      db.$executeRawUnsafe(`INSERT INTO pravia_os.compliance_reviews(id,organization_id,expediente_id,tipo,rule_version_snapshot,cuestionario_json,creado_por_id,rule_snapshot,master_snapshot) VALUES ('${ids.review}','${ids.org}','${ids.exp}','H9_TEST','v1','{}','${ids.user}','{}','{}'),('${ids.otherReview}','${ids.otherOrg}','${ids.otherExp}','H9_TEST','v1','{}','${ids.otherUser}','{}','{}')`),
    ]);
    const insert = (org: string, exp: string, review: string, actor: string, key: string, id = randomUUID()) => db.$executeRawUnsafe(`INSERT INTO pravia_os.compliance_assisted_reviews(id,organization_id,expediente_id,compliance_review_id,executed_by_id,idempotency_key,dataset_snapshot,dataset_fingerprint,source_manifest,provider,model,prompt_version,output_schema_version,result_json,result_checksum,correct_count,observation_count,critical_count) VALUES ('${id}','${org}','${exp}','${review}','${actor}','${key}','{}','${'a'.repeat(64)}','[]','OPENAI','fixture','v1','v1','{"verification_checks":[],"correct_count":0,"observations":[],"critical_inconsistencies":[]}','${'b'.repeat(64)}',0,0,0)`);
    await insert(ids.org, ids.exp, ids.review, ids.user, 'h9-pg-valid', ids.assisted);
    await expect(insert(ids.org, ids.exp, ids.otherReview, ids.user, 'h9-pg-cross-review')).rejects.toBeTruthy();
    await expect(insert(ids.org, ids.exp, ids.review, ids.otherUser, 'h9-pg-cross-actor')).rejects.toBeTruthy();
    await expect(db.$executeRawUnsafe(`UPDATE pravia_os.compliance_assisted_reviews SET correct_count=1 WHERE id='${ids.assisted}'`)).rejects.toBeTruthy();
    await expect(db.$executeRawUnsafe(`DELETE FROM pravia_os.compliance_assisted_reviews WHERE id='${ids.assisted}'`)).rejects.toBeTruthy();
  });
});
