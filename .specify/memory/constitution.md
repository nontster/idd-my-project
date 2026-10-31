# API Key Management Service Constitution

## Core Principles

### I. Enterprise Developer Purpose

The service MUST serve enterprise developers integrating our platform. Every specification
MUST identify who the capability serves and explain the business outcome it supports for
those users. Capabilities MUST be described in business and domain terms before technical
design choices are introduced.

### II. Mandatory Tenant Scope

Every API Key MUST be created with a specific Tenant scope. Creation without a specific
Tenant scope MUST fail; the service MUST NOT issue an unscoped key. A key's authority MUST
remain within its Tenant scope. This rule establishes organizational ownership and prevents
access across Tenant boundaries.

### III. Irreversible Revocation

A revoked API Key MUST never be re-activated or accepted as active again. Revocation is a
terminal state for that key. Any future capability involving recovery or renewed access
MUST preserve this invariant and MUST NOT restore the revoked key's authority.

### IV. Immediate Revocation

Revocation MUST take effect immediately: once a key is revoked, every subsequent
authentication attempt using it MUST be rejected. There MUST be no grace period during
which a revoked key remains usable. The service MUST NOT report successful revocation
before enforcement is effective. If revocation cannot be completed, the failure MUST be
communicated explicitly rather than reported as success.

Revocation MUST instantly invalidate cached authorization for that key across all API
gateways. Instant invalidation means that no validation decision made after revocation
takes effect may accept the key, including decisions using a previously cached active
status. Revocation success MUST NOT be acknowledged before enforcement is effective across
all gateways. Cache expiry or eventual propagation MUST NOT create a grace period. A
gateway unable to establish current key status MUST deny access; invalidation failure MUST
NOT permit continued acceptance of a revoked key.

Compromised keys can cause catastrophic data leaks. Specifications MUST therefore treat
immediate revocation as a critical business requirement and MUST NOT weaken it for
convenience, availability, or performance.

### V. Complete Business Specifications

Every specification MUST explicitly state:

- Who the capability serves, including the enterprise developer role or context involved.
- What happens on each failure path, including the resulting business state and the exact
  user-facing error message. API error text delivered to an integrating developer counts
  as user-facing text.
- What is explicitly out of scope, with concrete exclusions rather than implicit omissions.

Success-path descriptions alone are insufficient. Specifications covering key creation or
revocation MUST include the applicable tenant-scope rejection, attempted re-activation,
use of a revoked key, and inability to complete revocation as failure scenarios. Reviewers
MUST be able to determine compliance from explicit acceptance scenarios.

### VI. Layered Node.js and TypeScript Architecture

The service MUST use Node.js and TypeScript and MUST enforce these layer boundaries:

- Routes MUST handle HTTP concerns only: parsing requests, accepting verified caller and
  Tenant context, invoking services, and mapping service results to HTTP responses. Routes
  MUST NOT implement domain rules, hashing policy, persistence queries, or file operations.
- Services MUST own domain logic, including Tenant scope, key lifecycle, and revocation
  rules. Services MUST remain framework-free: no HTTP framework imports or request/response
  objects may enter their domain contracts.
- Services MUST access persistence exclusively through repository interfaces. Repository
  interfaces MUST express domain operations without exposing database or file-format
  details. Concrete adapters MUST implement those interfaces and contain storage access.
- Routes MUST NOT bypass services to access repositories or storage. Services MUST NOT
  import concrete repository adapters, database drivers, or storage-file access code.

These boundaries keep business rules independently verifiable and permit storage changes
without coupling domain logic to HTTP frameworks or persistence implementations.

### VII. Salted Hashes and Secret Protection

API Keys MUST never be stored in plaintext. Raw secrets MUST exist only transiently for
issuance and validation and MUST NOT be retained in databases, development files, logs,
diagnostic records, security events, or gateway cache entries. One-time delivery at creation
MUST NOT introduce later secret retrieval or recovery.

Persisted key material MUST be limited to the Key Prefix and a salted SHA-256 Key Hash.
Each key MUST use an independently generated cryptographically random salt; the hash record
MUST retain that salt as verification metadata. Unsalted digests and reversible storage of
the raw API Key MUST NOT be used. Non-secret identifiers, Tenant ownership, lifecycle status,
and timestamps remain permitted metadata. The Key Prefix MUST remain the first 8 characters
and MUST NOT substitute for the secret in validation.

Secret generation, salt generation, hashing, and cryptographic comparison MUST rely on
Node.js built-in crypto capabilities. The SHA-256 requirement MUST apply to all repository
adapters, including development storage. This policy limits exposure if stored records leak.

### VIII. Minimal Dependencies and Local Development Storage

External dependencies MUST be minimized. Plans and dependency changes MUST justify each
new external dependency and explain why Node.js built-ins or existing project capabilities
cannot satisfy the requirement. External cryptography libraries MUST NOT replace the
required built-in crypto capabilities.

Jest is a required development dependency under Principle XI. Additional test dependencies
MUST satisfy the same justification rule.

Development persistence MUST use local SQLite or JSON storage behind the same repository
interfaces used by services. Development MUST be runnable without an external database
service. SQLite and JSON adapters MUST preserve Tenant isolation, hash-only key storage,
and immediate irreversible revocation; local storage MUST NOT relax security rules.

### IX. Test-Driven Development

All implementations MUST follow Test-Driven Development (TDD) using the red-green-refactor
cycle. Before implementing a new behavior or fixing a defect, engineers MUST write the
corresponding test, execute it against the pre-implementation behavior, and observe failure
at the assertion for the intended missing behavior or defect. Only then may they write the
minimum production code needed to make it pass and refactor while keeping tests green.

A test that fails only because of broken test configuration, missing dependencies, syntax
errors, or compilation errors MUST NOT count as the required failing test. Such problems
MUST be corrected until the test runs and fails for the intended behavioral reason.
Implementation reviews MUST include the test command, the observed failing assertion, and
the subsequent passing result. This evidence prevents tests written after implementation
from being presented as TDD.

### X. Security Acceptance Tests First

Every task list, including tasks.md, MUST begin with tasks to write or extend and execute
security acceptance tests before production implementation tasks. The opening test tasks
MUST identify the security behavior, a runnable Jest command, and the expected failing
assertion. Any harness preparation required to execute those tests MUST be included in
the opening test tasks and MUST NOT substitute for an observed behavioral failure.

The executable acceptance tests MUST verify at least:

- Plaintext API Keys never appear in application logs, diagnostic output, or security
  events on either successful or failing paths, while preserving one-time secret delivery.
- Revocation instantly invalidates cached authorization across all API gateways: an active
  key is accepted and caches are populated before revocation, then every gateway rejects
  that key after revocation takes effect. Success MUST NOT precede effective enforcement.
- A gateway unable to confirm current key status denies access; invalidation failure MUST
  NOT permit stale acceptance. A revoked key cannot be re-activated.
- Missing or invalid authentication and unauthorized Tenant access are rejected without
  leaking secrets or permitting changes to another Tenant's keys.

These tests MUST exercise observable security behavior. Assertions that only confirm a
mock invalidation method was called or that return a preselected rejection MUST NOT replace
proof that populated gateway caches stop authorizing the revoked key. Required failures
MUST be observed before implementing the behavior they specify.

### XI. Jest and Complete Security Branch Coverage

Jest MUST be used for automated acceptance, unit, and integration tests. Service-owned
authentication and revocation logic MUST each achieve 100% branch coverage, regardless of
which layer contains the logic. Coverage collection MUST include all source files
implementing those behaviors, including files not executed by a test.

The Jest coverage gate MUST fail whenever any authentication or revocation branch remains
uncovered. Source exclusions, ignored branches, skipped tests, or reduced thresholds MUST
NOT be used to bypass this requirement. Passing coverage percentages MUST NOT substitute
for assertions verifying the required security outcomes and failure paths.

Implementation acceptance MUST include passing Jest results, passing security acceptance
tests, and a coverage report demonstrating 100% branch coverage for authentication and
revocation logic. These gates make security-path completeness a verifiable engineering
requirement.

## Business Context

The API Key Management Service supports enterprise developers integrating our platform
using credentials owned by their organizations. Its business rules establish Tenant
ownership at creation and allow compromised credentials to lose authority immediately and
permanently through revocation.

This constitution establishes business context, domain vocabulary, specification
obligations, and binding architecture, security, and engineering constraints. Node.js,
TypeScript, layered architecture, salted SHA-256 hashing, instant gateway invalidation, and local
SQLite or JSON development storage are fixed constraints for subsequent planning. TDD,
security acceptance tests at the start of every task list, Jest, and 100% branch coverage
for authentication and revocation logic are mandatory engineering gates.

Application and test implementation, endpoint and payload design, concrete database schemas,
repository adapter implementation, invalidation mechanism design, and deployment remain
out of scope for this constitution update. Subsequent specifications and plans MUST comply
with the business invariants, architecture constraints, and engineering gates.

## Domain Vocabulary

Specifications MUST use the following terms consistently and MUST NOT use them
interchangeably:

| Term | Definition |
|------|------------|
| API Key | The raw secret issued. |
| Key Prefix | The first 8 characters of an API Key, used for identification. |
| Key Hash | The salted SHA-256 cryptographic digest of an API Key stored in the database, with its per-key verification salt retained in the hash record. |
| Tenant | The organization owning the API Key. |

A Key Prefix identifies a key; it MUST NOT be described as the raw secret or its stored
digest. References to a Key Hash MUST distinguish the stored digest from the issued API
Key. Changes to these definitions MUST follow the amendment procedure below.

## Governance

This constitution governs business rules, domain vocabulary, specification quality,
architecture, security, and engineering for the API Key Management Service. Specifications
and plans MUST conform to it. Reviewers MUST check the intended users, failure behavior,
exact error messages, explicit scope exclusions, applicable business invariants, and vocabulary
before accepting a specification. Missing information or contradictory requirements MUST
be resolved before the specification is accepted.

Plan and implementation reviews MUST additionally verify the Node.js and TypeScript stack,
HTTP-only routes, framework-free services, repository interface boundaries, salted SHA-256
storage, absence of retained plaintext API Keys, gateway invalidation with zero stale
acceptance, local development persistence, and justification for external dependencies.
Security constraints MUST NOT be waived for development adapters or performance targets.

Task-list reviews MUST verify that executable security acceptance-test tasks come first
and precede production implementation. Implementation reviews MUST verify observed
behavioral failures before implementation, subsequent passing Jest runs, and the 100%
branch coverage reports for authentication and revocation logic. Work missing this evidence
or failing these gates MUST NOT be accepted as complete. Plans MUST include the Jest
coverage gate and the required security acceptance-test scope.

Amendments MUST document the proposed change, its business rationale, affected principles
or definitions, and its impact on existing specifications and plans. Amendments require
project-owner approval. Affected artifacts MUST be identified and brought into compliance
before dependent work proceeds. Reviewers MUST check compliance whenever specifications
or plans change.

Constitution versions MUST follow semantic versioning: MAJOR for incompatible removal or
redefinition of governance or principles; MINOR for new principles, sections, or materially
expanded guidance; PATCH for clarifications and non-semantic wording corrections. Every
amendment MUST record its version and amendment date while preserving the original
ratification date. The original adoption was version 1.0.0.

**Version**: 1.2.0 | **Ratified**: 2026-10-28 | **Last Amended**: 2026-10-29
