-- EXP-006: operational instances resolved from CFG-002.
-- Additive and tenant-aware. It neither mutates CFG-002 nor copies master rules.
-- No historical pending instances are invented; existing operational and master rows remain unchanged.
CREATE TYPE "ExpedienteArtefactoSujeto" AS ENUM ('EXPEDIENTE', 'COMPARECIENTE', 'INMUEBLE', 'FIJO');
CREATE TYPE "ExpedienteArtefactoPendienteEstado" AS ENUM ('PENDIENTE', 'PENDIENTE_REVISION', 'VALIDADO', 'NO_APLICA');
CREATE TYPE "ExpedienteArtefactoVia" AS ENUM ('IA', 'CARGA_EXTERNA');

CREATE TABLE "expediente_artefactos_pendientes" (
  "id" UUID NOT NULL,
  "organization_id" UUID NOT NULL,
  "expediente_id" UUID NOT NULL,
  "expediente_acto_id" UUID,
  "artefacto_id" UUID NOT NULL,
  "regla_id" UUID NOT NULL,
  "artefacto_version_id" UUID NOT NULL,
  "sujeto_tipo" "ExpedienteArtefactoSujeto" NOT NULL,
  "sujeto_id" UUID,
  "ordinal" INTEGER NOT NULL DEFAULT 1 CHECK ("ordinal" > 0),
  "identity_key" VARCHAR(320) NOT NULL,
  "estado" "ExpedienteArtefactoPendienteEstado" NOT NULL DEFAULT 'PENDIENTE',
  "obligatoria" BOOLEAN NOT NULL DEFAULT false,
  "explicacion_snapshot" JSONB NOT NULL,
  "source_revision" VARCHAR(128) NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 1 CHECK ("version" > 0),
  "en_alcance" BOOLEAN NOT NULL DEFAULT true,
  "requiere_revision" BOOLEAN NOT NULL DEFAULT false,
  "motivo_revision" TEXT,
  "current_document_id" UUID,
  "validado_por_id" UUID,
  "validado_at" TIMESTAMP(3),
  "created_by" UUID NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "expediente_artefactos_pendientes_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "expediente_artefactos_pendientes_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT,
  CONSTRAINT "expediente_artefactos_pendientes_expediente_id_fkey" FOREIGN KEY ("expediente_id") REFERENCES "expedientes"("id") ON DELETE RESTRICT,
  CONSTRAINT "expediente_artefactos_pendientes_expediente_acto_id_fkey" FOREIGN KEY ("expediente_acto_id") REFERENCES "expediente_actos"("id") ON DELETE RESTRICT,
  CONSTRAINT "expediente_artefactos_pendientes_artefacto_id_fkey" FOREIGN KEY ("artefacto_id") REFERENCES "catalogo_artefactos"("id") ON DELETE RESTRICT,
  CONSTRAINT "expediente_artefactos_pendientes_regla_id_fkey" FOREIGN KEY ("regla_id") REFERENCES "catalogo_artefacto_reglas"("id") ON DELETE RESTRICT,
  CONSTRAINT "expediente_artefactos_pendientes_artefacto_version_id_fkey" FOREIGN KEY ("artefacto_version_id") REFERENCES "catalogo_artefacto_versiones"("id") ON DELETE RESTRICT,
  CONSTRAINT "expediente_artefactos_pendientes_current_document_id_fkey" FOREIGN KEY ("current_document_id") REFERENCES "documentos"("id") ON DELETE RESTRICT,
  CONSTRAINT "expediente_artefactos_pendientes_validado_por_id_fkey" FOREIGN KEY ("validado_por_id") REFERENCES "users"("id") ON DELETE RESTRICT,
  CONSTRAINT "expediente_artefactos_pendientes_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT
);

CREATE UNIQUE INDEX "uq_exp006_pending_identity" ON pravia_os."expediente_artefactos_pendientes"("organization_id", "expediente_id", "identity_key");
CREATE INDEX "idx_exp006_pending_case_status" ON pravia_os."expediente_artefactos_pendientes"("organization_id", "expediente_id", "en_alcance", "estado");
CREATE INDEX "idx_exp006_pending_subject" ON pravia_os."expediente_artefactos_pendientes"("organization_id", "sujeto_tipo", "sujeto_id");
CREATE INDEX "idx_exp006_pending_rule" ON "expediente_artefactos_pendientes"("regla_id");
CREATE INDEX "idx_exp006_pending_master_version" ON "expediente_artefactos_pendientes"("artefacto_version_id");
CREATE INDEX "idx_exp006_pending_current_document" ON "expediente_artefactos_pendientes"("current_document_id");

CREATE TABLE "expediente_artefacto_documentos" (
  "id" UUID NOT NULL,
  "organization_id" UUID NOT NULL,
  "expediente_id" UUID NOT NULL,
  "pendiente_id" UUID NOT NULL,
  "documento_id" UUID NOT NULL,
  "via" "ExpedienteArtefactoVia" NOT NULL,
  "source_manifest" JSONB,
  "provenance" JSONB NOT NULL,
  "source_revision" VARCHAR(128) NOT NULL,
  "idempotency_key" VARCHAR(160) NOT NULL,
  "vigente" BOOLEAN NOT NULL DEFAULT true,
  "created_by" UUID NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "expediente_artefacto_documentos_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "expediente_artefacto_documentos_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT,
  CONSTRAINT "expediente_artefacto_documentos_expediente_id_fkey" FOREIGN KEY ("expediente_id") REFERENCES "expedientes"("id") ON DELETE RESTRICT,
  CONSTRAINT "expediente_artefacto_documentos_pendiente_id_fkey" FOREIGN KEY ("pendiente_id") REFERENCES "expediente_artefactos_pendientes"("id") ON DELETE RESTRICT,
  CONSTRAINT "expediente_artefacto_documentos_documento_id_fkey" FOREIGN KEY ("documento_id") REFERENCES "documentos"("id") ON DELETE RESTRICT,
  CONSTRAINT "expediente_artefacto_documentos_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT
);

CREATE UNIQUE INDEX "uq_exp006_document_idempotency" ON pravia_os."expediente_artefacto_documentos"("organization_id", "pendiente_id", "idempotency_key");
CREATE INDEX "idx_exp006_documents_case_pending" ON pravia_os."expediente_artefacto_documentos"("organization_id", "expediente_id", "pendiente_id", "vigente");
CREATE INDEX "idx_exp006_documents_document" ON "expediente_artefacto_documentos"("documento_id");

-- These operational tables are private to the authenticated backend. They are
-- intentionally unavailable through Supabase Data/GraphQL APIs.
ALTER TABLE "expediente_artefactos_pendientes" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "expediente_artefacto_documentos" ENABLE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    EXECUTE 'REVOKE ALL ON TABLE "expediente_artefactos_pendientes" FROM anon';
    EXECUTE 'REVOKE ALL ON TABLE "expediente_artefacto_documentos" FROM anon';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    EXECUTE 'REVOKE ALL ON TABLE "expediente_artefactos_pendientes" FROM authenticated';
    EXECUTE 'REVOKE ALL ON TABLE "expediente_artefacto_documentos" FROM authenticated';
  END IF;
END $$;

-- Defense in depth: every tenant-owned relation is checked in the database,
-- even if an application bug attempted to submit a valid ID from another tenant.
DO $$
DECLARE
  relation RECORD;
  trigger_name TEXT;
BEGIN
  FOR relation IN SELECT * FROM (VALUES
    ('expediente_artefactos_pendientes','expedientes','expediente_id'),
    ('expediente_artefactos_pendientes','expediente_actos','expediente_acto_id'),
    ('expediente_artefactos_pendientes','catalogo_artefactos','artefacto_id'),
    ('expediente_artefactos_pendientes','catalogo_artefacto_reglas','regla_id'),
    ('expediente_artefactos_pendientes','catalogo_artefacto_versiones','artefacto_version_id'),
    ('expediente_artefactos_pendientes','documentos','current_document_id'),
    ('expediente_artefacto_documentos','expedientes','expediente_id'),
    ('expediente_artefacto_documentos','expediente_artefactos_pendientes','pendiente_id'),
    ('expediente_artefacto_documentos','documentos','documento_id')
  ) AS relations(child_table, parent_table, parent_column)
  LOOP
    trigger_name := 'trg_exp006_tenant_' || relation.child_table || '_' || relation.parent_column;
    EXECUTE format('DROP TRIGGER IF EXISTS %I ON pravia_os.%I', trigger_name, relation.child_table);
    EXECUTE format(
      'CREATE TRIGGER %I BEFORE INSERT OR UPDATE ON pravia_os.%I FOR EACH ROW EXECUTE FUNCTION pravia_os.enforce_same_organization(%L,%L)',
      trigger_name, relation.child_table, relation.parent_table, relation.parent_column
    );
  END LOOP;
END $$;

DO $$
DECLARE
  relation RECORD;
  trigger_name TEXT;
BEGIN
  FOR relation IN SELECT * FROM (VALUES
    ('expediente_artefactos_pendientes','created_by'),
    ('expediente_artefactos_pendientes','validado_por_id'),
    ('expediente_artefacto_documentos','created_by')
  ) AS relations(child_table, user_column)
  LOOP
    trigger_name := 'trg_exp006_membership_' || relation.child_table || '_' || relation.user_column;
    EXECUTE format('DROP TRIGGER IF EXISTS %I ON pravia_os.%I', trigger_name, relation.child_table);
    EXECUTE format(
      'CREATE TRIGGER %I BEFORE INSERT OR UPDATE ON pravia_os.%I FOR EACH ROW EXECUTE FUNCTION pravia_os.enforce_organization_membership(%L)',
      trigger_name, relation.child_table, relation.user_column
    );
  END LOOP;
END $$;
