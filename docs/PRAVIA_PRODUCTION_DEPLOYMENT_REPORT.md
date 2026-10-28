# PRAVIA OS — Production Deployment Report

Fecha de corte: 2026-10-28

## Estado

- `PRODUCTION_DEPLOYED`: **NO**
- `RELEASE_BRANCH`: `codex/release-pravia-20261028`
- `RELEASE_CANDIDATE_COMMIT`: `5065791ac8964256ad9472fbcd17b3f05fdaa76e`
- `BASE_COMMIT`: `5ca8ad675853c3e5a2a2be1930bd9b8b279ad0c2`
- `PRODUCTION_COMMIT_BEFORE_RELEASE`: `5ca8ad675853c3e5a2a2be1930bd9b8b279ad0c2`
- `PRODUCTION_COMMIT_AFTER_RELEASE`: **NOT APPLICABLE**
- `MIGRATIONS_APPLIED_TO_PRODUCTION`: **NONE**
- `PRODUCTION_WRITES`: **NONE**

No se inició un despliegue porque los gates obligatorios de integridad documental,
backup/restauración independiente y staging E2E todavía no tienen evidencia PASS.

## Infraestructura observada en modo lectura

- Netlify `pravianetwork`: producción desde `main`; branch deploys limitados a la rama de producción; deploy previews para pull requests; build activo.
- Render `pravia-api`: rama `main`; Auto-Deploy `Off`; health check `/health`; último commit desplegado antes de este release `5ca8ad675853c3e5a2a2be1930bd9b8b279ad0c2`.
- No se modificó ninguna configuración remota durante esta inspección.

## Rollback

El rollback productivo no se ha ejercitado para este release. Las revisiones anteriores
están visibles en Netlify y Render, pero su existencia no sustituye una restauración
certificada de PostgreSQL y Storage. No se declarará rollback PASS hasta demostrar el
procedimiento completo en una falla independiente de la infraestructura primaria.

## Bloqueadores vigentes

1. Veintiséis referencias históricas de documentos no tienen objeto físico recuperable verificado.
2. No existe staging externo aislado configurado para ejecutar el recorrido obligatorio.
3. No existe evidencia de restauración independiente y utilizable de PostgreSQL + Storage.
4. IA externa queda fail-closed en producción mediante `AI_EXTERNAL_ENABLED=false` hasta certificación específica.

## Evidencia local añadida

- Cadena completa desde base vacía: `122` migraciones, `0` pendientes.
- Backup/restore QA local: DB restaurada, `161/161` archivos con SHA-256 idéntico y backend restaurado saludable.
- Regresión: backend `2.309/2.309`, frontend `494/494`, builds y Prisma PASS.
- GitHub Actions [run 40736831435](https://github.com/LUISMENSBLAK/Pravia/actions/runs/40736831435): backend, frontend, bootstrap PostgreSQL vacío y secret scan PASS sobre el commit candidato.
- Esta evidencia mejora la preparación, pero no convierte en PASS los gates de staging, integridad histórica o recuperación independiente.
