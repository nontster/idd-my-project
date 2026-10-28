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

## Business Context

The API Key Management Service supports enterprise developers integrating our platform
using credentials owned by their organizations. Its business rules establish Tenant
ownership at creation and allow compromised credentials to lose authority immediately and
permanently through revocation.

The current work establishes business context, domain vocabulary, and specification
obligations only. Application implementation, endpoint and payload design, database schema,
cryptographic algorithm selection, architecture, technology choices, and deployment are
explicitly out of scope for this constitution update. They require subsequent specification
or planning work and MUST comply with these business rules.

## Domain Vocabulary

Specifications MUST use the following terms consistently and MUST NOT use them
interchangeably:

| Term | Definition |
|------|------------|
| API Key | The raw secret issued. |
| Key Prefix | The first 8 characters of an API Key, used for identification. |
| Key Hash | The cryptographic digest of an API Key stored in the database. |
| Tenant | The organization owning the API Key. |

A Key Prefix identifies a key; it MUST NOT be described as the raw secret or its stored
digest. References to a Key Hash MUST distinguish the stored digest from the issued API
Key. Changes to these definitions MUST follow the amendment procedure below.

## Governance

This constitution governs business rules, domain vocabulary, and specification quality
for the API Key Management Service. Specifications and subsequent plans MUST conform to
it. Reviewers MUST check the intended users, failure behavior and exact error messages,
explicit scope exclusions, applicable business invariants, and vocabulary before accepting
a specification. Missing information or contradictory requirements MUST be resolved before
the specification is accepted.

Amendments MUST document the proposed change, its business rationale, affected principles
or definitions, and its impact on existing specifications and plans. Amendments require
project-owner approval. Affected artifacts MUST be identified and brought into compliance
before dependent work proceeds. Reviewers MUST check compliance whenever specifications
or plans change.

Constitution versions MUST follow semantic versioning: MAJOR for incompatible removal or
redefinition of governance or principles; MINOR for new principles, sections, or materially
expanded guidance; PATCH for clarifications and non-semantic wording corrections. Every
amendment MUST record its version and amendment date while preserving the original
ratification date. This first adoption is version 1.0.0.

**Version**: 1.0.0 | **Ratified**: 2026-10-28 | **Last Amended**: 2026-10-28
