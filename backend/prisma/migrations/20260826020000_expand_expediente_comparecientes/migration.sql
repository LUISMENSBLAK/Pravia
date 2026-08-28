-- EXP-003 / Phase B4: canonical party participation per expediente act.
-- Master Compareciente rows and every legacy link are preserved. A legacy link
-- is assigned to an act only when the expediente has exactly one active act.

ALTER TABLE "pravia_os"."expediente_comparecientes"
  ADD COLUMN "expediente_acto_id" UUID,
  ADD COLUMN "participacion_porcentaje" DECIMAL(9,6),
  ADD COLUMN "archived_by_id" UUID,
  ADD COLUMN "motivo_desvinculacion" TEXT,
  ADD COLUMN "idempotency_key" TEXT,
  ADD COLUMN "unlink_idempotency_key" TEXT;

ALTER TABLE "pravia_os"."expediente_comparecientes"
  DROP CONSTRAINT IF EXISTS "uq_expediente_compareciente_caracter";

ALTER TABLE "pravia_os"."expediente_comparecientes"
  ADD CONSTRAINT "ck_exp_comparecientes_participacion" CHECK (
    "participacion_porcentaje" IS NULL
    OR ("participacion_porcentaje" > 0 AND "participacion_porcentaje" <= 100)
  ) NOT VALID,
  ADD CONSTRAINT "ck_exp_comparecientes_archivado" CHECK (
    ("archived_at" IS NULL AND COALESCE("estatus", 'ACTIVO') = 'ACTIVO')
    OR
    ("archived_at" IS NOT NULL AND "estatus" = 'INACTIVO'
      AND "archived_by_id" IS NOT NULL
      AND length(trim(COALESCE("motivo_desvinculacion", ''))) > 0)
  ) NOT VALID;

CREATE UNIQUE INDEX "uq_expediente_actos_id_org_b4"
  ON "pravia_os"."expediente_actos"("id", "organization_id");
CREATE UNIQUE INDEX "uq_comparecientes_id_org_b4"
  ON "pravia_os"."comparecientes"("id", "organization_id");

ALTER TABLE "pravia_os"."expediente_comparecientes"
  ADD CONSTRAINT "exp_comparecientes_acto_tenant_fkey"
    FOREIGN KEY ("expediente_acto_id", "organization_id")
    REFERENCES "pravia_os"."expediente_actos"("id", "organization_id") ON DELETE RESTRICT,
  ADD CONSTRAINT "exp_comparecientes_party_tenant_fkey"
    FOREIGN KEY ("compareciente_id", "organization_id")
    REFERENCES "pravia_os"."comparecientes"("id", "organization_id") ON DELETE RESTRICT,
  ADD CONSTRAINT "exp_comparecientes_archived_by_fkey"
    FOREIGN KEY ("archived_by_id")
    REFERENCES "pravia_os"."users"("id") ON DELETE RESTRICT;

CREATE UNIQUE INDEX "uq_exp_comparecientes_idempotency"
  ON "pravia_os"."expediente_comparecientes"("organization_id", "expediente_id", "idempotency_key");
CREATE UNIQUE INDEX "uq_exp_comparecientes_unlink_idempotency"
  ON "pravia_os"."expediente_comparecientes"("organization_id", "expediente_id", "unlink_idempotency_key");
CREATE INDEX "idx_exp_comparecientes_tenant_act_status"
  ON "pravia_os"."expediente_comparecientes"("organization_id", "expediente_id", "expediente_acto_id", "estatus");
CREATE INDEX "idx_exp_comparecientes_acto_fk"
  ON "pravia_os"."expediente_comparecientes"("expediente_acto_id");
CREATE INDEX "idx_exp_comparecientes_archived_by_fk"
  ON "pravia_os"."expediente_comparecientes"("archived_by_id");

-- The act must belong to the same expediente as the operational link. Tenant
-- equality is additionally enforced by the composite foreign key above.
CREATE OR REPLACE FUNCTION "pravia_os"."enforce_exp_compareciente_act_scope"()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE act_expediente UUID;
BEGIN
  IF NEW."expediente_acto_id" IS NULL THEN RETURN NEW; END IF;
  SELECT "expediente_id" INTO act_expediente
  FROM "pravia_os"."expediente_actos"
  WHERE "id" = NEW."expediente_acto_id"
    AND "organization_id" = NEW."organization_id"
    AND "estatus" = 'ACTIVO'
    AND "removed_at" IS NULL;
  IF act_expediente IS NULL OR act_expediente IS DISTINCT FROM NEW."expediente_id" THEN
    RAISE EXCEPTION 'EXPEDIENTE_PARTY_ACT_SCOPE_DENIED' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER "exp_compareciente_act_scope"
BEFORE INSERT OR UPDATE OF "expediente_acto_id", "expediente_id", "organization_id"
ON "pravia_os"."expediente_comparecientes"
FOR EACH ROW EXECUTE FUNCTION "pravia_os"."enforce_exp_compareciente_act_scope"();

CREATE TRIGGER "exp_compareciente_archived_by_membership"
BEFORE INSERT OR UPDATE OF "archived_by_id", "organization_id"
ON "pravia_os"."expediente_comparecientes"
FOR EACH ROW EXECUTE FUNCTION "pravia_os"."enforce_organization_membership"('archived_by_id');

-- Demonstrable-only backfill: one active act means one unambiguous target.
WITH unique_active_act AS (
  SELECT "organization_id", "expediente_id", min("id"::text)::UUID AS "expediente_acto_id"
  FROM "pravia_os"."expediente_actos"
  WHERE "estatus" = 'ACTIVO' AND "removed_at" IS NULL
  GROUP BY "organization_id", "expediente_id"
  HAVING count(*) = 1
)
UPDATE "pravia_os"."expediente_comparecientes" AS link
SET "expediente_acto_id" = unique_act."expediente_acto_id"
FROM unique_active_act AS unique_act
WHERE link."expediente_acto_id" IS NULL
  AND link."organization_id" = unique_act."organization_id"
  AND link."expediente_id" = unique_act."expediente_id";

-- Multiple roles remain valid; only an exactly identical active operational
-- relation is rejected. Historical archived rows never collide.
CREATE UNIQUE INDEX "uq_exp_comparecientes_active_exact_relation"
  ON "pravia_os"."expediente_comparecientes"(
    "organization_id", "expediente_acto_id", "compareciente_id", "caracter_id",
    COALESCE("forma_comparecencia", 'PROPIO_DERECHO'::"pravia_os"."FormaComparecencia")
  )
  WHERE "archived_at" IS NULL AND COALESCE("estatus", 'ACTIVO') = 'ACTIVO'
    AND "expediente_acto_id" IS NOT NULL;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "pravia_os"."expediente_comparecientes" link
    JOIN "pravia_os"."expediente_actos" act ON act."id" = link."expediente_acto_id"
    WHERE link."organization_id" IS DISTINCT FROM act."organization_id"
       OR link."expediente_id" IS DISTINCT FROM act."expediente_id"
  ) THEN RAISE EXCEPTION 'EXPEDIENTE_PARTY_BACKFILL_SCOPE_MISMATCH'; END IF;

  IF EXISTS (
    SELECT 1 FROM "pravia_os"."expediente_comparecientes"
    WHERE "participacion_porcentaje" IS NOT NULL
  ) THEN RAISE EXCEPTION 'EXPEDIENTE_PARTY_BACKFILL_INVENTED_PARTICIPATION'; END IF;

  IF EXISTS (
    SELECT 1 FROM "pravia_os"."expediente_comparecientes"
    WHERE "expediente_acto_id" IS NULL
      AND "archived_at" IS NULL
      AND COALESCE("estatus", 'ACTIVO') = 'ACTIVO'
      AND 1 = (
        SELECT count(*) FROM "pravia_os"."expediente_actos" act
        WHERE act."organization_id" = "expediente_comparecientes"."organization_id"
          AND act."expediente_id" = "expediente_comparecientes"."expediente_id"
          AND act."estatus" = 'ACTIVO' AND act."removed_at" IS NULL
      )
  ) THEN RAISE EXCEPTION 'EXPEDIENTE_PARTY_BACKFILL_MISSING_DETERMINISTIC_ACT'; END IF;
END $$;

COMMENT ON COLUMN "pravia_os"."expediente_comparecientes"."expediente_acto_id" IS
  'Canonical EXP-003 act relation. NULL is reserved for ambiguous legacy links pending human assignment.';
