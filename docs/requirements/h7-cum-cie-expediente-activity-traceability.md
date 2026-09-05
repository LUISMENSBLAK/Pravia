# H7 — CUM-CIE / Expediente / Activity — final traceability

Base contractual: PRAVIA v0.5 `CUM-CIE-001`, `CUM-EST-001`, integración de Cumplimiento dentro del Expediente, and PRAVIA v0.4 `EXP-009`.

| Atomic | Final status | Implementation evidence | Test evidence |
|---|---|---|---|
| H7-CIE-001 | IMPLEMENTED+TESTED | `complianceH7.ts` derived closure | `complianceH7.test.ts` |
| H7-CIE-002 | IMPLEMENTED+TESTED | current-review requirement projection | mixed-provider truth table |
| H7-CIE-003 | IMPLEMENTED+TESTED | canonical `NO_APLICA` derivation | empty/all-not-applicable cases |
| H7-CIE-004 | IMPLEMENTED+TESTED | unresolved paired deadlines | overdue and fulfilled-deadline cases |
| H7-CIE-005 | IMPLEMENTED+TESTED | canonical `LISTO` remains distinct | `LISTO` truth-table case |
| H7-CIE-006 | IMPLEMENTED+TESTED | exact tenant/case/review/requirement FK | H7 PostgreSQL A/B |
| H7-CIE-007 | IMPLEMENTED+TESTED | service validation and DB check | service reason test + PostgreSQL |
| H7-CIE-008 | IMPLEMENTED+TESTED | existing `compliance.review` permission | service permission test |
| H7-CIE-009 | IMPLEMENTED+TESTED | requirement retained; exception appended | service persistence test |
| H7-CIE-010 | IMPLEMENTED+TESTED | explicit supersession lineage | service history test |
| H7-CIE-011 | IMPLEMENTED+TESTED | canonical `AuditLog` write | service audit assertion |
| H7-CIE-012 | IMPLEMENTED+TESTED | advisory workspace; no global blocker | H7 activity integration contract |
| H7-ACT-001 | IMPLEMENTED+TESTED | canonical `ExpedienteActividad` seam | EXP-009 + H7 integration contract |
| H7-ACT-002 | IMPLEMENTED+TESTED | separate `AuditLog` and visible event writes | separation contract |
| H7-ACT-003 | IMPLEMENTED+TESTED | authorized exception activity | H7 service test |
| H7-ACT-004 | IMPLEMENTED+TESTED | questionnaire-finalized activity | H5 behavioral + H7 contract tests |
| H7-ACT-005 | IMPLEMENTED+TESTED | resource-provider activity | H5 behavioral + H7 contract tests |
| H7-ACT-006 | IMPLEMENTED+TESTED | screening-resolution activity | screening suites + H7 contract test |
| H7-ACT-007 | IMPLEMENTED+TESTED | notice-presentation activity | H6 dependent + H7 contract tests |
| H7-ACT-008 | IMPLEMENTED+TESTED | acknowledgement activity | H6 dependent + H7 contract tests |
| H7-ACT-009 | IMPLEMENTED+TESTED | unique idempotency key and `skipDuplicates` | visible-event retry test |
| H7-XINT-001 | IMPLEMENTED+TESTED | operational and compliance states remain independent | delivered-workspace service/UI cases |
| H7-XINT-002 | IMPLEMENTED+TESTED | compliance actions have no delivery cutoff | H7 integration contract |
| H7-XINT-003 | IMPLEMENTED+TESTED | EXP-005 remains operational-alert authority | EXP-005 contract/full regression |
| H7-XINT-004 | IMPLEMENTED+TESTED | one in-expediente workspace in approved populated order | H7 frontend order test |
| H7-XINT-005 | IMPLEMENTED+TESTED | canonical backend header projection | H7 frontend header test |
| H7-XINT-006 | IMPLEMENTED+TESTED | backend exact/actionable counts | domain, service and frontend tests |
| H7-XINT-007 | IMPLEMENTED+TESTED | vulnerable list/card indicator | read-model and frontend tests |
| H7-XINT-008 | IMPLEMENTED+TESTED | compliance projection in page query | no-N+1 read-model test |

Final result: **29/29 IMPLEMENTED+TESTED; 0 PARTIAL; 0 MISSING; 0 BLOCKED CONFIG/DATA.**
