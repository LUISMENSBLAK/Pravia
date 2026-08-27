# Phase B · EXP-002 · Actos dentro del expediente

## Decisión canónica

`ExpedienteActo` es la única relación operativa entre un expediente y sus actos. Cada fila representa una instancia jurídica concreta. Un expediente puede contener varias instancias y dos instancias distintas pueden referenciar el mismo `TipoActo`.

`Expediente.tipo_acto_id` se conserva sin alteración para trazabilidad histórica, queda nullable y no recibe escrituras nuevas. No determina flujos, documentos, filtros ni respuestas operativas nuevas.

## Invariantes

- Una instancia pertenece al mismo tenant que su expediente.
- El catálogo maestro sigue siendo `TipoActo`; no existe un catálogo paralelo.
- No existe unicidad por `(expediente, tipo de acto)`.
- La conversión Cotización → Expediente crea el acto inicial en la misma transacción.
- `ADD`, `CHANGE` y `REMOVE` requieren vista previa; aplicar requiere su fingerprint vigente.
- `REMOVE` es una desvinculación lógica, nunca un borrado físico.
- Las operaciones son idempotentes y guardan actor, motivo, actividad, auditoría y evento de dominio.
- La API, no el frontend, aplica tenant, RBAC y autorización del objeto.

## Política cuando la cotización no tiene acto

La conversión no inventa un tipo. Mantiene el contrato actual y rechaza la apertura con `EXPEDIENTE_ACT_TYPE_INVALID` o `EXPEDIENTE_OPEN_REQUIRED` hasta que la cotización tenga un acto del catálogo válido. No se crea un expediente huérfano.

## Motor de impacto

La vista previa consulta exclusivamente las configuraciones existentes:

- CFG-001: `ConfiguracionActo`, etapas y actividades activas.
- CFG-002: `CatalogoArtefacto`, asociaciones a actos, reglas y multiplicidad.

El resultado separa `added`, `removed_or_no_longer_applicable` y `retained`. Si una modificación dejaría de aplicar configuración y ya existe trabajo, la clasificación es `REVIEW_REQUIRED`; en fases inmutables es `BLOCKED`. La confirmación humana no elimina ni reescribe trabajo histórico.

## Matriz de consumidores

| Consumidor | Fuente canónica | Adaptación B3 |
|---|---|---|
| Conversión de cotización | `ExpedienteActo` | Crea origen `COTIZACION` en la transacción de apertura |
| Lista/detalle de expedientes | `Expediente.actos` activos | Filtros, búsqueda y acto primario de compatibilidad derivados de instancias |
| Agenda | `Expediente.actos` activos | Presenta el primer acto activo sólo como resumen visual |
| Finanzas | `Expediente.actos` activos | Filtro y agrupación por instancias canónicas |
| Proyectos | `Expediente.actos` activos | Usa actos del expediente para contexto |
| Cumplimiento | `Expediente.actos` activos | Snapshot y revisión incluyen la colección canónica |
| Notarías | `Expediente.actos` activos | Resúmenes derivados de la colección |
| PRAVIA IA | `Expediente.actos` activos | Tool de lectura entrega todos los actos permitidos |
| UI del expediente | `/expedientes/:id/actos` | Alta/cambio/desvinculación con preview y confirmación |

## Migración y convergencia

La migración `20260826010000_expand_expediente_actos`:

1. preserva todos los expedientes, folios, cotizaciones, documentos y campos legacy;
2. crea la tabla, FKs tenant-aware, checks e índices;
3. crea una instancia determinista por cada expediente legacy con `tipo_acto_id`;
4. utiliza `ON CONFLICT ... DO NOTHING` para reintentos seguros;
5. aborta si detecta huérfanos, tenant mismatch, ausencia de backfill o duplicación de filas de migración.

Validaciones esperadas para el dataset aprobado: 7 expedientes, 7 campos legacy preservados, 7 relaciones iniciales, 0 huérfanos, 0 tenant mismatch, 0 duplicados y 0 pérdida legacy.

## Rollback

Antes de habilitar escrituras B3 debe existir backup lógico verificado. El rollback de aplicación vuelve al checkpoint B2 sin modificar los campos legacy. El rollback de datos es restaurar la copia verificada; no se ejecuta un `DROP` improvisado ni se reconstruye `tipo_acto_id` a partir de las instancias. Las nuevas instancias creadas después del corte deben exportarse para conciliación antes de restaurar.

## Riesgos y mitigaciones

- **Preview obsoleto:** fingerprint sobre versión, actos, configuración e impacto; respuesta 409.
- **Retry accidental:** claves únicas separadas para creación y desvinculación.
- **Cruce de tenant:** filtros de servicio, FKs compuestas y triggers de alcance/membresía.
- **Pérdida de trabajo:** soft unlink, clasificación protegida y confirmación humana.
- **Regresión legacy:** endpoint de ficha rechaza `tipo_acto_id`; el script masivo quedó retirado.
- **Duplicación del catálogo:** todas las instancias referencian `TipoActo` existente.

## Límites de esta fase

EXP-002 no implementa Predios/Inmuebles (PRD-001), no modifica CFG-001/CFG-002, no altera folios históricos y no inicia B4.
