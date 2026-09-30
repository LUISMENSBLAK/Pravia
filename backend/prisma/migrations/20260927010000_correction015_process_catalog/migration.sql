-- Corrección 015: el concepto maestro pasa a ser el catálogo general de
-- procesos, con una clasificación funcional cerrada y una relación de
-- complemento explícita que no se confunde con el grafo de dependencias.
CREATE TYPE pravia_os."ConfiguracionProcesoTipo" AS ENUM (
  'HITO',
  'ACTIVIDAD',
  'SOLICITUD_ESPERA'
);

ALTER TABLE pravia_os.configuracion_conceptos_actividad
  ADD COLUMN tipo_proceso pravia_os."ConfiguracionProcesoTipo" NOT NULL DEFAULT 'ACTIVIDAD',
  ADD COLUMN proceso_complementario_id UUID,
  ADD COLUMN es_base_pravia BOOLEAN NOT NULL DEFAULT FALSE;

UPDATE pravia_os.configuracion_conceptos_actividad
SET tipo_proceso = CASE
  WHEN naturaleza = 'CLIENTE_HITO' THEN 'HITO'::pravia_os."ConfiguracionProcesoTipo"
  WHEN naturaleza IN ('INGRESO_A_EXTERNO', 'ESPERA_EXTERNA') THEN 'SOLICITUD_ESPERA'::pravia_os."ConfiguracionProcesoTipo"
  ELSE 'ACTIVIDAD'::pravia_os."ConfiguracionProcesoTipo"
END;

ALTER TABLE pravia_os.configuracion_conceptos_actividad
  ADD CONSTRAINT configuracion_conceptos_complementario_fkey
  FOREIGN KEY (proceso_complementario_id, organization_id)
  REFERENCES pravia_os.configuracion_conceptos_actividad(id, organization_id)
  ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT chk_cfg_proceso_no_autocomplemento
  CHECK (proceso_complementario_id IS NULL OR proceso_complementario_id <> id);

CREATE INDEX idx_cfg_concepto_complementario
  ON pravia_os.configuracion_conceptos_actividad(organization_id, proceso_complementario_id);
