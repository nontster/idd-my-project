# Implementation Plan: API Key Lifecycle — First Slice

**Branch**: `001-api-key-lifecycle` | **Date**: 2026-10-29 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `specs/001-api-key-lifecycle/spec.md` and constitution
v1.2.0, including its currently uncommitted architecture and engineering amendments.

## Summary

Deliver a programmatic API for enterprise developers to create a Tenant-scoped API Key,
receive its secret once, list non-secret metadata, and revoke any key within their Tenant.
Only existing trusted platform service identities may call validation. Keys remain active
until manually revoked. No portal, CLI, expiration, rotation, secret recovery, or new
identity system is introduced.

Use Node.js/TypeScript, HTTP-only routes, framework-free services, repository interfaces,
built-in cryptography, and local SQLite. A single authoritative process orders validation
and revocation. Gateways always obtain a fresh, request-bound authoritative decision;
cached active hints never authorize access. This gives revocation a precise enforcement
boundary without introducing Redis or pretending asynchronous cache eviction is instant.

This command produces design documents only. No application code, Jest tests, package
configuration, migrations, or task list has been created. Future implementation must begin
with executable security acceptance tests and observed assertion-level failures.

## Technical Context

**Language/Version**: TypeScript compiled to CommonJS; maintained Node.js 24 LTS patch,
minimum 24.15.0 and below 25. Local Node 22.21.1 must be upgraded before implementation
validation. Pin the selected 24.x patch during implementation and verify its bundled SQLite.

**Primary Dependencies**: No external runtime packages planned. Use `node:http`, `node:crypto`,
`node:sqlite`, and standard filesystem facilities. Development dependencies: `typescript`,
`jest`, `@jest/globals`, and `@types/node`; their roles are documented in [research.md](research.md).
No HTTP framework, ORM, Redis, external cryptography library, or TypeScript runtime loader.

**Storage**: One local SQLite file and one connection owned by one authority process;
repository and unit-of-work interfaces isolate persistence. WAL, `synchronous=FULL`, bound
parameters, short transactions, and startup setting/version checks. SQLite must include the
WAL fixes documented in research; use 3.51.3 or later for this planned baseline. JSON is
permitted by the constitution but is not a second adapter to implement in this slice.

**Testing**: Jest against separately compiled JavaScript; acceptance, contract, integration,
and unit tests. V8 coverage includes every emitted production module, including unexecuted
modules; authentication and revocation implementation files each require 100% branches.
Security coverage inventory and source/emitted-file checks prevent omissions. No Babel,
`ts-jest`, Supertest, or extra coverage package is required.

**Target Platform**: Local macOS/Linux development and a single-process Linux-compatible
authority topology. Real deployment uses HTTPS and a host-supplied identity adapter;
loopback-only development/test servers use explicit fixture identity. Native SQLite's
Node 24 binding is Release Candidate, not Stability 2; see the bounded adoption decision
and alternative analysis in research.

**Project Type**: Backend web service plus a gateway enforcement integration contract and
test gateways. Existing platform business endpoints and identity-provider implementation
remain outside this feature.

**Performance Goals**: Aggregate 100 validations/second; validation p95 <=100 ms and p99
<=250 ms; successful revocation p95 <=1 second and p99 <=2 seconds, including effective
enforcement. Measure from service request receipt to response. These are acceptance gates,
not measurements already achieved.

**Constraints**: Zero post-revocation accepting decisions, no offline cached positives,
immutable Tenant ownership, terminal revocation, salted SHA-256 only, no retained raw keys,
security tests first, and TDD evidence. Existing identity/membership/service trust is injected
through a typed port; neither request headers nor body Tenant selectors prove authority.

**Scale/Scope**: Planning baseline, not a user-selected quota: 1,000 Tenants and 100,000
retained key records, distributed at 100 per Tenant in the baseline load fixture. Include
active and revoked records. Gateways >=2 in acceptance tests; one authority. No production
uptime SLA or multi-region/active-active promise. Preserve acknowledged revocations over
process restart; missing/corrupt state means not ready and denial. Hardware and record
volume assumptions must be reported with benchmark results.

### Research Resolution and Engineering Decisions

Phase 0 resolves runtime/storage maturity, secret format and historical uniqueness, existing
identity integration, revocation/cache ordering, audit recovery, tooling, and benchmark
assumptions in [research.md](research.md). Earlier spec deferrals of algorithm and technology
are resolved by constitution v1.2.0 and this design; the behavioral specification is unchanged.

- Raw key format: eight random base64url prefix characters, a dot, and a 32-byte random
  secret encoded as 43 canonical base64url characters. The full 52-character value is the
  API Key; its first eight characters are the Key Prefix. Salt: 16 independently random
  bytes. Key Hash: SHA-256 over `saltBytes || UTF8(fullApiKey)`; fixed salt length removes
  concatenation ambiguity. Compare 32-byte digests with built-in constant-time comparison.
- Historical uniqueness: within serialized issuance, look up every record sharing a candidate
  prefix across all Tenants, including revoked records, and recompute each salted hash.
  Regenerate a duplicate candidate. Never persist an unsalted fingerprint to deduplicate.
- Management: `POST /v1/api-keys`, `GET /v1/api-keys`, and
  `POST /v1/api-keys/revocations`; explicit `X-Tenant-ID` on each request. Validation:
  `POST /v1/api-keys/validations` with a separate existing service bearer identity.
- Identity: require a host-provided `IdentityVerifier` at normal bootstrap. It returns
  verified identities, developer membership, service trust, and trusted expected Tenant
  context. A missing adapter prevents normal startup. The fixture adapter is available
  only in explicit loopback development/test composition, never as a production fallback.
- Audit: persist attempt records before management processing; normally commit key mutation
  and terminal audit outcome together. Recover interrupted attempts before readiness.
  Preserve committed revocation even when audit finalization or response delivery fails.
  Unknown outcomes use the spec's unavailable errors and safe retries. Total durable-storage
  loss cannot guarantee durable audit: emit a secret-free emergency event, become not ready,
  and make no durability/availability claim outside the documented fault envelope.
- Protocol and port definitions are in [contracts/openapi.json](contracts/openapi.json),
  [contracts/internal-boundaries.md](contracts/internal-boundaries.md), and
  [contracts/gateway-enforcement.md](contracts/gateway-enforcement.md).

### Authorization and Revocation Ordering

All final validation decisions and revocation transitions pass through one shared service
ordering gate. Verify caller identity/context first; perform the final fresh status and
Tenant check and finalize the decision inside the gate, with no asynchronous gap. Hash
work can precede it, but never replaces its final check. A decision cannot reuse an earlier
SQLite snapshot. No repository transaction crosses an awaited network call.

Revocation becomes effective at the durable active-to-revoked commit. It records the original
revocation time and advances that key's generation atomically. Repeated revocation does
not change either. Every gateway authorization request obtains a new authority decision.
Generation is advisory stale-entry metadata; changing it is not evidence that every gateway
received a notification. Cached positive hints have no independent authority, so their
eligibility to authorize is invalidated immediately at the authoritative transition.

Let R be that commit and D a finalized authority decision. The shared gate orders both. If
D occurs after R, its fresh read rejects the key. Gateways cannot introduce a separate
later positive decision from a cache. A delayed response for an operation authorized before
R applies only to that same already-admitted operation; it cannot authorize another request.
Physical cache eviction can occur later without granting a grace period. Incompatible
existing gateways that authorize from cached positives must adopt this contract before use.

### Request Deadlines, Cancellation, and Retries

The normative [request lifecycle contract](contracts/request-lifecycle.md) resolves U1.
These are chosen design defaults, not measurements or additional user-selected SLAs:

| Trusted composition setting | Default |
|-----------------------------|---------|
| `gatewayValidationTimeoutMs` | 500 ms |
| `validationTimeoutMs` | 200 ms |
| `identityTimeoutMs` | 100 ms total across verifier calls |
| `managementTimeoutMs` | 2000 ms |

Use absolute local monotonic deadlines, a shared non-resetting identity budget, and typed
framework-free cancellation context. Abort/ignore late async work, reject expired gate
waiters, and allow no new positive validation or late success at/after its deadline.
Synchronous transactions must resolve safely; cancellation cannot undo a committed revoke.
Existing E-08/E-09/E-10/E-14 and rejection-path errors remain unchanged. Disconnected clients
receive no body; a lost reply is not success or permission to recover a secret.

Automatic retries are zero at gateways, the authority, and identity adapters; zero SQLite
busy wait prevents hidden lock retry loops. Explicit revocation retries remain idempotent;
explicit validation retries use a fresh requestId. Creation retries are distinct attempts.
Deadlines do not preempt synchronous SQLite/crypto or replace p95/p99 evidence. The contract
defines configuration validation, exact expiry boundaries, error mapping, and load accounting.

### TDD, Coverage, and Validation Strategy

The first tasks generated later must deliver runnable Jest security acceptance tests and
minimal harness preparation within those same opening tasks. They must fail at behavioral
assertions before production implementation. Compilation/import/configuration failures do
not count. Stubs may make the harness runnable but cannot implement the intended behavior.
Record the failing command/assertion, minimal implementation, passing command, and coverage
result for each behavior; refactor only while green.

Required opening acceptance cases: secret-free logs/events on success and failure; two
independent warmed gateway caches; rejection after revocation despite retained stale hints;
partition denial; an in-flight decision paused before revocation; delayed pre-revocation
results bound to one operation; irreversible and idempotent revocation; restart after commit;
missing/invalid identities and foreign Tenant access. Assertions involving generated secrets
must report sanitized booleans/codes, never dump secrets in Jest diffs or persisted evidence.

Compile all production sources and tests before Jest. The coverage build disables source
maps to keep emitted-file threshold paths deterministic; source-to-emitted inventory checks
ensure every security source is represented. Collect every `build/src/**/*.js` file. Enforce
100% branch thresholds for every implementation file that owns authentication, validation,
revocation, gateway admission, or their identity/persistence security branches. No ignored
branches, skipped security tests, relaxed thresholds, or file exclusions may bypass the gate.

Performance acceptance: 60-second warm-up followed by 300 seconds of fixed-rate 100/second
validation arrivals, 50% active matching, 30% unknown, 10% revoked, and 10% foreign-Tenant
keys; add one revocation/second with event recording enabled. Use nearest-rank percentiles,
count failures/timeouts, and continuously assert revocation ordering. Include checkpoint
activity. Run normal-performance and correctness-under-fault scenarios separately; faults
never justify accepting an unconfirmed key. Report offered/completed rates and all errors;
fast service-unavailable responses must not substitute for successful active-key validation.

| Requirements | Design and verification |
|--------------|-------------------------|
| FR-001–FR-003, FR-005–FR-006 | OpenAPI management contracts; creation/listing/Tenant tests; SC-001, SC-005, SC-007 |
| FR-004 | Salted hash format, prefix-candidate historical uniqueness, secret-free storage/log tests; SC-001, SC-004 |
| FR-007–FR-008, FR-016 | Existing identity port, trusted-service-only validation, final status gate, full error tests; SC-002, SC-006 |
| FR-009–FR-011 | Atomic terminal transition, shared gate, gateway contract, crash/concurrency tests; SC-003, SC-004 |
| FR-012 | No expiry field or scheduled state transition; SC-007 |
| FR-013–FR-015 | Literal error mappings, no false success, uncertainty recovery and failure injection; SC-006 |
| FR-017–FR-019 | Fixed-arrival workload and percentile gates with revocation checks; SC-008–SC-010 |
| FR-020 | Secret-free attempt/outcome records and recovery, success/failure acceptance tests; SC-011 |

## Constitution Check

**Governing version: 1.2.0. Initial design-intent gate: PASS. Post-Phase-1 design review:
PASS within the single-authority fault model below. These are design checks, not claims
that implementation tests or coverage have run.**

| Principle | Initial gate | Post-design evidence |
|-----------|--------------|----------------------|
| I. Enterprise Developer Purpose | PASS | Developer journeys and API-only scope retained; SC-007 validation guide |
| II. Mandatory Tenant Scope | PASS | Explicit scope, verified membership, immutable owner, foreign-Tenant denial |
| III. Irreversible Revocation | PASS | Terminal state, historical secret-reuse check, no delete/reactivate capability |
| IV. Immediate Revocation | PASS | Shared authority gate and fresh per-operation decisions; warmed-cache/partition tests |
| V. Complete Business Specifications | PASS | Actors, exact E-01–E-16 errors, failure outcomes, exclusions retained in contracts |
| VI. Layered Node.js and TypeScript Architecture | PASS | Routes -> services -> repository ports; adapters/composition own infrastructure |
| VII. Salted Hashes and Secret Protection | PASS | Per-key salt/SHA-256, transient raw secrets, no logs/cache payload retention |
| VIII. Minimal Dependencies and Local Development Storage | PASS | Native modules, local SQLite, four justified dev dependencies |
| IX. Test-Driven Development | PASS | Required red-green evidence before production behavior changes |
| X. Security Acceptance Tests First | PASS | Opening-task requirement and concrete executable security scenario scope |
| XI. Jest and Complete Security Branch Coverage | PASS | Jest, all-source collection, security-file inventory, 100% branch gates |

The design assumes an available authoritative local durable volume and host-provided identity
integration. During loss of either, fail closed. During loss of all durable audit storage,
a durable record cannot be guaranteed; emergency events and non-readiness expose the limit.
No production availability SLA, data-loss recovery guarantee, or offline gateway authorization
is claimed. Restoring an older backup must not reintroduce revoked credentials. Deployment
readiness must review runtime maturity, identity adapter wiring, storage durability, capacity,
and recovery procedures; these limits are explicit rather than constitutional exceptions.

## Project Structure

### Documentation (this feature)

```text
specs/001-api-key-lifecycle/
├── spec.md
├── checklists/requirements.md
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   ├── openapi.json
│   ├── internal-boundaries.md
│   ├── request-lifecycle.md
│   └── gateway-enforcement.md
└── tasks.md                    # Produced later by speckit-tasks; not created here
```

### Source Code (repository root)

Planned layout; these files are not created by this planning command.

```text
src/
├── domain/                    # Key/state/value types and domain errors
├── ports/                     # Identity, crypto, repository, unit-of-work, event contracts
├── services/
│   ├── authentication.ts
│   ├── creation.ts
│   ├── listing.ts
│   ├── validation.ts
│   └── revocation.ts
├── routes/api.ts               # HTTP parsing/dispatch/error mapping only
├── adapters/
│   ├── crypto/node-key-crypto.ts
│   ├── identity/host-identity.ts
│   └── sqlite/                 # Bound SQL and transaction adapters only
├── gateway/enforcement.ts      # Online decision consumer; advisory cache only
└── bootstrap/                 # Production dependency injection; explicit dev composition
tests/
├── acceptance/security/        # First implementation deliverable; real HTTP test gateways
├── contract/
├── integration/
├── unit/
├── performance/
└── support/                   # In-memory secrets, fixture identity, failure/scheduling controls
jest.config.cjs
tsconfig.json
tsconfig.test.json
package.json
package-lock.json
build/                          # Generated JavaScript; excluded from Git
coverage/                       # Generated reports; contain no raw keys
```

**Structure Decision**: One backend project. No frontend, product CLI, external database
service, or new identity-provider package. Domain services receive typed values and ports,
not HTTP objects, database drivers, or concrete adapters. Only bootstrap wires infrastructure.
Gateway conformance fixtures exercise the integration boundary without adding platform
business endpoint implementations to scope.

## Complexity Tracking

No constitutional violations or exceptions are requested. Repository interfaces, a shared
authority decision gate, and durable attempt recovery directly support mandatory constraints.
The rejected simpler alternatives—route-owned SQL, offline positive caches, unsalted lookup
fingerprints, and tests added after implementation—violate explicit requirements.
