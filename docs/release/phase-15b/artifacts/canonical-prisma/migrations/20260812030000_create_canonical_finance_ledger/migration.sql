-- Fase 10: ledger financiero canónico. Migración estrictamente aditiva.
-- No elimina ni transforma Pago legacy y no ejecuta backfill.
-- Rollback conceptual: retirar las rutas nuevas, eliminar FKs/columnas aditivas y
-- después las tablas/tipos nuevos; los registros legacy permanecen intactos.

ALTER TYPE "EstatusMovimiento" ADD VALUE IF NOT EXISTS 'BORRADOR';
ALTER TYPE "EstatusMovimiento" ADD VALUE IF NOT EXISTS 'PENDIENTE_COMPROBANTE';
ALTER TYPE "EstatusMovimiento" ADD VALUE IF NOT EXISTS 'LISTO_APLICAR';
ALTER TYPE "EstatusMovimiento" ADD VALUE IF NOT EXISTS 'APLICADO';

CREATE TYPE "NaturalezaCategoriaFinanciera" AS ENUM ('DESPACHO', 'TERCERO', 'EGRESO_DESPACHO', 'TRANSFERENCIA_INTERNA', 'OTRO');
CREATE TYPE "DireccionCategoriaFinanciera" AS ENUM ('INGRESO', 'EGRESO', 'AMBAS');
CREATE TYPE "EstadoHonorarioGenerado" AS ENUM ('RECONOCIDO', 'AJUSTADO', 'CANCELADO');
CREATE TYPE "EstadoComprobanteFinanciero" AS ENUM ('VIGENTE', 'ANULADO');
CREATE TYPE "EstadoTransaccionBanco" AS ENUM ('PENDIENTE', 'CONCILIADA', 'IGNORADA');
CREATE TYPE "EstadoConciliacionFinanciera" AS ENUM ('SUGERIDA', 'CONCILIADA', 'RECHAZADA');
CREATE TYPE "MetodoConciliacionFinanciera" AS ENUM ('EXACTA', 'SUGERIDA', 'MANUAL');

CREATE SEQUENCE IF NOT EXISTS finance_movement_folio_seq START 1;
CREATE SEQUENCE IF NOT EXISTS finance_receipt_folio_seq START 1;

CREATE TABLE "categorias_financieras" (
  "id" UUID NOT NULL,
  "clave" TEXT NOT NULL,
  "nombre" TEXT NOT NULL,
  "naturaleza" "NaturalezaCategoriaFinanciera" NOT NULL,
  "direccion" "DireccionCategoriaFinanciera" NOT NULL DEFAULT 'AMBAS',
  "activa" BOOLEAN NOT NULL DEFAULT TRUE,
  "orden" INTEGER NOT NULL DEFAULT 0,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "categorias_financieras_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "categorias_financieras_clave_key" ON "categorias_financieras"("clave");
CREATE INDEX "categorias_financieras_activa_orden_idx" ON "categorias_financieras"("activa", "orden");

INSERT INTO "categorias_financieras" ("id", "clave", "nombre", "naturaleza", "direccion", "orden", "updated_at") VALUES
  (gen_random_uuid(), 'HONORARIOS', 'Honorarios', 'DESPACHO', 'INGRESO', 10, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'NOTARIA', 'Notaría', 'TERCERO', 'AMBAS', 20, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'REGISTRO_PUBLICO', 'Registro Público', 'TERCERO', 'AMBAS', 30, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'DERECHOS', 'Derechos', 'TERCERO', 'AMBAS', 40, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'IMPUESTOS', 'Impuestos', 'TERCERO', 'AMBAS', 50, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'GASTOS_DESPACHO', 'Gastos del despacho', 'EGRESO_DESPACHO', 'EGRESO', 60, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'OTROS_TERCEROS', 'Otros terceros', 'TERCERO', 'AMBAS', 70, CURRENT_TIMESTAMP)
ON CONFLICT ("clave") DO NOTHING;

CREATE TABLE "cuentas_financieras" (
  "id" UUID NOT NULL,
  "institucion" TEXT NOT NULL,
  "alias" TEXT NOT NULL,
  "tipo" TEXT NOT NULL,
  "ultimos_cuatro" TEXT,
  "moneda" TEXT NOT NULL DEFAULT 'MXN',
  "activa" BOOLEAN NOT NULL DEFAULT TRUE,
  "predeterminada" BOOLEAN NOT NULL DEFAULT FALSE,
  "saldo_inicial" DECIMAL(14,2) NOT NULL DEFAULT 0,
  "creada_por_id" UUID NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "cuentas_financieras_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "cuentas_financieras_ultimos_cuatro_check" CHECK ("ultimos_cuatro" IS NULL OR "ultimos_cuatro" ~ '^[0-9]{4}$')
);

CREATE UNIQUE INDEX "cuentas_financieras_institucion_alias_key" ON "cuentas_financieras"("institucion", "alias");
CREATE INDEX "cuentas_financieras_activa_predeterminada_idx" ON "cuentas_financieras"("activa", "predeterminada");

CREATE TABLE "honorarios_generados" (
  "id" UUID NOT NULL,
  "clave_origen" TEXT NOT NULL,
  "cotizacion_id" UUID NOT NULL,
  "cotizacion_version_id" UUID NOT NULL,
  "expediente_id" UUID,
  "notaria_id" UUID,
  "responsable_id" UUID,
  "monto" DECIMAL(14,2) NOT NULL,
  "fecha_reconocimiento" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "fecha_vencimiento" TIMESTAMP(3),
  "evento_reconocimiento" TEXT NOT NULL DEFAULT 'COTIZACION_ACEPTADA',
  "estado" "EstadoHonorarioGenerado" NOT NULL DEFAULT 'RECONOCIDO',
  "reconocido_por_id" UUID NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "honorarios_generados_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "honorarios_generados_monto_check" CHECK ("monto" > 0)
);

CREATE UNIQUE INDEX "honorarios_generados_clave_origen_key" ON "honorarios_generados"("clave_origen");
CREATE UNIQUE INDEX "honorarios_generados_cotizacion_id_key" ON "honorarios_generados"("cotizacion_id");
CREATE INDEX "honorarios_generados_expediente_id_idx" ON "honorarios_generados"("expediente_id");
CREATE INDEX "honorarios_generados_fecha_reconocimiento_estado_idx" ON "honorarios_generados"("fecha_reconocimiento", "estado");
CREATE INDEX "honorarios_generados_responsable_id_notaria_id_idx" ON "honorarios_generados"("responsable_id", "notaria_id");

ALTER TABLE "movimientos_financieros"
  ADD COLUMN "folio" TEXT,
  ADD COLUMN "compareciente_id" UUID,
  ADD COLUMN "notaria_id" UUID,
  ADD COLUMN "responsable_id" UUID,
  ADD COLUMN "cuenta_id" UUID,
  ADD COLUMN "descripcion" TEXT,
  ADD COLUMN "fecha_registro" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN "idempotency_key" TEXT,
  ADD COLUMN "aplicado_por_id" UUID,
  ADD COLUMN "fecha_aplicacion" TIMESTAMP(3),
  ADD COLUMN "cancelado_por_id" UUID,
  ADD COLUMN "fecha_cancelacion" TIMESTAMP(3),
  ADD COLUMN "motivo_cancelacion" TEXT;

CREATE UNIQUE INDEX "movimientos_financieros_folio_key" ON "movimientos_financieros"("folio");
CREATE UNIQUE INDEX "movimientos_financieros_idempotency_key_key" ON "movimientos_financieros"("idempotency_key");
CREATE INDEX "movimientos_financieros_fecha_movimiento_estatus_idx" ON "movimientos_financieros"("fecha_movimiento", "estatus");
CREATE INDEX "movimientos_financieros_naturaleza_estatus_idx" ON "movimientos_financieros"("naturaleza", "estatus");
CREATE INDEX "movimientos_financieros_expediente_id_fecha_movimiento_idx" ON "movimientos_financieros"("expediente_id", "fecha_movimiento");
CREATE INDEX "movimientos_financieros_cuenta_id_fecha_movimiento_idx" ON "movimientos_financieros"("cuenta_id", "fecha_movimiento");
CREATE INDEX "movimientos_financieros_notaria_id_fecha_movimiento_idx" ON "movimientos_financieros"("notaria_id", "fecha_movimiento");
CREATE INDEX "movimientos_financieros_responsable_id_fecha_movimiento_idx" ON "movimientos_financieros"("responsable_id", "fecha_movimiento");

CREATE TABLE "movimiento_distribuciones" (
  "id" UUID NOT NULL,
  "movimiento_id" UUID NOT NULL,
  "categoria_id" UUID NOT NULL,
  "honorario_generado_id" UUID,
  "monto" DECIMAL(14,2) NOT NULL,
  "observaciones" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "movimiento_distribuciones_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "movimiento_distribuciones_monto_check" CHECK ("monto" > 0)
);

CREATE INDEX "movimiento_distribuciones_movimiento_id_idx" ON "movimiento_distribuciones"("movimiento_id");
CREATE INDEX "movimiento_distribuciones_categoria_id_idx" ON "movimiento_distribuciones"("categoria_id");
CREATE INDEX "movimiento_distribuciones_honorario_generado_id_idx" ON "movimiento_distribuciones"("honorario_generado_id");

CREATE TABLE "comprobantes_financieros" (
  "id" UUID NOT NULL,
  "folio" TEXT NOT NULL,
  "movimiento_id" UUID NOT NULL,
  "tipo" "NaturalezaMovimiento" NOT NULL,
  "fecha" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "importe" DECIMAL(14,2) NOT NULL,
  "concepto" TEXT NOT NULL,
  "persona" TEXT,
  "forma_pago" TEXT,
  "cuenta_snapshot" JSONB,
  "observaciones" TEXT,
  "snapshot" JSONB NOT NULL,
  "estado" "EstadoComprobanteFinanciero" NOT NULL DEFAULT 'VIGENTE',
  "registrado_por_id" UUID NOT NULL,
  "anulado_por_id" UUID,
  "fecha_anulacion" TIMESTAMP(3),
  "motivo_anulacion" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "comprobantes_financieros_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "comprobantes_financieros_importe_check" CHECK ("importe" > 0)
);

CREATE UNIQUE INDEX "comprobantes_financieros_folio_key" ON "comprobantes_financieros"("folio");
CREATE UNIQUE INDEX "comprobantes_financieros_movimiento_id_key" ON "comprobantes_financieros"("movimiento_id");
CREATE INDEX "comprobantes_financieros_fecha_tipo_idx" ON "comprobantes_financieros"("fecha", "tipo");

CREATE TABLE "transacciones_estado_cuenta" (
  "id" UUID NOT NULL,
  "cuenta_id" UUID NOT NULL,
  "fecha" TIMESTAMP(3) NOT NULL,
  "importe" DECIMAL(14,2) NOT NULL,
  "descripcion" TEXT NOT NULL,
  "referencia" TEXT,
  "fingerprint" TEXT NOT NULL,
  "fuente" TEXT NOT NULL DEFAULT 'MANUAL',
  "estado" "EstadoTransaccionBanco" NOT NULL DEFAULT 'PENDIENTE',
  "importado_por_id" UUID NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "transacciones_estado_cuenta_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "transacciones_estado_cuenta_importe_check" CHECK ("importe" <> 0)
);

CREATE UNIQUE INDEX "transacciones_estado_cuenta_fingerprint_key" ON "transacciones_estado_cuenta"("fingerprint");
CREATE INDEX "transacciones_estado_cuenta_cuenta_id_fecha_estado_idx" ON "transacciones_estado_cuenta"("cuenta_id", "fecha", "estado");

CREATE TABLE "conciliaciones_financieras" (
  "id" UUID NOT NULL,
  "movimiento_id" UUID NOT NULL,
  "transaccion_bancaria_id" UUID NOT NULL,
  "estado" "EstadoConciliacionFinanciera" NOT NULL DEFAULT 'SUGERIDA',
  "metodo" "MetodoConciliacionFinanciera" NOT NULL,
  "score" INTEGER,
  "justificacion" TEXT,
  "conciliado_por_id" UUID,
  "fecha_conciliacion" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "conciliaciones_financieras_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "conciliaciones_financieras_score_check" CHECK ("score" IS NULL OR ("score" >= 0 AND "score" <= 100))
);

CREATE UNIQUE INDEX "conciliaciones_financieras_movimiento_id_transaccion_bancaria_id_key" ON "conciliaciones_financieras"("movimiento_id", "transaccion_bancaria_id");
CREATE INDEX "conciliaciones_financieras_estado_created_at_idx" ON "conciliaciones_financieras"("estado", "created_at");

ALTER TABLE "cuentas_financieras" ADD CONSTRAINT "cuentas_financieras_creada_por_id_fkey" FOREIGN KEY ("creada_por_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "honorarios_generados" ADD CONSTRAINT "honorarios_generados_cotizacion_id_fkey" FOREIGN KEY ("cotizacion_id") REFERENCES "cotizaciones"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "honorarios_generados" ADD CONSTRAINT "honorarios_generados_cotizacion_version_id_fkey" FOREIGN KEY ("cotizacion_version_id") REFERENCES "cotizacion_versiones"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "honorarios_generados" ADD CONSTRAINT "honorarios_generados_expediente_id_fkey" FOREIGN KEY ("expediente_id") REFERENCES "expedientes"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "honorarios_generados" ADD CONSTRAINT "honorarios_generados_notaria_id_fkey" FOREIGN KEY ("notaria_id") REFERENCES "notarias"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "honorarios_generados" ADD CONSTRAINT "honorarios_generados_responsable_id_fkey" FOREIGN KEY ("responsable_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "honorarios_generados" ADD CONSTRAINT "honorarios_generados_reconocido_por_id_fkey" FOREIGN KEY ("reconocido_por_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "movimientos_financieros" ADD CONSTRAINT "movimientos_financieros_compareciente_id_fkey" FOREIGN KEY ("compareciente_id") REFERENCES "comparecientes"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "movimientos_financieros" ADD CONSTRAINT "movimientos_financieros_notaria_id_fkey" FOREIGN KEY ("notaria_id") REFERENCES "notarias"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "movimientos_financieros" ADD CONSTRAINT "movimientos_financieros_responsable_id_fkey" FOREIGN KEY ("responsable_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "movimientos_financieros" ADD CONSTRAINT "movimientos_financieros_cuenta_id_fkey" FOREIGN KEY ("cuenta_id") REFERENCES "cuentas_financieras"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "movimientos_financieros" ADD CONSTRAINT "movimientos_financieros_aplicado_por_id_fkey" FOREIGN KEY ("aplicado_por_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "movimientos_financieros" ADD CONSTRAINT "movimientos_financieros_cancelado_por_id_fkey" FOREIGN KEY ("cancelado_por_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "movimiento_distribuciones" ADD CONSTRAINT "movimiento_distribuciones_movimiento_id_fkey" FOREIGN KEY ("movimiento_id") REFERENCES "movimientos_financieros"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "movimiento_distribuciones" ADD CONSTRAINT "movimiento_distribuciones_categoria_id_fkey" FOREIGN KEY ("categoria_id") REFERENCES "categorias_financieras"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "movimiento_distribuciones" ADD CONSTRAINT "movimiento_distribuciones_honorario_generado_id_fkey" FOREIGN KEY ("honorario_generado_id") REFERENCES "honorarios_generados"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "comprobantes_financieros" ADD CONSTRAINT "comprobantes_financieros_movimiento_id_fkey" FOREIGN KEY ("movimiento_id") REFERENCES "movimientos_financieros"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "comprobantes_financieros" ADD CONSTRAINT "comprobantes_financieros_registrado_por_id_fkey" FOREIGN KEY ("registrado_por_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "comprobantes_financieros" ADD CONSTRAINT "comprobantes_financieros_anulado_por_id_fkey" FOREIGN KEY ("anulado_por_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "transacciones_estado_cuenta" ADD CONSTRAINT "transacciones_estado_cuenta_cuenta_id_fkey" FOREIGN KEY ("cuenta_id") REFERENCES "cuentas_financieras"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "transacciones_estado_cuenta" ADD CONSTRAINT "transacciones_estado_cuenta_importado_por_id_fkey" FOREIGN KEY ("importado_por_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "conciliaciones_financieras" ADD CONSTRAINT "conciliaciones_financieras_movimiento_id_fkey" FOREIGN KEY ("movimiento_id") REFERENCES "movimientos_financieros"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "conciliaciones_financieras" ADD CONSTRAINT "conciliaciones_financieras_transaccion_bancaria_id_fkey" FOREIGN KEY ("transaccion_bancaria_id") REFERENCES "transacciones_estado_cuenta"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "conciliaciones_financieras" ADD CONSTRAINT "conciliaciones_financieras_conciliado_por_id_fkey" FOREIGN KEY ("conciliado_por_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
