# Plan futuro: controlled re-baseline

Estado: **NO AUTORIZADO / BLOQUEADO**.

La estrategia de recuperar las dos migraciones perdidas queda reemplazada conceptualmente por un controlled re-baseline. Antes de cualquier ventana productiva se requiere: reconciliar S1 con `schema.prisma`; añadir índices para las 16 FK; repetir integración, compliance y workers; aprobar manifest/hashes; backup probado; doble control humano; ventana y rollback.

En una fase posterior autorizada: activar mantenimiento, backup de DB y metadata, forzar preflight read-only, exigir fingerprint S0 exacto, archivar las 17 filas legacy de manera transaccional, registrar el baseline sin ejecutarlo, desplegar siete deltas, verificar fingerprint S1 y smoke tests. Cualquier diferencia produce `REFUSED_SCHEMA_MISMATCH` y aborta antes de metadata.

Rollback antes de deltas: restaurar metadata legacy mediante el procedimiento probado. Después de un delta, restaurar backup completo; no se propone SQL inverso improvisado. Este plan no concede autorización para producción.
