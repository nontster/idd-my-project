# Quickstart and Validation Guide: API Key Lifecycle

This guide describes the implemented programmatic first slice and its executable validation.
Results and limits are recorded in [evidence/summary.md](evidence/summary.md). No deployed
identity provider, developer portal, product CLI, or production deployment is supplied.

## Prerequisites

- Maintained Node.js 24.x, >=24.15.0; npm; local filesystem suitable for SQLite. The inspected
  host has Node22.21.1; the npm runner uses the verified ignored local Node24.15.0 runtime
  when present. A fresh checkout must install/select the version in .nvmrc; the runtime archive
  is not committed. Build/test/start commands print the selected Node/SQLite capability check.
- Bundled SQLite >=3.51.3, checked by the harness before database startup; WAL/FULL durability
  verified by the adapter. See [research.md](research.md) for native API maturity and assumptions.
- Existing real identity adapter for normal composition, or explicit loopback-only fixture
  composition for local validation. No production fallback to fixture credentials.
- package-lock.json pins the four justified dev dependencies (@jest/globals, @types/node,
  Jest and TypeScript). Normal operation adds no external runtime package or database service.

## Required Command Interfaces

Run from the repository root after selecting Node from .nvmrc. Install from the lockfile.
An offline cached installation was verified with `npm ci --ignore-scripts --offline --cache .npm-cache`;
a fresh checkout normally needs network access for the locked packages.

```bash
node --version
npm ci --ignore-scripts
npm run build
npm run test:acceptance:security -- --runInBand
npm run test:contract -- --runInBand
npm run test:integration -- --runInBand
npm run test:unit -- --runInBand
npm run test:coverage
npm run test:performance -- --runInBand
```

`build` type-checks and compiles production sources and tests to CommonJS under build/.
Jest runs emitted JavaScript with transform disabled; the coverage build disables source
maps and checks source/emitted security-file inventory. Each test script builds its required
output before invoking Jest, so stale compiled files cannot turn a failed build into a pass.
`test:coverage` collects every emitted production module, enforces 100% branches in every
runtime-bearing production module, and checks the source/emission inventory. Empty emitted
wrappers for type-only declarations remain collected but have no runtime decision branches.
`npm test` is the coverage alias. Both coverage and performance commands include the real
60-second warm-up plus 300-second load test; allow at least six minutes per run. Performance runs report actual runtime,
SQLite, hardware, workload, failures, and percentiles with normal instrumentation; security
coverage is a separate mandatory gate, not relaxed to improve benchmark results.

## Deadline and Cancellation Validation

Use the defaults in [request-lifecycle.md](contracts/request-lifecycle.md): gateway 500 ms,
authority validation 200 ms, shared identity verification 100 ms, and management 2000 ms.
They are trusted composition settings, not caller headers or a claim of measured latency.
Tests inject monotonic time; do not rely on flaky sleeps or reduce the production defaults
to claim a normal-load pass. Verify invalid configuration refuses bootstrap, elapsed time
equal to a budget expires it, successive identity calls share one deadline, and no automatic
retry occurs even if a provider ignores cancellation.

Run the focused context and real gateway/revocation suites through the same clean-build interfaces:

```bash
npm run test:unit -- --runInBand --runTestsByPath build/tests/unit/request-context.test.js
npm run test:acceptance:security -- --runInBand --runTestsByPath build/tests/acceptance/security/gateway-admission.acceptance.test.js
npm run test:acceptance:security -- --runInBand --runTestsByPath build/tests/acceptance/security/revocation.acceptance.test.js
```

Require one outbound attempt, E-10 on validation timeout, discarded late provider/positive
responses, no cancelled gate callback executing later, and no post-commit revoke rollback.
Management expiry uses E-08/E-09/E-14 or OPERATION_UNAVAILABLE as applicable; a disconnected
client receives no response. Explicitly repeated revocation is safe; a new creation cannot
recover the original secret. These cases have executed; per-task RED/GREEN and final reports are retained under evidence/.

## Observe Red Before Implementing Behavior

Implementation began by creating executable security acceptance tests and the
minimal runnable harness, then running test:acceptance:security before production behavior.
Record the command and sanitized failing assertion. Fix missing modules, configuration,
compilation, and harness defects until the expected behavioral assertion is the failure.
Those setup failures are not valid red evidence. Implement only enough behavior to make
that test green, rerun it, then refactor while green and run the full coverage gate.

Suggested first behavioral red assertions: a secret-leak detector returns false, and two
warmed gateway caches reject a key after revocation. Tests capture log streams in transient
memory and report only booleans/codes; never include raw keys, captured logs, request bodies,
or creation responses in matcher diffs, snapshots, terminal output, or retained evidence.
Executable cases live in tests/; sanitized per-task history lives in evidence/.

## End-to-End Acceptance Scenarios

The Jest acceptance suite must start a real authority HTTP server and two independent HTTP
gateway servers. Use temporary databases and existing-identity fixtures; generated API Keys
stay in memory only. Refer to [OpenAPI](contracts/openapi.json),
[data model](data-model.md), and [gateway contract](contracts/gateway-enforcement.md).

| Scenario | Expected observable result |
|----------|----------------------------|
| Tenant A developer creates a key | 201, full secret once, prefix equals first 8 chars, active metadata, no hash/salt |
| Same-Tenant second developer lists/revokes | Sees metadata and can revoke the first developer's key |
| List empty/nonempty Tenant | Complete collection including revoked records, no raw secrets/hashes/salts |
| Call secret/re-activation rejection paths | Exact E-11/E-13 for authorized known targets; foreign/unknown IDs E-12 |
| Identity/lookup unavailable on rejection paths | 503 OPERATION_UNAVAILABLE, exact safe message, no key state disclosure |
| Validate with trusted service and verified expected Tenant | 200 bound to the original pending request; no key echoed |
| Validate without identity / with developer identity | E-01 / E-16 before key examination |
| Missing, malformed, unknown, revoked, foreign key | Exact E-06/E-07 mapping; no Tenant disclosure |
| Two gateways with populated active hints, then revoke | Both accept before; both reject after effective revoke, even if physical eviction is suppressed |
| Partition a warm gateway / lose current status | E-10 denial; cache never grants offline access |
| Pause a decision before revoke, then resume | Denied; a pre-revoke response cannot be replayed for a new operation |
| Deadline/cancellation with a warmed gateway | E-10 at expiry, one attempt, late response cannot revive the operation |
| Cancel/expire before mutation entry or after revoke commit | No queued mutation after cancellation; committed revoke/audit truth preserved without late success |
| Duplicate/concurrent revoke | 200 revoked, unchanged original time/generation |
| Commit succeeds but response is lost; restart | Revocation survives, retry safe; creation secret remains irretrievable |
| Same-prefix records / injected historical secret candidate | Correct full-key match; no wrong-key revoke; historical raw secret is never reissued |
| Identity, repository, audit, or crypto fault | Exact unavailable error, no false success or plaintext leakage; committed revoke never undone |
| Inspect logs/events for success and failure | Required event fields/outcomes, explicit unknown identities, no raw keys or Key Hashes |

## Local Server Composition

For the first explicit local initialization:

```bash
npm run start:dev -- --initialize-fresh-store
```

Subsequent starts use `npm run start:dev`. Existing storage is retained even when the explicit
initialization flag is supplied; missing/corrupt previously authoritative storage is never
silently replaced. Startup reads back WAL/FULL, foreign-key enforcement and zero busy wait;
unsafe or unavailable settings refuse opening. Supported existing stores receive the additive
(tenantId, createdAt, keyId) index before readiness without changing retained key/event rows
or the version1 record format. Conflicting index definitions or preparation failure refuse startup.
The local server binds to 127.0.0.1 (PORT defaults to 3000). HOST overrides
must remain loopback. Startup prints a capability record, then safe readiness metadata with
the bound port and a temporary `credentialFile` path. It never prints bearer values or API Keys.
That file has mode 0600 and contains only local fixture authentication credentials for Tenant A,
its colleague, Tenant B, and the trusted service. Normal SIGINT/SIGTERM closes the authority and
removes this file. A forced kill cannot run cleanup; any abandoned local fixture file can be
removed manually and its credentials are not reused on restart.

Use the printed path without putting secret values in command-line arguments. In another
terminal, run this programmatic verification (only status codes/booleans are printed):

```bash
export DEV_CREDENTIAL_FILE=/absolute/path/from/startup/fixture-credentials.json
export SERVICE_URL=http://127.0.0.1:3000
node --input-type=module <<'JS'
import {readFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
try {
  const credentials=JSON.parse(readFileSync(process.env.DEV_CREDENTIAL_FILE,'utf8'));
  const url=process.env.SERVICE_URL ?? 'http://127.0.0.1:3000';
  const responses=[];
  async function request(path,method,token,tenant,body){
    const headers={authorization:`Bearer ${token}`};
    if(tenant)headers['x-tenant-id']=tenant;
    if(body!==undefined)headers['content-type']='application/json';
    const response=await fetch(url+path,{method,headers,body:body===undefined?undefined:JSON.stringify(body)});
    const data=await response.json();responses.push({status:response.status,noStore:response.headers.get('cache-control')==='no-store'});return {status:response.status,data};
  }
  const created=await request('/v1/api-keys','POST',credentials.tenantADeveloper,'tenant-a',{});
  if(created.status!==201||typeof created.data.apiKey!=='string')throw new Error('Creation unavailable');
  const secret=created.data.apiKey;
  const listed=await request('/v1/api-keys','GET',credentials.tenantAColleague,'tenant-a');
  const selected=listed.data.items.find(item=>item.keyId===created.data.keyId);
  if(listed.status!==200||!selected)throw new Error('Listing unavailable');
  const validate=()=>request('/v1/api-keys/validations','POST',credentials.trustedService,undefined,{apiKey:secret,expectedTenantId:'tenant-a',requestId:randomUUID()});
  const valid=await validate();
  const retrieval=await request(`/v1/api-keys/${selected.keyId}/secret`,'GET',credentials.tenantADeveloper,'tenant-a');
  const revoked=await request('/v1/api-keys/revocations','POST',credentials.tenantAColleague,'tenant-a',{keyId:selected.keyId});
  const denied=await validate();
  const safe=[listed.data,valid.data,retrieval.data,revoked.data,denied.data].every(data=>!JSON.stringify(data).includes(secret));
  const verified=valid.status===200&&retrieval.status===409&&retrieval.data.error.code==='E-11'&&revoked.status===200&&denied.status===403&&denied.data.error.code==='E-07'&&safe&&responses.every(response=>response.noStore);
  console.log({verified,created:created.status,listed:listed.status,validated:valid.status,secretRetrieval:retrieval.status,revoked:revoked.status,denied:denied.status,secretAbsentAfterCreation:safe,allNoStore:responses.every(response=>response.noStore)});
  if(!verified)process.exitCode=1;
} catch { console.error({verified:false});process.exitCode=1; }
JS
```

The flow creates once, lists as the colleague, validates with separate service identity,
confirms secret retrieval is rejected, revokes as the colleague, and confirms later denial.
Do not enable verbose HTTP/body logging or save creation responses. The raw API Key stays in
client memory. All API responses use Cache-Control:no-store; GET /health/ready returns only
`{ready:true}` or `{ready:false}`.

Normal startup:

```bash
export IDENTITY_ADAPTER_MODULE=/absolute/path/to/the/real-host-adapter.cjs
export DATABASE_PATH=/absolute/path/to/the/authoritative.sqlite
npm start
```

The module must export `identityVerifier` satisfying
[src/ports/identity-verifier.ts](../../src/ports/identity-verifier.ts), with mode `host` and the
existing platform's caller, Tenant-membership and expected-context verification. Missing or
fixture wiring refuses startup. The normal process requires an existing checked authority
and rejects the local-only fresh initializer. It listens on loopback; the host must provide
HTTPS and its real gateway/service integration before non-development use. There is no new
JWT/OAuth provider. Explicitly identified backup restoration is refused (including when
RESTORED_FROM_BACKUP is set); recovery never infers that an older active backup is safe.

## Load Acceptance

Seed 100,000 salted-hash-only retained records over 1,000 Tenants, including revoked records.
Retain only the small exercised secret pool in memory. Warm for 60 seconds, then offer exactly
100 validation requests/second for 300 seconds using the accepted/rejected mix in plan.md
and one revocation/second with audit recording enabled. Use two gateway consumers.

Required: validation p95 <=100 ms/p99 <=250 ms; successful revocation p95 <=1 second/p99
<=2 seconds. Measure from service receipt to response; include queue time, accepted/rejected
keys, and checkpoint activity. Report offered/completed rates and every failure/timeout.
Use the default timeout settings and report any overrides. Unanswered received requests
count as response-target misses; report completed-response percentiles with sample counts,
unobserved durations, outstanding work, and failed/unconfirmed revokes separately. Do not
discard timeout/cancel samples or manufacture service durations from gateway-only timings.
Active matching keys must keep validating, not be replaced with fast unavailable responses.
Throughout the run, assert zero accepting decisions after each effective revoke. Repeat
fault/concurrency scenarios separately; authority faults must deny, never weaken correctness.

## Completion Evidence

Retain sanitized red/green commands/results, passing contract/integration/security runs,
source-to-emitted inventory, complete security branch reports, and benchmark metadata.
Use the actual final evidence rather than inferring completion from this guide. The evidence
records full-scale load, branch coverage, cancellation, recovery and plaintext-absence checks.
Missing/corrupt authoritative storage fails readiness. Production deployment additionally
requires real identity integration, gateway conformance, runtime/storage maturity review,
revocation-preserving recovery procedures, and sizing against actual workload.
