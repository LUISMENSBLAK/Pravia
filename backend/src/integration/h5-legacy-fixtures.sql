-- TEST ONLY. Never production data or an application seed.
BEGIN;
DO $$ BEGIN
  IF current_database() NOT IN ('pravia_h5_final_b', 'pravia_h5_final_b_2', 'pravia_h5_final_b_3') THEN
    RAISE EXCEPTION 'H5_FIXTURE_REQUIRES_EXPLICIT_LOCAL_UPGRADE_DATABASE';
  END IF;
END $$;
SET LOCAL search_path TO pravia_os, public;
-- The exact H4 bootstrap has no physical provider flag. Deliberately simulate
-- the older historical shape ONLY in this guarded synthetic upgrade database.
-- DB A separately covers the canonical no-column path. This is not a seed or
-- evidence that the H4 checkpoint contained a populated provider flag.
ALTER TABLE expediente_comparecientes ADD COLUMN IF NOT EXISTS es_proveedor_recursos boolean NOT NULL DEFAULT false;
INSERT INTO organizations(id,name,status,created_at,updated_at)
VALUES ('f5000000-0000-4000-8000-000000000001','H5 SYNTHETIC ONLY','ACTIVE',now(),now());
INSERT INTO users(id,email,password_hash,nombre,apellido,rol,activo,created_at,updated_at,requires_password_change)
VALUES ('f5000000-0000-4000-8000-000000000002','h5-upgrade@example.invalid','not-a-credential','Synthetic','H5','ADMINISTRACION',true,now(),now(),true);
INSERT INTO organization_memberships(id,organization_id,user_id,rol,status,created_at,updated_at)
VALUES ('f5000000-0000-4000-8000-000000000003','f5000000-0000-4000-8000-000000000001','f5000000-0000-4000-8000-000000000002','ADMINISTRACION','ACTIVE',now(),now());
INSERT INTO comparecientes(id,organization_id,tipo_persona,nombre_busqueda,estatus,creado_por_id,created_at,updated_at,version)
VALUES ('f5000000-0000-4000-8000-000000000004','f5000000-0000-4000-8000-000000000001','FISICA','SYNTHETIC H5 PERSON','ACTIVO','f5000000-0000-4000-8000-000000000002',now(),now(),1);
INSERT INTO tipos_acto(id,organization_id,nombre,activo,created_at,updated_at)
VALUES ('f5000000-0000-4000-8000-000000000005','f5000000-0000-4000-8000-000000000001','SYNTHETIC H5 ACT',true,now(),now());
INSERT INTO caracteres_compareciente(id,clave,nombre,activo,created_at)
VALUES ('f5000000-0000-4000-8000-000000000006','H5_SYNTHETIC_EXISTING_ROLE','Synthetic existing role',true,now());
INSERT INTO expedientes(id,organization_id,numero_pravia,abogado_id,creador_id,fecha_apertura,estatus,avance_documental,avance_financiero,avance_general,avance_operativo,created_at,updated_at,version)
SELECT ('f5000000-0000-4000-8000-0000000000'||v)::uuid,'f5000000-0000-4000-8000-000000000001','EXP-H5-TEST-'||v,'f5000000-0000-4000-8000-000000000002','f5000000-0000-4000-8000-000000000002',now(),'ABIERTO',0,0,0,0,now(),now(),1
FROM (VALUES ('10'),('11')) AS x(v);
INSERT INTO expediente_actos(id,organization_id,expediente_id,tipo_acto_id,origen,estatus,created_by,created_at,updated_at)
SELECT ('f5000000-0000-4000-8000-0000000000'||act)::uuid,'f5000000-0000-4000-8000-000000000001',('f5000000-0000-4000-8000-0000000000'||exp)::uuid,'f5000000-0000-4000-8000-000000000005','LEGACY_MIGRATION','ACTIVO','f5000000-0000-4000-8000-000000000002',now(),now()
FROM (VALUES ('12','10'),('13','11'),('14','11')) AS x(act,exp);
INSERT INTO expediente_comparecientes(id,organization_id,expediente_id,expediente_acto_id,compareciente_id,caracter_id,forma_comparecencia,orden_comparecencia,es_principal,estatus,creado_por_id,created_at,es_proveedor_recursos)
SELECT ('f5000000-0000-4000-8000-0000000000'||rel)::uuid,'f5000000-0000-4000-8000-000000000001',('f5000000-0000-4000-8000-0000000000'||exp)::uuid,NULL,'f5000000-0000-4000-8000-000000000004','f5000000-0000-4000-8000-000000000006','PROPIO_DERECHO',1,false,'ACTIVO','f5000000-0000-4000-8000-000000000002',now(),true
FROM (VALUES ('15','10'),('16','11')) AS x(rel,exp);
INSERT INTO compliance_reviews(id,organization_id,expediente_id,tipo,estatus,rule_version_snapshot,cuestionario_json,rule_snapshot,master_snapshot,snapshot_captured_at,creado_por_id,created_at,updated_at,engine_version,idempotency_key,is_canonical_legal_engine)
VALUES ('f5000000-0000-4000-8000-000000000020','f5000000-0000-4000-8000-000000000001','f5000000-0000-4000-8000-000000000010','UIF','BORRADOR','SYNTHETIC-H4','{"historical_answer":"SYNTHETIC-UNCHANGED"}','{"historical_threshold":8025}','{}',now(),'f5000000-0000-4000-8000-000000000002',now(),now(),'SYNTHETIC-LEGACY','H5-UPGRADE-ONLY',false);
INSERT INTO compliance_rule_sets(id,tipo,clave,version,nombre,estatus,vigencia_desde,fuente_nombre,fuente_url,parametros,cuestionario,creado_por_id)
VALUES ('f5000000-0000-4000-8000-000000000021','UIF','SYNTHETIC-H5-LEGACY','TEST','SYNTHETIC ONLY','BORRADOR','2026-01-01','TEST ONLY','https://example.invalid/test','{"historical_threshold":8025}','{"historical_definition":"SYNTHETIC-UNCHANGED"}','f5000000-0000-4000-8000-000000000002');
INSERT INTO documentos(id,organization_id,expediente_id,nombre_original,nombre_interno,tipo,categoria,storage_key,mime_type,size_bytes,checksum_sha256,fecha_carga,estatus,subido_por_id)
VALUES ('f5000000-0000-4000-8000-000000000022','f5000000-0000-4000-8000-000000000001','f5000000-0000-4000-8000-000000000010','SYNTHETIC-RECEIPT.pdf','synthetic-h5-receipt.pdf','SYNTHETIC_RECEIPT','OTROS','synthetic/h5/receipt.pdf','application/pdf',10,repeat('a',64),now(),'VIGENTE','f5000000-0000-4000-8000-000000000002');
INSERT INTO compliance_evidence(id,organization_id,review_id,expediente_id,documento_id,tipo_evidencia,agregado_por_id,document_version,document_checksum_snapshot,source,document_state,validation_status)
VALUES ('f5000000-0000-4000-8000-000000000023','f5000000-0000-4000-8000-000000000001','f5000000-0000-4000-8000-000000000020','f5000000-0000-4000-8000-000000000010','f5000000-0000-4000-8000-000000000022','SYNTHETIC_RECEIPT','f5000000-0000-4000-8000-000000000002','SYNTHETIC-V1',repeat('a',64),'EXPEDIENTE','CANONICAL','PENDING_HUMAN');
INSERT INTO compliance_payments(id,organization_id,review_id,amount_mxn,method,payment_date,institution,reference,masked_account,evidence_document_id,source,created_by_id,retired_at)
SELECT ('f5000000-0000-4000-8000-0000000000'||v)::uuid,'f5000000-0000-4000-8000-000000000001','f5000000-0000-4000-8000-000000000020',123.45,'SYNTHETIC RAW METHOD','2025-01-01','TEST ONLY','SYNTHETIC REF','****1234','f5000000-0000-4000-8000-000000000022','SYNTHETIC-LEGACY','f5000000-0000-4000-8000-000000000002',CASE WHEN v='25' THEN now() ELSE NULL END
FROM (VALUES ('24'),('25')) AS x(v);
INSERT INTO pagos(id,organization_id,expediente_id,categoria_ingreso,concepto,monto,estatus)
VALUES ('f5000000-0000-4000-8000-000000000026','f5000000-0000-4000-8000-000000000001','f5000000-0000-4000-8000-000000000010','HONORARIOS_ESPERADOS','SYNTHETIC SERVICE FINANCE',77.77,'PENDIENTE');
COMMIT;
