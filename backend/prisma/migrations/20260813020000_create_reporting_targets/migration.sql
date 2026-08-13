CREATE TYPE "MetaHonorarioAlcance" AS ENUM ('DESPACHO', 'ABOGADO');
CREATE TYPE "MetaHonorarioBase" AS ENUM ('GENERADOS', 'COBRADOS');

CREATE TABLE "metas_honorarios" (
  "id" UUID NOT NULL,
  "alcance" "MetaHonorarioAlcance" NOT NULL,
  "usuario_id" UUID,
  "periodo_inicio" TIMESTAMP(3) NOT NULL,
  "periodo_fin" TIMESTAMP(3) NOT NULL,
  "importe" DECIMAL(14,2) NOT NULL,
  "moneda" TEXT NOT NULL DEFAULT 'MXN',
  "base" "MetaHonorarioBase" NOT NULL DEFAULT 'GENERADOS',
  "activa" BOOLEAN NOT NULL DEFAULT true,
  "creada_por_id" UUID NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "metas_honorarios_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "metas_honorarios_periodo_valido" CHECK ("periodo_fin" >= "periodo_inicio"),
  CONSTRAINT "metas_honorarios_importe_positivo" CHECK ("importe" > 0),
  CONSTRAINT "metas_honorarios_alcance_usuario" CHECK (("alcance" = 'DESPACHO' AND "usuario_id" IS NULL) OR ("alcance" = 'ABOGADO' AND "usuario_id" IS NOT NULL))
);

CREATE UNIQUE INDEX "metas_honorarios_alcance_usuario_id_periodo_inicio_periodo_fin_base_key" ON "metas_honorarios"("alcance", "usuario_id", "periodo_inicio", "periodo_fin", "base");
CREATE INDEX "metas_honorarios_activa_periodo_inicio_periodo_fin_idx" ON "metas_honorarios"("activa", "periodo_inicio", "periodo_fin");
ALTER TABLE "metas_honorarios" ADD CONSTRAINT "metas_honorarios_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "metas_honorarios" ADD CONSTRAINT "metas_honorarios_creada_por_id_fkey" FOREIGN KEY ("creada_por_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
