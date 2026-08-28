-- PRD-001: maestro tenant-owned de Predios/Inmuebles.
-- No transforma ni elimina datos legacy. Los JSON y snapshots existentes permanecen intactos.

CREATE TABLE "predios" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "organization_id" UUID NOT NULL,
  "apodo" VARCHAR(160),
  "clave_catastral" VARCHAR(180),
  "cuenta_predial" VARCHAR(180),
  "folio_real" VARCHAR(180),
  "datos_registrales" JSONB,
  "ubicacion_texto" VARCHAR(500),
  "calle" VARCHAR(180),
  "numero_exterior" VARCHAR(80),
  "numero_interior" VARCHAR(80),
  "colonia" VARCHAR(180),
  "localidad" VARCHAR(180),
  "municipio" VARCHAR(180),
  "estado" VARCHAR(180),
  "codigo_postal" VARCHAR(20),
  "pais" VARCHAR(120) DEFAULT 'México',
  "superficie_terreno_m2" DECIMAL(18,4),
  "superficie_construccion_m2" DECIMAL(18,4),
  "superficie_construccion_comercial_m2" DECIMAL(18,4),
  "valor_catastral" DECIMAL(18,2),
  "valor_avaluo" DECIMAL(18,2),
  "valor_operacion" DECIMAL(18,2),
  "regimen" VARCHAR(180),
  "descripcion" TEXT,
  "version" INTEGER NOT NULL DEFAULT 1,
  "created_by" UUID NOT NULL,
  "updated_by" UUID NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "archived_at" TIMESTAMP(3),
  CONSTRAINT "predios_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ck_predios_nonnegative" CHECK (
    COALESCE("superficie_terreno_m2", 0) >= 0 AND
    COALESCE("superficie_construccion_m2", 0) >= 0 AND
    COALESCE("superficie_construccion_comercial_m2", 0) >= 0 AND
    COALESCE("valor_catastral", 0) >= 0 AND
    COALESCE("valor_avaluo", 0) >= 0 AND
    COALESCE("valor_operacion", 0) >= 0
  )
);

CREATE TABLE "predio_colindancias" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "organization_id" UUID NOT NULL,
  "predio_id" UUID NOT NULL,
  "orden" INTEGER NOT NULL,
  "referencia" VARCHAR(180),
  "medida" DECIMAL(18,4),
  "unidad" VARCHAR(40),
  "colindante" VARCHAR(500),
  "descripcion" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "predio_colindancias_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ck_predio_colindancias_orden" CHECK ("orden" >= 0),
  CONSTRAINT "ck_predio_colindancias_medida" CHECK ("medida" IS NULL OR "medida" >= 0)
);

CREATE TABLE "expediente_predios" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "organization_id" UUID NOT NULL,
  "expediente_id" UUID NOT NULL,
  "predio_id" UUID NOT NULL,
  "estatus" "VinculoEstatus" NOT NULL DEFAULT 'ACTIVO',
  "idempotency_key" TEXT,
  "created_by" UUID NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "removed_at" TIMESTAMP(3),
  "removed_by" UUID,
  "removed_reason" TEXT,
  CONSTRAINT "expediente_predios_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "expediente_acto_predios" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "organization_id" UUID NOT NULL,
  "expediente_predio_id" UUID NOT NULL,
  "expediente_acto_id" UUID NOT NULL,
  "estatus" "VinculoEstatus" NOT NULL DEFAULT 'ACTIVO',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "removed_at" TIMESTAMP(3),
  CONSTRAINT "expediente_acto_predios_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "predio_documentos" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "organization_id" UUID NOT NULL,
  "predio_id" UUID NOT NULL,
  "documento_id" UUID NOT NULL,
  "tipo_vinculo" VARCHAR(120) NOT NULL,
  "estatus" "VinculoEstatus" NOT NULL DEFAULT 'ACTIVO',
  "creado_por_id" UUID NOT NULL,
  "fecha_vinculo" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "inactivado_at" TIMESTAMP(3),
  "inactivado_por_id" UUID,
  "motivo_inactivacion" TEXT,
  "observaciones" TEXT,
  CONSTRAINT "predio_documentos_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "predio_datos_fuente" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "organization_id" UUID NOT NULL,
  "predio_id" UUID NOT NULL,
  "extraccion_id" UUID NOT NULL,
  "campo" VARCHAR(120) NOT NULL,
  "valor_actual" TEXT,
  "valor_propuesto" TEXT,
  "documento_id" UUID NOT NULL,
  "pagina" INTEGER,
  "seccion" VARCHAR(180),
  "fragmento_fuente" VARCHAR(800),
  "proveedor_ia" VARCHAR(80) NOT NULL,
  "modelo_ia" VARCHAR(120) NOT NULL,
  "confianza" "CalidadLectura",
  "estado" "DatoFuenteEstado" NOT NULL DEFAULT 'PENDIENTE_CONFIRMACION',
  "decidido_por_id" UUID,
  "decidido_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "predio_datos_fuente_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "uq_predios_id_org" ON "predios"("id", "organization_id");
CREATE INDEX "idx_predios_org_archived" ON "predios"("organization_id", "archived_at");
CREATE INDEX "idx_predios_org_clave_catastral" ON "predios"("organization_id", "clave_catastral");
CREATE INDEX "idx_predios_org_cuenta_predial" ON "predios"("organization_id", "cuenta_predial");
CREATE INDEX "idx_predios_org_folio_real" ON "predios"("organization_id", "folio_real");
CREATE INDEX "idx_predios_created_by" ON "predios"("created_by");
CREATE INDEX "idx_predios_updated_by" ON "predios"("updated_by");
CREATE UNIQUE INDEX "uq_predios_clave_catastral_active" ON "predios"("organization_id", lower("clave_catastral")) WHERE "archived_at" IS NULL AND NULLIF(btrim("clave_catastral"), '') IS NOT NULL;
CREATE UNIQUE INDEX "uq_predios_cuenta_predial_active" ON "predios"("organization_id", lower("cuenta_predial")) WHERE "archived_at" IS NULL AND NULLIF(btrim("cuenta_predial"), '') IS NOT NULL;
CREATE UNIQUE INDEX "uq_predios_folio_real_active" ON "predios"("organization_id", lower("folio_real")) WHERE "archived_at" IS NULL AND NULLIF(btrim("folio_real"), '') IS NOT NULL;

CREATE UNIQUE INDEX "uq_predio_colindancias_orden" ON "predio_colindancias"("predio_id", "orden");
CREATE INDEX "idx_predio_colindancias_org_predio" ON "predio_colindancias"("organization_id", "predio_id");
CREATE UNIQUE INDEX "uq_expediente_predios_relation" ON "expediente_predios"("organization_id", "expediente_id", "predio_id");
CREATE UNIQUE INDEX "uq_expediente_predios_id_org" ON "expediente_predios"("id", "organization_id");
CREATE UNIQUE INDEX "uq_expediente_predios_idempotency" ON "expediente_predios"("organization_id", "expediente_id", "idempotency_key");
CREATE INDEX "idx_expediente_predios_org_exp_status" ON "expediente_predios"("organization_id", "expediente_id", "estatus");
CREATE INDEX "idx_expediente_predios_org_predio_status" ON "expediente_predios"("organization_id", "predio_id", "estatus");
CREATE INDEX "idx_expediente_predios_created_by" ON "expediente_predios"("created_by");
CREATE INDEX "idx_expediente_predios_removed_by" ON "expediente_predios"("removed_by");
CREATE UNIQUE INDEX "uq_expediente_acto_predios_relation" ON "expediente_acto_predios"("organization_id", "expediente_predio_id", "expediente_acto_id");
CREATE INDEX "idx_expediente_acto_predios_org_act_status" ON "expediente_acto_predios"("organization_id", "expediente_acto_id", "estatus");
CREATE INDEX "idx_expediente_acto_predios_relation" ON "expediente_acto_predios"("expediente_predio_id");
CREATE UNIQUE INDEX "uq_predio_documentos_relation" ON "predio_documentos"("organization_id", "predio_id", "documento_id", "tipo_vinculo");
CREATE INDEX "idx_predio_documentos_org_predio_status" ON "predio_documentos"("organization_id", "predio_id", "estatus");
CREATE INDEX "idx_predio_documentos_documento" ON "predio_documentos"("documento_id");
CREATE INDEX "idx_predio_documentos_creador" ON "predio_documentos"("creado_por_id");
CREATE INDEX "idx_predio_documentos_inactivador" ON "predio_documentos"("inactivado_por_id");
CREATE INDEX "idx_predio_datos_fuente_extraccion" ON "predio_datos_fuente"("organization_id", "predio_id", "extraccion_id");
CREATE INDEX "idx_predio_datos_fuente_documento" ON "predio_datos_fuente"("documento_id");
CREATE INDEX "idx_predio_datos_fuente_decisor" ON "predio_datos_fuente"("decidido_por_id");

ALTER TABLE "predios" ADD CONSTRAINT "predios_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT;
ALTER TABLE "predios" ADD CONSTRAINT "predios_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT;
ALTER TABLE "predios" ADD CONSTRAINT "predios_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "users"("id") ON DELETE RESTRICT;
ALTER TABLE "predio_colindancias" ADD CONSTRAINT "predio_colindancias_org_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT;
ALTER TABLE "predio_colindancias" ADD CONSTRAINT "predio_colindancias_predio_org_fkey" FOREIGN KEY ("predio_id", "organization_id") REFERENCES "predios"("id", "organization_id") ON DELETE CASCADE;
ALTER TABLE "expediente_predios" ADD CONSTRAINT "expediente_predios_org_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT;
ALTER TABLE "expediente_predios" ADD CONSTRAINT "expediente_predios_expediente_org_fkey" FOREIGN KEY ("expediente_id", "organization_id") REFERENCES "expedientes"("id", "organization_id") ON DELETE RESTRICT;
ALTER TABLE "expediente_predios" ADD CONSTRAINT "expediente_predios_predio_org_fkey" FOREIGN KEY ("predio_id", "organization_id") REFERENCES "predios"("id", "organization_id") ON DELETE RESTRICT;
ALTER TABLE "expediente_predios" ADD CONSTRAINT "expediente_predios_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT;
ALTER TABLE "expediente_predios" ADD CONSTRAINT "expediente_predios_removed_by_fkey" FOREIGN KEY ("removed_by") REFERENCES "users"("id") ON DELETE RESTRICT;
ALTER TABLE "expediente_acto_predios" ADD CONSTRAINT "expediente_acto_predios_org_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT;
ALTER TABLE "expediente_acto_predios" ADD CONSTRAINT "expediente_acto_predios_relation_org_fkey" FOREIGN KEY ("expediente_predio_id", "organization_id") REFERENCES "expediente_predios"("id", "organization_id") ON DELETE CASCADE;
ALTER TABLE "expediente_acto_predios" ADD CONSTRAINT "expediente_acto_predios_act_fkey" FOREIGN KEY ("expediente_acto_id") REFERENCES "expediente_actos"("id") ON DELETE RESTRICT;
ALTER TABLE "predio_documentos" ADD CONSTRAINT "predio_documentos_org_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT;
ALTER TABLE "predio_documentos" ADD CONSTRAINT "predio_documentos_predio_org_fkey" FOREIGN KEY ("predio_id", "organization_id") REFERENCES "predios"("id", "organization_id") ON DELETE RESTRICT;
ALTER TABLE "predio_documentos" ADD CONSTRAINT "predio_documentos_documento_fkey" FOREIGN KEY ("documento_id") REFERENCES "documentos"("id") ON DELETE RESTRICT;
ALTER TABLE "predio_documentos" ADD CONSTRAINT "predio_documentos_creador_fkey" FOREIGN KEY ("creado_por_id") REFERENCES "users"("id") ON DELETE RESTRICT;
ALTER TABLE "predio_documentos" ADD CONSTRAINT "predio_documentos_inactivador_fkey" FOREIGN KEY ("inactivado_por_id") REFERENCES "users"("id") ON DELETE RESTRICT;
ALTER TABLE "predio_datos_fuente" ADD CONSTRAINT "predio_datos_fuente_org_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT;
ALTER TABLE "predio_datos_fuente" ADD CONSTRAINT "predio_datos_fuente_predio_org_fkey" FOREIGN KEY ("predio_id", "organization_id") REFERENCES "predios"("id", "organization_id") ON DELETE RESTRICT;
ALTER TABLE "predio_datos_fuente" ADD CONSTRAINT "predio_datos_fuente_documento_fkey" FOREIGN KEY ("documento_id") REFERENCES "documentos"("id") ON DELETE RESTRICT;
ALTER TABLE "predio_datos_fuente" ADD CONSTRAINT "predio_datos_fuente_decisor_fkey" FOREIGN KEY ("decidido_por_id") REFERENCES "users"("id") ON DELETE RESTRICT;

-- Defensa en profundidad: toda referencia a User debe corresponder a una
-- membresía activa de la misma Organization. Reutiliza la función canónica.
DO $$
DECLARE relation RECORD; trigger_name TEXT;
BEGIN
  FOR relation IN SELECT * FROM (VALUES
    ('predios','created_by'),('predios','updated_by'),
    ('expediente_predios','created_by'),('expediente_predios','removed_by'),
    ('predio_documentos','creado_por_id'),('predio_documentos','inactivado_por_id'),
    ('predio_datos_fuente','decidido_por_id')
  ) AS v(child_table, user_column)
  LOOP
    trigger_name := 'trg_member_' || substr(md5(relation.child_table || ':' || relation.user_column), 1, 24);
    EXECUTE format('DROP TRIGGER IF EXISTS %I ON %I', trigger_name, relation.child_table);
    EXECUTE format(
      'CREATE TRIGGER %I BEFORE INSERT OR UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION enforce_organization_membership(%L)',
      trigger_name, relation.child_table, relation.user_column
    );
  END LOOP;
END $$;

-- Relaciones tenant↔tenant validadas por trigger cuando una FK compuesta no es
-- viable por compatibilidad del modelo documental/ExpedienteActo existente:
-- ('predio_colindancias','predios','predio_id')
-- ('expediente_predios','expedientes','expediente_id')
-- ('expediente_predios','predios','predio_id')
-- ('expediente_acto_predios','expediente_predios','expediente_predio_id')
-- ('expediente_acto_predios','expediente_actos','expediente_acto_id')
-- ('predio_documentos','predios','predio_id')
-- ('predio_documentos','documentos','documento_id')
-- ('predio_datos_fuente','predios','predio_id')
-- ('predio_datos_fuente','documentos','documento_id')

CREATE OR REPLACE FUNCTION pravia_validate_property_links() RETURNS trigger AS $$
DECLARE relation_record RECORD;
DECLARE act_record RECORD;
BEGIN
  SELECT organization_id, expediente_id INTO relation_record FROM expediente_predios WHERE id = NEW.expediente_predio_id;
  SELECT organization_id, expediente_id INTO act_record FROM expediente_actos WHERE id = NEW.expediente_acto_id;
  IF relation_record.organization_id IS DISTINCT FROM NEW.organization_id
     OR act_record.organization_id IS DISTINCT FROM NEW.organization_id
     OR relation_record.expediente_id IS DISTINCT FROM act_record.expediente_id THEN
    RAISE EXCEPTION 'PROPERTY_ACT_TENANT_OR_EXPEDIENT_MISMATCH';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "trg_validate_property_act_link" BEFORE INSERT OR UPDATE ON "expediente_acto_predios"
FOR EACH ROW EXECUTE FUNCTION pravia_validate_property_links();

CREATE OR REPLACE FUNCTION pravia_validate_property_document() RETURNS trigger AS $$
DECLARE document_org UUID;
BEGIN
  SELECT organization_id INTO document_org FROM documentos WHERE id = NEW.documento_id;
  IF document_org IS NULL OR document_org IS DISTINCT FROM NEW.organization_id THEN
    RAISE EXCEPTION 'PROPERTY_DOCUMENT_TENANT_MISMATCH';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "trg_validate_property_document_link" BEFORE INSERT OR UPDATE ON "predio_documentos"
FOR EACH ROW EXECUTE FUNCTION pravia_validate_property_document();
CREATE TRIGGER "trg_validate_property_source_document" BEFORE INSERT OR UPDATE ON "predio_datos_fuente"
FOR EACH ROW EXECUTE FUNCTION pravia_validate_property_document();

-- Deliberadamente sin INSERT/UPDATE sobre tablas legacy: no se inventa identidad inmobiliaria.
