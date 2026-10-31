# Data Model: API Key Lifecycle — First Slice

Date: 2026-10-29. Governing inputs: [spec.md](spec.md), constitution v1.2.0, and
[research.md](research.md). This is a model/constraint design, not a migration or implementation.

## API Key and Key Record

An API Key is the transient raw secret, not the database record. A Key Record owns its
persistent lifecycle and verification metadata. Creation returns the secret once; no table,
JSON file, log, event, gateway cache, snapshot, or recovery journal retains it.

| Field | Type | Constraints / visibility |
|-------|------|--------------------------|
| keyId | UUID string | Stable random identifier; primary key; public metadata |
| tenantId | Opaque platform Tenant identifier | Required, verified at creation, immutable; public only in authorized context |
| prefix | 8 ASCII base64url characters | First 8 characters of the full API Key; non-unique identification metadata |
| salt | 16-byte blob | Independent cryptographically random per-key verification salt; internal only |
| keyHash | 32-byte blob | SHA-256(salt bytes followed by UTF-8 full API Key); internal only |
| status | active or revoked | Initially active; only transition is active -> revoked |
| generation | Positive integer | Initially 1; becomes 2 on first revocation; unchanged by repeats |
| createdAt | UTC timestamp | Immutable creation time; metadata |
| revokedAt | UTC timestamp or null | Null exactly when active; first revocation time is immutable |
| creationAttemptId | UUID string | Correlates durable issuance and audit recovery; internal unique identifier |
| revocationAttemptId | UUID string or null | First effective revocation attempt; internal; unchanged by repeats |

The raw format is `8-character-prefix.43-character-suffix`, length 52. The prefix is
base64url of 6 random bytes; the suffix is base64url of 32 independent random bytes.
Reject non-canonical encodings, whitespace, wrong length, or prefix-only inputs. Never trim
or normalize a presented secret. Digest input uses exactly 16 salt bytes followed by the
52 ASCII/UTF-8 raw-key bytes. Reject corrupt salt/digest lengths as unconfirmable status
(E-10); never throw a buffer comparison error containing record data.

`tenantId` follows the existing platform's opaque identifier semantics. Do not invent UUID
Tenant IDs, case folding, or a new Tenant namespace. The HTTP envelope bounds length at
256 characters; the injected platform adapter establishes actual format validity and access.
Header duplicates are invalid scope. Missing/null/empty scope is E-02; malformed is E-03;
well-formed nonexistent and inaccessible Tenants both produce E-04 for management.

## Persistence Constraints and Indexes

- SQLite primary key on `keyId`; non-unique indexes on `prefix` and `(tenantId, createdAt,
  keyId)`; unique `creationAttemptId` for recovery correlation. Lookup and mutation for
  management always include both requested Tenant and stable key identifier.
- Enforce status/revocation-time consistency, fixed salt/digest lengths, immutable Tenant
  ownership, and the terminal revoked state with adapter checks and database constraints
  or triggers. Preserve the first `revokedAt`, generation, and revocation attempt identity.
- Repository queries use bound parameters. Services never receive database connections or
  SQL text. Public DTOs are built from allowlisted fields, never spreads of stored records.
- Do not delete revoked records or add expiration. Historical records are necessary for
  irreversible credential non-reuse. There is no unique-prefix constraint.
- Historical uniqueness is a serialized check across all retained same-prefix records,
  including other Tenants and revoked keys, before insert. Compare a candidate using each
  stored salt; a new random salt alone cannot detect secret reuse. Regenerate on a match,
  bounded at 8 candidates before E-08 for repeated collision/entropy failure. This internal
  global check does not expose another Tenant's key existence.
- One authority connection; WAL plus `synchronous=FULL`; startup verifies settings and
  SQLite >=3.51.3. Do not retain a read snapshot across requests, await inside a mutation
  transaction, or run another active authority on an independent database copy.

## State Transitions and Recovery

| Current state | Operation | Result |
|---------------|-----------|--------|
| No record | Authorized create | New active record, generation 1; secret returned once after committed success |
| active | Authorized revoke | Durable revoked record, generation 2, original revocation time |
| revoked | Authorized revoke again | Successful existing revoked metadata; original time/generation unchanged |
| revoked | Attempt reactivation | E-13; unchanged |
| Any known record | Attempt secret retrieval | E-11; unchanged |
| Unknown/foreign record | Management operation | E-12; no foreign disclosure or mutation |
| active | Matching full key and trusted same-Tenant validation | Request-bound positive decision after final fresh check |
| revoked | Validation | E-07; denied |
| Unconfirmable state | Validation | E-10; denied |

Ordering uses the service's serialized decision boundary, not wall-clock timestamps. The
clock port supplies UTC metadata; timestamp adjustments must not cause reactivation or
alter first revocation time. New issuance always creates a distinct credential and identifier.

After restart, recover the authoritative SQLite file and WAL before readiness. A committed
revocation remains revoked even if its response was lost. Empty gateway caches cannot
synthesize active state. Corrupt/missing state means non-readiness and denial. Restoring an
older backup is prohibited unless all later revocations are preserved or affected keys
remain disabled; this slice does not provide disaster-recovery automation.

## Tenant and Verified Principal

Tenant ownership is a relationship to the existing platform; this service does not create
Tenant or user directories. A verified principal contains a provider-verified subject,
caller kind, service trust if relevant, and the data needed to establish Tenant authority.
Credentials and verification results are request-scoped; raw credentials are never logged.

- Developers manage keys only within a currently verified selected Tenant, regardless of
  which same-Tenant developer created them.
- Trusted platform services may validate, not gain developer management rights merely by
  being services. Authenticated developer callers of validation receive E-16.
- `X-Tenant-ID` and validation `expectedTenantId` are selectors. Existing platform verification
  establishes membership/context; selectors alone have no authority.
- Unknown/unavailable identity dependencies are distinct from invalid credentials; use the
  operation's unavailable error rather than misclassifying them as authentication failures.

## Security Attempt / Event

Persist creation and revocation attempts, including successes and failures. No listing or
validation audit stream is added. Typed, allowlisted fields only:

| Field | Type | Meaning |
|-------|------|---------|
| attemptId | UUID | Service-generated event correlation identity |
| operation | create or revoke | Recognized management operation |
| receivedAt | UTC timestamp | Receipt time; no raw URI/body stored |
| callerId | Verified subject or null | Null means identity is unknown, not a guessed token value |
| tenantId | Verified/scoped ID or null | Unknown is explicit |
| keyId | Known stable ID or null | Null for attempts before identity/record is known |
| outcome | succeeded, rejected, failed, unconfirmed | Actual business outcome, not response-delivery assumption |
| finalized | Boolean | False until terminal outcome/recovery is known |
| errorCode | Safe E-code or transport code, or null | No arbitrary exception text/stack/body |
| completedAt | UTC timestamp or null | Outcome completion time when known |

Create the initial attempt as unconfirmed/unfinalized before processing. Normally finalize
with the key mutation in one transaction; rejection/failure finalizes without key mutation.
On restart, use persisted key operation IDs and transaction outcome to reconcile unfinished
attempts. Do not mark a committed mutation failed merely because its response was lost;
never claim the raw secret was delivered when delivery is unknown.

If finalization/response fails after effective revocation, preserve the revoked state and
resolve audit state through recovery/retry. Never roll an effective revoke back to active.
If all durable storage is unavailable, emit a redacted emergency event, refuse new management
work and fail readiness. That event is not a guarantee of durable recording during total
media failure; see the explicit research fault envelope.

## Gateway Cache Entry and Validation Decision

A gateway may hold `keyId`, `tenantId`, `prefix`, last observed generation/status, and
non-secret observation time. These entries are advisory and cannot authorize an operation.
They contain no raw key, digest, verification salt, reusable access token, or positive bearer
verdict. Eviction or a generation match alone never proves current status.

A validation request has a unique UUID `requestId` bound to one pending gateway operation.
The positive response contains that requestId, a service-generated decisionId, keyId,
tenantId, and generation. Only that original pending operation may consume it once. A timeout,
cancellation, mismatch, malformed response, replay, or authority partition denies access.
Future operations always require a new decision; see the gateway contract for ordering.
