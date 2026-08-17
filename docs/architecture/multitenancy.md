# Multitenencia canónica de PRAVIA OS

## Decisión

`Organization` es la frontera canónica de seguridad y propiedad. Una organización representa al cliente de la plataforma (despacho, grupo o notaría cliente); `Notaria` continúa siendo una entidad operativa del portafolio y pertenece a una organización. No existe equivalencia `Organization == Notaria`.

`User` es una identidad global. `OrganizationMembership` vincula esa identidad con una organización y contiene su rol efectivo. El enum y las plantillas de permisos existentes se conservan; no se creó un segundo RBAC. La separación es:

- Membership: en qué organización actúa la persona.
- RBAC y object scope: qué puede hacer dentro de esa organización.
- `GLOBAL`: visibilidad global dentro de la organización activa, nunca de toda la plataforma.

`User.rol` se conserva temporalmente como dato bootstrap/compatibilidad de identidad, pero no es autoridad operacional. Catálogos, asignaciones, sesión y autorización resuelven siempre `OrganizationMembership.rol` de la organización activa. Los seeds exigen tanto actor como Organization explícitos; no seleccionan la primera Membership.

Los usuarios actuales no son administradores de plataforma. `DIRECCION` y `ADMINISTRACION` siguen siendo roles organizacionales. Un eventual `PlatformAdmin` deberá ser un concepto explícito y separado.

## Sesión y ActorContext

`AuthSession` conserva `organization_id` y `membership_id`. El access token identifica la organización de la sesión, pero el backend vuelve a comprobarla contra sesión, Membership, usuario y estado de Organization. Un request sin Membership activa o con desacuerdo entre JWT y sesión falla cerrado.

El único contexto transversal es `ActorContext`:

```text
userId, organizationId, membershipId, role, permissions, scope, sessionId
```

No se acepta `organizationId` de headers, argumentos de tools, cuerpos de negocio ni del modelo de IA. El único input permitido es el selector del endpoint de cambio de organización; el backend lo resuelve contra Memberships activas del mismo usuario y actualiza la sesión.

Las operaciones internas privilegiadas están nombradas y acotadas: resolución de identidad/autenticación, health checks, reclamación del outbox y compensación de Storage. El procesamiento de cada evento del outbox vuelve a entrar a un contexto de sistema limitado a la organización del propio evento.

## Enforcement de datos

El cliente Prisma canónico registra un middleware único que:

1. exige ActorContext para modelos tenant-owned;
2. añade `organization_id = actor.organizationId` antes de lecturas, búsquedas, updates, deletes, counts, groups y aggregates;
3. escribe `organization_id` desde la sesión en creates/upserts/createMany;
4. rechaza intentos de cambiar o suplantar `organization_id`;
5. limita `User` mediante Membership y limita Membership/Organization a la organización activa.

Por eso los controllers, servicios, reportes, búsqueda global y Assistant Tools existentes reutilizan la misma frontera sin crear repositories paralelos. El object scope (`ASSIGNED_OBJECTS`) se combina después del tenant scope.

La migración añade triggers PostgreSQL para relaciones entre recursos tenant-owned. Esos triggers solo validan: nunca infieren, completan ni corrigen `organization_id`. El ActorContext o el backfill explícito asignan el ownership, y cualquier relación con un padre de otra organización se rechaza. Las referencias a usuarios operativos exigen Membership en la misma organización.

Las columnas son nullable durante la etapa aditiva para preservar la instalación actual. No existe fallback productivo a la primera organización, a una notaría ni a un tenant por defecto. La única fixture por defecto vive en tests.

## Storage y documentos

Los archivos nuevos usan prefijos privados:

```text
organizations/{organizationId}/documentos/...
organizations/{organizationId}/temporales/...
organizations/{organizationId}/finanzas/...
organizations/{organizationId}/isr/...
```

Los paths históricos siguen siendo legibles; no se renombran ni se mueven en esta fase. Las URLs firmadas se emiten solo después de obtener el registro documental con tenant scope y aplicar RBAC/object scope. La compensación valida organización, propietario, tipo temporal, prefijo exacto y ausencia de referencias oficiales antes de borrar. No hay deduplicación física cross-tenant.

## PRAVIA IA

Conversaciones, mensajes, adjuntos y `AIUsageLog` tienen organización. Las conversaciones exigen simultáneamente organización y propietario. Un documento oficial se resuelve primero mediante el control documental existente y el mismo Prisma tenant-scoped.

Las Assistant Tools reciben el usuario derivado de ActorContext y solo reciben IDs de negocio del modelo. Las lecturas reutilizan las consultas y scopes existentes. Las acciones sensibles continúan en `PREPARE_ONLY`, con confirmación humana, permiso y auditoría. El modelo no puede elegir organización.

El ledger canónico de IA se extendió con `organization_id`, conversación y `operation_id`. Un retry sin nueva llamada reutiliza la respuesta; cada llamada real usa una identidad de operación correlacionada y queda contabilizada sin crear un segundo ledger.

## Frontend y caché

El endpoint `/auth/me` devuelve la organización activa, Membership, permisos, scope y opciones mínimas autorizadas. El selector solo aparece con más de una Membership. Al cambiar:

- se rota el contexto de la sesión y el access token;
- se remonta el árbol contextual completo;
- se reinicia PRAVIA IA y su conversación activa;
- se eliminan sugerencias de sesión;
- se emite `pravia:organization-changed` para caches futuras.

Las preferencias de vista y sidebar continúan siendo personales, no datos tenant. No hay React Query, realtime ni WebSockets en el repositorio actual. Si se incorporan, sus cache keys y rooms deberán incluir `organizationId`.

## Supabase y acceso a datos

El frontend no consulta tablas de Supabase directamente. Todas las tablas sensibles pasan por el backend y su Prisma server-side; Storage también se opera con credenciales del servidor. Por tanto, el enforcement obligatorio está en backend. RLS decorativo no sustituye ese camino; si en el futuro se habilita acceso directo, será obligatorio diseñar RLS tenant-aware antes de exponerlo.

## Entidades globales e híbridas

Catálogos legales, tipos de acto, caracteres, rulesets fiscales/UIF y UMA permanecen globales/versionados. `PlantillaDocumentalVersion` es configuración híbrida con esta regla exacta:

- `notaria_id = NULL`: plantilla global de plataforma, legible por cualquier organización mediante los flujos autorizados y no modificable desde administración tenant normal.
- `notaria_id != NULL`: plantilla privada de la Organization propietaria de esa Notaría. Solo se selecciona después de resolver una Notaría tenant-scoped y solo puede quedar congelada en un Expediente de esa misma Notaría y Organization.
- no existe listado directo de plantillas privadas sin el contexto de Notaría/Expediente; el trigger `enforce_document_template_scope` rechaza vínculos híbridos inconsistentes en DB sin inferir ni modificar ownership.

No se comparte un `Compareciente` por RFC entre organizaciones.

Los identificadores de identidad, tokens y Storage siguen siendo globalmente únicos. Los folios operativos actuales también conservan unicidad global para compatibilidad y para no reescribir migraciones aplicadas. La revisión para volverlos únicos por organización queda como cambio posterior explícito; el API no revela secuencias de otros tenants.

## Migración

- A: crear Organization/Membership, columnas nullable, FKs, índices y triggers.
- B: durante cutover congelado, crear una única Organization bootstrap, Memberships y backfill de todos los datos actuales.
- C/D: desplegar backend que escribe y lee con actor tenant.
- E: solo tras verificar cero huérfanos, preparar una migración separada de `NOT NULL` donde corresponda.

No se infiere organización desde Notaria, correo, responsable ni expediente. El procedimiento operativo está en `docs/release/multitenancy-cutover-runbook.md`.

## Invariantes

- Org A no lee, busca, agrega, exporta, descarga, modifica ni relaciona un ID válido de Org B.
- `GLOBAL` siempre significa organization-global.
- Un usuario sin Membership activa no obtiene sesión.
- No existe selección automática de “primera organización”.
- Toda relación tenant-owned coincide en `organization_id`.
- Todo archivo nuevo conoce su Organization y todo archivo legacy conserva metadata de ownership en DB.
- Los procesos internos cross-org reclaman trabajo globalmente, pero procesan cada unidad bajo el tenant de esa unidad.
