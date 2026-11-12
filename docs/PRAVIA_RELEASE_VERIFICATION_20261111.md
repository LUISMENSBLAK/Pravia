# Verificación de release · 11-11-2026

**NO-GO. No se ejecutaron commit, push, deploy ni escrituras productivas.**

## Hechos actuales de sólo lectura

- Branch: `codex/release-pravia-20261028`.
- HEAD y ambas ramas remotas main/release: `c0eeed580a0b48d9213c37df5e667fc50b1636a1`.
- GitHub Actions main: [40965057217](https://github.com/LUISMENSBLAK/Pravia/actions/runs/40965057217), success. No certifica el worktree posterior sin commit.
- [Backend existente](https://pravia-api.onrender.com/health): HTTP 200, API/database/storage ok, production/cloud, Supabase Storage. El health no expone el SHA publicado; no se deduce del HEAD Git.
- [Frontend existente](https://pravianetwork.netlify.app): HTTP 200; no se declara Chrome productivo PASS ni SHA publicado sin comprobarlos.
- NOTARYPROY ref `mkiwijbampubccrpvgga`: DATABASE_URL y SUPABASE_URL locales coinciden con ese proyecto, sin imprimir secretos.
- Storage: `documents` y `pravia_documentos`, ambos privados. Límite observado de `pravia_documentos`: 52.428.800 bytes, 50 MiB. Esta lectura no demuestra una carga de 50 MiB.
- Conexión SQL directa configurada: DNS ENOTFOUND. Lectura REST del schema `pravia_os`: PGRST106. No se expuso el schema para eludir esta limitación.
- Control del navegador: `Local browser use is disabled in Work settings`. No se accedió a las consolas autenticadas Render/Netlify/Supabase. GitHub accesible; no hay secretos de Actions listados ni credenciales locales Render/Netlify configuradas.

## Recuperación y migraciones

La auditoría de 28-10 es histórica, no un preflight actual: 114 aplicadas + 9 pendientes entonces, dump restaurado localmente y 249 objetos accesibles respaldados por SHA. No prueba un respaldo vigente ni la recuperabilidad actual de los 26 objetos ausentes. No se borró ni sustituyó ninguna referencia.

El paquete local ahora tiene **126 migraciones**; no deben presentarse las nueve de octubre como el conjunto pendiente actual. La nueva `20261111010000_quote_operation_territory` es exclusivamente aditiva y se probó en PostgreSQL local. No se modificaron migraciones históricas. Antes del release faltan conexión SQL actual, inventario remoto y checksum, respaldo/restauración del conjunto actual y confirmación de configuración/rollback Render–Netlify.

## Próximo paso con la infraestructura existente

Habilitar el control del navegador y conservar las sesiones autenticadas. Desde NOTARYPROY verificar la conexión soportada actual en Connect y los mecanismos disponibles de respaldo; configurar esa conexión fuera del chat sin exponer contraseña. Repetir preflight/dump/restore/migraciones y revisar los gates funcionales abiertos de la matriz NOV. No se necesita ni se propone ningún proveedor o proyecto adicional.

El push a main queda pendiente del mismo gate: puede activar el frontend Netlify antes de que la API/DB estén listas. No debe usarse como una operación de respaldo inocua ni desencadenarse a ciegas.

## Continuación · 12-11-2026

- OpenAI es el proveedor existente, no una nueva integración. En la inspección de Render del 12-11 se vio el nombre `OPENAI_API_KEY`, pero no `AI_EXTERNAL_ENABLED` ni grupos vinculados. El backend está en modo producción y su Gateway sólo habilita llamadas con `1`, `true` o `yes` (sin distinción de mayúsculas, después de eliminar espacios); si falta la bandera devuelve `AI_EXTERNAL_DISABLED`. El rastreo de llamadas HTTP del candidato sólo encontró el adaptador OpenAI del Gateway (Responses y transcripción), sin salida directa detectada desde React. No se verificó autenticación real del proveedor ni se cambió configuración o saldo de producción.
- Regresión del worktree: backend **2.377/2.377**, frontend **507/507**, builds y Prisma validate correctos, revisión de secretos sin hallazgos. Último CI remoto en verde sólo para `c0eeed5`, no para los cambios sin commit. El paquete y el PostgreSQL de QA coinciden en **126** migraciones terminadas, cero fallos abiertos; esto no establece la lista pendiente en NOTARYPROY.
- Chrome local sin OpenAI: logo privado, selección del machote Word CFG-002, catálogo SAT, borrador y prefactura PDF con MXN/USD/CAD; vista previa, descarga, regeneración, SHA y versiones anteriores. Aislamiento de Biblioteca y aceptación de Cotización pasaron en QA. La prueba completa de ADM-001 no pasó: la réplica QA contiene el registro del PDF anterior, pero no sus bytes en el Storage local activo. No se sustituyó ni se borró la referencia. Los cuatro escenarios ligados a un ingreso explícito no se repitieron en esta tanda sin su fixture.
- NOTARYPROY: la resolución DNS directa devuelve AAAA pero no A, y el cliente PostgreSQL no tiene ruta IPv6. Se necesita el hostname exacto del **Session pooler** del mismo proyecto, no inferible sólo de la región. Esto bloquea comprobar el ledger de migraciones actual y generar/verificar un respaldo productivo actualizado. El ensayo histórico y los 26 objetos no localizados no cambian de estado. No se aplicaron migraciones productivas ni se ejecutó push/deploy.
- Se revalidaron por API los dos buckets de NOTARYPROY: privados; `pravia_documentos` conserva **50 MiB**. El health productivo de Render reporta API/DB/Storage `ok`; Netlify respondió HTTP 200. Esto no prueba escritura, login productivo ni la publicación del candidato local.
- El ensayo físico en una DB recién inicializada detectó que el bootstrap omitía el bloque dinámico de RLS de la migración histórica del Control Plane. Se corrigió el planificador para restaurar el bloque original y verificar sus políticas, sin modificar la migración histórica. Prueba unitaria de bootstrap **10/10** y suite física del Control Plane **30/30** con adaptador sintético tras aplicar el bloque mediante el plan corregido, incluidos aislamiento, saldo, reservas, liquidación, idempotencia, tarifas y ledger. No equivale a validar el wallet ni el proveedor real de producción.

## Session pooler, recuperación local y ADM-001 · 12-11-2026

- Acceso administrativo de sólo lectura por Session pooler oficial, puerto 5432, CA oficial y `sslmode=verify-full`: PASS. PostgreSQL 17.6, esquema `pravia_os`, 291 tablas, 40 políticas de aislamiento, 125 registros aplicados (124 del paquete y una línea base histórica), cero fallos abiertos y cero checksums divergentes. Pendientes: `20261103010000_fiscal_entity_private_logo` y `20261111010000_quote_operation_territory`. No se aplicaron a producción.
- `pg_dump` de `pravia_os` por Session pooler: PASS en el segundo intento (2.993.200 bytes). `pg_restore` en PostgreSQL 17 sin red: PASS, con `pg_trgm` colocado en el mismo esquema que producción. Conteos de migraciones, tablas y políticas coincidentes; los dos SQL pendientes se aplicaron al restore y la FK de logo quedó validada. Es un ensayo SQL local, no una ejecución productiva de Prisma.
- Storage de ambos buckets: 278/278 objetos accesibles copiados en destino local privado, tamaño comprobado y SHA verificado. El respaldo no incluye objetos que ya faltaban; las 26 referencias siguen presentes en PostgreSQL y no se recuperó ningún original histórico. Los cambios pendientes son aditivos y no reescriben esas referencias. Respaldo/restore fuera de este equipo: **NOT VERIFIED**.
- Restore local de Storage: 278/278 objetos rehidratados y comparados por SHA. Reconciliación de la tabla `documentos` contra el manifest: 121 referencias, 95 claves encontradas, 26 ausencias históricas conocidas, 0 nuevas ausencias por clave exacta y 0 divergencias contra los SHA disponibles.
- ADM-001: se detectó que el reintento podía devolver una fila existente sin comprobar el PDF físico. Ahora se verifica el archivo, se conserva el Word y se genera un derivado versionado sólo cuando su fuente y huella siguen disponibles. Chrome local original/alternativo, visor, descarga, SHA, reload, aislamiento y reintento idempotente: PASS. No se sustituyeron objetos históricos de producción.
- Regresión local posterior a la reparación: backend 2.377/2.377, frontend 507/507, integración física de prefactura/territorio 4/4, Prisma validate/generate, builds y revisión de secretos PASS. La copia del machote incorporada al repositorio público se limpió de metadatos personales; su render es idéntico al original. El original del cliente queda fuera del repositorio.
