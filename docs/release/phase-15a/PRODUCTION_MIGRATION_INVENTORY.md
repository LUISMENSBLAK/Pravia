# Inventario read-only de producción — Fase 15A

Fecha: 2026-08-13. Identidad: Supabase `mkiwijbampubccrpvgga`, PostgreSQL 17.6, database `postgres`, schema de aplicación `pravia_os`. La tabla de historial está en `public._prisma_migrations`.

## CONFIRMACIÓN DE SOLO LECTURA

La URL fue augmentada con la opción PostgreSQL `-c default_transaction_read_only=on` antes de crear el cliente. La propia sesión devolvió `transaction_read_only = on`. Solamente se ejecutaron los siguientes `SELECT`, exactamente como aparecen en `backend/scripts/phase15a-readonly-inventory.ts` (el nombre de schema del historial fue obtenido por el segundo query y citado como identificador):

```sql
SELECT current_database() AS database, current_schema() AS current_schema,
  current_setting('server_version') AS postgres_version,
  current_setting('transaction_read_only') AS transaction_read_only,
  inet_server_addr()::text AS server_address, inet_server_port() AS server_port;

SELECT table_schema FROM information_schema.tables
WHERE table_name = '_prisma_migrations' ORDER BY table_schema;

SELECT id, migration_name, checksum, started_at, finished_at, rolled_back_at,
  applied_steps_count, logs
FROM "public"."_prisma_migrations"
ORDER BY started_at, migration_name;

SELECT table_schema, table_name, table_type
FROM information_schema.tables
WHERE table_schema IN ('pravia_os', 'public')
  AND table_name <> '_prisma_migrations'
ORDER BY table_schema, table_name;

SELECT table_schema, table_name, ordinal_position, column_name, data_type, udt_schema, udt_name,
  is_nullable, column_default, character_maximum_length, numeric_precision, numeric_scale
FROM information_schema.columns
WHERE table_schema = 'pravia_os'
ORDER BY table_name, ordinal_position;

SELECT n.nspname AS schema_name, c.relname AS table_name, con.conname AS constraint_name,
  con.contype AS constraint_type, pg_get_constraintdef(con.oid, true) AS definition
FROM pg_constraint con
JOIN pg_class c ON c.oid = con.conrelid
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'pravia_os'
ORDER BY c.relname, con.conname;

SELECT schemaname AS schema_name, tablename AS table_name, indexname AS index_name, indexdef AS definition
FROM pg_indexes WHERE schemaname = 'pravia_os'
ORDER BY tablename, indexname;

SELECT n.nspname AS schema_name, t.typname AS enum_name, e.enumsortorder, e.enumlabel
FROM pg_type t JOIN pg_enum e ON t.oid = e.enumtypid JOIN pg_namespace n ON n.oid = t.typnamespace
WHERE n.nspname = 'pravia_os' ORDER BY t.typname, e.enumsortorder;

SELECT sequence_schema, sequence_name, data_type, start_value, minimum_value, maximum_value, increment
FROM information_schema.sequences WHERE sequence_schema = 'pravia_os'
ORDER BY sequence_name;

SELECT trigger_schema, event_object_table AS table_name, trigger_name, event_manipulation,
  action_timing, action_statement
FROM information_schema.triggers WHERE trigger_schema = 'pravia_os'
ORDER BY event_object_table, trigger_name, event_manipulation;

SELECT n.nspname AS schema_name, p.proname AS function_name,
  pg_get_function_identity_arguments(p.oid) AS arguments,
  pg_get_function_result(p.oid) AS result_type,
  p.provolatile AS volatility
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'pravia_os'
ORDER BY p.proname, arguments;
```

No se ejecutó `INSERT`, `UPDATE`, `DELETE`, DDL, `migrate deploy`, `migrate resolve`, backfill ni escritura de Storage. La verificación de Storage productivo fue una lectura de metadatos de bucket.

## Historial

`logs` está vacío y `rolled_back_at` es nulo en los 17 registros.

| id | migration_name | checksum | started_at | finished_at | steps |
|---|---|---|---|---|---:|
| `e5435ca5-703c-4816-8198-e81fddb75a4e` | `20260714025925_init` | `8e0364a853f34e96c145398aba051dde235f67b7eb3253d04892546948667958` | 2026-07-14T02:59:25.857Z | 2026-07-14T02:59:26.224Z | 1 |
| `faf2b0fb-8765-4ed6-9408-a67a6a5ce153` | `20260716025113_simplify_docs_add_groups` | `84422f7fa673c48537816880de9f73ddbc39b7e80e0cb06288a76177ff6b644f` | 2026-07-16T02:51:14.272Z | 2026-07-16T02:51:14.646Z | 1 |
| `6f60c29f-eb26-4e25-b578-a32a4c4ddf99` | `20260726000000_expedientes_core_engine` | `75f600ceed3569bdc1929e8efe5ad6dd9a2e868fa02479430640787799baf95e` | 2026-08-11T22:45:16.391Z | 2026-08-11T22:45:16.391Z | 0 |
| `10956b0c-a293-480c-b9fa-6caf5588d3fd` | `20260731_comparecientes_alta_session_ia` | `0d978977190b76e15344f79caaf5895dc2f60267f369b95057f751c05bb2ecf8` | 2026-08-11T22:45:18.997Z | 2026-08-11T22:45:18.997Z | 0 |
| `8258fa4e-d4cf-4ead-aa39-8c5789055b64` | `20260731_comparecientes_maestro` | `cecd3d80d8e0f4d9578ce5a332c0888c020cf27192d0682bd6c839596e4c9b29` | 2026-08-11T22:45:21.546Z | 2026-08-11T22:45:21.546Z | 0 |
| `6ad2cbd2-afe6-4a86-899d-689632c9d955` | `20260811000000_extend_compareciente_profile_fields` | `600c90933d6b91cf28eda2928ab2456bdeefea1b9f02ceb152520eb9c8605b42` | 2026-08-11T22:45:24.079Z | 2026-08-11T22:45:24.079Z | 0 |
| `7f8eb7ad-015f-4467-9738-52ce5c8247eb` | `20260811010000_extend_operational_agenda_fields` | `8bf94df85e28f91ee4f2df748d3e77a46bcc46178eec1373b2624026a492c189` | 2026-08-11T22:45:26.576Z | 2026-08-11T22:45:26.576Z | 0 |
| `eb26e7a4-bc5b-4704-8036-60351c54afaa` | `20260811011000_extend_agenda_event_types` | `2a3d84698ef63325779b2381e5692bb3ea1897a082fe44892d11e4ca2011e98e` | 2026-08-11T22:45:29.097Z | 2026-08-11T22:45:29.097Z | 0 |
| `84490c77-29d9-425b-b2b3-a851c2133bf4` | `20260811020000_create_ai_usage_logs` | `41ce6da7b2d159571033afbcd5be788b821fab577a7d85c7fe6a5925a96f9099` | 2026-08-11T22:45:31.669Z | 2026-08-11T22:45:31.669Z | 0 |
| `f1196fb0-0c4f-489c-aa5a-7b239ba4a8b5` | `20260811030000_create_compliance_engine` | `2c8816a71a2c278f805bc66602a0607ec86a226408a0aa8c47234eac643ca0a3` | 2026-08-11T22:45:34.124Z | 2026-08-11T22:45:34.124Z | 0 |
| `57b0dd27-d989-4b50-9b7b-6c1edec81668` | `20260811031000_seed_verified_compliance_references` | `e33a2088d875d91ccf632cb1f2d3c2753d5a1ac1a913f125c8b8e3de6f719a10` | 2026-08-11T22:45:36.599Z | 2026-08-11T22:45:36.599Z | 0 |
| `afa4c6a5-16b7-451d-bb99-9da2d897c710` | `20260811040000_create_secure_auth_sessions` | `40eee7d5bf339b40bfec89a7c39e3d2af5c77c28fb47bcd69619eddfea0be4b2` | 2026-08-11T22:45:39.142Z | 2026-08-11T22:45:39.142Z | 0 |
| `dbd95175-ec63-4bef-bd27-7668a01f80db` | `20260811041000_harden_legacy_public_api` | `99d735f0ab5244aa798b01cc07c5039867da97cc6ee975bb0fb7594562302d8f` | 2026-08-11T22:45:41.594Z | 2026-08-11T22:45:41.594Z | 0 |
| `85fcbbbe-7033-4396-a2a5-082295e0c385` | `20260811042000_define_legacy_data_api_deny_policies` | `942c97e0b2039c4e9aca0591700eda4b49ebdb03a28d69641d4dc760bbc5b0d9` | 2026-08-11T22:45:44.140Z | 2026-08-11T22:45:44.140Z | 0 |
| `ca3b9a24-2e97-4e78-a8ed-a58ed7c23624` | `20260811050000_add_operational_fk_indexes` | `ebaa1d591a49fc82af3c4362fa28bdf0429ddda52d806094d8309728b1fbabc5` | 2026-08-11T22:45:47.156Z | 2026-08-11T22:45:47.156Z | 0 |
| `37bb2545-631b-441a-a58c-0c8edf1e2dbc` | `20260811051000_complete_operational_fk_indexes` | `9ae35e2d8edd91e685e73f9c2efdef49208b4a42832e004f6952f52de8f22c48` | 2026-08-11T22:45:49.926Z | 2026-08-11T22:45:49.926Z | 0 |
| `cdf06262-261a-45cb-9287-a8d848541c1e` | `20260811052000_add_compareciente_link_validation` | `56bcc0d5e7294935cd1e0cafb6a7175e90bb9116d3e9091507a7787c56c568d6` | 2026-08-11T22:45:52.684Z | 2026-08-11T22:45:52.684Z | 0 |

Los 15 registros desde `20260726000000` tienen `steps=0` y timestamps de inicio/fin iguales. Esto es evidencia compatible con un `migrate resolve --applied` o registro equivalente después de SQL aplicado por otra vía; no prueba por sí solo cuál herramienta lo hizo. El repositorio contiene `backend/scripts/execute-migration-pravia-os.ts`, que confirma que existió un flujo manual de ejecución. Por ello no se tratarán como un deploy Prisma reproducible.

## Estructura observada

- `pravia_os`: 67 tablas, 902 columnas, 236 constraints, 258 índices, 249 labels enum, 0 sequences, 4 triggers y 1 función.
- `public`: 7 tablas adicionales de plataforma/apoyo; no se interpretan como modelos Prisma de `pravia_os`.
- Evidencia completa, incluidos valores de `logs`: `artifacts/production-readonly.json`.
