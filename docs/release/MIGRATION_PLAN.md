# Plan de migraciones de PRAVIA OS

Fecha de corte: 2026-08-13. Este inventario es operativo y no autoriza cambios en producción.

## Estado comprobado

- Esquema objetivo: `pravia_os`.
- Copia aislada: PostgreSQL 16 en Docker, base `pravia_init_test`.
- Las 22 migraciones locales quedaron registradas y el contrato estructural pasó 8/8 pruebas; no quedan llaves foráneas operativas sin índice.
- Producción/Supabase no fue modificada. El chequeo de solo lectura encontró siete migraciones locales pendientes y dos identificadores remotos que no existen en el repositorio: `20260714025925_init` y `20260716025113_simplify_docs_add_groups`.
- La primera migración local presupone una línea base previa (`DocCategoria`). En una base completamente vacía debe usarse el bootstrap controlado `db:init-empty`; antes de producción hay que reconciliar formalmente la línea base remota.

## Inventario

Todas son `VALIDADA LOCAL`; ninguna está marcada como staging ni producción.

| Migración | Objetivo | Tipo | Dependencias | Tablas principales | Histórico/backfill | Riesgo | Rollback | Estado |
|---|---|---|---|---|---|---|---|---|
| `20260726000000_expedientes_core_engine` | Motor, estados y checklist de expedientes | Aditiva/alteración | Línea base previa | expedientes, expediente_estatus_log, checklist_items | Conserva filas; sin backfill destructivo | Alto | Forward-fix; restaurar backup si falla | VALIDADA LOCAL |
| `20260731_comparecientes_alta_session_ia` | Alta asistida, carga temporal y compensación Storage | Aditiva | Maestro de personas | compareciente_alta_sessions, carga_temporal_documentos, storage_compensation_jobs | No | Medio | Retirar tablas nuevas si no tienen datos | VALIDADA LOCAL |
| `20260731_comparecientes_maestro` | Maestro PF/PM, domicilios e instrumentos | Aditiva | Línea base | comparecientes, personas_fisicas, personas_morales y relaciones | Requiere conciliación si existe maestro legado | Alto | Backup + forward-fix | VALIDADA LOCAL |
| `20260811000000_extend_compareciente_profile_fields` | Campos adicionales del perfil | Aditiva | Maestro comparecientes | personas_fisicas/personas_morales | Campos nulos; backfill opcional validado por negocio | Bajo | Eliminar columnas solo antes de uso | VALIDADA LOCAL |
| `20260811010000_extend_operational_agenda_fields` | Estado y datos operativos de agenda | Aditiva | Agenda existente | eventos_agenda | Defaults compatibles | Medio | Forward-fix | VALIDADA LOCAL |
| `20260811011000_extend_agenda_event_types` | Nuevos tipos de evento | Aditiva | Agenda operativa | enum/tipo agenda | No | Bajo | Forward-fix de enum | VALIDADA LOCAL |
| `20260811020000_create_ai_usage_logs` | Trazabilidad de consumo IA | Aditiva | Users | ai_usage_logs | No | Bajo | Retirar tabla sin datos | VALIDADA LOCAL |
| `20260811030000_create_compliance_engine` | Motor versionado de cumplimiento | Aditiva | Comparecientes/expedientes | compliance_rule_sets, compliance_reviews, compliance_evidence | No; reglas se cargan aparte | Alto | Backup + desactivar feature | VALIDADA LOCAL |
| `20260811031000_seed_verified_compliance_references` | Referencias normativas verificadas | Datos aditivos | Motor compliance | compliance_rule_sets/referencias | Seed idempotente | Medio | Desactivar versión; no borrar revisiones | VALIDADA LOCAL |
| `20260811040000_create_secure_auth_sessions` | Sesiones, recuperación y hardening de usuarios | Aditiva/alteración | Users | auth_sessions, password_reset_tokens, users | Sesiones existentes no se inventan | Alto | Revocar sesiones + forward-fix | VALIDADA LOCAL |
| `20260811041000_harden_legacy_public_api` | RLS sobre objetos legacy públicos | Seguridad aditiva | Tablas public opcionales | public.* legacy | No | Alto | Restaurar políticas solo con revisión | VALIDADA LOCAL |
| `20260811042000_define_legacy_data_api_deny_policies` | Políticas deny explícitas | Seguridad aditiva | RLS anterior | políticas public | No | Alto | Forward-fix de políticas | VALIDADA LOCAL |
| `20260811050000_add_operational_fk_indexes` | Índices FK críticos | Aditiva | Esquema operativo | múltiples | No | Bajo/lock | `DROP INDEX CONCURRENTLY` si aplica | VALIDADA LOCAL |
| `20260811051000_complete_operational_fk_indexes` | Completar cobertura FK | Aditiva | Índices anteriores | múltiples | No | Bajo/lock | Igual que anterior | VALIDADA LOCAL |
| `20260811052000_add_compareciente_link_validation` | Validación humana del vínculo | Aditiva | Expediente/compareciente | expediente_comparecientes | Nulos significan pendiente, no 100% | Medio | Forward-fix | VALIDADA LOCAL |
| `20260812010000_add_granular_delivery_postfirma` | Entrega formal y postfirma granular | Aditiva | Expedientes | expediente_entregas, tareas_externas | No | Alto | Desactivar flujo + forward-fix | VALIDADA LOCAL |
| `20260812020000_persist_project_templates` | Plantillas modernas persistidas | Aditiva | Plantillas documentales | plantilla_documental_versiones | Registrar plantillas por herramienta autorizada | Medio | Volver a versión previa sin borrar archivos | VALIDADA LOCAL |
| `20260812030000_create_canonical_finance_ledger` | Ledger, cuentas, distribución y comprobantes | Aditiva/alteración | Users/expedientes/cotizaciones | categorias_financieras, cuentas_financieras, honorarios_generados, movimientos_financieros, distribuciones, comprobantes | Sí: solo tras dry run; nunca migrar ambiguos | Crítico | Backup, feature flag y forward-fix; no borrar ledger | VALIDADA LOCAL |
| `20260813010000_immutable_compliance_snapshots` | Decisiones y snapshots inmutables | Aditiva/alteración | Compliance | compliance_reviews, compliance_decisions | Revisiones previas requieren política explícita | Crítico | Forward-fix; no reescribir historia | VALIDADA LOCAL |
| `20260813020000_create_reporting_targets` | Metas de reporteo | Aditiva | Ledger/reportes | metas_honorarios | Carga administrativa posterior | Medio | Desactivar metas | VALIDADA LOCAL |
| `20260813030000_settings_and_access` | Preferencias, invitaciones, notificaciones y acceso | Aditiva/alteración | Users/auth | users, user_preferences, user_invitations, notifications y auditoría | Defaults compatibles | Alto | Revocar invitaciones/sesiones; forward-fix | VALIDADA LOCAL |
| `20260813040000_harden_session_persistence` | Distinguir cookie de sesión y “recordarme” | Aditiva | Auth sessions | auth_sessions | Default `false`; sesiones previas quedan no persistentes | Medio | Forward-fix | VALIDADA LOCAL |

## Secuencia futura autorizable

1. Congelar escritura o definir ventana de mantenimiento.
2. Confirmar que DB, Storage y backend son el mismo proyecto mediante `npm run check:db` y `npm run storage:verify`.
3. Generar y verificar backup recuperable; registrar tamaño, checksum y restauración de muestra.
4. Exportar `_prisma_migrations` remoto y reconciliar los dos identificadores huérfanos. No usar `resolve` sin explicar y auditar cada checksum.
5. Clonar DB y objetos Storage representativos en staging real.
6. Ejecutar `npm run db:migrate:status` y luego, solo con `MIGRATION_CONFIRMATION=APPLY_VERIFIED_MIGRATIONS`, `npm run db:migrate:deploy` en staging.
7. Ejecutar seeds idempotentes, dry run financiero, integración, auth, RBAC/IDOR y E2E críticos.
8. Comparar conteos y totales; toda diferencia no explicada bloquea.
9. Repetir el procedimiento en producción únicamente con autorización nueva.
