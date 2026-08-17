-- ETAPA A: frontera tenant aditiva. No realiza bootstrap ni backfill productivo.
CREATE TABLE IF NOT EXISTS pravia_os.organizations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'SUSPENDED')),
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS pravia_os.organization_memberships (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL,
  user_id UUID NOT NULL,
  rol pravia_os."Role" NOT NULL,
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'SUSPENDED')),
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT organization_memberships_org_fkey FOREIGN KEY (organization_id) REFERENCES pravia_os.organizations(id) ON DELETE RESTRICT,
  CONSTRAINT organization_memberships_user_fkey FOREIGN KEY (user_id) REFERENCES pravia_os.users(id) ON DELETE RESTRICT,
  CONSTRAINT organization_memberships_org_user_key UNIQUE (organization_id, user_id)
);

CREATE INDEX IF NOT EXISTS organizations_status_idx ON pravia_os.organizations(status);
CREATE INDEX IF NOT EXISTS organization_memberships_user_status_idx ON pravia_os.organization_memberships(user_id, status);
CREATE INDEX IF NOT EXISTS organization_memberships_org_status_idx ON pravia_os.organization_memberships(organization_id, status);

ALTER TABLE pravia_os.auth_sessions ADD COLUMN IF NOT EXISTS organization_id UUID;
ALTER TABLE pravia_os.auth_sessions ADD COLUMN IF NOT EXISTS membership_id UUID;
ALTER TABLE pravia_os.auth_sessions
  ADD CONSTRAINT auth_sessions_organization_fkey FOREIGN KEY (organization_id) REFERENCES pravia_os.organizations(id) ON DELETE RESTRICT;
ALTER TABLE pravia_os.auth_sessions
  ADD CONSTRAINT auth_sessions_membership_fkey FOREIGN KEY (membership_id) REFERENCES pravia_os.organization_memberships(id) ON DELETE RESTRICT;
CREATE INDEX IF NOT EXISTS auth_sessions_org_revoked_expires_idx ON pravia_os.auth_sessions(organization_id, revoked_at, expires_at);

CREATE OR REPLACE FUNCTION pravia_os.enforce_session_membership()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE membership_org UUID; membership_user UUID;
BEGIN
  IF NEW.organization_id IS NULL OR NEW.membership_id IS NULL THEN RETURN NEW; END IF;
  SELECT organization_id, user_id INTO membership_org, membership_user
  FROM pravia_os.organization_memberships WHERE id = NEW.membership_id;
  IF membership_org IS NULL OR membership_org IS DISTINCT FROM NEW.organization_id OR membership_user IS DISTINCT FROM NEW.user_id THEN
    RAISE EXCEPTION 'SESSION_MEMBERSHIP_CONTEXT_MISMATCH' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_auth_session_membership_context ON pravia_os.auth_sessions;
CREATE TRIGGER trg_auth_session_membership_context
  BEFORE INSERT OR UPDATE ON pravia_os.auth_sessions
  FOR EACH ROW EXECUTE FUNCTION pravia_os.enforce_session_membership();

-- Una identidad puede aceptar una invitación por organización. La restricción
-- histórica one-to-one impediría Memberships legítimas en varios tenants.
DROP INDEX IF EXISTS pravia_os.user_invitations_accepted_user_id_key;

-- Entidades operativas existentes: nullable hasta completar el backfill controlado.
DO $$
DECLARE table_name TEXT;
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
    EXECUTE format('ALTER TABLE pravia_os.%I ADD COLUMN IF NOT EXISTS organization_id UUID', table_name);
    EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON pravia_os.%I (organization_id)', 'idx_' || table_name || '_organization', table_name);
    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint
      WHERE conname = 'fk_' || table_name || '_organization'
        AND conrelid = format('pravia_os.%I', table_name)::regclass
    ) THEN
      EXECUTE format(
        'ALTER TABLE pravia_os.%I ADD CONSTRAINT %I FOREIGN KEY (organization_id) REFERENCES pravia_os.organizations(id) ON DELETE RESTRICT',
        table_name, 'fk_' || table_name || '_organization'
      );
    END IF;
  END LOOP;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS user_invitations_org_accepted_user_key
  ON pravia_os.user_invitations(organization_id, accepted_user_id);

-- Índices de rutas calientes y agregaciones; GLOBAL siempre significa tenant-global.
CREATE INDEX IF NOT EXISTS idx_expedientes_org_status_updated ON pravia_os.expedientes(organization_id, estatus, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_documentos_org_created ON pravia_os.documentos(organization_id, fecha_carga DESC);
CREATE INDEX IF NOT EXISTS idx_movimientos_org_status_date ON pravia_os.movimientos_financieros(organization_id, estatus, fecha_movimiento DESC);
CREATE INDEX IF NOT EXISTS idx_agenda_org_start ON pravia_os.eventos_agenda(organization_id, fecha_inicio);
CREATE INDEX IF NOT EXISTS idx_audit_org_created ON pravia_os.audit_logs(organization_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_usage_org_created ON pravia_os.ai_usage_logs(organization_id, created_at DESC);
ALTER TABLE pravia_os.ai_usage_logs ADD COLUMN IF NOT EXISTS operation_id TEXT;
ALTER TABLE pravia_os.ai_usage_logs ALTER COLUMN costo_estimado_usd DROP DEFAULT;
ALTER TABLE pravia_os.ai_usage_logs ALTER COLUMN costo_estimado_usd DROP NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS ai_usage_logs_operation_id_key ON pravia_os.ai_usage_logs(operation_id);

-- Defensa relacional: impide vínculos cruzados cuando ambos registros ya fueron
-- asociados. Durante la etapa nullable permite el backfill sin perder datos.
CREATE OR REPLACE FUNCTION pravia_os.enforce_same_organization()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE parent_id UUID; parent_org UUID;
BEGIN
  parent_id := NULLIF(to_jsonb(NEW)->>TG_ARGV[1], '')::UUID;
  IF parent_id IS NULL THEN RETURN NEW; END IF;
  EXECUTE format('SELECT organization_id FROM pravia_os.%I WHERE id = $1', TG_ARGV[0]) INTO parent_org USING parent_id;
  -- La organización siempre debe venir del ActorContext o del backfill
  -- explícito. Este trigger valida relaciones; nunca infiere ni corrige el
  -- ownership silenciosamente.
  IF NEW.organization_id IS NULL THEN RETURN NEW; END IF;
  IF parent_org IS NOT NULL AND parent_org IS DISTINCT FROM NEW.organization_id THEN
    RAISE EXCEPTION 'CROSS_TENANT_RELATION_DENIED' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;

DO $$
DECLARE relation RECORD; trigger_name TEXT;
BEGIN
  FOR relation IN SELECT * FROM (VALUES
    ('prospecto_seguimientos','prospectos','prospecto_id'),
    ('cotizaciones','prospectos','prospecto_id'),
    ('cotizaciones','notarias','notaria_id'),
    ('cotizacion_versiones','cotizaciones','cotizacion_id'),
    ('cotizacion_seguimientos','cotizaciones','cotizacion_id'),
    ('expedientes','cotizaciones','cotizacion_id'),
    ('expedientes','notarias','notaria_id'),
    ('expediente_estatus_log','expedientes','expediente_id'),
    ('expediente_etapas','expedientes','expediente_id'),
    ('documentos','expedientes','expediente_id'),
    ('documentos','comparecientes','compareciente_id'),
    ('documentos','cotizaciones','cotizacion_id'),
    ('documentos','prospectos','prospecto_id'),
    ('compareciente_domicilios','documentos','documento_comprobante_id'),
    ('expediente_comparecientes','expedientes','expediente_id'),
    ('expediente_comparecientes','comparecientes','compareciente_id'),
    ('expediente_documentos','expedientes','expediente_id'),
    ('expediente_documentos','documentos','documento_id'),
    ('cotizacion_documentos','cotizaciones','cotizacion_id'),
    ('cotizacion_documentos','documentos','documento_id'),
    ('prospecto_documentos','prospectos','prospecto_id'),
    ('prospecto_documentos','documentos','documento_id'),
    ('compareciente_documentos','comparecientes','compareciente_id'),
    ('compareciente_documentos','documentos','documento_id'),
    ('movimiento_documentos','movimientos_financieros','movimiento_id'),
    ('movimiento_documentos','documentos','documento_id'),
    ('comunicacion_documentos','comunicaciones','comunicacion_id'),
    ('comunicacion_documentos','documentos','documento_id'),
    ('personas_fisicas','comparecientes','compareciente_id'),
    ('relaciones_conyugales','personas_fisicas','persona_1_id'),
    ('relaciones_conyugales','personas_fisicas','persona_2_id'),
    ('relaciones_conyugales','documentos','documento_soporte_id'),
    ('personas_morales','comparecientes','compareciente_id'),
    ('persona_moral_instrumentos','personas_morales','persona_moral_id'),
    ('persona_moral_instrumentos','documentos','documento_soporte_id'),
    ('compareciente_domicilios','comparecientes','compareciente_id'),
    ('compareciente_contactos','comparecientes','compareciente_id'),
    ('compareciente_identificaciones','comparecientes','compareciente_id'),
    ('compareciente_identificaciones','documentos','documento_id'),
    ('persona_moral_representantes','personas_morales','persona_moral_id'),
    ('persona_moral_representantes','persona_moral_instrumentos','instrumento_id'),
    ('persona_moral_representantes','documentos','documento_soporte_id'),
    ('expediente_representaciones','expedientes','expediente_id'),
    ('expediente_representaciones','persona_moral_instrumentos','instrumento_representacion_id'),
    ('expediente_representaciones','expediente_comparecientes','expediente_compareciente_representante_id'),
    ('expediente_representaciones','expediente_comparecientes','expediente_compareciente_representado_id'),
    ('expediente_representaciones','comparecientes','representante_compareciente_id'),
    ('expediente_representaciones','comparecientes','representado_compareciente_id'),
    ('expediente_requisitos_doc','expedientes','expediente_id'),
    ('requisito_documento_vinculos','expediente_requisitos_doc','requisito_id'),
    ('requisito_documento_vinculos','documentos','documento_id'),
    ('movimientos_financieros','expedientes','expediente_id'),
    ('movimientos_financieros','cotizaciones','cotizacion_id'),
    ('movimientos_financieros','comparecientes','compareciente_id'),
    ('movimientos_financieros','notarias','notaria_id'),
    ('movimientos_financieros','cuentas_financieras','cuenta_id'),
    ('honorarios_generados','cotizaciones','cotizacion_id'),
    ('honorarios_generados','cotizacion_versiones','cotizacion_version_id'),
    ('honorarios_generados','expedientes','expediente_id'),
    ('honorarios_generados','notarias','notaria_id'),
    ('movimiento_distribuciones','movimientos_financieros','movimiento_id'),
    ('movimiento_distribuciones','categorias_financieras','categoria_id'),
    ('movimiento_distribuciones','honorarios_generados','honorario_generado_id'),
    ('comprobantes_financieros','movimientos_financieros','movimiento_id'),
    ('transacciones_estado_cuenta','cuentas_financieras','cuenta_id'),
    ('conciliaciones_financieras','movimientos_financieros','movimiento_id'),
    ('conciliaciones_financieras','transacciones_estado_cuenta','transaccion_bancaria_id'),
    ('pagos','expedientes','expediente_id'),
    ('pagos','cotizaciones','cotizacion_id'),
    ('expediente_actividades','expedientes','expediente_id'),
    ('expedientes','expediente_etapas','expediente_etapa_actual_id'),
    ('calculos_isr','expedientes','expediente_id'),
    ('calculos_isr','comparecientes','compareciente_id'),
    ('calculos_isr_versiones','calculos_isr','calculo_id'),
    ('calculos_isr_documentos','calculos_isr','calculo_id'),
    ('calculos_isr_documentos','documentos','documento_id'),
    ('calculos_isr_propuestas','calculos_isr','calculo_id'),
    ('calculos_isr_propuestas','documentos','source_document_id'),
    ('domain_event_processing_logs','domain_event_outbox','event_id'),
    ('compliance_reviews','expedientes','expediente_id'),
    ('compliance_reviews','compliance_reviews','supersedes_review_id'),
    ('compliance_decisions','compliance_reviews','review_id'),
    ('compliance_evidence','compliance_reviews','review_id'),
    ('compliance_evidence','documentos','documento_id'),
    ('compliance_party_snapshots','compliance_reviews','review_id'),
    ('compliance_party_snapshots','comparecientes','compareciente_id'),
    ('compliance_beneficial_owners','compliance_reviews','review_id'),
    ('compliance_pep_reviews','compliance_reviews','review_id'),
    ('compliance_screening_results','compliance_reviews','review_id'),
    ('compliance_payments','compliance_reviews','review_id'),
    ('compliance_obligations','compliance_reviews','review_id'),
    ('compliance_events','compliance_reviews','review_id'),
    ('compliance_ai_proposals','compliance_reviews','review_id'),
    ('tareas','expedientes','expediente_id'),
    ('eventos_agenda','expedientes','expediente_id'),
    ('eventos_agenda','comparecientes','compareciente_id'),
    ('tareas_externas','expedientes','expediente_id'),
    ('tareas_externas','documentos','evidencia_documento_id'),
    ('expediente_entregas','expedientes','expediente_id'),
    ('expediente_entregas','documentos','evidencia_documento_id'),
    ('comunicaciones','expedientes','expediente_id'),
    ('compareciente_alta_sessions','expedientes','origen_expediente_id'),
    ('ai_usage_logs','expedientes','expediente_id'),
    ('ai_usage_logs','compareciente_alta_sessions','compareciente_alta_session_id'),
    ('carga_temporal_documentos','compareciente_alta_sessions','alta_session_id'),
    ('storage_compensation_jobs','carga_temporal_documentos','carga_temporal_id'),
    ('compareciente_datos_fuente','comparecientes','compareciente_id'),
    ('compareciente_datos_fuente','documentos','documento_id'),
    ('compareciente_datos_fuente','carga_temporal_documentos','carga_temporal_id'),
    ('compareciente_aliases','comparecientes','compareciente_id'),
    ('compareciente_actividades_economicas','comparecientes','compareciente_id'),
    ('notaria_contactos','notarias','notaria_id'),
    ('notarias','notaria_contactos','contacto_principal_id'),
    ('persona_moral_representantes','personas_fisicas','representante_persona_fisica_id'),
    ('movimientos_financieros','movimientos_financieros','movimiento_origen_id')
  ) AS v(child_table, parent_table, fk_column)
  LOOP
    trigger_name := 'trg_tenant_' || substr(md5(relation.child_table || ':' || relation.parent_table || ':' || relation.fk_column), 1, 24);
    EXECUTE format('DROP TRIGGER IF EXISTS %I ON pravia_os.%I', trigger_name, relation.child_table);
    EXECUTE format(
      'CREATE TRIGGER %I BEFORE INSERT OR UPDATE ON pravia_os.%I FOR EACH ROW EXECUTE FUNCTION pravia_os.enforce_same_organization(%L,%L)',
      trigger_name,
      relation.child_table, relation.parent_table, relation.fk_column
    );
  END LOOP;
END $$;

-- Excepción híbrida: una plantilla sin notaría es global; una plantilla ligada
-- a Notaría solo puede congelarse en un Expediente de esa misma Notaría y
-- Organization. La función valida y nunca modifica ownership.
CREATE OR REPLACE FUNCTION pravia_os.enforce_document_template_scope()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE template_notaria_id UUID; template_org UUID;
BEGIN
  IF NEW.plantilla_doc_version_id IS NULL THEN RETURN NEW; END IF;
  SELECT template.notaria_id, notaria.organization_id
    INTO template_notaria_id, template_org
  FROM pravia_os.plantilla_documental_versiones AS template
  LEFT JOIN pravia_os.notarias AS notaria ON notaria.id = template.notaria_id
  WHERE template.id = NEW.plantilla_doc_version_id;
  IF template_notaria_id IS NULL THEN RETURN NEW; END IF;
  IF NEW.notaria_id IS DISTINCT FROM template_notaria_id
     OR (NEW.organization_id IS NOT NULL AND template_org IS DISTINCT FROM NEW.organization_id) THEN
    RAISE EXCEPTION 'CROSS_TENANT_DOCUMENT_TEMPLATE_DENIED' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_expediente_document_template_scope ON pravia_os.expedientes;
CREATE TRIGGER trg_expediente_document_template_scope
  BEFORE INSERT OR UPDATE ON pravia_os.expedientes
  FOR EACH ROW EXECUTE FUNCTION pravia_os.enforce_document_template_scope();

CREATE OR REPLACE FUNCTION pravia_os.enforce_organization_membership()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE member_user_id UUID;
BEGIN
  member_user_id := NULLIF(to_jsonb(NEW)->>TG_ARGV[0], '')::UUID;
  IF NEW.organization_id IS NULL OR member_user_id IS NULL THEN RETURN NEW; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pravia_os.organization_memberships
    WHERE organization_id = NEW.organization_id AND user_id = member_user_id
  ) THEN
    RAISE EXCEPTION 'CROSS_TENANT_USER_RELATION_DENIED' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;

DO $$
DECLARE relation RECORD; trigger_name TEXT;
BEGIN
  FOR relation IN SELECT * FROM (VALUES
    ('user_invitations','accepted_user_id'),('user_invitations','created_by_id'),
    ('notifications','created_by_id'),('notifications','recipient_id'),
    ('prospectos','archived_by'),('prospectos','user_id'),('prospecto_seguimientos','usuario_id'),
    ('cotizaciones','user_id'),('cotizacion_seguimientos','usuario_id'),
    ('expedientes','abogado_id'),('expedientes','archived_by'),('expedientes','creador_id'),('expedientes','gestor_id'),
    ('documentos','subido_por_id'),
    ('expediente_documentos','creado_por_id'),('cotizacion_documentos','creado_por_id'),('prospecto_documentos','creado_por_id'),
    ('requisito_documento_vinculos','creado_por_id'),('movimiento_documentos','creado_por_id'),('comunicacion_documentos','creado_por_id'),
    ('comparecientes','creado_por_id'),('persona_moral_instrumentos','creado_por_id'),('persona_moral_instrumentos','validado_por_id'),
    ('compareciente_domicilios','creado_por_id'),('compareciente_contactos','creado_por_id'),
    ('compareciente_identificaciones','creado_por_id'),('compareciente_identificaciones','validado_por_id'),
    ('compareciente_documentos','creado_por_id'),('compareciente_documentos','validado_por_id'),
    ('persona_moral_representantes','creado_por_id'),
    ('expediente_comparecientes','creado_por_id'),('expediente_comparecientes','validado_por_id'),
    ('expediente_representaciones','creado_por_id'),('expediente_representaciones','validado_por_id'),
    ('movimientos_financieros','aplicado_por_id'),('movimientos_financieros','cancelado_por_id'),
    ('movimientos_financieros','capturado_por_id'),('movimientos_financieros','responsable_id'),
    ('movimientos_financieros','revertido_por_id'),('movimientos_financieros','validado_por_id'),
    ('cuentas_financieras','creada_por_id'),('honorarios_generados','reconocido_por_id'),('honorarios_generados','responsable_id'),
    ('metas_honorarios','creada_por_id'),('metas_honorarios','usuario_id'),
    ('comprobantes_financieros','anulado_por_id'),('comprobantes_financieros','registrado_por_id'),
    ('transacciones_estado_cuenta','importado_por_id'),('conciliaciones_financieras','conciliado_por_id'),
    ('expediente_actividades','usuario_id'),('audit_logs','user_id'),
    ('calculos_isr','creado_por_id'),('calculos_isr','actualizado_por_id'),('calculos_isr_versiones','calculado_por_id'),
    ('calculos_isr_documentos','creado_por_id'),('calculos_isr_propuestas','reviewed_by_id'),
    ('domain_event_outbox','actor_user_id'),
    ('tareas','asignado_a_id'),('tareas','creador_id'),('eventos_agenda','cancelado_por_id'),('eventos_agenda','user_id'),
    ('tareas_externas','gestionado_por_id'),('expediente_entregas','registrado_por_id'),
    ('comunicaciones','user_id'),('notas','user_id'),('compareciente_alta_sessions','usuario_id'),
    ('ai_usage_logs','usuario_id'),
    ('compliance_reviews','creado_por_id'),('compliance_reviews','revisado_por_id'),
    ('compliance_decisions','decidido_por_id'),('compliance_evidence','agregado_por_id'),
    ('carga_temporal_documentos','usuario_id'),('compareciente_datos_fuente','confirmado_por_id')
  ) AS v(child_table, user_column)
  LOOP
    trigger_name := 'trg_member_' || substr(md5(relation.child_table || ':' || relation.user_column), 1, 24);
    EXECUTE format('DROP TRIGGER IF EXISTS %I ON pravia_os.%I', trigger_name, relation.child_table);
    EXECUTE format(
      'CREATE TRIGGER %I BEFORE INSERT OR UPDATE ON pravia_os.%I FOR EACH ROW EXECUTE FUNCTION pravia_os.enforce_organization_membership(%L)',
      trigger_name,
      relation.child_table, relation.user_column
    );
  END LOOP;
END $$;

-- ETAPA B (bootstrap/backfill), validación de huérfanos y NOT NULL se ejecutan
-- únicamente mediante el runbook aprobado durante el cutover productivo.
