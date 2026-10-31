# Research: API Key Lifecycle — First Slice

Date: 2026-10-29. Inputs: [spec.md](spec.md), constitution v1.2.0, repository inspection,
and official primary documentation. All decisions below are planning choices unless
explicitly confirmed in the specification. No runtime migration, dependency installation,
implementation, or performance experiment was performed.

## Request Lifecycle Amendment — 2026-10-30

**Decision:** Resolve U1 with configurable defaults: gatewayValidationTimeoutMs=500,
validationTimeoutMs=200, identityTimeoutMs=100 shared across verifier calls, and
managementTimeoutMs=2000. Use absolute local monotonic deadlines and cooperative
cancellation; do not claim preemption of synchronous SQLite/crypto. No automatic gateway,
authority, or identity retry; SQLite busy wait is zero. Preserve already committed mutations
and complete/recover audit finalization independently of response delivery.

**Rationale:** The 200 ms validation budget leaves headroom within the existing 250 ms p99
target; the gateway budget includes additional transport time and is a different measurement
boundary. A 100 ms shared identity budget prevents successive calls from each resetting a
timeout. The 2000 ms management budget bounds willingness to start/acknowledge work while
retaining the existing revocation latency gates. These are engineering choices, not achieved
performance or new business requirements. Actual overruns remain visible in load evidence.

**Alternatives considered:** Per-call timeout reset and automatic retries extend request
lifetime and can duplicate creation. Cancelling/rolling back a confirmed revoke would violate
terminal state. Dropping timed-out samples would hide capacity failures. The normative
[request lifecycle contract](contracts/request-lifecycle.md) specifies the chosen behavior,
exact existing failure messages, explicit caller retries, configuration, and acceptance proof.

## Runtime and Native Storage

**Decision:** Use a maintained Node.js 24 LTS patch, minimum 24.15.0 and below 25,
TypeScript, and local SQLite through `node:sqlite`. Pin the patch during implementation and
check the bundled SQLite version against the planned >=3.51.3 baseline. Local Node22.21.1
must be upgraded to meet this selected prerequisite.

**Rationale:** Native storage avoids a runtime package while supporting transactional key
state. Node24's SQLite binding is Stability 1.2/Release Candidate from 24.15.0, not fully
stable. `DatabaseSync` is synchronous, so keep operations bounded and benchmark rather than
asserting throughput. This maturity risk is accepted for the bounded first-slice design;
production adoption needs explicit deployment review.

**Alternatives considered:** Node26 is a newer LTS major but not needed for this plan.
Node22 has earlier SQLite support but is not the selected baseline. JSON would require
custom atomic replacement, concurrency, and recovery. Third-party drivers add an unnecessary
runtime dependency for the selected baseline.

Sources: [Node releases](https://nodejs.org/en/about/previous-releases),
[Node24 SQLite documentation](https://raw.githubusercontent.com/nodejs/node/v24.x/doc/api/sqlite.md).

## Transaction, Durability, and Ordering

**Decision:** One authoritative process and one local SQLite connection; WAL and
`synchronous=FULL`, verified at startup. Use short `BEGIN IMMEDIATE` mutation transactions,
bound parameters, bounded lock waits, explicit rollback/uncertainty handling, and no awaited
network call inside a transaction. Preserve the WAL on recovery. Do not serve from copied
or asynchronously replicated key state.

**Rationale:** SQLite serializes writers, but an already-open read transaction can retain
an old WAL snapshot. A fresh final status check and its finalized authorization decision
must share an application ordering gate with revocation's durable commit. Database locking
alone does not establish that decision ordering. FULL durability preserves committed state
across the documented crash model; filesystem/hardware behavior remains an assumption.

**Alternatives considered:** NORMAL durability can lose acknowledged commits after OS/power
failure. Independent gateway databases, stale snapshots, or async replication could resurrect
access. Long synchronous busy waits can exceed response budgets. Use a patched SQLite
baseline; current WAL documentation describes a multi-connection checkpoint/write issue
fixed in 3.51.3 and selected backports. A one-connection design avoids that specific
concurrency pattern but does not justify omitting the version check.

Sources: [SQLite transactions](https://www.sqlite.org/lang_transaction.html),
[isolation](https://www.sqlite.org/isolation.html),
[synchronous durability](https://www.sqlite.org/pragma.html#pragma_synchronous),
[WAL](https://www.sqlite.org/wal.html),
[hardware assumptions](https://www.sqlite.org/atomiccommit.html).

## Key Material and Historical Uniqueness

**Decision:** Generate 6 random prefix bytes and 32 independent random secret bytes using
built-in `randomBytes`; base64url-encode them into `prefix.secret` (8 + 1 + 43 characters).
Generate a separate 16-byte random salt per key. Store SHA-256 of the fixed-length salt
followed by UTF-8 bytes of the entire 52-character API Key. Store only salt, 32-byte digest,
Key Prefix, and permitted lifecycle metadata. Compare valid-length buffers with
`timingSafeEqual`; reject corrupt lengths without throwing secret-bearing diagnostics.

**Rationale:** The visible prefix does not disclose the independent 256-bit secret suffix.
The constitution fixes salted SHA-256. Encoding and sizes are explicit project policy,
not requirements imposed by Node. Validate canonical encoding without trimming secrets.
The digest comparison API does not make surrounding control flow uniformly timing-safe.

Historical uniqueness requires more than independently salted digest uniqueness. Within
serialized issuance, query every record with the same candidate prefix across all Tenants,
including revoked records, recompute each candidate digest with its own salt, and regenerate
on a match. A matching full secret necessarily shares the prefix. Keep this internal global
search inaccessible to clients; public operations remain Tenant-scoped. Bound retry count
for injected RNG failure/collision exhaustion and return E-08, never an old credential.

**Alternatives considered:** Persisting an unsalted lookup fingerprint violates the selected
key-material policy. A unique constraint on differently salted hashes does not prove raw
secret uniqueness. Scanning only active or same-Tenant keys permits historical reissue.
Passwords/KDF libraries are not substituted for the user's specified high-entropy-key policy.

Source: [Node24 crypto APIs](https://nodejs.org/docs/latest-v24.x/api/crypto.html).

## Instant Invalidation Across Gateways

**Decision:** Every gateway operation gets a fresh, request-bound authority decision. Gateways
may hold non-secret metadata/active hints, but never raw keys or reusable positive verdicts.
Revocation commits terminal status and an increased generation at the authority. Cached
entries immediately lose eligibility to authorize; physical byte eviction is optional cleanup.
A generation bump alone does not prove gateways received an update.

**Rationale:** With the final status/decision and revoke commit serialized together, any
decision after revocation observes revoked state. Offline gateways deny on authority timeout
or partition. A delayed decision finalized before revocation is valid only for its original
already-admitted operation; it cannot be reused as a new admission. This matches the spec's
boundary for previously authorized work and preserves no grace period for new decisions.

**Alternatives considered:** TTLs and asynchronous pub/sub alone create a stale-acceptance
window. Waiting for every registered gateway's physical acknowledgement sacrifices
availability and still requires strict gateway membership/fencing. A distributed strongly
consistent authority could support later scaling, but is unnecessary at this slice's target.
Gateways that cannot enforce this contract are unsupported until integrated correctly.

See [gateway-enforcement.md](contracts/gateway-enforcement.md) for the proof and fault tests.
SQLite ordering facts are supported by the transaction/isolation sources above; the gateway
protocol and its proof are this project's design, not guarantees made by SQLite.

## Existing Identity Integration

**Decision:** Inject a framework-free `IdentityVerifier` implemented by the existing platform
host. It verifies bearer credentials, developer membership, trusted service identity, and
expected Tenant context. Normal bootstrap requires that adapter; missing wiring refuses
startup. Only explicit loopback test/development composition may use fixture credentials.

**Rationale:** No existing provider, JWT format, token introspection endpoint, signing scheme,
or deployed adapter is present in the repository. Defining a typed boundary resolves the
service's integration contract without inventing those capabilities or building an identity
system. Real adapter delivery remains the host integration responsibility and a deployment
prerequisite. A caller-supplied Tenant selector becomes trusted only after verification.

**Alternatives considered:** Arbitrary identity headers are forgeable. A home-grown JWT
implementation adds excluded identity capability. Assuming an introspection endpoint exists
would silently introduce an unavailable dependency. Production fallback to fixtures is denied.

## HTTP Contract and Error Precedence

**Decision:** OpenAPI 3.1.1 with explicit `X-Tenant-ID` for management, bearer identity for
all operations, and separate trusted-service authorization for validation. Key material is
in JSON request/response bodies, never URLs. All responses use `Cache-Control: no-store`.
Creation returns 201; listing, validation success, and first/repeated revocation return 200.
No secret-retrieval or reactivation success route exists; explicit rejection contracts make
their mandated failures testable.

**Rationale:** Header scope makes the missing-Tenant error observable. A revocation body
allows the missing-key-identifier error rather than a routing 404. Service identity is
separate from the API Key being examined. Missing/invalid credentials precede trust checks;
trust precedes examination of presented keys. Exact E-01 through E-16 messages are retained.
Transport-only parse/size/content-type/routing errors are separately named in the contract.
The two explicit rejection routes use OPERATION_UNAVAILABLE/503 with the literal message
"Unable to process this API key request. Try again." if identity or scoped lookup is
unavailable, before disclosing any key-specific result. This closes the review-identified
failure-path gap without changing the specification's E-01 through E-16 messages.

**Alternatives considered:** Tenant-in-path routing hides some missing-scope cases. Placing
raw keys in query parameters risks URI logging. Anonymous validation violates the accepted
trusted-service rule. OpenAPI security lists mean alternatives; this contract never models
an API Key as an alternative to service caller authentication.

Sources: [OpenAPI 3.1.1 security](https://spec.openapis.org/oas/v3.1.1.html),
[HTTP no-store](https://www.rfc-editor.org/rfc/rfc9111.html#section-5.2.2.5).

## Security Events and Uncertain Outcomes

**Decision:** Persist an allowlisted attempt before processing received creation/revocation
requests; finalize its outcome with the key mutation in the normal transaction. Store
operation correlation IDs on keys so interrupted records can be reconciled before readiness.
If audit finalization fails after effective revocation, never undo revocation: preserve the
pending attempt, return E-09 if completion is unconfirmed, and reconcile on recovery/retry.
A failure in the audit operation before effective revocation must not cause a rollback of
an already committed revoke; persistence adapters expose this distinction explicitly.

**Rationale:** A committed outcome is not the same as successful response delivery. A lost
creation response cannot justify retaining or replaying the raw secret. Failure events must
include only verified identifiers when known, never request bodies, tokens, digests, or stack
traces containing sensitive values. Security events distinguish succeeded/rejected/failed/
unconfirmed, and interrupted attempts remain observable.

**Fault-envelope limit:** If all durable storage is unavailable, durable evidence of every
received request is physically impossible. Emit the same redacted event through the emergency
stderr sink, deny new management work, and mark not ready; recovery must reconcile durable
pending records. This is not a claim of durable auditing under total media loss. Acceptance
covers key-operation failures with an available event sink, interrupted commits/replies,
and observable fail-closed behavior during audit/storage outages. Production log capture,
backup preservation of revocations, and recovery objectives require deployment review.

**Alternatives considered:** Best-effort-only audit for successful mutations loses evidence;
blocking or reverting effective revocation to repair logging restores risk. Logging raw
requests as fallback violates secret protection. A separate managed event service is not
required for local development.

## Jest, TypeScript, and Coverage

**Decision:** Precompile TypeScript/CommonJS, then run Jest with `transform: {}` and the
built-in V8 provider. Use `@jest/globals` for typed test APIs. Coverage compilation has no
source maps; explicit emitted security-file thresholds and source/emitted inventory checks
make gate paths deterministic. Collect all emitted production modules, including those no
test imports, and require 100% branches for every authentication/revocation implementation.

**Rationale:** This uses required Jest with no transformation runtime. Jest's coverage
collection and thresholds provide enforceable gates; behavioral assertions and observed
red results remain separate requirements. Tests must not print raw secrets in matcher diffs:
report sanitized booleans/codes and keep generated secrets in transient memory.

**Alternatives considered:** ts-jest/Babel add tooling without a demonstrated need; raw TS
execution does not by itself make Jest or type checking work. Collecting only imported
modules hides untested security code. A mocked invalidation call is not acceptance proof.

Sources: [Jest TypeScript](https://jestjs.io/docs/getting-started#using-typescript),
[TypeScript CommonJS output](https://www.typescriptlang.org/tsconfig/module.html),
[Jest collection](https://jestjs.io/docs/configuration#collectcoveragefrom-array),
[Jest thresholds](https://jestjs.io/docs/configuration#coveragethreshold-object).

## Capacity, Recovery, and Availability Baseline

**Decision:** Use the explicitly labeled 1,000-Tenant/100,000-record development baseline
and the fixed-arrival workload in plan.md. Keep all key records; no expiry/deletion policy.
Use one authority, favor denial over stale acceptance, and require durable acknowledged
revocation to survive process restart. No production uptime SLA or arbitrary backup RPO is
invented. Never serve an older backup that can resurrect revoked credentials.

**Rationale:** The spec supplies request-rate and latency targets but no data-size, hardware,
or production recovery commitments. Concrete benchmark assumptions make tests reproducible;
record actual hardware/runtime/SQLite versions and revisit sizing before deployment. No
performance or coverage result has been measured in this planning phase.

**Alternatives considered:** Claiming high availability with independent SQLite replicas
would violate revocation ordering. Treating 100 validations/second as a per-Tenant rate or
quota would alter scope. Performance improvements cannot relax durability or correctness.
