# Rebaseline simulation V2

Destino exclusivo: `127.0.0.1:55434/pravia_rebaseline_sim?schema=pravia_os`.

1. El baseline reprodujo S0 `4a4d89cbb98c0ba29017fcac70c3109ed95a8e0824b74637bcf6f3f2dfc5b172`.
2. Se sembraron y verificaron exactamente las 17 filas legacy nombre/checksum.
3. En una transacción, la metadata se archivó como `pravia_migration_archive._prisma_migrations_legacy_20260814`.
4. El archivo conserva las columnas originales y añade `archived_at`, `archive_reason` y `canonical_baseline_name`.
5. Se resolvió solo en la copia `20260812000000_canonical_production_baseline`.
6. `migrate deploy` aplicó siete deltas y la migración de convergencia.
7. La metadata canónica terminó con nueve filas; el archivo legacy con 17/17 filas y asociación al baseline.
8. El fingerprint final fue S2 `fe865ca...bc20`.

Resultado: **PASS**. Producción no fue modificada.
