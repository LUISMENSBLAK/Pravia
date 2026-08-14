# Supabase staging validation

Estado: **BLOCKED — STAGING SUPABASE REQUIRED**.

No hay project ref staging, `STAGING_DATABASE_URL`, `STAGING_DIRECT_URL`, `STAGING_SUPABASE_URL`, service role ni autorización de provisioning. Por tanto no se ejecutaron migraciones, seeds, Storage, fingerprint S2, objetos nativos, backup ni restore externos.

Barreras verificadas localmente:

- `PRAVIA_ENV=staging` obligatorio;
- host/puerto/base/schema deben coincidir con identidad esperada;
- ref DB = ref Storage = ref staging esperado;
- ref staging distinto de producción `mkiwijbampubccrpvgga`;
- cualquier coincidencia produce `REFUSED_PRODUCTION_WRITE`.

Resultado esperado al desbloquear: PostgreSQL accesible con SSL, schema `pravia_os`, baseline + siete deltas + convergencia, nueve filas canónicas y fingerprint S2 exacto `fe865ca...bc20`.
