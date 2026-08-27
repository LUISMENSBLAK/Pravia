-- EXP-002 / expand phase: canonical act instances per expediente.
-- The historical expedientes.tipo_acto_id value is preserved byte-for-byte and
-- becomes nullable/read-only so new records do not keep writing the legacy field.

ALTER TABLE "pravia_os"."expedientes"
  ALTER COLUMN "tipo_acto_id" DROP NOT NULL;

CREATE TYPE "pravia_os"."ExpedienteActoOrigen" AS ENUM ('COTIZACION', 'ADICIONAL', 'LEGACY_MIGRATION');
CREATE TYPE "pravia_os"."ExpedienteActoEstatus" AS ENUM ('ACTIVO', 'RETIRADO');

CREATE UNIQUE INDEX "uq_expedientes_id_org"
  ON "pravia_os"."expedientes"("id", "organization_id");
CREATE UNIQUE INDEX "uq_cotizaciones_id_org"
  ON "pravia_os"."cotizaciones"("id", "organization_id");

CREATE TABLE "pravia_os"."expediente_actos" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "organization_id" UUID NOT NULL,
  "expediente_id" UUID NOT NULL,
  "tipo_acto_id" UUID NOT NULL,
  "origen" "pravia_os"."ExpedienteActoOrigen" NOT NULL,
  "estatus" "pravia_os"."ExpedienteActoEstatus" NOT NULL DEFAULT 'ACTIVO',
  "source_cotizacion_id" UUID,
  "idempotency_key" TEXT,
  "removal_idempotency_key" TEXT,
  "created_by" UUID NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "removed_at" TIMESTAMP(3),
  "removed_by" UUID,
  "removed_reason" TEXT,
  CONSTRAINT "expediente_actos_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ck_expediente_actos_removal" CHECK (
    ("estatus" = 'ACTIVO' AND "removed_at" IS NULL AND "removed_by" IS NULL)
    OR
    ("estatus" = 'RETIRADO' AND "removed_at" IS NOT NULL AND "removed_by" IS NOT NULL AND length(trim("removed_reason")) > 0)
  ),
  CONSTRAINT "expediente_actos_org_fkey" FOREIGN KEY ("organization_id")
    REFERENCES "pravia_os"."organizations"("id") ON DELETE RESTRICT,
  CONSTRAINT "expediente_actos_expediente_tenant_fkey" FOREIGN KEY ("expediente_id", "organization_id")
    REFERENCES "pravia_os"."expedientes"("id", "organization_id") ON DELETE RESTRICT,
  CONSTRAINT "expediente_actos_tipo_acto_fkey" FOREIGN KEY ("tipo_acto_id")
    REFERENCES "pravia_os"."tipos_acto"("id") ON DELETE RESTRICT,
  CONSTRAINT "expediente_actos_source_quote_tenant_fkey" FOREIGN KEY ("source_cotizacion_id", "organization_id")
    REFERENCES "pravia_os"."cotizaciones"("id", "organization_id") ON DELETE RESTRICT,
  CONSTRAINT "expediente_actos_created_by_fkey" FOREIGN KEY ("created_by")
    REFERENCES "pravia_os"."users"("id") ON DELETE RESTRICT,
  CONSTRAINT "expediente_actos_removed_by_fkey" FOREIGN KEY ("removed_by")
    REFERENCES "pravia_os"."users"("id") ON DELETE RESTRICT,
  CONSTRAINT "uq_expediente_actos_idempotency" UNIQUE ("organization_id", "expediente_id", "idempotency_key"),
  CONSTRAINT "uq_expediente_actos_removal_idempotency" UNIQUE ("organization_id", "expediente_id", "removal_idempotency_key")
);

CREATE INDEX "idx_expediente_actos_tenant_expediente_status"
  ON "pravia_os"."expediente_actos"("organization_id", "expediente_id", "estatus");
CREATE INDEX "idx_expediente_actos_tipo_acto_fk"
  ON "pravia_os"."expediente_actos"("tipo_acto_id");
CREATE INDEX "idx_expediente_actos_source_quote_fk"
  ON "pravia_os"."expediente_actos"("source_cotizacion_id");
CREATE INDEX "idx_expediente_actos_created_by_fk"
  ON "pravia_os"."expediente_actos"("created_by");
CREATE INDEX "idx_expediente_actos_removed_by_fk"
  ON "pravia_os"."expediente_actos"("removed_by");

CREATE TRIGGER "expediente_actos_tipo_scope"
BEFORE INSERT OR UPDATE OF "tipo_acto_id", "organization_id" ON pravia_os.expediente_actos
FOR EACH ROW EXECUTE FUNCTION pravia_os.enforce_tipo_acto_tenant_scope();

CREATE TRIGGER "expediente_actos_created_by_membership"
BEFORE INSERT OR UPDATE OF "created_by", "organization_id" ON pravia_os.expediente_actos
FOR EACH ROW EXECUTE FUNCTION pravia_os.enforce_organization_membership('created_by');

CREATE TRIGGER "expediente_actos_removed_by_membership"
BEFORE INSERT OR UPDATE OF "removed_by", "organization_id" ON pravia_os.expediente_actos
FOR EACH ROW EXECUTE FUNCTION pravia_os.enforce_organization_membership('removed_by');

-- Deterministic, idempotent backfill. It preserves every historical field and
-- yields exactly one initial relation for every legacy expediente with an act.
INSERT INTO "pravia_os"."expediente_actos" (
  "id", "organization_id", "expediente_id", "tipo_acto_id", "origen", "estatus",
  "source_cotizacion_id", "idempotency_key", "created_by", "created_at", "updated_at"
)
SELECT
  md5('expediente-acto-inicial:' || expediente."id"::text)::uuid,
  expediente."organization_id",
  expediente."id",
  expediente."tipo_acto_id",
  CASE WHEN expediente."cotizacion_id" IS NOT NULL THEN 'COTIZACION'::"pravia_os"."ExpedienteActoOrigen"
       ELSE 'LEGACY_MIGRATION'::"pravia_os"."ExpedienteActoOrigen" END,
  'ACTIVO'::"pravia_os"."ExpedienteActoEstatus",
  expediente."cotizacion_id",
  'MIGRATION:LEGACY:' || expediente."id"::text,
  expediente."creador_id",
  expediente."fecha_apertura",
  expediente."updated_at"
FROM "pravia_os"."expedientes" AS expediente
WHERE expediente."organization_id" IS NOT NULL
  AND expediente."tipo_acto_id" IS NOT NULL
ON CONFLICT ("organization_id", "expediente_id", "idempotency_key") DO NOTHING;

-- Generic convergence assertions: these remain valid for any dataset size.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM "pravia_os"."expediente_actos" ea
    LEFT JOIN "pravia_os"."expedientes" e ON e."id" = ea."expediente_id"
    WHERE e."id" IS NULL
  ) THEN RAISE EXCEPTION 'EXPEDIENTE_ACT_BACKFILL_ORPHAN'; END IF;

  IF EXISTS (
    SELECT 1 FROM "pravia_os"."expediente_actos" ea
    JOIN "pravia_os"."expedientes" e ON e."id" = ea."expediente_id"
    WHERE e."organization_id" IS DISTINCT FROM ea."organization_id"
  ) THEN RAISE EXCEPTION 'EXPEDIENTE_ACT_BACKFILL_TENANT_MISMATCH'; END IF;

  IF EXISTS (
    SELECT 1 FROM "pravia_os"."expedientes" e
    WHERE e."organization_id" IS NOT NULL AND e."tipo_acto_id" IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM "pravia_os"."expediente_actos" ea
        WHERE ea."organization_id" = e."organization_id"
          AND ea."expediente_id" = e."id"
          AND ea."tipo_acto_id" = e."tipo_acto_id"
          AND ea."estatus" = 'ACTIVO'
      )
  ) THEN RAISE EXCEPTION 'EXPEDIENTE_ACT_BACKFILL_MISSING'; END IF;

  IF EXISTS (
    SELECT 1 FROM "pravia_os"."expediente_actos"
    WHERE "idempotency_key" LIKE 'MIGRATION:LEGACY:%'
    GROUP BY "organization_id", "expediente_id", "idempotency_key"
    HAVING count(*) <> 1
  ) THEN RAISE EXCEPTION 'EXPEDIENTE_ACT_BACKFILL_DUPLICATE'; END IF;
END $$;
