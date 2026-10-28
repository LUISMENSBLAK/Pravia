-- Keep detected fields, provenance and human confirmation tied to the
-- immutable private CSF original without rewriting historical suppliers.
ALTER TABLE "pravia_os"."proveedores_fiscales"
  ADD COLUMN "csf_extraction" JSONB;
