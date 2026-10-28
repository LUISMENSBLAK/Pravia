# PRAVIA OS — Local release drills · 2026-10-28

## Empty database bootstrap

- Target: PostgreSQL 16 local aislado, DB `pravia_release_dryrun_20261028`, schema `pravia_os`.
- Resultado: **PASS**.
- Migraciones registradas: `122`.
- Migraciones pendientes al finalizar: `0`.
- Alcance: reconstrucción desde vacío y restauración de artefactos históricos aplicables.
- Producción: sin conexión y sin escrituras.

## Backup + restore local

- Origen: PostgreSQL QA local + Storage filesystem QA local.
- Destino DB: `pravia_release_restore_20261028`.
- Destino Storage: copia local aislada bajo `/tmp/pravia-release-restore.rSfRGI/storage-restored`.
- Dump: `2,429,543` bytes.
- SHA-256 del dump: `f78d70417d7ace7e10fe332ae71c9f9929cd22c263afcf431a5051bf6ed16687`.
- Objetos Storage comparados por SHA-256: `161/161` iguales.
- Conteos críticos iguales antes/después: organizaciones `29`, usuarios `36`, memberships `35`, prospectos `83`, cotizaciones `69`, expedientes `59`, documentos `160`, CFDI `114`, audit logs `1,903`.
- Backend levantado contra el restore: API `ok`, DB `ok`, Storage `ok`, HTTP `200` en `http://127.0.0.1:3002/api/health`.
- Resultado técnico local: **PASS**.
- Gate productivo: **PARTIAL**. Este ejercicio comparte host/disco con el entorno QA y no sustituye una copia y restauración en un dominio de falla independiente.

## Regresión del candidato local

- Backend: `207/207` archivos, `2,309/2,309` pruebas PASS.
- Frontend: `57/57` archivos, `494/494` pruebas PASS.
- PostgreSQL dirigido: colaboración/folios `8/8` PASS; prefactura física + extracción CURP `2/2` PASS.
- Prisma validate: PASS.
- Prisma generate: PASS.
- Backend build: PASS.
- Frontend build: PASS.
- Secret scan: `1,954` archivos, `0` hallazgos no reconocidos.
- `git diff --check`: PASS.

## Límites de la evidencia

- El acceso PostgreSQL productivo directo desde este host no resolvió el endpoint de Supabase.
- La sesión web Supabase disponible pertenece a otra organización y rechazó el acceso al project ref productivo `mkiwijbampubccrpvgga` (`NOTARYPROY`).
- No se ejecutaron consultas SQL ni migraciones contra producción.
- No se declara staging, backup independiente, integridad física histórica ni rollback productivo como PASS.
