# Dry-run financiero de staging — Fase 15A

## Resultado

**BLOCKED / NO EJECUTADO.** Staging falló antes de crear tablas de aplicación, por lo que no existen `Pago`, `MovimientoFinanciero` ni las tablas del ledger canónico donde ejecutar un dry-run representativo.

No se ejecutó backfill, ni una vez ni dos veces. No hubo escritura financiera en producción ni en staging. Marcar este punto como aprobado habría ocultado el bloqueo crítico de baseline.

| Métrica staging | Resultado |
|---|---|
| Registros `Pago` inspeccionables | 0 / tabla inexistente |
| Importe | No calculable |
| `MIGRACION_SEGURA` | No calculable |
| `YA_REPRESENTADO` | No calculable |
| `DUPLICADO_PROBABLE` | No calculable |
| `AMBIGUO` | No calculable |
| `REQUIERE_REVISION` | No calculable |
| Duplicados `legacy:pago:<id>` | No calculable |
| Idempotencia segunda ejecución | No probada |

## Evidencia de referencia, no de staging

La base local de Fase 14 había producido un dry-run controlado de 6 pagos por MXN 6,000, todos clasificados como seguros y sin duplicados. Ese resultado no se promueve a evidencia de staging: la base fue materializada mediante diff/execute/resolve y no por la historia cruda que falló ahora.

## Procedimiento pendiente

Tras reconciliar el baseline y reconstruir staging desde cero:

1. Ejecutar el auditor read-only y congelar conteos, importes, fechas, expediente, actor, comprobante, distribuciones y honorarios.
2. Verificar claves `legacy:pago:<id>` contra movimientos existentes.
3. Emitir las cinco clasificaciones sin mutar datos.
4. En copia aislada, ejecutar el backfill autorizado una vez, capturar snapshot y ledger.
5. Ejecutarlo una segunda vez y exigir cero inserts/updates adicionales y el mismo resultado final.
6. Reconciliar totales de `Pago` y `MovimientoFinanciero` sin sumarlos como si fueran fuentes independientes.

`LOCAL_LEGACY` continúa activo e intacto.
