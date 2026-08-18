-- Reconciliación financiera canónica PRAVIA OS.
-- READ-ONLY. Comparar S0/S1/S2 con tolerancia monetaria exacta de 0.00.

\set ON_ERROR_STOP on
BEGIN TRANSACTION READ ONLY;

WITH movements AS (
  SELECT *
  FROM pravia_os.movimientos_financieros
), effective AS (
  SELECT *
  FROM movements
  WHERE estatus::text IN ('APLICADO', 'RECIBIDO', 'VALIDADO')
), allocations AS (
  SELECT
    distribution.id,
    distribution.movimiento_id,
    distribution.honorario_generado_id,
    distribution.monto,
    category.clave,
    category.naturaleza::text AS economic_nature,
    movement.naturaleza::text AS movement_nature,
    movement.estatus::text AS movement_status
  FROM pravia_os.movimiento_distribuciones AS distribution
  JOIN pravia_os.categorias_financieras AS category ON category.id = distribution.categoria_id
  JOIN pravia_os.movimientos_financieros AS movement ON movement.id = distribution.movimiento_id
)
SELECT * FROM (
  SELECT 'movimientos_count' AS metric, count(*)::numeric AS amount FROM movements
  UNION ALL SELECT 'movimientos_monto_total', COALESCE(sum(monto), 0) FROM movements
  UNION ALL SELECT 'ingresos_efectivos', COALESCE(sum(monto), 0) FROM effective WHERE naturaleza::text = 'INGRESO'
  UNION ALL SELECT 'gastos_efectivos', COALESCE(sum(monto), 0) FROM effective WHERE naturaleza::text = 'EGRESO'
  UNION ALL SELECT 'fondos_cliente_categoria_legacy', COALESCE(sum(monto), 0) FROM effective WHERE naturaleza::text = 'INGRESO' AND categoria = 'CLIENTE_FONDOS'
  UNION ALL SELECT 'honorarios_categoria_legacy', COALESCE(sum(monto), 0) FROM effective WHERE naturaleza::text = 'INGRESO' AND categoria = 'HONORARIOS_PRAVIA'
  UNION ALL SELECT 'fondos_terceros_asignados', COALESCE(sum(monto), 0) FROM allocations WHERE movement_status IN ('APLICADO', 'RECIBIDO', 'VALIDADO') AND movement_nature = 'INGRESO' AND economic_nature = 'TERCERO'
  UNION ALL SELECT 'fondos_notaria_asignados', COALESCE(sum(monto), 0) FROM allocations WHERE movement_status IN ('APLICADO', 'RECIBIDO', 'VALIDADO') AND movement_nature = 'INGRESO' AND clave = 'NOTARIA'
  UNION ALL SELECT 'fondos_terceros_pagados', COALESCE(sum(monto), 0) FROM allocations WHERE movement_status IN ('APLICADO', 'RECIBIDO', 'VALIDADO') AND movement_nature = 'EGRESO' AND economic_nature = 'TERCERO'
  UNION ALL SELECT 'honorarios_cobrados_asignados', COALESCE(sum(monto), 0) FROM allocations WHERE movement_status IN ('APLICADO', 'RECIBIDO', 'VALIDADO') AND movement_nature = 'INGRESO' AND economic_nature = 'DESPACHO'
  UNION ALL SELECT 'cuentas_count', count(*)::numeric FROM pravia_os.cuentas_financieras
  UNION ALL SELECT 'cuentas_saldo_inicial_total', COALESCE(sum(saldo_inicial), 0) FROM pravia_os.cuentas_financieras
  UNION ALL SELECT 'honorarios_generados_count', count(*)::numeric FROM pravia_os.honorarios_generados
  UNION ALL SELECT 'honorarios_generados_vigentes', COALESCE(sum(monto), 0) FROM pravia_os.honorarios_generados WHERE estado::text <> 'CANCELADO'
) AS reconciliation
ORDER BY metric;

WITH generated AS (
  SELECT COALESCE(sum(monto), 0) AS amount
  FROM pravia_os.honorarios_generados
  WHERE estado::text <> 'CANCELADO'
), collected AS (
  SELECT COALESCE(sum(distribution.monto), 0) AS amount
  FROM pravia_os.movimiento_distribuciones AS distribution
  JOIN pravia_os.movimientos_financieros AS movement ON movement.id = distribution.movimiento_id
  WHERE distribution.honorario_generado_id IS NOT NULL
    AND movement.naturaleza::text = 'INGRESO'
    AND movement.estatus::text IN ('APLICADO', 'RECIBIDO', 'VALIDADO')
)
SELECT
  generated.amount AS honorarios_generados,
  collected.amount AS honorarios_cobrados,
  generated.amount - collected.amount AS honorarios_por_cobrar
FROM generated, collected;

SELECT
  count(*) AS over_distributed_movements
FROM (
  SELECT movement.id
  FROM pravia_os.movimientos_financieros AS movement
  JOIN pravia_os.movimiento_distribuciones AS distribution ON distribution.movimiento_id = movement.id
  GROUP BY movement.id, movement.monto
  HAVING sum(distribution.monto) > movement.monto
) AS invalid;

ROLLBACK;
