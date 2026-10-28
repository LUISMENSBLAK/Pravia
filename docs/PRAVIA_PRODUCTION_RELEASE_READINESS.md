# PRAVIA OS — preparación verificable de release

Estado al 28-10-2026: **NO-GO / preparación en curso**. Se creó `codex/release-pravia-20261028` desde HEAD `5ca8ad675853c3e5a2a2be1930bd9b8b279ad0c2`, conservando el worktree sucio; `main` no se modificó. Había 100 rutas modificadas y 56 nuevas antes de crear los documentos de release, staging Git vacío y nueve migraciones nuevas sin commit. Ese HEAD coincide con `origin/main` como commit Git, pero no prueba qué está desplegado actualmente. Las suites locales más recientes pasaron backend 2.308/2.308, frontend 494/494, PostgreSQL folios 4/4 y E2E COL56/COL67 2/2; son evidencia local, no staging ni producción.

| GATE | EVIDENCE | STATUS | BLOCKER | REMEDIATION | OWNER / DEPENDENCY |
|---|---|---|---|---|---|
| `SECURITY_GATE` | Denegación 403 auditada en QA; `git diff --check` limpio; secret scan de 1.954 archivos sin hallazgos no reconocidos; IA externa fail-closed en producción. | `PARTIAL` | Sí | CI del commit exacto y prueba adversarial del artefacto externo. | Ingeniería / Git + CI |
| `TENANT_ISOLATION_GATE` | Tests QA entre tenants para maestros, documentos, folios y CSF. | `PARTIAL` | Sí | Repetir flujo mínimo y rutas habilitadas sobre staging aislado. | QA / staging |
| `RBAC_GATE` | Roles QA probaron lectura compartida, edición restringida y denegaciones. COL56 sigue PARCIAL. | `PARTIAL` | Sí | Matriz física de acciones críticas, sesiones y permisos; [cobertura](PRAVIA_COL56_AUDIT_COVERAGE.md). | Ingeniería + QA |
| `DATA_INTEGRITY_GATE` | [Auditoría anterior](architecture/LEGACY_STORAGE_PHYSICAL_VERIFICATION.md): 83 referencias, 57 objetos legibles, 26 no localizados. | `FAIL` | Sí | Clasificar 26 individualmente en fuentes/backup/versiones; no declarar pérdida ni fabricar bytes. | Operación Storage / acceso autorizado read-only |
| `STORAGE_GATE` | Storage QA local y SHA en pruebas COL67; histórico productivo no reconciliado. | `PARTIAL` | Sí | Verificación de buckets/objetos productivos read-only, aislamiento staging y hashes. | Operación Storage |
| `BACKUP_RESTORE_GATE` | [Drill local 2026-10-28](release/2026-10-28/LOCAL_RELEASE_DRILLS.md): dump/restore DB, 161/161 hashes Storage, conteos críticos y runtime restaurado PASS; comparte host/disco. | `PARTIAL` | Sí | Repetir backup y restore en dominio de falla independiente. | Infraestructura / destino autorizado |
| `PRODUCTION_FOLIO_GATE` | COL45 sintético PostgreSQL 4/4; cotejo de folios/IDs/relaciones productivas read-only pendiente. | `PARTIAL` | Sí | Consultas productivas de sólo lectura y snapshot antes/después; nunca reservar ni renumerar. | DBA / acceso read-only |
| `MIGRATION_SAFETY_GATE` | Bootstrap PostgreSQL 16 desde vacío PASS: 122 migraciones, 0 pendientes. Nueve migraciones nuevas siguen sin commit y falta preflight productivo read-only. | `PARTIAL` | Sí | Preflight productivo de colisiones/constraints y replay sobre snapshot productivo restaurado. | Ingeniería + DBA |
| `STAGING_GATE` | No hay URLs externas de backend/DB/Storage/Netlify staging verificadas en este corte. | `NOT VERIFIED` | Sí | Infraestructura aislada autorizada, variables separadas y E2E externo multiusuario. | Operaciones Render/Netlify/PostgreSQL/Storage |
| `ENABLED_FEATURES_FUNCTIONAL_GATE` | [Alcance propuesto](PRAVIA_PRODUCTION_RELEASE_SCOPE.md); COL 67 PASS/3 PARCIAL, FDR 15/90 puntual, EXT 0/60 integral. | `NOT VERIFIED` | Sí | Aislar de verdad funciones no certificadas y probar 25 pasos del camino mínimo; FDR31 si Facturación se anuncia. | Producto + QA |
| `RELEASE_CI_GATE` | Builds/suites locales PASS; se añadió `.github/workflows/release-ci.yml`, pero todavía no existe corrida remota del commit candidato. | `PARTIAL` | Sí | Commit(s), push de rama segura y CI verde sin autodeploy productivo. | Ingeniería / Git + CI |

## Infraestructura observada en modo lectura

- Netlify `pravianetwork`: producción desde `main`, build activo, branch deploys sólo para la rama de producción y previews para pull requests.
- Render `pravia-api`: rama `main`, Auto-Deploy `Off`, health check `/health` y commit live `5ca8ad675853c3e5a2a2be1930bd9b8b279ad0c2`.
- La inspección no modificó configuración remota ni inició despliegues.

Regla de decisión: **sólo desplegar cuando todos los gates obligatorios para el alcance habilitado sean PASS**. Una función excluida debe quedar inaccesible también por API, jobs, workers, webhooks y acciones indirectas. `PARTIAL`, `NOT VERIFIED` y `FAIL` no equivalen a PASS. El reporte de publicación permanece en [deployment report](PRAVIA_PRODUCTION_DEPLOYMENT_REPORT.md).
