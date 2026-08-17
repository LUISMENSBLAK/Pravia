-- Módulo Prospectos: catálogos canónicos y separación aditiva entre pipeline y etapa documental.
-- No elimina, renombra ni rellena campos legacy. Los registros existentes conservan etapa/servicio canónico NULL.

CREATE TABLE IF NOT EXISTS "pravia_os"."prospecto_etapas_catalogo" (
  "codigo" TEXT NOT NULL,
  "label" TEXT NOT NULL,
  "orden" INTEGER NOT NULL,
  "activo" BOOLEAN NOT NULL DEFAULT true,
  CONSTRAINT "prospecto_etapas_catalogo_pkey" PRIMARY KEY ("codigo")
);

CREATE UNIQUE INDEX IF NOT EXISTS "prospecto_etapas_catalogo_label_key" ON "pravia_os"."prospecto_etapas_catalogo" ("label");
CREATE UNIQUE INDEX IF NOT EXISTS "prospecto_etapas_catalogo_orden_key" ON "pravia_os"."prospecto_etapas_catalogo" ("orden");

INSERT INTO "pravia_os"."prospecto_etapas_catalogo" ("codigo", "label", "orden", "activo") VALUES
  ('PROSPECTO_RECIBIDO', 'Prospecto recibido', 1, true),
  ('ANTECEDENTES_SOLICITADOS', 'Antecedentes solicitados', 2, true),
  ('ANTECEDENTES_RECIBIDOS', 'Antecedentes recibidos', 3, true)
ON CONFLICT ("codigo") DO UPDATE SET "label" = EXCLUDED."label", "orden" = EXCLUDED."orden", "activo" = EXCLUDED."activo";

CREATE TABLE IF NOT EXISTS "pravia_os"."prospecto_servicios_catalogo" (
  "codigo" TEXT NOT NULL,
  "label" TEXT NOT NULL,
  "orden" INTEGER NOT NULL,
  "activo" BOOLEAN NOT NULL DEFAULT true,
  "estados" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "tipos_persona" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  CONSTRAINT "prospecto_servicios_catalogo_pkey" PRIMARY KEY ("codigo")
);

CREATE UNIQUE INDEX IF NOT EXISTS "prospecto_servicios_catalogo_label_key" ON "pravia_os"."prospecto_servicios_catalogo" ("label");
CREATE UNIQUE INDEX IF NOT EXISTS "prospecto_servicios_catalogo_orden_key" ON "pravia_os"."prospecto_servicios_catalogo" ("orden");

INSERT INTO "pravia_os"."prospecto_servicios_catalogo" ("codigo", "label", "orden", "activo", "estados", "tipos_persona") VALUES
  ('COMPRAVENTA', 'Compraventa', 1, true, ARRAY['Nayarit','Jalisco'], ARRAY[]::TEXT[]),
  ('DONACION', 'Donación', 2, true, ARRAY['Nayarit','Jalisco'], ARRAY[]::TEXT[]),
  ('CESION_DERECHOS_FIDEICOMISARIOS', 'Cesión de derechos fideicomisarios', 3, true, ARRAY['Nayarit','Jalisco'], ARRAY[]::TEXT[]),
  ('PERMUTA', 'Permuta', 4, true, ARRAY['Nayarit','Jalisco'], ARRAY[]::TEXT[]),
  ('SUBDIVISION', 'Subdivisión', 5, true, ARRAY['Nayarit','Jalisco'], ARRAY[]::TEXT[]),
  ('FUSION', 'Fusión', 6, true, ARRAY['Nayarit','Jalisco'], ARRAY[]::TEXT[]),
  ('REGIMEN_PROPIEDAD_CONDOMINIO', 'Régimen de propiedad en condominio', 7, true, ARRAY['Nayarit','Jalisco'], ARRAY[]::TEXT[]),
  ('CONSTITUCION_SERVIDUMBRE', 'Constitución de servidumbre', 8, true, ARRAY['Nayarit','Jalisco'], ARRAY[]::TEXT[]),
  ('EXTINCION_SERVIDUMBRE', 'Extinción de servidumbre', 9, true, ARRAY['Nayarit','Jalisco'], ARRAY[]::TEXT[]),
  ('RECONOCIMIENTO_SERVIDUMBRE', 'Reconocimiento de servidumbre', 10, true, ARRAY['Nayarit','Jalisco'], ARRAY[]::TEXT[]),
  ('CONSTITUCION_USUFRUCTO', 'Constitución de usufructo', 11, true, ARRAY['Nayarit','Jalisco'], ARRAY[]::TEXT[]),
  ('EXTINCION_USUFRUCTO', 'Extinción de usufructo', 12, true, ARRAY['Nayarit','Jalisco'], ARRAY[]::TEXT[]),
  ('RECONOCIMIENTO_FIDEICOMISARIO_SUSTITUTO', 'Reconocimiento de fideicomisario sustituto', 13, true, ARRAY['Nayarit','Jalisco'], ARRAY[]::TEXT[]),
  ('CONSTITUCION_FIDEICOMISO_ADMINISTRACION', 'Constitución de fideicomiso de administración', 14, true, ARRAY['Nayarit','Jalisco'], ARRAY[]::TEXT[]),
  ('CONSTITUCION_FIDEICOMISO_GARANTIA', 'Constitución de fideicomiso de garantía', 15, true, ARRAY['Nayarit','Jalisco'], ARRAY[]::TEXT[]),
  ('CONSTITUCION_FIDEICOMISO_TRASLATIVO_DOMINIO', 'Constitución de fideicomiso traslativo de dominio', 16, true, ARRAY['Nayarit','Jalisco'], ARRAY[]::TEXT[]),
  ('CONVENIO_MODIFICATORIO_FIDEICOMISO', 'Convenio modificatorio de fideicomiso', 17, true, ARRAY['Nayarit','Jalisco'], ARRAY[]::TEXT[]),
  ('EXTINCION_FIDEICOMISO', 'Extinción de fideicomiso', 18, true, ARRAY['Nayarit','Jalisco'], ARRAY[]::TEXT[]),
  ('JUICIO_SUCESORIO_TESTAMENTARIO_PRIMERA_ETAPA', 'Juicio sucesorio testamentario — primera etapa', 19, true, ARRAY[]::TEXT[], ARRAY[]::TEXT[]),
  ('JUICIO_SUCESORIO_INTESTAMENTARIO_PRIMERA_ETAPA', 'Juicio sucesorio intestamentario — primera etapa', 20, true, ARRAY[]::TEXT[], ARRAY[]::TEXT[]),
  ('JUICIO_SUCESORIO_TESTAMENTARIO_SEGUNDA_ETAPA', 'Juicio sucesorio testamentario — segunda etapa', 21, true, ARRAY[]::TEXT[], ARRAY[]::TEXT[]),
  ('JUICIO_SUCESORIO_INTESTAMENTARIO_SEGUNDA_ETAPA', 'Juicio sucesorio intestamentario — segunda etapa', 22, true, ARRAY[]::TEXT[], ARRAY[]::TEXT[]),
  ('CESION_DERECHOS_HEREDITARIOS', 'Cesión de derechos hereditarios', 23, true, ARRAY[]::TEXT[], ARRAY[]::TEXT[]),
  ('PODER', 'Poder', 24, true, ARRAY['Nayarit','Jalisco'], ARRAY['Persona física','Persona moral']),
  ('REVOCACION_PODER', 'Revocación de poder', 25, true, ARRAY['Nayarit','Jalisco'], ARRAY['Persona física','Persona moral']),
  ('TESTAMENTO_PUBLICO_ABIERTO', 'Testamento público abierto', 26, true, ARRAY['Nayarit','Jalisco'], ARRAY[]::TEXT[]),
  ('REVOCACION_TESTAMENTO', 'Revocación de testamento', 27, true, ARRAY[]::TEXT[], ARRAY[]::TEXT[]),
  ('RECONOCIMIENTO_DEUDA_GARANTIA_HIPOTECARIA', 'Reconocimiento de deuda con garantía hipotecaria', 28, true, ARRAY['Nayarit','Jalisco'], ARRAY[]::TEXT[]),
  ('CANCELACION_HIPOTECA', 'Cancelación de hipoteca', 29, true, ARRAY['Nayarit','Jalisco'], ARRAY[]::TEXT[]),
  ('CONSTITUCION_HIPOTECA', 'Constitución de hipoteca', 30, true, ARRAY['Nayarit','Jalisco'], ARRAY[]::TEXT[]),
  ('CONVENIO_MODIFICACION_GARANTIA', 'Convenio de modificación de garantía', 31, true, ARRAY['Nayarit','Jalisco'], ARRAY[]::TEXT[]),
  ('PROTOCOLIZACION_DOCUMENTOS', 'Protocolización de documentos', 32, true, ARRAY[]::TEXT[], ARRAY[]::TEXT[]),
  ('PROTOCOLIZACION_ACTA_ASAMBLEA', 'Protocolización de acta de asamblea', 33, true, ARRAY['Nayarit','Jalisco'], ARRAY[]::TEXT[]),
  ('RATIFICACION_FIRMAS', 'Ratificación de firmas', 34, true, ARRAY[]::TEXT[], ARRAY[]::TEXT[]),
  ('FE_HECHOS', 'Fe de hechos', 35, true, ARRAY[]::TEXT[], ARRAY[]::TEXT[]),
  ('CONSTITUCION_SOCIEDADES', 'Constitución de sociedades', 36, true, ARRAY['Nayarit','Jalisco'], ARRAY[]::TEXT[]),
  ('ADJUDICACION_HERENCIA', 'Adjudicación por herencia', 37, true, ARRAY[]::TEXT[], ARRAY[]::TEXT[]),
  ('ADJUDICACION_REBELDIA', 'Adjudicación en rebeldía', 38, true, ARRAY[]::TEXT[], ARRAY[]::TEXT[])
ON CONFLICT ("codigo") DO UPDATE SET
  "label" = EXCLUDED."label", "orden" = EXCLUDED."orden", "activo" = EXCLUDED."activo",
  "estados" = EXCLUDED."estados", "tipos_persona" = EXCLUDED."tipos_persona";

ALTER TABLE "pravia_os"."prospectos" ADD COLUMN IF NOT EXISTS "etapa_operativa_codigo" TEXT;
ALTER TABLE "pravia_os"."prospectos" ADD COLUMN IF NOT EXISTS "servicio_catalogo_codigo" TEXT;

CREATE INDEX IF NOT EXISTS "idx_prospectos_etapa_operativa_fk" ON "pravia_os"."prospectos" ("etapa_operativa_codigo");
CREATE INDEX IF NOT EXISTS "idx_prospectos_servicio_catalogo_fk" ON "pravia_os"."prospectos" ("servicio_catalogo_codigo");

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'prospectos_etapa_operativa_codigo_fkey') THEN
    ALTER TABLE "pravia_os"."prospectos" ADD CONSTRAINT "prospectos_etapa_operativa_codigo_fkey"
      FOREIGN KEY ("etapa_operativa_codigo") REFERENCES "pravia_os"."prospecto_etapas_catalogo"("codigo")
      ON DELETE RESTRICT ON UPDATE CASCADE NOT VALID;
  END IF;
END $$;
ALTER TABLE "pravia_os"."prospectos" VALIDATE CONSTRAINT "prospectos_etapa_operativa_codigo_fkey";

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'prospectos_servicio_catalogo_codigo_fkey') THEN
    ALTER TABLE "pravia_os"."prospectos" ADD CONSTRAINT "prospectos_servicio_catalogo_codigo_fkey"
      FOREIGN KEY ("servicio_catalogo_codigo") REFERENCES "pravia_os"."prospecto_servicios_catalogo"("codigo")
      ON DELETE RESTRICT ON UPDATE CASCADE NOT VALID;
  END IF;
END $$;
ALTER TABLE "pravia_os"."prospectos" VALIDATE CONSTRAINT "prospectos_servicio_catalogo_codigo_fkey";
