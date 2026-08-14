# Plan exacto de ejecución productiva — NO AUTORIZADO

Este archivo es un runbook para una fase futura. **No autoriza ningún comando.** Estado actual: bloqueado hasta recuperar/aprobar baseline, reconstruir staging desde cero, completar E2E y obtener autorización explícita.

## Decisión de reconciliación previa obligatoria

1. Intentar recuperar los SQL originales cuyos SHA-256 son `8e0364...` y `84422f...` desde backups, artefactos CI, equipos o archivos del proveedor.
2. Si se recuperan, restaurarlos byte por byte en sus IDs y validar sus checksums y un rebuild vacío.
3. Si no se recuperan, **no** fabricar SQL bajo esos IDs. Crear mediante revisión formal un baseline canónico nuevo para instalaciones vacías, derivado de evidencia estructural y funcional, con ID/checksum nuevos.
4. Para una producción que ya tiene la estructura, cualquier futuro `migrate resolve` solo podrá registrar el baseline canónico después de una comparación exacta y aprobación separada. No sustituye aplicar SQL faltante.
5. Repetir staging vacío y restore; exigir 22/22 o la cantidad reconciliada, cero migraciones fallidas y drift explicado.

## Runbook de 17 pasos

Todos los comandos están deliberadamente prefijados con `NOT AUTHORIZED — DO NOT EXECUTE`.

| # | Paso | Command | Expected result | Failure condition | Rollback | Evidence |
|---:|---|---|---|---|---|---|
| 1 | Pre-flight | `NOT AUTHORIZED — DO NOT EXECUTE: git status --short && git rev-parse HEAD && npm run check:env` | Commit aprobado, worktree/release conocidos, guard identifica producción sin secretos. | Commit distinto, worktree sucio, env ambiguo o guard no concluyente. | Cancelar ventana; no tocar servicios. | Log firmado de SHA/env. |
| 2 | Ventana | `NOT AUTHORIZED — DO NOT EXECUTE: registrar inicio de ventana y responsables en bitácora` | Ventana, on-call y canal de incidente confirmados. | Falta responsable, comunicación o tiempo suficiente. | Cancelar ventana. | Ticket/bitácora. |
| 3 | Freeze | `NOT AUTHORIZED — DO NOT EXECUTE: activar flag operativo de freeze de escrituras` | Nuevas escrituras mutadoras detenidas; lecturas saludables. | Siguen llegando writes/jobs. | Revertir flag y reprogramar. | Métricas de requests/colas. |
| 4 | Backup | `NOT AUTHORIZED — DO NOT EXECUTE: npm run db:backup` | Backup cifrado, checksum y retención confirmados. | Error, checksum faltante o backup no restaurable. | Quitar freeze; no migrar. | URI redactada, SHA-256, tamaño. |
| 5 | Storage inventory | `NOT AUTHORIZED — DO NOT EXECUTE: npm run storage:verify` | Bucket/ref productivos coinciden; inventario read-only capturado. | Mismatch, bucket inaccesible o credencial incorrecta. | Detener; no tocar objetos. | Project ref/bucket/counts redactados. |
| 6 | DB snapshot | `NOT AUTHORIZED — DO NOT EXECUTE: crear snapshot administrado Supabase y ejecutar restore drill aislado` | Snapshot consistente y restore de prueba válido. | Snapshot/restore falla o RPO/RTO no aceptable. | Quitar freeze; reprogramar. | Snapshot ID y reporte restore. |
| 7 | Checksums | `NOT AUTHORIZED — DO NOT EXECUTE: npx prisma migrate status y auditor SHA-256 read-only` | Historial coincide con matriz aprobada; cero checksum mismatch/partial. | Cualquier mismatch, partial o fila inesperada. | No mutar; volver a reconciliación. | Inventario firmado antes de cambio. |
| 8 | Baseline/resolution | `NOT AUTHORIZED — DO NOT EXECUTE: MIGRATION_CONFIRMATION=APPLY_VERIFIED_MIGRATIONS npx prisma migrate resolve --applied <baseline-canonico-aprobado>` | Solo si estructura ya equivalente: un único registro canónico esperado. | SQL faltante, equivalencia no probada, ID/checksum distinto o más de una fila. | Detener; no editar `_prisma_migrations`; restaurar solo mediante plan de incidente si hubo mutación errónea. | Diff estructural y aprobación separada. |
| 9 | Migrate deploy | `NOT AUTHORIZED — DO NOT EXECUTE: MIGRATION_CONFIRMATION=APPLY_VERIFIED_MIGRATIONS npm run db:migrate:deploy` | Migraciones pendientes terminan una vez, checksums exactos, status limpio. | P3xxx, timeout/lock, partial, drift o latencia excesiva. | Detener app/jobs; preferir forward-fix. Para corrupción, restaurar snapshot a DB nueva. | Logs Prisma, timestamps y status posterior. |
| 10 | Validación DB | `NOT AUTHORIZED — DO NOT EXECUTE: npm run db:verify && npm run test:integration` | Health DB, constraints, índices y dominio críticos verdes. | Error de integridad, scope, performance o schema. | Mantener freeze; backend N-1/forward-fix o restore según severidad. | Reportes health/integration. |
| 11 | Backfill financiero separado | `NOT AUTHORIZED — DO NOT EXECUTE: npm run finance:audit-legacy y ejecutar backfill aprobado con idempotency keys` | Solo `MIGRACION_SEGURA`; ambiguos quedan fuera; segunda corrida cero cambios. | Diferencia de importe, duplicado, actor/expediente ausente o segunda corrida muta. | Parar backfill; nunca borrar ledger; movimientos compensatorios o restore según incidente. | Dry-run firmado + ledger de operaciones. |
| 12 | Validación financiera | `NOT AUTHORIZED — DO NOT EXECUTE: ejecutar reconciliación Pago/MovimientoFinanciero read-only` | Totales explicados sin doble conteo y 0 claves duplicadas. | Cualquier diferencia no explicada. | Mantener freeze financiero; compensación auditada, no DELETE. | Reporte de conciliación. |
| 13 | Backend deploy | `NOT AUTHORIZED — DO NOT EXECUTE: promover imagen backend aprobada en servicio Render existente` | Health DB/Storage/auth/workers verde con commit exacto. | 5xx, auth/scope, worker o migración falla. | Revertir imagen a N-1, workers detenidos. | Deploy ID, commit, health. |
| 14 | Frontend deploy | `NOT AUTHORIZED — DO NOT EXECUTE: promover build frontend aprobado en sitio Netlify existente` | Login, SPA/PWA y rutas cargan contra backend aprobado. | Assets, login, rutas o API incompatibles. | Restaurar deploy anterior. | Deploy ID, commit, smoke. |
| 15 | Smoke tests | `NOT AUTHORIZED — DO NOT EXECUTE: npm run e2e:auth && npm run e2e:rbac && npm run e2e:critical` | Auth, IDOR/RBAC y flujo comercial completo verdes. | Cualquier acceso indebido o paso crítico rojo. | Activar rollback de app; mantener freeze donde corresponda. | Reportes E2E y correlation IDs. |
| 16 | Monitoring | `NOT AUTHORIZED — DO NOT EXECUTE: observar dashboards/logs de DB, Storage, auth, workers y 5xx durante la ventana` | Tasas dentro del baseline y colas drenando. | Error sostenido, latencia, locks, job retry storm o mismatch Storage. | Ejecutar triggers de rollback; no improvisar SQL. | Capturas de métricas y logs. |
| 17 | Rollback triggers/cierre | `NOT AUTHORIZED — DO NOT EXECUTE: cerrar ventana solo tras checklist; si falla, activar docs/release/ROLLBACK_PLAN.md` | Evidencia completa, freeze retirado gradualmente y sistema estable. | Checklist incompleto o alerta activa. | Backend/frontend N-1; workers off; DB restore a instancia nueva solo si procede. | Acta final y decisión go/no-go. |

## Condiciones go/no-go

No-go automático ante: baseline no recuperado/aprobado, staging no reproducible, `PARTIALLY_APPLIED`, drift semántico sin resolver, backup/restore no probado, dry-run financiero no idempotente, Storage mismatch, auth/RBAC/IDOR/E2E rojo o falta de aprobación productiva explícita.

No se ejecutó ningún paso de este runbook durante Fase 15A.

## Actualización Fase 15B

La búsqueda de las dos migraciones perdidas se agotó y no deben reconstruirse ficticiamente. La estrategia vigente pasa a ser **controlled re-baseline**, descrita en `docs/release/phase-15b/PRODUCTION_MIGRATION_EXECUTION_PLAN.md`. El contenido anterior se conserva como evidencia histórica de 15A. La ejecución productiva continúa bloqueada por drift S1, 16 FK sin índice y validaciones staging incompletas.
