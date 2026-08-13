# Runbook de operaciones

## Contrato de entorno

Copiar los `.env.example` de frontend/backend y aportar secretos mediante el gestor del proveedor, nunca por Git o chat. Variables clave:

- Frontend: `VITE_API_BASE_URL` debe apuntar a la API HTTPS existente.
- DB: `DATABASE_URL`, `DIRECT_URL`, `PRAVIA_DATABASE_SCHEMA=pravia_os`, modos/primarios cloud-local.
- Storage: `STORAGE_MODE`, Supabase URL/service role para cloud o path y secreto de firma para local.
- Auth: `AUTH_JWT_SECRET` de 32+ caracteres, CORS exacto y expiraciones.
- IA: proveedor/modelo/API key y límites; sin clave se debe degradar de forma humana.
- E2E/seed: credenciales QA y `PRAVIA_SEED_ACTOR_USER_ID` solo en entornos aislados.
- Migración: `MIGRATION_CONFIRMATION=APPLY_VERIFIED_MIGRATIONS` únicamente durante una ventana autorizada.

El backend falla al inicio si el esquema, Storage local, JWT o CORS productivo no cumplen el contrato. Además compara project refs de DB y Supabase Storage.

## Desarrollo y build

```bash
cd backend && npm ci && npm run dev
cd frontend && npm ci && npm run dev
cd backend && npm run build
cd frontend && npm run build
```

Producción sirve `backend/dist/index.js`; el frontend sirve `frontend/dist`. El Dockerfile genera Prisma y compila, pero las migraciones son un paso manual y explícito, no parte del proceso web.

## Validación

```bash
cd backend && npm test
cd backend && npm run test:integration
cd backend && npm run build
cd backend && npx prisma validate && npx prisma generate
cd backend && npm run check:secrets && npm audit
cd frontend && npm test
cd frontend && npm run build && npm audit
git diff --check
```

Los E2E aislados son `npm run e2e:auth`, `npm run e2e:critical` y `npm run e2e:rbac`. Nunca habilitar creación sintética contra producción.

## Migraciones y seeds

1. `npm run db:migrate:status` usa el wrapper que fuerza `pravia_os`.
2. Respaldar y validar restauración.
3. Ejecutar en staging real.
4. Con aprobación: `MIGRATION_CONFIRMATION=APPLY_VERIFIED_MIGRATIONS npm run db:migrate:deploy`.
5. `npm run seed` solo carga catálogos idempotentes; seeds de dominio requieren actor explícito.

## Workers

- Storage compensation se inicia solo con su flag de entorno y usa claim, reintentos, backoff, máximo y estado final.
- Outbox solo debe marcar éxito cuando existe handler válido; handlers desconocidos permanecen observables.
- IA/documentos y notificaciones deben arrancarse como procesos/servicios definidos por la infraestructura existente, con una sola responsabilidad por réplica.
- Antes de rollback, detener consumidores; después revisar pendientes/dead-letter y reanudar idempotentemente.

## Health, logs y alertas

- Health de proceso no equivale a health de DB; verificar ambos endpoints/chequeos.
- Usar correlation/request ID. No registrar passwords, cookies, tokens, documentos, API keys ni payload financiero completo.
- Alertar por 5xx, latencia, fallos de refresh, jobs finales, cola creciente, errores Storage y diferencias de reconciliación.

## Deploy autorizado futuro

- Netlify: site existente, build de `frontend`, SPA redirect y headers de `public/_redirects`/`public/_headers`; validar API HTTPS y PWA V1→V2.
- Render: servicio existente, Node compatible, build backend, start sin migraciones automáticas, health configurado y CORS limitado.
- Smoke: login/refresh/logout, Mi Día, expediente/documento, ledger/reportes, cumplimiento, notificaciones, Command Center y PWA.

## Backup y rollback

Ejecutar `npm run db:backup`, verificar checksum y restaurar en una DB nueva con `npm run db:restore`. Seguir [ROLLBACK_PLAN.md](./ROLLBACK_PLAN.md); no borrar Storage ni snapshots/ledger.
