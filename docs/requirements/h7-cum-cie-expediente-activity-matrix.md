# H7 — CUM-CIE / Expediente / Activity — frozen atomic matrix

Frozen against PRAVIA v0.5 CUM-CIE-001 and v0.4 EXP-009 at base `b7d72bcf8554992d3905dff52925ce08a4bca7ef`.

| ID | Source | Atomic requirement | Existing authority | Decision | DB | UI | Test evidence |
|---|---|---|---|---|---|---|---|
| H7-CIE-001 | v0.5 CUM-CIE 1 | Closure is derived only | `deriveComplianceState` | REUSE | none | state header | truth table |
| H7-CIE-002 | v0.5 CUM-CIE 1 | All current applicable requirements participate | `ComplianceRequirement` | EXTEND | none | missing count | mixed providers |
| H7-CIE-003 | v0.5 CUM-EST | Zero/all not-applicable resolves to No aplica | `deriveComplianceState` | REUSE | none | label | truth table |
| H7-CIE-004 | v0.5 CUM-EST | Any overdue unresolved item resolves to Vencido | `deriveComplianceState` | REUSE | none | badge | truth table |
| H7-CIE-005 | v0.5 CUM-EST | Listo is not complete | `deriveComplianceState` | REUSE | none | label | truth table |
| H7-CIE-006 | v0.5 CUM-CIE 4 | Exception targets an exact requirement | none | NEW | exception FK | requirement action | service test |
| H7-CIE-007 | v0.5 CUM-CIE 4 | Exception requires a substantive reason | validation/RBAC | EXTEND | check | dialog | validation test |
| H7-CIE-008 | v0.5 CUM-CIE 3–4 | Exception requires elevated existing permission | `compliance.review` | REUSE | permission snapshot | capability | authorization test |
| H7-CIE-009 | v0.5 CUM-CIE 4 | Exception preserves requirement and evidence | `ComplianceRequirement` | EXTEND | append-only relation | resolution label | persistence test |
| H7-CIE-010 | v0.5 CUM-CIE 4 | Replacement preserves exception history | none | NEW | supersession lineage | current/history | history test |
| H7-CIE-011 | v0.5 CUM-CIE 4 | Exception writes technical audit | `AuditLog` | REUSE | audit row | none | audit test |
| H7-CIE-012 | v0.5 CUM-CIE 6 | No global hard block is introduced | existing advisory model | REUSE | none | advisory only | contract test |
| H7-ACT-001 | v0.4 EXP-009 | Visible compliance events use ExpedienteActividad | `ExpedienteActividad` | EXTEND | none | Activity tab | source test |
| H7-ACT-002 | v0.4 EXP-009 | Audit remains a separate technical record | `AuditLog` | REUSE | none | not rendered | separation test |
| H7-ACT-003 | v0.5 CUM-CIE 8 | Exception produces concise visible activity | EXP-009 | EXTEND | activity row | activity item | service test |
| H7-ACT-004 | v0.5 CUM-CIE 8 | Questionnaire finalization is visible | H5 writer | EXTEND | activity row | activity item | writer test |
| H7-ACT-005 | v0.5 CUM-CIE 8 | Provider confirmation is visible | H5 writer | EXTEND | activity row | activity item | writer test |
| H7-ACT-006 | v0.5 CUM-CIE 8 | Screening resolution is visible | H3 writer | EXTEND | activity row | activity item | writer test |
| H7-ACT-007 | v0.5 CUM-CIE 8 | Notice presentation is visible | H6 writer | EXTEND | activity row | activity item | writer test |
| H7-ACT-008 | v0.5 CUM-CIE 8 | Acknowledgement registration is visible | H6 writer | EXTEND | activity row | activity item | writer test |
| H7-ACT-009 | v0.5 CUM-CIE 8 | Retries do not duplicate visible activity | EXP-009 idempotency | REUSE | unique key | one event | idempotency test |
| H7-XINT-001 | v0.5 integration | Entregado may retain pending compliance | independent state models | REUSE | none | dual state | contract test |
| H7-XINT-002 | v0.5 integration | Post-delivery AVI/ack/exception/recompute remains enabled | compliance routes | REUSE | none | actions enabled | route test |
| H7-XINT-003 | v0.5 integration | Operational alerts remain stopped after delivery | EXP-005 | REUSE | none | none | dependent test |
| H7-XINT-004 | v0.5 integration | One compliance workspace in approved block order | Compliance tab | REPLACE | none | reordered blocks | UI test |
| H7-XINT-005 | v0.5 integration | Header consumes canonical backend state | H7 read model | NEW | none | summary header | UI test |
| H7-XINT-006 | v0.5 integration | Exact actionable pending count comes from backend | state projection | EXTEND | none | count | API/UI test |
| H7-XINT-007 | v0.5 integration | Expediente list includes vulnerable indicator | legal rule result | EXTEND | none | compact badge | read-model test |
| H7-XINT-008 | v0.5 integration | Expediente list includes compliance indicator without N+1 | compliance state join | EXTEND | none | compact badge | query-shape/UI test |

Freeze result: **29 designable atomics; 0 unresolved functional contradictions.**
