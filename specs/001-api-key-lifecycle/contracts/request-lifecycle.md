# Request Deadlines, Cancellation, and Retries

This is the normative lifecycle policy for the first slice. It serves integrating
developers and trusted platform services while preserving immediate, terminal revocation.
Values are design defaults chosen to resolve U1, not measured latency or a new business SLA.

## Budgets and Configuration

| Composition setting | Default | Start and scope |
|---------------------|---------|-----------------|
| `gatewayValidationTimeoutMs` | 500 ms | Gateway starts its outbound validation attempt; includes connection, network, authority processing, and reading the complete response |
| `validationTimeoutMs` | 200 ms | Authority receives the HTTP request; includes body processing, identity, queues, hashing, fresh-state decision, and response preparation |
| `identityTimeoutMs` | 100 ms | First host-verifier invocation; one shared budget for authentication and all subsequent membership/trust/context calls in that request |
| `managementTimeoutMs` | 2000 ms | Authority receives a create, list, revoke, secret-retrieval, or reactivation-rejection request; includes audit recording and mutation confirmation |

Use an injected monotonic clock for deadlines, independent of UTC metadata timestamps.
A budget expires when elapsed time is greater than or equal to its configured value.
Each request has one absolute local deadline; waits and successive calls never reset it.
The identity deadline is the earlier of the request deadline and first-verifier-start plus
identityTimeoutMs. The gateway also honors an earlier platform-operation deadline or
cancellation. Clocks/deadlines are local to each process; do not compare absolute monotonic
timestamps across processes or trust a caller-supplied timeout header to extend a budget.

Settings are trusted composition configuration, not request parameters. Require finite
positive integer milliseconds and `identityTimeoutMs <= validationTimeoutMs <
gatewayValidationTimeoutMs`, plus `identityTimeoutMs <= managementTimeoutMs`.
Missing values use the defaults; invalid values refuse bootstrap with a safe configuration
error and no credential/configuration dump. Defaults are used in acceptance and load runs;
report overrides and revalidate the latency gates before adopting them. No configuration
may waive revocation, secrecy, or the specified p95/p99 targets.

Deadlines are cooperative, not a promise that synchronous SQLite/crypto or a blocked event
loop can be preempted. Check remaining time before and after awaited work, on gate entry,
immediately before finalizing a validation decision or starting a mutation transaction,
and before emitting success. Observe elapsed time directly, not only a timer callback.
An overrun cannot produce a new positive decision or begin emitting 2xx response headers.
Network delivery can still occur later; the gateway independently enforces its deadline.
The overrun is still measured and
reported; timers must not be presented as proof of achieved response latency.

## Framework-Free Cancellation Context

Routes translate request receipt and premature disconnect into a typed request context;
do not treat normal completion of reading a request body as cancellation. The context
contains a local deadline and one-way cancellation signal, never credentials or an HTTP
object. Extend the Clock port with monotonic time alongside its existing UTC metadata use.
Identity calls and services receive this context; the host adapter receives its remaining
budget and a cancellation signal. If a provider ignores cancellation, stop waiting and
ignore its eventual result. It must not grant access, start another call, mutate state, or
produce an unhandled rejection. Clear timers/listeners and release transient secret references.

| Cancellation/expiry point | Required outcome |
|---------------------------|------------------|
| Before identity verification completes | Stop further processing; no key examination before caller trust and no key-state mutation; safely record the received management attempt |
| While queued for the ordering gate | Remove or mark the waiter ineligible; it must never execute its decision/mutation callback later |
| During read-only validation/listing | Discard unfinished/late results; no positive validation or partial successful list |
| Before a create/revoke transaction starts | Do not start the mutation; safely finalize the received attempt with its known outcome |
| After a synchronous mutation transaction starts | Let the adapter resolve committed/not-committed/uncertain without awaited network work; cancellation alone must not force rollback or start a replacement transaction |
| After durable revoke commit R | Keep the key revoked; complete/recover safe audit finalization even if the requester disconnected; never roll back revocation or restore cached authority |
| After a creation commit but before delivery | Retain only the hash/metadata, discard the transient secret, and offer no replay/recovery |

The shared gate continues to order R and final validation decision D. Cancellation is
checked before D and mutation entry; it does not retroactively cancel already authorized
platform work. Record known committed outcomes truthfully even when response delivery fails;
uncertain commit outcomes remain unconfirmed and are reconciled through existing attempt IDs.

## Failure Responses

If the connection is writable, expiry/unavailable identity uses the existing HTTP 503
operation mapping below. Do not invent HTTP 408/504 or classify a provider timeout as invalid
credentials. An already determined rejection keeps the existing error precedence. With a
disconnected client, send no body; lack of a response never means success. Every delivered
response remains no-store and contains no secrets, digests, or internal exception details.

| Operation | Code | Exact user-facing message |
|-----------|------|---------------------------|
| Validation, including gateway timeout | E-10 | API key validation is unavailable. Access denied. Try again. |
| Creation | E-08 | Unable to confirm API key creation. Check your key list before retrying. |
| Revocation | E-09 | Unable to confirm revocation. Retry revocation; treat this key as potentially active. |
| Listing | E-14 | Unable to list API keys. Try again. |
| Secret-retrieval/reactivation rejection | OPERATION_UNAVAILABLE | Unable to process this API key request. Try again. |

A gateway that reaches its deadline aborts the outbound attempt where supported, denies
the original operation, and discards all subsequent responses for that operation, including
positive responses finalized before R. A still-pending, non-expired original operation may
consume a matching pre-R decision once under the existing gateway contract.

## Retry Policy

Automatic retries are **zero** at the gateway, authority, and host-identity adapter for all
operations. No implicit SDK retries, retry middleware, database busy-wait/retry loops,
hedged calls, or retry queues are permitted in this slice. SQLite lock contention fails
through the existing unavailable/uncertain outcome; configure zero busy wait. The bounded
eight-candidate cryptographic uniqueness regeneration is unchanged and is not a network,
identity, or transaction retry. Recovery reconciliation is not request replay.

Callers may explicitly retry validation as a new platform operation with a fresh requestId
and fresh authoritative decision; a timed-out operation never resumes. Callers may retry
listing or revocation explicitly; revocation preserves the original timestamp/generation.
Creation is never replayed automatically: list records and revoke unwanted keys before
choosing a new create attempt, which issues a distinct credential and cannot recover a lost
secret. No Retry-After promise, durable retry scheduler, or creation deduplication is added.

## Required Evidence

Use deterministic injected monotonic time and controlled real HTTP/provider boundaries;
verify just-before and exactly-at expiry, shared identity budget across sequential calls,
no deadline reset, cancellation before gate entry, ignored late provider/gateway results,
one outbound attempt, and cancellation crossing a real durable commit. Scheduling controls
must not replace real security decisions or SQLite commit outcomes with canned verdicts.
Keep the real active-key/warmed-gateway baseline before timeout/revocation denial assertions.

Separate fault scenarios from normal load acceptance. In normal load runs, count every
offered attempt and report completed responses, timeouts/cancellations, outstanding work,
and actual elapsed durations separately. Do not invent service durations for requests whose
receipt/response was not observed or drop failures from the offered/completed accounting.
Unanswered received requests count as misses of the response targets; report completed
response percentiles with their sample counts and those misses. Fast E-10 responses cannot
substitute for successful matching active-key validations. Normal fault-free workload must
satisfy each fixture request's expected outcome: valid revocations must succeed, and an
unavailable/timeout result fails that correctness assertion rather than improving the sample.
A timed-out/unconfirmed revoke
is not a successful latency sample and must be reported separately, never silently omitted.
