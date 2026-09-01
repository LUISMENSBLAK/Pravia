# G0-B — COT-001 source prerequisites

Atomic contract matrix derived from COT-001, the PRO-001 hand-off boundary, and the MID-BASE quote-source contract. The canonical source remains the approved v0.4 document; v0.5 was used only to confirm semantic compatibility.

| ID | Atomic requirement | Verification | Status |
|---|---|---|---|
| G0B-001 | Re-read COT-001 completely. | v0.4 pp. 62–64 | PASS |
| G0B-002 | Re-read only the PRO-001 boundary required by COT-001. | v0.4 pp. 65–67 | PASS |
| G0B-003 | Re-read only MID-BASE quote sources. | v0.4 pp. 68–69 | PASS |
| G0B-004 | Confirm COT-001/MID-BASE semantics remain compatible in v0.5. | v0.5 pp. 62–69 | PASS |
| G0B-005 | Every canonical quote originates from one Prospect. | service + DB deferred constraint | PASS |
| G0B-006 | Origin Prospect belongs to the server-derived tenant. | scoped service + tenant trigger | PASS |
| G0B-007 | A Prospect cannot produce two canonical quotes. | existing unique origin + concurrent test | PASS |
| G0B-008 | Canonical quote requires the confirmed G0-A notary source. | transaction + deferred constraint | PASS |
| G0B-009 | Notary source belongs to the same Prospect and tenant. | G0-A relation + tenant trigger | PASS |
| G0B-010 | Canonical creation consumes G0-A instead of duplicating it. | ProspectWorkflowService | PASS |
| G0B-011 | Direct orphan wizard cannot create a canonical quote. | controller delegates to PRO-001 | PASS |
| G0B-012 | New quote is not created to request a notary quote. | canonical UI/API flow | PASS |
| G0B-013 | General documents do not substitute for the G0-A source. | source relation preserved | PASS |
| G0B-014 | A canonical quote is born in Borrador. | atomic creation event | PASS |
| G0B-015 | Enviada al cliente is an explicit commercial transition. | domain transition table | PASS |
| G0B-016 | Aceptó / Anticipo is one stage, not two. | canonical enum + UI | PASS |
| G0B-017 | Suspendida is distinct from Rechazada. | enum and no legacy mapping | PASS |
| G0B-018 | Cancelada is distinct from Vencida. | enum and no legacy mapping | PASS |
| G0B-019 | Convertida en expediente is terminal. | domain transition table | PASS |
| G0B-020 | Invalid canonical transitions are rejected. | domain + API tests | PASS |
| G0B-021 | Generic state PATCH cannot mutate canonical quotes. | controller guard | PASS |
| G0B-022 | Legacy delivery endpoint cannot mutate canonical quotes. | controller guard | PASS |
| G0B-023 | Canonical status labels are human-readable. | shared formatters/components | PASS |
| G0B-024 | Technical enum codes are not exposed in affected UI. | focused UI tests/review | PASS |
| G0B-025 | Every stage transition stores an effective date. | required action input + DB check | PASS |
| G0B-026 | Effective date is not inferred from updated_at. | append-only event model | PASS |
| G0B-027 | Effective date cannot be future or precede prior fact. | domain validation | PASS |
| G0B-028 | Actor is persisted on every contractual fact. | membership FK | PASS |
| G0B-029 | Organization is persisted on every contractual fact. | required tenant column | PASS |
| G0B-030 | First client send records channel, recipient and evidence. | service + DB shape check | PASS |
| G0B-031 | First client send requires the approved quote version. | service validation | PASS |
| G0B-032 | First sent date remains immutable. | partial unique + event history | PASS |
| G0B-033 | A resend is distinguished from the first send. | REENVIAR_CLIENTE fact | PASS |
| G0B-034 | Resend does not overwrite first sent date. | integration test | PASS |
| G0B-035 | Quote/PDF editing does not rewrite commercial dates. | version path separated | PASS |
| G0B-036 | PDF generation does not imply client send. | separated endpoints/actions | PASS |
| G0B-037 | Contract history is append-only. | DB immutable trigger | PASS |
| G0B-038 | AuditLog references but does not replace contractual history. | event_id + separate rows | PASS |
| G0B-039 | State, date, event and audit commit atomically. | single transaction + rollback test | PASS |
| G0B-040 | Aceptó / Anticipo requires an explicit human-confirmed action. | contract action endpoint | PASS |
| G0B-041 | Historical payment does not imply Aceptó / Anticipo. | no inference/backfill | PASS |
| G0B-042 | Aceptó / Anticipo does not create a Pago. | integration test | PASS |
| G0B-043 | Aceptó / Anticipo does not create a finance movement. | integration test | PASS |
| G0B-044 | Aceptó / Anticipo does not invent an amount. | evidence payload + test | PASS |
| G0B-045 | Suspend action stores date, actor, tenant and optional cause. | event schema/service | PASS |
| G0B-046 | Cancel action stores date, actor, tenant and optional cause. | event schema/service | PASS |
| G0B-047 | Suspend/Cancel preserve source, documents and relations. | integration test | PASS |
| G0B-048 | Suspend/Cancel do not physically delete the quote. | transition-only service | PASS |
| G0B-049 | Conversion is allowed only after Aceptó / Anticipo. | eligibility + action table | PASS |
| G0B-050 | Payment alone cannot enable canonical conversion. | canonical eligibility test | PASS |
| G0B-051 | Draft, suspended and cancelled quotes cannot convert. | domain tests | PASS |
| G0B-052 | Conversion uses the existing canonical Expediente system. | existing conversion service extended | PASS |
| G0B-053 | Conversion is same-tenant and object-authorized. | scoped lock/query + test | PASS |
| G0B-054 | Conversion is unique under retry. | idempotency + existing unique relation | PASS |
| G0B-055 | Two concurrent conversions yield one case/link/final fact. | advisory lock + unique DB facts | PASS |
| G0B-056 | Conversion transition and audit are in the case transaction. | transaction service | PASS |
| G0B-057 | Quote concepts/totals remain the EXP-007 source. | regression suite/build | PASS |
| G0B-058 | EXP-008 remains the only finance application domain. | no finance write in COT-001 | PASS |
| G0B-059 | Historical quote states are preserved unchanged. | additive enum/model | PASS |
| G0B-060 | Historical dates are preserved unchanged. | no migration backfill | PASS |
| G0B-061 | Historical payments are preserved unchanged. | dry-run counts/snapshots | PASS |
| G0B-062 | Historical PDF URLs/documents are preserved unchanged. | dry-run counts/snapshots | PASS |
| G0B-063 | Historical Prospect and case links are preserved. | dry-run counts/snapshots | PASS |
| G0B-064 | Unproven legacy stage/date is UNKNOWN_LEGACY. | read model | PASS |
| G0B-065 | Rechazada is not recoded to Suspendida. | no backfill/mapping | PASS |
| G0B-066 | Vencida is not recoded to Cancelada. | no backfill/mapping | PASS |
| G0B-067 | Existing legacy actions remain compatibility-only. | guarded legacy branches | PASS |
| G0B-068 | Tenant is derived from authenticated server context. | actor context + middleware | PASS |
| G0B-069 | Cross-tenant quote read/action is blocked using valid IDs. | isolated PostgreSQL test | PASS |
| G0B-070 | Cross-tenant origin/source/version relation is DB-blocked. | same-organization triggers/FKs | PASS |
| G0B-071 | Existing RBAC permissions are reused. | existing permission middleware | PASS |
| G0B-072 | No parallel permission or audit engine is introduced. | architecture review | PASS |
| G0B-073 | Stale expectedVersion cannot overwrite a newer fact. | optimistic version test | PASS |
| G0B-074 | Same idempotency key and payload replays safely. | hash/replay test | PASS |
| G0B-075 | Reused idempotency key with different payload is rejected. | domain tests | PASS |
| G0B-076 | Concurrent conflicting actions produce one deterministic winner. | PostgreSQL race tests | PASS |
| G0B-077 | Migration is additive, tenant-aware and follows G0-A timestamp. | 20260831030000 SQL review | PASS |
| G0B-078 | Migration adds required FKs, indexes and uniqueness. | SQL + isolated apply | PASS |
| G0B-079 | Migration performs no destructive enum rewrite or mass NOW backfill. | SQL review | PASS |
| G0B-080 | Baseline-to-latest preserves representative legacy counts and rows. | Docker PostgreSQL dry-run | PASS |
| G0B-081 | Canonical read model exposes current stage and entered-at fact. | workflow read model | PASS |
| G0B-082 | Read model exposes first/last send and terminal milestone dates. | workflow read model | PASS |
| G0B-083 | Read model exposes origin Prospect, linked case and responsible. | workflow read model | PASS |
| G0B-084 | No commercial/admin SLA, urgency or priority policy is added. | boundary scan/review | PASS |
| G0B-085 | New UI has one Aceptó / Anticipo action and explains finance separation. | focused frontend test | PASS |
| G0B-086 | New UI removes Enviar a Notaría from the canonical path. | focused frontend test | PASS |
| G0B-087 | Suspend/Cancel remain secondary/destructive confirmed actions. | dialog/component review | PASS |
| G0B-088 | Quote detail remains responsive at 1536/1366/1024/768/390/320. | local responsive review | PASS |
| G0B-089 | Affected dialogs/actions remain keyboard and screen-reader usable. | semantic UI + focused tests | PASS |
| G0B-090 | G0-A Prospect stages, source and first received_at remain intact. | 41 focused regressions | PASS |
| G0B-091 | No G0-C, G1, v0.5 Compliance or final Mi Día implementation is introduced. | boundary review | PASS |
| G0B-092 | Production receives no writes, migrations, push or deploy. | execution audit | PASS |

**Total: 92 atomic requirements; 92/92 PASS.**
