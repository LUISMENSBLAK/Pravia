# PRAVIA OS — Production Deployment Report

Fecha de corte: 2026-10-28

## Estado

- `PRODUCTION_DEPLOYED`: **NO**
- `RELEASE_BRANCH`: `codex/release-pravia-20261028`
- `RELEASE_CANDIDATE_COMMIT_AUDITED`: `6307b39a93d066233382f942c14d6fd50981b9ad`
- `BASE_COMMIT`: `5ca8ad675853c3e5a2a2be1930bd9b8b279ad0c2`
- `PRODUCTION_COMMIT_BEFORE_RELEASE`: `5ca8ad675853c3e5a2a2be1930bd9b8b279ad0c2`
- `PRODUCTION_COMMIT_AFTER_RELEASE`: **NOT APPLICABLE**
- `MIGRATIONS_APPLIED_TO_PRODUCTION`: **NONE**
- `PRODUCTION_WRITES`: **NONE**

No se inició un despliegue porque los gates obligatorios de integridad documental,
backup/restauración independiente y staging E2E todavía no tienen evidencia PASS. El
ensayo de las nueve migraciones sobre una restauración real representativa sí pasó.

## Infraestructura observada en modo lectura

- Netlify `pravianetwork`: producción desde `main`; commit publicado `5ca8ad675853c3e5a2a2be1930bd9b8b279ad0c2`; branch deploys limitados a la rama de producción; deploy previews para pull requests; build activo.
- Render `pravia-api`: rama `main`; Auto-Deploy `Off`; health check `/health`; último commit desplegado antes de este release `5ca8ad675853c3e5a2a2be1930bd9b8b279ad0c2`.
- Supabase `NOTARYPROY`: ref `mkiwijbampubccrpvgga`, `PRODUCTION/main`, `us-west-2`; coincide con DB y Storage configurados. El plan observado no tiene backups ni branches disponibles.
- No se modificó ninguna configuración remota durante esta inspección.

## Rollback

El rollback productivo no se ha ejercitado para este release. Las revisiones anteriores
están visibles en Netlify y Render, pero su existencia no sustituye una restauración
certificada de PostgreSQL y Storage. No se declarará rollback PASS hasta demostrar el
procedimiento completo en una falla independiente de la infraestructura primaria.

## Bloqueadores vigentes

1. Las 26/26 referencias históricas existen y tienen tenant coherente, pero 0/26 objetos físicos fueron localizados en ambos buckets o metadata accesible.
2. No existe staging externo aislado configurado para ejecutar el recorrido obligatorio.
3. No existe evidencia de restauración independiente y utilizable de PostgreSQL + Storage.
4. El bucket canónico `pravia_documentos` tiene límite productivo de 20 MB; la política aprobada exige 50 MB y el ajuste aún no fue validado en staging.
5. IA externa queda fail-closed en producción mediante `AI_EXTERNAL_ENABLED=false` hasta certificación específica.

## Evidencia local añadida

- Cadena completa desde base vacía: `122` migraciones, `0` pendientes en el candidato funcional certificado.
- Backup/restore QA local: DB restaurada, `161/161` archivos con SHA-256 idéntico y backend restaurado saludable.
- Snapshot read-only real: dump PostgreSQL `2,802,760` bytes, restore `286` tablas/`114` migraciones, y ensayo de las `9` pendientes hasta `123/123` PASS.
- Backup local del Storage actualmente accesible: `249/249` entradas verificadas por tamaño y SHA-256, `0` divergencias; no contiene los 26 ausentes.
- Regresión: backend `2.309/2.309`, frontend `494/494`, builds y Prisma PASS.
- GitHub Actions [run 40737541504](https://github.com/LUISMENSBLAK/Pravia/actions/runs/40737541504): backend, frontend, bootstrap PostgreSQL vacío y secret scan PASS sobre `6307b39`.
- Esta evidencia mejora la preparación, pero no convierte en PASS los gates de staging, integridad histórica o recuperación independiente.

Detalle reproducible y sanitizado: [auditoría NOTARYPROY](release/2026-10-28/NOTARYPROY_READONLY_AUDIT.md).
