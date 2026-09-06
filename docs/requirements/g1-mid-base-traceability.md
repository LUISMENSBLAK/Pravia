# G1 — MID-BASE canonical sources traceability

## Freeze

- Contract sources: approved PRAVIA OS functional design v0.4 and v0.5, sections `MID-BASE`, `PRO-001`, `COT-001`, `CFG-001`, `EXP-005`, and `EXP-008`.
- Technical parent: `e344c9c53777471acfe7d3f7b1ce40a7ecc94cd1`.
- Scope: canonical read sources for a future Mi Día composition. This phase does not define the final experience or a cross-domain priority algorithm.
- Historical matrix search: no physical 35-item MID-BASE matrix was present. The earlier gap analysis contained only the aggregate MID-BASE delta, so the stable IDs required by the approved G1 contract are frozen here.

## Atomic matrix

| ID | Atomic requirement | Status | Evidence |
|---|---|---|---|
| G1-MID-001 | Expose a stable discriminated read contract for the five approved source categories. | IMPLEMENTED+TESTED | `midBaseSources.ts`; focused source-contract tests. |
| G1-MID-002 | Provide an internal authenticated `GET /mi-dia/sources` read endpoint without replacing legacy Mi Día. | IMPLEMENTED+TESTED | `miDia.routes.ts`; `MiDiaController.sources`. |
| G1-MID-003 | Reuse PRO-001 current stage and transition lineage. | IMPLEMENTED+TESTED | Prospect query and mapping; G0-A dependent regression. |
| G1-MID-004 | Use the PRO-001 effective transition date, never generic creation/update timestamps, as stage authority. | IMPLEMENTED+TESTED | Prospect select omits `updated_at`; journey tests. |
| G1-MID-005 | Preserve `UNKNOWN_LEGACY` when a prospect stage lacks a demonstrable canonical transition. | IMPLEMENTED+TESTED | Prospect fallback and journey 2. |
| G1-MID-006 | Distinguish client, office and Notary prospect waiting parties. | IMPLEMENTED+TESTED | Reuses `prospectWait`; focused tests. |
| G1-MID-007 | Expose Notary request pending, sent, waiting and received facts from PRO-001/notarial-source state. | IMPLEMENTED+TESTED | `notaryFact`; focused tests. |
| G1-MID-008 | Expose only a real prospect responsible user. | IMPLEMENTED+TESTED | PRO-001 `user_id`; no synthetic assignment. |
| G1-MID-009 | Reuse COT-001 canonical stages and transition lineage. | IMPLEMENTED+TESTED | Quote query and `quoteStageLabel`; G0-B regression. |
| G1-MID-010 | Expose immutable first send from the first `ENVIAR_CLIENTE` transition. | IMPLEMENTED+TESTED | Batched distinct first-send query; journey 3. |
| G1-MID-011 | Represent post-send waiting as client waiting without internal urgency. | IMPLEMENTED+TESTED | `waitingOn=CLIENT`, `internalUrgency=null`; negative tests. |
| G1-MID-012 | Keep acceptance/advance as a COT-001 commercial fact independent from payment. | IMPLEMENTED+TESTED | Quote milestone maps COT-001 fields only. |
| G1-MID-013 | Keep suspended, cancelled and converted quotes historical and non-active. | IMPLEMENTED+TESTED | `quoteActive`; focused terminal-stage tests. |
| G1-MID-014 | Expose real quote responsibility and source relationships without inventing an assignee. | IMPLEMENTED+TESTED | `user_id`, prospect/quote/case links. |
| G1-MID-015 | Reuse EXP-005 operational copies and CFG-001 snapshot provenance. | IMPLEMENTED+TESTED | Batched `ExpedienteSeguimientoActividad` read. |
| G1-MID-016 | Expose Prefirma as a distinct stable category. | IMPLEMENTED+TESTED | `PRE_SIGNATURE`; journey 4. |
| G1-MID-017 | Expose scheduled/actual signature facts for Prefirma composition. | IMPLEMENTED+TESTED | Canonical expediente signature fields. |
| G1-MID-018 | Expose incomplete Prefirma activities and their operational state. | IMPLEMENTED+TESTED | `operationalActivityFact`; focused tests. |
| G1-MID-019 | Expose CFG-001 dependencies and derived blockers. | IMPLEMENTED+TESTED | Batched dependency graph; focused blocker tests. |
| G1-MID-020 | Expose configured duration, remaining duration, day semantics and safety margin. | IMPLEMENTED+TESTED | Reuses EXP-005 operational calculation helpers. |
| G1-MID-021 | Expose only configured activity user/role responsibility. | IMPLEMENTED+TESTED | Snapshot responsibility fields; no lawyer fallback in G1. |
| G1-MID-022 | Expose Postfirma as a category separate from Prefirma. | IMPLEMENTED+TESTED | `POST_SIGNATURE`; journey 5. |
| G1-MID-023 | Include configured Postfirma/Registro/Cierre and other post-sign snapshot activities. | IMPLEMENTED+TESTED | Snapshot name/order phase resolver. |
| G1-MID-024 | Expose post-sign progress, pending, timing, margin, blocker and responsibility facts. | IMPLEMENTED+TESTED | Shared operational fact contract. |
| G1-MID-025 | Stop active operational Postfirma sources at `ENTREGADO` without changing compliance. | IMPLEMENTED+TESTED | Explicit delivered exclusion; journey 6/H10 regression. |
| G1-MID-026 | Expose pending EXP-008 payment requests as Administration sources. | IMPLEMENTED+TESTED | Batched `ExpedienteSolicitudPago` query; journey 7. |
| G1-MID-027 | Expose pending EXP-008 receipt/advance applications as Administration sources. | IMPLEMENTED+TESTED | Batched `ExpedienteIngresoReportado` query. |
| G1-MID-028 | Preserve the EXP-008/CUM-PAG boundary and never substitute compliance payment data. | IMPLEMENTED+TESTED | Service has no compliance/CUM-PAG query; static and focused tests. |
| G1-MID-029 | Reuse the five exact G0-C timing types and explicit calculation states. | IMPLEMENTED+TESTED | `TimingPolicyType` and `TimingCalculationStatus`; timing tests. |
| G1-MID-030 | Expose the pinned policy revision and never resolve an opened interval against a later current policy. | IMPLEMENTED+TESTED | Revision IDs collected from intervals only; R1/R2 test. |
| G1-MID-031 | Do not create numeric defaults, retroactive starts, deadlines, or overdue booleans for unknown/unconfigured facts. | IMPLEMENTED+TESTED | Explicit empty/fallback time states; negative tests. |
| G1-MID-032 | Enforce tenant, RBAC and existing object-level visibility for rows and counts. | IMPLEMENTED+TESTED | Canonical object filters; physical/unit isolation tests; counts derived from visible rows. |
| G1-MID-033 | Keep reads deterministic, bounded, batch-oriented and mutation-free. | IMPLEMENTED+TESTED | Fixed-clock seam, max 250/master, constant queries, PostgreSQL before/after probe. |
| G1-MID-034 | Define the final Mi Día visual design and user experience. | DEFERRED | Explicitly reserved for the approved future Mi Día product phase. |
| G1-MID-035 | Define the final cross-domain prioritization/ranking rules and algorithm. | DEFERRED | Explicitly reserved; G1 returns no priority/rank/urgency authority. |

## Totals

- Total: **35**
- Designable now: **33**
- Implemented and tested: **33/33**
- Partial: **0**
- Missing: **0**
- Deferred: **2** (`G1-MID-034`, `G1-MID-035`)

## Non-negotiable boundaries

- No G1 table or migration.
- No materialized alert/task/priority record.
- No final Mi Día screen or global ordering.
- No use of legacy 3-day, 5-day or 7-day rules as MID-BASE timing authority.
- No source mutation or audit business event from a read.
- No compliance payment (`CUM-PAG`) data in Administration sources.
