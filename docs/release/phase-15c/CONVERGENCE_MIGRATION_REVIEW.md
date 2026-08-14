# Revisión de la migración de convergencia

Migración: `20260814010000_align_future_schema_and_indexes`; SHA-256 `30ab822be29d2d0bdb1c5f10dc14dcb060034a2df746aaa25e82d405b7728568`.

Contenido aprobado: 16 `CREATE INDEX IF NOT EXISTS` para las FK detectadas en S1, un guard contra huérfanos, un índice para `documentos.compareciente_id`, una FK `ON DELETE SET NULL ON UPDATE NO ACTION NOT VALID` y su `VALIDATE CONSTRAINT`.

| Statement | Lock risk | Data risk | Reversibility | Duración esperada |
|---|---|---|---|---|
| CREATE INDEX (17) | ShareLock; bloquea escrituras durante el build normal | Ninguno | DROP INDEX posterior, con revisión | Corta con tamaños actuales; medir de nuevo antes de producción |
| guard de huérfanos | AccessShareLock | Ninguno; aborta si hay anomalías | No aplica | Scan acotado y asistido por PK/FK |
| ADD FK NOT VALID | ShareRowExclusive breve | Ninguno; no valida histórico aún | DROP CONSTRAINT | Breve |
| VALIDATE CONSTRAINT | ShareUpdateExclusive; permite DML normal | Ninguno; aborta ante huérfanos | No aplica | Scan de documentos/comparecientes |

No hay `DROP`, rename, cambio de tipo/default/nullability ni backfill. El inventario read-only productivo del 14-08-2026 encontró: `documentos` ~65 filas/180,224 bytes total, `movimientos_financieros` ~3 filas/131,072 bytes y `tareas_externas` vacía/~24,576 bytes. Las demás tablas son futuras y todavía no existen en S0. No se ejecutó `EXPLAIN ANALYZE` ni SQL mutador en producción.

Para una ejecución futura autorizada se recomienda ventana controlada, timeout de lock explícito y monitor de bloqueos. Esta revisión no autoriza producción.
