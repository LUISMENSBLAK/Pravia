# PRAVIA IA Action Layer

## Alcance y reglas de autoridad

PRAVIA IA interpreta la intención humana, pero no escribe directamente registros de negocio. Toda acción habilitada pasa por `assistantActions.service.ts`, aplica el tenant y actor autenticados, valida un esquema cerrado y converge en la misma autoridad canónica que utiliza la interfaz manual. Los identificadores de organización, filtros de Prisma, SQL, rutas de archivos y URL arbitrarias no son argumentos válidos.

Las lecturas continúan en el registro canónico existente `assistantTools.service.ts`. Las escrituras se registran en el Action Layer con cuatro clases internas: `READ`, `SAFE_WRITE`, `SENSITIVE_WRITE` y `DESTRUCTIVE`. Las dos últimas requieren confirmación explícita; una operación destructiva nunca introduce hard delete. El actor de negocio y auditoría siempre es la persona autenticada. `PRAVIA_AI` se conserva únicamente como origen técnico de auditoría.

El estado multi-turno se guarda dentro del `context` tenant-aware de `AssistantConversation`; no se añadió una tabla ni un ledger. La clave de invocación se deriva de organización, persona, conversación, mensaje y acción. Los servicios canónicos vuelven a comprobar permisos, alcance de objeto, versión, preview y replay al ejecutar.

## Matriz de cobertura

| Dominio | Acción | Capacidad UI manual | Autoridad backend canónica | RBAC | Acceso objeto | Riesgo | Confirmación | Tool IA | Idempotencia | Auditoría | Pruebas | Estado |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Agenda | Crear evento | Sí | `AgendaController.create` | `agenda.write` | responsable + vínculos | SAFE_WRITE | No | `agenda.event.create` | `idempotency_key` | manual + origen IA | Action/Agenda | Habilitada |
| Agenda | Editar evento | Sí | `AgendaController.update` | `agenda.write` | propietario/equipo | SAFE_WRITE | No | `agenda.event.update` | actualización convergente | manual + origen IA | Action/Agenda | Habilitada |
| Agenda | Cancelar evento | Sí | `AgendaController.cancel` | `agenda.write` | propietario/equipo | DESTRUCTIVE | Sí | `agenda.event.cancel` | cancelación convergente | manual + origen IA | Action/Agenda | Habilitada |
| Agenda | Crear/editar tarea | Sí | `AgendaController.createTask/updateTask` | `agenda.write` | propietario/equipo | SAFE_WRITE | No | — | disponible manualmente | manual | Agenda | Pendiente de tool; no se duplicó autoridad |
| Prospectos | Crear | Sí | `ProspectWorkflowService.create` | `prospectos.write` | tenant/actor | SAFE_WRITE | No | `prospect.create` | creation key | PRO-001 + origen IA | Action/PRO-001 | Habilitada |
| Prospectos | Editar ficha | Sí | `ProspectWorkflowService.update` | `prospectos.write` | `prospectoObjectWhere` | SAFE_WRITE | No | `prospect.update` | optimistic version | PRO-001 + origen IA | Action/PRO-001 | Habilitada |
| Prospectos | Transición/convertir | Sí | `ProspectWorkflowService.act` | `prospectos.write` | `prospectoObjectWhere` | SENSITIVE_WRITE | Sí | `prospect.transition` | transition key | PRO-001 + origen IA | Action/PRO-001 | Habilitada |
| Prospectos | Preparar solicitud notarial | Sí | `ProspectWorkflowService.prepare` | `prospectos.write` | prospecto/documentos | READ | No | `prospect.notary_request.prepare` | preview determinista | PRO-001 + origen IA | Action/PRO-001 | Habilitada; nunca registra envío |
| Cotizaciones | Registrar transición | Sí | `CotizacionWorkflowService.act` | `cotizaciones.write` | `cotizacionObjectWhere` | SENSITIVE_WRITE | Sí | `quote.transition` | transition key | COT-001 + origen IA | Action/COT-001 | Habilitada |
| Cotizaciones | Convertir a expediente | Sí | `CotizacionConversionService.convert` | `cotizaciones.write` + `expedientes.write` | cotización tenant | SENSITIVE_WRITE | Sí | `quote.convert_to_case` | transition key/1:0..1 | COT-001/EXP-001 + origen IA | Action/COT-001 | Habilitada |
| Cotizaciones | Editar conceptos | Sí | controlador/servicio de versión estructurada | `cotizaciones.write` | cotización | SAFE_WRITE | No | — | versión | COT-001 | Quotes | No expuesta: requiere adapter de edición estructurada completo |
| Cotizaciones | Generar PDF | Sí | generación/versionado de cotización | `cotizaciones.write` | cotización | SENSITIVE_WRITE | Sí | — | versión de cotización | COT-001 | Quotes | No expuesta: no se creó generador paralelo |
| Expedientes | Crear directo | No | `ExpedienteOpeningService` solo desde conversión | — | — | — | — | — | — | — | PRO/COT | Prohibida; preserva PRO-001/COT-001 |
| Expedientes | Agregar nota | Sí | `ExpedienteActivityService.addNote` | `expedientes.write` | `expedienteAccessWhere` | SAFE_WRITE | No | `case.add_note` | activity key | EXP-009 + origen IA | Action/EXP-009 | Habilitada |
| Expedientes | Agregar acto | Sí | `ExpedienteActosService.preview/apply` | `expedientes.write` | expediente tenant/asignación | SENSITIVE_WRITE | Sí | `case.add_act` | command key + fingerprint | EXP-002 + origen IA | Action/EXP-002 | Habilitada |
| Expedientes | Editar responsable/cabecera | Sí | workflow de expediente | `expedientes.write` | expediente | SENSITIVE_WRITE | Sí | — | versión | EXP-001 | Expedientes | No expuesta hasta contar con command único de cabecera |
| Comparecientes | Vincular a acto | Sí | `ExpedientePartiesService.preview/apply` | `expedientes.write` + `comparecientes.read` | expediente + compareciente | SENSITIVE_WRITE | Sí | `party.link_to_case` | command key + fingerprint | EXP-003 + origen IA | Action/EXP-003 | Habilitada |
| Comparecientes | Crear/editar maestro | Sí | servicio/controlador de Comparecientes | `comparecientes.write` | compareciente | SAFE_WRITE | No | — | validación de identidad | manual | Comparecientes | No expuesta: evita deduplicación de identidad implícita |
| Comparecientes | Desvincular | Sí | `ExpedientePartiesService.preview/apply` | `expedientes.write` | relación exacta | DESTRUCTIVE | Sí | — | command key + fingerprint | EXP-003 | EXP-003 | No expuesta inicialmente |
| Predios | Vincular a expediente/actos | Sí | `ExpedientePrediosService.preview/apply` | `expedientes.write` | expediente + predio | SENSITIVE_WRITE | Sí | `property.link_to_case` | command key + fingerprint | PRD-001 + origen IA | Action/PRD-001 | Habilitada |
| Predios | Crear/editar maestro | Sí | `PrediosService` | permisos de predio/expediente | predio | SAFE_WRITE | No | — | sin command idempotente uniforme | PRD-001 | Predios | No expuesta; no se duplicó deduplicación maestra |
| Predios | Desvincular | Sí | `ExpedientePrediosService.preview/apply` | `expedientes.write` | relación exacta | DESTRUCTIVE | Sí | — | command key + fingerprint | PRD-001 | PRD-001 | No expuesta inicialmente |
| Documentos | Generar formato pendiente | Sí | `ExpedienteArtifactsService.generationPreview/generate` | `expedientes.write` + `documentos.write` | expediente/fuentes | SENSITIVE_WRITE | Sí | `document.generate` | generation key + source revision | EXP-006 + origen IA | Action/EXP-006 | Habilitada |
| Documentos | Consultar/listar | Sí | `assistantTools`/apéndice documental | `documentos.read` | expediente/documento | READ | No | `getExpedienteDocuments` | N/A | lectura auditada | Assistant tools | Habilitada existente |
| Documentos | Adjuntar temporal | Sí | `assistantConversationService.uploadAttachment` | `ai.use` | conversación propia | SAFE_WRITE técnico | No | UI adjunto | hash + compensación | adjunto IA | Assistant | Habilitada existente |
| Documentos | Vincular oficial al chat | Sí | `assistantConversationService.linkOfficialDocument` | `documentos.read` | `canAccessDocumento` | SAFE_WRITE técnico | No | UI adjunto | upsert hash/source | adjunto IA | Assistant | Habilitada existente |
| Documentos | Reemplazar evidencia | No | versionado canónico solamente | — | — | — | — | — | — | — | Documents | Prohibida |
| Seguimiento | Actualizar actividad | Sí | `ExpedienteSeguimientoService.read/update` | `expedientes.write` | expediente + actividad | SAFE_WRITE | No | `tracking.activity.update` | optimistic version; transición convergente | EXP-005 + origen IA | Action/EXP-005 | Habilitada |
| Seguimiento | Reabrir actividad | Sí | `ExpedienteSeguimientoService.reopen` | `expedientes.write` | expediente + actividad | SENSITIVE_WRITE | Sí | — | optimistic version | EXP-005 | EXP-005 | No expuesta inicialmente |
| Presupuesto | Generar PDF | Sí | `ExpedienteBudgetService.read/generatePdf` | `expedientes.write` + `documentos.write` | expediente | SENSITIVE_WRITE | Sí | `budget.generate_pdf` | generation key + version | EXP-007 + origen IA | Action/EXP-007 | Habilitada |
| Presupuesto | Editar conceptos/distribución | Sí | `ExpedienteBudgetService.save` | `expedientes.write`; distribución `finanzas.write` | expediente | SENSITIVE_WRITE | Sí | — | optimistic version | EXP-007 | EXP-007 | No expuesta inicialmente |
| Finanzas | Crear solicitud interna de pago | Sí | `ExpedienteFinanceService.createInternalRequest` | `expedientes.write` + `documentos.write` | expediente | SENSITIVE_WRITE | Sí | `finance.payment_request.create` | request key | EXP-008 + origen IA | Action/EXP-008 | Habilitada |
| Finanzas | Reportar comprobante | Sí | `ExpedienteFinanceService.reportIncome` | escritura operativa | expediente/documento | SENSITIVE_WRITE | Sí | — | upload + request key | EXP-008 | EXP-008 | No expuesta sin bytes autorizados en el command |
| Finanzas | Aplicar movimiento | Sí, administración | `ExpedienteFinanceService.applyIncome` | `finanzas.validate` | expediente/movimiento | SENSITIVE_WRITE | Sí | — | ledger/version | EXP-008 | EXP-008 | No expuesta inicialmente |
| Cumplimiento | Listar faltantes | Sí | `getComplianceSummary` | `ai.cumplimiento.read` + `cumplimiento.read` | expediente | READ | No | `getComplianceSummary` | N/A | lectura auditada | Assistant tools/H10 | Habilitada existente |
| Cumplimiento | Ejecutar CUM-AUD | Sí | `ComplianceH9Service.run` | `compliance.review` + `ia.execute` | expediente/review | SENSITIVE_WRITE | Sí | `compliance.review.run` | review key | H9 + origen IA | Action/H9 | Habilitada |
| Cumplimiento | Resolver screening | Sí, humano autorizado | flujo H3 | permisos específicos | revisión exacta | SENSITIVE_WRITE legal | Sí | — | workflow H3 | H3 | H3/H10 | No expuesta; decisión humana |
| Cumplimiento | Determinar BC | Sí, humano autorizado | flujo H4 | permisos específicos | revisión exacta | SENSITIVE_WRITE legal | Sí | — | workflow H4 | H4 | H4/H10 | No expuesta; decisión humana |
| Cumplimiento | Contestar cuestionario/presentar aviso/acuse/cerrar | Sí, humano autorizado | H5/H6/H7 | permisos específicos | objeto exacto | SENSITIVE_WRITE legal | Sí | — | workflow versionado | H5-H7 | H10 | No expuesta; no automatiza conclusión legal |
| Configuración | Consultar | Sí | endpoints canónicos de configuración | permisos de lectura | tenant | READ | No | lecturas existentes | N/A | lectura | CFG | Habilitada donde ya existe lectura IA |
| Configuración | Modificar | Sí, roles restringidos | servicios CFG | permisos de gestión | tenant | SENSITIVE_WRITE | Sí | — | versión | CFG | CFG | No expuesta inicialmente |

## Comportamiento conversacional y seguridad

- Solo el texto del turno humano puede originar una acción. La extracción de adjuntos queda fuera de la etapa de planificación de acciones y entra únicamente en la síntesis como datos no confiables.
- El contexto visual completa el identificador únicamente cuando el tipo de entidad coincide con la acción. El backend vuelve a resolver el alcance.
- Una coincidencia autorizada única puede resolverse por folio/nombre; varias coincidencias producen una pregunta compacta sin UUID.
- Si falta un campo obligatorio se guarda `COLLECTING` y se pregunta solamente el primero. El turno siguiente mezcla el dato con el estado estructurado y conserva la misma invocation key.
- `SENSITIVE_WRITE` y `DESTRUCTIVE` guardan `AWAITING_CONFIRMATION`, un token aleatorio y expiración de 15 minutos. Confirmar o cancelar exige la misma conversación, persona y organización.
- Una respuesta de éxito se emite después de la autoridad canónica. Los errores 403/409/5xx no se convierten en éxito de negocio.
- Tras una escritura exitosa, el frontend recibe un scope de refresh y vuelve a montar únicamente la superficie de ruta; el drawer de PRAVIA IA permanece abierto.

## Decisiones de esquema

`schema.prisma` no cambia. No existe migración de esta fase. `AssistantConversation.context` representa el estado efímero/durable multi-turno y cada dominio conserva su infraestructura canónica de idempotencia, auditoría y actividad.
