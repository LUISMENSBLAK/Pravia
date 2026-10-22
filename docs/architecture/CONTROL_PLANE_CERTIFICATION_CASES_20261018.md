# Control Plane — certificación individual local

Inicio: 2026-10-18; actualización: 2026-10-19. Entorno: PostgreSQL y Storage temporales locales; Chrome contra frontend/backend locales. Base Git: `b24534ec1ec1505944c7b720e0cf03647e28c005`. Ninguna prueba aquí certifica proveedores externos ni producción.

`PASS` significa que el caso concreto tuvo una aserción observable con fixture sintético. `NOT VERIFIED` significa que falta ejecutar una parte indispensable del caso; no equivale a un fallo oculto. Las rutas de evidencia se indican relativas a la raíz del repositorio. Los tests físicos de PostgreSQL están en `backend/src/integration/controlPlaneAccounting.postgresql.integration.test.ts`; los unitarios de parser en `backend/src/platform/migrationStreaming.test.ts`; los E2E en `frontend/e2e/control-plane-*.spec.ts`.

## Migración MGS01–MGS30

| Caso | Resultado | Fixture/procedimiento y observación | Pendiente, si aplica |
|---|---|---|---|
| MGS01 | PASS | CSV sintético de 205 filas: carga y sesión persistida en PostgreSQL; test MG01/MG11/MG14/MG25. | — |
| MGS02 | PASS | Fuente CSV mayor de 50 MiB en cuatro partes; conteo y bytes de partes persistidos; test MGS01-MGS09. | — |
| MGS03 | PASS | `pauseUpload` a mitad y rechazo de parte mientras está pausada; test MG01/MG11/MG14/MG25. | — |
| MGS04 | PASS | `resumeUpload` y continuación desde sesión persistida; mismo test. | — |
| MGS05 | PASS | Reenvío de la misma parte conserva el mismo ID y no duplica bytes; mismo test. | — |
| MGS06 | PASS | `completeUpload` repetido conserva estado `COMPLETED`; test MGS01-MGS09. | — |
| MGS07 | PASS | Parte con SHA incorrecto rechazada antes de análisis; test `migrationStreaming`. | — |
| MGS08 | PASS | SHA de fuente completa incorrecto rechaza promoción; test `migrationStreaming`. | — |
| MGS09 | NOT VERIFIED | Nueva instancia del servicio lee las partes y analiza la fuente de >50 MiB en test MGS01-MGS09. | Falta detener/reiniciar un proceso worker real durante ejecución y demostrar continuación sin duplicado. |
| MGS10 | PASS | API local: fuente CSV sintética de 497,790 bytes, primera parte de 262,144 bytes persistida; backend detenido y reiniciado; misma sesión conservó 1 parte y SHA, aceptó la segunda, completó 497,790 bytes con SHA total idéntico. | — |
| MGS11 | PASS | ZIP PRAVIA v1 inventariado con manifiesto en PostgreSQL. RAR real existente, 19.8 MB, leído de forma local y sólo lectura: 14 entradas, 14 escaneadas, 21,237,079 bytes expandidos; no se registraron rutas ni contenidos. | La importación automática de RAR sigue intencionalmente no habilitada. |
| MGS12 | PASS | CSV de 205 filas parseado, mapeado y previsualizado; test MG01/MG11/MG14/MG25. | — |
| MGS13 | PASS | XLSX sintético: hoja, encabezados y una fila inventariados; aprobación automática correctamente bloqueada; test MGS13. | — |
| MGS14 | PASS | Mapeo humano `COMPARECIENTE` y 205 registros canónicos importados; test MG01/MG11/MG14/MG25. | — |
| MGS15 | PASS | `campo_desconocido` permanece `NEEDS_REVIEW`, luego `targetField: null`; mismo test. | — |
| MGS16 | PASS | Preview expone registros, capacidad y mapeos; paquete ZIP prueba documentos/relaciones esperados; tests MG01 y MGS19/MGS20/MGS26. | — |
| MGS17 | PASS | La aprobación falla antes del mapeo/capacidad y requiere aprobación explícita; test MG01 y Chrome migración. | — |
| MGS18 | PASS | Worker Chrome importa CSV real a PostgreSQL y muestra verificación persistida; E2E migración y test de 205 filas. | — |
| MGS19 | PASS | Paquete ZIP conserva/promueve bytes originales de documento sintético en Storage local; test MGS19/MGS20/MGS26. | — |
| MGS20 | PASS | Relaciones documento–compareciente y procedencia verificadas en PostgreSQL; mismo test. | — |
| MGS21 | PASS | Reintento no duplica source records; 205 procedencias únicas y un target por origen; tests MG01 y MGS19/MGS20/MGS26. | — |
| MGS22 | PASS | Queue y execute repetidos no duplican job ni importación; test MG01/MG11/MG14/MG25. | — |
| MGS23 | PASS | Paquete que omite un archivo del manifiesto falla con `MIGRATION_PACKAGE_UNDECLARED_FILE`; test MGS23. | — |
| MGS24 | NOT VERIFIED | Manifiesto de CSV comprueba SHA, tamaño, 205 procedencias, relaciones, huérfanos y discrepancia 0. | Falta prueba independiente del acceso privado al manifiesto final como artefacto. |
| MGS25 | PASS LOCAL | E2E Chrome: ejecución rechazada sin backup; script QA copia fuente a Storage local, restaura y compara SHA/bytes; ejecución final pasa. PG rechaza scope ajeno, restore posterior fallido y SHA de otra fuente. | No certifica proveedor independiente; ese gate productivo sigue bloqueado. |
| MGS26 | PASS | Fallo sintético de limpieza deja `cleanupPending`; reintento termina con bytes temporales 0 sin perder fuente; test MG01/MG11/MG14/MG25. | — |
| MGS27 | PASS | Manifiesto de 205 filas reporta huérfanos 0 y discrepancia 0; paquete verifica Storage/ledger/bytes; tests MG01 y MGS19/MGS20/MGS26. | — |
| MGS28 | PASS | `preview` de tenant B a job A denegado y RLS bloquea escrituras cruzadas; test MG01 y TENANT/RLS. | — |
| MGS29 | PASS | Path traversal, firma EICAR, ejecutable disfrazado y ZIP altamente expansivo son rechazados con códigos precisos; tests `migrationStreaming` (7/7). | — |
| MGS30 | PASS | Capacidad insuficiente bloquea aprobación; el test PG comprueba que la parte, sus bytes físicos y SHA permanecen iguales y que no se crea un add-on de almacenamiento. | — |

**Resultado individual local: 28 PASS, 2 NOT VERIFIED, 0 FAIL conocidos. MGS 30/30: NO.** El alcance de importación automática sigue limitado a CSV de Comparecientes y paquete ZIP PRAVIA v1; XLSX/RAR no se promueven falsamente.

## Exportación EXP01–EXP20

| Caso | Resultado | Fixture/procedimiento y observación | Pendiente, si aplica |
|---|---|---|---|
| EXP01 | PASS | Tenant admin solicita export en Chrome y recibe job; E2E export. | — |
| EXP02 | PASS | Usuario sintético `FINANCIERO` del mismo tenant inició sesión real; GET y POST `/api/platform/exports` devolvieron 403; E2E Chrome export con ruta backend. | — |
| EXP03 | PASS | Tenant B no lista ni descarga job/artifact de A; test EX01/EX03/EX04/EX06/EX12. | — |
| EXP04 | PASS | CSV de 205 Comparecientes y datasets de dominio contrastados con DB; mismo test. | — |
| EXP05 | PASS | Documento, plantilla y adjunto sintéticos incluidos como binarios; mismo test. | — |
| EXP06 | PASS | Bytes extraídos del ZIP iguales a los originales sintéticos; mismo test. | — |
| EXP07 | PASS | `manifest.json` y cada ruta declarada existen; mismo test. | — |
| EXP08 | PASS | SHA-256 y tamaño de cada entrada recalculados y comparados; mismo test. | — |
| EXP09 | PASS | CSV de relación documento–compareciente y sus IDs exportados; mismo test. | — |
| EXP10 | PASS | Job `PENDING` y worker asíncrono hasta `COMPLETED`; E2E export y test EX01. | — |
| EXP11 | PASS | El test físico EX13/EX14 intercepta el upload final y lee desde PostgreSQL el job todavía `RUNNING` con progreso 90; inicio 0 y final 100 también comprobados. | — |
| EXP12 | NOT VERIFIED | Nueva instancia del servicio completa un job en PostgreSQL. | Falta matar/reiniciar proceso worker real a mitad y verificar continuación. |
| EXP13 | PASS | Fallo sintético al subir ZIP, limpieza de parcial y reintento completado; test EX13/EX14. | — |
| EXP14 | PASS | Reintento conserva sólo dos artefactos finales, sin ubicación parcial disponible; mismo test. | — |
| EXP15 | PASS | Descarga firmada privada y descarga real en Chrome tras auth; EX01 y E2E export. | — |
| EXP16 | PASS | `expires_at` pasado bloquea descarga y cleanup expira artefactos; test EX01. | — |
| EXP17 | PASS | Revocación bloquea nuevas descargas/egress y elimina artefactos; test EX01. | — |
| EXP18 | PASS | Recibo de proveedor registra egress una vez, incluso con llamadas concurrentes, en tenant correcto; test EX01. | — |
| EXP19 | PASS | Documento y ZIP no compresibles >50 MiB exportados desde Storage respaldado en archivos; test EXP19. | — |
| EXP20 | PASS | Manifiesto de fixture concilia 205 filas, documentos y una relación con DB/ZIP; test EX01. | — |

**Resultado individual local: 19 PASS, 1 NOT VERIFIED, 0 FAIL conocidos. EXP 20/20: NO.**

## Gate físico y externo

- Backfill relacional: 83/83 documentos representados sin inventar SHA histórico.
- Originales físicos: **57/83 legibles; 26/83 no encontrados** por clave exacta en el bucket configurado ni en el segundo bucket existente. Véase `LEGACY_STORAGE_PHYSICAL_VERIFICATION.md`. Se desconoce si son recuperables de backups/versiones; no se declara pérdida definitiva ni se declara integridad completa.
- Backup de fuente de migración: PASS **local** con copia/restauración/SHA. Proveedor independiente, restore de DB y recuperación fuera del mismo failure domain: **NOT VERIFIED**.
- Gate de uso cliente y release productivo: **BLOCKED**. Ningún `PASS` local anterior levanta ese bloqueo.
