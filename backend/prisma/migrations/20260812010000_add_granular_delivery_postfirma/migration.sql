CREATE TABLE "expediente_entregas" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "expediente_id" UUID NOT NULL,
  "receptor_nombre" TEXT NOT NULL,
  "receptor_caracter" TEXT NOT NULL,
  "fecha_efectiva" TIMESTAMP(3) NOT NULL,
  "medio" TEXT NOT NULL,
  "items" JSONB NOT NULL,
  "evidencia_documento_id" UUID NOT NULL,
  "observaciones" TEXT,
  "registrado_por_id" UUID NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "expediente_entregas_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "expediente_entregas_expediente_id_key" ON "expediente_entregas"("expediente_id");
CREATE INDEX "expediente_entregas_registrado_por_id_idx" ON "expediente_entregas"("registrado_por_id");

ALTER TABLE "expediente_entregas" ADD CONSTRAINT "expediente_entregas_expediente_id_fkey"
  FOREIGN KEY ("expediente_id") REFERENCES "expedientes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "expediente_entregas" ADD CONSTRAINT "expediente_entregas_evidencia_documento_id_fkey"
  FOREIGN KEY ("evidencia_documento_id") REFERENCES "documentos"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "expediente_entregas" ADD CONSTRAINT "expediente_entregas_registrado_por_id_fkey"
  FOREIGN KEY ("registrado_por_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "tareas_externas"
  ADD COLUMN "folio" TEXT,
  ADD COLUMN "fecha_ingreso" TIMESTAMP(3),
  ADD COLUMN "seguimiento" TEXT,
  ADD COLUMN "prevencion" TEXT,
  ADD COLUMN "subsanacion" TEXT,
  ADD COLUMN "resultado" TEXT,
  ADD COLUMN "evidencia_documento_id" UUID,
  ADD COLUMN "gestionado_por_id" UUID,
  ADD COLUMN "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

CREATE INDEX "tareas_externas_gestionado_por_id_idx" ON "tareas_externas"("gestionado_por_id");
ALTER TABLE "tareas_externas" ADD CONSTRAINT "tareas_externas_gestionado_por_id_fkey"
  FOREIGN KEY ("gestionado_por_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "tareas_externas" ADD CONSTRAINT "tareas_externas_evidencia_documento_id_fkey"
  FOREIGN KEY ("evidencia_documento_id") REFERENCES "documentos"("id") ON DELETE SET NULL ON UPDATE CASCADE;
