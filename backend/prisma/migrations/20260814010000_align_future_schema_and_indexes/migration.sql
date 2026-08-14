-- Fase 15C: convergencia aditiva del schema futuro.
-- No elimina ni renombra objetos, no cambia tipos/defaults/nullability y no modifica datos.
-- Los índices soportan FKs operativas que no tenían un índice cuyo prefijo fuera la FK.

CREATE INDEX IF NOT EXISTS "idx_compliance_decisions_decidido_por_fk" ON "pravia_os"."compliance_decisions" ("decidido_por_id");
CREATE INDEX IF NOT EXISTS "idx_comprobantes_financieros_anulado_por_fk" ON "pravia_os"."comprobantes_financieros" ("anulado_por_id");
CREATE INDEX IF NOT EXISTS "idx_comprobantes_financieros_registrado_por_fk" ON "pravia_os"."comprobantes_financieros" ("registrado_por_id");
CREATE INDEX IF NOT EXISTS "idx_conciliaciones_financieras_conciliado_por_fk" ON "pravia_os"."conciliaciones_financieras" ("conciliado_por_id");
CREATE INDEX IF NOT EXISTS "idx_cuentas_financieras_creada_por_fk" ON "pravia_os"."cuentas_financieras" ("creada_por_id");
CREATE INDEX IF NOT EXISTS "idx_expediente_entregas_evidencia_documento_fk" ON "pravia_os"."expediente_entregas" ("evidencia_documento_id");
CREATE INDEX IF NOT EXISTS "idx_honorarios_generados_cotizacion_version_fk" ON "pravia_os"."honorarios_generados" ("cotizacion_version_id");
CREATE INDEX IF NOT EXISTS "idx_honorarios_generados_reconocido_por_fk" ON "pravia_os"."honorarios_generados" ("reconocido_por_id");
CREATE INDEX IF NOT EXISTS "idx_metas_honorarios_creada_por_fk" ON "pravia_os"."metas_honorarios" ("creada_por_id");
CREATE INDEX IF NOT EXISTS "idx_movimientos_financieros_aplicado_por_fk" ON "pravia_os"."movimientos_financieros" ("aplicado_por_id");
CREATE INDEX IF NOT EXISTS "idx_movimientos_financieros_cancelado_por_fk" ON "pravia_os"."movimientos_financieros" ("cancelado_por_id");
CREATE INDEX IF NOT EXISTS "idx_movimientos_financieros_compareciente_fk" ON "pravia_os"."movimientos_financieros" ("compareciente_id");
CREATE INDEX IF NOT EXISTS "idx_notifications_created_by_fk" ON "pravia_os"."notifications" ("created_by_id");
CREATE INDEX IF NOT EXISTS "idx_tareas_externas_evidencia_documento_fk" ON "pravia_os"."tareas_externas" ("evidencia_documento_id");
CREATE INDEX IF NOT EXISTS "idx_transacciones_estado_cuenta_importado_por_fk" ON "pravia_os"."transacciones_estado_cuenta" ("importado_por_id");
CREATE INDEX IF NOT EXISTS "idx_user_invitations_created_by_fk" ON "pravia_os"."user_invitations" ("created_by_id");

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM "pravia_os"."documentos" d
    LEFT JOIN "pravia_os"."comparecientes" c ON c."id" = d."compareciente_id"
    WHERE d."compareciente_id" IS NOT NULL AND c."id" IS NULL
  ) THEN
    RAISE EXCEPTION 'REFUSED_SCHEMA_MISMATCH: documentos.compareciente_id contiene referencias huérfanas';
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "idx_documentos_compareciente_fk" ON "pravia_os"."documentos" ("compareciente_id");
ALTER TABLE "pravia_os"."documentos" ADD CONSTRAINT "documentos_compareciente_id_fkey"
  FOREIGN KEY ("compareciente_id") REFERENCES "pravia_os"."comparecientes"("id")
  ON DELETE SET NULL ON UPDATE NO ACTION NOT VALID;
ALTER TABLE "pravia_os"."documentos" VALIDATE CONSTRAINT "documentos_compareciente_id_fkey";
