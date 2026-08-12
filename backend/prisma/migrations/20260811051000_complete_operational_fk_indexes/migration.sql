-- Fase 13: completa los índices de llaves foráneas del esquema operativo.
-- Operación exclusivamente aditiva; no modifica ni elimina datos.

CREATE INDEX IF NOT EXISTS idx_comp_actividades_actividad_fk ON pravia_os.compareciente_actividades_economicas(actividad_id);
CREATE INDEX IF NOT EXISTS idx_comp_contactos_creador_fk ON pravia_os.compareciente_contactos(creado_por_id);
CREATE INDEX IF NOT EXISTS idx_comp_domicilios_creador_fk ON pravia_os.compareciente_domicilios(creado_por_id);
CREATE INDEX IF NOT EXISTS idx_comp_identificaciones_creador_fk ON pravia_os.compareciente_identificaciones(creado_por_id);
CREATE INDEX IF NOT EXISTS idx_comp_identificaciones_documento_fk ON pravia_os.compareciente_identificaciones(documento_id);
CREATE INDEX IF NOT EXISTS idx_comp_identificaciones_validador_fk ON pravia_os.compareciente_identificaciones(validado_por_id);

CREATE INDEX IF NOT EXISTS idx_cot_documentos_creador_fk ON pravia_os.cotizacion_documentos(creado_por_id);
CREATE INDEX IF NOT EXISTS idx_cot_documentos_documento_fk ON pravia_os.cotizacion_documentos(documento_id);
CREATE INDEX IF NOT EXISTS idx_outbox_actor_fk ON pravia_os.domain_event_outbox(actor_user_id);

CREATE INDEX IF NOT EXISTS idx_exp_rep_caracter_fk ON pravia_os.expediente_representaciones(caracter_representacion_id);
CREATE INDEX IF NOT EXISTS idx_exp_rep_creador_fk ON pravia_os.expediente_representaciones(creado_por_id);
CREATE INDEX IF NOT EXISTS idx_exp_rep_vinculo_representado_fk ON pravia_os.expediente_representaciones(expediente_compareciente_representado_id);
CREATE INDEX IF NOT EXISTS idx_exp_rep_vinculo_representante_fk ON pravia_os.expediente_representaciones(expediente_compareciente_representante_id);
CREATE INDEX IF NOT EXISTS idx_exp_rep_expediente_fk ON pravia_os.expediente_representaciones(expediente_id);
CREATE INDEX IF NOT EXISTS idx_exp_rep_instrumento_fk ON pravia_os.expediente_representaciones(instrumento_representacion_id);
CREATE INDEX IF NOT EXISTS idx_exp_rep_representado_fk ON pravia_os.expediente_representaciones(representado_compareciente_id);
CREATE INDEX IF NOT EXISTS idx_exp_rep_representante_fk ON pravia_os.expediente_representaciones(representante_compareciente_id);
CREATE INDEX IF NOT EXISTS idx_exp_rep_validador_fk ON pravia_os.expediente_representaciones(validado_por_id);

CREATE INDEX IF NOT EXISTS idx_flujo_versiones_creador_fk ON pravia_os.flujo_versiones(creado_por_id);
CREATE INDEX IF NOT EXISTS idx_formulario_versiones_creador_fk ON pravia_os.formulario_versiones(creado_por_id);
CREATE INDEX IF NOT EXISTS idx_plantilla_versiones_creador_fk ON pravia_os.plantilla_documental_versiones(creado_por_id);
CREATE INDEX IF NOT EXISTS idx_notaria_contactos_notaria_fk ON pravia_os.notaria_contactos(notaria_id);
CREATE INDEX IF NOT EXISTS idx_notas_user_fk ON pravia_os.notas(user_id);

CREATE INDEX IF NOT EXISTS idx_pm_instrumentos_creador_fk ON pravia_os.persona_moral_instrumentos(creado_por_id);
CREATE INDEX IF NOT EXISTS idx_pm_instrumentos_documento_fk ON pravia_os.persona_moral_instrumentos(documento_soporte_id);
CREATE INDEX IF NOT EXISTS idx_pm_instrumentos_persona_fk ON pravia_os.persona_moral_instrumentos(persona_moral_id);
CREATE INDEX IF NOT EXISTS idx_pm_instrumentos_validador_fk ON pravia_os.persona_moral_instrumentos(validado_por_id);
CREATE INDEX IF NOT EXISTS idx_pm_representantes_caracter_fk ON pravia_os.persona_moral_representantes(caracter_representacion_id);
CREATE INDEX IF NOT EXISTS idx_pm_representantes_creador_fk ON pravia_os.persona_moral_representantes(creado_por_id);
CREATE INDEX IF NOT EXISTS idx_pm_representantes_documento_fk ON pravia_os.persona_moral_representantes(documento_soporte_id);
CREATE INDEX IF NOT EXISTS idx_pm_representantes_instrumento_fk ON pravia_os.persona_moral_representantes(instrumento_id);
CREATE INDEX IF NOT EXISTS idx_pm_representantes_persona_fk ON pravia_os.persona_moral_representantes(persona_moral_id);
CREATE INDEX IF NOT EXISTS idx_pm_representantes_persona_fisica_fk ON pravia_os.persona_moral_representantes(representante_persona_fisica_id);

CREATE INDEX IF NOT EXISTS idx_pros_documentos_creador_fk ON pravia_os.prospecto_documentos(creado_por_id);
CREATE INDEX IF NOT EXISTS idx_pros_documentos_documento_fk ON pravia_os.prospecto_documentos(documento_id);
CREATE INDEX IF NOT EXISTS idx_rel_conyugales_documento_fk ON pravia_os.relaciones_conyugales(documento_soporte_id);
CREATE INDEX IF NOT EXISTS idx_rel_conyugales_persona_1_fk ON pravia_os.relaciones_conyugales(persona_1_id);
CREATE INDEX IF NOT EXISTS idx_rel_conyugales_persona_2_fk ON pravia_os.relaciones_conyugales(persona_2_id);
CREATE INDEX IF NOT EXISTS idx_requisito_vinculos_creador_fk ON pravia_os.requisito_documento_vinculos(creado_por_id);
CREATE INDEX IF NOT EXISTS idx_requisito_vinculos_documento_fk ON pravia_os.requisito_documento_vinculos(documento_id);
CREATE INDEX IF NOT EXISTS idx_storage_jobs_carga_fk ON pravia_os.storage_compensation_jobs(carga_temporal_id);
CREATE INDEX IF NOT EXISTS idx_tareas_externas_expediente_fk ON pravia_os.tareas_externas(expediente_id);
CREATE INDEX IF NOT EXISTS idx_tipo_acto_caracter_caracter_fk ON pravia_os.tipo_acto_caracteres_compareciente(caracter_id);
