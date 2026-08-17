-- Fase 7: módulo fiscal ISR. Migración exclusivamente aditiva; no calcula ni modifica expedientes existentes.
CREATE TYPE pravia_os."ISRTipoOperacion" AS ENUM ('ENAJENACION_INMUEBLE', 'ADQUISICION_INMUEBLE', 'CASO_ESPECIAL');
CREATE TYPE pravia_os."ISREstadoCalculo" AS ENUM ('BORRADOR', 'LISTO_PARA_CALCULAR', 'CALCULADO', 'REQUIERE_REVISION');
CREATE TYPE pravia_os."ISRPropuestaEstado" AS ENUM ('PENDIENTE', 'ACEPTADA', 'RECHAZADA', 'CONFLICTO');

CREATE TABLE pravia_os.fiscal_rule_sets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clave TEXT NOT NULL,
  version TEXT NOT NULL,
  ejercicio INTEGER NOT NULL,
  tipo_operacion pravia_os."ISRTipoOperacion" NOT NULL,
  jurisdiccion TEXT NOT NULL DEFAULT 'MX-FED',
  vigencia_desde DATE NOT NULL,
  vigencia_hasta DATE,
  fuente_normativa TEXT NOT NULL,
  fuente_url TEXT NOT NULL,
  incorporado_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  activo BOOLEAN NOT NULL DEFAULT TRUE,
  parametros JSONB NOT NULL,
  CONSTRAINT fiscal_rule_sets_clave_version_key UNIQUE (clave, version)
);

CREATE TABLE pravia_os.fiscal_rate_tables (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  rule_set_id UUID NOT NULL,
  clave TEXT NOT NULL,
  nombre TEXT NOT NULL,
  moneda TEXT NOT NULL DEFAULT 'MXN',
  escala INTEGER NOT NULL DEFAULT 2,
  CONSTRAINT fiscal_rate_tables_rule_set_clave_key UNIQUE (rule_set_id, clave),
  CONSTRAINT fiscal_rate_tables_rule_set_id_fkey FOREIGN KEY (rule_set_id) REFERENCES pravia_os.fiscal_rule_sets(id) ON DELETE RESTRICT
);

CREATE TABLE pravia_os.fiscal_rate_brackets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  rate_table_id UUID NOT NULL,
  orden INTEGER NOT NULL,
  limite_inferior DECIMAL(18,2) NOT NULL,
  limite_superior DECIMAL(18,2),
  cuota_fija DECIMAL(18,2) NOT NULL,
  porcentaje DECIMAL(9,6) NOT NULL,
  CONSTRAINT fiscal_rate_brackets_table_orden_key UNIQUE (rate_table_id, orden),
  CONSTRAINT fiscal_rate_brackets_rate_table_id_fkey FOREIGN KEY (rate_table_id) REFERENCES pravia_os.fiscal_rate_tables(id) ON DELETE RESTRICT
);

CREATE TABLE pravia_os.calculos_isr (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  folio TEXT NOT NULL UNIQUE,
  tipo_operacion pravia_os."ISRTipoOperacion" NOT NULL,
  estado pravia_os."ISREstadoCalculo" NOT NULL DEFAULT 'BORRADOR',
  ejercicio INTEGER NOT NULL,
  expediente_id UUID,
  compareciente_id UUID,
  contribuyente_nombre TEXT,
  contribuyente_rfc TEXT,
  inmueble_descripcion TEXT,
  contribuyente_snapshot JSONB,
  input_data JSONB NOT NULL,
  ultima_version INTEGER NOT NULL DEFAULT 0,
  datos_modificados BOOLEAN NOT NULL DEFAULT FALSE,
  creado_por_id UUID NOT NULL,
  actualizado_por_id UUID NOT NULL,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  archived_at TIMESTAMP(3),
  CONSTRAINT calculos_isr_expediente_id_fkey FOREIGN KEY (expediente_id) REFERENCES pravia_os.expedientes(id) ON DELETE RESTRICT,
  CONSTRAINT calculos_isr_compareciente_id_fkey FOREIGN KEY (compareciente_id) REFERENCES pravia_os.comparecientes(id) ON DELETE RESTRICT,
  CONSTRAINT calculos_isr_creado_por_id_fkey FOREIGN KEY (creado_por_id) REFERENCES pravia_os.users(id) ON DELETE RESTRICT,
  CONSTRAINT calculos_isr_actualizado_por_id_fkey FOREIGN KEY (actualizado_por_id) REFERENCES pravia_os.users(id) ON DELETE RESTRICT
);

CREATE TABLE pravia_os.calculos_isr_versiones (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  calculo_id UUID NOT NULL,
  version INTEGER NOT NULL,
  rule_set_id UUID NOT NULL,
  input_snapshot JSONB NOT NULL,
  ruleset_snapshot JSONB NOT NULL,
  breakdown JSONB NOT NULL,
  result JSONB NOT NULL,
  calculado_por_id UUID NOT NULL,
  calculated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT calculos_isr_versiones_calculo_version_key UNIQUE (calculo_id, version),
  CONSTRAINT calculos_isr_versiones_calculo_id_fkey FOREIGN KEY (calculo_id) REFERENCES pravia_os.calculos_isr(id) ON DELETE RESTRICT,
  CONSTRAINT calculos_isr_versiones_rule_set_id_fkey FOREIGN KEY (rule_set_id) REFERENCES pravia_os.fiscal_rule_sets(id) ON DELETE RESTRICT,
  CONSTRAINT calculos_isr_versiones_calculado_por_id_fkey FOREIGN KEY (calculado_por_id) REFERENCES pravia_os.users(id) ON DELETE RESTRICT
);

CREATE TABLE pravia_os.calculos_isr_documentos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  calculo_id UUID NOT NULL,
  documento_id UUID NOT NULL,
  creado_por_id UUID NOT NULL,
  estatus pravia_os."VinculoEstatus" NOT NULL DEFAULT 'ACTIVO',
  fecha_vinculo TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  inactivado_at TIMESTAMP(3),
  inactivado_por_id UUID,
  motivo_inactivacion TEXT,
  CONSTRAINT calculos_isr_documentos_calculo_documento_key UNIQUE (calculo_id, documento_id),
  CONSTRAINT calculos_isr_documentos_calculo_id_fkey FOREIGN KEY (calculo_id) REFERENCES pravia_os.calculos_isr(id) ON DELETE RESTRICT,
  CONSTRAINT calculos_isr_documentos_documento_id_fkey FOREIGN KEY (documento_id) REFERENCES pravia_os.documentos(id) ON DELETE RESTRICT,
  CONSTRAINT calculos_isr_documentos_creado_por_id_fkey FOREIGN KEY (creado_por_id) REFERENCES pravia_os.users(id) ON DELETE RESTRICT
);

CREATE TABLE pravia_os.calculos_isr_propuestas (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  calculo_id UUID NOT NULL,
  field_path TEXT NOT NULL,
  proposed_value JSONB NOT NULL,
  status pravia_os."ISRPropuestaEstado" NOT NULL DEFAULT 'PENDIENTE',
  source_document_id UUID NOT NULL,
  source_document_name TEXT NOT NULL,
  source_page INTEGER,
  confidence DECIMAL(5,4),
  model_version TEXT NOT NULL,
  source_fragment TEXT,
  conflict_group TEXT,
  extracted_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  reviewed_at TIMESTAMP(3),
  reviewed_by_id UUID,
  CONSTRAINT calculos_isr_propuestas_calculo_id_fkey FOREIGN KEY (calculo_id) REFERENCES pravia_os.calculos_isr(id) ON DELETE RESTRICT,
  CONSTRAINT calculos_isr_propuestas_source_document_id_fkey FOREIGN KEY (source_document_id) REFERENCES pravia_os.documentos(id) ON DELETE RESTRICT,
  CONSTRAINT calculos_isr_propuestas_reviewer_id_fkey FOREIGN KEY (reviewed_by_id) REFERENCES pravia_os.users(id) ON DELETE RESTRICT
);

CREATE INDEX idx_fiscal_rulesets_lookup ON pravia_os.fiscal_rule_sets(ejercicio, tipo_operacion, activo);
CREATE INDEX idx_calculos_isr_expediente ON pravia_os.calculos_isr(expediente_id);
CREATE INDEX idx_calculos_isr_compareciente ON pravia_os.calculos_isr(compareciente_id);
CREATE INDEX idx_calculos_isr_estado_ejercicio ON pravia_os.calculos_isr(estado, ejercicio);
CREATE INDEX idx_calculos_isr_rfc ON pravia_os.calculos_isr(contribuyente_rfc);
CREATE INDEX idx_calculos_isr_version_ruleset ON pravia_os.calculos_isr_versiones(rule_set_id);
CREATE INDEX idx_calculos_isr_documento ON pravia_os.calculos_isr_documentos(documento_id);
CREATE INDEX idx_calculos_isr_propuestas_estado ON pravia_os.calculos_isr_propuestas(calculo_id, status);
CREATE INDEX idx_calculos_isr_propuestas_documento ON pravia_os.calculos_isr_propuestas(source_document_id);

-- Catálogo oficial inicial. La tabla reproduce el Anexo 8 de la RMF 2026 publicado en DOF el 28-12-2025.
INSERT INTO pravia_os.fiscal_rule_sets (
  id, clave, version, ejercicio, tipo_operacion, jurisdiccion, vigencia_desde, vigencia_hasta,
  fuente_normativa, fuente_url, parametros
) VALUES (
  '2d790ca1-30f8-4897-b552-f6c20a89f8e1',
  'ISR_ENAJENACION_INMUEBLE_PAGO_PROVISIONAL_MX_FED',
  '2026.1-DOF-2025-12-28',
  2026,
  'ENAJENACION_INMUEBLE',
  'MX-FED',
  DATE '2026-01-01',
  DATE '2026-12-31',
  'LISR artículos 119, 120, 121 y 126; RMF 2026 regla 3.15.4; Anexo 8 apartado A.I',
  'https://www.dof.gob.mx/nota_detalle.php?codigo=5777219&fecha=28/12/2025',
  '{"currency":"MXN","rounding":"HALF_UP_CENT","years_cap":20,"scope":"Pago provisional federal; persona física residente; enajenación de inmueble; operación ordinaria sin exención ni supuestos especiales"}'::jsonb
);

INSERT INTO pravia_os.fiscal_rate_tables (id, rule_set_id, clave, nombre)
VALUES (
  'f6e86680-dfea-4d40-bc33-2b4ed51c1538',
  '2d790ca1-30f8-4897-b552-f6c20a89f8e1',
  'ANEXO_8_A_I_2026',
  'Pago provisional por enajenación de inmuebles 2026'
);

INSERT INTO pravia_os.fiscal_rate_brackets (rate_table_id, orden, limite_inferior, limite_superior, cuota_fija, porcentaje) VALUES
('f6e86680-dfea-4d40-bc33-2b4ed51c1538', 1,       0.01,   10135.11,       0.00,  1.920000),
('f6e86680-dfea-4d40-bc33-2b4ed51c1538', 2,   10135.12,   86022.11,     194.59,  6.400000),
('f6e86680-dfea-4d40-bc33-2b4ed51c1538', 3,   86022.12,  151176.19,    5051.37, 10.880000),
('f6e86680-dfea-4d40-bc33-2b4ed51c1538', 4,  151176.20,  175735.66,   12140.13, 16.000000),
('f6e86680-dfea-4d40-bc33-2b4ed51c1538', 5,  175735.67,  210403.69,   16069.64, 17.920000),
('f6e86680-dfea-4d40-bc33-2b4ed51c1538', 6,  210403.70,  424353.97,   22282.14, 21.360000),
('f6e86680-dfea-4d40-bc33-2b4ed51c1538', 7,  424353.98,  668840.14,   67981.92, 23.520000),
('f6e86680-dfea-4d40-bc33-2b4ed51c1538', 8,  668840.15, 1276925.98,  125485.07, 30.000000),
('f6e86680-dfea-4d40-bc33-2b4ed51c1538', 9, 1276925.99, 1702567.97,  307910.81, 32.000000),
('f6e86680-dfea-4d40-bc33-2b4ed51c1538',10, 1702567.98, 5107703.92,  444116.23, 34.000000),
('f6e86680-dfea-4d40-bc33-2b4ed51c1538',11, 5107703.93,        NULL, 1601862.46, 35.000000);
