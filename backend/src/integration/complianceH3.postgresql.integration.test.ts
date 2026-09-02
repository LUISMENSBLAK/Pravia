import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';

function isolatedDatabaseUrl() {
  if (process.env.NODE_ENV !== 'test' || process.env.H3_PG_TEST_CONFIRMATION !== 'RUN_ISOLATED_H3_POSTGRESQL') throw new Error('H3 isolated PostgreSQL confirmation is required.');
  const direct = new URL(process.env.H3_TEST_DIRECT_URL || '');
  const pooled = new URL(process.env.H3_TEST_DATABASE_URL || '');
  const allowed = new Set(['127.0.0.1', 'localhost', '[::1]']);
  if (!allowed.has(direct.hostname) || !allowed.has(pooled.hostname) || direct.host !== pooled.host || direct.pathname !== pooled.pathname || !direct.pathname.slice(1).startsWith('pravia_h3_')) throw new Error('H3 tests only accept the same explicit localhost pravia_h3_* database for DATABASE_URL and DIRECT_URL.');
  direct.searchParams.set('schema', 'pravia_os');
  return direct.toString();
}

const ids = Object.fromEntries([
  'orgA','orgB','userA','userB','memberA','memberB','partyA','partyA2','partyB','expA','reviewA','stateA','reqA',
  'sourceA','sourceB','versionA','versionA2','versionB','queryA','queryA2','queryB','legacyQuery','executionA','candidateA','snapshotA','docA','docB','reportA',
  'identityQuery','freeQuery','runningQuery','runningExecution','validCandidate','attemptA','legacyDoc',
].map((key) => [key, randomUUID()])) as Record<string, string>;
const prisma = new PrismaClient({ datasources: { db: { url: isolatedDatabaseUrl() } } });
const execute = (sql: string) => prisma.$executeRawUnsafe(sql);
const fp = 'a'.repeat(64);
const digest = 'b'.repeat(64);

const h3Query = (id: string, org: string, party: string, trigger: string, state = 'QUEUED') => `INSERT INTO pravia_os.compliance_screening_results
  (id,organization_id,compareciente_id,provider,status,query_snapshot,contract_version,query_kind,execution_state,trigger_reason,trigger_key,requested_by_id,identity_fingerprint,completed_at,created_at)
  VALUES ('${id}','${org}','${party}','H3_TEST','${state}','{}','CUM-LST-001','MASTER','${state}','MANUAL_RERUN','${trigger}','${org === ids.orgA ? ids.userA : ids.userB}','${fp}',${['NOT_CONFIGURED','SUCCEEDED','PARTIAL','ERROR'].includes(state) ? 'now()' : 'NULL'},now())`;

const freeQuery = (id: string, trigger: string) => `INSERT INTO pravia_os.compliance_screening_results
  (id,organization_id,provider,status,query_snapshot,contract_version,query_kind,execution_state,trigger_reason,trigger_key,owner_user_id,requested_by_id,identity_fingerprint,created_at)
  VALUES ('${id}','${ids.orgA}','H3_TEST','QUEUED','{}','CUM-LST-001','FREE','QUEUED','FREE_SEARCH','${trigger}','${ids.userA}','${ids.userA}','${fp}',now())`;

describe('H3 PostgreSQL tenant, lineage and immutability', () => {
  beforeAll(async () => {
    const statements = [
      `INSERT INTO pravia_os.organizations (id,name,status,created_at,updated_at) VALUES ('${ids.orgA}','H3 synthetic A','ACTIVE',now(),now()),('${ids.orgB}','H3 synthetic B','ACTIVE',now(),now())`,
      `INSERT INTO pravia_os.users (id,email,password_hash,nombre,apellido,rol,activo,created_at,updated_at,requires_password_change) VALUES ('${ids.userA}','${ids.userA}@example.invalid','synthetic','H3','A','ADMINISTRACION',true,now(),now(),false),('${ids.userB}','${ids.userB}@example.invalid','synthetic','H3','B','ADMINISTRACION',true,now(),now(),false)`,
      `INSERT INTO pravia_os.organization_memberships (id,organization_id,user_id,rol,status,created_at,updated_at) VALUES ('${ids.memberA}','${ids.orgA}','${ids.userA}','ADMINISTRACION','ACTIVE',now(),now()),('${ids.memberB}','${ids.orgB}','${ids.userB}','ADMINISTRACION','ACTIVE',now(),now())`,
      `INSERT INTO pravia_os.comparecientes (id,organization_id,tipo_persona,nombre_busqueda,estatus,creado_por_id,created_at,updated_at,version) VALUES ('${ids.partyA}','${ids.orgA}','FISICA','H3 PERSON A','ACTIVO','${ids.userA}',now(),now(),1),('${ids.partyA2}','${ids.orgA}','FISICA','H3 PERSON A2','ACTIVO','${ids.userA}',now(),now(),1),('${ids.partyB}','${ids.orgB}','FISICA','H3 PERSON B','ACTIVO','${ids.userB}',now(),now(),1)`,
      `INSERT INTO pravia_os.expedientes (id,organization_id,numero_pravia,abogado_id,creador_id,fecha_apertura,estatus,avance_documental,avance_financiero,avance_general,avance_operativo,created_at,updated_at,version) VALUES ('${ids.expA}','${ids.orgA}','EXP-H3-${ids.expA.slice(0,8)}','${ids.userA}','${ids.userA}',now(),'ABIERTO',0,0,0,0,now(),now(),1)`,
      `INSERT INTO pravia_os.compliance_reviews (id,organization_id,expediente_id,tipo,estatus,rule_version_snapshot,cuestionario_json,rule_snapshot,master_snapshot,snapshot_captured_at,creado_por_id,created_at,updated_at,engine_version,idempotency_key,is_canonical_legal_engine) VALUES ('${ids.reviewA}','${ids.orgA}','${ids.expA}','H3_TEST','EVALUACION_DETERMINISTA','synthetic','{}','{}','{}',now(),'${ids.userA}',now(),now(),'h3-test','${ids.reviewA}',true)`,
      `INSERT INTO pravia_os.expediente_compliance_states (id,organization_id,expediente_id,current_review_id,state,pending_count,version,updated_by_id,created_at,updated_at) VALUES ('${ids.stateA}','${ids.orgA}','${ids.expA}','${ids.reviewA}','PENDIENTE',1,1,'${ids.userA}',now(),now())`,
      `INSERT INTO pravia_os.compliance_requirements (id,organization_id,expediente_id,state_id,review_id,provider,requirement_key,label,status,blocks_completion,source_snapshot,target_compareciente_id,is_documental,created_at,updated_at) VALUES ('${ids.reqA}','${ids.orgA}','${ids.expA}','${ids.stateA}','${ids.reviewA}','LST','lst-${ids.reqA}','Consulta sintética','PENDIENTE',true,'{}','${ids.partyA}',false,now(),now())`,
      `INSERT INTO pravia_os.screening_sources (id,organization_id,code,display_name,provider_key,status,created_by_id) VALUES ('${ids.sourceA}','${ids.orgA}','SYNTH_A','Fuente sintética A','SYNTH_ADAPTER','ACTIVE','${ids.userA}'),('${ids.sourceB}','${ids.orgB}','SYNTH_B','Fuente sintética B','SYNTH_ADAPTER','ACTIVE','${ids.userB}')`,
      `INSERT INTO pravia_os.screening_source_versions (id,organization_id,source_id,version,status,dataset_checksum,adapter_key,adapter_version,provenance,available_at,created_by_id,activated_by_id,activated_at) VALUES ('${ids.versionA}','${ids.orgA}','${ids.sourceA}',1,'ACTIVE','${digest}','SYNTH_ADAPTER','1.0','{}',now(),'${ids.userA}','${ids.userA}',now()),('${ids.versionB}','${ids.orgB}','${ids.sourceB}',1,'ACTIVE','${digest}','SYNTH_ADAPTER','1.0','{}',now(),'${ids.userB}','${ids.userB}',now())`,
      h3Query(ids.queryA, ids.orgA, ids.partyA, `test:${ids.queryA}`),
      h3Query(ids.queryA2, ids.orgA, ids.partyA2, `test:${ids.queryA2}`, 'NOT_CONFIGURED'),
      h3Query(ids.queryB, ids.orgB, ids.partyB, `test:${ids.queryB}`, 'NOT_CONFIGURED'),
      h3Query(ids.identityQuery, ids.orgA, ids.partyA, `test:${ids.identityQuery}`),
      freeQuery(ids.freeQuery, `free:${ids.freeQuery}`),
      h3Query(ids.runningQuery, ids.orgA, ids.partyA, `test:${ids.runningQuery}`),
      `INSERT INTO pravia_os.compliance_screening_results (id,organization_id,review_id,compareciente_id,provider,status,query_snapshot,created_at) VALUES ('${ids.legacyQuery}','${ids.orgA}','${ids.reviewA}','${ids.partyA}','LEGACY_SYNTHETIC','NOT_CONFIGURED','{}',now())`,
      `INSERT INTO pravia_os.screening_source_executions (id,organization_id,query_id,source_id,source_version_id,execution_state,result_summary) VALUES ('${ids.executionA}','${ids.orgA}','${ids.queryA}','${ids.sourceA}','${ids.versionA}','QUEUED','{}')`,
      `INSERT INTO pravia_os.screening_source_executions (id,organization_id,query_id,source_id,source_version_id,execution_state,result_summary) VALUES ('${ids.runningExecution}','${ids.orgA}','${ids.runningQuery}','${ids.sourceA}','${ids.versionA}','QUEUED','{}')`,
      `UPDATE pravia_os.compliance_screening_results SET status='RUNNING',execution_state='RUNNING',started_at=now() WHERE id IN ('${ids.queryA}','${ids.runningQuery}')`,
      `UPDATE pravia_os.screening_source_executions SET execution_state='RUNNING',started_at=now() WHERE id IN ('${ids.executionA}','${ids.runningExecution}')`,
      `INSERT INTO pravia_os.screening_candidates (id,organization_id,query_id,source_execution_id,stable_candidate_id,source_record_ref,display_name,score,match_fields,evidence_snapshot) VALUES ('${ids.candidateA}','${ids.orgA}','${ids.queryA}','${ids.executionA}','candidate-a','ref-a','CANDIDATE SYNTHETIC',0.5,'[]','{}')`,
      `UPDATE pravia_os.screening_source_executions SET execution_state='SUCCEEDED',completed_at=now() WHERE id='${ids.executionA}'`,
      `UPDATE pravia_os.compliance_screening_results SET status='SUCCEEDED',execution_state='SUCCEEDED',completed_at=now() WHERE id='${ids.queryA}'`,
      `INSERT INTO pravia_os.screening_operation_snapshots (id,organization_id,requirement_id,query_id,source_summary,resolution_summary,unresolved_count,captured_by_id) VALUES ('${ids.snapshotA}','${ids.orgA}','${ids.reqA}','${ids.queryA}','[]','[]',1,'${ids.userA}')`,
      `INSERT INTO pravia_os.documentos (id,organization_id,nombre_original,nombre_interno,tipo,categoria,storage_key,mime_type,size_bytes,fecha_carga,estatus,subido_por_id) VALUES ('${ids.docA}','${ids.orgA}','h3-report.pdf','${ids.docA}-h3-report.pdf','REPORTE_CONSULTA_SCREENING','OTROS','synthetic/${ids.docA}/h3-report.pdf','application/pdf',10,now(),'VIGENTE','${ids.userA}')`,
      `INSERT INTO pravia_os.documentos (id,organization_id,nombre_original,nombre_interno,tipo,categoria,storage_key,mime_type,size_bytes,fecha_carga,estatus,subido_por_id) VALUES ('${ids.docB}','${ids.orgB}','h3-report-b.pdf','${ids.docB}-h3-report-b.pdf','REPORTE_CONSULTA_SCREENING','OTROS','synthetic/${ids.docB}/h3-report-b.pdf','application/pdf',10,now(),'VIGENTE','${ids.userB}')`,
      `INSERT INTO pravia_os.documentos (id,organization_id,nombre_original,nombre_interno,tipo,categoria,storage_key,mime_type,size_bytes,fecha_carga,estatus,subido_por_id) VALUES ('${ids.legacyDoc}','${ids.orgA}','legacy-report.pdf','${ids.legacyDoc}-legacy-report.pdf','REPORTE_CONSULTA_SCREENING','OTROS','synthetic/${ids.legacyDoc}/legacy-report.pdf','application/pdf',10,now(),'VIGENTE','${ids.userA}')`,
      `INSERT INTO pravia_os.screening_reports (id,organization_id,query_id,documento_id,generated_by_id,idempotency_key,semantic_fingerprint,content_checksum) VALUES ('${ids.reportA}','${ids.orgA}','${ids.queryA}','${ids.docA}','${ids.userA}','report-a','${'c'.repeat(64)}','${digest}')`,
    ];
    for (const statement of statements) await execute(statement);
  });

  afterAll(async () => { await prisma.$disconnect(); });

  it('blocks NULL tenant on every H3 query', async () => {
    await expect(execute(`INSERT INTO pravia_os.compliance_screening_results (organization_id,compareciente_id,provider,status,query_snapshot,contract_version,query_kind,execution_state,trigger_reason,trigger_key,requested_by_id,identity_fingerprint,completed_at) VALUES (NULL,'${ids.partyA}','X','NOT_CONFIGURED','{}','CUM-LST-001','MASTER','NOT_CONFIGURED','MANUAL_RERUN','null-${randomUUID()}','${ids.userA}','${fp}',now())`)).rejects.toThrow();
  });

  it('blocks valid compareciente from another tenant', async () => {
    await expect(execute(h3Query(randomUUID(), ids.orgA, ids.partyB, `wrong-tenant:${randomUUID()}`))).rejects.toThrow(/H3_QUERY_COMPARECIENTE_TENANT_MISMATCH/);
  });

  it('allows only one active version for a tenant source', async () => {
    await expect(execute(`INSERT INTO pravia_os.screening_source_versions (organization_id,source_id,version,status,dataset_checksum,adapter_key,adapter_version,provenance,available_at,created_by_id,activated_by_id,activated_at) VALUES ('${ids.orgA}','${ids.sourceA}',2,'ACTIVE','${digest}','SYNTH_ADAPTER','2.0','{}',now(),'${ids.userA}','${ids.userA}',now())`)).rejects.toThrow(/23505|already exists/i);
  });

  it('freezes used version payload while permitting retirement metadata', async () => {
    await expect(execute(`UPDATE pravia_os.screening_source_versions SET dataset_checksum='${'c'.repeat(64)}' WHERE id='${ids.versionA}'`)).rejects.toThrow(/H3_USED_SOURCE_VERSION_IMMUTABLE/);
    await execute(`UPDATE pravia_os.screening_source_versions SET status='RETIRED',retired_at=now() WHERE id='${ids.versionA}'`);
    await execute(`INSERT INTO pravia_os.screening_source_versions (id,organization_id,source_id,version,status,dataset_checksum,adapter_key,adapter_version,provenance,available_at,created_by_id,activated_by_id,activated_at) VALUES ('${ids.versionA2}','${ids.orgA}','${ids.sourceA}',2,'ACTIVE','${digest}','SYNTH_ADAPTER','2.0','{}',now(),'${ids.userA}','${ids.userA}',now())`);
  });

  it('prohibits H3 children on legacy query rows', async () => {
    await expect(execute(`INSERT INTO pravia_os.screening_source_executions (organization_id,query_id,source_id,source_version_id,execution_state,completed_at) VALUES ('${ids.orgA}','${ids.legacyQuery}','${ids.sourceA}','${ids.versionA2}','SUCCEEDED',now())`)).rejects.toThrow();
    await expect(execute(`INSERT INTO pravia_os.screening_reports (organization_id,query_id,documento_id,generated_by_id,idempotency_key,semantic_fingerprint,content_checksum) VALUES ('${ids.orgA}','${ids.legacyQuery}','${ids.legacyDoc}','${ids.userA}','legacy-blocked','${'f'.repeat(64)}','${'e'.repeat(64)}')`)).rejects.toThrow(/H3_CHILD_ON_UNSAFE_LEGACY_QUERY/);
  });

  it('blocks cross-tenant source execution lineage', async () => {
    await expect(execute(`INSERT INTO pravia_os.screening_source_executions (organization_id,query_id,source_id,source_version_id,execution_state,completed_at) VALUES ('${ids.orgA}','${ids.queryA2}','${ids.sourceB}','${ids.versionB}','SUCCEEDED',now())`)).rejects.toThrow();
  });

  it('blocks candidate attached to a different query than its execution', async () => {
    await expect(execute(`INSERT INTO pravia_os.screening_candidates (organization_id,query_id,source_execution_id,stable_candidate_id,source_record_ref,display_name,match_fields,evidence_snapshot) VALUES ('${ids.orgA}','${ids.queryA2}','${ids.executionA}','wrong-query','ref','SYNTHETIC','[]','{}')`)).rejects.toThrow(/H3_CANDIDATE_QUERY_EXECUTION_MISMATCH/);
  });

  it('makes candidate and resolution history append-only', async () => {
    await expect(execute(`UPDATE pravia_os.screening_candidates SET display_name='MUTATED' WHERE id='${ids.candidateA}'`)).rejects.toThrow(/H3_HISTORY_APPEND_ONLY/);
    const resolution = randomUUID();
    await execute(`INSERT INTO pravia_os.screening_human_resolutions (id,organization_id,candidate_id,decision,rationale,resolved_by_id) VALUES ('${resolution}','${ids.orgA}','${ids.candidateA}','NO_CORRESPONDE','Synthetic rationale','${ids.userA}')`);
    await expect(execute(`DELETE FROM pravia_os.screening_human_resolutions WHERE id='${resolution}'`)).rejects.toThrow(/H3_HISTORY_APPEND_ONLY/);
  });

  it('blocks resolution by an actor outside the tenant', async () => {
    await expect(execute(`INSERT INTO pravia_os.screening_human_resolutions (organization_id,candidate_id,decision,rationale,resolved_by_id) VALUES ('${ids.orgA}','${ids.candidateA}','REVISION_ADICIONAL','Synthetic rationale','${ids.userB}')`)).rejects.toThrow(/H3_RESOLUTION_ACTOR_TENANT_MISMATCH/);
  });

  it('blocks operation snapshot for the wrong compareciente', async () => {
    await expect(execute(`INSERT INTO pravia_os.screening_operation_snapshots (organization_id,requirement_id,query_id,source_summary,resolution_summary,unresolved_count,captured_by_id) VALUES ('${ids.orgA}','${ids.reqA}','${ids.queryA2}','[]','[]',0,'${ids.userA}')`)).rejects.toThrow(/H3_REQUIREMENT_QUERY_PERSON_LINEAGE_MISMATCH/);
  });

  it('keeps operation snapshots immutable and query deletion restricted', async () => {
    await expect(execute(`UPDATE pravia_os.screening_operation_snapshots SET unresolved_count=0 WHERE id='${ids.snapshotA}'`)).rejects.toThrow(/H3_HISTORY_APPEND_ONLY/);
    await expect(execute(`DELETE FROM pravia_os.compliance_screening_results WHERE id='${ids.queryA}'`)).rejects.toThrow();
  });

  it('enforces query and report idempotency physically', async () => {
    await expect(execute(h3Query(randomUUID(), ids.orgA, ids.partyA, `test:${ids.queryA}`))).rejects.toThrow(/23505|already exists/i);
    await expect(execute(`INSERT INTO pravia_os.screening_reports (organization_id,query_id,documento_id,generated_by_id,idempotency_key,semantic_fingerprint,content_checksum) VALUES ('${ids.orgA}','${ids.queryA}','${ids.docA}','${ids.userA}','report-a','${'d'.repeat(64)}','${'d'.repeat(64)}')`)).rejects.toThrow(/23505|already exists/i);
  });

  it('arbitra reportes por fingerprint semántico dentro del tenant y permite historia/cross-tenant', async () => {
    const semanticA = 'c'.repeat(64);
    await expect(execute(`INSERT INTO pravia_os.screening_reports (organization_id,query_id,documento_id,generated_by_id,idempotency_key,semantic_fingerprint,content_checksum) VALUES ('${ids.orgA}','${ids.queryA}','${ids.docA}','${ids.userA}','semantic-duplicate','${semanticA}','${'d'.repeat(64)}')`)).rejects.toThrow(/23505|already exists/i);
    await execute(`INSERT INTO pravia_os.screening_reports (organization_id,query_id,documento_id,generated_by_id,idempotency_key,semantic_fingerprint,content_checksum) VALUES ('${ids.orgA}','${ids.queryA}','${ids.docA}','${ids.userA}','semantic-new-state','${'d'.repeat(64)}','${'e'.repeat(64)}')`);
    await execute(`INSERT INTO pravia_os.screening_reports (organization_id,query_id,documento_id,generated_by_id,idempotency_key,semantic_fingerprint,content_checksum) VALUES ('${ids.orgB}','${ids.queryB}','${ids.docB}','${ids.userB}','semantic-cross-tenant','${semanticA}','${'f'.repeat(64)}')`);
    const rows: any[] = await prisma.$queryRawUnsafe(`SELECT organization_id::text,semantic_fingerprint FROM pravia_os.screening_reports WHERE semantic_fingerprint='${semanticA}' ORDER BY organization_id::text`);
    expect(rows).toHaveLength(2);
  });

  it('F003 freezes every Query identity field from INSERT while allowing a legal lifecycle transition', async () => {
    await expect(execute(`UPDATE pravia_os.compliance_screening_results SET compareciente_id='${ids.partyA2}' WHERE id='${ids.identityQuery}'`)).rejects.toThrow(/H3_QUERY_IDENTITY_IMMUTABLE/);
    await expect(execute(`UPDATE pravia_os.compliance_screening_results SET query_snapshot='{"changed":true}' WHERE id='${ids.identityQuery}'`)).rejects.toThrow(/H3_QUERY_IDENTITY_IMMUTABLE/);
    await expect(execute(`UPDATE pravia_os.compliance_screening_results SET identity_fingerprint='${'c'.repeat(64)}' WHERE id='${ids.identityQuery}'`)).rejects.toThrow(/H3_QUERY_IDENTITY_IMMUTABLE/);
    await expect(execute(`UPDATE pravia_os.compliance_screening_results SET trigger_reason='RELEVANT_IDENTITY_CHANGED' WHERE id='${ids.identityQuery}'`)).rejects.toThrow(/H3_QUERY_IDENTITY_IMMUTABLE/);
    await expect(execute(`UPDATE pravia_os.compliance_screening_results SET query_kind='FREE',compareciente_id=NULL,owner_user_id='${ids.userA}',trigger_reason='FREE_SEARCH' WHERE id='${ids.identityQuery}'`)).rejects.toThrow(/H3_QUERY_IDENTITY_IMMUTABLE/);
    await expect(execute(`UPDATE pravia_os.compliance_screening_results SET query_kind='MASTER',compareciente_id='${ids.partyA}',owner_user_id=NULL,trigger_reason='MANUAL_RERUN' WHERE id='${ids.freeQuery}'`)).rejects.toThrow(/H3_QUERY_IDENTITY_IMMUTABLE/);
    await execute(`UPDATE pravia_os.compliance_screening_results SET status='RUNNING',execution_state='RUNNING',started_at=now() WHERE id='${ids.identityQuery}'`);
    const rows: any[] = await prisma.$queryRawUnsafe(`SELECT execution_state FROM pravia_os.compliance_screening_results WHERE id='${ids.identityQuery}'`);
    expect(rows[0].execution_state).toBe('RUNNING');
  });

  it('F003 enforces coherent MASTER/FREE triggers physically', async () => {
    await expect(execute(`INSERT INTO pravia_os.compliance_screening_results (organization_id,compareciente_id,provider,status,query_snapshot,contract_version,query_kind,execution_state,trigger_reason,trigger_key,requested_by_id,identity_fingerprint) VALUES ('${ids.orgA}','${ids.partyA}','X','QUEUED','{}','CUM-LST-001','MASTER','QUEUED','FREE_SEARCH','bad-master-${randomUUID()}','${ids.userA}','${fp}')`)).rejects.toThrow();
    await expect(execute(`INSERT INTO pravia_os.compliance_screening_results (organization_id,provider,status,query_snapshot,contract_version,query_kind,execution_state,trigger_reason,trigger_key,owner_user_id,requested_by_id,identity_fingerprint) VALUES ('${ids.orgA}','X','QUEUED','{}','CUM-LST-001','FREE','QUEUED','MANUAL_RERUN','bad-free-${randomUUID()}','${ids.userA}','${ids.userA}','${fp}')`)).rejects.toThrow();
  });

  it('F004 freezes the source set and rejects late candidates while permitting a RUNNING candidate', async () => {
    await expect(execute(`INSERT INTO pravia_os.screening_source_executions (organization_id,query_id,source_id,source_version_id,execution_state) VALUES ('${ids.orgA}','${ids.queryA}','${ids.sourceA}','${ids.versionA2}','QUEUED')`)).rejects.toThrow(/H3_QUERY_SOURCE_SET_FROZEN/);
    await expect(execute(`INSERT INTO pravia_os.screening_source_executions (organization_id,query_id,source_id,source_version_id,execution_state) VALUES ('${ids.orgA}','${ids.identityQuery}','${ids.sourceA}','${ids.versionA2}','QUEUED')`)).rejects.toThrow(/H3_QUERY_SOURCE_SET_FROZEN/);
    await expect(execute(`INSERT INTO pravia_os.screening_candidates (organization_id,query_id,source_execution_id,stable_candidate_id,source_record_ref,display_name,match_fields,evidence_snapshot) VALUES ('${ids.orgA}','${ids.queryA}','${ids.executionA}','late-candidate','late-ref','LATE SYNTHETIC','[]','{}')`)).rejects.toThrow(/H3_LATE_CANDIDATE_INSERT_BLOCKED/);
    await execute(`INSERT INTO pravia_os.screening_candidates (id,organization_id,query_id,source_execution_id,stable_candidate_id,source_record_ref,display_name,match_fields,evidence_snapshot) VALUES ('${ids.validCandidate}','${ids.orgA}','${ids.runningQuery}','${ids.runningExecution}','running-candidate','running-ref','RUNNING SYNTHETIC','[]','{}')`);
    const rows: any[] = await prisma.$queryRawUnsafe(`SELECT count(*)::int AS count FROM pravia_os.screening_candidates WHERE id='${ids.validCandidate}'`);
    expect(rows[0].count).toBe(1);
  });

  it('F006 enforces tenant-safe sequential immutable attempts and retry transitions', async () => {
    await expect(execute(`INSERT INTO pravia_os.screening_source_execution_attempts (organization_id,source_execution_id,attempt_number,execution_state,started_at) VALUES ('${ids.orgB}','${ids.runningExecution}',1,'RUNNING',now())`)).rejects.toThrow();
    await execute(`INSERT INTO pravia_os.screening_source_execution_attempts (id,organization_id,source_execution_id,attempt_number,execution_state,started_at) VALUES ('${ids.attemptA}','${ids.orgA}','${ids.runningExecution}',1,'RUNNING',now())`);
    await execute(`UPDATE pravia_os.screening_source_execution_attempts SET execution_state='ERROR',completed_at=now(),error_code='SYNTHETIC_ERROR' WHERE id='${ids.attemptA}'`);
    await expect(execute(`UPDATE pravia_os.screening_source_execution_attempts SET error_code='MUTATED' WHERE id='${ids.attemptA}'`)).rejects.toThrow(/H3_TERMINAL_ATTEMPT_IMMUTABLE/);
    await execute(`UPDATE pravia_os.screening_source_executions SET execution_state='ERROR',completed_at=now(),error_code='SYNTHETIC_ERROR' WHERE id='${ids.runningExecution}'`);
    await execute(`UPDATE pravia_os.compliance_screening_results SET status='ERROR',execution_state='ERROR',completed_at=now() WHERE id='${ids.runningQuery}'`);
    await execute(`UPDATE pravia_os.compliance_screening_results SET status='RUNNING',execution_state='RUNNING',completed_at=NULL WHERE id='${ids.runningQuery}'`);
    await execute(`UPDATE pravia_os.screening_source_executions SET execution_state='RUNNING',completed_at=NULL,error_code=NULL WHERE id='${ids.runningExecution}'`);
    const attempt2 = randomUUID();
    await execute(`INSERT INTO pravia_os.screening_source_execution_attempts (id,organization_id,source_execution_id,attempt_number,execution_state,started_at) VALUES ('${attempt2}','${ids.orgA}','${ids.runningExecution}',2,'RUNNING',now())`);
    await execute(`UPDATE pravia_os.screening_source_execution_attempts SET execution_state='SUCCEEDED',completed_at=now(),result_digest='${digest}' WHERE id='${attempt2}'`);
    await execute(`UPDATE pravia_os.screening_source_executions SET execution_state='SUCCEEDED',completed_at=now() WHERE id='${ids.runningExecution}'`);
    await execute(`UPDATE pravia_os.compliance_screening_results SET status='SUCCEEDED',execution_state='SUCCEEDED',completed_at=now() WHERE id='${ids.runningQuery}'`);
    const rows: any[] = await prisma.$queryRawUnsafe(`SELECT attempt_number,execution_state FROM pravia_os.screening_source_execution_attempts WHERE source_execution_id='${ids.runningExecution}' ORDER BY attempt_number`);
    expect(rows).toMatchObject([{ attempt_number: 1, execution_state: 'ERROR' }, { attempt_number: 2, execution_state: 'SUCCEEDED' }]);
  });

  it('F008 blocks hard delete for no-child H3 Query, zero-candidate Execution, and terminal Attempt', async () => {
    const noChild = randomUUID();
    await execute(h3Query(noChild, ids.orgA, ids.partyA, `delete-query:${noChild}`, 'NOT_CONFIGURED'));
    await expect(execute(`DELETE FROM pravia_os.compliance_screening_results WHERE id='${noChild}'`)).rejects.toThrow(/H3_QUERY_HARD_DELETE_BLOCKED/);
    await expect(execute(`DELETE FROM pravia_os.screening_source_executions WHERE id='${ids.runningExecution}'`)).rejects.toThrow(/H3_SOURCE_EXECUTION_HARD_DELETE_BLOCKED/);
    await expect(execute(`DELETE FROM pravia_os.screening_source_execution_attempts WHERE id='${ids.attemptA}'`)).rejects.toThrow(/H3_ATTEMPT_HARD_DELETE_BLOCKED/);
  });
});
