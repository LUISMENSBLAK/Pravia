-- Official reference snapshots. They are reviewable and versioned; they do not constitute a legal or tax opinion.

INSERT INTO pravia_os.compliance_rule_sets (
  id, tipo, clave, version, nombre, estatus, vigencia_desde,
  fuente_nombre, fuente_url, fuente_publicada_at, parametros, cuestionario,
  notas, creado_por_id
)
SELECT
  gen_random_uuid(),
  'UIF',
  'ACTOS_NOTARIALES_LFPIORPI',
  'LFPIORPI-2025-07-16+UMA-2026-02-01',
  'Actividades vulnerables en actos notariales',
  'REFERENCIA_VERIFICADA',
  TIMESTAMP '2026-02-01 00:00:00',
  'LFPIORPI, última reforma DOF 16-07-2025; UMA 2026 publicada por INEGI',
  'https://www.diputados.gob.mx/LeyesBiblio/pdf/LFPIORPI.pdf',
  TIMESTAMP '2025-07-16 00:00:00',
  '{
    "uma": {"valor_diario_mxn": 117.31, "vigencia_desde": "2026-02-01", "fuente": "https://www.inegi.org.mx/contenidos/saladeprensa/boletines/2026/uma/uma2026.pdf"},
    "reglas": {
      "TRANSMISION_DERECHOS_REALES_INMUEBLES": {"aviso_siempre": false, "umbral_uma": 8000, "base": "MAYOR_PRECIO_CATASTRAL_COMERCIAL_GARANTIZADO", "fundamento": "Artículo 17, fracción XII, apartado A, inciso a"},
      "PODER_IRREVOCABLE_ADMINISTRACION_DOMINIO": {"aviso_siempre": true, "fundamento": "Artículo 17, fracción XII, apartado A, inciso b"},
      "CONSTITUCION_MODIFICACION_PERSONA_MORAL": {"aviso_siempre": true, "fundamento": "Artículo 17, fracción XII, apartado A, inciso c"},
      "FIDEICOMISO_TRASLATIVO_GARANTIA": {"aviso_siempre": false, "umbral_uma": 4000, "base": "MONTO_OPERACION", "fundamento": "Artículo 17, fracción XII, apartado A, inciso d"},
      "MUTUO_CREDITO_NO_FINANCIERO": {"aviso_siempre": true, "fundamento": "Artículo 17, fracción XII, apartado A, inciso e"}
    },
    "acumulacion_meses": 6
  }'::jsonb,
  '[
    {"clave":"tipo_acto_uif","etiqueta":"Supuesto legal del acto","tipo":"SELECT","requerido":true},
    {"clave":"precio_pactado","etiqueta":"Precio pactado","tipo":"MONEDA","requerido":false},
    {"clave":"valor_catastral","etiqueta":"Valor catastral","tipo":"MONEDA","requerido":false},
    {"clave":"valor_comercial","etiqueta":"Valor comercial","tipo":"MONEDA","requerido":false},
    {"clave":"monto_garantizado","etiqueta":"Monto garantizado o suerte principal","tipo":"MONEDA","requerido":false},
    {"clave":"identidad_verificada","etiqueta":"Identidad verificada con documento oficial","tipo":"BOOLEAN","requerido":true},
    {"clave":"beneficiario_controlador_identificado","etiqueta":"Beneficiario controlador identificado o declaración recabada","tipo":"BOOLEAN","requerido":true},
    {"clave":"actividad_ocupacion_acreditada","etiqueta":"Actividad u ocupación acreditada","tipo":"BOOLEAN","requerido":true},
    {"clave":"origen_recursos_documentado","etiqueta":"Origen de recursos documentado","tipo":"BOOLEAN","requerido":true},
    {"clave":"operaciones_relacionadas_seis_meses","etiqueta":"Monto acumulado relacionado en seis meses","tipo":"MONEDA","requerido":false},
    {"clave":"pep_declarada","etiqueta":"Condición PEP declarada","tipo":"SELECT","requerido":true},
    {"clave":"observaciones","etiqueta":"Observaciones del revisor","tipo":"TEXTAREA","requerido":false}
  ]'::jsonb,
  'Referencia operativa; exige revisión humana y actualización cuando cambie la ley, normativa secundaria o UMA.',
  u.id
FROM pravia_os.users u
WHERE u.activo = true
ORDER BY u.created_at ASC
LIMIT 1
ON CONFLICT (tipo, clave, version) DO NOTHING;

INSERT INTO pravia_os.compliance_rule_sets (
  id, tipo, clave, version, nombre, estatus, vigencia_desde,
  fuente_nombre, fuente_url, fuente_publicada_at, parametros, cuestionario,
  notas, creado_por_id
)
SELECT
  gen_random_uuid(),
  'ISR',
  'ENAJENACION_INMUEBLES_PREPARACION',
  'LISR-2024-04-01+RMF-2026',
  'Preparación de cálculo ISR por enajenación de inmuebles',
  'PREPARADO_SIN_CALCULO',
  TIMESTAMP '2026-01-01 00:00:00',
  'Ley del ISR y Resolución Miscelánea Fiscal 2026',
  'https://www.diputados.gob.mx/LeyesBiblio/pdf/LISR.pdf',
  TIMESTAMP '2025-12-28 00:00:00',
  '{
    "motor_estado":"NO_CALCULA_HASTA_APROBACION_FISCAL",
    "fundamentos":["LISR artículos 119 a 127","RMF 2026, capítulo 3.15"],
    "salida_permitida":"DIAGNOSTICO_DE_COMPLETITUD",
    "campos_minimos":["enajenante_rfc_curp","precio_terreno","precio_construccion","ingreso_gravado","ingreso_exento","fecha_enajenacion","costo_historico","costo_actualizado","fecha_adquisicion","deducciones","procedimiento_calculo"]
  }'::jsonb,
  '[
    {"clave":"enajenante_rfc_curp","etiqueta":"RFC o CURP del enajenante","tipo":"TEXT","requerido":true},
    {"clave":"precio_terreno","etiqueta":"Precio del terreno","tipo":"MONEDA","requerido":true},
    {"clave":"precio_construccion","etiqueta":"Precio de la construcción","tipo":"MONEDA","requerido":true},
    {"clave":"ingreso_gravado","etiqueta":"Ingreso gravado","tipo":"MONEDA","requerido":true},
    {"clave":"ingreso_exento","etiqueta":"Ingreso exento","tipo":"MONEDA","requerido":true},
    {"clave":"fecha_enajenacion","etiqueta":"Fecha de enajenación","tipo":"DATE","requerido":true},
    {"clave":"costo_historico","etiqueta":"Costo histórico","tipo":"MONEDA","requerido":true},
    {"clave":"costo_actualizado","etiqueta":"Costo actualizado","tipo":"MONEDA","requerido":true},
    {"clave":"fecha_adquisicion","etiqueta":"Fecha de adquisición","tipo":"DATE","requerido":true},
    {"clave":"deducciones","etiqueta":"Deducciones autorizadas documentadas","tipo":"MONEDA","requerido":true},
    {"clave":"procedimiento_calculo","etiqueta":"Procedimiento fiscal aprobado a utilizar","tipo":"TEXTAREA","requerido":true}
  ]'::jsonb,
  'No calcula impuesto ni sustituye dictamen fiscal. Solo verifica insumos hasta que una versión de parámetros sea aprobada por especialista.',
  u.id
FROM pravia_os.users u
WHERE u.activo = true
ORDER BY u.created_at ASC
LIMIT 1
ON CONFLICT (tipo, clave, version) DO NOTHING;
