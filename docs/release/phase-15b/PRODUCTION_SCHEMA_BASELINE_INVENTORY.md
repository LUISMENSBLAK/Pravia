# Inventario estructural productivo S0

Consulta realizada con `transaction_read_only=on`. Identidad observada: proyecto `mkiwijbampubccrpvgga`, PostgreSQL 17.6, DB `postgres`, schema `pravia_os`.

| Objeto | Tipo | Definición resumida | Dependencias | Gestión | Observación |
| --- | --- | --- | --- | --- | --- |
| `pravia_os` | schema | Dominio de aplicación | PostgreSQL | Prisma/migraciones | Incluido en baseline |
| 67 tablas | tablas | Entidades PRAVIA | enums, PK, FK | Prisma | Detalle nominal abajo |
| 902 columnas | columnas | Tipos, defaults y nullability | tablas/enums | Prisma | Inventario JSON completo |
| 236 constraints | PK/FK/unique/check | Integridad relacional y de dominio | tablas | Mixto | Incluye dos checks nativos |
| 258 índices | índices | Unicidad y acceso | tablas/columnas | Mixto | Incluye ocho parciales/de expresión |
| 249 labels | enums | Catálogos tipados | columnas | Prisma | Sin secuencias S0 |
| `fn_check_compareciente_perfil` | función | Consistencia persona física/moral | comparecientes | Database-native | Conservada |
| dos triggers de perfil | triggers | Ejecutan la función diferida | perfiles | Database-native | Conservados |
| cinco extensiones | extensiones | `plpgsql`, `pgcrypto`, `uuid-ossp`, `pg_stat_statements`, `supabase_vault` | entorno Supabase | Environment-native | No portadas por baseline |
| views/policies | vista/policy | Ninguna en `pravia_os` | — | — | RLS desactivado en 67 tablas |

Tablas: `actividades_economicas`, `ai_usage_logs`, `audit_logs`, `auth_sessions`, `caracteres_compareciente`, `caracteres_representacion`, `carga_temporal_documentos`, `checklist_items`, `compareciente_actividades_economicas`, `compareciente_aliases`, `compareciente_alta_sessions`, `compareciente_contactos`, `compareciente_datos_fuente`, `compareciente_documentos`, `compareciente_domicilios`, `compareciente_identificaciones`, `comparecientes`, `compliance_evidence`, `compliance_reviews`, `compliance_rule_sets`, `comunicacion_documentos`, `comunicaciones`, `cotizacion_documentos`, `cotizacion_seguimientos`, `cotizacion_versiones`, `cotizaciones`, `documentos`, `domain_event_outbox`, `domain_event_processing_logs`, `eventos_agenda`, `expediente_actividades`, `expediente_comparecientes`, `expediente_documentos`, `expediente_estatus_log`, `expediente_etapas`, `expediente_representaciones`, `expediente_requisitos_doc`, `expedientes`, `flujo_etapas`, `flujo_versiones`, `formulario_campos`, `formulario_secciones`, `formulario_versiones`, `memoria_despacho`, `movimiento_documentos`, `movimientos_financieros`, `notaria_contactos`, `notarias`, `notas`, `pagos`, `password_reset_tokens`, `persona_moral_instrumentos`, `persona_moral_representantes`, `personas_fisicas`, `personas_morales`, `plantilla_documental_versiones`, `prospecto_documentos`, `prospecto_seguimientos`, `prospectos`, `relaciones_conyugales`, `requisito_documento_vinculos`, `storage_compensation_jobs`, `tareas`, `tareas_externas`, `tipo_acto_caracteres_compareciente`, `tipos_acto`, `users`.

La enumeración exacta de columnas, definiciones, dependencias, constraints, índices y enums está en `artifacts/production-schema/production-structure.json`; no contiene filas de negocio.
