# PRAVIA OS — auditoría read-only de NOTARYPROY · 2026-10-28

## Identidad y alcance

- Cuenta/organización visible en Supabase: `JavierTapia360`.
- Organización Supabase: `fnmtzgigwedsphtawwjb`.
- Proyecto: `NOTARYPROY`.
- Project ref: `mkiwijbampubccrpvgga`.
- Región: West US (Oregon), `us-west-2`.
- Entorno/rama: `PRODUCTION` / `main`.
- URL de proyecto: `https://mkiwijbampubccrpvgga.supabase.co`.
- La referencia coincide con `DATABASE_URL`, `DIRECT_URL` y `SUPABASE_URL` ya configuradas para PRAVIA. Los valores secretos no se imprimieron ni se copiaron al repositorio.
- PostgreSQL se consultó con `default_transaction_read_only=on`. No se ejecutó SQL desde el editor web, no se cambiaron variables, buckets, políticas ni ajustes.
- Storage observado: buckets privados `pravia_documentos` (límite configurado 20 MB) y `documents` (límite del proyecto 50 MB).

## PostgreSQL y ensayo de migraciones

- Estado productivo observado: schema `pravia_os`, `286` tablas y `114` migraciones aplicadas.
- Diferencia contra el paquete canónico del candidato: exactamente `9` migraciones pendientes.
- Dump read-only custom/comprimido: `2,802,760` bytes; SHA-256 `a60231aa492c89432aab90193b45c4c4feb9d64bedeb38a13a7ee9934d347535`.
- Restore local aislado: PostgreSQL 16, DB temporal `pravia_prod_rehearsal_20261028`, `286` tablas y `114` migraciones antes del ensayo.
- El restore necesitó habilitar localmente `pg_trgm` en `pravia_os`; no cambió el dump ni producción.
- Paquete canónico: `123` migraciones (`114` aplicadas + `9` pendientes).
- `prisma migrate deploy` sobre el restore: **PASS**, aplicó las `9` pendientes y terminó `123/123`, `0` pendientes.
- Producción: **0 migraciones aplicadas, 0 escrituras**.

Migraciones ensayadas, en orden:

1. `20261026010000_prefactura_pdf_versions`
2. `20261026020000_cfdi_incremental_drafts`
3. `20261026030000_supplier_csf_extraction_lineage`
4. `20261026040000_receiver_fiscal_regimes`
5. `20261026050000_receiver_csf_extraction_lineage`
6. `20261027010000_org_scoped_folios`
7. `20261027020000_record_collaboration`
8. `20261028010000_unassigned_prospects`
9. `20261028020000_expediente_folio_series`

## Auditoría individual de los 26 documentos históricos

Las `26/26` asociaciones lógicas existen después de restaurar la copia productiva: documento, blob, ubicación, referencia y tenant son coherentes. Todas pertenecen a `aaa8ca77-078e-44d4-ac00-6d2a3611032c` y conservan estado `LEGACY_UNVERIFIED`. No existe SHA histórico persistido para ninguna de estas 26 referencias.

Cada key fue consultada en ambos buckets (`52` GET read-only en total) y mediante listado de metadatos del directorio padre. Los GET devolvieron HTTP `400`; los listados respondieron HTTP `200`, pero no contenían el nombre exacto. No se imprimieron rutas, keys ni contenido.

| Documento | Tenant | Referencia histórica | Orígenes consultados | Estado físico / evidencia | SHA verificado | Recuperación observada |
|---|---|---|---|---|---|---|
| `14d2a675-386b-47b5-83d5-a7b33651de76` | `aaa8ca77-078e-44d4-ac00-6d2a3611032c` | Sí | Ambos buckets + metadata | No localizado; GET 400, nombre exacto ausente | No disponible | No recuperable con fuentes accesibles |
| `1f02cc08-de9a-4764-8401-5bb87aa8b06b` | `aaa8ca77-078e-44d4-ac00-6d2a3611032c` | Sí | Ambos buckets + metadata | No localizado; GET 400, nombre exacto ausente | No disponible | No recuperable con fuentes accesibles |
| `28007066-2d27-4d21-bad9-34e9b7a4b2f5` | `aaa8ca77-078e-44d4-ac00-6d2a3611032c` | Sí | Ambos buckets + metadata | No localizado; GET 400, nombre exacto ausente | No disponible | No recuperable con fuentes accesibles |
| `3a75bb5b-5ddf-4d14-8501-2b497f6363e0` | `aaa8ca77-078e-44d4-ac00-6d2a3611032c` | Sí | Ambos buckets + metadata | No localizado; GET 400, nombre exacto ausente | No disponible | No recuperable con fuentes accesibles |
| `449fa725-60f0-4ca9-bb91-b585e9a102a0` | `aaa8ca77-078e-44d4-ac00-6d2a3611032c` | Sí | Ambos buckets + metadata | No localizado; GET 400, nombre exacto ausente | No disponible | No recuperable con fuentes accesibles |
| `4a9217eb-da42-4f00-ad3a-880f97d0e743` | `aaa8ca77-078e-44d4-ac00-6d2a3611032c` | Sí | Ambos buckets + metadata | No localizado; GET 400, nombre exacto ausente | No disponible | No recuperable con fuentes accesibles |
| `5385efec-a18b-4557-a2c7-ffdf8067d134` | `aaa8ca77-078e-44d4-ac00-6d2a3611032c` | Sí | Ambos buckets + metadata | No localizado; GET 400, nombre exacto ausente | No disponible | No recuperable con fuentes accesibles |
| `558f252d-a2e2-4606-8aee-d9be16223f6c` | `aaa8ca77-078e-44d4-ac00-6d2a3611032c` | Sí | Ambos buckets + metadata | No localizado; GET 400, nombre exacto ausente | No disponible | No recuperable con fuentes accesibles |
| `59f72cfe-6d91-4be2-abe2-7e9ba4eb65a2` | `aaa8ca77-078e-44d4-ac00-6d2a3611032c` | Sí | Ambos buckets + metadata | No localizado; GET 400, nombre exacto ausente | No disponible | No recuperable con fuentes accesibles |
| `5fcc3c06-f4d4-4388-9a30-ed78a0886fbb` | `aaa8ca77-078e-44d4-ac00-6d2a3611032c` | Sí | Ambos buckets + metadata | No localizado; GET 400, nombre exacto ausente | No disponible | No recuperable con fuentes accesibles |
| `63a5b620-b062-46f2-8235-036840ffd387` | `aaa8ca77-078e-44d4-ac00-6d2a3611032c` | Sí | Ambos buckets + metadata | No localizado; GET 400, nombre exacto ausente | No disponible | No recuperable con fuentes accesibles |
| `6844c3eb-7389-49a2-8780-d65a0e5f2b8d` | `aaa8ca77-078e-44d4-ac00-6d2a3611032c` | Sí | Ambos buckets + metadata | No localizado; GET 400, nombre exacto ausente | No disponible | No recuperable con fuentes accesibles |
| `735c899e-a856-42ba-85b2-d58c2f438ee6` | `aaa8ca77-078e-44d4-ac00-6d2a3611032c` | Sí | Ambos buckets + metadata | No localizado; GET 400, nombre exacto ausente | No disponible | No recuperable con fuentes accesibles |
| `7480e7e2-de37-408d-9280-31ac71ac8fd9` | `aaa8ca77-078e-44d4-ac00-6d2a3611032c` | Sí | Ambos buckets + metadata | No localizado; GET 400, nombre exacto ausente | No disponible | No recuperable con fuentes accesibles |
| `74f09425-7399-4b56-bb84-288e30e7cd34` | `aaa8ca77-078e-44d4-ac00-6d2a3611032c` | Sí | Ambos buckets + metadata | No localizado; GET 400, nombre exacto ausente | No disponible | No recuperable con fuentes accesibles |
| `7f7d31b1-4a09-4824-8264-d0764638de1f` | `aaa8ca77-078e-44d4-ac00-6d2a3611032c` | Sí | Ambos buckets + metadata | No localizado; GET 400, nombre exacto ausente | No disponible | No recuperable con fuentes accesibles |
| `7f830c1b-9e11-477f-8e0d-a705da17810b` | `aaa8ca77-078e-44d4-ac00-6d2a3611032c` | Sí | Ambos buckets + metadata | No localizado; GET 400, nombre exacto ausente | No disponible | No recuperable con fuentes accesibles |
| `8503f967-333a-4e02-acbc-7e0c4e243739` | `aaa8ca77-078e-44d4-ac00-6d2a3611032c` | Sí | Ambos buckets + metadata | No localizado; GET 400, nombre exacto ausente | No disponible | No recuperable con fuentes accesibles |
| `9b386293-1198-4240-8eda-58bc17fe38e5` | `aaa8ca77-078e-44d4-ac00-6d2a3611032c` | Sí | Ambos buckets + metadata | No localizado; GET 400, nombre exacto ausente | No disponible | No recuperable con fuentes accesibles |
| `9bb12b11-ca16-464c-b79c-81249df12895` | `aaa8ca77-078e-44d4-ac00-6d2a3611032c` | Sí | Ambos buckets + metadata | No localizado; GET 400, nombre exacto ausente | No disponible | No recuperable con fuentes accesibles |
| `b6ba1c50-3968-46c7-b6ea-5e297e758fb8` | `aaa8ca77-078e-44d4-ac00-6d2a3611032c` | Sí | Ambos buckets + metadata | No localizado; GET 400, nombre exacto ausente | No disponible | No recuperable con fuentes accesibles |
| `c798da3e-1db9-4fa5-98ab-95b300389182` | `aaa8ca77-078e-44d4-ac00-6d2a3611032c` | Sí | Ambos buckets + metadata | No localizado; GET 400, nombre exacto ausente | No disponible | No recuperable con fuentes accesibles |
| `e07289e8-9173-4dca-a77b-332cc9ef512a` | `aaa8ca77-078e-44d4-ac00-6d2a3611032c` | Sí | Ambos buckets + metadata | No localizado; GET 400, nombre exacto ausente | No disponible | No recuperable con fuentes accesibles |
| `e2412ab5-ed15-45d0-b52b-34e332b8330c` | `aaa8ca77-078e-44d4-ac00-6d2a3611032c` | Sí | Ambos buckets + metadata | No localizado; GET 400, nombre exacto ausente | No disponible | No recuperable con fuentes accesibles |
| `ea88f912-f8bf-4d81-803f-4a1a7702da79` | `aaa8ca77-078e-44d4-ac00-6d2a3611032c` | Sí | Ambos buckets + metadata | No localizado; GET 400, nombre exacto ausente | No disponible | No recuperable con fuentes accesibles |
| `f6e47e0f-0bd1-4bf7-a138-e27422609122` | `aaa8ca77-078e-44d4-ac00-6d2a3611032c` | Sí | Ambos buckets + metadata | No localizado; GET 400, nombre exacto ausente | No disponible | No recuperable con fuentes accesibles |

Resultado físico: **0/26 localizados y verificados**. Resultado lógico: **26/26 referencias y tenant coherentes**. No se declara pérdida definitiva: el proyecto Free observado informa `No backups`, no ofrece branches y no expuso versiones históricas recuperables; aún podría existir una copia externa no conectada.

## Backup actual y límite de independencia

- Inventario Storage read-only actual: `249` objetos (`212` en `pravia_documentos`, `37` en `documents`), `70,574,048` bytes.
- Backup local content-addressed: `132` archivos físicos únicos; `249/249` entradas verificadas por tamaño y SHA-256; `0` faltantes y `0` divergencias.
- Manifest privado local: SHA-256 `e6085041bc8a8ee5bf72d1cbe1d571c5a5cad490c279cc0e6428110ccd0e2a3c`.
- El dump PostgreSQL anterior quedó incorporado y su SHA fue revalidado.
- `BACKUP_LOCAL`: **PASS** para los objetos accesibles ahora.
- `RESTORE_DB_LOCAL`: **PASS**.
- `BACKUP_INDEPENDIENTE`: **NOT VERIFIED**; la copia comparte host/disco con el entorno de trabajo.
- `RESTORE_INDEPENDIENTE`: **NOT VERIFIED**.
- Este backup no puede contener los 26 objetos que no están presentes en las fuentes accesibles.

## Infraestructura externa observada

- Render: sólo existe `pravia-api` en entorno `Production`, plan Free, rama `main`, Auto-Deploy `Off`, commit live `5ca8ad675853c3e5a2a2be1930bd9b8b279ad0c2`; PR previews `Off`.
- Netlify: `pravianetwork`, producción en `main`, commit publicado `5ca8ad675853c3e5a2a2be1930bd9b8b279ad0c2`; branch deploys sólo para producción y deploy previews para PR.
- No existe PostgreSQL ni Storage externo aislado que permita conectar un backend de staging sin usar NOTARYPROY productivo.
- No se creó staging incompleto, no se conectó una preview a producción y no se contrató infraestructura.

## Decisión

`MIGRATION_SAFETY_GATE`: **PASS sobre snapshot representativo**.

`DATA_INTEGRITY_GATE`: **FAIL** por `0/26` objetos históricos físicamente verificables.

`BACKUP_RESTORE_GATE`: **PARTIAL** por falta de destino independiente.

`STAGING_GATE`: **NOT VERIFIED** por falta de PostgreSQL + Storage externos aislados.

`PRODUCTION_RELEASE_GATE`: **NO-GO**. No se ejecutaron migraciones ni deploy productivo.
