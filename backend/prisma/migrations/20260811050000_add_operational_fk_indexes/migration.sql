-- Fase 13: índices aditivos sobre llaves foráneas de rutas operativas frecuentes.
-- No se eliminan índices reportados como "unused": la base es pequeña y esa señal aún no es representativa.

CREATE INDEX IF NOT EXISTS idx_ai_usage_alta_session_fk ON pravia_os.ai_usage_logs(compareciente_alta_session_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_user_fk ON pravia_os.audit_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_checklist_items_tipo_acto_fk ON pravia_os.checklist_items(tipo_acto_id);
CREATE INDEX IF NOT EXISTS idx_alta_sessions_origen_expediente_fk ON pravia_os.compareciente_alta_sessions(origen_expediente_id);
CREATE INDEX IF NOT EXISTS idx_comparecientes_creado_por_fk ON pravia_os.comparecientes(creado_por_id);

CREATE INDEX IF NOT EXISTS idx_comp_datos_fuente_carga_fk ON pravia_os.compareciente_datos_fuente(carga_temporal_id);
CREATE INDEX IF NOT EXISTS idx_comp_datos_fuente_confirmador_fk ON pravia_os.compareciente_datos_fuente(confirmado_por_id);
CREATE INDEX IF NOT EXISTS idx_comp_datos_fuente_documento_fk ON pravia_os.compareciente_datos_fuente(documento_id);
CREATE INDEX IF NOT EXISTS idx_comp_documentos_documento_fk ON pravia_os.compareciente_documentos(documento_id);
CREATE INDEX IF NOT EXISTS idx_comp_documentos_creador_fk ON pravia_os.compareciente_documentos(creado_por_id);
CREATE INDEX IF NOT EXISTS idx_comp_documentos_validador_fk ON pravia_os.compareciente_documentos(validado_por_id);

CREATE INDEX IF NOT EXISTS idx_documentos_prospecto_fk ON pravia_os.documentos(prospecto_id);
CREATE INDEX IF NOT EXISTS idx_documentos_cotizacion_fk ON pravia_os.documentos(cotizacion_id);
CREATE INDEX IF NOT EXISTS idx_documentos_expediente_fk ON pravia_os.documentos(expediente_id);
CREATE INDEX IF NOT EXISTS idx_documentos_subido_por_fk ON pravia_os.documentos(subido_por_id);

CREATE INDEX IF NOT EXISTS idx_cotizaciones_user_fk ON pravia_os.cotizaciones(user_id);
CREATE INDEX IF NOT EXISTS idx_cotizaciones_notaria_fk ON pravia_os.cotizaciones(notaria_id);
CREATE INDEX IF NOT EXISTS idx_cot_seguimientos_cotizacion_fk ON pravia_os.cotizacion_seguimientos(cotizacion_id);
CREATE INDEX IF NOT EXISTS idx_cot_seguimientos_usuario_fk ON pravia_os.cotizacion_seguimientos(usuario_id);
CREATE INDEX IF NOT EXISTS idx_prospectos_user_fk ON pravia_os.prospectos(user_id);
CREATE INDEX IF NOT EXISTS idx_prospectos_archivado_por_fk ON pravia_os.prospectos(archived_by);
CREATE INDEX IF NOT EXISTS idx_pros_seguimientos_prospecto_fk ON pravia_os.prospecto_seguimientos(prospecto_id);
CREATE INDEX IF NOT EXISTS idx_pros_seguimientos_usuario_fk ON pravia_os.prospecto_seguimientos(usuario_id);

CREATE INDEX IF NOT EXISTS idx_expedientes_tipo_acto_fk ON pravia_os.expedientes(tipo_acto_id);
CREATE INDEX IF NOT EXISTS idx_expedientes_abogado_fk ON pravia_os.expedientes(abogado_id);
CREATE INDEX IF NOT EXISTS idx_expedientes_creador_fk ON pravia_os.expedientes(creador_id);
CREATE INDEX IF NOT EXISTS idx_expedientes_archivado_por_fk ON pravia_os.expedientes(archived_by);
CREATE INDEX IF NOT EXISTS idx_expedientes_flujo_version_fk ON pravia_os.expedientes(flujo_version_id);
CREATE INDEX IF NOT EXISTS idx_expedientes_formulario_version_fk ON pravia_os.expedientes(formulario_version_id);
CREATE INDEX IF NOT EXISTS idx_expedientes_gestor_fk ON pravia_os.expedientes(gestor_id);
CREATE INDEX IF NOT EXISTS idx_expedientes_notaria_fk ON pravia_os.expedientes(notaria_id);
CREATE INDEX IF NOT EXISTS idx_expedientes_plantilla_version_fk ON pravia_os.expedientes(plantilla_doc_version_id);

CREATE INDEX IF NOT EXISTS idx_exp_documentos_documento_fk ON pravia_os.expediente_documentos(documento_id);
CREATE INDEX IF NOT EXISTS idx_exp_documentos_creador_fk ON pravia_os.expediente_documentos(creado_por_id);
CREATE INDEX IF NOT EXISTS idx_exp_comparecientes_compareciente_fk ON pravia_os.expediente_comparecientes(compareciente_id);
CREATE INDEX IF NOT EXISTS idx_exp_comparecientes_caracter_fk ON pravia_os.expediente_comparecientes(caracter_id);
CREATE INDEX IF NOT EXISTS idx_exp_comparecientes_creador_fk ON pravia_os.expediente_comparecientes(creado_por_id);
CREATE INDEX IF NOT EXISTS idx_exp_requisitos_expediente_fk ON pravia_os.expediente_requisitos_doc(expediente_id);
CREATE INDEX IF NOT EXISTS idx_exp_etapas_expediente_fk ON pravia_os.expediente_etapas(expediente_id);
CREATE INDEX IF NOT EXISTS idx_exp_etapas_flujo_etapa_fk ON pravia_os.expediente_etapas(flujo_etapa_id);
CREATE INDEX IF NOT EXISTS idx_exp_etapas_flujo_version_fk ON pravia_os.expediente_etapas(flujo_version_id);
CREATE INDEX IF NOT EXISTS idx_exp_actividades_expediente_fk ON pravia_os.expediente_actividades(expediente_id);
CREATE INDEX IF NOT EXISTS idx_exp_actividades_usuario_fk ON pravia_os.expediente_actividades(usuario_id);
CREATE INDEX IF NOT EXISTS idx_exp_estatus_log_expediente_fk ON pravia_os.expediente_estatus_log(expediente_id);

CREATE INDEX IF NOT EXISTS idx_movimientos_expediente_fk ON pravia_os.movimientos_financieros(expediente_id);
CREATE INDEX IF NOT EXISTS idx_movimientos_cotizacion_fk ON pravia_os.movimientos_financieros(cotizacion_id);
CREATE INDEX IF NOT EXISTS idx_movimientos_capturado_por_fk ON pravia_os.movimientos_financieros(capturado_por_id);
CREATE INDEX IF NOT EXISTS idx_movimientos_validado_por_fk ON pravia_os.movimientos_financieros(validado_por_id);
CREATE INDEX IF NOT EXISTS idx_movimientos_origen_fk ON pravia_os.movimientos_financieros(movimiento_origen_id);
CREATE INDEX IF NOT EXISTS idx_movimientos_revertido_por_fk ON pravia_os.movimientos_financieros(revertido_por_id);
CREATE INDEX IF NOT EXISTS idx_mov_documentos_documento_fk ON pravia_os.movimiento_documentos(documento_id);
CREATE INDEX IF NOT EXISTS idx_mov_documentos_creador_fk ON pravia_os.movimiento_documentos(creado_por_id);
CREATE INDEX IF NOT EXISTS idx_pagos_expediente_fk ON pravia_os.pagos(expediente_id);
CREATE INDEX IF NOT EXISTS idx_pagos_cotizacion_fk ON pravia_os.pagos(cotizacion_id);

CREATE INDEX IF NOT EXISTS idx_tareas_expediente_fk ON pravia_os.tareas(expediente_id);
CREATE INDEX IF NOT EXISTS idx_tareas_asignado_fk ON pravia_os.tareas(asignado_a_id);
CREATE INDEX IF NOT EXISTS idx_tareas_creador_fk ON pravia_os.tareas(creador_id);
CREATE INDEX IF NOT EXISTS idx_agenda_compareciente_fk ON pravia_os.eventos_agenda(compareciente_id);
CREATE INDEX IF NOT EXISTS idx_agenda_cancelado_por_fk ON pravia_os.eventos_agenda(cancelado_por_id);

CREATE INDEX IF NOT EXISTS idx_compliance_reviews_rule_fk ON pravia_os.compliance_reviews(rule_set_id);
CREATE INDEX IF NOT EXISTS idx_compliance_reviews_creador_fk ON pravia_os.compliance_reviews(creado_por_id);
CREATE INDEX IF NOT EXISTS idx_compliance_reviews_revisor_fk ON pravia_os.compliance_reviews(revisado_por_id);
CREATE INDEX IF NOT EXISTS idx_compliance_rules_creador_fk ON pravia_os.compliance_rule_sets(creado_por_id);
CREATE INDEX IF NOT EXISTS idx_compliance_rules_aprobador_fk ON pravia_os.compliance_rule_sets(aprobado_por_id);
CREATE INDEX IF NOT EXISTS idx_compliance_evidence_agregado_fk ON pravia_os.compliance_evidence(agregado_por_id);

CREATE INDEX IF NOT EXISTS idx_comunicaciones_expediente_fk ON pravia_os.comunicaciones(expediente_id);
CREATE INDEX IF NOT EXISTS idx_comunicaciones_user_fk ON pravia_os.comunicaciones(user_id);
CREATE INDEX IF NOT EXISTS idx_com_documentos_documento_fk ON pravia_os.comunicacion_documentos(documento_id);
CREATE INDEX IF NOT EXISTS idx_com_documentos_creador_fk ON pravia_os.comunicacion_documentos(creado_por_id);
