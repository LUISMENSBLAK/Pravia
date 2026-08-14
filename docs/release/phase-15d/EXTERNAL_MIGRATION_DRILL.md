# Migration drill externo

Estado: **NOT EXECUTED — EXTERNAL POSTGRES STAGING REQUIRED**.

Cadena preparada: baseline `20260812000000_canonical_production_baseline`, siete deltas y `20260814010000_align_future_schema_and_indexes`. Esperado: nueve migraciones y S2 `fe865ca...bc20`.

El ensayo deberá medir duración y locks por migración en copia externa S0/rebaseline y DB vacía. La convergencia crea 17 índices. El SQL usa `CREATE INDEX`, no `CONCURRENTLY`; Prisma envuelve/ordena migraciones según su motor y `CREATE INDEX CONCURRENTLY` no puede ejecutarse dentro de una transacción. Antes de producción se requiere medir en staging real con tamaños comparables y decidir ventana/estrategia; no se modificó SQL sin esa evidencia.
