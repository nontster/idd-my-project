# Internal Boundaries and Integration Contracts

These contracts define responsibilities and method-level semantics, not implementation
bodies. Node.js/TypeScript services remain framework-free. Names below guide implementation;
[openapi.json](openapi.json) defines the wire interface.

## Dependency Direction

HTTP routes -> framework-free services -> domain types and interfaces. Infrastructure
adapters implement interfaces; only bootstrap supplies concrete instances. Routes parse and
serialize HTTP, map safe errors, and invoke services. They do not query SQLite, mutate caches,
perform hash policy, or decide Tenant authority. Services never import HTTP request/response
objects, SQL drivers, filesystem code, or concrete adapters.

Use typed results for invalid input, rejected authorization, unavailable dependencies, and
uncertain mutation outcomes. Never serialize internal errors or raw request objects.

## RequestContext and Clock

Follow [request-lifecycle.md](request-lifecycle.md) for normative budgets, cancellation,
failure mapping, and zero automatic retries. `src/domain/request-context.ts` owns deadline
and cancellation value behavior; `src/ports/clock.ts` supplies monotonic time separately
from UTC audit timestamps. Services receive typed contexts, never HTTP objects. Routes
translate receipt/premature disconnect and project results; bootstrap validates the four
trusted composition settings. Every security decision/transaction entry checks this context.

## IdentityVerifier — Existing Platform Dependency

- `authenticate(credential)` returns verified principal, invalid credentials, or dependency
  unavailable. Missing credentials are handled as E-01 without a provider call.
- `validateTenantIdentifier(selector)` distinguishes missing/structurally invalid scope
  without disclosing whether a well-formed Tenant exists. Actual semantics belong to the
  platform adapter, not a newly invented UUID namespace.
- `authorizeManagement(principal, tenantId)` returns a verified developer Tenant context,
  denied, or unavailable. Nonexistent and inaccessible Tenants are indistinguishable.
- `establishValidationContext(principal, expectedTenantId, requestId)` verifies an already
  authenticated trusted service's expected Tenant context and operation binding. Failure
  to establish trusted context denies access with E-10. The body selector is not proof.

All verifier calls share the request context and a single identityTimeoutMs budget
(default 100 ms from first verifier invocation, clamped to the request deadline). Adapters
receive remaining time and cancellation, perform no automatic retry, and ignore late
settlement even if the provider cannot abort. Expiry is unavailable, never invalid identity.

Host composition must supply the real adapter; no concrete provider, JWT format, OAuth
endpoint, or deployed identity integration is assumed. Absence refuses normal bootstrap.
A developer's identity cannot call validation (E-16). Service identity alone does not grant
management rights. Caller-supplied role/subject/Tenant-membership headers are ignored as
credentials, not trusted. Identity service outages map to E-08/E-09/E-14 for management
and E-10 for validation, never a fabricated invalid-credential result. On the explicit
secret-retrieval and reactivation rejection paths, identity or scoped-lookup unavailability
returns OPERATION_UNAVAILABLE/503: "Unable to process this API key request. Try again."
This response reveals no key state and does not replace any E-01 through E-16 message.

Explicit local/test bootstrap may supply deterministic fixture identities on loopback only.
It must refuse non-loopback listening and cannot be selected as a production fallback.
Production construction has no default verifier and must reject fixture verifier instances.
The host's real integration and HTTPS wiring are required before non-development use.

## KeyCryptography

- Generate a candidate full API Key and separate per-key salt using built-in crypto.
- Extract/check the canonical eight-character prefix and 52-character full-key format.
- Produce SHA-256(saltBytes || UTF8(fullApiKey)); never expose digest/salt in public DTOs.
- Compare fixed-length digest buffers; corrupt stored material is unavailable, not valid.
- All raw keys live transiently in request/issuance memory. Never return them from retrieval
  methods, retain them as closure caches, or attach them to Error/context objects.

No external crypto dependency and no persisted unsalted lookup fingerprint. The historical
uniqueness check must recompute salted candidates, including retained revoked records.

## KeyRepository and MutationUnitOfWork

- Find all verification candidates by prefix for validation; filter by verified Tenant and
  full-secret digest. Prefix-only identification never authorizes.
- Find all same-prefix historical candidates globally for internal issuance non-reuse.
- Find/list metadata within a verified Tenant. List the complete active+revoked collection;
  no incomplete result may be presented as a complete empty/list response.
- Create after serialized historical uniqueness validation; associate creationAttemptId.
- Transition active -> revoked atomically, preserving original time/generation on repeats;
  associate the first revocationAttemptId. No delete, ownership transfer, or reactivation API.
- Commit/rollback reports distinguish not committed, committed, and uncertain. Only a
  confirmed durable transition can produce successful mutation acknowledgment.

The unit-of-work adapter contains SQL/transactions. Its domain-facing transaction callbacks
must not await identity, gateway, or other network I/O. Services share a decision ordering
gate covering validation's final status+decision and revocation commit. Candidate hash work
before that gate must be followed by a fresh final status/owner check inside it.
Cancelled/expired queued contexts cannot enter the callback. Once a synchronous mutation
transaction starts, resolve its actual commit outcome; do not interrupt it solely because
the requester disconnected. A committed revoke survives expiry and audit finalization.
SQLite uses zero busy wait and no implicit transaction retries.

## SecurityEventRepository and Recovery

Begin an attempt before creation/revocation processing; finalize the actual outcome with
normal mutations or a separate failure-only transaction. Use an allowlisted record with
unknown fields explicitly null. Do not retain raw bodies, credentials, hashes, or arbitrary
exception messages. Reconcile interrupted attempts before readiness using the authoritative
mutation correlation IDs; audit response delivery separately from committed mutation truth.

Never undo effective revocation to repair audit recording. On uncertain completion use E-08
or E-09 and preserve recoverable state. A total storage outage means emergency secret-free
stderr event, non-readiness, and refusal of new management work; do not assert durable audit
under total media failure. Tests distinguish injected key-operation failure with available
audit recording from loss of the recording medium itself.

## GatewayDecisionConsumer

Each pending platform operation has a new requestId and a fresh online validation call using
existing trusted service identity. It consumes a matching positive response once; status
hints alone never authorize. Errors, timeout, partition, cancellation, or response mismatch
deny admission. No validation result becomes a reusable bearer capability. See
[gateway-enforcement.md](gateway-enforcement.md).

## Service Responsibilities and Failure Ordering

| Service | Typed inputs | Responsibilities |
|---------|--------------|------------------|
| Authentication | request context, credential, purpose, selected scope, requestId when validating | Existing identity verification, role/trust checks, verified Tenant context |
| Creation | request context, verified developer context, attemptId | Candidate generation, historical non-reuse, transactional record/event, one-time secret DTO |
| Listing | request context, verified developer context | Complete same-Tenant metadata, safe projection |
| Validation | request context, verified service/context, transient full key, requestId | Candidate comparison, final fresh status/owner check, finalized bound decision |
| Revocation | request context, verified developer context, stable keyId, attemptId | Terminal transition, effective invalidation, idempotent outcome, audit recovery safety |

Management order: authentication -> scope presence/format -> verified Tenant authority ->
key identifier presence/format/scoped lookup -> operation. Validation order: authentication
-> trusted-service check -> key presence -> body envelope/request binding and trusted expected
Tenant context -> full-key/status checks -> final decision. Transport parsing never grants
authority and no supplied key/context is examined for validation before caller trust.

Unknown/foreign management IDs share E-12. Untrusted authenticated validation callers get
E-16. Key-only callers get E-01. Missing API Key gets E-06; malformed/unknown/revoked/wrong
Tenant gets E-07. Missing or unconfirmable expected context/current state gets E-10.

## Configuration, Logs, and Security Coverage Inventory

Normal bootstrap requires the maintained Node24 runtime, checked SQLite durability/version,
one authority connection, explicit real identity verifier, and HTTPS integration. Development
uses `npm run start:dev` with loopback-only fixture composition. No secrets are command-line
arguments, checked-in fixture files, or metric labels. Request logging is allowlisted:
operation, safe requestId, status/error code, verified IDs, durations; never raw URI, headers,
body, response body, tokens, digests, or arbitrary stack/message values.

Lifecycle defaults are gateway 500 ms, validation 200 ms, shared identity 100 ms, and
management 2000 ms. Configuration validation and deadline boundaries are defined in
[request-lifecycle.md](request-lifecycle.md); readiness never exposes their values or secrets.

All authentication, validation, revocation, gateway admission, and identity/storage branches
that participate in those security decisions belong in the 100% branch-coverage inventory.
The implementation must maintain explicit file thresholds and an inventory check against
all emitted sources. Routes must not hide security decisions outside that inventory. Crypto
and persistence failure branches relevant to authentication/revocation must be exercised.
Required script interfaces are specified in [quickstart.md](../quickstart.md).
