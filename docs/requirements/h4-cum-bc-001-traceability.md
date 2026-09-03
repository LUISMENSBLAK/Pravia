# H4 · CUM-BC-001 · Trazabilidad contractual

Autoridad de implementación para la estructura vigente conocida de propiedad/control y su consumo inmutable por Cumplimiento. No activa reglas jurídicas, fuentes ni formatos oficiales. La evidencia se acredita con rutas ejecutables y pruebas enfocadas; las ocho dependencias externas conservan su clasificación contractual.

| ID | Cláusula atómica | Evidencia de implementación | Estado |
| --- | --- | --- | --- |
| H4-BC-001 | La estructura maestra pertenece a Compareciente → Persona Moral. | `schema.prisma`; `BeneficialControllerService.root/save`; trigger de raíz; pruebas de grafo/PG. | IMPLEMENTED + TESTED |
| H4-BC-002 | Cumplimiento consume la estructura maestra y no crea otra base. | `prepareReviewTx/materializeForReviewTx`; snapshot H4; test contractual. | IMPLEMENTED + TESTED |
| H4-BC-003 | La estructura representa sólo el estado vigente conocido. | Único `PersonaMoralOwnershipStructure` por tenant/PM; índice único; pruebas PG. | IMPLEMENTED + TESTED |
| H4-BC-004 | No existe historial estructurado de cap table. | Reemplazo del grafo vigente; historia únicamente en snapshots operativos inmutables y AuditLog. | IMPLEMENTED + TESTED |
| H4-BC-005 | Una fila puede vincular un Compareciente existente. | Nodo `LINKED`; selector canónico; autorización por objeto; pruebas backend/frontend. | IMPLEMENTED + TESTED |
| H4-BC-006 | Una fila puede ser sólo estructurada dentro de la PM. | Nodo `STRUCTURED_ONLY`; XOR físico; editor y pruebas. | IMPLEMENTED + TESTED |
| H4-BC-007 | No se auto-crean Comparecientes por accionista. | `save` sólo enlaza IDs autorizados; creación aparece como acción humana separada. | IMPLEMENTED + TESTED |
| H4-BC-008 | Vincular/crear persona identificada exige acción humana. | `previewLinks`, confirmación de identidad y enlace a creación canónica. | IMPLEMENTED + TESTED |
| H4-BC-009 | Una PM vinculada se expande desde su estructura canónica vigente. | `BeneficialControllerService.expand`; prueba de expansión y fingerprint. | IMPLEMENTED + TESTED |
| H4-BC-010 | Rama PM desconocida queda explícitamente incompleta. | `UNKNOWN_CANONICAL_BRANCH`/marcadores; validación y UI. | IMPLEMENTED + TESTED |
| H4-BC-011 | La estructura exige una raíz explícita ligada a la PM objetivo. | `root_node_id`; `validateBcGraph`; `h4_validate_structure_root`. | IMPLEMENTED + TESTED |
| H4-BC-012 | La raíz no se deriva de metadata ni del primer nodo. | Dominio y servicio usan sólo `root_node_id`; pruebas de mismatch. | IMPLEMENTED + TESTED |
| H4-BC-013 | IDs, tenant, tipo e identidad XOR se validan antes y en DB. | `isBcUuid`, object auth, checks/FKs/triggers; pruebas adversariales. | IMPLEMENTED + TESTED |
| H4-BC-014 | La sociedad en constitución tiene infraestructura explícita e idempotente. | `ensureSociety`, `ExpedienteSocietyTarget`, advisory lock y auditoría. | IMPLEMENTED + TESTED |
| H4-BC-015 | Activar creación automática sólo con CUM-MAT-002 verificado. | `societyOpeningStatus` devuelve `NOT_CONFIGURED`; no auto-creación. | BLOCKED LEGAL DATA |
| H4-BC-016 | Una finalidad de sociedad reutiliza el target explícitamente vinculado. | `target_intent_key`, conflicto de identidad y prueba de retry. | IMPLEMENTED + TESTED |
| H4-BC-017 | Varias finalidades/actos pueden representar targets distintos. | Identidad incluye expediente, acto e intención; esquema sin cardinalidad 1:1 global. | IMPLEMENTED + TESTED |
| H4-BC-018 | Firma cambia únicamente EN_CONSTITUCION → CONSTITUIDA. | `ExpedienteFirmado`; `markSocietyConstitutedTx` con update condicional. | IMPLEMENTED + TESTED |
| H4-BC-019 | Firma concurrente produce una transición y auditoría efectivas. | `updateMany` condicional; auditoría sólo con count=1; prueba enfocada. | IMPLEMENTED + TESTED |
| H4-BC-020 | Estados legacy ACTIVA/desconocidos no se reinterpretan. | Filtro estricto `EN_CONSTITUCION`; prueba PG/servicio. | IMPLEMENTED + TESTED |
| H4-BC-021 | Propiedad/titularidad se modela separada de control. | `PersonaMoralOwnershipEdge` versus `PersonaMoralControlFact`. | IMPLEMENTED + TESTED |
| H4-BC-022 | Porcentaje individual admite null o rango 0..100. | Decimal(9,6), check físico y validación de dominio. | IMPLEMENTED + TESTED |
| H4-BC-023 | Totales parciales o mayores a 100 no se normalizan. | Marcadores `PARTIAL_OWNERSHIP`/`AGGREGATE_OVER_100`; pruebas. | IMPLEMENTED + TESTED |
| H4-BC-024 | Cadenas conocidas calculan participación indirecta con precisión arbitraria. | Matemática decimal canónica; prueba de 0.000001% × 0.000001%. | IMPLEMENTED + TESTED |
| H4-BC-025 | Rutas múltiples se suman con orden determinista. | `calculateBcOwnership`; orden canónico; prueba 20+30/indirecta. | IMPLEMENTED + TESTED |
| H4-BC-026 | Ruta conocida + desconocida produce mínimo conocido e incompletitud. | `known_minimum`, total `null`, `incomplete`; prueba. | IMPLEMENTED + TESTED |
| H4-BC-027 | Ciclos se guardan para revisión, sin resultado jurídico. | `validateBcGraph` + `evaluateBcRegime`; pruebas. | IMPLEMENTED + TESTED |
| H4-BC-028 | Guardas de profundidad impiden expansión no acotada. | `expand` y cálculo con límite/cycle guard; pruebas de dominio. | IMPLEMENTED + TESTED |
| H4-BC-029 | Hechos de control usan taxonomía neutral y separada. | Enum VOTE/APPOINTMENT/MANAGEMENT/AGREEMENT/OTHER. | IMPLEMENTED + TESTED |
| H4-BC-030 | OTHER exige descripción, evidencia y confirmación humana. | Validación dominio, check PG y editor; pruebas. | IMPLEMENTED + TESTED |
| H4-BC-031 | La matemática nunca determina BC por sí sola. | Evaluador requiere pack H1 verificado; no umbral H4 embebido. | IMPLEMENTED + TESTED |
| H4-BC-032 | La misma estructura alimenta dos evaluadores separados. | Ciclo LFPIORPI/CFF_RMF en materialización; prueba sintética. | IMPLEMENTED + TESTED |
| H4-BC-033 | Ambos regímenes pueden identificar sujetos distintos. | Packs independientes; prueba sintética divergente. | IMPLEMENTED + TESTED |
| H4-BC-034 | Se soportan múltiples sujetos BC por evaluación. | Agrupación y materialización de varios resultados; prueba. | IMPLEMENTED + TESTED |
| H4-BC-035 | Cero sujetos sólo existe tras determinación verificada ejecutada. | `evaluateBcRegime` + trigger de reglas ejecutadas; prueba. | IMPLEMENTED + TESTED |
| H4-BC-036 | Sin regla verificada no se afirma BC, no-BC ni no-aplica. | `NOT_CONFIGURED`, resultados vacíos y UI no concluyente. | IMPLEMENTED + TESTED |
| H4-BC-037 | Reglas oficiales LFPIORPI de determinación BC. | Puerto H1 listo; no existe seed oficial en H4. | BLOCKED LEGAL DATA |
| H4-BC-038 | Reglas oficiales CFF/RMF de aplicabilidad/determinación. | Puerto H1 listo; no existe seed oficial en H4. | BLOCKED LEGAL DATA |
| H4-BC-039 | Sólo revisiones H1 activas/verificadas ejecutan evaluación. | Selección H1, `evaluateBcRegime`, trigger `h4_validate_evaluation_context`. | IMPLEMENTED + TESTED |
| H4-BC-040 | Inputs, reglas, fecha legal y motor forman identidad lógica. | `bcLogicalHash(identity)` antes del review; pruebas. | IMPLEMENTED + TESTED |
| H4-BC-041 | Misma evaluación lógica converge bajo lock/idempotencia. | Reuso H1 de review idéntico y advisory locks; prueba dependiente H1. | IMPLEMENTED + TESTED |
| H4-BC-042 | Cambio de estructura/reglas produce nueva evaluación. | Fingerprint/rule checksums en identidad; `supersedes_evaluation_id`. | IMPLEMENTED + TESTED |
| H4-BC-043 | EV1 permanece inmutable tras S1→S2. | Snapshots/evaluaciones/resultados inmutables; pruebas dominio/PG. | IMPLEMENTED + TESTED |
| H4-BC-044 | Current usa exclusivamente `ExpedienteComplianceState.current_review_id`. | `caseSummary`; current e history separados; frontend. | IMPLEMENTED + TESTED |
| H4-BC-045 | Desalineación estructura/reglas marca reevaluación requerida sin EV automática. | `caseSummary.reevaluation_required`; UI accionable. | IMPLEMENTED + TESTED |
| H4-BC-046 | Snapshot congela grafo expandido, control, incompletitud y evidencia. | `prepareReviewTx`; `graph_snapshot`; fingerprint semántico. | IMPLEMENTED + TESTED |
| H4-BC-047 | Evidencia conserva Documento, versión, checksum y rol semántico. | Campos frozen en edges/controls; `complianceDocumentVersion`; pruebas. | IMPLEMENTED + TESTED |
| H4-BC-048 | Resultado satisface XOR Compareciente/nodo del snapshot. | Check `ck_h4_result_subject` y trigger de membership. | IMPLEMENTED + TESTED |
| H4-BC-049 | Snapshot/evaluación preservan tenant, expediente, acto y PM exactos. | FKs compuestas/triggers; pruebas PG. | IMPLEMENTED + TESTED |
| H4-BC-050 | Requisitos documentales BC reutilizan CUM-DOC/H2. | `materializeForRuleResultTx`, `linkExisting`, `uploadSigned`, validación H2. | IMPLEMENTED + TESTED |
| H4-BC-051 | Archivos oficiales PF/PM existente/PM nueva y mappings concretos. | `ComplianceBcFormatMapping` queda `NOT_CONFIGURED`; sin archivo ficticio. | BLOCKED FORMAT |
| H4-BC-052 | El puerto de formato distingue PF, PM existente y PM nueva. | `formatPort`; test contractual/servicio. | IMPLEMENTED + TESTED |
| H4-BC-053 | Documento no firmado no satisface el requisito firmado. | Ciclo H2 canónico y pruebas dependientes. | IMPLEMENTED + TESTED |
| H4-BC-054 | Orquestación integral Generar→Firma→Carga→Validación. | H4 conserva puerto H2; orquestación plena corresponde a H6. | DEFERRED |
| H4-BC-055 | Evidencia de review obsoleto no satisface automáticamente el reemplazo. | Requisitos H2 por `review_id`; materialización por nuevo review. | IMPLEMENTED + TESTED |
| H4-BC-056 | Screening de BC identificado reutiliza H3, sin rol/proveedor nuevo. | `ComplianceBcScreeningAdapter`; provider LST + MASTER. | IMPLEMENTED + TESTED |
| H4-BC-057 | Rama party usa relación activa y helper canónico. | `ensureOperationScreeningForPartyTx`; prueba real enfocada. | IMPLEMENTED + TESTED |
| H4-BC-058 | Rama non-party crea/reusa requisito LST y snapshot sin inventar parte. | Adapter, `queueMasterScreeningTx`, `linkOperationSnapshotTx`; prueba. | IMPLEMENTED + TESTED |
| H4-BC-059 | Guards rechazan persona/review/expediente/acto/PM incorrectos antes de H3. | Validación explícita y pruebas adversariales. | IMPLEMENTED + TESTED |
| H4-BC-060 | Edición maestra y acciones sensibles respetan RBAC/tenant/object auth. | `need`, `root`, `comparecienteObjectWhere`, `canAccessDocumento`; pruebas. | IMPLEMENTED + TESTED |
| H4-BC-061 | Documento soporte sólo puede usarse en su target autorizado. | `authorizedSource`/save exact-target; pruebas same-tenant IDOR. | IMPLEMENTED + TESTED |
| H4-BC-062 | AuditLog registra acciones efectivas y no sobre rollback/retry. | Auditorías H4 dentro de transacciones e idempotencia; pruebas. | IMPLEMENTED + TESTED |
| H4-BC-063 | La infraestructura de sociedad no activa aplicabilidad sin mapping legal. | `societyOpeningStatus`; UI/API accionable `NOT_CONFIGURED`. | IMPLEMENTED + TESTED |
| H4-BC-064 | IA sólo prepara propuesta desde documento autorizado. | `proposeAi`; fuente con checksum; no muta estructura. | IMPLEMENTED + TESTED |
| H4-BC-065 | Propuesta IA congela revisión/fingerprint/documento/páginas/modelo. | `ComplianceBcAiProposal`; pruebas. | IMPLEMENTED + TESTED |
| H4-BC-066 | Confirmar/rechazar IA exige decisión humana autorizada. | `decideAi`; audit confirm/reject; frontend. | IMPLEMENTED + TESTED |
| H4-BC-067 | Propuesta IA obsoleta se bloquea sin escribir master. | Guard base fingerprint/version/checksum; 409 y auditoría. | IMPLEMENTED + TESTED |
| H4-BC-068 | Diagrama es derivado, responsive y no constituye segunda verdad. | `OwnershipStructureEditor`; test 320/390 accesible. | IMPLEMENTED + TESTED |
| H4-BC-069 | Integración de pagos CUM-PAG. | Sin implementación H5 dentro de H4. | DEFERRED |
| H4-BC-070 | Integración de cierre CUM-CIE. | Sin implementación H7 dentro de H4. | DEFERRED |
| H4-BC-071 | Expansión de alertas administrativas/panel G1. | Sin implementación G1 dentro de H4. | DEFERRED |
| H4-BC-072 | UI de PM y expediente distingue current/history, dos regímenes y estados no concluyentes. | Editor, `ComplianceTab`, servicios tipados y pruebas frontend. | IMPLEMENTED + TESTED |

## Recuento vinculante

- Requisitos atómicos: 72.
- Diseñables: 64; implementados y probados: 64.
- Diferidos: 4.
- Bloqueados por datos jurídicos: 3.
- Bloqueado por archivos de formato: 1.

## Migración y rollback

La única migración H4 es `backend/prisma/migrations/20260902010000_create_h4_beneficial_controller/migration.sql`. Es aditiva, no contiene seeds ni backfill productivo y preserva `ComplianceBeneficialOwner`, documentos soporte y estados societarios legacy. El rollback físico sólo procede sobre entornos efímeros sin evidencia real; con snapshots/evaluaciones reales exige exportación y aceptación humana previa.
