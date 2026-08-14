# Auditoría FK/índices — Fase 15C

La prueba de catálogo S1 encontró 16 FK sin un índice válido cuyo prefijo cubriera todas las columnas de la FK. Se revisaron índices simples y compuestos con `pg_index`; ninguno de los 16 tenía cobertura utilizable. La relación aditiva `documentos.compareciente_id` requirió un índice adicional. S2 termina con **0 FK sin índice**.

| Tabla | Columna FK | Referencia | Patrón real | Índice S1 | Decisión S2 |
|---|---|---|---|---|---|
| compliance_decisions | decidido_por_id | users.id | decisiones por actor | ninguno utilizable | idx_compliance_decisions_decidido_por_fk |
| comprobantes_financieros | anulado_por_id | users.id | auditoría de anulaciones | ninguno utilizable | idx_comprobantes_financieros_anulado_por_fk |
| comprobantes_financieros | registrado_por_id | users.id | comprobantes por registrador | ninguno utilizable | idx_comprobantes_financieros_registrado_por_fk |
| conciliaciones_financieras | conciliado_por_id | users.id | conciliaciones por actor | ninguno utilizable | idx_conciliaciones_financieras_conciliado_por_fk |
| cuentas_financieras | creada_por_id | users.id | cuentas por creador | ninguno utilizable | idx_cuentas_financieras_creada_por_fk |
| expediente_entregas | evidencia_documento_id | documentos.id | entrega por evidencia | ninguno utilizable | idx_expediente_entregas_evidencia_documento_fk |
| honorarios_generados | cotizacion_version_id | cotizacion_versiones.id | honorario por versión | ninguno utilizable | idx_honorarios_generados_cotizacion_version_fk |
| honorarios_generados | reconocido_por_id | users.id | reconocimiento por actor | ninguno utilizable | idx_honorarios_generados_reconocido_por_fk |
| metas_honorarios | creada_por_id | users.id | metas por creador | ninguno utilizable | idx_metas_honorarios_creada_por_fk |
| movimientos_financieros | aplicado_por_id | users.id | movimientos aplicados por actor | ninguno utilizable | idx_movimientos_financieros_aplicado_por_fk |
| movimientos_financieros | cancelado_por_id | users.id | movimientos cancelados por actor | ninguno utilizable | idx_movimientos_financieros_cancelado_por_fk |
| movimientos_financieros | compareciente_id | comparecientes.id | cartera/movimientos por compareciente | ninguno utilizable | idx_movimientos_financieros_compareciente_fk |
| notifications | created_by_id | users.id | notificaciones por creador | ninguno utilizable | idx_notifications_created_by_fk |
| tareas_externas | evidencia_documento_id | documentos.id | postfirma por evidencia | ninguno utilizable | idx_tareas_externas_evidencia_documento_fk |
| transacciones_estado_cuenta | importado_por_id | users.id | importaciones por actor | ninguno utilizable | idx_transacciones_estado_cuenta_importado_por_fk |
| user_invitations | created_by_id | users.id | invitaciones por creador | ninguno utilizable | idx_user_invitations_created_by_fk |
| documentos | compareciente_id | comparecientes.id | documentos por compareciente | FK y relación ausentes | idx_documentos_compareciente_fk + FK validada |

La búsqueda de código encontró usos directos de estos campos en servicios/workers; los índices simples son deliberadamente conservadores y evitan sobreoptimización. `EXPLAIN` en staging, con seqscan deshabilitado para demostrar disponibilidad, eligió `idx_documentos_compareciente_fk`, `idx_movimientos_financieros_compareciente_fk`, `idx_compliance_decisions_decidido_por_fk` e `idx_alta_sessions_usuario_estatus`.
