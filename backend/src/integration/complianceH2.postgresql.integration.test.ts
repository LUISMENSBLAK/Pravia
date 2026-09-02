import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';

function isolatedDatabaseUrl() {
  if (process.env.NODE_ENV !== 'test' || process.env.H2_PG_TEST_CONFIRMATION !== 'RUN_ISOLATED_H2_POSTGRESQL') throw new Error('H2 isolated PostgreSQL confirmation is required.');
  const url = new URL(process.env.H2_TEST_DATABASE_URL || '');
  if (!['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) || !url.pathname.slice(1).startsWith('pravia_h2_')) throw new Error('H2 tests only accept a localhost pravia_h2_* database.');
  url.searchParams.set('schema', 'pravia_os');
  return url.toString();
}

const ids = Object.fromEntries([
  'orgA','orgB','userA','userB','memberA','memberB','expA','expA2','expB','reviewA','reviewA2','reviewB','stateA','stateA2','stateB',
  'reqA','reqA2','reqSigned','docA','docA2','docB','legacyEvidence','evidenceA','evidenceA2','evidenceGenerated','evidenceSigned',
].map((key) => [key, randomUUID()])) as Record<string, string>;
const prisma = new PrismaClient({ datasources: { db: { url: isolatedDatabaseUrl() } } });
const execute = (sql: string) => prisma.$executeRawUnsafe(sql);

function evidenceInsert(input: { id: string; org: string | null; exp: string; review: string; req: string; doc: string; version: string; state?: string; validation?: string; source?: string; actor?: string; validator?: string | null }) {
  const organization = input.org ? `'${input.org}'` : 'NULL';
  const validator = input.validator ? `'${input.validator}'` : 'NULL';
  return `INSERT INTO pravia_os.compliance_evidence
    (id,organization_id,review_id,documento_id,tipo_evidencia,agregado_por_id,estatus,created_at,expediente_id,requirement_id,document_version,document_checksum_snapshot,storage_key_snapshot,source,document_state,validation_status,linked_by_system,validated_by_id,validated_at)
    VALUES ('${input.id}',${organization},'${input.review}','${input.doc}','CUM_DOC_TEST','${input.actor || ids.userA}','ACTIVO',now(),'${input.exp}','${input.req}','${input.version}',NULL,'synthetic/${input.doc}.pdf','${input.source || 'EXPEDIENTE'}','${input.state || 'CANONICAL'}','${input.validation || 'PENDING_HUMAN'}',false,${validator},${input.validator ? 'now()' : 'NULL'})`;
}

describe('H2 PostgreSQL tenant, object and version integrity', () => {
  beforeAll(async () => {
    const statements = [
      `INSERT INTO pravia_os.organizations (id,name,status,created_at,updated_at) VALUES ('${ids.orgA}','H2 synthetic A','ACTIVE',now(),now()),('${ids.orgB}','H2 synthetic B','ACTIVE',now(),now())`,
      `INSERT INTO pravia_os.users (id,email,password_hash,nombre,apellido,rol,activo,created_at,updated_at,requires_password_change) VALUES ('${ids.userA}','${ids.userA}@example.invalid','synthetic','H2','A','ADMINISTRACION',true,now(),now(),false),('${ids.userB}','${ids.userB}@example.invalid','synthetic','H2','B','ADMINISTRACION',true,now(),now(),false)`,
      `INSERT INTO pravia_os.organization_memberships (id,organization_id,user_id,rol,status,created_at,updated_at) VALUES ('${ids.memberA}','${ids.orgA}','${ids.userA}','ADMINISTRACION','ACTIVE',now(),now()),('${ids.memberB}','${ids.orgB}','${ids.userB}','ADMINISTRACION','ACTIVE',now(),now())`,
      `INSERT INTO pravia_os.expedientes (id,organization_id,numero_pravia,abogado_id,creador_id,fecha_apertura,estatus,avance_documental,avance_financiero,avance_general,avance_operativo,created_at,updated_at,version) VALUES ('${ids.expA}','${ids.orgA}','EXP-H2-A','${ids.userA}','${ids.userA}',now(),'ABIERTO',0,0,0,0,now(),now(),1),('${ids.expA2}','${ids.orgA}','EXP-H2-A2','${ids.userA}','${ids.userA}',now(),'ABIERTO',0,0,0,0,now(),now(),1),('${ids.expB}','${ids.orgB}','EXP-H2-B','${ids.userB}','${ids.userB}',now(),'ABIERTO',0,0,0,0,now(),now(),1)`,
      `INSERT INTO pravia_os.compliance_reviews (id,organization_id,expediente_id,tipo,estatus,rule_version_snapshot,cuestionario_json,rule_snapshot,master_snapshot,snapshot_captured_at,creado_por_id,created_at,updated_at,engine_version,idempotency_key,is_canonical_legal_engine) VALUES ('${ids.reviewA}','${ids.orgA}','${ids.expA}','H2_TEST','EVALUACION_DETERMINISTA','synthetic','{}','{}','{}',now(),'${ids.userA}',now(),now(),'h2-test','${ids.reviewA}',true),('${ids.reviewA2}','${ids.orgA}','${ids.expA2}','H2_TEST','EVALUACION_DETERMINISTA','synthetic','{}','{}','{}',now(),'${ids.userA}',now(),now(),'h2-test','${ids.reviewA2}',true),('${ids.reviewB}','${ids.orgB}','${ids.expB}','H2_TEST','EVALUACION_DETERMINISTA','synthetic','{}','{}','{}',now(),'${ids.userB}',now(),now(),'h2-test','${ids.reviewB}',true)`,
      `INSERT INTO pravia_os.expediente_compliance_states (id,organization_id,expediente_id,current_review_id,state,pending_count,version,updated_by_id,created_at,updated_at) VALUES ('${ids.stateA}','${ids.orgA}','${ids.expA}','${ids.reviewA}','PENDIENTE',3,1,'${ids.userA}',now(),now()),('${ids.stateA2}','${ids.orgA}','${ids.expA2}','${ids.reviewA2}','PENDIENTE',0,1,'${ids.userA}',now(),now()),('${ids.stateB}','${ids.orgB}','${ids.expB}','${ids.reviewB}','PENDIENTE',0,1,'${ids.userB}',now(),now())`,
      `INSERT INTO pravia_os.compliance_requirements (id,organization_id,expediente_id,state_id,review_id,provider,requirement_key,label,status,blocks_completion,source_snapshot,document_category,requires_signed_document,requires_human_validation,missing_action,is_documental,created_at,updated_at) VALUES ('${ids.reqA}','${ids.orgA}','${ids.expA}','${ids.stateA}','${ids.reviewA}','DOC','doc-a','Documento sintético A','PENDIENTE',true,'{}','IDENTIFICACION',false,true,'UPLOAD_DOCUMENT',true,now(),now()),('${ids.reqA2}','${ids.orgA}','${ids.expA}','${ids.stateA}','${ids.reviewA}','DOC','doc-a2','Documento sintético A2','PENDIENTE',true,'{}','IDENTIFICACION',false,true,'UPLOAD_DOCUMENT',true,now(),now()),('${ids.reqSigned}','${ids.orgA}','${ids.expA}','${ids.stateA}','${ids.reviewA}','DOC','doc-signed','Formato sintético firmado','PENDIENTE',true,'{}','FORMATOS',true,true,'UPLOAD_SIGNED',true,now(),now())`,
      `INSERT INTO pravia_os.documentos (id,organization_id,nombre_original,nombre_interno,tipo,categoria,storage_key,mime_type,size_bytes,checksum_sha256,fecha_carga,estatus,subido_por_id,expediente_id) VALUES ('${ids.docA}','${ids.orgA}','a.pdf','${ids.docA}.pdf','SYNTHETIC','UIF','synthetic/${ids.docA}.pdf','application/pdf',10,NULL,now(),'VIGENTE','${ids.userA}','${ids.expA}'),('${ids.docA2}','${ids.orgA}','a2.pdf','${ids.docA2}.pdf','SYNTHETIC','UIF','synthetic/${ids.docA2}.pdf','application/pdf',10,NULL,now(),'VIGENTE','${ids.userA}','${ids.expA2}'),('${ids.docB}','${ids.orgB}','b.pdf','${ids.docB}.pdf','SYNTHETIC','UIF','synthetic/${ids.docB}.pdf','application/pdf',10,NULL,now(),'VIGENTE','${ids.userB}','${ids.expB}')`,
      `INSERT INTO pravia_os.compliance_evidence (id,organization_id,review_id,documento_id,tipo_evidencia,agregado_por_id,estatus,created_at) VALUES ('${ids.legacyEvidence}','${ids.orgA}','${ids.reviewA}','${ids.docA}','LEGACY_SYNTHETIC','${ids.userA}','ACTIVO',now())`,
    ];
    for (const statement of statements) await execute(statement);
  });

  afterAll(async () => {
    const statements = [
      `DELETE FROM pravia_os.compliance_evidence WHERE organization_id IN ('${ids.orgA}','${ids.orgB}') OR id='${ids.legacyEvidence}'`,
      `DELETE FROM pravia_os.compliance_requirements WHERE organization_id IN ('${ids.orgA}','${ids.orgB}')`,
      `DELETE FROM pravia_os.expediente_compliance_states WHERE organization_id IN ('${ids.orgA}','${ids.orgB}')`,
      `DELETE FROM pravia_os.documentos WHERE organization_id IN ('${ids.orgA}','${ids.orgB}')`,
      `DELETE FROM pravia_os.compliance_reviews WHERE organization_id IN ('${ids.orgA}','${ids.orgB}')`,
      `DELETE FROM pravia_os.expedientes WHERE organization_id IN ('${ids.orgA}','${ids.orgB}')`,
      `DELETE FROM pravia_os.organization_memberships WHERE organization_id IN ('${ids.orgA}','${ids.orgB}')`,
      `DELETE FROM pravia_os.users WHERE id IN ('${ids.userA}','${ids.userB}')`,
      `DELETE FROM pravia_os.organizations WHERE id IN ('${ids.orgA}','${ids.orgB}')`,
    ];
    for (const statement of statements) await execute(statement).catch(() => undefined);
    await prisma.$disconnect();
  });

  it('keeps legacy evidence representable without forcing H2 lineage', async () => {
    const rows = await prisma.$queryRawUnsafe<Array<{ count: bigint }>>(`SELECT count(*)::bigint AS count FROM pravia_os.compliance_evidence WHERE id='${ids.legacyEvidence}' AND requirement_id IS NULL`);
    expect(Number(rows[0].count)).toBe(1);
  });

  it('keeps the physical requirement FK semantically aligned with Prisma', async () => {
    const rows = await prisma.$queryRawUnsafe<Array<{
      child_table: string;
      parent_table: string;
      definition: string;
      delete_action: string;
      update_action: string;
    }>>(`
      SELECT
        c.conrelid::regclass::text AS child_table,
        c.confrelid::regclass::text AS parent_table,
        pg_get_constraintdef(c.oid) AS definition,
        c.confdeltype::text AS delete_action,
        c.confupdtype::text AS update_action
      FROM pg_constraint c
      WHERE c.connamespace = 'pravia_os'::regnamespace
        AND c.conname = 'compliance_evidence_requirement_id_fkey'
        AND c.contype = 'f'
    `);
    expect(rows).toHaveLength(1);
    expect(rows[0].child_table).toMatch(/compliance_evidence$/);
    expect(rows[0].parent_table).toMatch(/compliance_requirements$/);
    expect(rows[0].definition).toContain('FOREIGN KEY (requirement_id)');
    expect(rows[0].definition).toMatch(/REFERENCES (?:pravia_os\.)?compliance_requirements\(id\)/);
    expect(rows[0].delete_action).toBe('r');
    expect(rows[0].update_action).toBe('a');
  });

  it('allows one stable document version to satisfy multiple distinct requirements', async () => {
    await execute(evidenceInsert({ id: ids.evidenceA, org: ids.orgA, exp: ids.expA, review: ids.reviewA, req: ids.reqA, doc: ids.docA, version: 'stable-v1' }));
    await execute(evidenceInsert({ id: ids.evidenceA2, org: ids.orgA, exp: ids.expA, review: ids.reviewA, req: ids.reqA2, doc: ids.docA, version: 'stable-v1' }));
    const rows = await prisma.$queryRawUnsafe<Array<{ count: bigint }>>(`SELECT count(*)::bigint AS count FROM pravia_os.compliance_evidence WHERE document_version='stable-v1'`);
    expect(Number(rows[0].count)).toBe(2);
  });

  it('blocks cross-expediente document linkage inside the same tenant', async () => {
    await expect(execute(evidenceInsert({ id: randomUUID(), org: ids.orgA, exp: ids.expA, review: ids.reviewA, req: ids.reqA, doc: ids.docA2, version: 'wrong-case' }))).rejects.toThrow(/H2_DOCUMENT_CASE_ACCESS_DENIED/);
  });

  it('blocks cross-tenant evidence even when foreign identifiers are valid', async () => {
    await expect(execute(evidenceInsert({ id: randomUUID(), org: ids.orgB, exp: ids.expA, review: ids.reviewA, req: ids.reqA, doc: ids.docB, version: 'wrong-tenant', actor: ids.userB }))).rejects.toThrow();
  });

  it('has no nullable-tenant bypass for H2 evidence', async () => {
    await expect(execute(evidenceInsert({ id: randomUUID(), org: null, exp: ids.expA, review: ids.reviewA, req: ids.reqA, doc: ids.docA, version: 'null-tenant' }))).rejects.toThrow(/H2_|ck_h2_evidence_new_lineage/);
  });

  it('makes stable evidence lineage immutable', async () => {
    await expect(execute(`UPDATE pravia_os.compliance_evidence SET document_version='mutated' WHERE id='${ids.evidenceA}'`)).rejects.toThrow(/H2_EVIDENCE_LINEAGE_IMMUTABLE/);
  });

  it('blocks generated evidence from validating a signed requirement', async () => {
    await execute(evidenceInsert({ id: ids.evidenceGenerated, org: ids.orgA, exp: ids.expA, review: ids.reviewA, req: ids.reqSigned, doc: ids.docA, version: 'generated-v1', state: 'GENERATED', source: 'FORMAT_GENERATED' }));
    await expect(execute(`UPDATE pravia_os.compliance_evidence SET validation_status='VALIDATED',validated_by_id='${ids.userA}',validated_at=now() WHERE id='${ids.evidenceGenerated}'`)).rejects.toThrow(/H2_SIGNED_REQUIREMENT_NEEDS_SIGNED_UPLOAD/);
  });

  it('accepts a manually uploaded signed version only with a human validator', async () => {
    await execute(evidenceInsert({ id: ids.evidenceSigned, org: ids.orgA, exp: ids.expA, review: ids.reviewA, req: ids.reqSigned, doc: ids.docA, version: 'signed-v1', state: 'SIGNED_UPLOADED', source: 'MANUAL_SIGNED_UPLOAD', validation: 'VALIDATED', validator: ids.userA }));
    const rows = await prisma.$queryRawUnsafe<Array<{ validation_status: string; validated_by_id: string }>>(`SELECT validation_status,validated_by_id FROM pravia_os.compliance_evidence WHERE id='${ids.evidenceSigned}'`);
    expect(rows).toEqual([{ validation_status: 'VALIDATED', validated_by_id: ids.userA }]);
  });
});
