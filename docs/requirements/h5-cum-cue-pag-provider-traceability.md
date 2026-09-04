# H5 · CUM-CUE-001 + CUM-PAG-001 + Proveedor de Recursos · Trazabilidad contractual

Matriz congelada subordinada al documento funcional v0.5. H5 implementa únicamente los 83 requisitos diseñables; no incorpora contenido jurídico, cuestionarios, metodologías, catálogos ni formatos oficiales no aprobados.

## Mapeo de identidad

Los identificadores normalizados conservan correspondencia uno-a-uno: `CUE-n → NCUE-n`, `PAG-n → NPAG-n`, `PRV-n → NPRV-n` y `XINT-n → NXINT-n`. Ningún requisito se fusiona ni se divide.

| ID | Cláusula atómica | Evidencia | Estado |
| --- | --- | --- | --- |
| NCUE-001 | Un assessment GENERAL por tenant y revisión vigente; nunca por acto. | `schema.prisma`; migración H5; `complianceH5.service.ts`; dominio, rutas, UI y pruebas H5. | IMPLEMENTED + TESTED |
| NCUE-002 | Assessment PERSONAL deduplicado por tenant, revisión y compareciente. | `schema.prisma`; migración H5; `complianceH5.service.ts`; dominio, rutas, UI y pruebas H5. | IMPLEMENTED + TESTED |
| NCUE-003 | Los actos sólo aportan procedencia al assessment compartido. | `schema.prisma`; migración H5; `complianceH5.service.ts`; dominio, rutas, UI y pruebas H5. | IMPLEMENTED + TESTED |
| NCUE-004 | Master estable tenant-owned con scope y target XOR. | `schema.prisma`; migración H5; `complianceH5.service.ts`; dominio, rutas, UI y pruebas H5. | IMPLEMENTED + TESTED |
| NCUE-005 | Revisión monotónica con base, supersedes y puntero current explícito. | `schema.prisma`; migración H5; `complianceH5.service.ts`; dominio, rutas, UI y pruebas H5. | IMPLEMENTED + TESTED |
| NCUE-006 | Edición DRAFT mediante nueva revisión y control optimista. | `schema.prisma`; migración H5; `complianceH5.service.ts`; dominio, rutas, UI y pruebas H5. | IMPLEMENTED + TESTED |
| NCUE-007 | Cuestionario incompleto permanece DRAFT con evaluación PENDING. | `schema.prisma`; migración H5; `complianceH5.service.ts`; dominio, rutas, UI y pruebas H5. | IMPLEMENTED + TESTED |
| NCUE-008 | Finalización transaccional, idempotente y autorizada por objeto. | `schema.prisma`; migración H5; `complianceH5.service.ts`; dominio, rutas, UI y pruebas H5. | IMPLEMENTED + TESTED |
| NCUE-009 | Revisión FINALIZED físicamente inmutable. | `schema.prisma`; migración H5; `complianceH5.service.ts`; dominio, rutas, UI y pruebas H5. | IMPLEMENTED + TESTED |
| NCUE-010 | Completitud derivada exclusivamente en backend desde la definición fijada. | `schema.prisma`; migración H5; `complianceH5.service.ts`; dominio, rutas, UI y pruebas H5. | IMPLEMENTED + TESTED |
| NCUE-011 | CFG-002 existente se extiende; no nace un segundo catálogo. | `schema.prisma`; migración H5; `complianceH5.service.ts`; dominio, rutas, UI y pruebas H5. | IMPLEMENTED + TESTED |
| NCUE-012 | Artefactos históricos conservan semántica FILE sin reclasificación. | `schema.prisma`; migración H5; `complianceH5.service.ts`; dominio, rutas, UI y pruebas H5. | IMPLEMENTED + TESTED |
| NCUE-013 | Definición estructurada soporta secciones, tipos, condiciones y repetibles. | `schema.prisma`; migración H5; `complianceH5.service.ts`; dominio, rutas, UI y pruebas H5. | IMPLEMENTED + TESTED |
| NCUE-014 | IDs estables independientes de etiqueta, posición y orden. | `schema.prisma`; migración H5; `complianceH5.service.ts`; dominio, rutas, UI y pruebas H5. | IMPLEMENTED + TESTED |
| NCUE-015 | Publicación rechaza IDs duplicados, referencias inválidas y ciclos. | `schema.prisma`; migración H5; `complianceH5.service.ts`; dominio, rutas, UI y pruebas H5. | IMPLEMENTED + TESTED |
| NCUE-016 | Reapertura/corrección posterior de finalizados queda fuera de H5. | Seam preservado; capacidad no implementada en H5. | DEFERRED |
| NCUE-017 | Versión y checksum de definición quedan congelados en la revisión. | `schema.prisma`; migración H5; `complianceH5.service.ts`; dominio, rutas, UI y pruebas H5. | IMPLEMENTED + TESTED |
| NCUE-018 | Una definición sólo se usa si está activa y compatible con el scope. | `schema.prisma`; migración H5; `complianceH5.service.ts`; dominio, rutas, UI y pruebas H5. | IMPLEMENTED + TESTED |
| NCUE-019 | Todas las procedencias disparadoras se preservan canónicamente. | `schema.prisma`; migración H5; `complianceH5.service.ts`; dominio, rutas, UI y pruebas H5. | IMPLEMENTED + TESTED |
| NCUE-020 | Reintentos con la misma idempotency key convergen. | `schema.prisma`; migración H5; `complianceH5.service.ts`; dominio, rutas, UI y pruebas H5. | IMPLEMENTED + TESTED |
| NCUE-021 | Conflicto de fingerprint/current revision devuelve 409. | `schema.prisma`; migración H5; `complianceH5.service.ts`; dominio, rutas, UI y pruebas H5. | IMPLEMENTED + TESTED |
| NCUE-022 | Contenido real del cuestionario general no se inventa. | Puerto fail-closed/NOT_CONFIGURED; no seed ni valor inventado. | BLOCKED CONFIG/FORMAT DATA |
| NCUE-023 | Contenido real del cuestionario personal no se inventa. | Puerto fail-closed/NOT_CONFIGURED; no seed ni valor inventado. | BLOCKED CONFIG/FORMAT DATA |
| NCUE-024 | Metodología versionada separada de la definición de presentación. | `schema.prisma`; migración H5; `complianceH5.service.ts`; dominio, rutas, UI y pruebas H5. | IMPLEMENTED + TESTED |
| NCUE-025 | DSL de riesgo cerrado y determinista. | `schema.prisma`; migración H5; `complianceH5.service.ts`; dominio, rutas, UI y pruebas H5. | IMPLEMENTED + TESTED |
| NCUE-026 | Cero salidas de metodología bloquea la finalización. | `schema.prisma`; migración H5; `complianceH5.service.ts`; dominio, rutas, UI y pruebas H5. | IMPLEMENTED + TESTED |
| NCUE-027 | Múltiples salidas de metodología bloquean la finalización. | `schema.prisma`; migración H5; `complianceH5.service.ts`; dominio, rutas, UI y pruebas H5. | IMPLEMENTED + TESTED |
| NCUE-028 | Ausencia de metodología activa produce NOT_CONFIGURED. | `schema.prisma`; migración H5; `complianceH5.service.ts`; dominio, rutas, UI y pruebas H5. | IMPLEMENTED + TESTED |
| NCUE-029 | Taxonomía y factores reales de riesgo no se inventan. | Puerto fail-closed/NOT_CONFIGURED; no seed ni valor inventado. | BLOCKED CONFIG/FORMAT DATA |
| NCUE-030 | IA no responde el cuestionario ni decide el riesgo. | `schema.prisma`; migración H5; `complianceH5.service.ts`; dominio, rutas, UI y pruebas H5. | IMPLEMENTED + TESTED |
| NCUE-031 | PDF interno se deriva de una revisión exacta. | `schema.prisma`; migración H5; `complianceH5.service.ts`; dominio, rutas, UI y pruebas H5. | IMPLEMENTED + TESTED |
| NCUE-032 | PDF interno no se presenta como documento oficial. | `schema.prisma`; migración H5; `complianceH5.service.ts`; dominio, rutas, UI y pruebas H5. | IMPLEMENTED + TESTED |
| NCUE-033 | Firma del cuestionario no se presupone ni se fabrica. | `schema.prisma`; migración H5; `complianceH5.service.ts`; dominio, rutas, UI y pruebas H5. | IMPLEMENTED + TESTED |
| NCUE-034 | Estado del requisito CUE se sincroniza con revisión/completitud canónicas. | `schema.prisma`; migración H5; `complianceH5.service.ts`; dominio, rutas, UI y pruebas H5. | IMPLEMENTED + TESTED |
| NPAG-001 | Master estable ComplianceOperationPayment por pago operacional. | `schema.prisma`; migración H5; `complianceH5.service.ts`; dominio, rutas, UI y pruebas H5. | IMPLEMENTED + TESTED |
| NPAG-002 | Puntero explícito a la revisión vigente del pago. | `schema.prisma`; migración H5; `complianceH5.service.ts`; dominio, rutas, UI y pruebas H5. | IMPLEMENTED + TESTED |
| NPAG-003 | Revisiones confirmadas son físicamente inmutables. | `schema.prisma`; migración H5; `complianceH5.service.ts`; dominio, rutas, UI y pruebas H5. | IMPLEMENTED + TESTED |
| NPAG-004 | Escritura exige revisión/fingerprint esperado e idempotencia. | `schema.prisma`; migración H5; `complianceH5.service.ts`; dominio, rutas, UI y pruebas H5. | IMPLEMENTED + TESTED |
| NPAG-005 | Un pago puede aplicar al instrumento general. | `schema.prisma`; migración H5; `complianceH5.service.ts`; dominio, rutas, UI y pruebas H5. | IMPLEMENTED + TESTED |
| NPAG-006 | Un pago puede referenciar un conjunto explícito de actos. | `schema.prisma`; migración H5; `complianceH5.service.ts`; dominio, rutas, UI y pruebas H5. | IMPLEMENTED + TESTED |
| NPAG-007 | Relación pago–acto N:M conserva tenant/expediente exactos. | `schema.prisma`; migración H5; `complianceH5.service.ts`; dominio, rutas, UI y pruebas H5. | IMPLEMENTED + TESTED |
| NPAG-008 | Un pago compartido no se duplica por acto. | `schema.prisma`; migración H5; `complianceH5.service.ts`; dominio, rutas, UI y pruebas H5. | IMPLEMENTED + TESTED |
| NPAG-009 | CUM-PAG no escribe ni duplica el ledger EXP-008. | `schema.prisma`; migración H5; `complianceH5.service.ts`; dominio, rutas, UI y pruebas H5. | IMPLEMENTED + TESTED |
| NPAG-010 | No se crea un segundo ledger financiero. | `schema.prisma`; migración H5; `complianceH5.service.ts`; dominio, rutas, UI y pruebas H5. | IMPLEMENTED + TESTED |
| NPAG-011 | No existe campo autoritativo inventado “concepto de pago”. | `schema.prisma`; migración H5; `complianceH5.service.ts`; dominio, rutas, UI y pruebas H5. | IMPLEMENTED + TESTED |
| NPAG-012 | Política jurídica productiva de FX queda bloqueada. | Puerto fail-closed/NOT_CONFIGURED; no seed ni valor inventado. | BLOCKED LEGAL DATA |
| NPAG-013 | Importes usan Decimal extremo a extremo. | `schema.prisma`; migración H5; `complianceH5.service.ts`; dominio, rutas, UI y pruebas H5. | IMPLEMENTED + TESTED |
| NPAG-014 | Catálogo jurídico real de métodos de pago queda bloqueado. | Puerto fail-closed/NOT_CONFIGURED; no seed ni valor inventado. | BLOCKED CONFIG/FORMAT DATA |
| NPAG-015 | Moneda original se conserva junto al equivalente derivable. | `schema.prisma`; migración H5; `complianceH5.service.ts`; dominio, rutas, UI y pruebas H5. | IMPLEMENTED + TESTED |
| NPAG-016 | Tipo de cambio exige fuente/fecha/criterio o desconocimiento explícito. | `schema.prisma`; migración H5; `complianceH5.service.ts`; dominio, rutas, UI y pruebas H5. | IMPLEMENTED + TESTED |
| NPAG-017 | Contraprestación y precio no se derivan falsamente del pago. | `schema.prisma`; migración H5; `complianceH5.service.ts`; dominio, rutas, UI y pruebas H5. | IMPLEMENTED + TESTED |
| NPAG-018 | Diferencia de saldos no se convierte automáticamente en error jurídico. | `schema.prisma`; migración H5; `complianceH5.service.ts`; dominio, rutas, UI y pruebas H5. | IMPLEMENTED + TESTED |
| NPAG-019 | Evidencia de pago reutiliza Documento/DocumentoVersion N:M. | `schema.prisma`; migración H5; `complianceH5.service.ts`; dominio, rutas, UI y pruebas H5. | IMPLEMENTED + TESTED |
| NPAG-020 | Autoridad universal de contraprestación queda bloqueada. | Puerto fail-closed/NOT_CONFIGURED; no seed ni valor inventado. | BLOCKED LEGAL DATA |
| NPAG-021 | Parte pagadora y receptora se fijan por revisión. | `schema.prisma`; migración H5; `complianceH5.service.ts`; dominio, rutas, UI y pruebas H5. | IMPLEMENTED + TESTED |
| NPAG-022 | Cuenta sólo persiste fingerprint HMAC y últimos cuatro. | `schema.prisma`; migración H5; `complianceH5.service.ts`; dominio, rutas, UI y pruebas H5. | IMPLEMENTED + TESTED |
| NPAG-023 | Documento exacto se valida por tenant, versión y checksum. | `schema.prisma`; migración H5; `complianceH5.service.ts`; dominio, rutas, UI y pruebas H5. | IMPLEMENTED + TESTED |
| NPAG-024 | Verificación de pago es histórica y revisionada. | `schema.prisma`; migración H5; `complianceH5.service.ts`; dominio, rutas, UI y pruebas H5. | IMPLEMENTED + TESTED |
| NPAG-025 | Regla productiva de restricción de efectivo queda bloqueada. | `schema.prisma`; migración H5; `complianceH5.service.ts`; dominio, rutas, UI y pruebas H5. | IMPLEMENTED + TESTED |
| NPAG-026 | Umbral/regla real de efectivo no se siembra. | Puerto fail-closed/NOT_CONFIGURED; no seed ni valor inventado. | BLOCKED LEGAL DATA |
| NPAG-027 | Mismatch de verificación crea observación, no sentencia jurídica. | `schema.prisma`; migración H5; `complianceH5.service.ts`; dominio, rutas, UI y pruebas H5. | IMPLEMENTED + TESTED |
| NPAG-028 | Pagos multi-documento preservan lineage por recibo. | `schema.prisma`; migración H5; `complianceH5.service.ts`; dominio, rutas, UI y pruebas H5. | IMPLEMENTED + TESTED |
| NPAG-029 | Propuesta IA reutiliza el maestro de propuestas existente. | `schema.prisma`; migración H5; `complianceH5.service.ts`; dominio, rutas, UI y pruebas H5. | IMPLEMENTED + TESTED |
| NPAG-030 | Confirmación humana es obligatoria antes de mutar el pago. | `schema.prisma`; migración H5; `complianceH5.service.ts`; dominio, rutas, UI y pruebas H5. | IMPLEMENTED + TESTED |
| NPAG-031 | Propuesta obsoleta se bloquea por fingerprints/checksums. | `schema.prisma`; migración H5; `complianceH5.service.ts`; dominio, rutas, UI y pruebas H5. | IMPLEMENTED + TESTED |
| NPAG-032 | IA nunca auto-confirma ni auto-promueve proveedor. | `schema.prisma`; migración H5; `complianceH5.service.ts`; dominio, rutas, UI y pruebas H5. | IMPLEMENTED + TESTED |
| NPAG-033 | Consumo downstream real por H7+ queda diferido. | Seam preservado; capacidad no implementada en H5. | DEFERRED |
| NPAG-034 | Legacy CompliancePayment se migra/clasifica sin pérdida y deja de aceptar writes. | `schema.prisma`; migración H5; `complianceH5.service.ts`; dominio, rutas, UI y pruebas H5. | IMPLEMENTED + TESTED |
| NPRV-001 | Proveedor de recursos se modela como rol operativo en la relación expediente–compareciente. | `schema.prisma`; migración H5; `complianceH5.service.ts`; dominio, rutas, UI y pruebas H5. | IMPLEMENTED + TESTED |
| NPRV-002 | No se crea master de proveedor ni atributo global de persona. | `schema.prisma`; migración H5; `complianceH5.service.ts`; dominio, rutas, UI y pruebas H5. | IMPLEMENTED + TESTED |
| NPRV-003 | El nuevo rol no sobrescribe otros roles del compareciente. | `schema.prisma`; migración H5; `complianceH5.service.ts`; dominio, rutas, UI y pruebas H5. | IMPLEMENTED + TESTED |
| NPRV-004 | Regla jurídica productiva que obliga el rol queda bloqueada. | Puerto fail-closed/NOT_CONFIGURED; no seed ni valor inventado. | BLOCKED LEGAL DATA |
| NPRV-005 | Promoción requiere resultado H1 verificado del contexto exacto. | `schema.prisma`; migración H5; `complianceH5.service.ts`; dominio, rutas, UI y pruebas H5. | IMPLEMENTED + TESTED |
| NPRV-006 | Sin regla verificada no existe auto-promoción. | `schema.prisma`; migración H5; `complianceH5.service.ts`; dominio, rutas, UI y pruebas H5. | IMPLEMENTED + TESTED |
| NPRV-007 | El vínculo conserva revisión/regla/resultado que lo justificó. | `schema.prisma`; migración H5; `complianceH5.service.ts`; dominio, rutas, UI y pruebas H5. | IMPLEMENTED + TESTED |
| NPRV-008 | El alta es humana, idempotente y auditada. | `schema.prisma`; migración H5; `complianceH5.service.ts`; dominio, rutas, UI y pruebas H5. | IMPLEMENTED + TESTED |
| NPRV-009 | Se reutiliza autorización de objeto EXP-003. | `schema.prisma`; migración H5; `complianceH5.service.ts`; dominio, rutas, UI y pruebas H5. | IMPLEMENTED + TESTED |
| NPRV-010 | Se reutiliza screening de parte canónico H3. | `schema.prisma`; migración H5; `complianceH5.service.ts`; dominio, rutas, UI y pruebas H5. | IMPLEMENTED + TESTED |
| NPRV-011 | Se reutiliza documento/evidencia canónica H2. | `schema.prisma`; migración H5; `complianceH5.service.ts`; dominio, rutas, UI y pruebas H5. | IMPLEMENTED + TESTED |
| NPRV-012 | Cuestionario personal del proveedor es condicional y deduplicado. | `schema.prisma`; migración H5; `complianceH5.service.ts`; dominio, rutas, UI y pruebas H5. | IMPLEMENTED + TESTED |
| NPRV-013 | Relaciones de actos/roles existentes permanecen intactas. | `schema.prisma`; migración H5; `complianceH5.service.ts`; dominio, rutas, UI y pruebas H5. | IMPLEMENTED + TESTED |
| NPRV-014 | Flags legacy inequívocos se clasifican sin pérdida. | `schema.prisma`; migración H5; `complianceH5.service.ts`; dominio, rutas, UI y pruebas H5. | IMPLEMENTED + TESTED |
| NPRV-015 | Flags legacy ambiguos se conservan para revisión, sin inferencia. | `schema.prisma`; migración H5; `complianceH5.service.ts`; dominio, rutas, UI y pruebas H5. | IMPLEMENTED + TESTED |
| NPRV-016 | Desvinculación/edición no elude RBAC ni tenant scope. | `schema.prisma`; migración H5; `complianceH5.service.ts`; dominio, rutas, UI y pruebas H5. | IMPLEMENTED + TESTED |
| NPRV-017 | UI distingue candidato, confirmado y no configurado sin falso positivo. | `schema.prisma`; migración H5; `complianceH5.service.ts`; dominio, rutas, UI y pruebas H5. | IMPLEMENTED + TESTED |
| NXINT-001 | CUM-EST recalcula mediante deriveComplianceState. | `schema.prisma`; migración H5; `complianceH5.service.ts`; dominio, rutas, UI y pruebas H5. | IMPLEMENTED + TESTED |
| NXINT-002 | H5 no crea estados generales paralelos. | `schema.prisma`; migración H5; `complianceH5.service.ts`; dominio, rutas, UI y pruebas H5. | IMPLEMENTED + TESTED |
| NXINT-003 | Current review es autoridad para cuestionarios y resultados. | `schema.prisma`; migración H5; `complianceH5.service.ts`; dominio, rutas, UI y pruebas H5. | IMPLEMENTED + TESTED |
| NXINT-004 | Staleness se detecta por fingerprints, checksums y revisión actual. | `schema.prisma`; migración H5; `complianceH5.service.ts`; dominio, rutas, UI y pruebas H5. | IMPLEMENTED + TESTED |
| NXINT-005 | Los once modelos nuevos son tenant-owned. | `schema.prisma`; migración H5; `complianceH5.service.ts`; dominio, rutas, UI y pruebas H5. | IMPLEMENTED + TESTED |
| NXINT-006 | Los once modelos están registrados en TENANT_SCOPED_MODELS. | `schema.prisma`; migración H5; `complianceH5.service.ts`; dominio, rutas, UI y pruebas H5. | IMPLEMENTED + TESTED |
| NXINT-007 | FKs compuestas y guards preservan tenant/expediente/revisión. | `schema.prisma`; migración H5; `complianceH5.service.ts`; dominio, rutas, UI y pruebas H5. | IMPLEMENTED + TESTED |
| NXINT-008 | AuditLog conserva actor, tenant, objeto y before/after relevantes. | `schema.prisma`; migración H5; `complianceH5.service.ts`; dominio, rutas, UI y pruebas H5. | IMPLEMENTED + TESTED |
| NXINT-009 | Firma/formato oficial CUM-FIR queda diferido. | Seam preservado; capacidad no implementada en H5. | DEFERRED |
| NXINT-010 | Avisos/presentaciones downstream quedan diferidos. | Seam preservado; capacidad no implementada en H5. | DEFERRED |
| NXINT-011 | Workflow dedicado CUM-AUD/H9 queda diferido. | Seam preservado; capacidad no implementada en H5. | DEFERRED |

## Recuento vinculante

- Total: 96.
- Implementados y probados: 83.
- Diferidos: 5 (`NCUE-016`, `NPAG-033`, `NXINT-009`, `NXINT-010`, `NXINT-011`).
- Bloqueados por datos jurídicos: 4 (`NPAG-012`, `NPAG-020`, `NPAG-026`, `NPRV-004`).
- Bloqueados por configuración/formato: 4 (`NCUE-022`, `NCUE-023`, `NCUE-029`, `NPAG-014`).

## Índice verificable de evidencia

Las referencias abreviadas de las filas anteriores se resuelven contra estos puntos concretos; ninguna fila usa el mero recuento de la matriz como prueba de comportamiento:

- Cuestionarios, definiciones y metodología: `backend/src/domain/complianceH5.ts` (`validateQuestionnaireDefinition`, `questionnaireCompleteness`, `validateRiskMethodology`, `evaluateRiskMethodology`) y `backend/src/services/complianceH5.service.ts` (`publishQuestionnaireDefinition`, `ensureQuestionnaires`, `saveQuestionnaire`, `publishMethodology`, `questionnairePdf`). Las pruebas ejecutables están en `backend/src/domain/complianceH5.test.ts`, `backend/src/services/complianceH5.service.test.ts` y `frontend/src/tests/ComplianceH5.test.tsx`.
- Pagos y verificación: `backend/src/services/complianceH5.service.ts` (`createPaymentRevision`, `verifyPayment`, `preparePaymentProposal`, `confirmPaymentProposal`, `rejectPaymentProposal`) y `backend/src/domain/complianceH5.ts` (`accountSafeValues`, `paymentSemanticFingerprint`, `paymentVerificationIsStale`). Las pruebas de dominio, servicio, PostgreSQL y UI están en los archivos H5 citados arriba y `backend/src/integration/complianceH5.postgresql.integration.test.ts`.
- Proveedor de recursos: `backend/src/services/complianceH5.service.ts` (`confirmProvider`), `backend/src/services/expedienteParties.service.ts` (`linkAdditionalProviderRoleInTransaction`) y `backend/src/services/operationScreening.service.ts` (reutilización H3). Las pruebas verifican resultado jurídico exacto y vigente, confirmación humana, rol adicional, objeto autorizado, screening reutilizado y CUE personal sólo cuando la regla lo exige.
- Integraciones y seguridad: `backend/src/services/complianceH5.service.ts` (`materializeSourceRequirementsTx`, `readWorkspace`, `recomputeCaseState`), `backend/src/config/tenantPrisma.ts`, `backend/src/services/complianceReview.service.ts`, las rutas/controladores H5 y las suites focalizadas H1–H4, EXP-002/003/004/008, CFG-002, IA y multitenencia.
- Invariantes físicos: `backend/prisma/schema.prisma` y `backend/prisma/migrations/20260903010000_create_h5_questionnaires_payments_provider/migration.sql`. Se validan en dos bases locales aisladas: bootstrap vacío A y actualización exacta desde H4 B. Ambas producen 11 tablas, 154 columnas, 79 constraints, 83 índices, 6 funciones, 10 triggers y 44 etiquetas enum para el inventario H5.
- Clasificación legacy: `backend/src/integration/h5-legacy-fixtures.sql` conserva un pago ambiguo y un flag ambiguo, migra únicamente sus contrapartes inequívocas y compara hashes pre/post de `pagos`, cuestionarios históricos y reglas históricas.

## Remediación forense H5-F-001

El forense independiente detectó que `h5_guard_payment_revision_link()` y
`h5_validate_payment_scope()` resolvían relaciones H5 mediante el `search_path`
de la sesión. Esto permitía provocar `42P01` o sombrear las tablas consultadas
con objetos temporales homónimos, afectando `NPAG-003`, `NPAG-005`, `NPAG-006`
y `NXINT-007`.

La migración H5 conserva una única línea de migración y ahora califica las
relaciones y tipos de aplicación con `pravia_os`, fija `search_path` a
`pg_catalog` y mantiene `SECURITY INVOKER`. La suite PostgreSQL H5 reproduce el
ataque real con `pg_temp`, verifica la inmutabilidad de Act/Party/Evidence
confirmados, conserva mutaciones DRAFT válidas y prueba ambos sentidos de las
transiciones válidas entre instrumento general y conjunto explícito de actos.
La misma suite se ejecuta sobre bootstrap vacío A y actualización H4→H5 B.
- Los 13 IDs DEFERRED/BLOCKED tienen evidencia negativa: no existe seed real de cuestionario/metodología/método/FX/efectivo/proveedor, ni writer H6/H7+/G1; los puertos quedan fail-closed o fuera de H5 según su clasificación congelada.

## Persistencia y rollback

La única migración H5 es `backend/prisma/migrations/20260903010000_create_h5_questionnaires_payments_provider/migration.sql`. Es aditiva, no siembra contenido legal/configurado y clasifica datos legacy de forma determinista, preservando los ambiguos. El rollback físico sólo es seguro en entornos efímeros sin evidencia real; en otro caso requiere exportación, conciliación y aceptación humana.
