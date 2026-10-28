# PLATFORM_ARCHITECTURE_GAP_MATRIX

Fecha de corte: 2026-10-19
Base auditada: `b24534ec1ec1505944c7b720e0cf03647e28c005`
Estado: **implementación local en curso; no certificado para producción**

## Decisiones vinculantes

- `Organization` continúa siendo la identidad canónica del tenant. No se crea una entidad paralela `Tenant`.
- `User` continúa siendo identidad global y `OrganizationMembership` conserva el rol efectivo dentro de una organización.
- `DIRECCION` y `ADMINISTRACION` son roles tenant; no confieren administración de plataforma.
- El data plane notarial existente se conserva. El control plane nuevo lo gobierna mediante servicios explícitos y nunca consulta ni expone contenido jurídico para facturación o soporte.
- El backend continúa siendo la única puerta de acceso a Prisma, Storage y proveedores de IA. El frontend no recibe credenciales ni selecciona `organization_id`.
- Los modelos tenant-owned nuevos tendrán defensa en profundidad: ActorContext/middleware, autorización de servicio, FKs compuestas cuando corresponda y RLS PostgreSQL.
- No habrá deduplicación física cross-tenant, precios hardcodeados, gasto de IA sin reserva, ni operaciones largas en requests HTTP.
- La primera implementación usa un único shard compartido y un único proveedor primario, pero todas las decisiones de ubicación, precio, costo, jobs y routing quedan versionadas y reemplazables.
- La base incluida es **50 GiB por organización**. La promoción inicial de IA es **$3,000.00 MXN por organización**, acreditada una sola vez mediante ledger idempotente. Ningún otro precio comercial se inventa.

## Matriz

| CAPABILITY | EXISTING_MODEL | EXISTING_SERVICE | REUSABLE | NEEDS_GENERALIZATION | NEEDS_NEW_MODEL | MIGRATION_REQUIRED | RISK | ACTION | TEST |
|---|---|---|---|---|---|---|---|---|---|
| Tenant identity | `Organization`, `OrganizationMembership`, `User`, `AuthSession` | `ActorContext`, auth/session resolution | Sí, completo | No | No | No | Crear una identidad tenant paralela rompería ownership | Reutilizar `Organization` en todo el control plane | Contrato unitario + integración PostgreSQL + tenant negativo + idempotencia |
| Tenant isolation | `organization_id` en data plane | `tenantIsolationMiddleware`, object scopes | Sí | Añadir modelos nuevos al registro; fijar contexto SQL para RLS | No | Sí, políticas RLS nuevas | Middleware solo no protege SQL fuera de Prisma | Aplicar cuatro capas y pruebas cross-tenant | Contrato unitario + integración PostgreSQL + tenant negativo + idempotencia |
| Platform administration | Ninguno separado | Sólo operaciones internas `platformOperation` | Parcial, sólo mecanismo técnico | Separar identidad humana, grants y break-glass | `PlatformAdministrator`, `PlatformAccessGrant`, `PlatformAuditEvent` | Sí | Convertir un rol tenant en superadmin o acceso invisible | Consola mínima, grants expiran, auditoría obligatoria | Contrato unitario + integración PostgreSQL + tenant negativo + idempotencia |
| Tenant placement / shards | Config runtime de una DB | `buildPrismaDatasourceUrl` | Parcial | Resolver placement por Organization y caché invalidable | `PlatformShard`, `TenantPlacement` | Sí | Enrutamiento accidental a otro shard | Registrar un shard compartido y placement para cada org; no activar multi-shard físico | Contrato unitario + integración PostgreSQL + tenant negativo + idempotencia |
| Storage provider abstraction | `Documento.storage_key` | `StorageProvider`, cloud/local providers | Sí | Añadir metadata/head, copy, list/reconcile, multipart/resumable capability | `StorageProviderRecord` | Sí | Crear un storage paralelo o exponer proveedor | Extender interfaz y adaptadores manteniendo API existente | Contrato unitario + integración PostgreSQL + tenant negativo + idempotencia |
| Logical blobs and references | `Documento`, vínculos documentales | Servicios documentales por módulo | Parcial | Separar identidad lógica, localización física y referencias | `StorageBlob`, `StorageBlobLocation`, `StorageBlobReference` | Sí | Duplicar blobs o compartir contenido cross-tenant | Backfill no destructivo; checksum tenant-scoped; `Documento` sigue autoridad funcional | Contrato unitario + integración PostgreSQL + tenant negativo + idempotencia |
| Storage quota | `Documento.size_bytes` | Ninguno canónico | Sólo fuente parcial | Contabilización transaccional y archivos no representados | `TenantStorageUsage`, `StorageReservation`, `StorageLedgerEvent` | Sí | Race conditions, sobreasignación, negativos | Reserve/commit/release idempotente; 50 GiB incluido | Contrato unitario + integración PostgreSQL + tenant negativo + idempotencia |
| Storage reconciliation | Ninguno | `exists`, scripts puntuales | Parcial | Inventario por prefijo/provider, drift y repair controlado | `StorageReconciliationRun`, `StorageReconciliationItem` | Sí | Borrado o corrección destructiva | Detectar primero; reparación separada y auditable | Contrato unitario + integración PostgreSQL + tenant negativo + idempotencia |
| Storage add-ons | Ninguno | Ninguno | No | N/A | `StorageAddonVersion`, `TenantStorageAddon` | Sí | Precios inventados, downgrade con datos activos | Versionar capacidad/precio nullable hasta configuración; downgrade seguro | Contrato unitario + integración PostgreSQL + tenant negativo + idempotencia |
| Tenant entitlements | Permisos RBAC, no comerciales | `permissions.ts` | RBAC sí, entitlement no | Componer plan/add-on/override sin reemplazar RBAC | `TenantEntitlement` | Sí | Mezclar autorización jurídica con suscripción | Servicio de entitlement separado y efectivo por vigencia | Contrato unitario + integración PostgreSQL + tenant negativo + idempotencia |
| Plans/subscriptions | Ninguno | Ninguno | No | N/A | `PlanVersion`, `TenantSubscription` | Sí | Cambiar contratos históricos o cobrar sin precio | Versionar; precio nullable = configuración comercial pendiente | Contrato unitario + integración PostgreSQL + tenant negativo + idempotencia |
| Commercial pricing | Ninguno | Ninguno | No | N/A | `CommercialSkuVersion`, `PricingOverride` | Sí | Hardcode, retroactividad | Montos minor units, moneda, vigencias, snapshots | Contrato unitario + integración PostgreSQL + tenant negativo + idempotencia |
| Internal costs | `AIUsageLog.cost_usd` parcial | `aiUsage.service` | Telemetría parcial | Costos versionados por proveedor/modelo/operación | `ResourceCostVersion`, `TenantCostSnapshot` | Sí | Confundir costo interno con precio cliente | Mantener costo y venta separados | Contrato unitario + integración PostgreSQL + tenant negativo + idempotencia |
| AI operation catalog | Strings distribuidos | Servicios IA por dominio | Parcial | Un catálogo estable por operación, modalidad y riesgo | `AiOperationCatalog` | Sí | Cambiar semántica jurídica existente | Registrar operaciones actuales sin alterar prompts ni decisiones | Contrato unitario + integración PostgreSQL + tenant negativo + idempotencia |
| AI model registry and routing | Env vars/model strings | Llamadas directas OpenAI/Anthropic | Adaptadores conceptuales parciales | Gateway único, policy versionada, health/circuit breaker | `AiModelRegistry`, `AiRoutingPolicyVersion` | Sí | Spend sin límite, fallback semánticamente distinto | Migración incremental de call sites al gateway | Contrato unitario + integración PostgreSQL + tenant negativo + idempotencia |
| AI wallet | Ninguno | `AIUsageLog` sólo usage | No | N/A | `AiWallet`, `AiWalletTransaction`, `AiBalanceReservation` | Sí | Doble débito, saldo negativo, retry cobrado dos veces | Ledger inmutable + reserve/commit/release + idempotency | Contrato unitario + integración PostgreSQL + tenant negativo + idempotencia |
| AI promotional credit | Ninguno | Ninguno | No | N/A | Se implementa en wallet transaction | Sí | Doble acreditación | Clave única por Organization; acreditar 300000 MXN minor una vez | Contrato unitario + integración PostgreSQL + tenant negativo + idempotencia |
| AI usage commercial event | `AIUsageLog` | `recordAIUsage*` | Sí como evidencia técnica | Correlacionar reserva, precio snapshot, costo y operación | `AiUsageEvent` | Sí | Dos ledgers divergentes | `AIUsageLog` permanece telemetría; evento comercial referencia operación | Contrato unitario + integración PostgreSQL + tenant negativo + idempotencia |
| Usage/cost snapshots | Reportes de dominio | Ninguno de plataforma | Parcial | Agregación por tenant/día/recurso | `UsageEvent`, `TenantCostSnapshot` | Sí | Escanear tablas jurídicas para facturación | Emitir eventos desde servicios de infraestructura | Contrato unitario + integración PostgreSQL + tenant negativo + idempotencia |
| Billing abstraction | CFDI del negocio notarial | Finanzas/CFDI del data plane | No reutilizable para SaaS | Separar facturación de plataforma | `BillingCycle`, `BillingEvent`, `BillingProviderAccount` | Sí | Mezclar dinero del expediente con cobro SaaS | Provider interface sin activar cobro real | Contrato unitario + integración PostgreSQL + tenant negativo + idempotencia |
| Tenant consumption panel | Ninguno | Endpoints/reportes de dominio | Parcial UI shell | Read model de suscripción, storage, IA y alertas | Sin tabla adicional inicial | No adicional | Fuga de costos internos o datos de otro tenant | Endpoints tenant-scoped + componentes compartidos | Contrato unitario + integración PostgreSQL + tenant negativo + idempotencia |
| Usage alerts | Notificaciones operativas | Notification service | Parcial | Alert state/dedupe por recurso y umbral | `UsageAlertState` | Sí | Spam o alertas cruzadas | Umbrales configurables; notificación idempotente | Contrato unitario + integración PostgreSQL + tenant negativo + idempotencia |
| Safe downgrade | Ninguno | Ninguno | No | N/A | Estado en subscription/add-on | Sí | Pérdida de archivos | Bloquear downgrade bajo uso; nunca borrar automáticamente | Contrato unitario + integración PostgreSQL + tenant negativo + idempotencia |
| Background jobs | `DomainEventOutbox`, `StorageCompensationJob` | Workers especializados | Patrón reusable | Cola genérica con lease, attempts, heartbeat, fairness | `BackgroundJob` | Sí | Starvation, doble ejecución, jobs zombis | Scheduler local/worker; Organization en payload autoritativo DB | Contrato unitario + integración PostgreSQL + tenant negativo + idempotencia |
| Migration engine | Ninguno | Importaciones puntuales de catálogos | No | N/A | `MigrationJob`, `MigrationAsset`, `MigrationMapping`, `MigrationConflict` | Sí | Importación parcial, mezcla de tenants, pérdida de trazabilidad | Upload resumable, analysis, mapping, dry-run, execute, verify | Contrato unitario + integración PostgreSQL + tenant negativo + idempotencia |
| Large/resumable uploads | Multer en memoria hasta 50 MiB | upload policy y Storage | Parcial para documentos | Sessions/chunks/checksum para migración | `ResumableUploadSession`, `ResumableUploadPart` | Sí | RAM/timeout/corrupción | Sólo control plane y local QA inicialmente | Contrato unitario + integración PostgreSQL + tenant negativo + idempotencia |
| Deduplication | Checksums puntuales | Servicios documentales | Parcial | Dedup únicamente dentro del tenant y contexto permitido | Índices en `StorageBlob` | Sí | Fuga por hash cross-tenant | Unique tenant + checksum + size; nunca global | Contrato unitario + integración PostgreSQL + tenant negativo + idempotencia |
| Export jobs | Respuestas síncronas puntuales | Servicios por módulo | Parcial | Export asíncrono, manifest, expiry y autorización | `ExportJob`, `ExportArtifact` | Sí | Export incompleto o acceso después de revocación | Snapshot tenant, signed download, expiry, audit | Contrato unitario + integración PostgreSQL + tenant negativo + idempotencia |
| Backup operations | Scripts `db-backup`/restore | Scripts de release | Sí como mecanismo | Registrar run, scope, checksum, retención y restauración | `BackupRun`, `RestoreDrill` | Sí | Declarar backup sin probar restore | Local QA: backup + restore drill registrado; provider externo preparado | Contrato unitario + integración PostgreSQL + tenant negativo + idempotencia |
| Observability | Logs, health, AuditLog | Logger/health existentes | Parcial | Métricas por job/provider/shard/tenant sin PII | `PlatformMetricEvent` o backend de métricas | Sí si se persiste | PII o contenido jurídico en telemetría | Metadata mínima, correlation IDs y redacción | Contrato unitario + integración PostgreSQL + tenant negativo + idempotencia |
| Audit | `AuditLog` tenant | audit services | Sí para data plane | Eventos de plataforma y acciones cross-tenant explícitas | `PlatformAuditEvent` | Sí | Acciones de soporte no trazables | No contenido jurídico; before/after metadata mínima | Contrato unitario + integración PostgreSQL + tenant negativo + idempotencia |
| Tenant support impersonation | Ninguno | `platformOperation` interno | No para humanos | Grants expiran, reason/ticket, read-only default | `PlatformAccessGrant` | Sí | Acceso indiscriminado | Break-glass explícito, MFA-ready, auditoría y revocación | Contrato unitario + integración PostgreSQL + tenant negativo + idempotencia |
| Existing 50 MiB upload limit | `Documento.size_bytes` | `uploadLimits`, `/upload-policy` | Sí | No forma parte de cuota de 50 GiB; son límites distintos | No | No | Confundir tamaño por archivo con capacidad tenant | Mantener 50 MiB por archivo y contabilizarlo en quota | Contrato unitario + integración PostgreSQL + tenant negativo + idempotencia |
| Existing domain regression | Todo data plane | Suites backend/frontend/E2E | Sí | Añadir harness local aislado | No | No | Control plane rompe contratos notariales | Gates completos antes de considerar release | Contrato unitario + integración PostgreSQL + tenant negativo + idempotencia |

## Clasificación de componentes existentes

### REUSE

- `Organization`, `OrganizationMembership`, `User`, `AuthSession`.
- `ActorContext`, permisos canónicos, scopes de objeto y `tenantIsolationMiddleware`.
- `StorageProvider` y adaptadores cloud/local.
- `Documento` y relaciones documentales como autoridad funcional del data plane.
- `AIUsageLog` como telemetría técnica de llamadas reales.
- `DomainEventOutbox` y workers existentes como patrones, no como cola genérica improvisada.
- `AuditLog` para acciones tenant dentro del data plane.
- Scripts de backup/restore como ejecutores de bajo nivel.

### EXTEND / GENERALIZE

- Storage: capabilities, blobs lógicos, locations, reservations, ledger y reconciliation.
- Prisma tenant enforcement: registrar modelos nuevos y fijar el contexto de RLS por transacción/request.
- IA: envolver proveedores con gateway, routing, reserva y liquidación sin alterar reglas jurídicas.
- Notificaciones: alertas de consumo idempotentes.
- Jobs: leases, retries, heartbeat, cancelación y fairness.
- Backup/restore: convertir ejecuciones en runs verificables.

### NEW CONTROL-PLANE MODELS

- Placement/shards, plataforma/admin grants/audit.
- Planes, suscripciones, entitlements, add-ons, pricing, costs y billing events.
- Storage logical/usage/reservation/ledger/reconciliation.
- AI wallet/catalog/model/routing/usage commercial.
- Jobs, migration assets/mappings/conflicts, resumable uploads, exports.
- Backup runs, restore drills, alerts, usage/cost snapshots.

### LEGACY READ-ONLY / COMPATIBILITY

- Paths históricos de Storage: legibles y atribuibles por metadata; no se renombran masivamente.
- `User.rol`: sólo compatibilidad/bootstrap; no autoridad operacional.
- `AIUsageLog`: se conserva; no se reescribe como wallet.
- `StorageCompensationJob`: conserva su finalidad especializada.
- Finanzas/CFDI del expediente: no se reutiliza como billing SaaS.

## Riesgos que bloquean una activación productiva

1. No existe todavía un precio mensual comercial aprobado; debe permanecer `NULL`/pendiente, nunca inventarse.
2. La promoción IA y el almacenamiento incluido requieren backfill idempotente probado en copia local restaurada.
3. RLS existente es parcial; toda tabla tenant nueva debe nacer con RLS, y el runtime debe fijar contexto SQL sin confiar en headers.
4. Las llamadas directas a proveedores de IA deben migrarse gradualmente; ninguna puede debitase dos veces ni quedar fuera del gateway al certificar.
5. El upload documental de 50 MiB y la cuota tenant de 50 GiB son controles diferentes y deben probarse por separado.
6. Multi-shard, archive automático, multi-provider y multi-region quedan preparados, no activados, hasta tener operación y restore drills certificados.
7. El backfill de `Documento` registra blob, ubicación y referencia sin afirmar un SHA físico verificado. Cada ubicación queda `LEGACY_UNVERIFIED`. La lectura física inicial encontró 57 legibles y 26 con respuesta `OBJECT_NOT_FOUND`. La revalidación read-only directa de NOTARYPROY del 28-10-2026 confirmó 26/26 asociaciones y tenants, pero 0/26 objetos físicos en ambos buckets y listados de metadata. Véanse la [evidencia individual](./LEGACY_STORAGE_PHYSICAL_VERIFICATION.md) y la [auditoría actual](../release/2026-10-28/NOTARYPROY_READONLY_AUDIT.md). La integridad relacional no certifica los bytes originales ni habilita el release.
8. El importador ya separa almacenamiento temporal, carga reanudable por partes, checksum, inspección streaming de CSV/ZIP, mapeo aprobado, ejecución asíncrona por lotes, procedencia, verificación y manifiesto para Comparecientes CSV y paquetes ZIP PRAVIA v1 (Comparecientes, documentos y vínculo documento–compareciente). XLSX y RAR sólo se inventarían para revisión y **no se aprueban ni importan automáticamente**; lo mismo ocurre con ZIP que no cumplen el contrato PRAVIA v1. Fuera de certificación siguen la ejecución de las demás entidades/relaciones y el análisis XLSX/RAR mayor de 50 MiB; no se promete importación universal ni de 500 GB.
9. La exportación asíncrona ya incluye datos estructurados tenant-scoped paginados en lotes de 200, relaciones, documentos originales, manifiesto con SHA, verificación física del ZIP, descarga firmada, recibo de egress idempotente incluso bajo concurrencia, expiración y revocación. El caso local EXP19 exportó un documento no compresible de 51 MiB y verificó un ZIP también mayor de 50 MiB; la verificación de entradas ahora lee rangos y calcula hashes en streaming. Permanecen pendientes el recibo automático de egress del proveedor real y la certificación caso por caso de toda la matriz contractual 20/20.
10. Existe un único adaptador de red para OpenAI y cero llamadas directas desde frontend. Las once operaciones externas activas (`ASSISTANT_CHAT`, `ASSISTANT_TRANSCRIPTION`, `QUOTE_EMAIL_DRAFT`, `PROSPECT_DOCUMENT_REVIEW`, `COMPLIANCE_ASSISTED_REVIEW`, `PROJECT_LITERAL_PATCH_PLAN`, `OPERATIONAL_ARTIFACT_DRAFT`, `DOCUMENT_STRUCTURED_EXTRACTION`, `PROJECT_LEGAL_REVIEW`, `PROPERTY_DOCUMENT_EXTRACTION`, `FINANCIAL_DOCUMENT_EXTRACTION`) ya pasan por `AiGateway`/wallet. El probe no productivo heredado fue sustituido por una comprobación local que no contacta al proveedor; bypasses externos activos: 0. La clasificación comercial de todas las operaciones ya fue aprobada e inventariada; los precios concretos siguen pendientes de configuración versionada. El núcleo valida clase explícita, job tenant-scoped para migración, reserva/liquidación de wallet, contabilización de incluidos, precio fijo o markup versionado y piso 2×. Los adaptadores de Responses y transcripción fallan cerrado si faltan costos versionados/FX o unidades facturables antes de liquidar; los retries HTTP/incompletos quedan dentro de una sola ejecución económica. La matriz local AIG queda en 25/25, pero la certificación productiva permanece bloqueada hasta configurar catálogos reales y repetir E2E contra proveedor en un entorno autorizado.
11. Billing y backup tienen adaptadores locales aislados con pruebas reales de ciclo, firma, idempotencia, copia, restore y SHA. El 28-10-2026 se respaldaron y verificaron 249/249 objetos actualmente accesibles y se restauró el dump read-only de NOTARYPROY; la copia comparte host/disco y no es un dominio de falla independiente. No se han configurado ni verificado proveedor comercial de billing ni proveedor externo/independiente de backup; por contrato, esta última ausencia mantiene `READY FOR CLIENT USE: NO`.
12. El control plane de Super Admin tiene autorización y auditoría backend y una vista operativa local de metadatos para jobs, migraciones, exportaciones, almacenamiento temporal, costos IA, backups y webhooks. Aún no existe aprovisionamiento productivo de identidad plataforma ni una consola operativa completa certificada para producción.

## Gate de salida de esta fase de auditoría

La matriz autoriza únicamente una migración **expand**, aditiva, reversible por desactivación funcional y ejecutada primero sobre PostgreSQL local aislado. No autoriza commit, push, deploy ni escrituras productivas.

## Validación local al 2026-10-18

### Formatos y entidades de migración realmente ejecutables

| Fuente | Análisis/inventario | Importación automática aprobable | Límite o tratamiento |
|---|---|---|---|
| CSV | Probado en PostgreSQL con 205 filas y campos desconocidos | Sí, sólo `COMPARECIENTE` con mapeo humano | Carga por partes; no equivale a migrar otras entidades |
| XLSX | Probado: hoja, encabezados y filas | No | `REQUIRES_SOURCE_FORMAT_REVIEW`; archivo conservado para revisión |
| ZIP | Probado con streaming, manifiesto y SHA | Sólo paquete `PRAVIA_MIGRATION_PACKAGE` v1 | El paquete v1 admite Compareciente, documento original y relación documento–compareciente; otros ZIP quedan en revisión |
| RAR | Parser documental acotado existente; inventario de migración disponible | No | Análisis en memoria limitado a 50 MiB; falta fixture RAR positivo de certificación de migración |

En un ZIP v1 son candidatos a preservar como bytes originales PDF, DOCX, DOC legacy, PNG, JPG/JPEG, XML y TXT si pasan el validador MIME canónico. Esto **no** afirma extracción semántica de DOC legacy ni ejecución de datos jurídicos desde esos formatos. Las entidades Expediente, Predio, Acto, Archivo, Prospecto, Cotización, Finanzas y Seguimiento siguen en `REQUIRES_REVIEW` para migración estructurada desde software ajeno: no existe todavía un mapping/ejecutor general probado para ellas. La exportación tenant-scoped cubre modelos adicionales, pero exportar no demuestra poder reimportarlos.

- Migración expand ejecutada en `pravia_control_plane_backfill_20261017`, copia PostgreSQL local aislada: 83 documentos históricos, 83 blobs sin SHA físico afirmado, 83 ubicaciones `LEGACY_UNVERIFIED`, 83 referencias; bytes de cuota iguales a bytes documentales; cero huérfanos o cruces de organización.
- Integración física del control plane: 30/30 tests PASS, incluyendo migración de 205 filas por lotes, paquete versionado con documentos y relaciones, inventario XLSX sin falsa aprobación ejecutable, exportación paginada de 205 filas, documento original y ZIP no compresible mayor de 50 MiB, aislamiento cross-tenant, idempotencia concurrente de jobs/egress, clases IA, markup dinámico, override auditado, tarifa/FX versionados del adaptador OpenAI y fallo del proveedor sin débito sobre PostgreSQL, workers con recuperación de lease, billing local y backup/restore local. Estos 30 tests físicos **no equivalen** a la certificación individual MGS01–MGS30. Backfill relacional reproducible: 1/1 PASS; verificación de originales: FAIL (57/83 legibles, 26 faltantes en el bucket configurado).
- Matriz local AI Gateway: 25/25 PASS LOCAL, documentada en `AI_GATEWAY_CERTIFICATION_MATRIX_20261017.md`. No sustituye la configuración productiva de catálogos ni el E2E autorizado contra proveedor real.
- Regresión completa del 2026-10-19: backend 198 archivos, 2.252 tests PASS; frontend 56 archivos, 478 tests PASS.
- Chrome local aislado: migración con backup/restauración local y ejecución verificada, exportación con autenticación/descarga/manifiesto, y vista operativa de plataforma: 3/3 PASS. El caso adicional de usuario autenticado sin permiso de exportación devolvió 403 para lectura y gestión y pasó en un rerun específico 1/1. La certificación contra proveedores externos permanece pendiente.
- Certificación caso por caso documentada en [CONTROL_PLANE_CERTIFICATION_CASES_20261018.md](./CONTROL_PLANE_CERTIFICATION_CASES_20261018.md): migración 28 PASS/2 NOT VERIFIED, exportación 19 PASS/1 NOT VERIFIED. Los 30 tests físicos PostgreSQL no sustituyen esas matrices.
- Prisma validate/generate, backend build, frontend build y `git diff --check`: PASS.
- No hay commit, push, deploy ni escrituras productivas. **El release sigue bloqueado** por los riesgos numerados arriba y por falta de certificación E2E completa del control plane.
