# Runbook final de cutover productivo — PRAVIA OS

Estado: **REHEARSAL Y CIERRE TÉCNICO EJECUTADOS — PENDIENTE APROBACIÓN HUMANA — NO AUTORIZA EJECUCIÓN**
Commit de aplicación objetivo: el checkpoint que contiene este runbook; capturar con `git rev-parse HEAD` y registrarlo como `TARGET_COMMIT` antes del push
Fecha de auditoría: 2026-08-17
Zona operativa: `America/Bahia_Banderas`; todas las evidencias se registran además en UTC.

Este documento no autoriza push, deploy, migraciones, bootstrap, backfill, freeze, cambios de proveedor ni escrituras productivas. Los comandos marcados como **VENTANA FUTURA** solo se ejecutan tras completar todos los gates y recibir una autorización separada.

## 1. Resumen ejecutivo

La plataforma productiva está sana en su release actual y el rehearsal estructural se ejecutó sobre un backup productivo fresco restaurado en PostgreSQL 17 aislado. Las nueve migraciones pendientes, bootstrap, backfill y reconciliaciones de negocio/finanzas pasaron. También pasaron el smoke visual autenticado local, el proveedor OpenAI con datos exclusivamente sintéticos, la transcripción sintética y el inventario autenticado de Netlify por nombres. No quedan bloqueos técnicos del rehearsal; antes del GO se requiere aceptación humana de referencias documentales preexistentes sin blob y las decisiones operativas listadas en este runbook.

El riesgo principal es histórico: el árbol normal `backend/prisma/migrations` contiene migraciones anteriores al rebaseline y no contiene la carpeta del baseline canónico en su raíz. Por tanto, **queda prohibido ejecutar Prisma contra producción usando directamente ese árbol completo**. El procedimiento construye un paquete temporal con el baseline canónico, las ocho migraciones posteriores ya aplicadas y las nueve pendientes. Así Prisma ve exactamente 18 migraciones: 9 `applied` + 9 `pending`.

Producción representa actualmente una sola organización implícita. El cutover crea una única Organization bootstrap explícita y una Membership por cada usuario autorizado. No se infiere ownership desde Notaría, usuario, correo, expediente, responsable ni nombre.

La integridad prevalece sobre disponibilidad: como el servicio Render usa plan Free y su Maintenance Mode no está disponible, el freeze mínimo viable es suspender `pravia-api`. El frontend estático puede seguir visible, pero la API queda fuera de servicio y no puede aceptar escrituras. Debe existir comunicación de mantenimiento al usuario.

## 2. Evidencia actual y fuentes

### Repositorio

| Dato | Resultado |
|---|---|
| Repositorio fuente | `LUISMENSBLAK/Pravia` |
| Branch objetivo | `main` |
| HEAD local | `TARGET_COMMIT=$(git rev-parse HEAD)` en el checkout limpio aprobado |
| HEAD remoto `main` | `b4200cd7f57c6bd93345efb0bae47e478774152b` |
| Diferencia | El checkpoint final aún no fue enviado |
| Capturas fuera de Git | 140 cambios deliberadamente preservados; no forman parte del release |
| Cambios funcionales pendientes | Ninguno |

Los documentos y scripts de este runbook son artefactos de planificación posteriores al checkpoint y deben mantenerse fuera del staging del release salvo autorización separada. Un `git push` envía commits, no cambios sin commit.

### Supabase / PostgreSQL

| Dato | Resultado |
|---|---|
| Proyecto | `NOTARYPROY` |
| Project ref | `mkiwijbampubccrpvgga` |
| Database | `postgres` |
| Schema de aplicación | `pravia_os` |
| Historial Prisma | `pravia_os._prisma_migrations` |
| Health actual | database `ok`, storage `ok` |
| Storage | Supabase cloud, bucket canónico `pravia_documentos` |
| Replicación Storage | desactivada |
| Tamaño observado de `pravia_os` | aproximadamente 5.52 MiB; repetir inmediatamente antes del cutover |

Rehearsal read-only/aislado de 2026-08-18 UTC: backup custom PostgreSQL 17 de 469011 bytes, SHA-256 `e0d8077fa5099a5e704e74aafa159b47a671098e4b419affc6efe37965188401`, restaurado correctamente. El inventario de Storage encontró 2 buckets privados, 161 objetos y 62081760 bytes; los 161 blobs existentes se respaldaron fuera del repositorio con manifest y hashes. La conciliación detectó 26 de 70 `documentos.storage_key` sin blob y 2 referencias adicionales no HTTP sin blob. No se modificaron DB ni Storage productivos.

Snapshot agregado read-only observado durante la planificación: 1 User activo con rol `DIRECCION`, 7 Expedientes, 3 Comparecientes, 70 Documentos, 26 Prospectos, 15 Cotizaciones, 4 Notarías, 6 MovimientosFinancieros, 0 CuentasFinancieras, 1 EventoAgenda, 0 Tareas, 0 ComplianceReviews y 205 AuditLogs. `calculos_isr` todavía no existe. Son cifras orientativas; S0 fresco manda.

### Render

Auditoría visual read-only del servicio existente:

| Dato | Actual |
|---|---|
| Servicio | `pravia-api` |
| Source | `LUISMENSBLAK/Pravia` |
| Branch | `main` |
| Deploy live observado | `dep-da0l7qtbedkc73b18vu0` — `b4200cd7f57c6bd93345efb0bae47e478774152b` |
| Deploy N-1 observado | `dep-da0dq71t0dsc739g9lng` — `1c40b46792b0653918ce550f4ca52589d229a2d5` |
| Root Directory | `backend` |
| Runtime | Docker |
| Dockerfile | `./Dockerfile` relativo a `backend` |
| Build context | `backend` |
| Docker command override | vacío; usa `node dist/index.js` del Dockerfile |
| Pre-deploy command | vacío; el arranque no aplica migraciones |
| Health check | `/health` |
| Auto-Deploy | OFF |
| Instancia | Free, una instancia |
| URL | `https://pravia-api.onrender.com` |

`/health` y `/api/health` devolvieron HTTP 200 con API, DB y Storage `ok`, `NODE_ENV=production`, database/storage cloud y schema `pravia_os`.

### Netlify

La configuración aprobada y confirmada por el operador es: site `pravianetwork`, repo `LUISMENSBLAK/Pravia`, branch `main`, base `frontend`, build `npm run build`, publish `dist`, dominio `pravianetwork.netlify.app` y builds automáticos detenidos. El sitio respondió HTTP 200 y entregó los headers de seguridad esperados. La API pública read-only identificó el deploy vigente `6a81494f064a90348a0fc3c8`, cuyo título referencia el commit `5edb9ce8b67c6bf8e81dcf93d35b15949e0b2843`, y el N-1 `6a80ca09e3a232aad4236012` en `f835c4388bd28640fd905c05f60834856097308e`.

La API autenticada local de Netlify permitió recapturar únicamente nombres y configuración no secreta: repo `LUISMENSBLAK/Pravia`, branch `main`, base `frontend`, build `npm run build`, publish `dist` y cero variables configuradas. El frontend no requiere variables para el modo productivo same-origin `/api`; no falta ningún nombre obligatorio.

## 3. Estado exacto de migraciones

### Aplicadas en producción — 9/9, finalizadas y no revertidas

1. `20260812000000_canonical_production_baseline`
2. `20260812010000_add_granular_delivery_postfirma`
3. `20260812020000_persist_project_templates`
4. `20260812030000_create_canonical_finance_ledger`
5. `20260813010000_immutable_compliance_snapshots`
6. `20260813020000_create_reporting_targets`
7. `20260813030000_settings_and_access`
8. `20260813040000_harden_session_persistence`
9. `20260814010000_align_future_schema_and_indexes`

Los nueve checksums productivos coinciden exactamente con el manifest canónico y los SQL locales correspondientes. El baseline productivo usa SHA-256 `51526bb12228a0c5f4fd02f9baec77ae696f601c2c6f5ff70c2fa9b9cf5f7b49`.

### Pendientes desde producción hasta HEAD — orden exacto

| Orden | Migración | Función / dependencia |
|---:|---|---|
| 1 | `20260816010000_prospect_client_catalogs` | Catálogos y campos de Prospectos; pre-multitenant |
| 2 | `20260816020000_notaria_client_requirements` | Extensiones de Notarías; pre-multitenant |
| 3 | `20260817010000_compareciente_workspace` | Workspace de Comparecientes; pre-multitenant |
| 4 | `20260817020000_enforce_finance_distribution_ceiling` | Guardia de distribución financiera; no reescribe ledger |
| 5 | `20260817030000_create_isr_calculation_module` | Tablas y normativa ISR |
| 6 | `20260817040000_expand_compliance_uif_module` | Expansión Riesgos/UIF |
| 7 | `20260817045000_create_multitenancy_foundation` | Organization, Membership, ownership nullable, FKs y triggers |
| 8 | `20260817050000_create_assistant_conversations` | Conversaciones tenant-aware; depende de foundation |
| 9 | `20260817060000_add_missing_operational_fk_indexes` | Índices para ISR, UIF, sesiones y Assistant |

### Paquete Prisma canónico obligatorio

Preparar localmente, desde el checkout exacto aprobado:

```bash
docs/release/scripts/prepare-canonical-migration-package.sh \
  "/private/tmp/pravia-cutover-$(git rev-parse --short=8 HEAD)"
```

El paquete contiene únicamente baseline + 8 applied + 9 pending, además de `schema.prisma`, `migration_lock.toml` y `SHA256SUMS`. Debe almacenarse fuera del repositorio y regenerarse para el ensayo y para la ventana. No editarlo manualmente.

Queda prohibido contra producción:

- usar directamente `backend/prisma/migrations`;
- ejecutar `prisma db push`, `migrate dev`, `migrate reset` o `migrate resolve`;
- editar `_prisma_migrations`;
- aplicar SQL de las migraciones a mano;
- ejecutar con una URL que resuelva el schema `public`.

El runtime normaliza el schema a `pravia_os`, y `prismaSafe` también lo fuerza. Las URLs observadas localmente no traían el query parameter `schema`; por ello todas las operaciones Prisma futuras deben pasar por `prismaSafe` y verificar que reporta `pravia_os`.

## 4. Auditoría de variables

### Backend / Render

`EXISTS` significa que el nombre fue observado; nunca se leyó ni se documenta su valor.

| Variable | Required | Exists | Server-only | Acción previa |
|---|---:|---:|---:|---|
| `PRAVIA_DATABASE_MODE` | sí | sí | sí | confirmar `cloud` mediante health |
| `PRAVIA_PRIMARY_DATABASE` | sí | sí | sí | confirmar `cloud` mediante health |
| `PRAVIA_DATABASE_SCHEMA` | sí | sí | sí | debe ser `pravia_os` |
| `DATABASE_URL` | compatibilidad Prisma | sí | sí | no imprimir; no usar cruda |
| `DIRECT_URL` | migraciones/backup | sí | sí | no imprimir; `prismaSafe` añade schema |
| `CLOUD_DATABASE_URL` | sí en modo cloud explícito | sí | sí | verificar conectividad sin mostrar valor |
| `CLOUD_DIRECT_URL` | sí en modo cloud explícito | sí | sí | usar para tooling controlado |
| `STORAGE_MODE` | sí | sí | sí | debe ser `cloud` |
| `PRAVIA_PRIMARY_STORAGE` | sí | sí | sí | debe ser `cloud` |
| `SUPABASE_URL` | sí | sí | sí | ref debe coincidir con DB |
| `SUPABASE_SERVICE_ROLE_KEY` | sí | sí | sí | no rotar; non-empty y Storage health |
| `AUTH_JWT_SECRET` | sí | sí | sí | conservar; validar reglas actuales sin imprimir |
| `CORS_ALLOWED_ORIGINS` | sí | sí | sí | confirmar inclusión exacta del dominio Netlify |
| `NODE_ENV` | sí | sí | sí | health confirma `production` |
| `PUBLIC_API_URL` | según URLs absolutas | sí | sí | conservar si coincide con dominio actual |
| `OPENAI_API_KEY` | sí para IA | sí | sí | validar solo con smoke mínimo posterior |
| `OPENAI_DOCUMENT_MODEL` | sí | sí | sí | modelo documental canónico |
| `OPENAI_ESCALATION_MODEL` | sí | sí | sí | modelo de escalamiento canónico |
| `OPENAI_ASSISTANT_MODEL` | no | no | sí | fallback canónico independiente `gpt-5.4-mini`; no bloquear |
| `OPENAI_TRANSCRIPTION_MODEL` | no | no | sí | default validado `gpt-4o-mini-transcribe`; documentar decisión |
| `OPENAI_REASONING_EFFORT` | no | sí | sí | validar valor permitido |
| `AI_ASSISTANT_TIMEOUT_MS` | no | no | sí | fallback al timeout documental |
| `STORAGE_COMPENSATION_WORKER_ENABLED` | no | no | sí | default `false`; mantener apagado durante cutover |
| `AUTH_ALLOW_DEV_RECOVERY_TOKEN` | seguridad | sí | sí | debe ser `false` |
| `AUTH_ALLOW_DEV_INVITATION_LINK` | seguridad | no | sí | ausencia equivale a `false` |

Variables locales/híbridas presentes pueden permanecer inactivas; no deben cambiar la selección cloud. `MIGRATION_CONFIRMATION` solo se suministra al proceso puntual de migración y no debe persistirse en Render.

### Frontend / Netlify

El build puede operar same-origin sin variables: `VITE_API_BASE_URL` usa `/api` y `_redirects` lo lleva a Render. Las rutas auth/Assistant también tienen defaults seguros. En T-24 h registrar únicamente nombres y verificar:

- permitidas: `VITE_API_BASE_URL`, `VITE_DEPLOY_ENV`, rutas `VITE_AUTH_*`, `VITE_MY_DAY_PATH`, rutas `VITE_ASSISTANT_*`;
- `VITE_API_BASE_URL`, si existe, debe ser `/api` o HTTPS permitido;
- `LOCAL_API_PROXY_TARGET` no debe condicionar el bundle productivo;
- prohibidas: `OPENAI_API_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, passwords DB, `AUTH_JWT_SECRET`, URLs DB con credenciales y cualquier secreto server-only.

La recaptura autenticada confirmó cero variables configuradas. Todos los nombres leídos por el frontend son opcionales o disponen de defaults válidos para producción same-origin; `ENV AUDIT = PASS` y no falta ningún nombre requerido.

## 5. Datos bootstrap y sesiones

### Información que debe aprobar el propietario

- `BOOTSTRAP_ORGANIZATION_NAME`: nombre jurídico/comercial definitivo; no inventarlo.
- `BOOTSTRAP_ORGANIZATION_ID`: UUID nuevo generado durante la ventana y comprobado ausente.
- lista nominativa de usuarios legalmente autorizados a conservar acceso;
- rol efectivo de cada Membership, conservando el significado del rol actual;
- operador y segundo verificador.

La observación actual implica una Organization y una Membership `DIRECCION`. El precheck fresco manda. `DIRECCION` nunca se convierte en PlatformAdmin.

### Backfill preparado

Script canónico: `docs/release/multitenancy-bootstrap-backfill.sql`.

Propiedades verificadas:

- recibe ID y nombre explícitos;
- no usa first/default tenant ni infiere ownership;
- solo rellena `organization_id IS NULL`;
- no convierte User en tenant-owned;
- Notaría queda dentro de Organization;
- crea Memberships conservando rol y estado activo/suspendido;
- asocia sesiones a la Membership del mismo User;
- valida una Membership por User y cero huérfanos;
- hace rollback por defecto;
- es repetible con el mismo ID/nombre y datos congelados.

Guard adicional del runbook: antes de ejecutarlo, el UUID debe ser nuevo. Una colisión o cambio de nombre entre dry-run y commit aborta; no se usa el `ON CONFLICT` para adoptar una Organization preexistente.

### Sesiones

Las sesiones legacy se preservan en DB porque el único tenant y la Membership son inequívocos. El backfill asigna `organization_id` y `membership_id`. Los access tokens emitidos por el backend anterior no contienen el claim `org` que exige el backend nuevo, por lo que fallan cerrado; el refresh token puede rotar a una sesión/token tenant-aware después del backfill. Si el refresh no es viable, se requiere login nuevo. No hay fallback y no se cambia la contraseña.

## 6. Backup y restore drill obligatorios

### Backup PostgreSQL fresco

En T0, después del freeze y antes de cualquier migración:

1. crear un directorio seguro fuera del repositorio, con acceso restringido;
2. registrar UTC, operador, project ref, versión `pg_dump` y estado Prisma;
3. ejecutar el script existente, que genera dump custom comprimido del schema `pravia_os` con metadata Prisma y sin ownership/privilegios;
4. registrar tamaño y SHA-256;
5. copiarlo a una ubicación segura secundaria según la política del propietario;
6. nunca sobrescribir un backup anterior.

**VENTANA FUTURA:**

```bash
cd backend
BACKUP_FILE=/ruta/segura/pravia-TIMESTAMP.dump npm run db:backup
shasum -a 256 /ruta/segura/pravia-TIMESTAMP.dump
```

### Restore aislado

El destino debe ser PostgreSQL vacío, aislado y explícitamente distinto de producción. Preparar extensiones requeridas, verificar cero tablas en `pravia_os`, restaurar con `--single-transaction` y ejecutar preflight, fingerprint y finanzas.

**VENTANA FUTURA:**

```bash
cd backend
BACKUP_FILE=/ruta/segura/pravia-TIMESTAMP.dump \
RESTORE_DATABASE_URL=postgresql://DESTINO_AISLADO \
RESTORE_CONFIRMATION=RESTORE_INTO_EMPTY_VERIFIED_TARGET \
npm run db:restore
```

No continuar sin: `RESTORE PASS`, `DATABASE READABLE PASS`, critical counts/hash `MATCH` y financial reconciliation `MATCH`.

### Storage

El dump DB no contiene los blobs. Existen 70 referencias documentales observadas y Storage no tiene replicación automática. Antes de migrar:

- inventariar recursivamente el bucket privado `pravia_documentos` con key, size, updated_at y ETag/hash cuando exista;
- guardar el manifest cifrado/restringido fuera del repo y registrar su SHA-256;
- comparar `documentos.storage_key` contra el inventario y explicar faltantes/sobrantes;
- generar respaldo/export de blobs o snapshot equivalente si el proveedor lo permite;
- no mover ni renombrar blobs legacy durante el cutover;
- mantener el compensation worker apagado hasta reconciliar DB/Storage.

## 7. Fingerprints y reconciliación

Scripts:

- `sql/production-cutover-preflight.sql` — historia, usuarios/roles, sesiones, locks y tamaño;
- `sql/production-cutover-fingerprint.sql` — counts, hashes de IDs, metadata documental y nuevas entidades;
- `sql/production-cutover-financial-reconciliation.sql` — ledger, ingresos, gastos, terceros, notaría, honorarios, por cobrar y cuentas;
- `sql/production-cutover-post-migration.sql` — historia 18/18, Organization/Membership, huérfanos, relaciones tenant e índices.

Todas las salidas se guardan fuera del repo. S0 se toma después del freeze y antes de migrar. S1 se toma después del deploy Prisma y backfill. S2 se toma después de los smokes. La tolerancia monetaria es exactamente `0.00`.

Los únicos cambios esperados son Organization/Memberships, ownership poblado, nuevas estructuras y registros controlados de conversación/AIUsage/auditoría del smoke. Counts e ID hashes del negocio preexistente deben coincidir.

## 8. Ensayo final obligatorio

El rehearsal estructural se ejecutó el 2026-08-17/18 UTC usando un backup productivo fresco restaurado en PostgreSQL 17 aislado, el paquete canónico de 18 migraciones y el commit objetivo. Pasaron migraciones, bootstrap, backfill, ownership tenant, índices, fingerprints, finanzas, backend local, frontend, smoke visual autenticado, proveedor IA sintético, transcripción sintética e inventario Netlify. La evidencia sanitizada está en `checklists/production-cutover-rehearsal-20260817.md` y `checklists/production-cutover-technical-blocker-closure-20260817.md`.

Antes de solicitar la ventana real todavía falta:

1. aceptar o remediar explícitamente las referencias documentales preexistentes sin blob;
2. aprobar Organization, Memberships, operadores y ventana;
3. autorizar el push futuro del commit objetivo.

El ensayo no hizo escrituras, migraciones, cambios de configuración, push ni deploy productivos.

## 9. Gates previos y momento exacto del push

### T-24 h — sin freeze

- cerrar blockers;
- completar rehearsal final;
- aprobar Organization, Memberships, ventana, operadores y comunicación;
- capturar deploy IDs/commits anteriores de Render y Netlify;
- verificar provider env names sin valores;
- confirmar Auto-Deploy Render OFF y Auto-Publish Netlify STOPPED;
- ejecutar tests/build/Prisma validate/generate y secret scan en el commit exacto;
- preparar backup/storage destinations y restore target.

### Push — después de rehearsal PASS, antes del freeze y con auto-deploy apagado

Verificar:

```bash
git rev-parse HEAD
git status --short
git diff --cached --check
TARGET_COMMIT="$(git rev-parse HEAD)"
git diff-tree --no-commit-id --name-only -r "$TARGET_COMMIT"
```

`TARGET_COMMIT` debe capturarse desde el checkout limpio que contiene este runbook y registrarse en `production-cutover-audit-record.md`; no se admite el antiguo checkpoint `e78be2e2ef3b11d1c8176e71bc77572867f1717d` como target final. Las 140 capturas deben permanecer sin staging y no se incluyen. Confirmar `git diff --cached` vacío. Entonces, y solo con autorización:

```bash
git push origin main
git ls-remote origin refs/heads/main
```

El remoto debe devolver el hash exacto. No usar force push. No se despliega todavía.

## 10. Secuencia ejecutable de la ventana

Cada gate requiere dos personas y evidencia en `production-cutover-audit-record.md`.

### A. Freeze

1. comunicar inicio de mantenimiento;
2. confirmar que no hay deploy/build en curso;
3. confirmar Auto-Deploy/Auto-Publish apagados;
4. suspender el servicio Render `pravia-api`;
5. confirmar health fuera de servicio y cero requests mutadores nuevos;
6. verificar que no existe otro worker/cron de PRAVIA; el compensation worker interno está disabled;
7. registrar el último AuditLog/outbox/Storage job observado.

El sitio estático puede seguir accesible, pero toda API falla; esto es aceptado para bloquear escrituras. No tocar servicios ajenos.

### B. Backup y S0

1. crear backup fresco y checksum;
2. completar restore drill aislado;
3. inventariar/resguardar Storage;
4. ejecutar preflight, fingerprint S0 y finanzas S0;
5. abortar ante lock, transacción larga, historia distinta, backup no restaurable o diferencia Storage.

### C. Migraciones

1. regenerar paquete canónico desde el commit remoto exacto;
2. verificar `SHA256SUMS` y baseline;
3. compilar backend y usar exclusivamente `prismaSafe`;
4. ejecutar `migrate status` contra el schema del paquete; debe mostrar 9 applied + 9 pending;
5. aplicar un único `migrate deploy` con confirmación efímera;
6. ejecutar status de nuevo; debe ser clean 18/18.

**VENTANA FUTURA:**

```bash
cd backend
TARGET_COMMIT="$(git rev-parse HEAD)"
CUTOVER_PACKAGE="/private/tmp/pravia-cutover-${TARGET_COMMIT:0:8}"
node dist/cli/prismaSafe.js migrate status \
  --schema "$CUTOVER_PACKAGE/schema.prisma"

MIGRATION_CONFIRMATION=APPLY_VERIFIED_MIGRATIONS \
node dist/cli/prismaSafe.js migrate deploy \
  --schema "$CUTOVER_PACKAGE/schema.prisma"
```

Prisma aplica las nueve pendientes en orden. Aunque conceptualmente foundation precede bootstrap y Assistant lo sigue, el deploy canónico crea primero foundation y después las tablas Assistant vacías e índices; no hay tráfico ni conversaciones que backfillear. Luego el bootstrap rellena ownership de datos legacy. Pausar Prisma a mitad de historia exigiría manipulación manual y es menos seguro.

### D. Bootstrap/backfill

1. generar UUID controlado y confirmar que no existe;
2. revisar nombre y lista autorizada;
3. ejecutar el backfill con `CUTOVER_COMMIT_APPROVED=false`; debe terminar en ROLLBACK y mostrar cero huérfanos;
4. comparar resultados candidatos con S0, incluyendo finanzas sin tolerancia;
5. si coinciden y el freeze sigue intacto, repetir idéntico con `CUTOVER_COMMIT_APPROVED=true`;
6. ejecutar S1, finanzas y post-migration.

**VENTANA FUTURA — dry-run:**

```bash
psql "$CUTOVER_DIRECT_URL" \
  --set=BOOTSTRAP_ORGANIZATION_ID="$BOOTSTRAP_ORGANIZATION_ID" \
  --set=BOOTSTRAP_ORGANIZATION_NAME="$BOOTSTRAP_ORGANIZATION_NAME" \
  --set=CUTOVER_COMMIT_APPROVED=false \
  --file=docs/release/multitenancy-bootstrap-backfill.sql
```

Repetir con `true` solo tras GO del segundo verificador. Las variables se suministran en el entorno seguro del operador, nunca se guardan en Git.

### E. Backend primero

1. desplegar manualmente en el servicio existente el commit exacto;
2. no cambiar repo, branch, root, Dockerfile, dominio, plan ni secretos;
3. reanudar `pravia-api` todavía bajo ventana controlada;
4. validar `/health`, `/api/health`, DB, schema, Storage y logs;
5. ejecutar auth/session, tenant y documento smoke;
6. no desplegar frontend si falla cualquier prueba.

### F. Frontend después

Solo cuando backend+DB+auth+documentos están verdes:

1. desplegar manualmente el mismo commit en el site existente `pravianetwork`;
2. conservar repo, branch, base, build, publish, dominio, redirects, headers y variables;
3. mantener Auto-Publish detenido;
4. ejecutar el checklist completo;
5. tomar S2 y reconciliar.

### G. Unfreeze

Reabrir tráfico/escrituras únicamente si: migration state CLEAN, DB PASS, auth PASS, frontend PASS, documentos PASS, Storage PASS, finanzas exactas, orphan/cross-tenant 0, índices PASS, PRAVIA IA PASS y smoke completo PASS.

## 11. Matriz de compatibilidad

| Frontend | Backend | DB | Estado |
|---|---|---|---|
| OLD | OLD | OLD | Producción actual, compatible |
| OLD | OLD | NEW | Solo freeze; esquema aditivo puede arrancar, pero el backend viejo no aplica autoridad tenant |
| OLD | NEW | OLD | Prohibido; faltan Organization, Membership y tablas/columnas requeridas |
| NEW | OLD | OLD/NEW | Prohibido; contratos persistentes/tenant no están garantizados |
| OLD | NEW | NEW | Transición controlada para health/auth/documentos antes del frontend; no tráfico general |
| NEW | NEW | NEW | Objetivo final |

La DB se migra primero, después backend, por último frontend. Nunca frontend nuevo sobre backend viejo ni backend nuevo sobre DB vieja.

## 12. Rollback

### Criterios de aborto

Abortar ante backup/restore FAIL, historia/checksum inesperado, migración fallida, huérfanos, relación cross-tenant, diferencia financiera, Organization/Membership incorrecta, auth fallida, documento inaccesible, Storage inconsistente, health/5xx sostenidos o incompatibilidad frontend.

### Base de datos

- Antes de migrar: basta mantener OLD/OLD/OLD y descongelar tras confirmar S0.
- Después de migraciones pero antes del backfill: mantener freeze. No hacer DROP ni editar metadata; restaurar el backup hacia un destino limpio si se abandona el release.
- Backfill dry-run: ROLLBACK transaccional automático.
- Después del backfill commit y antes de unfreeze: la estrategia principal es restore completo del backup a un destino limpio y reconexión controlada; no eliminar columnas/tablas.
- Después de escrituras nuevas: no restaurar ciegamente encima de producción. Mantener freeze, preservar evidencia, decidir restore a base nueva y reconciliar/reproducir únicamente operaciones auditadas. El smoke debe minimizar escrituras para acotar esta ventana.

El restore no borra Storage; objetos de smoke quedan en cuarentena hasta reconciliarlos. El compensation worker no se activa durante rollback.

### Backend / Render

Registrar antes de la ventana deploy ID y commit N-1 (`b4200cd` era el live observado, pero debe recapturarse). El backend N-1 solo puede reabrirse si DB se restauró a S0 o se demuestra compatibilidad y autoridad de seguridad; como N-1 no es tenant-aware, la opción segura ante fallo del backend nuevo es mantener freeze y restaurar DB+backend anterior. Nunca cambiar de servicio.

### Frontend / Netlify

Registrar deploy ID y commit anterior. Si solo falla frontend, restaurar el deploy anterior en el mismo site mientras se mantiene backend nuevo + DB nueva; repetir auth, rutas y PWA. No modificar datos para hacer pasar la UI.

## 13. Observabilidad

Durante deploy y a +5, +15, +30 y +60 minutos observar:

- `/health` y `/api/health`;
- HTTP 5xx y latencia;
- errores Prisma, pool/conexiones y migration mismatch;
- login, refresh y `TENANT_CONTEXT_REQUIRED`;
- denegaciones/filtraciones IDOR;
- signed URL/Storage failures;
- outbox y compensation jobs;
- Assistant provider, timeout, transcripción y AIUsage;
- diferencias en S2/finanzas/documentos.

No registrar tokens, payloads legales, keys, contraseñas ni URLs con credenciales.

## 14. Evidencia y responsables

Usar `docs/release/checklists/production-cutover-audit-record.md`. El cierre requiere timestamps, operadores, commit, checksum/tamaño/ubicación redactada del backup, migration state before/after, Organization/Memberships, S0/S1/S2, reconciliación financiera, deploy IDs, smokes y hora de unfreeze.

## 15. Decisiones humanas pendientes

1. aceptar o remediar 26 documentos oficiales y 2 adjuntos financieros preexistentes sin archivo resoluble;
2. aprobar nombre/UUID bootstrap y lista legal de Memberships;
3. aprobar operadores y ventana;
4. autorizar el push futuro del commit objetivo; remoto `main` sigue en `b4200cd`.

El único cambio funcional posterior al rehearsal es la corrección del routing canónico de PRAVIA IA: Assistant `gpt-5.4-mini`, documentos `gpt-5.4-nano`, escalamiento `gpt-5.4-mini` y transcripción `gpt-4o-mini-transcribe`. La clasificación individual y los smokes constan en `checklists/production-cutover-technical-blocker-closure-20260817.md`. La discrepancia documental no fue causada por el rehearsal: producción, restore pre y restore post conservan metadata idéntica y `BLOBS LOST BY MIGRATION = 0`.
