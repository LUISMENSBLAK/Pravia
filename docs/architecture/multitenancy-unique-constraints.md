# Auditoría de unicidad multitenant

Estado: diseño local para revisión. No se ha aplicado ninguna migración productiva.

La etapa aditiva conserva `organization_id` nullable hasta el backfill. Por esa razón no se convierten automáticamente todos los índices históricos a compuestos: Prisma exige campos obligatorios para exponer compound unique selectors de forma segura, y retirar una unicidad antes del backfill puede introducir duplicados difíciles de reconciliar.

## Clasificación

| Restricción | Decisión | Motivo |
|---|---|---|
| `User.email` | GLOBAL | La identidad es única en la plataforma y puede tener varias Memberships. |
| tokens de sesión, invitación y recuperación | GLOBAL | Secretos opacos; la unicidad global evita replay. |
| `OrganizationMembership(org,user)` | POR TENANT | Impide Membership duplicada en la misma organización. |
| `UserInvitation(org,accepted_user)` | POR TENANT | Una identidad puede aceptar invitaciones de varias organizaciones. |
| folios de Cotización, Expediente, Movimiento, Comprobante e ISR | GLOBAL COMPATIBLE | Se preserva compatibilidad histórica en esta etapa. No se exponen registros de otros tenants. |
| vínculos uno-a-uno por FK (`cotizacion_id`, `movimiento_id`, `expediente_id`) | GLOBAL POR IDENTIDAD DE PADRE | Los UUID de padre son globales y el trigger exige el mismo tenant. |
| versiones y tablas puente | DERIVADA DEL PADRE | La unicidad por FK padre ya queda efectivamente acotada al tenant del padre. |
| `Documento.storage_key` y `nombre_interno` | GLOBAL | Evita colisiones físicas; todo path nuevo incorpora Organization. |
| `CategoriaFinanciera.clave` | CANDIDATA POR TENANT | Debe convertirse después de backfill y `NOT NULL`, antes de habilitar onboarding de una segunda organización. |
| `CuentaFinanciera(institucion,alias)` | CANDIDATA POR TENANT | Alias de cuenta es configuración organizacional. |
| `MetaHonorario(...)` | CANDIDATA POR TENANT | La meta pertenece a una organización. |
| fingerprint bancario | LÓGICAMENTE POR TENANT | Todo fingerprint nuevo incorpora el Organization del actor antes del hash; se conserva la columna global unique como defensa de idempotencia. |
| idempotency keys de movimientos, agenda, tareas y altas | GLOBAL COMPATIBLE | Las claves se tratan como opacas/globales durante la transición. Antes de exponer integraciones de terceros multi-org se versionarán con Organization. |
| `AIUsageLog.operation_id` | GLOBAL | Correlation IDs de llamadas proveedor son globalmente únicos y no autorizan lecturas; el ledger además está tenant-scoped. |

## Regla de activación de nuevos tenants

No se debe incorporar una segunda organización real hasta completar la etapa E que:

1. confirme cero `organization_id` nulos;
2. convierta en `NOT NULL` los owners canónicos;
3. migre las restricciones marcadas `CANDIDATA POR TENANT` a índices `UNIQUE (organization_id, ...)`;
4. pruebe colisiones controladas ORG_A/ORG_B;
5. valide restore y rollback.

Los identificadores globales compatibles no cambian sin una migración funcional independiente.
