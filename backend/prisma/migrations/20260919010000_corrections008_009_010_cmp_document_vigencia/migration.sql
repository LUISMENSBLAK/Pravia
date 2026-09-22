-- Correction 008 v2: document lifecycle belongs to the canonical
-- compareciente-document relation. Existing active links remain current;
-- no historical row or blob is rewritten or removed.
ALTER TABLE "compareciente_documentos"
  ADD COLUMN "vigencia" "PredioDocumentoVigencia" NOT NULL DEFAULT 'VIGENTE';

CREATE INDEX "idx_compareciente_documentos_vigencia"
  ON "compareciente_documentos" ("compareciente_id", "vigencia", "estatus");
