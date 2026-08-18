# Evidencia sanitizada — rehearsal final de cutover PRAVIA OS

Fecha de ejecución: 2026-08-17 local / 2026-08-18 UTC
Commit ensayado: `e78be2e2ef3b11d1c8176e71bc77572867f1717d` — evidencia histórica; no es el target final
Resultado: **FAIL — CUTOVER NO AUTORIZADO**

Este registro contiene solo agregados y referencias no secretas. Los dumps, blobs, manifests detallados, credenciales efímeras y salidas completas permanecen fuera del repositorio con permisos restringidos.

## Backup y restore

- PostgreSQL: 17.11.
- Formato: custom dump, sin ownership ni privileges.
- Timestamp: `2026-08-18T00:43:25Z`.
- Tamaño: 469011 bytes.
- SHA-256: `e0d8077fa5099a5e704e74aafa159b47a671098e4b419affc6efe37965188401`.
- Restore: PostgreSQL 17 aislado, 81 tablas, PASS.
- Critical counts/fingerprints producción vs restore: PASS.
- Reconciliación financiera producción vs restore: PASS, tolerancia 0.00.

## Storage read-only

- Buckets privados: 2.
- Objetos inventariados y respaldados: 161/161.
- Bytes: 62081760.
- Fallos de descarga: 0.
- `documents`: 37 objetos, 7248686 bytes.
- `pravia_documentos`: 124 objetos, 54833074 bytes.
- Referencias oficiales `documentos.storage_key`: 70.
- Referencias oficiales con blob: 44.
- Referencias oficiales sin blob: 26.
- Referencias adicionales no HTTP sin blob: 2.
- Objetos aparentemente huérfanos respecto de las referencias comparadas: 44.

La ausencia de blobs es preexistente. No se intentó reparar, eliminar, mover ni reclasificar datos.

## Migraciones y backfill sobre la copia

- Estado productivo read-only: 9 aplicadas, 9 pendientes; checksums PASS.
- Paquete canónico: 18 migraciones, checksums PASS.
- Migraciones aplicadas al restore: 9/9 PASS.
- Estado posterior del restore: clean, 18/18.
- Bootstrap de ensayo: 1 Organization y 1 Membership.
- Rol conservado: `DIRECCION`.
- Scope conservado: `GLOBAL`.
- Estado conservado: activo.
- Organization definitiva de producción: pendiente de aprobación del propietario.
- Backfill dry-run: PASS.
- Backfill commit sobre copia: PASS.
- Orphan tenant rows: 0.
- Users without Membership: 0.
- Cross-tenant invalid relations: 0.
- Missing FK indexes: 0.
- Duplicate index groups: 0.
- Financial reconciliation: PASS.

## Aplicación local

- Backend build/Prisma validate/generate: PASS.
- Backend rehearsal: 21 checks PASS.
- Frontend build: PASS.
- Frontend HTTP/proxy/API rehearsal: 30 checks PASS.
- Backend tests: 408/408 PASS.
- Frontend tests: 190/190 PASS.
- PRAVIA IA persistence/history: PASS.
- Llamada real al proveedor PRAVIA IA: no ejecutada; requeriría autorización explícita para enviar contexto restaurado al proveedor externo.
- Smoke visual autenticado: no ejecutado; requeriría autorización explícita para introducir la credencial efímera local en el navegador.

## Tiempos medidos

- Backup DB: 27 s.
- Restore DB: 2 s.
- Migraciones: 1 s.
- Backfill: <1 s.
- Validación post-migration: <1 s.
- Inicio backend: 8 s.
- Build frontend: 8 s.
- Smoke backend: 2 s.
- Smoke frontend HTTP: 2 s.
- Respaldo completo Storage: 174 s.
- Historial Render actual/N-1: 62 s / 61 s.
- Historial Netlify actual/N-1: 9 s / 22 s.
- Ventana estimada basada en estas mediciones, incluyendo buffer operativo: 7–10 minutos.

## Infraestructura read-only

- Render current deploy: `dep-da0l7qtbedkc73b18vu0` / `b4200cd7f57c6bd93345efb0bae47e478774152b`.
- Render N-1: `dep-da0dq71t0dsc739g9lng` / `1c40b46792b0653918ce550f4ca52589d229a2d5`.
- Render health y `/api/health`: HTTP 200, DB/Storage ok.
- Netlify current deploy: `6a81494f064a90348a0fc3c8`; título referencia `5edb9ce8b67c6bf8e81dcf93d35b15949e0b2843`.
- Netlify N-1: `6a80ca09e3a232aad4236012` / `f835c4388bd28640fd905c05f60834856097308e`.
- Netlify env inventory: FAIL por timeout de `Runtime.evaluate`; la API pública no expone campos protegidos.

## Bloqueos para GO

1. Resolver o aceptar explícitamente la discrepancia de 26 blobs oficiales y 2 referencias adicionales ausentes.
2. Autorizar y ejecutar smoke real de PRAVIA IA contra proveedor, con control de divulgación de datos.
3. Completar smoke visual autenticado del frontend.
4. Recapturar inventario protegido de Netlify.
5. Aprobar Organization, operadores y ventana.
6. Autorizar el push futuro del commit objetivo; no se hizo push ni deploy.

## Garantías

- Escrituras productivas: ninguna.
- Migraciones productivas: ninguna.
- Cambios de proveedor/configuración: ninguno.
- Push: no.
- Deploy: no.
