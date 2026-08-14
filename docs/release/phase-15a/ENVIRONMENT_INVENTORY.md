# Inventario inequívoco de entornos — Fase 15A

Fecha de auditoría: 2026-08-13. Todas las conexiones se muestran redactadas.

| Entorno | Identidad | PostgreSQL | DB / schema | Historial Prisma | Storage | Estado |
|---|---|---|---|---:|---|---|
| LOCAL | Docker `pravia-phase14-postgres`; `postgresql://***:***@127.0.0.1:55432/pravia_init_test?schema=pravia_os` | 16.14 | `pravia_init_test` / `pravia_os` | 22 | Local aislado: `/private/tmp/pravia-phase14-storage` | Referencia estructural disponible. Fue creada en Fase 14 mediante diff+execute+resolve y **no** demuestra que el historial crudo sea reproducible. |
| STAGING | Docker `pravia-phase15a-staging-postgres`; identificador explícito `local-docker-phase15a`; `postgresql://***:***@127.0.0.1:55433/pravia_staging?schema=pravia_os` | 16.14 | `pravia_staging` / `pravia_os` | 1 registro fallido | Local aislado: `/private/tmp/pravia-phase15a-staging-storage` | Aislado, pero **NO READY**: falló la primera migración. No es staging externo compartido. |
| PRODUCTION | Supabase project ref `mkiwijbampubccrpvgga`; `postgresql://***:***@db.mkiwijbampubccrpvgga.supabase.co/postgres?schema=pravia_os` | 17.6 | `postgres` / `pravia_os` | 17 | Supabase Cloud del mismo project ref | Inspeccionado exclusivamente con sesión DB `default_transaction_read_only=on` y lectura de bucket. Sin mutaciones. |

## Separación y guardas

- `PRAVIA_ENV=staging` es obligatorio para comandos de staging.
- La guarda coteja host, puerto, database y schema con valores esperados, y compara además contra las huellas de producción.
- En Supabase compara el project ref de DB con el esperado y con el project ref de Storage. En Storage local exige una ruta explícitamente de staging.
- Rechaza DB staging + Storage producción, DB producción + Storage staging y cualquier identidad que coincida con producción con `REFUSED_PRODUCTION_WRITE`, antes de invocar Prisma.
- La prueba negativa con la URL productiva terminó en `REFUSED_PRODUCTION_WRITE: la base objetivo coincide con producción.` sin abrir una operación de migración.

## Staging externo pendiente

No se creó infraestructura Supabase externa porque el repositorio no contiene un project ref, credenciales ni autorización de billing para un proyecto de staging separado. Se construyó un entorno local Docker inequívoco y aislado para la prueba destructible de reconstrucción. Para considerar staging real compartido se necesita aprovisionar un proyecto independiente, proporcionar sus secretos mediante el gestor correspondiente y registrar su project ref esperado. Nunca se reutilizará producción.

## Evidencia

- `artifacts/local-readonly.json`
- `artifacts/staging-readonly.json`
- `artifacts/production-readonly.json`
- Tests de `backend/src/safety/stagingGuard.test.ts`

No se documentaron passwords, JWT, service-role keys ni tokens.
