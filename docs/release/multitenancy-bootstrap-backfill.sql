-- PLANTILLA PREPARED ONLY. NO ejecutar sin backup, freeze y aprobación de cutover.
-- Requiere psql variables:
--   BOOTSTRAP_ORGANIZATION_ID, BOOTSTRAP_ORGANIZATION_NAME
--   CUTOVER_COMMIT_APPROVED=true únicamente después de validar fingerprints.

\set ON_ERROR_STOP on
\if :{?CUTOVER_COMMIT_APPROVED}
\else
  \set CUTOVER_COMMIT_APPROVED false
\endif

BEGIN;
SELECT set_config('pravia.bootstrap_organization_id', :'BOOTSTRAP_ORGANIZATION_ID', true);

INSERT INTO pravia_os.organizations (id, name, status)
VALUES (:'BOOTSTRAP_ORGANIZATION_ID'::uuid, :'BOOTSTRAP_ORGANIZATION_NAME', 'ACTIVE')
ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name;

INSERT INTO pravia_os.organization_memberships (organization_id, user_id, rol, status)
SELECT :'BOOTSTRAP_ORGANIZATION_ID'::uuid, id, rol,
       CASE WHEN activo THEN 'ACTIVE' ELSE 'SUSPENDED' END
FROM pravia_os.users
ON CONFLICT (organization_id, user_id) DO NOTHING;

DO $$
DECLARE table_name TEXT; bootstrap_id UUID := current_setting('pravia.bootstrap_organization_id')::uuid;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'user_invitations','notifications','prospectos','prospecto_seguimientos','notarias','notaria_contactos',
    'cotizaciones','cotizacion_versiones','cotizacion_seguimientos','expedientes','expediente_estatus_log','expediente_etapas',
    'documentos','expediente_documentos','cotizacion_documentos','prospecto_documentos','requisito_documento_vinculos',
    'movimiento_documentos','comunicacion_documentos','comparecientes','personas_fisicas','relaciones_conyugales',
    'personas_morales','persona_moral_instrumentos','compareciente_domicilios','compareciente_contactos',
    'compareciente_identificaciones','compareciente_documentos','persona_moral_representantes','expediente_comparecientes',
    'expediente_representaciones','expediente_requisitos_doc','movimientos_financieros','categorias_financieras',
    'cuentas_financieras','honorarios_generados','metas_honorarios','movimiento_distribuciones','comprobantes_financieros',
    'transacciones_estado_cuenta','conciliaciones_financieras','pagos','expediente_actividades','audit_logs','calculos_isr',
    'calculos_isr_versiones','calculos_isr_documentos','calculos_isr_propuestas','domain_event_outbox',
    'domain_event_processing_logs','tareas','eventos_agenda','tareas_externas','expediente_entregas','comunicaciones',
    'notas','memoria_despacho','compareciente_alta_sessions','ai_usage_logs','compliance_reviews','compliance_decisions',
    'compliance_evidence','compliance_party_snapshots','compliance_beneficial_owners','compliance_pep_reviews',
    'compliance_screening_results','compliance_payments','compliance_obligations','compliance_events','compliance_ai_proposals',
    'carga_temporal_documentos','storage_compensation_jobs','compareciente_datos_fuente','compareciente_aliases',
    'compareciente_actividades_economicas'
  ] LOOP
    EXECUTE format('UPDATE pravia_os.%I SET organization_id = $1 WHERE organization_id IS NULL', table_name)
      USING bootstrap_id;
  END LOOP;
END $$;

UPDATE pravia_os.auth_sessions AS session
SET organization_id = :'BOOTSTRAP_ORGANIZATION_ID'::uuid,
    membership_id = membership.id
FROM pravia_os.organization_memberships AS membership
WHERE membership.user_id = session.user_id
  AND membership.organization_id = :'BOOTSTRAP_ORGANIZATION_ID'::uuid
  AND (session.organization_id IS NULL OR session.membership_id IS NULL);

DO $$
DECLARE table_name TEXT; orphan_count BIGINT; user_count BIGINT; membership_count BIGINT;
BEGIN
  SELECT count(*) INTO user_count FROM pravia_os.users;
  SELECT count(*) INTO membership_count
  FROM pravia_os.organization_memberships
  WHERE organization_id = current_setting('pravia.bootstrap_organization_id')::uuid;
  IF membership_count <> user_count THEN
    RAISE EXCEPTION 'MEMBERSHIP_BACKFILL_MISMATCH users=% memberships=%', user_count, membership_count;
  END IF;
  FOREACH table_name IN ARRAY ARRAY[
    'user_invitations','notifications','prospectos','prospecto_seguimientos','notarias','notaria_contactos',
    'cotizaciones','cotizacion_versiones','cotizacion_seguimientos','expedientes','expediente_estatus_log','expediente_etapas',
    'documentos','expediente_documentos','cotizacion_documentos','prospecto_documentos','requisito_documento_vinculos',
    'movimiento_documentos','comunicacion_documentos','comparecientes','personas_fisicas','relaciones_conyugales',
    'personas_morales','persona_moral_instrumentos','compareciente_domicilios','compareciente_contactos',
    'compareciente_identificaciones','compareciente_documentos','persona_moral_representantes','expediente_comparecientes',
    'expediente_representaciones','expediente_requisitos_doc','movimientos_financieros','categorias_financieras',
    'cuentas_financieras','honorarios_generados','metas_honorarios','movimiento_distribuciones','comprobantes_financieros',
    'transacciones_estado_cuenta','conciliaciones_financieras','pagos','expediente_actividades','audit_logs','calculos_isr',
    'calculos_isr_versiones','calculos_isr_documentos','calculos_isr_propuestas','domain_event_outbox',
    'domain_event_processing_logs','tareas','eventos_agenda','tareas_externas','expediente_entregas','comunicaciones',
    'notas','memoria_despacho','compareciente_alta_sessions','ai_usage_logs','compliance_reviews','compliance_decisions',
    'compliance_evidence','compliance_party_snapshots','compliance_beneficial_owners','compliance_pep_reviews',
    'compliance_screening_results','compliance_payments','compliance_obligations','compliance_events','compliance_ai_proposals',
    'carga_temporal_documentos','storage_compensation_jobs','compareciente_datos_fuente','compareciente_aliases',
    'compareciente_actividades_economicas'
  ] LOOP
    EXECUTE format('SELECT count(*) FROM pravia_os.%I WHERE organization_id IS NULL', table_name) INTO orphan_count;
    IF orphan_count <> 0 THEN RAISE EXCEPTION 'TENANT_ORPHANS table=% count=%', table_name, orphan_count; END IF;
  END LOOP;
  SELECT count(*) INTO orphan_count FROM pravia_os.auth_sessions WHERE organization_id IS NULL OR membership_id IS NULL;
  IF orphan_count <> 0 THEN RAISE EXCEPTION 'SESSION_TENANT_ORPHANS count=%', orphan_count; END IF;
END $$;

-- Los fingerprints S0/S1 se comparan fuera de esta plantilla antes de autorizar COMMIT.
\if :CUTOVER_COMMIT_APPROVED
  COMMIT;
\else
  ROLLBACK;
\endif
