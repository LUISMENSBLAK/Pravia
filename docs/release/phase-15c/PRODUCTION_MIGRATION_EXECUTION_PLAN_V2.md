# Plan productivo V2 — NO AUTORIZADO

> **NOT AUTHORIZED — DO NOT EXECUTE.** Este documento es solo un runbook futuro.

Cadena aprobada técnicamente: baseline `20260812000000_canonical_production_baseline` + siete deltas 20260812/13 + `20260814010000_align_future_schema_and_indexes`.

Precondiciones futuras: aprobación explícita, backup/restore probado, nueva captura S0 exacta, tamaños y huérfanos revalidados read-only, ventana y responsables, variables de producción separadas, plan de comunicación y rollback. Primero debe archivarse lineage 17/17 con reason/timestamp/baseline, registrar baseline canónico y aplicar ocho pendientes. Después: status/no-op, fingerprint S2, 8/8 integration, health y smoke funcional.

Rollback: antes del primer delta puede restaurarse metadata legacy si no existe metadata canónica; después de cambios estructurales se usa restore del backup/rollback por migración revisada, nunca `db push` ni edición improvisada de `_prisma_migrations`. Los índices pueden retirarse solo tras evidencia; la FK aditiva puede retirarse de forma controlada si bloquea el arranque.

Todos los comandos de producción permanecen **NOT AUTHORIZED — DO NOT EXECUTE**. No hubo deploy Render/Netlify ni push.
