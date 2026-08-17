# Runbook de cutover multitenant

Estado: **PREPARED ONLY**. Este documento no autoriza ni ejecuta escrituras productivas.

## Parámetros que deben aprobarse en el cutover

- `BOOTSTRAP_ORGANIZATION_ID`: UUID nuevo y controlado.
- `BOOTSTRAP_ORGANIZATION_NAME`: nombre comercial aprobado de la organización propietaria actual.
- commit exacto de backend/frontend tenant-aware.
- backup verificado y fingerprints S0/S1.

Nunca inferir tenant desde Notaria, email, responsable, expediente o nombre.

## Secuencia ejecutable del cutover

Esta es la única secuencia autorizable; cada paso exige evidencia verde antes de continuar:

1. crear y verificar backup fuera del repositorio;
2. ejecutar prechecks y fingerprint S0;
3. activar mantenimiento y congelar todas las escrituras;
4. aplicar `20260817045000_create_multitenancy_foundation`;
5. crear la Organization bootstrap aprobada;
6. crear una Membership por cada User existente;
7. ejecutar el backfill explícito de ownership y sesiones;
8. validar cero huérfanos, relaciones cruzadas y sesiones incoherentes;
9. obtener S1 y reconciliar counts, IDs, relaciones y sumas contra S0;
10. desplegar el backend tenant-aware exacto, todavía sin tráfico general;
11. validar login, refresh, revocación y cambio de organización;
12. desplegar el frontend tenant-aware exacto;
13. ejecutar smoke funcional y de aislamiento A/B;
14. aplicar/habilitar conversaciones de Assistant y sus capacidades cuando formen parte del cutover, antes de permitir tráfico de PRAVIA IA; si el artefacto backend las requiere al arrancar, `20260817050000_create_assistant_conversations` se aplica después del paso 9 y antes del 10, sin alterar el resto del orden;
15. retirar mantenimiento y descongelar escrituras;
16. monitorizar health, auth, errores tenant, outbox, Storage y AI usage;
17. evaluar criterios de rollback durante toda la ventana y cerrar solo con S2 reconciliado.

## 1. Precheck read-only

1. Confirmar proyecto Supabase, servicio Render, site Netlify y HEAD autorizados.
2. Confirmar que no existen migraciones fallidas y que el schema activo es `pravia_os`.
3. Inventariar filas por cada tabla de la matriz y Storage privado.
4. Obtener fingerprint S0: conteos, sumas financieras, hashes de tablas críticas y lista de migrations.
5. Verificar espacio, conexiones, workers/crons, webhooks y ausencia de jobs largos.
6. Ejecutar tests, build, Prisma validate/generate y auditoría de FKs/índices sobre el artefacto exacto.

## 2. Backup

1. Crear dump lógico consistente, cifrado y fuera del repositorio.
2. Verificar checksum.
3. Restaurar el dump en PostgreSQL aislado.
4. Ejecutar conteos/fingerprints sobre la restauración.
5. Registrar ubicación, checksum, hora, operador y resultado sin incluir secretos.

No continuar sin `BACKUP VERIFIED`.

## 3. Freeze

1. Detener Auto-Deploy/Auto-Publish.
2. Suspender backend y workers o activar mantenimiento que impida toda escritura.
3. Confirmar cero requests mutadores, cero outbox en procesamiento y cero compensaciones activas.
4. Mantener health/diagnóstico read-only únicamente si no abre escrituras.

## 4. Etapa A: estructura aditiva

Aplicar en este orden:

1. `20260817045000_create_multitenancy_foundation`
2. `20260817050000_create_assistant_conversations` cuando también se autorice la fase de conversaciones.

La primera migración crea Organization/Membership, columnas nullable, FKs, índices y triggers. No crea organización bootstrap, no hace backfill y no añade `NOT NULL` a datos existentes.

## 5. Etapa B: bootstrap y backfill controlado

Ejecutar en una transacción explícita, sustituyendo parámetros aprobados. El siguiente bloque es una plantilla de revisión, no un script para ejecución automática:

```sql
BEGIN;

INSERT INTO pravia_os.organizations (id, name, status)
VALUES (:'BOOTSTRAP_ORGANIZATION_ID', :'BOOTSTRAP_ORGANIZATION_NAME', 'ACTIVE');

INSERT INTO pravia_os.organization_memberships
  (organization_id, user_id, rol, status)
SELECT :'BOOTSTRAP_ORGANIZATION_ID', id, rol, CASE WHEN activo THEN 'ACTIVE' ELSE 'SUSPENDED' END
FROM pravia_os.users
ON CONFLICT (organization_id, user_id) DO NOTHING;

-- Para cada tabla operativa enumerada por la migración:
-- UPDATE pravia_os.<tabla>
-- SET organization_id = :'BOOTSTRAP_ORGANIZATION_ID'
-- WHERE organization_id IS NULL;

UPDATE pravia_os.auth_sessions s
SET organization_id = :'BOOTSTRAP_ORGANIZATION_ID',
    membership_id = m.id
FROM pravia_os.organization_memberships m
WHERE m.user_id = s.user_id
  AND m.organization_id = :'BOOTSTRAP_ORGANIZATION_ID'
  AND (s.organization_id IS NULL OR s.membership_id IS NULL);

-- Las tablas de Assistant nacen con organization_id NOT NULL y no requieren backfill
-- cuando la migración se aplica antes de desplegar esa funcionalidad.

-- NO COMMIT hasta completar todas las validaciones del apartado 6.
```

La plantilla exacta, con lista explícita, validación de huérfanos y rollback por defecto, está en `docs/release/multitenancy-bootstrap-backfill.sql`. No se permiten globs, inferencias ni tablas fuera de la matriz. `CUTOVER_COMMIT_APPROVED` permanece falso hasta comparar fingerprints.

## 6. Validaciones dentro de la transacción

- 1 Organization bootstrap exacta.
- una Membership por cada User existente; cero duplicados `(organization_id,user_id)`.
- cero `organization_id IS NULL` en cada entidad tenant-owned con filas existentes.
- cero sesiones sin Membership/Organization y cero desacuerdos sesión↔Membership.
- cero relaciones padre/hijo con organizaciones distintas.
- cero referencias de usuario sin Membership en la organización del recurso.
- conteos por tabla idénticos a S0.
- sumas financieras, expedientes, comparecientes, documentos, ISR, UIF y auditoría idénticos a S0.
- rutas Storage sin modificación; documentos legacy accesibles por metadata tenant de DB.

Si todo pasa, obtener fingerprint S1 y `COMMIT`. Ante cualquier diferencia, `ROLLBACK` y mantener servicios congelados.

## 7. Etapas C/D: aplicación tenant-aware

1. Desplegar backend exacto con escritura y lectura tenant-aware, todavía sin tráfico general.
2. Ejecutar `/health` y `/api/health`.
3. Probar login single-membership y multi-membership controlado.
4. Ejecutar smoke de lectura/escritura en la Organization bootstrap.
5. Ejecutar harness ORG_A/ORG_B aislado en entorno de validación.
6. Reanudar workers; verificar que cada outbox event tenga organización y que cada handler procese bajo ella.
7. Desplegar frontend exacto y comprobar selector solo para usuarios multi-membership.
8. Reabrir tráfico.

## 8. Smoke obligatorio

- auth/me, refresh, logout y cambio de organización;
- users/invitations sin cruce;
- expediente, compareciente, documento firmado/preview/download;
- prospecto, cotización, notaría;
- agenda/tareas;
- finanzas, cartera, reportes y búsqueda global;
- ISR y UIF;
- PRAVIA IA: conversación, tool de lectura, adjunto oficial/temporal, acción PREPARE_ONLY y usage;
- ORG_A usando IDs reales de ORG_B: GET, PATCH, DELETE, relación, preview/download, export, search y aggregate deben negar u ocultar sin revelar existencia.

Obtener fingerprint S2 y compararlo con S0/S1, admitiendo solo los registros de smoke documentados.

## 9. Etapa E posterior

Solo después de un periodo estable y una nueva autorización:

1. revalidar cero huérfanos;
2. decidir tabla por tabla qué `organization_id` debe ser `NOT NULL`;
3. preparar una migración separada;
4. probar restore y rollback;
5. ejecutar otro cutover.

Antes de incorporar una segunda organización real, completar además la conversión de constraints marcada en `docs/architecture/multitenancy-unique-constraints.md` para claves de configuración financiera tenant-owned.

No convertir automáticamente identificadores operativos globales a unique por tenant. Esa decisión requiere migración y compatibilidad propias.

## Rollback criteria

Rollback inmediato ante: huérfanos, discrepancia de fingerprints, relación cross-tenant, login sin tenant, leak en búsqueda/agregado/Storage/IA, errores sostenidos de health, worker sin organización o fallo de migración.

- Fallo de foundation: mantener freeze. Como el DDL puede haber quedado parcialmente aplicado, no asumir rollback automático ni intentar `DROP organization_id`; inspeccionar el estado y restaurar el backup verificado hacia una instancia limpia/freeze point antes de reintentar.
- Fallo de backfill: `ROLLBACK` de su transacción explícita. La Organization, Memberships y updates del bloque se revierten juntos.
- Fallo de validación/fingerprint antes de commit: `ROLLBACK`, conservar S0 y no desplegar. Si la discrepancia se detecta después del commit, mantener freeze y restaurar el backup verificado.
- Fallo de smoke backend: no desplegar frontend ni abrir tráfico. Revertir el artefacto backend al commit previo solo tras confirmar compatibilidad con la estructura aditiva; ante cualquier duda, restaurar el freeze point.
- Fallo de smoke frontend: mantener backend tenant-aware y escrituras congeladas, restaurar el deploy frontend anterior y repetir auth/tenant smoke; no alterar datos para hacer pasar la UI.
- Fallo de Assistant: mantener esa capacidad deshabilitada/sin tráfico, sin deshacer datos operativos; restaurar desde backup si su migración produjo discrepancias.
- Si hubo corrupción, pérdida o tenant leakage en cualquier etapa: mantener freeze y restaurar el backup verificado. No improvisar updates manuales.

Registrar siempre hora, responsable, commit, migration IDs, fingerprints y decisión final. Nunca registrar secretos o tokens.
