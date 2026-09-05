-- H10 certification fixture. Synthetic data for the explicitly isolated local
-- representative-upgrade database only; never an application seed.
BEGIN;
DO $$ BEGIN
  IF current_database() <> 'pravia_h10_b' THEN
    RAISE EXCEPTION 'H10_FIXTURE_REQUIRES_EXPLICIT_LOCAL_UPGRADE_DATABASE';
  END IF;
END $$;
SET LOCAL search_path TO pravia_os, public;

INSERT INTO organizations(id,name,status,created_at,updated_at)
VALUES ('a1000000-0000-4000-8000-000000000001','H10 SYNTHETIC ONLY','ACTIVE',now(),now());
INSERT INTO users(id,email,password_hash,nombre,apellido,rol,activo,created_at,updated_at,requires_password_change)
VALUES ('a1000000-0000-4000-8000-000000000002','h10-upgrade@example.invalid','not-a-credential','Synthetic','H10','ADMINISTRACION',true,now(),now(),true);
INSERT INTO organization_memberships(id,organization_id,user_id,rol,status,created_at,updated_at)
VALUES ('a1000000-0000-4000-8000-000000000003','a1000000-0000-4000-8000-000000000001','a1000000-0000-4000-8000-000000000002','ADMINISTRACION','ACTIVE',now(),now());
INSERT INTO tipos_acto(id,organization_id,nombre,activo,created_at,updated_at)
VALUES ('a1000000-0000-4000-8000-000000000004','a1000000-0000-4000-8000-000000000001','H10 SYNTHETIC ACT',true,now(),now());
INSERT INTO expedientes(id,organization_id,numero_pravia,abogado_id,creador_id,fecha_apertura,estatus,avance_documental,avance_financiero,avance_general,avance_operativo,created_at,updated_at,version)
VALUES ('a1000000-0000-4000-8000-000000000005','a1000000-0000-4000-8000-000000000001','EXP-H10-TEST-0001','a1000000-0000-4000-8000-000000000002','a1000000-0000-4000-8000-000000000002',now(),'ABIERTO',0,0,0,0,now(),now(),1);
INSERT INTO expediente_actos(id,organization_id,expediente_id,tipo_acto_id,origen,estatus,created_by,created_at,updated_at)
SELECT ('a1000000-0000-4000-8000-0000000000'||v)::uuid,'a1000000-0000-4000-8000-000000000001','a1000000-0000-4000-8000-000000000005','a1000000-0000-4000-8000-000000000004','LEGACY_MIGRATION','ACTIVO','a1000000-0000-4000-8000-000000000002',now(),now()
FROM (VALUES ('06'),('07'),('08')) AS x(v);
INSERT INTO compliance_reviews(id,organization_id,expediente_id,tipo,estatus,rule_version_snapshot,cuestionario_json,rule_snapshot,master_snapshot,snapshot_captured_at,creado_por_id,created_at,updated_at,engine_version,idempotency_key,is_canonical_legal_engine)
VALUES ('a1000000-0000-4000-8000-000000000009','a1000000-0000-4000-8000-000000000001','a1000000-0000-4000-8000-000000000005','UIF','BORRADOR','H10-SYNTHETIC','{"historical_answer":"UNCHANGED"}','{"historical_threshold":8025}','{}',now(),'a1000000-0000-4000-8000-000000000002',now(),now(),'H10-LEGACY','H10-UPGRADE-ONLY',false);
INSERT INTO documentos(id,organization_id,expediente_id,nombre_original,nombre_interno,tipo,categoria,storage_key,mime_type,size_bytes,checksum_sha256,fecha_carga,estatus,subido_por_id)
VALUES ('a1000000-0000-4000-8000-000000000010','a1000000-0000-4000-8000-000000000001','a1000000-0000-4000-8000-000000000005','H10-SYNTHETIC-RECEIPT.pdf','h10-synthetic-receipt.pdf','SYNTHETIC_RECEIPT','OTROS','synthetic/h10/receipt.pdf','application/pdf',16,repeat('a',64),now(),'VIGENTE','a1000000-0000-4000-8000-000000000002');
INSERT INTO compliance_evidence(id,organization_id,review_id,expediente_id,documento_id,tipo_evidencia,agregado_por_id,document_version,document_checksum_snapshot,source,document_state,validation_status)
VALUES ('a1000000-0000-4000-8000-000000000011','a1000000-0000-4000-8000-000000000001','a1000000-0000-4000-8000-000000000009','a1000000-0000-4000-8000-000000000005','a1000000-0000-4000-8000-000000000010','SYNTHETIC_RECEIPT','a1000000-0000-4000-8000-000000000002','H10-V1',repeat('a',64),'EXPEDIENTE','CANONICAL','PENDING_HUMAN');
INSERT INTO compliance_payments(id,organization_id,review_id,amount_mxn,method,payment_date,institution,reference,masked_account,evidence_document_id,source,created_by_id,retired_at)
VALUES ('a1000000-0000-4000-8000-000000000012','a1000000-0000-4000-8000-000000000001','a1000000-0000-4000-8000-000000000009',123.45,'SYNTHETIC RAW METHOD','2026-01-01','TEST ONLY','H10 SYNTHETIC REF','****1234','a1000000-0000-4000-8000-000000000010','SYNTHETIC-LEGACY','a1000000-0000-4000-8000-000000000002',NULL);

INSERT INTO compliance_legal_rules(id,organization_id,stable_key,family,name,created_by_id,kind,created_at,updated_at)
VALUES ('a1000000-0000-4000-8000-000000000013','a1000000-0000-4000-8000-000000000001','H10-SYNTHETIC-LEGACY','CUM_MAT_001','H10 synthetic legacy rule','a1000000-0000-4000-8000-000000000002','ACTIVITY',now(),now());
INSERT INTO compliance_legal_rule_revisions(id,organization_id,rule_id,version,status,effective_from,conditions,outcome,legal_basis,checksum,created_by_id,created_at)
VALUES ('a1000000-0000-4000-8000-000000000014','a1000000-0000-4000-8000-000000000001','a1000000-0000-4000-8000-000000000013',1,'LEGACY_UNVERIFIED','2026-01-01','{}','{}','H10 SYNTHETIC ONLY',repeat('b',64),'a1000000-0000-4000-8000-000000000002',now());
INSERT INTO compliance_rule_results(id,organization_id,review_id,rule_revision_id,expediente_acto_id,applicability,vulnerable_activity,notice_required,notice_type,notice_channel,missing_paths,result_snapshot,legal_basis_snapshot,context_key,context_kind,outcome_purpose)
SELECT ('a1000000-0000-4000-8000-0000000000'||rid)::uuid,'a1000000-0000-4000-8000-000000000001','a1000000-0000-4000-8000-000000000009','a1000000-0000-4000-8000-000000000014',('a1000000-0000-4000-8000-0000000000'||act)::uuid,'APLICA_CON_AVISO',true,true,'H10_NOTICE','PORTAL','[]','{}','{}','ACT:'||act,'ACT','ACTIVITY_APPLICABILITY'
FROM (VALUES ('15','06'),('16','07'),('17','08')) AS x(rid,act);

-- A: presentation and acknowledgement can be materialized deterministically.
INSERT INTO compliance_obligations(id,organization_id,review_id,type,legal_basis,rule_version,rule_status,origin_date,due_at,channel,status,checklist,external_filed_at,external_folio,external_receipt_id,external_confirmed_by,snapshot,rule_result_id,rule_revision_id,obligation_key,idempotency_key)
VALUES
('a0000000-0000-4000-8000-000000000001','a1000000-0000-4000-8000-000000000001','a1000000-0000-4000-8000-000000000009','H10_A:NOTICE','H10 SYNTHETIC','1','LEGACY',now(),NULL,'PORTAL','PRESENTADO_EXTERNAMENTE','[]',now(),'H10-A','a1000000-0000-4000-8000-000000000010','a1000000-0000-4000-8000-000000000002','{}','a1000000-0000-4000-8000-000000000015','a1000000-0000-4000-8000-000000000014','H10-A','H10-A'),
('b0000000-0000-4000-8000-000000000002','a1000000-0000-4000-8000-000000000001','a1000000-0000-4000-8000-000000000009','H10_B:NOTICE','H10 SYNTHETIC','1','LEGACY',now(),NULL,'PORTAL','PENDIENTE','[]',now(),'H10-B',NULL,'a1000000-0000-4000-8000-000000000002','{}','a1000000-0000-4000-8000-000000000016','a1000000-0000-4000-8000-000000000014','H10-B','H10-B'),
('c0000000-0000-4000-8000-000000000003','a1000000-0000-4000-8000-000000000001','a1000000-0000-4000-8000-000000000009','H10_C:NOTICE','H10 SYNTHETIC','1','LEGACY',now(),NULL,'PORTAL','PENDIENTE','[]',now(),NULL,NULL,NULL,'{}','a1000000-0000-4000-8000-000000000017','a1000000-0000-4000-8000-000000000014','H10-C','H10-C'),
('d0000000-0000-4000-8000-000000000004',NULL,'a1000000-0000-4000-8000-000000000009','H10_D:NOTICE','H10 SYNTHETIC','legacy','LEGACY',now(),NULL,'UNKNOWN','PENDIENTE','[]',now(),'H10-D',NULL,NULL,'{}',NULL,NULL,NULL,'H10-D');
COMMIT;
