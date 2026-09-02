import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';

const expectedH1ForeignKeys = [
  'compliance_alert_exp_fkey',
  'compliance_alert_lead_actor_fkey',
  'compliance_alert_lead_org_fkey',
  'compliance_alert_lead_revision_fkey',
  'compliance_alert_org_fkey',
  'compliance_alert_requirement_fkey',
  'compliance_alert_resolver_fkey',
  'compliance_alert_responsible_fkey',
  'compliance_alert_review_fkey',
  'compliance_alert_revision_fkey',
  'compliance_alert_state_fkey',
  'compliance_legal_rules_actor_fkey',
  'compliance_legal_rules_org_fkey',
  'compliance_obligation_lineage_fkey',
  'compliance_obligation_revision_fkey',
  'compliance_requirement_exp_fkey',
  'compliance_requirement_org_fkey',
  'compliance_requirement_result_fkey',
  'compliance_requirement_review_fkey',
  'compliance_requirement_state_fkey',
  'compliance_rule_result_org_fkey',
  'compliance_rule_result_review_fkey',
  'compliance_rule_result_revision_fkey',
  'compliance_rule_revision_activator_fkey',
  'compliance_rule_revision_actor_fkey',
  'compliance_rule_revision_org_fkey',
  'compliance_rule_revision_rule_fkey',
  'compliance_rule_revision_supersedes_fkey',
  'compliance_rule_revision_verifier_fkey',
  'exp_compliance_state_actor_fkey',
  'exp_compliance_state_current_review_fkey',
  'exp_compliance_state_exp_fkey',
  'exp_compliance_state_org_fkey',
] as const;

function isolatedDatabaseUrl() {
  if (process.env.NODE_ENV !== 'test') throw new Error('H1 PostgreSQL tests require NODE_ENV=test.');
  if (process.env.H1_PG_TEST_CONFIRMATION !== 'RUN_ISOLATED_H1_POSTGRESQL') {
    throw new Error('H1_PG_TEST_CONFIRMATION=RUN_ISOLATED_H1_POSTGRESQL is required.');
  }
  const raw = process.env.H1_TEST_DATABASE_URL || '';
  const url = new URL(raw);
  if (!['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)) {
    throw new Error('H1 PostgreSQL tests only accept a localhost database.');
  }
  if (!url.pathname.slice(1).startsWith('pravia_h1_')) {
    throw new Error('H1 PostgreSQL tests require an isolated pravia_h1_* database.');
  }
  url.searchParams.set('schema', 'pravia_os');
  return url.toString();
}

const ids = {
  orgA: randomUUID(),
  orgB: randomUUID(),
  userA: randomUUID(),
  userB: randomUUID(),
  memberA: randomUUID(),
  memberB: randomUUID(),
  expedienteA: randomUUID(),
  expedienteB: randomUUID(),
  tipoActoA: randomUUID(),
  tipoActoB: randomUUID(),
  actoA: randomUUID(),
  actoB: randomUUID(),
  reviewA: randomUUID(),
  reviewB: randomUUID(),
  reviewLineageB: randomUUID(),
  ruleA: randomUUID(),
  ruleB: randomUUID(),
  ruleTenantB: randomUUID(),
  revisionA: randomUUID(),
  revisionB: randomUUID(),
  revisionLineageB: randomUUID(),
  resultA: randomUUID(),
  resultActB: randomUUID(),
  resultB: randomUUID(),
  resultLineageB: randomUUID(),
  obligationA: randomUUID(),
  obligationB: randomUUID(),
  obligationActB: randomUUID(),
  legacyObligation: randomUUID(),
};

const prisma = new PrismaClient({ datasources: { db: { url: isolatedDatabaseUrl() } } });

async function execute(sql: string) {
  return prisma.$executeRawUnsafe(sql);
}

function obligationInsert({
  reviewId,
  resultId,
  revisionId,
  suffix,
}: {
  reviewId: string | null;
  resultId: string | null;
  revisionId: string | null;
  suffix: string;
}) {
  const literal = (value: string | null) => value === null ? 'NULL' : `'${value}'`;
  return `
    INSERT INTO pravia_os.compliance_obligations
      (id,organization_id,review_id,type,legal_basis,rule_version,rule_status,origin_date,channel,status,checklist,snapshot,created_at,updated_at,rule_result_id,rule_revision_id,obligation_key,idempotency_key)
    VALUES
      ('${randomUUID()}','${ids.orgA}',${literal(reviewId)},'H1_LINEAGE_${suffix}_${randomUUID()}','Synthetic','test','DRAFT',now(),'TEST','PENDING','[]','{}',now(),now(),${literal(resultId)},${literal(revisionId)},'lineage-${suffix}-${randomUUID()}','${randomUUID()}')
  `;
}

describe('H1 PostgreSQL tenant-integrity regression', () => {
  beforeAll(async () => {
    const fixtureStatements = [
      `INSERT INTO pravia_os.organizations (id,name,status,created_at,updated_at) VALUES
        ('${ids.orgA}','H1 Test A','ACTIVE',now(),now()),
        ('${ids.orgB}','H1 Test B','ACTIVE',now(),now())`,
      `INSERT INTO pravia_os.users (id,email,password_hash,nombre,apellido,rol,activo,created_at,updated_at,requires_password_change) VALUES
        ('${ids.userA}','${ids.userA}@example.invalid','synthetic','H1','A','ADMINISTRACION',true,now(),now(),false),
        ('${ids.userB}','${ids.userB}@example.invalid','synthetic','H1','B','ADMINISTRACION',true,now(),now(),false)`,
      `INSERT INTO pravia_os.organization_memberships (id,organization_id,user_id,rol,status,created_at,updated_at) VALUES
        ('${ids.memberA}','${ids.orgA}','${ids.userA}','ADMINISTRACION','ACTIVE',now(),now()),
        ('${ids.memberB}','${ids.orgB}','${ids.userB}','ADMINISTRACION','ACTIVE',now(),now())`,
      `INSERT INTO pravia_os.tipos_acto (id,organization_id,nombre,activo,created_at,updated_at) VALUES
        ('${ids.tipoActoA}','${ids.orgA}','H1 synthetic act type A',true,now(),now()),
        ('${ids.tipoActoB}','${ids.orgB}','H1 synthetic act type B',true,now(),now())`,
      `INSERT INTO pravia_os.expedientes
        (id,organization_id,numero_pravia,abogado_id,creador_id,fecha_apertura,estatus,avance_documental,avance_financiero,avance_general,avance_operativo,created_at,updated_at,version)
      VALUES
        ('${ids.expedienteA}','${ids.orgA}','EXP-H1-${ids.expedienteA}', '${ids.userA}','${ids.userA}',now(),'ABIERTO',0,0,0,0,now(),now(),1),
        ('${ids.expedienteB}','${ids.orgB}','EXP-H1-${ids.expedienteB}', '${ids.userB}','${ids.userB}',now(),'ABIERTO',0,0,0,0,now(),now(),1)`,
      `INSERT INTO pravia_os.expediente_actos
        (id,organization_id,expediente_id,tipo_acto_id,origen,estatus,created_by,created_at,updated_at)
      VALUES
        ('${ids.actoA}','${ids.orgA}','${ids.expedienteA}','${ids.tipoActoA}','ADICIONAL','ACTIVO','${ids.userA}',now(),now()),
        ('${ids.actoB}','${ids.orgA}','${ids.expedienteA}','${ids.tipoActoA}','ADICIONAL','ACTIVO','${ids.userA}',now(),now())`,
      `INSERT INTO pravia_os.compliance_reviews
        (id,organization_id,expediente_id,tipo,estatus,rule_version_snapshot,cuestionario_json,rule_snapshot,master_snapshot,snapshot_captured_at,creado_por_id,created_at,updated_at,engine_version,idempotency_key,is_canonical_legal_engine)
      VALUES
        ('${ids.reviewA}','${ids.orgA}','${ids.expedienteA}','H1_TEST','EVALUACION_DETERMINISTA','test','{}','{}','{}',now(),'${ids.userA}',now(),now(),'h1-test','${ids.reviewA}',true),
        ('${ids.reviewB}','${ids.orgB}','${ids.expedienteB}','H1_TEST','EVALUACION_DETERMINISTA','test','{}','{}','{}',now(),'${ids.userB}',now(),now(),'h1-test','${ids.reviewB}',true),
        ('${ids.reviewLineageB}','${ids.orgA}','${ids.expedienteA}','H1_TEST_LINEAGE_B','EVALUACION_DETERMINISTA','test','{}','{}','{}',now(),'${ids.userA}',now(),now(),'h1-test','${ids.reviewLineageB}',true)`,
      `INSERT INTO pravia_os.compliance_legal_rules
        (id,organization_id,stable_key,family,name,created_by_id,created_at,updated_at)
      VALUES
        ('${ids.ruleA}','${ids.orgA}','${ids.ruleA}','CUM_MAT_001','H1 Test Rule A','${ids.userA}',now(),now()),
        ('${ids.ruleB}','${ids.orgA}','${ids.ruleB}','CUM_MAT_002','H1 Test Rule B','${ids.userA}',now(),now()),
        ('${ids.ruleTenantB}','${ids.orgB}','${ids.ruleTenantB}','CUM_MAT_001','H1 Test Rule Tenant B','${ids.userB}',now(),now())`,
      `INSERT INTO pravia_os.compliance_legal_rule_revisions
        (id,organization_id,rule_id,version,status,effective_from,conditions,outcome,legal_basis,checksum,created_by_id,created_at)
      VALUES
        ('${ids.revisionA}','${ids.orgA}','${ids.ruleA}',1,'DRAFT',now(),'{}','{}','Synthetic test only','${ids.revisionA}','${ids.userA}',now()),
        ('${ids.revisionB}','${ids.orgB}','${ids.ruleTenantB}',1,'DRAFT',now(),'{}','{}','Synthetic test only','${ids.revisionB}','${ids.userB}',now()),
        ('${ids.revisionLineageB}','${ids.orgA}','${ids.ruleB}',1,'DRAFT',now(),'{}','{}','Synthetic lineage test only','${ids.revisionLineageB}','${ids.userA}',now())`,
      `INSERT INTO pravia_os.compliance_rule_results
        (id,organization_id,review_id,rule_revision_id,expediente_acto_id,applicability,missing_paths,result_snapshot,legal_basis_snapshot,created_at)
      VALUES
        ('${ids.resultA}','${ids.orgA}','${ids.reviewA}','${ids.revisionA}','${ids.actoA}','NO_APLICA','[]','{}','{}',now()),
        ('${ids.resultActB}','${ids.orgA}','${ids.reviewA}','${ids.revisionA}','${ids.actoB}','NO_APLICA','[]','{}','{}',now()),
        ('${ids.resultB}','${ids.orgB}','${ids.reviewB}','${ids.revisionB}',NULL,'NO_APLICA','[]','{}','{}',now()),
        ('${ids.resultLineageB}','${ids.orgA}','${ids.reviewLineageB}','${ids.revisionA}',NULL,'NO_APLICA','[]','{}','{}',now())`,
      `INSERT INTO pravia_os.compliance_obligations
        (id,organization_id,review_id,type,legal_basis,rule_version,rule_status,origin_date,channel,status,checklist,snapshot,created_at,updated_at,rule_result_id,rule_revision_id,obligation_key,idempotency_key)
      VALUES
        ('${ids.obligationA}','${ids.orgA}','${ids.reviewA}','H1_TEST_A','Synthetic','test','DRAFT',now(),'TEST','PENDING','[]','{}',now(),now(),'${ids.resultA}','${ids.revisionA}','obligation-a','${ids.obligationA}'),
        ('${ids.obligationB}','${ids.orgA}','${ids.reviewA}','H1_TEST_B','Synthetic','test','DRAFT',now(),'TEST','PENDING','[]','{}',now(),now(),'${ids.resultA}','${ids.revisionA}','obligation-b','${ids.obligationB}')`,
    ];
    for (const statement of fixtureStatements) await execute(statement);
  });

  afterAll(async () => {
    const cleanupStatements = [
      `DELETE FROM pravia_os.expediente_compliance_states WHERE organization_id IN ('${ids.orgA}','${ids.orgB}')`,
      `DELETE FROM pravia_os.compliance_obligations WHERE id='${ids.legacyObligation}'`,
      `DELETE FROM pravia_os.compliance_obligations WHERE organization_id IN ('${ids.orgA}','${ids.orgB}')`,
      `DELETE FROM pravia_os.compliance_rule_results WHERE organization_id IN ('${ids.orgA}','${ids.orgB}')`,
      `DELETE FROM pravia_os.compliance_legal_rule_revisions WHERE organization_id IN ('${ids.orgA}','${ids.orgB}')`,
      `DELETE FROM pravia_os.compliance_legal_rules WHERE organization_id IN ('${ids.orgA}','${ids.orgB}')`,
      `DELETE FROM pravia_os.compliance_reviews WHERE organization_id IN ('${ids.orgA}','${ids.orgB}')`,
      `DELETE FROM pravia_os.expediente_actos WHERE organization_id IN ('${ids.orgA}','${ids.orgB}')`,
      `DELETE FROM pravia_os.expedientes WHERE organization_id IN ('${ids.orgA}','${ids.orgB}')`,
      `DELETE FROM pravia_os.tipos_acto WHERE id IN ('${ids.tipoActoA}','${ids.tipoActoB}')`,
      `DELETE FROM pravia_os.organization_memberships WHERE organization_id IN ('${ids.orgA}','${ids.orgB}')`,
      `DELETE FROM pravia_os.users WHERE id IN ('${ids.userA}','${ids.userB}')`,
      `DELETE FROM pravia_os.organizations WHERE id IN ('${ids.orgA}','${ids.orgB}')`,
    ];
    for (const statement of cleanupStatements) await execute(statement).catch(() => undefined);
    await prisma.$disconnect();
  });

  it('contains every H1 foreign key with the approved physical name', async () => {
    const rows = await prisma.$queryRawUnsafe<Array<{ conname: string }>>(`
      SELECT conname
      FROM pg_constraint c
      JOIN pg_namespace n ON n.oid = c.connamespace
      WHERE n.nspname = 'pravia_os' AND c.contype = 'f'
        AND conname = ANY (ARRAY[${expectedH1ForeignKeys.map((name) => `'${name}'`).join(',')}])
      ORDER BY conname
    `);
    expect(rows.map(({ conname }) => conname)).toEqual([...expectedH1ForeignKeys].sort());
  });

  it('binds obligation result, tenant, review, and revision to one parent lineage key', async () => {
    const rows = await prisma.$queryRawUnsafe<Array<{
      conname: string;
      child_columns: string[];
      parent_table: string;
      parent_columns: string[];
    }>>(`
      SELECT c.conname,
        ARRAY(SELECT a.attname FROM unnest(c.conkey) WITH ORDINALITY AS k(attnum, ord)
          JOIN pg_attribute a ON a.attrelid=c.conrelid AND a.attnum=k.attnum ORDER BY k.ord) AS child_columns,
        format('%I.%I', pn.nspname, p.relname) AS parent_table,
        ARRAY(SELECT a.attname FROM unnest(c.confkey) WITH ORDINALITY AS k(attnum, ord)
          JOIN pg_attribute a ON a.attrelid=c.confrelid AND a.attnum=k.attnum ORDER BY k.ord) AS parent_columns
      FROM pg_constraint c
      JOIN pg_class p ON p.oid=c.confrelid
      JOIN pg_namespace pn ON pn.oid=p.relnamespace
      WHERE c.conrelid='pravia_os.compliance_obligations'::regclass
        AND c.conname='compliance_obligation_lineage_fkey'
    `);
    expect(rows).toEqual([{
      conname: 'compliance_obligation_lineage_fkey',
      child_columns: ['rule_result_id', 'organization_id', 'review_id', 'rule_revision_id'],
      parent_table: 'pravia_os.compliance_rule_results',
      parent_columns: ['id', 'organization_id', 'review_id', 'rule_revision_id'],
    }]);
  });

  it('accepts a same-organization legal-rule actor', async () => {
    const rows = await prisma.$queryRawUnsafe<Array<{ count: bigint }>>(
      `SELECT count(*)::bigint AS count FROM pravia_os.compliance_legal_rules WHERE id='${ids.ruleA}'`,
    );
    expect(Number(rows[0].count)).toBe(1);
  });

  it('blocks a cross-organization legal-rule actor', async () => {
    await expect(execute(`
      INSERT INTO pravia_os.compliance_legal_rules
        (id,organization_id,stable_key,family,name,created_by_id,created_at,updated_at)
      VALUES ('${randomUUID()}','${ids.orgA}','${randomUUID()}','CUM_MAT_007','Cross tenant','${ids.userB}',now(),now())
    `)).rejects.toThrow();
  });

  it('allows exactly one current compliance state under concurrent writers', async () => {
    const insert = (id: string) => execute(`
      INSERT INTO pravia_os.expediente_compliance_states
        (id,organization_id,expediente_id,current_review_id,state,pending_count,version,updated_by_id,created_at,updated_at)
      VALUES ('${id}','${ids.orgA}','${ids.expedienteA}','${ids.reviewA}','PENDIENTE',0,1,'${ids.userA}',now(),now())
    `);
    const results = await Promise.allSettled([insert(randomUUID()), insert(randomUUID())]);
    expect(results.filter(({ status }) => status === 'fulfilled')).toHaveLength(1);
    const rows = await prisma.$queryRawUnsafe<Array<{ count: bigint }>>(
      `SELECT count(*)::bigint AS count FROM pravia_os.expediente_compliance_states WHERE expediente_id='${ids.expedienteA}'`,
    );
    expect(Number(rows[0].count)).toBe(1);
  });

  it('blocks a revision that references a rule from another tenant', async () => {
    await expect(execute(`
      INSERT INTO pravia_os.compliance_legal_rule_revisions
        (id,organization_id,rule_id,version,status,effective_from,conditions,outcome,legal_basis,checksum,created_by_id,created_at)
      VALUES ('${randomUUID()}','${ids.orgB}','${ids.ruleA}',99,'DRAFT',now(),'{}','{}','Synthetic','cross-${randomUUID()}','${ids.userB}',now())
    `)).rejects.toThrow();
  });

  it('accepts same-organization obligations with tenant-safe result and revision sources', async () => {
    const rows = await prisma.$queryRawUnsafe<Array<{ count: bigint }>>(
      `SELECT count(*)::bigint AS count FROM pravia_os.compliance_obligations WHERE review_id='${ids.reviewA}' AND rule_result_id='${ids.resultA}' AND rule_revision_id='${ids.revisionA}'`,
    );
    expect(Number(rows[0].count)).toBe(2);
  });

  it('blocks same-tenant result/revision, result/review, and combined lineage contradictions', async () => {
    await expect(execute(obligationInsert({
      reviewId: ids.reviewA,
      resultId: ids.resultA,
      revisionId: ids.revisionLineageB,
      suffix: 'WRONG_REVISION',
    }))).rejects.toThrow(/compliance_obligation_lineage_fkey/);
    await expect(execute(obligationInsert({
      reviewId: ids.reviewA,
      resultId: ids.resultLineageB,
      revisionId: ids.revisionA,
      suffix: 'WRONG_REVIEW',
    }))).rejects.toThrow(/compliance_obligation_lineage_fkey/);
    await expect(execute(obligationInsert({
      reviewId: ids.reviewLineageB,
      resultId: ids.resultA,
      revisionId: ids.revisionLineageB,
      suffix: 'WRONG_BOTH',
    }))).rejects.toThrow(/compliance_obligation_lineage_fkey/);
  });

  it('blocks MATCH SIMPLE lineage bypasses through nullable H1 fields', async () => {
    await expect(execute(obligationInsert({
      reviewId: ids.reviewA,
      resultId: ids.resultA,
      revisionId: null,
      suffix: 'NULL_REVISION',
    }))).rejects.toThrow(/ck_compliance_obligation_h1_lineage_required/);
    await expect(execute(obligationInsert({
      reviewId: null,
      resultId: ids.resultA,
      revisionId: ids.revisionA,
      suffix: 'NULL_REVIEW',
    }))).rejects.toThrow(/23502|failing row/i);
  });

  it('allows independent obligations for two act results under the same rule revision and key', async () => {
    await execute(`
      INSERT INTO pravia_os.compliance_obligations
        (id,organization_id,review_id,type,legal_basis,rule_version,rule_status,origin_date,channel,status,checklist,snapshot,created_at,updated_at,rule_result_id,rule_revision_id,obligation_key,idempotency_key)
      VALUES ('${ids.obligationActB}','${ids.orgA}','${ids.reviewA}','H1_TEST_ACT_B','Synthetic','test','DRAFT',now(),'TEST','PENDING','[]','{}',now(),now(),'${ids.resultActB}','${ids.revisionA}','obligation-a','${ids.obligationActB}')
    `);

    const rows = await prisma.$queryRawUnsafe<Array<{
      id: string; rule_result_id: string; rule_revision_id: string; expediente_acto_id: string; obligation_key: string;
      status: string; due_at: Date | null; legal_deadline_source: string | null;
    }>>(`
      SELECT o.id,o.rule_result_id,o.rule_revision_id,r.expediente_acto_id,o.obligation_key,
             o.status,o.due_at,o.legal_deadline_source
      FROM pravia_os.compliance_obligations o
      JOIN pravia_os.compliance_rule_results r ON r.id=o.rule_result_id
      WHERE o.id IN ('${ids.obligationA}','${ids.obligationActB}')
      ORDER BY o.id
    `);
    expect(rows).toHaveLength(2);
    expect(new Set(rows.map(({ rule_result_id }) => rule_result_id)).size).toBe(2);
    expect(new Set(rows.map(({ expediente_acto_id }) => expediente_acto_id)).size).toBe(2);
    expect(new Set(rows.map(({ rule_revision_id }) => rule_revision_id))).toEqual(new Set([ids.revisionA]));
    expect(rows.map(({ obligation_key }) => obligation_key)).toEqual(['obligation-a', 'obligation-a']);
    expect(new Map(rows.map(({ id, rule_result_id }) => [id, rule_result_id]))).toEqual(new Map([
      [ids.obligationA, ids.resultA],
      [ids.obligationActB, ids.resultActB],
    ]));
    expect(rows.every(({ status, due_at, legal_deadline_source }) => status === 'PENDING' && due_at === null && legal_deadline_source === null)).toBe(true);
    const results = await prisma.$queryRawUnsafe<Array<{ count: bigint }>>(`
      SELECT count(*)::bigint AS count FROM pravia_os.compliance_rule_results
      WHERE id IN ('${ids.resultA}','${ids.resultActB}') AND rule_revision_id='${ids.revisionA}'
    `);
    expect(Number(results[0].count)).toBe(2);
  });

  it('keeps identical result retries idempotent under the canonical database key', async () => {
    await expect(execute(`
      INSERT INTO pravia_os.compliance_obligations
        (id,organization_id,review_id,type,legal_basis,rule_version,rule_status,origin_date,channel,status,checklist,snapshot,created_at,updated_at,rule_result_id,rule_revision_id,obligation_key,idempotency_key)
      VALUES ('${randomUUID()}','${ids.orgA}','${ids.reviewA}','H1_TEST_RESULT_RETRY','Synthetic','test','DRAFT',now(),'TEST','PENDING','[]','{}',now(),now(),'${ids.resultActB}','${ids.revisionA}','obligation-a','${randomUUID()}')
    `)).rejects.toThrow(/23505|organization_id, rule_result_id, obligation_key/);
    const rows = await prisma.$queryRawUnsafe<Array<{ count: bigint }>>(`
      SELECT count(*)::bigint AS count FROM pravia_os.compliance_obligations
      WHERE organization_id='${ids.orgA}' AND obligation_key='obligation-a'
    `);
    expect(Number(rows[0].count)).toBe(2);
  });

  it('allows a legacy null-tenant obligation only while every H1-only link is null', async () => {
    await execute(`
      INSERT INTO pravia_os.compliance_obligations
        (id,organization_id,review_id,type,legal_basis,rule_version,rule_status,origin_date,channel,status,checklist,snapshot,created_at,updated_at)
      VALUES ('${ids.legacyObligation}',NULL,'${ids.reviewA}','LEGACY_NULL_H1_TEST','Synthetic legacy','legacy','LEGACY',now(),'TEST','PENDING','[]','{}',now(),now())
    `);
    const rows = await prisma.$queryRawUnsafe<Array<{ count: bigint }>>(
      `SELECT count(*)::bigint AS count FROM pravia_os.compliance_obligations WHERE id='${ids.legacyObligation}' AND organization_id IS NULL AND rule_result_id IS NULL AND rule_revision_id IS NULL`,
    );
    expect(Number(rows[0].count)).toBe(1);
  });

  it('blocks null-tenant H1 result, revision, mixed-tenant insert, and update bypasses at database level', async () => {
    const base = (id: string, result: string, revision: string) => `
      INSERT INTO pravia_os.compliance_obligations
        (id,organization_id,review_id,type,legal_basis,rule_version,rule_status,origin_date,channel,status,checklist,snapshot,created_at,updated_at,rule_result_id,rule_revision_id,obligation_key,idempotency_key)
      VALUES ('${id}',NULL,'${ids.reviewA}','H1_NULL_${id}','Synthetic','test','DRAFT',now(),'TEST','PENDING','[]','{}',now(),now(),${result},${revision},'null-guard-${id}','${id}')
    `;
    await expect(execute(base(randomUUID(), `'${ids.resultA}'`, 'NULL')))
      .rejects.toThrow(/ck_compliance_obligation_h1_(?:tenant|lineage)_required/);
    await expect(execute(base(randomUUID(), 'NULL', `'${ids.revisionA}'`)))
      .rejects.toThrow(/ck_compliance_obligation_h1_tenant_required/);
    await expect(execute(base(randomUUID(), `'${ids.resultB}'`, `'${ids.revisionB}'`)))
      .rejects.toThrow(/ck_compliance_obligation_h1_(?:tenant|lineage)_required/);
    await expect(execute(`
      UPDATE pravia_os.compliance_obligations SET rule_result_id='${ids.resultA}' WHERE id='${ids.legacyObligation}'
    `)).rejects.toThrow(/ck_compliance_obligation_h1_(?:tenant|lineage)_required/);
  });

  it('blocks the same null-tenant H1 create and update bypasses through Prisma', async () => {
    await expect(prisma.complianceObligation.create({ data: {
      organization_id: null,
      review_id: ids.reviewA,
      type: `H1_PRISMA_NULL_${randomUUID()}`,
      legal_basis: 'Synthetic',
      rule_version: 'test',
      rule_status: 'DRAFT',
      origin_date: new Date(),
      channel: 'TEST',
      status: 'PENDING',
      checklist: [],
      snapshot: {},
      rule_result_id: ids.resultA,
      obligation_key: `prisma-null-${randomUUID()}`,
    } })).rejects.toThrow(/ck_compliance_obligation_h1_tenant_required|constraint/i);

    await expect(prisma.complianceObligation.update({
      where: { id: ids.legacyObligation },
      data: { rule_revision_id: ids.revisionA },
    })).rejects.toThrow(/ck_compliance_obligation_h1_tenant_required|constraint/i);
  });

  it('blocks an obligation from referencing a rule result from another tenant at database level', async () => {
    await expect(execute(`
      UPDATE pravia_os.compliance_obligations
      SET rule_result_id='${ids.resultB}'
      WHERE id='${ids.obligationA}'
    `)).rejects.toThrow(/compliance_obligation_lineage_fkey/);
  });

  it('does not allow a used revision to be silently reassigned', async () => {
    await expect(execute(`
      UPDATE pravia_os.compliance_legal_rule_revisions
      SET rule_id='${ids.ruleB}'
      WHERE id='${ids.revisionA}'
    `)).rejects.toThrow(/H1_RULE_REVISION_IMMUTABLE/);
  });

  it('blocks duplicate evaluation and obligation retries by canonical keys', async () => {
    await expect(execute(`
      INSERT INTO pravia_os.compliance_reviews
        (id,organization_id,expediente_id,tipo,estatus,rule_version_snapshot,cuestionario_json,rule_snapshot,master_snapshot,snapshot_captured_at,creado_por_id,created_at,updated_at,engine_version,idempotency_key,is_canonical_legal_engine)
      VALUES ('${randomUUID()}','${ids.orgA}','${ids.expedienteA}','H1_TEST','EVALUACION_DETERMINISTA','test','{}','{}','{}',now(),'${ids.userA}',now(),now(),'h1-test','${ids.reviewA}',true)
    `)).rejects.toThrow();

    await expect(execute(`
      INSERT INTO pravia_os.compliance_obligations
        (id,organization_id,review_id,type,legal_basis,rule_version,rule_status,origin_date,channel,status,checklist,snapshot,created_at,updated_at,rule_result_id,rule_revision_id,obligation_key,idempotency_key)
      VALUES ('${randomUUID()}','${ids.orgA}','${ids.reviewA}','H1_TEST_RETRY','Synthetic','test','DRAFT',now(),'TEST','PENDING','[]','{}',now(),now(),'${ids.resultA}','${ids.revisionA}','obligation-a','${randomUUID()}')
    `)).rejects.toThrow();
  });

  it('retains all nine H1 tenant triggers', async () => {
    const rows = await prisma.$queryRawUnsafe<Array<{ count: bigint }>>(`
      SELECT count(*)::bigint AS count
      FROM pg_trigger t
      JOIN pg_class c ON c.oid=t.tgrelid
      JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname='pravia_os' AND NOT t.tgisinternal AND t.tgname LIKE 'h1_%_tenant'
    `);
    expect(Number(rows[0].count)).toBe(9);
  });
});
