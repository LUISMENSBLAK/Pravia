-- DropForeignKey
ALTER TABLE "ai_usage_logs" DROP CONSTRAINT "ai_usage_logs_compareciente_alta_session_id_fkey";

-- DropForeignKey
ALTER TABLE "ai_usage_logs" DROP CONSTRAINT "ai_usage_logs_expediente_id_fkey";

-- DropForeignKey
ALTER TABLE "ai_usage_logs" DROP CONSTRAINT "ai_usage_logs_usuario_id_fkey";

-- DropForeignKey
ALTER TABLE "compareciente_contactos" DROP CONSTRAINT "compareciente_contactos_compareciente_id_fkey";

-- DropForeignKey
ALTER TABLE "compareciente_contactos" DROP CONSTRAINT "compareciente_contactos_creado_por_id_fkey";

-- DropForeignKey
ALTER TABLE "compareciente_documentos" DROP CONSTRAINT "compareciente_documentos_compareciente_id_fkey";

-- DropForeignKey
ALTER TABLE "compareciente_documentos" DROP CONSTRAINT "compareciente_documentos_creado_por_id_fkey";

-- DropForeignKey
ALTER TABLE "compareciente_documentos" DROP CONSTRAINT "compareciente_documentos_documento_id_fkey";

-- DropForeignKey
ALTER TABLE "compareciente_documentos" DROP CONSTRAINT "compareciente_documentos_validado_por_id_fkey";

-- DropForeignKey
ALTER TABLE "compareciente_domicilios" DROP CONSTRAINT "compareciente_domicilios_compareciente_id_fkey";

-- DropForeignKey
ALTER TABLE "compareciente_domicilios" DROP CONSTRAINT "compareciente_domicilios_creado_por_id_fkey";

-- DropForeignKey
ALTER TABLE "compareciente_domicilios" DROP CONSTRAINT "compareciente_domicilios_documento_comprobante_id_fkey";

-- DropForeignKey
ALTER TABLE "compareciente_identificaciones" DROP CONSTRAINT "compareciente_identificaciones_compareciente_id_fkey";

-- DropForeignKey
ALTER TABLE "compareciente_identificaciones" DROP CONSTRAINT "compareciente_identificaciones_creado_por_id_fkey";

-- DropForeignKey
ALTER TABLE "compareciente_identificaciones" DROP CONSTRAINT "compareciente_identificaciones_documento_id_fkey";

-- DropForeignKey
ALTER TABLE "compareciente_identificaciones" DROP CONSTRAINT "compareciente_identificaciones_validado_por_id_fkey";

-- DropForeignKey
ALTER TABLE "comparecientes" DROP CONSTRAINT "comparecientes_creado_por_id_fkey";

-- DropForeignKey
ALTER TABLE "compliance_decisions" DROP CONSTRAINT "compliance_decisions_decidido_por_id_fkey";

-- DropForeignKey
ALTER TABLE "compliance_decisions" DROP CONSTRAINT "compliance_decisions_review_id_fkey";

-- DropForeignKey
ALTER TABLE "compliance_evidence" DROP CONSTRAINT "compliance_evidence_agregado_por_id_fkey";

-- DropForeignKey
ALTER TABLE "compliance_evidence" DROP CONSTRAINT "compliance_evidence_documento_id_fkey";

-- DropForeignKey
ALTER TABLE "compliance_evidence" DROP CONSTRAINT "compliance_evidence_review_id_fkey";

-- DropForeignKey
ALTER TABLE "compliance_reviews" DROP CONSTRAINT "compliance_reviews_creado_por_id_fkey";

-- DropForeignKey
ALTER TABLE "compliance_reviews" DROP CONSTRAINT "compliance_reviews_expediente_id_fkey";

-- DropForeignKey
ALTER TABLE "compliance_reviews" DROP CONSTRAINT "compliance_reviews_revisado_por_id_fkey";

-- DropForeignKey
ALTER TABLE "compliance_reviews" DROP CONSTRAINT "compliance_reviews_rule_set_id_fkey";

-- DropForeignKey
ALTER TABLE "compliance_reviews" DROP CONSTRAINT "compliance_reviews_supersedes_review_id_fkey";

-- DropForeignKey
ALTER TABLE "compliance_rule_sets" DROP CONSTRAINT "compliance_rule_sets_aprobado_por_id_fkey";

-- DropForeignKey
ALTER TABLE "compliance_rule_sets" DROP CONSTRAINT "compliance_rule_sets_creado_por_id_fkey";

-- DropForeignKey
ALTER TABLE "eventos_agenda" DROP CONSTRAINT "eventos_agenda_cancelado_por_id_fkey";

-- DropForeignKey
ALTER TABLE "eventos_agenda" DROP CONSTRAINT "eventos_agenda_compareciente_id_fkey";

-- DropForeignKey
ALTER TABLE "expediente_comparecientes" DROP CONSTRAINT "expediente_comparecientes_caracter_id_fkey";

-- DropForeignKey
ALTER TABLE "expediente_comparecientes" DROP CONSTRAINT "expediente_comparecientes_compareciente_id_fkey";

-- DropForeignKey
ALTER TABLE "expediente_comparecientes" DROP CONSTRAINT "expediente_comparecientes_creado_por_id_fkey";

-- DropForeignKey
ALTER TABLE "expediente_comparecientes" DROP CONSTRAINT "expediente_comparecientes_expediente_id_fkey";

-- DropForeignKey
ALTER TABLE "expediente_representaciones" DROP CONSTRAINT "expediente_representaciones_caracter_representacion_id_fkey";

-- DropForeignKey
ALTER TABLE "expediente_representaciones" DROP CONSTRAINT "expediente_representaciones_creado_por_id_fkey";

-- DropForeignKey
ALTER TABLE "expediente_representaciones" DROP CONSTRAINT "expediente_representaciones_expediente_compareciente_repr_fkey1";

-- DropForeignKey
ALTER TABLE "expediente_representaciones" DROP CONSTRAINT "expediente_representaciones_expediente_compareciente_repre_fkey";

-- DropForeignKey
ALTER TABLE "expediente_representaciones" DROP CONSTRAINT "expediente_representaciones_expediente_id_fkey";

-- DropForeignKey
ALTER TABLE "expediente_representaciones" DROP CONSTRAINT "expediente_representaciones_instrumento_representacion_id_fkey";

-- DropForeignKey
ALTER TABLE "expediente_representaciones" DROP CONSTRAINT "expediente_representaciones_representado_compareciente_id_fkey";

-- DropForeignKey
ALTER TABLE "expediente_representaciones" DROP CONSTRAINT "expediente_representaciones_representante_compareciente_id_fkey";

-- DropForeignKey
ALTER TABLE "expediente_representaciones" DROP CONSTRAINT "expediente_representaciones_validado_por_id_fkey";

-- DropForeignKey
ALTER TABLE "persona_moral_instrumentos" DROP CONSTRAINT "persona_moral_instrumentos_creado_por_id_fkey";

-- DropForeignKey
ALTER TABLE "persona_moral_instrumentos" DROP CONSTRAINT "persona_moral_instrumentos_documento_soporte_id_fkey";

-- DropForeignKey
ALTER TABLE "persona_moral_instrumentos" DROP CONSTRAINT "persona_moral_instrumentos_persona_moral_id_fkey";

-- DropForeignKey
ALTER TABLE "persona_moral_instrumentos" DROP CONSTRAINT "persona_moral_instrumentos_validado_por_id_fkey";

-- DropForeignKey
ALTER TABLE "persona_moral_representantes" DROP CONSTRAINT "persona_moral_representantes_caracter_representacion_id_fkey";

-- DropForeignKey
ALTER TABLE "persona_moral_representantes" DROP CONSTRAINT "persona_moral_representantes_creado_por_id_fkey";

-- DropForeignKey
ALTER TABLE "persona_moral_representantes" DROP CONSTRAINT "persona_moral_representantes_documento_soporte_id_fkey";

-- DropForeignKey
ALTER TABLE "persona_moral_representantes" DROP CONSTRAINT "persona_moral_representantes_instrumento_id_fkey";

-- DropForeignKey
ALTER TABLE "persona_moral_representantes" DROP CONSTRAINT "persona_moral_representantes_persona_moral_id_fkey";

-- DropForeignKey
ALTER TABLE "persona_moral_representantes" DROP CONSTRAINT "persona_moral_representantes_representante_persona_fisica__fkey";

-- DropForeignKey
ALTER TABLE "personas_fisicas" DROP CONSTRAINT "personas_fisicas_compareciente_id_fkey";

-- DropForeignKey
ALTER TABLE "personas_morales" DROP CONSTRAINT "personas_morales_compareciente_id_fkey";

-- DropForeignKey
ALTER TABLE "relaciones_conyugales" DROP CONSTRAINT "relaciones_conyugales_documento_soporte_id_fkey";

-- DropForeignKey
ALTER TABLE "relaciones_conyugales" DROP CONSTRAINT "relaciones_conyugales_persona_1_id_fkey";

-- DropForeignKey
ALTER TABLE "relaciones_conyugales" DROP CONSTRAINT "relaciones_conyugales_persona_2_id_fkey";

-- DropForeignKey
ALTER TABLE "tipo_acto_caracteres_compareciente" DROP CONSTRAINT "tipo_acto_caracteres_compareciente_caracter_id_fkey";

-- DropForeignKey
ALTER TABLE "tipo_acto_caracteres_compareciente" DROP CONSTRAINT "tipo_acto_caracteres_compareciente_tipo_acto_id_fkey";

-- DropIndex
DROP INDEX "idx_ai_usage_alta_session_fk";

-- DropIndex
DROP INDEX "idx_audit_logs_user_fk";

-- DropIndex
DROP INDEX "idx_checklist_items_tipo_acto_fk";

-- DropIndex
DROP INDEX "idx_comp_actividades_actividad_fk";

-- DropIndex
DROP INDEX "idx_alta_sessions_origen_expediente_fk";

-- DropIndex
DROP INDEX "idx_comp_contactos_creador_fk";

-- DropIndex
DROP INDEX "idx_comp_datos_fuente_carga_fk";

-- DropIndex
DROP INDEX "idx_comp_datos_fuente_confirmador_fk";

-- DropIndex
DROP INDEX "idx_comp_datos_fuente_documento_fk";

-- DropIndex
DROP INDEX "idx_comp_documentos_creador_fk";

-- DropIndex
DROP INDEX "idx_comp_documentos_documento_fk";

-- DropIndex
DROP INDEX "idx_comp_documentos_validador_fk";

-- DropIndex
DROP INDEX "compareciente_domicilios_documento_comprobante_id_idx";

-- DropIndex
DROP INDEX "idx_comp_domicilios_creador_fk";

-- DropIndex
DROP INDEX "idx_comp_identificaciones_creador_fk";

-- DropIndex
DROP INDEX "idx_comp_identificaciones_documento_fk";

-- DropIndex
DROP INDEX "idx_comp_identificaciones_validador_fk";

-- DropIndex
DROP INDEX "idx_comparecientes_creado_por_fk";

-- DropIndex
DROP INDEX "idx_compliance_evidence_agregado_fk";

-- DropIndex
DROP INDEX "compliance_reviews_supersedes_review_id_idx";

-- DropIndex
DROP INDEX "idx_compliance_reviews_creador_fk";

-- DropIndex
DROP INDEX "idx_compliance_reviews_revisor_fk";

-- DropIndex
DROP INDEX "idx_compliance_reviews_rule_fk";

-- DropIndex
DROP INDEX "idx_compliance_rules_aprobador_fk";

-- DropIndex
DROP INDEX "idx_compliance_rules_creador_fk";

-- DropIndex
DROP INDEX "idx_com_documentos_creador_fk";

-- DropIndex
DROP INDEX "idx_com_documentos_documento_fk";

-- DropIndex
DROP INDEX "idx_comunicaciones_expediente_fk";

-- DropIndex
DROP INDEX "idx_comunicaciones_user_fk";

-- DropIndex
DROP INDEX "idx_cot_documentos_creador_fk";

-- DropIndex
DROP INDEX "idx_cot_documentos_documento_fk";

-- DropIndex
DROP INDEX "idx_cot_seguimientos_cotizacion_fk";

-- DropIndex
DROP INDEX "idx_cot_seguimientos_usuario_fk";

-- DropIndex
DROP INDEX "idx_cotizaciones_notaria_fk";

-- DropIndex
DROP INDEX "idx_cotizaciones_user_fk";

-- DropIndex
DROP INDEX "idx_documentos_cotizacion_fk";

-- DropIndex
DROP INDEX "idx_documentos_expediente_fk";

-- DropIndex
DROP INDEX "idx_documentos_prospecto_fk";

-- DropIndex
DROP INDEX "idx_documentos_subido_por_fk";

-- DropIndex
DROP INDEX "idx_outbox_actor_fk";

-- DropIndex
DROP INDEX "eventos_agenda_estatus_idx";

-- DropIndex
DROP INDEX "eventos_agenda_expediente_idx";

-- DropIndex
DROP INDEX "eventos_agenda_fecha_inicio_idx";

-- DropIndex
DROP INDEX "eventos_agenda_user_fecha_idx";

-- DropIndex
DROP INDEX "idx_agenda_cancelado_por_fk";

-- DropIndex
DROP INDEX "idx_agenda_compareciente_fk";

-- DropIndex
DROP INDEX "idx_exp_actividades_expediente_fk";

-- DropIndex
DROP INDEX "idx_exp_actividades_usuario_fk";

-- DropIndex
DROP INDEX "idx_exp_comparecientes_caracter_fk";

-- DropIndex
DROP INDEX "idx_exp_comparecientes_compareciente_fk";

-- DropIndex
DROP INDEX "idx_exp_comparecientes_creador_fk";

-- DropIndex
DROP INDEX "idx_exp_comparecientes_validador_fk";

-- DropIndex
DROP INDEX "idx_exp_documentos_creador_fk";

-- DropIndex
DROP INDEX "idx_exp_documentos_documento_fk";

-- DropIndex
DROP INDEX "expediente_entregas_registrado_por_id_idx";

-- DropIndex
DROP INDEX "idx_exp_estatus_log_expediente_fk";

-- DropIndex
DROP INDEX "idx_exp_etapas_expediente_fk";

-- DropIndex
DROP INDEX "idx_exp_etapas_flujo_etapa_fk";

-- DropIndex
DROP INDEX "idx_exp_etapas_flujo_version_fk";

-- DropIndex
DROP INDEX "idx_exp_rep_caracter_fk";

-- DropIndex
DROP INDEX "idx_exp_rep_creador_fk";

-- DropIndex
DROP INDEX "idx_exp_rep_expediente_fk";

-- DropIndex
DROP INDEX "idx_exp_rep_instrumento_fk";

-- DropIndex
DROP INDEX "idx_exp_rep_representado_fk";

-- DropIndex
DROP INDEX "idx_exp_rep_representante_fk";

-- DropIndex
DROP INDEX "idx_exp_rep_validador_fk";

-- DropIndex
DROP INDEX "idx_exp_rep_vinculo_representado_fk";

-- DropIndex
DROP INDEX "idx_exp_rep_vinculo_representante_fk";

-- DropIndex
DROP INDEX "idx_exp_requisitos_expediente_fk";

-- DropIndex
DROP INDEX "idx_expedientes_abogado_fk";

-- DropIndex
DROP INDEX "idx_expedientes_archivado_por_fk";

-- DropIndex
DROP INDEX "idx_expedientes_creador_fk";

-- DropIndex
DROP INDEX "idx_expedientes_flujo_version_fk";

-- DropIndex
DROP INDEX "idx_expedientes_formulario_version_fk";

-- DropIndex
DROP INDEX "idx_expedientes_gestor_fk";

-- DropIndex
DROP INDEX "idx_expedientes_notaria_fk";

-- DropIndex
DROP INDEX "idx_expedientes_plantilla_version_fk";

-- DropIndex
DROP INDEX "idx_expedientes_tipo_acto_fk";

-- DropIndex
DROP INDEX "idx_flujo_versiones_creador_fk";

-- DropIndex
DROP INDEX "idx_formulario_versiones_creador_fk";

-- DropIndex
DROP INDEX "idx_mov_documentos_creador_fk";

-- DropIndex
DROP INDEX "idx_mov_documentos_documento_fk";

-- DropIndex
DROP INDEX "idx_movimientos_capturado_por_fk";

-- DropIndex
DROP INDEX "idx_movimientos_cotizacion_fk";

-- DropIndex
DROP INDEX "idx_movimientos_expediente_fk";

-- DropIndex
DROP INDEX "idx_movimientos_origen_fk";

-- DropIndex
DROP INDEX "idx_movimientos_revertido_por_fk";

-- DropIndex
DROP INDEX "idx_movimientos_validado_por_fk";

-- DropIndex
DROP INDEX "idx_notaria_contactos_notaria_fk";

-- DropIndex
DROP INDEX "idx_notas_user_fk";

-- DropIndex
DROP INDEX "idx_pagos_cotizacion_fk";

-- DropIndex
DROP INDEX "idx_pagos_expediente_fk";

-- DropIndex
DROP INDEX "idx_pm_instrumentos_creador_fk";

-- DropIndex
DROP INDEX "idx_pm_instrumentos_documento_fk";

-- DropIndex
DROP INDEX "idx_pm_instrumentos_persona_fk";

-- DropIndex
DROP INDEX "idx_pm_instrumentos_validador_fk";

-- DropIndex
DROP INDEX "idx_pm_representantes_caracter_fk";

-- DropIndex
DROP INDEX "idx_pm_representantes_creador_fk";

-- DropIndex
DROP INDEX "idx_pm_representantes_documento_fk";

-- DropIndex
DROP INDEX "idx_pm_representantes_instrumento_fk";

-- DropIndex
DROP INDEX "idx_pm_representantes_persona_fisica_fk";

-- DropIndex
DROP INDEX "idx_pm_representantes_persona_fk";

-- DropIndex
DROP INDEX "idx_plantilla_versiones_creador_fk";

-- DropIndex
DROP INDEX "idx_pros_documentos_creador_fk";

-- DropIndex
DROP INDEX "idx_pros_documentos_documento_fk";

-- DropIndex
DROP INDEX "idx_pros_seguimientos_prospecto_fk";

-- DropIndex
DROP INDEX "idx_pros_seguimientos_usuario_fk";

-- DropIndex
DROP INDEX "idx_prospectos_archivado_por_fk";

-- DropIndex
DROP INDEX "idx_prospectos_user_fk";

-- DropIndex
DROP INDEX "idx_rel_conyugales_documento_fk";

-- DropIndex
DROP INDEX "idx_rel_conyugales_persona_1_fk";

-- DropIndex
DROP INDEX "idx_rel_conyugales_persona_2_fk";

-- DropIndex
DROP INDEX "idx_requisito_vinculos_creador_fk";

-- DropIndex
DROP INDEX "idx_requisito_vinculos_documento_fk";

-- DropIndex
DROP INDEX "idx_storage_jobs_carga_fk";

-- DropIndex
DROP INDEX "idx_tareas_asignado_fk";

-- DropIndex
DROP INDEX "idx_tareas_creador_fk";

-- DropIndex
DROP INDEX "idx_tareas_expediente_fk";

-- DropIndex
DROP INDEX "idx_tareas_externas_expediente_fk";

-- DropIndex
DROP INDEX "tareas_externas_gestionado_por_id_idx";

-- DropIndex
DROP INDEX "idx_tipo_acto_caracter_caracter_fk";

-- AlterTable
ALTER TABLE "actividades_economicas" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "ai_usage_logs" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "auth_sessions" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "caracteres_compareciente" ALTER COLUMN "id" DROP DEFAULT,
ALTER COLUMN "clave" SET DATA TYPE TEXT,
ALTER COLUMN "nombre" SET DATA TYPE TEXT,
ALTER COLUMN "activo" SET NOT NULL,
ALTER COLUMN "created_at" SET NOT NULL,
ALTER COLUMN "created_at" SET DATA TYPE TIMESTAMP(3);

-- AlterTable
ALTER TABLE "caracteres_representacion" ALTER COLUMN "id" DROP DEFAULT,
ALTER COLUMN "clave" SET DATA TYPE TEXT,
ALTER COLUMN "nombre" SET DATA TYPE TEXT,
ALTER COLUMN "activo" SET NOT NULL,
ALTER COLUMN "created_at" SET NOT NULL,
ALTER COLUMN "created_at" SET DATA TYPE TIMESTAMP(3);

-- AlterTable
ALTER TABLE "carga_temporal_documentos" ALTER COLUMN "id" DROP DEFAULT,
ALTER COLUMN "updated_at" DROP DEFAULT;

-- AlterTable
ALTER TABLE "compareciente_actividades_economicas" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "compareciente_aliases" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "compareciente_alta_sessions" ALTER COLUMN "id" DROP DEFAULT,
ALTER COLUMN "updated_at" DROP DEFAULT;

-- AlterTable
ALTER TABLE "compareciente_contactos" ALTER COLUMN "id" DROP DEFAULT,
ALTER COLUMN "valor" SET DATA TYPE TEXT,
ALTER COLUMN "principal" SET NOT NULL,
ALTER COLUMN "validado" SET NOT NULL,
ALTER COLUMN "fecha_validacion" SET DATA TYPE TIMESTAMP(3),
ALTER COLUMN "activo" SET NOT NULL,
ALTER COLUMN "created_at" SET NOT NULL,
ALTER COLUMN "created_at" SET DATA TYPE TIMESTAMP(3),
ALTER COLUMN "updated_at" SET NOT NULL,
ALTER COLUMN "updated_at" DROP DEFAULT,
ALTER COLUMN "updated_at" SET DATA TYPE TIMESTAMP(3),
ALTER COLUMN "archived_at" SET DATA TYPE TIMESTAMP(3);

-- AlterTable
ALTER TABLE "compareciente_datos_fuente" ALTER COLUMN "id" DROP DEFAULT,
ALTER COLUMN "updated_at" DROP DEFAULT;

-- AlterTable
ALTER TABLE "compareciente_documentos" ALTER COLUMN "id" DROP DEFAULT,
ALTER COLUMN "subcategoria" SET DATA TYPE TEXT,
ALTER COLUMN "principal" SET NOT NULL,
ALTER COLUMN "fecha_documento" SET DATA TYPE TIMESTAMP(3),
ALTER COLUMN "fecha_vencimiento" SET DATA TYPE TIMESTAMP(3),
ALTER COLUMN "fecha_validacion" SET DATA TYPE TIMESTAMP(3),
ALTER COLUMN "estatus" SET NOT NULL,
ALTER COLUMN "created_at" SET NOT NULL,
ALTER COLUMN "created_at" SET DATA TYPE TIMESTAMP(3),
ALTER COLUMN "updated_at" SET NOT NULL,
ALTER COLUMN "updated_at" DROP DEFAULT,
ALTER COLUMN "updated_at" SET DATA TYPE TIMESTAMP(3),
ALTER COLUMN "archived_at" SET DATA TYPE TIMESTAMP(3);

-- AlterTable
ALTER TABLE "compareciente_domicilios" ALTER COLUMN "id" DROP DEFAULT,
ALTER COLUMN "pais" SET NOT NULL,
ALTER COLUMN "pais" SET DATA TYPE TEXT,
ALTER COLUMN "estado" SET DATA TYPE TEXT,
ALTER COLUMN "municipio" SET DATA TYPE TEXT,
ALTER COLUMN "localidad" SET DATA TYPE TEXT,
ALTER COLUMN "colonia" SET DATA TYPE TEXT,
ALTER COLUMN "calle" SET DATA TYPE TEXT,
ALTER COLUMN "exterior" SET DATA TYPE TEXT,
ALTER COLUMN "interior" SET DATA TYPE TEXT,
ALTER COLUMN "codigo_postal" SET DATA TYPE TEXT,
ALTER COLUMN "principal" SET NOT NULL,
ALTER COLUMN "vigente" SET NOT NULL,
ALTER COLUMN "fecha_inicio" SET DATA TYPE TIMESTAMP(3),
ALTER COLUMN "fecha_terminacion" SET DATA TYPE TIMESTAMP(3),
ALTER COLUMN "created_at" SET NOT NULL,
ALTER COLUMN "created_at" SET DATA TYPE TIMESTAMP(3),
ALTER COLUMN "updated_at" SET NOT NULL,
ALTER COLUMN "updated_at" DROP DEFAULT,
ALTER COLUMN "updated_at" SET DATA TYPE TIMESTAMP(3),
ALTER COLUMN "archived_at" SET DATA TYPE TIMESTAMP(3);

-- AlterTable
ALTER TABLE "compareciente_identificaciones" ALTER COLUMN "id" DROP DEFAULT,
ALTER COLUMN "numero" SET DATA TYPE TEXT,
ALTER COLUMN "autoridad_emisora" SET DATA TYPE TEXT,
ALTER COLUMN "pais_emisor" SET DATA TYPE TEXT,
ALTER COLUMN "fecha_expedicion" SET DATA TYPE TIMESTAMP(3),
ALTER COLUMN "fecha_vencimiento" SET DATA TYPE TIMESTAMP(3),
ALTER COLUMN "principal" SET NOT NULL,
ALTER COLUMN "estatus" SET NOT NULL,
ALTER COLUMN "validado_at" SET DATA TYPE TIMESTAMP(3),
ALTER COLUMN "created_at" SET NOT NULL,
ALTER COLUMN "created_at" SET DATA TYPE TIMESTAMP(3),
ALTER COLUMN "updated_at" SET NOT NULL,
ALTER COLUMN "updated_at" DROP DEFAULT,
ALTER COLUMN "updated_at" SET DATA TYPE TIMESTAMP(3),
ALTER COLUMN "archived_at" SET DATA TYPE TIMESTAMP(3);

-- AlterTable
ALTER TABLE "comparecientes" ALTER COLUMN "id" DROP DEFAULT,
ALTER COLUMN "nombre_busqueda" SET DATA TYPE TEXT,
ALTER COLUMN "created_at" SET NOT NULL,
ALTER COLUMN "created_at" SET DATA TYPE TIMESTAMP(3),
ALTER COLUMN "updated_at" SET NOT NULL,
ALTER COLUMN "updated_at" DROP DEFAULT,
ALTER COLUMN "updated_at" SET DATA TYPE TIMESTAMP(3),
ALTER COLUMN "archived_at" SET DATA TYPE TIMESTAMP(3);

-- AlterTable
ALTER TABLE "compliance_decisions" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "compliance_evidence" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "compliance_reviews" ALTER COLUMN "id" DROP DEFAULT,
ALTER COLUMN "updated_at" DROP DEFAULT;

-- AlterTable
ALTER TABLE "compliance_rule_sets" ALTER COLUMN "id" DROP DEFAULT,
ALTER COLUMN "updated_at" DROP DEFAULT;

-- AlterTable
ALTER TABLE "eventos_agenda" ALTER COLUMN "updated_at" DROP DEFAULT,
ALTER COLUMN "updated_at" SET DATA TYPE TIMESTAMP(3),
ALTER COLUMN "cancelado_at" SET DATA TYPE TIMESTAMP(3);

-- AlterTable
ALTER TABLE "expediente_comparecientes" ALTER COLUMN "id" DROP DEFAULT,
ALTER COLUMN "forma_comparecencia" SET NOT NULL,
ALTER COLUMN "orden_comparecencia" SET NOT NULL,
ALTER COLUMN "es_principal" SET NOT NULL,
ALTER COLUMN "estatus" SET NOT NULL,
ALTER COLUMN "estatus" SET DATA TYPE TEXT,
ALTER COLUMN "created_at" SET NOT NULL,
ALTER COLUMN "created_at" SET DATA TYPE TIMESTAMP(3),
ALTER COLUMN "updated_at" SET NOT NULL,
ALTER COLUMN "updated_at" DROP DEFAULT,
ALTER COLUMN "updated_at" SET DATA TYPE TIMESTAMP(3),
ALTER COLUMN "archived_at" SET DATA TYPE TIMESTAMP(3),
ALTER COLUMN "validado_at" SET DATA TYPE TIMESTAMP(3);

-- AlterTable
ALTER TABLE "expediente_entregas" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "expediente_representaciones" ALTER COLUMN "id" DROP DEFAULT,
ALTER COLUMN "cargo_o_caracter_descripcion" SET DATA TYPE TEXT,
ALTER COLUMN "fecha_vigencia" SET DATA TYPE TIMESTAMP(3),
ALTER COLUMN "validada" SET NOT NULL,
ALTER COLUMN "created_at" SET NOT NULL,
ALTER COLUMN "created_at" SET DATA TYPE TIMESTAMP(3),
ALTER COLUMN "updated_at" SET NOT NULL,
ALTER COLUMN "updated_at" DROP DEFAULT,
ALTER COLUMN "updated_at" SET DATA TYPE TIMESTAMP(3),
ALTER COLUMN "archived_at" SET DATA TYPE TIMESTAMP(3);

-- AlterTable
ALTER TABLE "password_reset_tokens" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "persona_moral_instrumentos" ALTER COLUMN "id" DROP DEFAULT,
ALTER COLUMN "numero" SET DATA TYPE TEXT,
ALTER COLUMN "fecha" SET DATA TYPE TIMESTAMP(3),
ALTER COLUMN "notario_o_corredor" SET DATA TYPE TEXT,
ALTER COLUMN "numero_notaria_o_correduria" SET DATA TYPE TEXT,
ALTER COLUMN "municipio" SET DATA TYPE TEXT,
ALTER COLUMN "estado" SET DATA TYPE TEXT,
ALTER COLUMN "folio_mercantil" SET DATA TYPE TEXT,
ALTER COLUMN "fecha_inscripcion" SET DATA TYPE TIMESTAMP(3),
ALTER COLUMN "vigente" SET NOT NULL,
ALTER COLUMN "validado_at" SET DATA TYPE TIMESTAMP(3),
ALTER COLUMN "created_at" SET NOT NULL,
ALTER COLUMN "created_at" SET DATA TYPE TIMESTAMP(3),
ALTER COLUMN "updated_at" SET NOT NULL,
ALTER COLUMN "updated_at" DROP DEFAULT,
ALTER COLUMN "updated_at" SET DATA TYPE TIMESTAMP(3),
ALTER COLUMN "archived_at" SET DATA TYPE TIMESTAMP(3);

-- AlterTable
ALTER TABLE "persona_moral_representantes" ALTER COLUMN "id" DROP DEFAULT,
ALTER COLUMN "cargo_descripcion" SET DATA TYPE TEXT,
ALTER COLUMN "fecha_inicio" SET DATA TYPE TIMESTAMP(3),
ALTER COLUMN "fecha_fin" SET DATA TYPE TIMESTAMP(3),
ALTER COLUMN "vigente" SET NOT NULL,
ALTER COLUMN "principal" SET NOT NULL,
ALTER COLUMN "created_at" SET NOT NULL,
ALTER COLUMN "created_at" SET DATA TYPE TIMESTAMP(3),
ALTER COLUMN "updated_at" SET NOT NULL,
ALTER COLUMN "updated_at" DROP DEFAULT,
ALTER COLUMN "updated_at" SET DATA TYPE TIMESTAMP(3),
ALTER COLUMN "archived_at" SET DATA TYPE TIMESTAMP(3);

-- AlterTable
ALTER TABLE "personas_fisicas" ALTER COLUMN "id" DROP DEFAULT,
ALTER COLUMN "nombre" SET DATA TYPE TEXT,
ALTER COLUMN "apellido_paterno" SET DATA TYPE TEXT,
ALTER COLUMN "apellido_materno" SET DATA TYPE TEXT,
ALTER COLUMN "nombre_completo_calculado" SET DATA TYPE TEXT,
ALTER COLUMN "fecha_nacimiento" SET DATA TYPE TIMESTAMP(3),
ALTER COLUMN "lugar_nacimiento" SET DATA TYPE TEXT,
ALTER COLUMN "nacionalidad" SET NOT NULL,
ALTER COLUMN "nacionalidad" SET DATA TYPE TEXT,
ALTER COLUMN "curp" SET DATA TYPE TEXT,
ALTER COLUMN "rfc" SET DATA TYPE TEXT,
ALTER COLUMN "ocupacion" SET DATA TYPE TEXT,
ALTER COLUMN "calidad_migratoria" SET DATA TYPE TEXT,
ALTER COLUMN "actividad_economica" SET DATA TYPE TEXT,
ALTER COLUMN "requiere_interprete" SET NOT NULL,
ALTER COLUMN "idioma" SET DATA TYPE TEXT,
ALTER COLUMN "pep" SET NOT NULL,
ALTER COLUMN "relacion_pep" SET DATA TYPE TEXT,
ALTER COLUMN "created_at" SET NOT NULL,
ALTER COLUMN "created_at" SET DATA TYPE TIMESTAMP(3),
ALTER COLUMN "updated_at" SET NOT NULL,
ALTER COLUMN "updated_at" DROP DEFAULT,
ALTER COLUMN "updated_at" SET DATA TYPE TIMESTAMP(3),
ALTER COLUMN "archived_at" SET DATA TYPE TIMESTAMP(3),
ALTER COLUMN "pais_nacimiento" SET DATA TYPE TEXT,
ALTER COLUMN "escolaridad" SET DATA TYPE TEXT,
ALTER COLUMN "giro" SET DATA TYPE TEXT;

-- AlterTable
ALTER TABLE "personas_morales" ALTER COLUMN "id" DROP DEFAULT,
ALTER COLUMN "razon_social" SET DATA TYPE TEXT,
ALTER COLUMN "nombre_comercial" SET DATA TYPE TEXT,
ALTER COLUMN "tipo_societario" SET DATA TYPE TEXT,
ALTER COLUMN "nacionalidad" SET NOT NULL,
ALTER COLUMN "nacionalidad" SET DATA TYPE TEXT,
ALTER COLUMN "rfc" SET DATA TYPE TEXT,
ALTER COLUMN "fecha_constitucion" SET DATA TYPE TIMESTAMP(3),
ALTER COLUMN "duracion" SET DATA TYPE TEXT,
ALTER COLUMN "folio_mercantil" SET DATA TYPE TEXT,
ALTER COLUMN "fecha_inscripcion_mercantil" SET DATA TYPE TIMESTAMP(3),
ALTER COLUMN "estatus_societario" SET DATA TYPE TEXT,
ALTER COLUMN "created_at" SET NOT NULL,
ALTER COLUMN "created_at" SET DATA TYPE TIMESTAMP(3),
ALTER COLUMN "updated_at" SET NOT NULL,
ALTER COLUMN "updated_at" DROP DEFAULT,
ALTER COLUMN "updated_at" SET DATA TYPE TIMESTAMP(3),
ALTER COLUMN "archived_at" SET DATA TYPE TIMESTAMP(3);

-- AlterTable
ALTER TABLE "relaciones_conyugales" ALTER COLUMN "id" DROP DEFAULT,
ALTER COLUMN "regimen_matrimonial" SET NOT NULL,
ALTER COLUMN "fecha_matrimonio" SET DATA TYPE TIMESTAMP(3),
ALTER COLUMN "lugar_matrimonio" SET DATA TYPE TEXT,
ALTER COLUMN "vigente" SET NOT NULL,
ALTER COLUMN "created_at" SET NOT NULL,
ALTER COLUMN "created_at" SET DATA TYPE TIMESTAMP(3),
ALTER COLUMN "updated_at" SET NOT NULL,
ALTER COLUMN "updated_at" DROP DEFAULT,
ALTER COLUMN "updated_at" SET DATA TYPE TIMESTAMP(3),
ALTER COLUMN "archived_at" SET DATA TYPE TIMESTAMP(3);

-- AlterTable
ALTER TABLE "storage_compensation_jobs" ALTER COLUMN "id" DROP DEFAULT,
ALTER COLUMN "updated_at" DROP DEFAULT;

-- AlterTable
ALTER TABLE "tareas_externas" ALTER COLUMN "updated_at" DROP DEFAULT;

-- AlterTable
ALTER TABLE "tipo_acto_caracteres_compareciente" ALTER COLUMN "id" DROP DEFAULT,
ALTER COLUMN "sugerido" SET NOT NULL,
ALTER COLUMN "orden" SET NOT NULL;

-- DropEnum
DROP TYPE "ComparecePor";

-- CreateIndex
CREATE UNIQUE INDEX "compareciente_alta_sessions_usuario_id_idempotency_key_key" ON "compareciente_alta_sessions"("usuario_id", "idempotency_key");

-- CreateIndex
CREATE INDEX "personas_fisicas_curp_idx" ON "personas_fisicas"("curp");

-- CreateIndex
CREATE INDEX "personas_fisicas_rfc_idx" ON "personas_fisicas"("rfc");

-- CreateIndex
CREATE INDEX "personas_morales_rfc_idx" ON "personas_morales"("rfc");

-- CreateIndex
CREATE UNIQUE INDEX "relaciones_conyugales_persona_1_id_persona_2_id_key" ON "relaciones_conyugales"("persona_1_id", "persona_2_id");

-- RenameForeignKey
ALTER TABLE "carga_temporal_documentos" RENAME CONSTRAINT "fk_carga_temporal_session" TO "carga_temporal_documentos_alta_session_id_fkey";

-- RenameForeignKey
ALTER TABLE "carga_temporal_documentos" RENAME CONSTRAINT "fk_carga_temporal_usuario" TO "carga_temporal_documentos_usuario_id_fkey";

-- RenameForeignKey
ALTER TABLE "compareciente_actividades_economicas" RENAME CONSTRAINT "fk_comp_actividades_act" TO "compareciente_actividades_economicas_actividad_id_fkey";

-- RenameForeignKey
ALTER TABLE "compareciente_actividades_economicas" RENAME CONSTRAINT "fk_comp_actividades_comp" TO "compareciente_actividades_economicas_compareciente_id_fkey";

-- RenameForeignKey
ALTER TABLE "compareciente_aliases" RENAME CONSTRAINT "fk_compareciente_aliases_comp" TO "compareciente_aliases_compareciente_id_fkey";

-- RenameForeignKey
ALTER TABLE "compareciente_alta_sessions" RENAME CONSTRAINT "fk_alta_session_expediente" TO "compareciente_alta_sessions_origen_expediente_id_fkey";

-- RenameForeignKey
ALTER TABLE "compareciente_alta_sessions" RENAME CONSTRAINT "fk_alta_session_usuario" TO "compareciente_alta_sessions_usuario_id_fkey";

-- RenameForeignKey
ALTER TABLE "compareciente_datos_fuente" RENAME CONSTRAINT "fk_datos_fuente_carga_temporal" TO "compareciente_datos_fuente_carga_temporal_id_fkey";

-- RenameForeignKey
ALTER TABLE "compareciente_datos_fuente" RENAME CONSTRAINT "fk_datos_fuente_compareciente" TO "compareciente_datos_fuente_compareciente_id_fkey";

-- RenameForeignKey
ALTER TABLE "compareciente_datos_fuente" RENAME CONSTRAINT "fk_datos_fuente_confirmador" TO "compareciente_datos_fuente_confirmado_por_id_fkey";

-- RenameForeignKey
ALTER TABLE "compareciente_datos_fuente" RENAME CONSTRAINT "fk_datos_fuente_documento" TO "compareciente_datos_fuente_documento_id_fkey";

-- RenameForeignKey
ALTER TABLE "storage_compensation_jobs" RENAME CONSTRAINT "fk_storage_job_carga_temporal" TO "storage_compensation_jobs_carga_temporal_id_fkey";

-- AddForeignKey
ALTER TABLE "documentos" ADD CONSTRAINT "documentos_compareciente_id_fkey" FOREIGN KEY ("compareciente_id") REFERENCES "comparecientes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "comparecientes" ADD CONSTRAINT "comparecientes_creado_por_id_fkey" FOREIGN KEY ("creado_por_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "personas_fisicas" ADD CONSTRAINT "personas_fisicas_compareciente_id_fkey" FOREIGN KEY ("compareciente_id") REFERENCES "comparecientes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "relaciones_conyugales" ADD CONSTRAINT "relaciones_conyugales_persona_1_id_fkey" FOREIGN KEY ("persona_1_id") REFERENCES "personas_fisicas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "relaciones_conyugales" ADD CONSTRAINT "relaciones_conyugales_persona_2_id_fkey" FOREIGN KEY ("persona_2_id") REFERENCES "personas_fisicas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "relaciones_conyugales" ADD CONSTRAINT "relaciones_conyugales_documento_soporte_id_fkey" FOREIGN KEY ("documento_soporte_id") REFERENCES "documentos"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "personas_morales" ADD CONSTRAINT "personas_morales_compareciente_id_fkey" FOREIGN KEY ("compareciente_id") REFERENCES "comparecientes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "persona_moral_instrumentos" ADD CONSTRAINT "persona_moral_instrumentos_persona_moral_id_fkey" FOREIGN KEY ("persona_moral_id") REFERENCES "personas_morales"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "persona_moral_instrumentos" ADD CONSTRAINT "persona_moral_instrumentos_documento_soporte_id_fkey" FOREIGN KEY ("documento_soporte_id") REFERENCES "documentos"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "persona_moral_instrumentos" ADD CONSTRAINT "persona_moral_instrumentos_creado_por_id_fkey" FOREIGN KEY ("creado_por_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "persona_moral_instrumentos" ADD CONSTRAINT "persona_moral_instrumentos_validado_por_id_fkey" FOREIGN KEY ("validado_por_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "compareciente_domicilios" ADD CONSTRAINT "compareciente_domicilios_compareciente_id_fkey" FOREIGN KEY ("compareciente_id") REFERENCES "comparecientes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "compareciente_domicilios" ADD CONSTRAINT "compareciente_domicilios_creado_por_id_fkey" FOREIGN KEY ("creado_por_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "compareciente_domicilios" ADD CONSTRAINT "compareciente_domicilios_documento_comprobante_id_fkey" FOREIGN KEY ("documento_comprobante_id") REFERENCES "documentos"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "compareciente_contactos" ADD CONSTRAINT "compareciente_contactos_compareciente_id_fkey" FOREIGN KEY ("compareciente_id") REFERENCES "comparecientes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "compareciente_contactos" ADD CONSTRAINT "compareciente_contactos_creado_por_id_fkey" FOREIGN KEY ("creado_por_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "compareciente_identificaciones" ADD CONSTRAINT "compareciente_identificaciones_compareciente_id_fkey" FOREIGN KEY ("compareciente_id") REFERENCES "comparecientes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "compareciente_identificaciones" ADD CONSTRAINT "compareciente_identificaciones_documento_id_fkey" FOREIGN KEY ("documento_id") REFERENCES "documentos"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "compareciente_identificaciones" ADD CONSTRAINT "compareciente_identificaciones_creado_por_id_fkey" FOREIGN KEY ("creado_por_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "compareciente_identificaciones" ADD CONSTRAINT "compareciente_identificaciones_validado_por_id_fkey" FOREIGN KEY ("validado_por_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "compareciente_documentos" ADD CONSTRAINT "compareciente_documentos_compareciente_id_fkey" FOREIGN KEY ("compareciente_id") REFERENCES "comparecientes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "compareciente_documentos" ADD CONSTRAINT "compareciente_documentos_documento_id_fkey" FOREIGN KEY ("documento_id") REFERENCES "documentos"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "compareciente_documentos" ADD CONSTRAINT "compareciente_documentos_creado_por_id_fkey" FOREIGN KEY ("creado_por_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "compareciente_documentos" ADD CONSTRAINT "compareciente_documentos_validado_por_id_fkey" FOREIGN KEY ("validado_por_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "persona_moral_representantes" ADD CONSTRAINT "persona_moral_representantes_persona_moral_id_fkey" FOREIGN KEY ("persona_moral_id") REFERENCES "personas_morales"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "persona_moral_representantes" ADD CONSTRAINT "persona_moral_representantes_representante_persona_fisica__fkey" FOREIGN KEY ("representante_persona_fisica_id") REFERENCES "personas_fisicas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "persona_moral_representantes" ADD CONSTRAINT "persona_moral_representantes_caracter_representacion_id_fkey" FOREIGN KEY ("caracter_representacion_id") REFERENCES "caracteres_representacion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "persona_moral_representantes" ADD CONSTRAINT "persona_moral_representantes_instrumento_id_fkey" FOREIGN KEY ("instrumento_id") REFERENCES "persona_moral_instrumentos"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "persona_moral_representantes" ADD CONSTRAINT "persona_moral_representantes_creado_por_id_fkey" FOREIGN KEY ("creado_por_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tipo_acto_caracteres_compareciente" ADD CONSTRAINT "tipo_acto_caracteres_compareciente_tipo_acto_id_fkey" FOREIGN KEY ("tipo_acto_id") REFERENCES "tipos_acto"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tipo_acto_caracteres_compareciente" ADD CONSTRAINT "tipo_acto_caracteres_compareciente_caracter_id_fkey" FOREIGN KEY ("caracter_id") REFERENCES "caracteres_compareciente"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expediente_comparecientes" ADD CONSTRAINT "expediente_comparecientes_expediente_id_fkey" FOREIGN KEY ("expediente_id") REFERENCES "expedientes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expediente_comparecientes" ADD CONSTRAINT "expediente_comparecientes_compareciente_id_fkey" FOREIGN KEY ("compareciente_id") REFERENCES "comparecientes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expediente_comparecientes" ADD CONSTRAINT "expediente_comparecientes_caracter_id_fkey" FOREIGN KEY ("caracter_id") REFERENCES "caracteres_compareciente"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expediente_comparecientes" ADD CONSTRAINT "expediente_comparecientes_creado_por_id_fkey" FOREIGN KEY ("creado_por_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expediente_representaciones" ADD CONSTRAINT "expediente_representaciones_expediente_id_fkey" FOREIGN KEY ("expediente_id") REFERENCES "expedientes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expediente_representaciones" ADD CONSTRAINT "expediente_representaciones_representado_compareciente_id_fkey" FOREIGN KEY ("representado_compareciente_id") REFERENCES "comparecientes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expediente_representaciones" ADD CONSTRAINT "expediente_representaciones_representante_compareciente_id_fkey" FOREIGN KEY ("representante_compareciente_id") REFERENCES "comparecientes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expediente_representaciones" ADD CONSTRAINT "fk_exp_rep_compareciente_representado" FOREIGN KEY ("expediente_compareciente_representado_id") REFERENCES "expediente_comparecientes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expediente_representaciones" ADD CONSTRAINT "fk_exp_rep_compareciente_representante" FOREIGN KEY ("expediente_compareciente_representante_id") REFERENCES "expediente_comparecientes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expediente_representaciones" ADD CONSTRAINT "expediente_representaciones_caracter_representacion_id_fkey" FOREIGN KEY ("caracter_representacion_id") REFERENCES "caracteres_representacion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expediente_representaciones" ADD CONSTRAINT "expediente_representaciones_instrumento_representacion_id_fkey" FOREIGN KEY ("instrumento_representacion_id") REFERENCES "persona_moral_instrumentos"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expediente_representaciones" ADD CONSTRAINT "expediente_representaciones_creado_por_id_fkey" FOREIGN KEY ("creado_por_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expediente_representaciones" ADD CONSTRAINT "expediente_representaciones_validado_por_id_fkey" FOREIGN KEY ("validado_por_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "eventos_agenda" ADD CONSTRAINT "eventos_agenda_cancelado_por_id_fkey" FOREIGN KEY ("cancelado_por_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "eventos_agenda" ADD CONSTRAINT "eventos_agenda_compareciente_id_fkey" FOREIGN KEY ("compareciente_id") REFERENCES "comparecientes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_usage_logs" ADD CONSTRAINT "ai_usage_logs_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_usage_logs" ADD CONSTRAINT "ai_usage_logs_expediente_id_fkey" FOREIGN KEY ("expediente_id") REFERENCES "expedientes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_usage_logs" ADD CONSTRAINT "ai_usage_logs_compareciente_alta_session_id_fkey" FOREIGN KEY ("compareciente_alta_session_id") REFERENCES "compareciente_alta_sessions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "compliance_rule_sets" ADD CONSTRAINT "compliance_rule_sets_creado_por_id_fkey" FOREIGN KEY ("creado_por_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "compliance_rule_sets" ADD CONSTRAINT "compliance_rule_sets_aprobado_por_id_fkey" FOREIGN KEY ("aprobado_por_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "compliance_reviews" ADD CONSTRAINT "compliance_reviews_expediente_id_fkey" FOREIGN KEY ("expediente_id") REFERENCES "expedientes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "compliance_reviews" ADD CONSTRAINT "compliance_reviews_rule_set_id_fkey" FOREIGN KEY ("rule_set_id") REFERENCES "compliance_rule_sets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "compliance_reviews" ADD CONSTRAINT "compliance_reviews_creado_por_id_fkey" FOREIGN KEY ("creado_por_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "compliance_reviews" ADD CONSTRAINT "compliance_reviews_revisado_por_id_fkey" FOREIGN KEY ("revisado_por_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "compliance_reviews" ADD CONSTRAINT "compliance_reviews_supersedes_review_id_fkey" FOREIGN KEY ("supersedes_review_id") REFERENCES "compliance_reviews"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "compliance_decisions" ADD CONSTRAINT "compliance_decisions_review_id_fkey" FOREIGN KEY ("review_id") REFERENCES "compliance_reviews"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "compliance_decisions" ADD CONSTRAINT "compliance_decisions_decidido_por_id_fkey" FOREIGN KEY ("decidido_por_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "compliance_evidence" ADD CONSTRAINT "compliance_evidence_review_id_fkey" FOREIGN KEY ("review_id") REFERENCES "compliance_reviews"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "compliance_evidence" ADD CONSTRAINT "compliance_evidence_documento_id_fkey" FOREIGN KEY ("documento_id") REFERENCES "documentos"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "compliance_evidence" ADD CONSTRAINT "compliance_evidence_agregado_por_id_fkey" FOREIGN KEY ("agregado_por_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- RenameIndex
ALTER INDEX "idx_actividades_economicas_clave" RENAME TO "actividades_economicas_clave_idx";

-- RenameIndex
ALTER INDEX "idx_actividades_economicas_descripcion" RENAME TO "actividades_economicas_descripcion_idx";

-- RenameIndex
ALTER INDEX "auth_sessions_user_revoked_expires_idx" RENAME TO "auth_sessions_user_id_revoked_at_expires_at_idx";

-- RenameIndex
ALTER INDEX "idx_cargas_temporales_estado" RENAME TO "carga_temporal_documentos_estado_idx";

-- RenameIndex
ALTER INDEX "idx_cargas_temporales_session" RENAME TO "carga_temporal_documentos_alta_session_id_idx";

-- RenameIndex
ALTER INDEX "idx_cargas_temporales_usuario" RENAME TO "carga_temporal_documentos_usuario_id_idx";

-- RenameIndex
ALTER INDEX "uq_compareciente_actividad" RENAME TO "compareciente_actividades_economicas_compareciente_id_activ_key";

-- RenameIndex
ALTER INDEX "idx_compareciente_aliases_alias" RENAME TO "compareciente_aliases_alias_idx";

-- RenameIndex
ALTER INDEX "idx_compareciente_aliases_comp" RENAME TO "compareciente_aliases_compareciente_id_idx";

-- RenameIndex
ALTER INDEX "idx_alta_sessions_expires_at" RENAME TO "compareciente_alta_sessions_expires_at_idx";

-- RenameIndex
ALTER INDEX "idx_alta_sessions_usuario_estatus" RENAME TO "compareciente_alta_sessions_usuario_id_estatus_idx";

-- RenameIndex
ALTER INDEX "idx_compareciente_datos_fuente_campo" RENAME TO "compareciente_datos_fuente_campo_idx";

-- RenameIndex
ALTER INDEX "idx_compareciente_datos_fuente_comp" RENAME TO "compareciente_datos_fuente_compareciente_id_idx";

-- RenameIndex
ALTER INDEX "uq_compareciente_doc" RENAME TO "compareciente_documentos_compareciente_id_documento_id_cate_key";

-- RenameIndex
ALTER INDEX "idx_comparecientes_nombre_busqueda" RENAME TO "comparecientes_nombre_busqueda_idx";

-- RenameIndex
ALTER INDEX "idx_comparecientes_tipo_persona" RENAME TO "comparecientes_tipo_persona_idx";

-- RenameIndex
ALTER INDEX "compliance_reviews_expediente_tipo_idx" RENAME TO "compliance_reviews_expediente_id_tipo_idx";

-- RenameIndex
ALTER INDEX "compliance_rule_sets_tipo_estatus_vigencia_idx" RENAME TO "compliance_rule_sets_tipo_estatus_vigencia_desde_idx";

-- RenameIndex
ALTER INDEX "conciliaciones_financieras_movimiento_id_transaccion_bancaria_i" RENAME TO "conciliaciones_financieras_movimiento_id_transaccion_bancar_key";

-- RenameIndex
ALTER INDEX "uq_expediente_compareciente_caracter" RENAME TO "expediente_comparecientes_expediente_id_compareciente_id_ca_key";

-- RenameIndex
ALTER INDEX "metas_honorarios_alcance_usuario_id_periodo_inicio_periodo_fin_" RENAME TO "metas_honorarios_alcance_usuario_id_periodo_inicio_periodo__key";

-- RenameIndex
ALTER INDEX "password_reset_tokens_user_used_expires_idx" RENAME TO "password_reset_tokens_user_id_used_at_expires_at_idx";

-- RenameIndex
ALTER INDEX "idx_personas_fisicas_nombre" RENAME TO "personas_fisicas_nombre_completo_calculado_idx";

-- RenameIndex
ALTER INDEX "idx_personas_morales_folio" RENAME TO "personas_morales_folio_mercantil_idx";

-- RenameIndex
ALTER INDEX "idx_personas_morales_razon" RENAME TO "personas_morales_razon_social_idx";

-- RenameIndex
ALTER INDEX "plantilla_documental_versiones_tipo_acto_id_notaria_id_activa_i" RENAME TO "plantilla_documental_versiones_tipo_acto_id_notaria_id_acti_idx";

-- RenameIndex
ALTER INDEX "plantilla_documental_versiones_tipo_acto_id_notaria_id_version_" RENAME TO "plantilla_documental_versiones_tipo_acto_id_notaria_id_vers_key";

-- RenameIndex
ALTER INDEX "idx_storage_compensation_jobs_estatus_exec" RENAME TO "storage_compensation_jobs_estatus_proxima_ejecucion_at_idx";

-- RenameIndex
ALTER INDEX "uq_tipo_acto_caracter" RENAME TO "tipo_acto_caracteres_compareciente_tipo_acto_id_caracter_id_key";
