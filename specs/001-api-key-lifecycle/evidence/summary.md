# API Key Lifecycle — implementation evidence

## Gate status

All67tasks, including T066/T067 convergence corrections, are complete. Final `npm run test:coverage -- --silent` passed58suites/429tests in389.610seconds with no pending/todo tests; source/emission checker `complete:true`. All four stories, startup/index compatibility, contract/security/fault/recovery tests and the full-scale load passed together. A fresh read-only convergence review found no actionable issues. No deployment is claimed.

## Reviewed scope and versions

Uncommitted staged, unstaged and untracked changes on `001-api-key-lifecycle`, based on HEAD `02baab285ccc7d1e0845d8f5c98da4e80f28a3b1`. No commit, push, deployment or managed infrastructure was created. Test date2026-10-30; Apple M1/8CPU, darwinarm64 OS27.2.0. Actual selected Node24.15.0 with native SQLite3.51.3; host installer Node22.21.1/npm11.20.0. Locked dev dependencies: @jest/globals30.3.0, jest30.3.0, @types/node24.19.2, typescript5.9.3. Zero external runtime packages.

## TDD and regression record

Per-task T001–T067 files and story summaries [foundation](foundation.md), [US1](us1.md), [US2](us2.md), [US3](us3.md), [US4](us4.md), [gateway ordering](gateway-ordering.md), [runtime selection correction](runtime-selection-review.md), and [verified startup](T063.md) preserve sanitized behavioral RED→GREEN results. Compiler/import errors, loopback sandbox refusal and harness corrections were not counted as behavioral RED. No skipped security tests, excluded runtime decision modules, ignored branches or lowered thresholds were used.

[Final branch inventory](security-coverage.json) covers47production source/emitted modules:39runtime-bearing modules have1141/1141branch slots covered (100%). All8type-only wrappers remain collected; their empty emission artifacts produce raw aggregate99.30%. The checker compares every source and emitted file with no missing or never-imported runtime module. No exclusions or threshold changes. Earlier381/399-test coverage and the423-test T066 checkpoint are historical and superseded by the429-test final gate.

## Load and revocation proof

[Final complete run](load-final.json): validation p95/p99 **1.211250/1.446375ms**, successful revocation **2.576291/2.768500ms**. All30,000validations and300revocations were offered, received and completed. Exactly15,000active requests succeeded and15,000invalid/revoked/foreign requests were denied. Zero failures, timeouts, cancellations, unavailable responses, incorrect outcomes, missing responses, outstanding requests, unconfirmed revokes or post-revocation accepts. All targets passed with audit and coverage enabled.

Historical independent reports also include the [original399-test final load](load-original-final.json) and [T066 settings checkpoint](load-T066.json). Earlier reports: [standalone full-scale run](load-first.json) and [coverage-instrumented full-scale run](load-coverage.json). Each uses real authority HTTP/native SQLite and two real gateways;100,000 retained records/1,000 Tenants,60second warm-up and300second measurement with100 validations/second plus1 revocation/second. Exactly30,000 validations and300 revocations offered/received/completed.15,000 active accepted and15,000 invalid/revoked/foreign rejected. Zero timeouts, cancellations, transport failures, unavailable/incorrect responses, unobserved responses, outstanding work, unsuccessful/unconfirmed revocations or post-revocation accepts. Every measured received response is accounted for; no missing duration was invented.

Coverage-instrumented historical authority validation p95/p99:1.165584/1.405792ms; successful revocation:2.524666/2.749167ms. Both targets pass with audit enabled. Service timing starts at HTTP request receipt and ends at response finish; separately reported gateway timing begins at scheduled arrival. This is local measured capacity, not a deployed production SLA.

Effective settings: gateway500ms, validation200ms, shared identity100ms, management2000ms; zero automatic retries, SQLite busy0/WAL/FULL/autocheckpoint1000pages. Absolute monotonic deadlines reject equality; cancellation removes queued gate work, late results cannot grant access, and a committed revocation is never undone or acknowledged late. Deterministic boundary tests are separate from normal-load metrics. Eight crypto-candidate regenerations bound historical-secret collision handling; they do not retry a mutation or identity/RPC request.

Two gateways require a fresh authenticated authority decision for each pending operation. Physically stale positive hints have no authority. Shared decision/commit ordering proves D>R denies; a pre-R response can only finish its original pending operation once. Tests cover partitions, delayed decisions/responses, replay, concurrent revocation, client disconnect on both sides of commit, and real process SIGKILL/restart after commit and after acknowledgment. See gateway-ordering.md and US3 evidence.

Two unsuccessful final verification attempts remain recorded in the local ledger: an unmigrated load error-envelope assertion, then scheduler-dependent mix selection because revocation advanced the validation counter. Neither counted as a passing load gate. The final fixture uses an independent validation sequence and passed the unchanged60+300second workload. A short-lived serialization refactor regression was caught by contracts and corrected before the final run. The manual launcher also required directly signaling its owned server because signaling npm alone did not forward to its child; real server signal-cleanup tests passed.

## Convergence corrections

[T066](T066.md):4startup-negative and20storage fault assertions observed intended RED before production readback checks. Effective WAL/FULL/foreign-key/zero-busy values are now verified before storage is accepted; invalid/missing/query-failed readbacks close/refuse startup. T066 passed its own complete423-test coverage/load gate before T067 began.

[T067](T067.md):6native integration assertions observed intended RED before the planned non-unique/non-partial(tenantId,createdAt,keyId) index was added. Both fresh and supported existing stores receive it before readiness; existing key/event rows and keyId listing order remain unchanged. Conflicting definitions and lock contention refuse opening without retry. The additive index leaves the version1 record/event format intact; unsupported versions remain refused. Future migrations must track index preparation separately from row-format versioning.

[Fresh convergence review](convergence-review.md) returned no actionable findings or deferred minors. The final429-test gate includes all24setting-fault and6index corrections. The governing spec, plan, constitution and reviewer-owned checklist markers were preserved.

## Requirements traceability

Paths below are relative to the repository root. Each row maps requirements to executable evidence; the final combined gate must execute them all.

| Requirement | Executable evidence |
|---|---|
| FR-001 | tests/acceptance/security/first-slice.acceptance.test.ts; tests/contract/*-contract.test.ts |
| FR-002 | tests/unit/authentication.test.ts; tests/acceptance/security/foundation.acceptance.test.ts |
| FR-003 | tests/acceptance/security/creation.acceptance.test.ts; tests/contract/secret-retrieval-contract.test.ts |
| FR-004 | tests/unit/key-crypto.test.ts; tests/integration/creation-persistence.test.ts; creation.acceptance.test.ts |
| FR-005 | tests/unit/key-record.test.ts; tests/unit/key-metadata.test.ts; tests/integration/validation-repository.test.ts |
| FR-006 | tests/acceptance/security/listing.acceptance.test.ts; tests/integration/listing-repository.test.ts (1002 records) |
| FR-007 | tests/acceptance/security/validation.acceptance.test.ts; tests/contract/validation-contract.test.ts |
| FR-008 | validation.acceptance.test.ts; tests/acceptance/security/gateway-admission.acceptance.test.ts |
| FR-009 | tests/acceptance/security/first-slice.acceptance.test.ts; tests/acceptance/security/revocation.acceptance.test.ts |
| FR-010 | revocation.acceptance.test.ts; tests/integration/revocation-ordering.test.ts; gateway-admission.acceptance.test.ts |
| FR-011 | tests/unit/revocation-transition.test.ts; tests/contract/reactivation-contract.test.ts; tests/integration/revocation-repository.test.ts |
| FR-012 | validation.acceptance.test.ts retains an old active key without automatic expiration |
| FR-013 | tests/unit/domain-errors.test.ts; tests/contract/transport-errors.test.ts; tests/unit/security-failure-paths.test.ts |
| FR-014 | tests/integration/creation-attempts.test.ts; tests/integration/revocation-attempts.test.ts; tests/acceptance/security/revocation-disconnect.acceptance.test.ts |
| FR-015 | foundation.acceptance.test.ts; tests/unit/gate-wait-cancellation.test.ts; tests/integration/storage-failure-paths.test.ts |
| FR-016 | validation.acceptance.test.ts; tests/unit/authentication.test.ts |
| FR-017, FR-018, FR-019 | tests/performance/security-load.test.ts; full-scale JSON reports |
| FR-020 | tests/acceptance/security/creation-events.acceptance.test.ts; tests/integration/security-events.test.ts; creation-attempts.test.ts; revocation-attempts.test.ts; tests/acceptance/security/revocation-recovery.acceptance.test.ts |
| SC-001 | creation.acceptance.test.ts; secret-retrieval-contract.test.ts |
| SC-002 | foundation.acceptance.test.ts; validation.acceptance.test.ts; listing.acceptance.test.ts |
| SC-003 | revocation.acceptance.test.ts; revocation-ordering.test.ts; gateway-admission.acceptance.test.ts |
| SC-004 | reactivation-contract.test.ts; revocation-transition.test.ts; creation-persistence.test.ts |
| SC-005 | listing.acceptance.test.ts; listing-repository.test.ts; first-slice.acceptance.test.ts |
| SC-006 | domain-errors.test.ts; security-failure-paths.test.ts; response-deadline.test.ts; revocation-disconnect.acceptance.test.ts |
| SC-007 | first-slice.acceptance.test.ts; actual quickstart API verification (T063) |
| SC-008, SC-009, SC-010 | security-load.test.ts; full-scale JSON reports |
| SC-011 | creation-events.acceptance.test.ts; creation-attempts.test.ts; revocation-attempts.test.ts; revocation-recovery.acceptance.test.ts; audited load |

Constitutionv1.2.0: API-only enterprise developer scope/error/out-of-scope requirements follow spec/contracts; TypeScript routes handle HTTP, framework-free services use repository interfaces, and architecture tests forbid forbidden dependencies. Built-in crypto stores only salted SHA-256 verification material and prefixes; temporary secret strings exist only for issuance/matching in process memory. TDD history plus all-source branch inventory enforces the engineering gate. OpenAPI transport/errors are covered by contract/envelope tests. Reviewer-owned requirements16/16 and security36/36 checklist markers are preserved; they assess requirements quality, not implementation completion.

## Decisions and operational limits

- Existing selected feature checkout was retained to preserve authoritative uncommitted design; no separate checkout isolation.
- Canonical Spec Kit T### tasks and per-task evidence replace incompatible helper-script task schema. RED-authoring completion does not imply product completion.
- Inventory is stricter than the minimum: every runtime-bearing source module must reach100% branches; type-only wrappers remain collected.
- Optional commit hook is preserved. No inferred per-task commits; retained feature evidence and local ledger remain until the user chooses to commit.
- Intermediate story gates recorded known later-story REDs while allowing their dependency-authorized implementation. Those intermediate results cannot substitute for final whole-slice coverage.
- One authoritative service/SQLite volume is the supported fault model. Explicitly identified backup restores are refused. A complete unannounced rollback of the sole volume cannot be detected without external monotonic state; no such detection or DR automation is claimed. Emergency recording during total durable-media loss is not a durable-audit guarantee. Revocation is never rolled back to repair audit.

Before non-development use, the host supplies existing real identity/membership/context verification, HTTPS, conforming fresh-online gateway enforcement, reviewed runtime/storage maturity, durable authoritative volume/recovery procedures and workload sizing. No portal, product CLI, expiration, rotation, deletion, secret recovery, identity-provider construction, production deployment or new managed infrastructure is supplied.

## Completion decision

Complete for the bounded API-only slice and both convergence tasks. FR-001–FR-020, SC-001–SC-011, constitutionv1.2.0, published HTTP/gateway/deadline contracts, startup setting checks and the planned persistence index trace to executed tests above. The final429-test gate passed with100%runtime branch coverage and all performance/correctness targets. Reviewer-owned requirements16/16 and security36/36 markers were read and preserved. The original review's4findings were fixed; the final convergence review has no actionable findings or deferred minors. All67tasks are complete, and changes remain uncommitted. Host integration/recovery prerequisites above remain necessary before production use.
