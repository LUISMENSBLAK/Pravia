# H9 · CUM-AUD-001 · Revisión asistida de Cumplimiento

Fuente contractual: `PRAVIA_OS_Documento_Maestro_Diseno_Funcional_v0.5_CUMPLIMIENTO_NOTARIA_APROBADO.docx`, CUM-AUD-001 y dependencias H1–H8 indicadas. Matriz congelada contra `4c4c93c41ec3e18ef9e96f98b6e725d66eb21dad`. Todos los atómicos quedan **IMPLEMENTED+TESTED**.

Leyenda: `D` base de datos, `U` interfaz, `T` prueba. Las decisiones `REUSE`, `EXTEND` y `NEW` se limitan a autoridades existentes; no existe sustitución de H1–H8.

| # | Atomic | Fuente y requisito | Autoridad / decisión | Evidencia D · U · T |
|---:|---|---|---|---|
| 1 | H9-AUD-001 | Acción exacta “Revisar Cumplimiento” | Cumplimiento / EXTEND | — · `H9AssistedReviewWorkspace` · `ComplianceH9.test.tsx` |
| 2 | H9-AUD-002 | No exponer “Auditoría” como nombre H9 | UI / EXTEND | — · componente H9 · test de terminología |
| 3 | H9-AUD-003 | Ejecución sólo manual | rutas / NEW | — · botón explícito · test sin auto-run |
| 4 | H9-AUD-004 | No ejecutar al cargar | React / REUSE | — · `useEffect` sólo lee · test sin invocación |
| 5 | H9-AUD-005 | Readiness suficiente | contexto H1 / REUSE | snapshot · causas/READY · domain test |
| 6 | H9-AUD-006 | Readiness insuficiente, no revisión vacía | backend / NEW | sin insert · causas accionables · service test |
| 7 | H9-XINT-001 | Acceso de objeto | `expedienteAccessWhere` / REUSE | scope tenant · — · service test |
| 8 | H9-XINT-002 | Exclusión cross-tenant | FKs/scope / REUSE | FKs compuestas · — · PostgreSQL test |
| 9 | H9-AUD-007 | Comparecientes actuales | EXP-003 / REUSE | dataset snapshot · — · service/contract tests |
| 10 | H9-AUD-008 | Roles actuales | `ExpedienteCompareciente.caracter` / REUSE | manifest · enlaces · contract test |
| 11 | H9-AUD-009 | Comparación RFC | Persona Física/Moral / REUSE | dataset allowlist · bloque identidad · AI schema test |
| 12 | H9-AUD-010 | Comparación CURP | Persona Física / REUSE | dataset allowlist · bloque identidad · AI schema test |
| 13 | H9-AUD-011 | Comparación domicilios | domicilios vigentes / REUSE | dataset snapshot · bloque identidad · service test |
| 14 | H9-AUD-012 | Comparación fechas | fuentes estructuradas / REUSE | dataset snapshot · enlaces · contract test |
| 15 | H9-AUD-013 | Proyecto/escritura como fuente | H6 / REUSE | pin exacto · bloque proyecto · source test |
| 16 | H9-AUD-014 | Prioridad escritura definitiva | `selectCanonicalDeed` / REUSE | rol pinneado · — · H6 + contract test |
| 17 | H9-AI-001 | Persona documental ausente | dataset+IA cerrada / NEW | snapshot · observación enlazada · schema test |
| 18 | H9-AI-002 | Rol documental discordante | dataset+IA cerrada / NEW | snapshot · observación enlazada · schema test |
| 19 | H9-AUD-015 | Consistencia de formato firmado | H2 / REUSE | document state/version · Documental · contract test |
| 20 | H9-AI-003 | No autenticar firma | límites IA / NEW | — · copy no jurídica · contract test |
| 21 | H9-AUD-016 | Reusar BC pinneado | H4 / REUSE | evaluation/snapshot · BC · contract test |
| 22 | H9-AI-004 | No determinar BC por aritmética | H4 / REUSE | sin writer · — · contract test |
| 23 | H9-AUD-017 | Reusar pagos H5 | H5 current revision / REUSE | fingerprint H5 · Pagos · contract test |
| 24 | H9-AI-005 | Pago ↔ comprobante | H5 evidence / REUSE | source refs · Pagos · AI schema test |
| 25 | H9-AI-006 | Pago ↔ proyecto/escritura | H5 verification/H6 / REUSE | pins · Pagos/Proyecto · schema test |
| 26 | H9-AUD-018 | Reusar screening | H3 / REUSE | current results · Screening · contract test |
| 27 | H9-AI-007 | No resolver screening | H3 / REUSE | sin writer · — · contract test |
| 28 | H9-AUD-019 | Reusar cuestionario | H5 / REUSE | current revision · Cuestionarios · contract test |
| 29 | H9-AI-008 | No responder cuestionarios | H5 / REUSE | sin writer · — · contract test |
| 30 | H9-AUD-020 | Reusar ficha AVI | H6 / REUSE | current fiche · Avisos · contract test |
| 31 | H9-AUD-021 | Generado ≠ presentado | H6 / REUSE | entidades separadas · UI factual · contract test |
| 32 | H9-AUD-022 | Presentado ≠ cumplido | H6/H7 / REUSE | sin mutación · UI factual · contract test |
| 33 | H9-AUD-023 | Manifest exacto | patrón H6 / EXTEND | `source_manifest` · fuentes visibles · domain test |
| 34 | H9-AUD-024 | Fingerprint sólo fuentes consumidas | manifest H9 / NEW | hash estable · — · domain test |
| 35 | H9-AUD-025 | Cambio irrelevante no stale | manifest H9 / NEW | exclusión semántica · — · domain test |
| 36 | H9-AUD-026 | Cambio documental stale | manifest H9 / NEW | checksum/version · DESACTUALIZADA · domain test |
| 37 | H9-AUD-027 | Cambio pago stale | fingerprint H5 / REUSE | manifest PAG · DESACTUALIZADA · domain test |
| 38 | H9-AUD-028 | Cambio BC stale | logical hash H4 / REUSE | manifest BC · DESACTUALIZADA · domain test |
| 39 | H9-AUD-029 | Proyecto→escritura stale | selector H6 / REUSE | rol/source ref · DESACTUALIZADA · domain test |
| 40 | H9-AUD-030 | Cambio ficha AVI stale | source fingerprint H6 / REUSE | manifest AVI · DESACTUALIZADA · domain test |
| 41 | H9-AUD-031 | Explicar fuente cambiada | diff manifest / NEW | cambios calculados · lista humana · UI/domain tests |
| 42 | H9-AUD-032 | Revisar nuevamente crea fila nueva | idempotency manual / NEW | append-only · botón · service/UI tests |
| 43 | H9-AUD-033 | Preservar revisión previa | master H9 / NEW | historial · detalles read-only · DB/UI tests |
| 44 | H9-AUD-034 | Completada inmutable | trigger H9 / NEW | UPDATE/DELETE bloqueados · read-only · PostgreSQL test |
| 45 | H9-AUD-035 | Usuario/fecha exactos | membership/time DB / REUSE | actor+created_at · metadata UI · service test |
| 46 | H9-AUD-036 | Documento/versión exactos | H2/H6 / REUSE | pins snapshot · historial · service test |
| 47 | H9-AI-009 | Provenance modelo/prompt/schema | ledger/model routing / REUSE | metadata persistida · — · service test |
| 48 | H9-AUD-037 | Doble click idempotente | clave única/lock / NEW | unique+advisory lock · botón disabled · tests |
| 49 | H9-AUD-038 | Retry técnico sin duplicado | idempotency / NEW | early/locked lookup · — · service test |
| 50 | H9-AI-010 | Fallo IA no crea clean | AI seam / NEW | sin review success · error humano · service test |
| 51 | H9-AI-011 | Salida estructurada validada | Responses JSON Schema / REUSE | resultado cerrado · — · domain/contract tests |
| 52 | H9-AI-012 | Conteo correcto exacto | validator H9 / NEW | count persistido · métrica · domain/UI tests |
| 53 | H9-AI-013 | Observaciones | schema H9 / NEW | JSON snapshot · cards · tests |
| 54 | H9-AI-014 | Inconsistencias críticas | schema H9 / NEW | JSON snapshot · prioridad visual · tests |
| 55 | H9-AI-015 | Sin score | límites/validator / NEW | campo rechazado · sin UI · domain/UI tests |
| 56 | H9-AUD-039 | Mensaje clean exacto | contrato CUM-AUD / NEW | — · copy exacta · UI test |
| 57 | H9-AUD-040 | Enlace de fuente | source refs / NEW | manifest · card · validator/UI tests |
| 58 | H9-AUD-041 | Bloque/action target | deep links actuales / REUSE | — · anchor contextual · validator/UI tests |
| 59 | H9-XINT-003 | Crítica no muta CUM-EST | H7 / REUSE | sin writer · — · contract test |
| 60 | H9-XINT-004 | Clean no completa CUM-EST | H7 / REUSE | sin writer · disclaimer · contract test |
| 61 | H9-XINT-005 | No mutar requirements | H1–H7 / REUSE | sin writer · — · contract test |
| 62 | H9-XINT-006 | No mutar BC | H4 / REUSE | sin writer · — · contract test |
| 63 | H9-XINT-007 | No mutar pagos | H5 / REUSE | sin writer · — · contract test |
| 64 | H9-XINT-008 | No mutar AVI | H6 / REUSE | sin writer · — · contract test |
| 65 | H9-XINT-009 | No mutar screening | H3 / REUSE | sin writer · — · contract test |
| 66 | H9-XINT-010 | Actividad EXP-009 | H7 activity seam / REUSE | actividad idempotente · timeline · service test |
| 67 | H9-XINT-011 | Retry sin actividad duplicada | EXP-009 idempotency / REUSE | no transacción en retry · — · service test |
| 68 | H9-XINT-012 | AuditLog separado | AuditLog / REUSE | sólo metadata segura · — · service test |
| 69 | H9-AUD-042 | Historial UI | master append-only / NEW | rows históricas · details/cards · UI test |
| 70 | H9-AUD-043 | Estado stale UI | manifest diff / NEW | freshness calculada · DESACTUALIZADA · UI test |
| 71 | H9-AUD-044 | Responsive 320 | UI H9 / NEW | — · cards sin tabla · parametrized UI test |
| 72 | H9-AUD-045 | Responsive 390 | UI H9 / NEW | — · cards sin tabla · parametrized UI test |
| 73 | H9-AUD-046 | Responsive 768 | UI H9 / NEW | — · cards sin tabla · parametrized UI test |
| 74 | H9-AUD-047 | Desktop sin overflow horizontal | UI H9 / NEW | — · min-width/overflow/card grid · parametrized UI test |
| 75 | H9-XINT-013 | Regresión dependiente H1–H8 | suites existentes / REUSE | migración A/B · integración Cumplimiento · full suites |

## Freeze técnico

- Persistencia: una sola tabla `compliance_assisted_reviews`; no child tables.
- Cierre: `ExpedienteComplianceState`/H7 continúa como única autoridad determinista.
- IA: seam inyectable y Responses API con JSON Schema estricto; tests sin red.
- Consumo: ledger canónico `AIUsageLog`; `AuditLog` conserva únicamente metadata técnica segura.
- Freshness: comparación del manifest semántico almacenado contra las mismas fuentes autorizadas actuales.
- Antigüedad documental: H9 no añade ningún plazo predeterminado.
