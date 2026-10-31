# API Key Management Service

A programmatic API for enterprise developers to issue and manage credentials owned by their organizations (**Tenants**). Built with Node.js and TypeScript, native SQLite, and Node's built-in cryptography. There are no external runtime packages.

## Capabilities

- Create an API Key for an explicitly authorized Tenant and receive its full secret **once**.
- List all active and revoked keys in that Tenant using non-secret metadata, including the first eight characters (**Key Prefix**), status, stable identifier, and timestamps.
- Revoke any key in the same Tenant, including a colleague's key. Repeated revocation preserves the original revocation time.
- Let authenticated, trusted platform services validate a key against a verified expected Tenant.
- Record creation and revocation attempts and outcomes without recording raw secrets or Key Hashes.

Keys remain active until manually revoked. Revocation is immediate and irreversible: validation decisions made after the durable revocation commit reject the key. Work authorized before that boundary may finish.

## Requirements

- **Node.js 24.15.0**, pinned in [.nvmrc](.nvmrc). The supported range is `>=24.15.0 <25`.
- npm and the committed lockfile.
- Bundled SQLite **3.51.3 or later** and a local filesystem suitable for SQLite WAL storage.

Build, test, and startup commands check the selected runtime and SQLite version. A local fallback runtime under `.runtime/` is not included in the repository; select the required Node version before installing dependencies in a fresh clone.

## Run locally

```bash
git clone https://github.com/nontster/idd-my-project.git
cd idd-my-project

# Select the Node.js version in .nvmrc before continuing.
node --version
npm ci --ignore-scripts
npm run build

# Initialize a new development store explicitly on first use.
npm run start:dev -- --initialize-fresh-store
```

The development server binds to `http://127.0.0.1:3000` and stores its database at `.runtime/authority.sqlite` by default. It uses explicit local identity fixtures; no external identity provider or database service is needed for development.

On subsequent starts, retain the existing store:

```bash
npm run start:dev
```

Use the initialization flag only when intentionally creating a new development authority. Missing or corrupt authoritative storage must be investigated rather than replaced as a recovery shortcut.

Startup reports the listening port and a `credentialFile` path. This temporary file has mode `0600` and contains development **authentication credentials**, not API Keys. Normal SIGINT/SIGTERM shutdown removes it; a forced kill may leave a file that needs manual cleanup.

The [programmatic walkthrough](specs/001-api-key-lifecycle/quickstart.md#local-server-composition) reads these credentials from the file and exercises creation, colleague listing, validation, secret-retrieval rejection, revocation, and subsequent denial. It prints only status codes and booleans. Keep issued secrets out of shell arguments, logs, snapshots, and saved response bodies.

### Environment variables

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | `3000` | Listening port. |
| `DATABASE_PATH` | `.runtime/authority.sqlite` | Authoritative SQLite file. A custom path's parent directory must already exist. |
| `HOST` | `127.0.0.1` | Development binding only; must remain loopback. Normal startup binds to `127.0.0.1`. |
| `IDENTITY_ADAPTER_MODULE` | None | Required for normal startup; path to the existing platform identity adapter. |

## API

The complete request schemas, response fields, statuses, and error messages are defined in the [OpenAPI contract](specs/001-api-key-lifecycle/contracts/openapi.json).

| Method | Route | Purpose |
|---|---|---|
| `POST` | `/v1/api-keys` | Create a scoped key; return `201` with its secret once. |
| `GET` | `/v1/api-keys` | Return the complete same-Tenant metadata collection. |
| `POST` | `/v1/api-keys/revocations` | Revoke by stable `keyId`; return the original terminal metadata on repeats. |
| `POST` | `/v1/api-keys/validations` | Return a fresh, request-bound decision for a trusted platform service. |
| `GET` | `/v1/api-keys/{keyId}/secret` | Reject later secret retrieval. |
| `POST` | `/v1/api-keys/{keyId}/reactivate` | Reject reactivation; no state-restoration capability exists. |
| `GET` | `/health/ready` | Return only a readiness boolean, with `200` or `503`. |

**Management requests** use an existing developer bearer credential in `Authorization: Bearer …` and an explicit `X-Tenant-ID` selector. The host identity adapter verifies membership. An API Key does not grant management authority.

**Validation requests** use a separate trusted-service bearer credential and a JSON body containing `apiKey`, `expectedTenantId`, and a fresh UUID `requestId`. The host adapter verifies the expected Tenant context. Developer credentials and possession of an API Key alone do not authorize this endpoint.

All API responses are JSON with `Cache-Control: no-store`. Errors use a fixed envelope, for example:

```json
{
  "error": {
    "code": "E-07",
    "message": "Invalid or revoked API key."
  }
}
```

Unknown, malformed, revoked, prefix-only, and foreign-Tenant keys share the same validation rejection. Unconfirmable validation denies access with `E-10`. See the [failure catalog](specs/001-api-key-lifecycle/spec.md#failure-behavior-and-user-facing-errors) for all exact messages and business outcomes.

If creation completion is uncertain or its response is lost, the secret cannot be recovered. List the Tenant's records and revoke unwanted keys before choosing another creation attempt. Revocation can be retried explicitly and safely; the service performs no automatic retries.

## Security and architecture

HTTP routes handle transport concerns; framework-free services own business rules and access persistence through repository interfaces. Bootstrap supplies concrete adapters and the existing identity integration.

```text
src/
  routes/       HTTP parsing, dispatch, and response mapping
  services/     Authentication, lifecycle, ordering, and attempt coordination
  domain/       Validated values, safe errors, and public projections
  ports/        Identity, repository, crypto, transaction, and clock interfaces
  adapters/     Native SQLite, crypto, identity, logging, and clock adapters
  gateway/      Fresh online, consume-once validation enforcement
  bootstrap/    Normal and explicit development composition
tests/          Security acceptance, contract, integration, unit, and load tests
specs/          Requirements, design, contracts, tasks, and verification evidence
```

- Raw API Keys exist only transiently for issuance and validation. Persistence retains prefixes and independently salted SHA-256 verification data, never recoverable plaintext.
- Prefixes identify keys but are not unique and cannot authorize access. Historical checks prevent reissuing an already-issued secret, including a revoked one.
- A shared authority gate orders final validation decisions and durable revocation commits. Every gateway operation requires a fresh authoritative decision; cached metadata never grants offline access.
- SQLite uses WAL, `synchronous=FULL`, foreign-key enforcement, and zero busy wait. Startup verifies effective settings and prepares the required indexes before accepting the store.
- Deadlines use monotonic time. Late results cannot authorize access, and cancellation cannot undo a committed revocation.

| Default budget | Duration |
|---|---:|
| Shared identity verification | 100 ms |
| Authority validation | 200 ms |
| Gateway validation | 500 ms |
| Management operation | 2000 ms |

These are trusted composition settings, not caller-controlled headers or preemption guarantees for synchronous work. See the [request lifecycle](specs/001-api-key-lifecycle/contracts/request-lifecycle.md) and [gateway enforcement](specs/001-api-key-lifecycle/contracts/gateway-enforcement.md) contracts.

## Tests and verification

```bash
npm run test:acceptance:security -- --runInBand
npm run test:contract -- --runInBand
npm run test:integration -- --runInBand
npm run test:unit -- --runInBand

# Complete regression, coverage, and load gate; npm test is an alias.
npm run test:coverage -- --silent

# Run the load suite separately.
npm run test:performance -- --runInBand
```

Run build, test, and startup commands sequentially: each command rebuilds the shared `build/` directory. Both coverage and performance runs include a **60-second warm-up and 300-second measurement**, so allow at least six minutes per run.

Changes follow TDD: execute a meaningful failing assertion before implementing a behavior, then make it pass and refactor while green. Jest collects every emitted production module and enforces **100% branch coverage in every runtime-bearing production module**, including authentication, revocation, and related security decisions. Compilation or harness failures do not count as behavioral RED evidence.

The [recorded verification](specs/001-api-key-lifecycle/evidence/summary.md) includes **429 passing tests across 58 suites** and **100% branch coverage in 39 runtime-bearing modules**. Type-only emitted wrappers remain collected; the raw aggregate percentage is documented separately.

The full-scale local test uses 100,000 retained keys across 1,000 Tenants, two real HTTP gateways, 100 validations/second, and one revocation/second. The recorded final run completed 30,000 validations and 300 revocations with **zero post-revocation accepts**. These are local measurements, not a production SLA; [full results and hardware](specs/001-api-key-lifecycle/evidence/load-final.json) are retained.

## Host integration and deployment boundary

Normal startup requires an existing authoritative store and a real adapter exporting `identityVerifier` with mode `host`, implementing the [IdentityVerifier interface](src/ports/identity-verifier.ts):

```bash
export IDENTITY_ADAPTER_MODULE=/absolute/path/to/host-adapter.cjs
export DATABASE_PATH=/absolute/path/to/authoritative.sqlite
npm start
```

Missing or fixture identity wiring refuses normal startup. The host supplies existing caller authentication, Tenant membership, trusted validation context, HTTPS, and gateways that follow the fresh-decision contract.

The supported topology is **one authority process and one authoritative durable SQLite volume**. Missing/corrupt storage and unsafe recovery refuse readiness. Explicitly identified backup restores are refused; an unannounced total rollback of the sole volume cannot be detected without external state. Review runtime maturity, storage durability, recovery procedures, and workload sizing before deployment; see the [design rationale](specs/001-api-key-lifecycle/research.md).

## Scope and documentation

This slice does not supply a developer portal, product CLI, identity provider, automatic expiration, rotation, key deletion, secret recovery, reactivation, audit-log browsing, production infrastructure, or multi-authority deployment.

- [Feature specification](specs/001-api-key-lifecycle/spec.md)
- [Architecture and implementation plan](specs/001-api-key-lifecycle/plan.md)
- [Detailed quickstart and validation guide](specs/001-api-key-lifecycle/quickstart.md)
- [Data model](specs/001-api-key-lifecycle/data-model.md)
- [Implementation tasks](specs/001-api-key-lifecycle/tasks.md)
- [Verification evidence](specs/001-api-key-lifecycle/evidence/summary.md)
- [Project constitution](.specify/memory/constitution.md)
