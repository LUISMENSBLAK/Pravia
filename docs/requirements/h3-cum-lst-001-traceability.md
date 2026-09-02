# CUM-LST-001 — matriz de trazabilidad H3

Base contractual: `3379b8bb8959706a92cb91689fa97148d6f142fe`. La matriz enlaza cada requisito atómico con evidencia ejecutable o con la justificación contractual de su exclusión. No activa fuentes ni contiene datos reales.

| ID | Estado | Requisito atómico | Evidencia / justificación |
|---|---|---|---|
| LST-001 | IMPLEMENTED | El screening maestro vive en Comparecientes. | `ComplianceScreeningResult.compareciente_id`; `ComplianceScreeningService.current`. |
| LST-002 | IMPLEMENTED | El vigente se deriva de la Query MASTER más reciente. | Orden `created_at desc, id desc`; `complianceScreening.service.test.ts` 01. |
| LST-003 | IMPLEMENTED | La historia de Queries permanece append-only. | `h3_query_history_guard`; probes PostgreSQL de identidad desde INSERT y hard delete H3. |
| LST-004 | IMPLEMENTED | Crear Compareciente genera Query. | Alta directa y `confirmarAltaDefinitiva` reutilizan `enqueueComparecienteCreatedTx`; `comparecienteAltaSession.h3.test.ts`. |
| LST-005 | IMPLEMENTED | Cambiar identidad relevante genera nueva Query. | `ComparecienteIdentityChanged`; `queueMasterScreeningTx`; adversarial cases. |
| LST-006 | IMPLEMENTED | Cambios irrelevantes no generan Query. | Fingerprint/selección de campos en `ComparecienteService`; adversarial cases. |
| LST-007 | IMPLEMENTED | Operación vulnerable genera Query y snapshot. | `ensureOperationScreeningForPartyTx` converge review→party y party→review; `operationScreening.service.test.ts`. |
| LST-008 | IMPLEMENTED | Reconsulta manual crea historia nueva. | `manualRerun`; service/frontend tests. |
| LST-009 | IMPLEMENTED | Reintento del mismo trigger reutiliza Query. | Unique tenant+trigger, advisory lock; concurrency 01/02. |
| LST-010 | IMPLEMENTED | Razones/eventos distintos conservan Queries distintas. | Trigger keys por evento; concurrency 03. |
| LST-011 | IMPLEMENTED | Cada Query congela snapshot y fingerprint de identidad. | `h3_query_history_guard`; probes PostgreSQL de snapshot, fingerprint, actor, trigger y contexto. |
| LST-012 | IMPLEMENTED | Contexto exacto MASTER/FREE. | `ck_h3_query_context` + `h3_validate_query`; probes PostgreSQL MASTER↔FREE y coherencia de trigger. |
| LST-013 | IMPLEMENTED | Estados de ejecución contractuales completos. | `ScreeningExecutionState`; domain/contract tests. |
| LST-014 | IMPLEMENTED | NOT_CONFIGURED nunca significa limpio. | `requirementStateFromScreening`; failure/frontend tests. |
| LST-015 | IMPLEMENTED | ERROR nunca significa limpio. | `execute` + CUM-EST mapping; failure/frontend tests. |
| LST-016 | IMPLEMENTED | PARTIAL conserva revisión pendiente. | `deriveScreeningExecutionState`; contract/CUM-EST tests. |
| LST-017 | IMPLEMENTED | Una Query puede congelar múltiples fuentes. | Source set creado con Query QUEUED; guard DB impide fuentes tardías y `ScreeningSourceExecutionAttempt` conserva retries. |
| LST-018 | IMPLEMENTED | Catálogo de fuentes tenant-aware y versionado. | `ScreeningSource`, routes rules-manage, composite FKs. |
| LST-019 | IMPLEMENTED | Q1 congela SourceVersion usada. | `source_version_id`; PostgreSQL Source V1/V2 tests. |
| LST-020 | IMPLEMENTED | SourceVersion usada no cambia silenciosamente. | `h3_source_version_immutable`; PostgreSQL tests. |
| LST-021 | IMPLEMENTED | No hay seeds ni autoridad oficial inventada. | Migración sin `INSERT` de fuentes; secret/data scan. |
| LST-022 | IMPLEMENTED | Proveedor ausente produce NOT_CONFIGURED. | Provider map vacío por defecto; service/failure tests. |
| LST-023 | IMPLEMENTED | Candidato tiene identidad estable por fuente. | `stable_candidate_id`; unique execution+stable; failure test 08. |
| LST-024 | IMPLEMENTED | Evidencia del candidato es inmutable. | Append-only trigger; PostgreSQL candidate immutability. |
| LST-025 | IMPLEMENTED | Fuzzy sólo descubre candidatos. | `screeningCandidateScore`; contract tests. |
| LST-026 | IMPLEMENTED | Ni exact ni identificador auto-confirman. | No escritura de resolución desde scoring; adversarial matrix. |
| LST-027 | IMPLEMENTED | Tres resoluciones humanas canónicas. | `ScreeningHumanDecision`; frontend/service tests. |
| LST-028 | IMPLEMENTED | Resoluciones humanas son append-only. | `h3_append_only`; concurrency 04; PostgreSQL tests. |
| LST-029 | IMPLEMENTED | Resolver exige review+sensitive y object access. | `ComplianceScreeningService.resolve`; RBAC tests 04/05. |
| LST-030 | IMPLEMENTED | Operación guarda snapshot de Query/source/resolution. | `ScreeningOperationSnapshot`; `linkOperationSnapshotTx`. |
| LST-031 | IMPLEMENTED | E1 conserva Q1 cuando nace Q2. | RESTRICT/append-only; concurrency 05. |
| LST-032 | IMPLEMENTED | Query y Requirement de personas distintas se rechazan. | Trigger `h3_validate_operation_snapshot`; PostgreSQL tests. |
| LST-033 | IMPLEMENTED | Lineage cruzado entre tenants se rechaza. | Composite tenant FKs; PostgreSQL tests. |
| LST-034 | IMPLEMENTED | NULL no evade controles tenant/contexto. | NOT NULL + CHECKs; PostgreSQL NULL test. |
| LST-035 | IMPLEMENTED | Existe consulta libre reutilizable en backend/API. | `freeSearch`; `/cumplimiento/screening/free`; service test 07. |
| LST-036 | IMPLEMENTED | FREE pertenece al actor dentro del tenant. | `owner_user_id` y filtro backend; RBAC test 06. |
| LST-037 | IMPLEMENTED | FREE no crea Compareciente/Expediente ni afecta current. | Query FREE sin relaciones maestras; contract/service tests. |
| LST-038 | IMPLEMENTED | REPORTE DE CONSULTA reutiliza Documento/Storage. | `generateReport`; `screeningReportPdf`; failure test 09. |
| LST-039 | IMPLEMENTED | Reporte Q1 conserva corte histórico tras Q2. | Report enlaza `query_id` inmutable y SourceVersions Q1. |
| LST-040 | IMPLEMENTED | Retry de reporte no crea segundo blob lógico. | Arbitraje unique + compensación Storage; `complianceScreening.reportRace.test.ts` verifica 1 fila/1 blob y fallo observable. |
| LST-041 | IMPLEMENTED | NOT_CONFIGURED/ERROR/PARTIAL impiden completar LST. | `requirementStateFromScreening`; contract tests. |
| LST-042 | IMPLEMENTED | Candidato sin resolver o revisión adicional impide completar. | `requirementStateFromScreening`; contract tests. |
| LST-043 | IMPLEMENTED | Cero candidatos exitoso o todos no-corresponde resuelve LST. | CUM-EST mapping; contract tests. |
| LST-044 | IMPLEMENTED | Coincidencia confirmada registra incidencia sin consecuencia inventada ni hard block. | `source_snapshot.consequence = null`; adversarial cases. |
| LST-045 | IMPLEMENTED | Lectura/acciones respetan RBAC y object-level authorization. | Service checks, frontend gating; RBAC tests 01–06. |
| LST-046 | IMPLEMENTED | Eventos técnicos quedan auditados sin ampliar ComplianceEvent/H7. | `AuditLog` H3 en queue/execute/failure/resolution/report/snapshot. |
| LST-047 | DEFERRED BY CONTRACT | H4 Beneficiario Controlador. | Fase H4; fuera del alcance H3. |
| LST-048 | DEFERRED BY CONTRACT | H5 Proveedor de Recursos. | Fase H5; sólo boundary, fuera del alcance H3. |
| LST-049 | DEFERRED BY CONTRACT | PEP/adverse media. | Flujo legacy PEP preservado y separado. |
| LST-050 | DEFERRED BY CONTRACT | Panel central H8. | H3 entrega superficies Compareciente/Expediente; no dashboard. |
| LST-051 | DEFERRED BY CONTRACT | Auto-rerun al publicar nueva versión de fuente. | Versionado listo; automatización expresamente diferida. |
| LST-052 | BLOCKED BY OFFICIAL DATA | Activación de fuentes/proveedores oficiales concretos. | Sin dataset/credencial/autoridad oficial: estado correcto `NOT_CONFIGURED`. |

Resultado esperado para H3: 46 implementados, 5 diferidos por contrato y 1 bloqueado por datos oficiales; ningún requisito omitido.
