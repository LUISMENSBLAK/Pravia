# Reporte de drift estructural — Fase 15A

## Resultado

Clasificación: **SEMANTIC_DRIFT + ADDITIVE_DRIFT**. No se observó evidencia suficiente para clasificar cambios como `DESTRUCTIVE_DRIFT`; staging queda `UNKNOWN` como representación del estado futuro porque la primera migración falló.

El historial y el schema son problemas separados: 15 checksums local/producción coinciden, pero el schema futuro local no es igual a producción y la historia local no contiene los dos baselines que permiten construir una base vacía.

## Producción → referencia local futura

| Objeto | Producción | Local | Solo producción | Solo local | Mismo nombre, definición distinta |
|---|---:|---:|---:|---:|---:|
| Tablas `pravia_os` | 67 | 80 | 0 | 13 | 0 |
| Columnas | 902 | 1084 comparables | 0 | 182 | 170 |
| Constraints | 236 | 275 | 30 | 69 | 55 |
| Índices | 258 | 312 | 152 | 206 | 0 |
| Labels enum | 249 | 277 | 2 | 30 | 0 |
| Sequences | 0 | 0 | 0 | 0 | 0 |
| Triggers | 4 | 0 | 4 | 0 | 0 |
| Funciones | 1 | 0 | 1 | 0 | 0 |

Los conteos de nombres de índices/constraints incluyen diferencias nominales generadas por los distintos procesos históricos y no deben interpretarse todos como diferencias semánticas. El artefacto conserva los nombres exactos para revisión.

### ADDITIVE_DRIFT

Las siete migraciones `LOCAL_ONLY` agregan 13 tablas futuras: `categorias_financieras`, `compliance_decisions`, `comprobantes_financieros`, `conciliaciones_financieras`, `cuentas_financieras`, `expediente_entregas`, `honorarios_generados`, `metas_honorarios`, `movimiento_distribuciones`, `notifications`, `transacciones_estado_cuenta`, `user_invitations` y `user_preferences`.

También agregan 182 columnas, entre ellas persistencia de sesión, snapshots de compliance, ledger financiero canónico, templates, tareas externas y teléfono de usuario. Producción no contiene esas estructuras; no son migraciones “ya aplicadas” ocultas.

### SEMANTIC_DRIFT

- Muchos IDs UUID de producción tienen default DB `gen_random_uuid()`; la referencia Prisma local deja el default nulo y genera IDs desde aplicación. Ejemplos: `actividades_economicas.id`, `comparecientes.id` y `personas_fisicas.id`.
- Existen diferencias de nullability y `timestamp with time zone` frente a `timestamp without time zone` en objetos compartidos. Deben ser evaluadas antes de declarar equivalencia.
- Producción conserva cuatro eventos de trigger (`trg_check_persona_fisica_perfil` y `trg_check_persona_moral_perfil`, en INSERT/UPDATE) y `fn_check_compareciente_perfil()`. La referencia local creada desde el schema Prisma no los contiene.
- Producción conserva `ComparecePor.PROPIO_DERECHO` y `ComparecePor.REPRESENTACION`; no aparecen en la referencia local. Local añade 30 labels de finanzas/reporting, incluidos los nuevos estados del ledger.
- Diferencias puramente textuales por schema qualification y `CURRENT_TIMESTAMP`/`now()` se normalizaron antes de comparar.

## Staging

Staging tiene 0 tablas de aplicación, 0 enums y solo `_prisma_migrations` con su PK/índice. Frente a local faltan 80 tablas y frente a producción faltan 67. Esto no es un estado futuro válido: es la consecuencia controlada de `P3018 / SQLSTATE 42704: type "DocCategoria" does not exist`. La transacción de la migración no dejó objetos parciales de aplicación, pero el registro Prisma sí queda `PARTIALLY_APPLIED`.

## Conclusión

`prisma validate` no basta. Antes de producción debe recuperarse el SQL original de los baselines o aprobarse un nuevo baseline canónico para instalaciones nuevas, recrear staging vacío exclusivamente con la historia reconciliada y volver a producir una comparación estructural sin drift inesperado. Evidencia máquina: `artifacts/comparison.json`, `local-readonly.json`, `staging-readonly.json` y `production-readonly.json`.
