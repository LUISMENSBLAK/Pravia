# Simulación de re-baseline

Destino único: `127.0.0.1:55434/pravia_rebaseline_sim?schema=pravia_os`.

1. Se creó S0 con el baseline candidato.
2. `seed` creó una `_prisma_migrations` con las 17 filas y checksums del inventario productivo 15A.
3. `cutover` verificó fingerprint S0 y la igualdad exacta de los 17 pares nombre/checksum.
4. En una transacción se bloqueó la tabla, se renombró y se movió a `pravia_migration_archive._prisma_migrations_legacy_20260814`; ninguna fila se borró.
5. `prisma migrate resolve --applied 20260812000000_canonical_production_baseline` se ejecutó sólo en la copia.
6. `prisma migrate deploy` aplicó exactamente los siete deltas.
7. `prisma migrate status` terminó `Database schema is up to date!`.

Resultado: archivo legacy 17 filas; metadata canónica ocho filas; fingerprint S1 `e4dd1e6e...`; igual al staging reconstruido. El rollback mueve el archivo a `pravia_os`, restaura el nombre y elimina el schema técnico, siempre que aún no exista metadata canónica. El guard con fingerprint incorrecto devolvió `REFUSED_SCHEMA_MISMATCH` y no generó artefacto.

La técnica de metadata funciona en simulación, pero **no está autorizada ni lista para producción** por el drift S1 y la integración DB fallida.
