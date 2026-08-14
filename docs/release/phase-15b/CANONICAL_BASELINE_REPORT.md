# Canonical baseline report

Estado: **VALIDADO COMO S0**. El candidato `20260812000000_canonical_production_baseline` representa el estado estructural productivo observado antes de los siete deltas. Su SHA-256 es `51526bb12228a0c5f4fd02f9baec77ae696f601c2c6f5ff70c2fa9b9cf5f7b49`.

La fuente fue introspección read-only de PostgreSQL 17.6 y `prisma migrate diff` desde vacío, seguido de revisión manual. Se restituyeron dos checks, once constraints únicas, ocho índices parciales/de expresión, una función y dos triggers que el diff inicial no conservó correctamente. Se eliminaron ownership, grants, extensiones de entorno, datos y secretos.

El SQL crea `pravia_os`, 67 tablas, 902 columnas, 236 constraints, 258 índices, 249 etiquetas enum, una función y dos triggers. No contiene INSERT, PII, IDs productivos ni URLs. El candidato sigue fuera de `backend/prisma/migrations`; la historia oficial no fue sustituida.

Fuentes reproducibles:

- `artifacts/production-schema/production-structure.json`
- `artifacts/canonical-baseline/20260812000000_canonical_production_baseline/migration.sql`
- `backend/scripts/phase15b-production-schema-snapshot.ts`
- `backend/scripts/phase15b-schema-fingerprint.ts`
