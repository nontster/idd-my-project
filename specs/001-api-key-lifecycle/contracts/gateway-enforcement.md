# Gateway Enforcement and Immediate Revocation Contract

## Supported Topology

One Node.js authority owns one durable SQLite file/connection and the final authorization
decision. Two or more gateways call that authority online. Gateways have existing trusted
service identities and verified expected Tenant contexts. Independent SQLite copies,
active-active authorities, offline-positive gateways, and asynchronous replicas authorizing
from local state are unsupported.

## Per-Operation Protocol

1. A gateway starts one pending platform operation with a new UUID requestId. It retains the
   presented raw key only transiently while making the validation request.
   Its one outbound attempt has a 500 ms default deadline, shortened by any earlier platform
   cancellation/deadline. It never resets that deadline or automatically retries.
2. It calls `POST /v1/api-keys/validations` with its separate existing service bearer identity,
   requestId, transient API Key, and expectedTenantId selector. Existing platform verification
   establishes the Tenant context; neither a request body nor an unverified header does so.
3. The authority authenticates/trust-checks the caller before examining the API Key. It may
   find salted candidates and compare digests before the final shared ordering gate.
4. Inside that gate it freshly reads authoritative Tenant/status/generation and finalizes
   the decision with no asynchronous gap. It must not reuse an open earlier SQLite snapshot.
   An expired/cancelled request cannot finalize a positive decision: the authority's default
   validation budget is 200 ms, with 100 ms total for all host-verifier calls.
   Every positive decision gets a decisionId bound to this caller/context/requestId.
5. A matching positive response may be consumed once for the original still-pending operation.
   It is not a reusable token. A mismatch, timeout, cancellation, malformed response, authority
   partition, or inability to verify current status denies admission. Discard late responses
   for operations already timed out/cancelled. Never log or cache the raw request/response.

HTTP intermediary caches must not store validation messages. A gateway's application cache
may contain only non-secret key metadata, generation, and advisory active hints. It cannot
make an accepting decision from any hint or a previously returned validation response.

The normative [request lifecycle contract](request-lifecycle.md) defines monotonic deadline
boundaries, configuration, cancellation, and errors. At elapsed time >= the gateway budget,
deny with E-10 meaning and abort the outbound call where supported. Discard late success,
even a pre-R decision for that now-expired operation. An explicit later validation is a new
operation with a new requestId, not a retry/resurrection of the old admission. Never subtract
or compare monotonic timestamps from separate processes.

## Effective Revocation and Cache Invalidation

Within the same authority ordering gate, commit active -> revoked, original timestamp,
mutation correlation, and generation increment durably. That commit is the effective
revocation instant R. Acknowledge success only after enforcement is effective. A repeat
preserves time/generation and returns revoked metadata.

Cached positive entries are logically invalidated at R: they have no eligibility to
authorize a subsequent operation because every operation must cross the authority's fresh
check. Physical byte eviction may happen later and is only cleanup. No claim is made that
a local generation increment instantaneously delivered a notification to disconnected
nodes. A generation match read only from local cache is never authorization evidence.

This contract satisfies instant invalidation through immediate loss of cached authority,
not through a promise of zero network propagation time. An existing gateway that considers
cache lookup or receipt/reuse of an old positive result a new authorization decision violates
this contract and must be changed before integration. Revocation cannot be declared supported
for such a gateway merely because an eviction message was sent.

## Ordering Proof and In-Flight Requests

Let D be the authority's final decision and R the durable revoke commit. The shared gate
totally orders D and R. If D > R, the fresh read observes revoked and denies. Every gateway
admission uses this decision boundary; there is no later independent positive cache decision.
Therefore a cached active hint cannot create an accepting decision after R.

An operation with D < R was already authorized before revocation took effect, matching the
spec's explicit exclusion of retroactive cancellation. Its response can arrive later only
for that same pending operation. It cannot authorize another request, seed a reusable positive
cache, or revive a cancelled operation. Pausing a request before D and resuming it after R
must produce rejection. Response arrival time is not used to relabel an old D as a new one.

## Failure and Restart Rules

- Authority timeout/unavailability/unknown current state: deny, using the E-10 meaning.
  Invalid/revoked key after a successful authoritative check: E-07.
- Isolated gateway with warm active hints: deny even before it learns revocation occurred.
  Reconnection obtains a fresh check and observes E-07 for the revoked key.
- Crash after R before success response: key stays revoked after recovery; repeated revoke
  succeeds idempotently with original time/generation. No audit repair restores active state.
- Restart: recover authoritative database/WAL before readiness, and start gateway caches empty.
  Corrupt/missing state or an unreconciled unsafe recovery state means not ready and denial.
- Do not restore an older active record over a revoked key. A backup restoration needs all
  later revocations preserved or the affected credentials disabled before serving.

## Required Executable Jest Acceptance Scenarios

| Case | Real setup and observation | Required assertion |
|------|----------------------------|--------------------|
| GW-01 | Two separately running HTTP gateways, independent caches, real authority HTTP calls | Active key accepted through both; both active hints populated |
| GW-02 | Revoke after GW-01, await successful acknowledgment | New operations through both gateways reject E-07 immediately |
| GW-03 | Suppress physical eviction and retain both stale hints | Rejection still holds; hints never authorize |
| GW-04 | Partition one gateway from authority while its cache is warm | It denies E-10 before/after revoke; peer rejects after revoke; reconnect observes E-07 |
| GW-05 | Pause validation before final decision, commit revoke, then resume | Rejection; no accepting D after R |
| GW-06 | Delay a response finalized before R | Only original pending operation can consume once; replay/new operation denies |
| GW-07 | Use controlled monotonic time at just-before/exactly 500 ms, authority 200 ms, shared identity 100 ms; cancel before gate entry or delay a positive response beyond expiry | Expiry denies E-10, no reset or implicit retry of any outbound/provider call, late response discarded, expired waiter cannot authorize |
| GW-08 | Restart after successful revoke and after commit-before-response | Key remains revoked; retry preserves original time/generation |
| GW-09 | Inject read/commit/context failures and corrupt verifier material | No stale acceptance or false success |
| GW-10 | Run fixed-arrival 100/second workload and concurrent revokes with event recording | Latency gates and zero post-R positive decisions both hold |
| GW-11 | Cancel/expire a 2000 ms management request before transaction entry and after real revoke commit R | No late queued mutation; committed revoke stays terminal with truthful audit outcome, no late success/replay; explicit repeat preserves original time/generation |

Tests must demonstrate success before revocation, not rely on a gateway that always denies.
They must exercise real cache entries and authority calls, not only spy on an invalidation
method. Scheduling controls can pause at the defined boundary but cannot replace production
security decisions with preselected test answers. Generated secrets and captured log contents
must never be included in test failure messages or persisted test artifacts.
