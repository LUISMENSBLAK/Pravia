-- Isolated EXP-002 migration fixture. Never target a shared or production DB.
CREATE SCHEMA "pravia_os";

CREATE TABLE "pravia_os"."organizations" (
  "id" UUID PRIMARY KEY,
  "name" TEXT NOT NULL
);
CREATE TABLE "pravia_os"."users" (
  "id" UUID PRIMARY KEY,
  "organization_id" UUID NOT NULL REFERENCES "pravia_os"."organizations"("id")
);
CREATE TABLE "pravia_os"."tipos_acto" (
  "id" UUID PRIMARY KEY,
  "organization_id" UUID,
  "nombre" TEXT NOT NULL
);
CREATE TABLE "pravia_os"."cotizaciones" (
  "id" UUID PRIMARY KEY,
  "organization_id" UUID NOT NULL REFERENCES "pravia_os"."organizations"("id")
);
CREATE TABLE "pravia_os"."expedientes" (
  "id" UUID PRIMARY KEY,
  "organization_id" UUID NOT NULL REFERENCES "pravia_os"."organizations"("id"),
  "numero_pravia" TEXT NOT NULL UNIQUE,
  "tipo_acto_id" UUID NOT NULL REFERENCES "pravia_os"."tipos_acto"("id"),
  "cotizacion_id" UUID REFERENCES "pravia_os"."cotizaciones"("id"),
  "creador_id" UUID NOT NULL REFERENCES "pravia_os"."users"("id"),
  "fecha_apertura" TIMESTAMP(3) NOT NULL,
  "updated_at" TIMESTAMP(3) NOT NULL
);

CREATE FUNCTION "pravia_os"."enforce_tipo_acto_tenant_scope"() RETURNS trigger
LANGUAGE plpgsql AS $$ BEGIN RETURN NEW; END $$;
CREATE FUNCTION "pravia_os"."enforce_organization_membership"() RETURNS trigger
LANGUAGE plpgsql AS $$ BEGIN RETURN NEW; END $$;

INSERT INTO "pravia_os"."organizations" VALUES
  ('10000000-0000-0000-0000-000000000001', 'Tenant A');
INSERT INTO "pravia_os"."users" VALUES
  ('20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001');
INSERT INTO "pravia_os"."tipos_acto" VALUES
  ('30000000-0000-0000-0000-000000000001', NULL, 'Compraventa');

INSERT INTO "pravia_os"."cotizaciones" ("id", "organization_id")
SELECT ('40000000-0000-0000-0000-' || lpad(series::text, 12, '0'))::uuid,
       '10000000-0000-0000-0000-000000000001'::uuid
FROM generate_series(1, 7) AS series;

INSERT INTO "pravia_os"."expedientes" (
  "id", "organization_id", "numero_pravia", "tipo_acto_id", "cotizacion_id",
  "creador_id", "fecha_apertura", "updated_at"
)
SELECT ('50000000-0000-0000-0000-' || lpad(series::text, 12, '0'))::uuid,
       '10000000-0000-0000-0000-000000000001'::uuid,
       'EXP-' || lpad(series::text, 4, '0') || '-2026',
       '30000000-0000-0000-0000-000000000001'::uuid,
       ('40000000-0000-0000-0000-' || lpad(series::text, 12, '0'))::uuid,
       '20000000-0000-0000-0000-000000000001'::uuid,
       timestamp '2026-08-01 10:00:00' + series * interval '1 day',
       timestamp '2026-08-01 10:00:00' + series * interval '1 day'
FROM generate_series(1, 7) AS series;
