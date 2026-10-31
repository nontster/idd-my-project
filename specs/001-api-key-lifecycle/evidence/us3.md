# US3 gate — T052

Full `npm test -- --silent`:54 suites/380 tests GREEN, no skipped/todo tests, exit0. `check-security-coverage.cjs` returns complete:true. Every runtime-bearing production module has100% branches, including auth/revoke, HTTP, bootstrap/configuration, clock/context, crypto, gateways, storage/recovery and safe audit/logging. All emitted sources remain collected; type-only wrappers are not executable decision logic. Raw aggregate99.27% includes those empty emitted wrappers. No threshold/exclusion/ignore changes.

Real two-gateway ordering, expiry/disconnect on both sides of actual commit, SIGKILL recovery, terminal idempotency and expanded creation/list/colleague-revoke/deny journey all pass. Follow-up security defects were captured in focused REDs: bounded gate waits, response-preparation expiry, local-only fresh initialization, exact envelope/defensive bodyless contracts.

| Runtime module | Covered branches |
|---|---|
| adapters/clock/system-clock.js | 5/5 |
| adapters/crypto/node-key-crypto.js | 37/37 |
| adapters/identity/host-identity.js | 9/9 |
| adapters/logging/safe-logger.js | 9/9 |
| adapters/sqlite/creation-repository.js | 12/12 |
| adapters/sqlite/database.js | 24/24 |
| adapters/sqlite/listing-repository.js | 9/9 |
| adapters/sqlite/recovery.js | 46/46 |
| adapters/sqlite/revocation-repository.js | 20/20 |
| adapters/sqlite/schema.js | 2/2 |
| adapters/sqlite/scoped-key-lookup.js | 11/11 |
| adapters/sqlite/security-events.js | 20/20 |
| adapters/sqlite/unit-of-work.js | 22/22 |
| adapters/sqlite/validation-repository.js | 14/14 |
| bootstrap/app.js | 62/62 |
| bootstrap/configuration.js | 13/13 |
| bootstrap/development.js | 21/21 |
| bootstrap/main.js | 13/13 |
| domain/error-codes.js | 3/3 |
| domain/errors.js | 7/7 |
| domain/key-dtos.js | 3/3 |
| domain/key-metadata.js | 17/17 |
| domain/key-record.js | 31/31 |
| domain/request-context.js | 55/55 |
| domain/security-attempt.js | 32/32 |
| domain/validation-decision.js | 20/20 |
| domain/values.js | 13/13 |
| gateway/enforcement.js | 50/50 |
| routes/api.js | 144/144 |
| services/authentication.js | 77/77 |
| services/creation.js | 42/42 |
| services/decision-gate.js | 17/17 |
| services/listing.js | 18/18 |
| services/management-attempt.js | 84/84 |
| services/reactivation-rejection.js | 19/19 |
| services/revocation.js | 52/52 |
| services/secret-retrieval.js | 15/15 |
| services/validation.js | 45/45 |
