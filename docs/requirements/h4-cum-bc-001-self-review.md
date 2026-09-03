# H4 CUM-BC-001 — auto-revisión posterior a remediación

Resultado: **PASS para revisión forense independiente; todavía sin checkpoint**.

Base y HEAD: `81d2f43264fd58e148d3c4ea1b8ec0dbf30c26e0`.
Rama: `codex/phase-b-expedientes`. Staging vacío. Sin commit, push, deploy, conexión productiva ni migración productiva.

## Resolución del registro congelado

| ID | Estado | Evidencia exacta |
| --- | --- | --- |
| H4-SR-001 | RESOLVED | `BeneficialControllerService.save` usa autorización canónica de Documento, contexto y objeto antes de mutar; el ataque same-tenant no relacionado está cubierto en `beneficialController.selfReview.test.ts`. |
| H4-SR-002 | RESOLVED | Cada nodo LINKED aplica autorización de objeto de Compareciente, además de tenant y tipo; denegación sin revelar identidad cubierta por pruebas adversariales. |
| H4-SR-003 | RESOLVED | `ComplianceBcScreeningService` despacha party al helper H3 canónico y non-party a requisito `LST` + consulta `MASTER` + snapshot; pre-guard valida persona, review, expediente, acto, PM y resultado antes de H3. |
| H4-SR-004 | RESOLVED | La matemática canónica usa decimales arbitrarios en `beneficialController.ts`; preserva productos positivos pequeños, multirruta y separa mínimo conocido de rutas desconocidas. |
| H4-SR-005 | RESOLVED | Raíz explícita y vinculada físicamente a la PM objetivo; UUID/XOR/self-edge/rango son rechazo duro; ciclo, parcial y desconocido persisten como marcadores reproducibles; OTHER exige hecho, confirmación y evidencia. |
| H4-SR-006 | RESOLVED | `evaluateBcRegime` solo produce resultado con revisiones H1 verificadas realmente ejecutadas; metadata sola y ausencia de regla permanecen NOT_CONFIGURED. Fixtures de reglas son exclusivamente sintéticos de test. |
| H4-SR-007 | RESOLVED | Expansión PM recursiva usa el maestro canónico actual con guardas de ciclo/profundidad; al vincular, el maestro canónico es autoridad única. Propuestas y decisiones PM/PF conservan lineage y no clonan estructuras. |
| H4-SR-008 | RESOLVED | Snapshot congela grafo expandido, referencias documentales estables, versión/checksum/rol semántico y orden canónico; fingerprint excluye metadata volátil. Triggers/FKs prueban contexto y target PM; sujeto de resultado es XOR y pertenece al snapshot. |
| H4-SR-009 | RESOLVED | Identidad lógica incluye tenant, expediente, acto/contexto, PM, fingerprint, reglas ordenadas, fecha legal, engine e inputs confirmados; lock transaccional converge reevaluación y `current_review_id` es la única autoridad actual. EV1 queda inmutable e historial separado. |
| H4-SR-010 | RESOLVED | Flujo IA ejecutable prepare/preview/confirm/reject; base revision/fingerprint bloquean stale; confirmación humana usa el editor canónico, tracking existente y auditoría. Tests usan proveedor simulado y cero llamadas reales. |
| H4-SR-011 | RESOLVED | Servicio societario explícito e idempotente por target-intent admite múltiples targets; sin CUM-MAT-002 no auto-crea. Firma hace update condicional EN_CONSTITUCION→CONSTITUIDA y audita una sola transición; estados legacy permanecen intactos. |
| H4-SR-012 | RESOLVED | Reutiliza H2 para materialización, linkExisting, uploadSigned, validación y recálculo. El puerto PF/PM existente/PM nueva devuelve NOT_CONFIGURED sin formato oficial y evidencia obsoleta no satisface una revisión reemplazo sin re-vínculo canónico. |
| H4-SR-013 | RESOLVED | `OwnershipStructureEditor` implementa selector/alta explícita, structured-only, propiedad/control, expansión, reconciliación, documentos, IA, advertencias y diagrama derivado; Expediente muestra actual vs histórico, dos regímenes y estados legales sin falso “sin BC”. |
| H4-SR-014 | RESOLVED | Los selectores frontend usan rol, nombre accesible y scope; no se cambió comportamiento productivo para satisfacer tests. |
| H4-SR-015 | RESOLVED | La única migración H4 incorpora 23/23 índices FK canónicos. DB A bootstrap y DB B H3+migración tienen igual inventario H4, y H4 no introduce índices equivalentes duplicados. |
| H4-SR-016 | RESOLVED | `h4-cum-bc-001-traceability.md` materializa H4-BC-001…072 exactamente una vez: 64 implementados+probados, 4 diferidos, 3 bloqueados legales y 1 bloqueado por formato. |
| H4-SR-017 | RESOLVED | AuditLog registra reconciliación, decisiones IA incluida stale, evaluación/resultados, vínculo documental cuando H2 no lo cubre, transición societaria y correlación screening; rollback/retry no emiten éxito falso ni duplican aplicación. |
| H4-SR-018 | RESOLVED | Eliminado exclusivamente el whitespace H4 señalado; `git diff --check` pasa. |

Resolución total: **18/18**. Hallazgos nuevos: **0**. La duplicación equivalente detectada durante la repetición A/B se clasificó y corrigió dentro de H4-SR-015, reutilizando `uq_expediente_actos_id_org_b4` en vez de crear una segunda unique equivalente.

## Validación enfocada

| Selección | Resultado |
| --- | --- |
| H4 dominio, seguridad, contrato, IA y sociedad | 68/68 PASS |
| H4 PostgreSQL A | 10/10 PASS |
| H4 PostgreSQL B | 10/10 PASS |
| Frontend H4 + dependencias H2/H3 afectadas | 25/25 PASS |
| H1 directo | 11/11 PASS |
| H2/controlador dependiente | 10/10 PASS |
| H3 directo | 81/81 PASS; 85/85 incluyendo seam de alta H3 |
| Compareciente/EXP-003 | 60/60 PASS dentro de la selección dependiente de 68/68 |
| Prisma validate / generate | PASS / PASS |
| Backend typecheck / build | PASS / PASS |
| Frontend typecheck / build | PASS / PASS |
| git diff --check | PASS |
| Secretos/PII/URLs productivas en archivos H4 | PASS: ninguno detectado |

No se ejecutaron suites globales ni llamadas IA reales.

## Dry-run PostgreSQL local

- DB A: `pravia-h4-remediation-a4-20260902`, `127.0.0.1:55460`, base `pravia_h4_remediation_a4`, inicialización canónica vacía, 50 migraciones registradas.
- DB B: `pravia-h4-remediation-b2-20260902`, `127.0.0.1:55461`, base `pravia_h4_remediation_b2`, copia exacta del H3 sintético con 49 migraciones + fixtures legacy + la única migración H4, total 50.

Selección homogénea H4 en ambos destinos: 11 tablas, 139 columnas, 87 constraints totales (32 CHECK), 65 índices físicos/otros bajo la selección H4, 8 funciones, 12 triggers y 7 enums. Inventario canónico: 518 filas, SHA-256 `edc62eea89230654d37b53593c2375c2874261c62ca97e3a5b0b08ceef26e5a6` en A y B. Delta: **MATCH**.

Los 23 índices antes exclusivos de A están presentes por nombre y definición en ambos destinos. Duplicados equivalentes introducidos por H4: **NONE**.

En B se conservaron sin reinterpretación: `ComplianceBeneficialOwner` legacy sintético, Documento de soporte preexistente, PM `ACTIVA`, PM con estado societario desconocido y hechos BC legacy. Resultados legales H4 auto-creados para el tenant fixture: **0**.

## Contabilidad de artefactos

Baseline histórico H3 certificado previamente: **511**. Se conserva como referencia histórica, no se suma con una metodología distinta.

Declaración de la migración H4: 11 tablas, 7 enums, 54 índices, 32 CHECK, 8 funciones y 12 triggers. Inventario físico H4 homogéneo A/B: 11 tablas, 65 índices/otros, 32 CHECK, 8 funciones y 12 triggers. Total global homogéneo: **NOT CERTIFIABLE**, porque el baseline 511 emplea una metodología histórica diferente.

## Cierre

Los 64 requisitos diseñables están implementados y probados. Permanecen correctamente fuera de implementación: H4-BC-054/069/070/071 (diferidos), H4-BC-015/037/038 (bloqueados por datos legales) y H4-BC-051 (bloqueado por formato oficial). H4 queda listo para revisión forense independiente, no para checkpoint automático.

## Remediación forense dirigida H4-F-001…H4-F-010

Esta sección sustituye únicamente la evidencia que el forensic independiente refutó; no reabre ni vuelve a acreditar por conteo estático los 18 hallazgos de auto-revisión anteriores.

| Finding | Resolución ejecutable |
| --- | --- |
| H4-F-001 | `facts_snapshot` se congeló como arreglo ordenado en dominio, servicio y `ck_h4_result_snapshots`; materialización positiva real en PostgreSQL A/B. |
| H4-F-002 | Una ejecución por sujeto referencia una única identidad H1 por regla/acto; varios sujetos y resultados positivos se materializan sin duplicar `ComplianceRuleResult`. |
| H4-F-003 | Resultado, ejecución, nodo congelado y sujeto exacto quedan ligados por trigger y por el guard independiente `bcResultExecutions`; ataques de intercambio se rechazan antes de H3. |
| H4-F-004 | Toda identidad LINKED se proyecta sólo después de `comparecienteObjectWhere`; pruebas cubren denegación same-tenant, lectura autorizada y tenant ajeno. |
| H4-F-005 | Reutilizar una revisión histórica vuelve a derivar CUM-EST desde los requisitos actuales; nunca restaura `canonical_state_snapshot`. |
| H4-F-006 | Conciliación PM/PF exige preview del origen, destino y propuesta; aceptar persiste exactamente la propuesta revisada en el único maestro PM y rechazar no altera el destino. |
| H4-F-007 | IA conserva prepare-only, congela evidencia y token semántico, expone todos los hechos y exige el grafo exactamente revisado; stale/reject no escriben el maestro. |
| H4-F-008 | El diagrama consume `expanded` como proyección de sólo lectura del maestro; no persiste layout ni una segunda estructura. |
| H4-F-009 | Expediente proyecta sujetos autorizados, soporte por la ficha documental canónica, actual/histórico separados y reevaluación explícita; sólo CFF/RMF N/A verificado se oculta. |
| H4-F-010 | Se restauró exactamente el espaciado HEAD de `Expediente.tipo_acto`; `expedienteActos.contract.test.ts` permanece byte-for-byte sin cambios. |

Evidencia final dirigida: PostgreSQL A 22/22, PostgreSQL B 22/22, catálogo físico A/B idéntico, 23/23 índices históricos equivalentes, UI física sin overflow en 320/390/768, Prisma validate/generate PASS, typechecks y builds backend/frontend PASS. Los 18 requisitos antes parciales fueron re-ejercitados mediante pruebas de dominio/servicio, autoridad real, PostgreSQL y UI; el recuento contractual permanece 64/64 implementados y probados, 0 parciales y 0 faltantes.
