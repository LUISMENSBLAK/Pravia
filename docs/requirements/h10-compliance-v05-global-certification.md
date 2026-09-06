# H10 Cumplimiento v0.5 global certification

Source of truth: `PRAVIA_OS_Documento_Maestro_Diseno_Funcional_v0.5_CUMPLIMIENTO_NOTARIA_APROBADO.docx`. Canonical parent: `7810bef86e8a7012cd432013d132c94c5c1692ed`.

## Frozen transverse invariant matrix

This 45-item matrix was frozen before H10 product or test edits. H10 certifies the integrated H1-H9 system; it does not introduce a new functional phase.

| ID | Global invariant | Certification evidence |
|---|---|---|
| H10-INT-001 | One operational expediente master; no parallel PLD expediente | Prisma model inventory; H10 journeys 1-6 |
| H10-INT-002 | One Compareciente identity master | `complianceH10.certification.test.ts`; H3/H4 service suites |
| H10-INT-003 | One Predio master | Prisma model inventory; expediente contract suite |
| H10-INT-004 | One Documento byte authority | H2 document/evidence services; DB B checksum preservation |
| H10-INT-005 | EXP-008 service finance remains separate from CUM-PAG operation payments | H5 contracts; H10 journey 4 |
| H10-INT-006 | Screening consumes Comparecientes without a second person master | H3 contract/service tests; H10 journey 1 |
| H10-INT-007 | H4 remains the only BC determination authority | H4 contract/service tests; H10 journey 1 |
| H10-INT-008 | ISR remains a single deterministic fiscal engine | Prisma/service inventory; full backend regression |
| H10-INT-009 | H6 extends the existing signature workflow | H6 contracts, services and frontend suite |
| H10-INT-010 | H1 remains the versioned deterministic legal engine | H1 legal engine contracts and PostgreSQL schema |
| H10-INT-011 | EXP-009 remains the only visible activity timeline and AuditLog stays technical | H7 activity integration tests; H10 journey 6 |
| H10-INT-012 | H7 remains the only derived closure authority | H7 domain/service tests; H10 negative suite |
| H10-INT-013 | H8 is the only central compliance panel and links to the case workspace | H8 service/frontend suites |
| H10-INT-014 | One case-to-compliance workspace with the approved block order | `ComplianceTab.tsx`; frontend H2-H9 regression |
| H10-INT-015 | CUM-EST has exactly six approved states and no manual completion writer | H10 DB enum assertion; H10 negative suite |
| H10-INT-016 | Deterministic unresolved requirements prevent completion independently of H9 | H7 tests; H10 journey 3 |
| H10-INT-017 | H9 clean or critical results never mutate deterministic closure | H9 contracts; H10 AI-boundary assertions |
| H10-INT-018 | Generated, signed-uploaded, validated, presented, acknowledged and fulfilled remain distinct | H6 contracts and H10 state-transition negatives |
| H10-INT-019 | Delivered cases keep compliance open while operational alerts remain stopped | H7 tests; H10 journey 5 |
| H10-INT-020 | H1-H9 AI only extracts, compares, proposes or reviews within human/deterministic boundaries | H9 contracts; H10 AI-boundary assertions |
| H10-DB-001 | H1-H9 checkpoint and migration chains are linear and complete | Git parent walk; DB migration ledger 59/59, including the provider-neutral release compatibility migrations |
| H10-DB-002 | Fresh bootstrap reaches the canonical H10 schema without intervention | DB A `db:init-empty`, 59 migrations |
| H10-DB-003 | Incremental representative upgrade preserves legacy rows | DB B pre-H1 -> H5 fixture -> H10 |
| H10-DB-004 | Direct H8-to-H9/H10 upgrade succeeds | DB C H8 -> H9 -> H10 |
| H10-DB-005 | A/B/C logical schemas have the same normalized fingerprint | `h10-global-logical-schema-v1`, SHA-256 below |
| H10-DB-006 | Tenant-owned models are registered in canonical Prisma isolation middleware | Full backend tenant tests and H10 scope negatives |
| H10-DB-007 | Document fixture bytes and checksums survive upgrade | DB B document/evidence checksum assertion |
| H10-DB-008 | Historical H1-H9 migrations remain byte-identical to their checkpoints | Git object comparison against H1-H9 commits |
| H10-SEC-001 | Cross-tenant IDs are rejected for all H1-H9 resources | H10 cross-tenant parameterized negatives; phase suites |
| H10-SEC-002 | Same-tenant inaccessible expedientes are rejected at object level | H10 object-scope negative; backend service suites |
| H10-SEC-003 | Sensitive compliance actions enforce backend RBAC | H3-H9 RBAC/service tests |
| H10-SEC-004 | Foreign-scope obligation, presentation and acknowledgement lineage is rejected | H6/H7 service tests; H10 negatives |
| H10-SEC-005 | Critical retries are idempotent without duplicated history or activity | H3-H9 retry suites; H10 idempotency assertion |
| H10-SEC-006 | Concurrency guards preserve coherent current revisions and append-only history | H1/H3/H9 concurrency and append-only tests |
| H10-SEC-007 | No H1-H9 migration seeds invented legal or official production data | Historical migration static review; fixtures remain test-only |
| H10-UI-001 | Case compliance, FIR, CUE, BC, PAG, AVI and H9 remain usable at 320/390/768/desktop | Existing phase responsive evidence; frontend 373/373 |
| H10-UI-002 | H8 retains four KPIs, seven filters, server-side search and one row per case | `ComplianceH8.test.tsx` |
| H10-UI-003 | Primary controls expose understandable loading, disabled and error states | Frontend H2-H9 tests and build |
| H10-UI-004 | Desktop primary surfaces do not require standard horizontal page scrolling | Phase responsive evidence; frontend regression |
| H10-REG-001 | Negative integration suite rejects prohibited transitions/scopes | H10 negative suite 15/15 |
| H10-REG-002 | Vulnerable full journey reuses masters through H8/H9 | H10 journey 1 |
| H10-REG-003 | Non-applicable journey creates no artificial compliance artifacts | H10 journey 2 |
| H10-REG-004 | Missing resource provider and pending notice remain actionable and incomplete | H10 journeys 3-4 |
| H10-REG-005 | Delivered-with-pending and post-presentation changes preserve history | H10 journeys 5-6 |
| H10-REG-006 | Full backend and frontend suites, static checks and phase suites all pass | Backend 1583/1583; frontend 373/373; builds PASS |

Frozen invariant count: **45**. Certified: **45/45**.

## Final certification results

- Contract source was re-read for CUM-001, CUM-MAT, CUM-EST-001, CUM-DOC-001, CUM-FIR-001, CUM-CUE-001, CUM-BC-001, CUM-PAG-001, CUM-LST-001, CUM-AVI-001, CUM-AUD-001, CUM-CIE-001, prevalence and expediente integration: 12/12 PASS.
- Linear checkpoints: H1 `42ee2cf`, H2 `3379b8b`, H3 `81d2f43`, H4 `4e2c0bd`, H5 `6bf9cfb`, H6 `b7d72bc`, H7 `297870b`, H8 `4c4c93c`, H9 `7810bef`: PASS.
- Database A: fresh canonical bootstrap, 59/59 migrations represented, PASS.
- Database B: pre-H1 bootstrap (46), H1-H5 upgrade, representative fixture, H6-H10 upgrade, PASS. Four H6 cutover classes, one document, one evidence row and one operation payment survived; checksum snapshot remained equal to the document checksum.
- Database C: H8 bootstrap (53), direct H9 and H10 upgrade, PASS.
- A/B/C normalized fingerprint: `60917aa17ecd859ce401d71a3ccc59d5de5dd6a6d57ff02f00f200660d180d58`; counts `columns=2777`, `constraints=879`, `indexes=1057`, `enums=588`, `functions=97`, `triggers=346`; parity MATCH.
- H10 PostgreSQL tests: A 5/5 (B-only fixture assertion skipped), B 6/6, C 5/5 (B-only fixture assertion skipped). Missing FK indexes: 0.
- H10 domain certification: 22/22, including negative suite 15/15 and six cross-phase journeys.
- Prisma validate/generate: PASS. Backend TypeScript build: PASS. Frontend typecheck/build: PASS.
- Full regression: backend 1583/1583; frontend 373/373.
- Data loss: 0. Blob/checksum loss: 0. Production writes and migrations: none.

## H10 defect and correction

The representative pre-H1 upgrade exposed one global schema-parity defect: 18 H1-owned foreign-key columns and one H5 payment-party foreign-key column lacked a covering index on historical upgrade paths. Historical H1-H9 migrations were left byte-identical. Migration `20260905040000_add_h10_compliance_fk_indexes` and matching Prisma `@@index` declarations add the 19 indexes idempotently. The production rebaseline dry-run later exposed 42 additional tenant-aware physical foreign keys that exist only on that stronger historical path; `20260905041000_index_rebaseline_legacy_foreign_keys` adds deterministic covering indexes only for missing physical FK coverage and is a no-op on the fresh Prisma bootstrap. All database gates and global regressions passed after the corrections.

## Approved exclusions preserved

- Deferred: `H6-OFF-013`, `H6-OFF-014`.
- Blocked legal: `H6-AVI-008`, `H6-AVI-009`, `H6-AVI-010`.
- Blocked official: `H6-OFF-006`, `H6-OFF-007`, `H6-OFF-008`, `H6-OFF-009`.
- No legal thresholds, deadlines, retention rules, official schemas or official catalogs were invented.

## H9 hash reconciliation

Classification A, PASS. H9's functional hash `30365c...` excludes its manifest and hashes canonical sorted `{path, sha256}` JSON for 19 files. Its candidate/staged/committed hash `3bf413...` includes the manifest and serializes 20 sorted paths plus NUL plus raw bytes. The values intentionally represent different scopes and algorithms; the H9 checkpoint itself is intact.
