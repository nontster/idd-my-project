# Feature Specification: API Key Lifecycle — First Slice

**Feature Branch**: `001-api-key-lifecycle`

**Created**: 2026-10-29

**Status**: Draft

**Input**: User description: "Help me specify the first slice of the API Key Service where a
developer can generate a new API key, view the full secret once, and revoke the key
immediately if compromised." Scope clarified through one-at-a-time questions: programmatic
API only; authorized developers may revoke any key within their Tenant; include listing
with Key Prefix and status; reuse existing authentication and Tenant membership; no
automatic expiration; include API Key validation.

## Clarifications

### Session 2026-10-29

- Q: Who should be allowed to call the API Key validation capability? → A: Only trusted
  platform services, authenticated through existing service identity.
- Q: What peak rate of API Key validation should this first slice support? → A: 100 validations
  per second, aggregate across all Tenants.
- Q: At 100 validations per second, how quickly should the service return a validation
  decision? → A: 95% within 100 ms; 99% within 250 ms, measured from service receipt to
  response for both accepted and rejected keys.
- Q: While the service handles 100 validations per second, how quickly should a successful
  revocation finish? → A: 95% within 1 second; 99% within 2 seconds, measured from service
  receipt to success response with enforcement already effective.
- Q: Which security events should this first slice record for incident investigation? → A:
  Creation and revocation attempts, including successes and failures; include timestamp,
  caller identity, Tenant and key identifiers when known, operation, and outcome, excluding
  raw secrets and Key Hashes. Audit-log browsing remains out of scope.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Generate a Tenant-Scoped Key and Receive Its Secret Once (Priority: P1)

As an authenticated enterprise developer integrating the platform, I want to create an API
Key for a specific Tenant I belong to and receive the full secret in the creation response,
so I can configure my integration without a later secret-retrieval capability.

**Why this priority**: Creation and one-time secret delivery provide the credential needed
for integration while limiting subsequent exposure.

**Independent Test**: With an existing authenticated developer and authorized Tenant, create
one key, verify its Tenant ownership and initial status, and inspect all later outputs to
confirm that none disclose the full secret or Key Hash. This story can be tested separately
from validation and revocation.

**Acceptance Scenarios**:

1. **Given** an authenticated developer authorized for Tenant A, **When** they create a key
   with explicit Tenant A scope, **Then** one new active key belongs to Tenant A and the
   successful creation response contains its full API Key, stable key identifier, Key
   Prefix, status, and creation time. The Key Prefix is the first 8 characters of that secret.
2. **Given** a creation request without a Tenant scope or with an invalid Tenant scope,
   **When** it is submitted, **Then** creation fails with E-02 or E-03 respectively and no
   key is issued.
3. **Given** a developer without valid authentication or without authority for the specified
   Tenant, **When** they request creation, **Then** E-01 or E-04 applies respectively and
   no key is issued for that request.
4. **Given** a successfully created key, **When** any later listing, validation, revocation,
   or attempted secret-retrieval request occurs, **Then** no full secret is returned;
   attempted retrieval is rejected with E-11 and the key's lifecycle state is unchanged.
5. **Given** creation encounters an operational failure, **When** success cannot be
   confirmed, **Then** the caller receives E-08 if a response can be delivered and MUST NOT
   be told creation succeeded. If the full creation response is lost, the secret is
   irretrievable; listing can reveal any resulting key record for subsequent revocation.
6. **Given** previously issued active and revoked keys, **When** another key is created,
   **Then** its secret differs from every previously issued secret. Retained key information
   contains a Key Hash instead of a recoverable raw secret, diagnostic records contain no
   raw secret, and no caller-facing response exposes the Key Hash.
7. **Given** a creation attempt reaches the service, **When** it succeeds, is rejected,
   fails, or has an unconfirmed outcome, **Then** a security event records its timestamp,
   operation, outcome, and caller, Tenant, and key identifiers when known. The event
   contains neither the raw API Key nor its Key Hash.

---

### User Story 2 - Validate a Key for Tenant Access (Priority: P1)

As an enterprise developer whose integration accesses the platform, I want an active API
Key to authorize access only within its Tenant scope and an invalid or revoked key to be
rejected, so my organization's access boundary is enforced.

**Why this priority**: Issuing a credential has business value only if the platform can
recognize it and refuse invalid credentials.

**Independent Test**: Using an authenticated trusted platform service and prepared active
and revoked key records for two Tenants, validate presented secrets against the expected
Tenant context. Verify acceptance only for the matching active key and rejection of
unauthenticated or unauthorized callers, without relying on creation in the same test.

**Acceptance Scenarios**:

1. **Given** an authenticated trusted platform service, an active API Key belonging to Tenant
   A, and a trusted access context for Tenant A, **When** the service validates the full
   secret, **Then** validation succeeds and confirms Tenant A and the stable key identifier
   without echoing the secret or Key Hash.
2. **Given** a missing API Key, **When** validation is requested, **Then** access is denied
   with E-06.
3. **Given** a malformed, unknown, or revoked API Key, a Key Prefix supplied instead of the
   full secret, or a key belonging to a different Tenant, **When** validation is requested,
   **Then** access is denied with the same E-07 message. No other Tenant's identity or key
   existence is disclosed.
4. **Given** that current key status or the trusted Tenant context cannot be established,
   **When** validation is requested, **Then** access is denied with E-10 rather than
   assuming that the key is active or accepting an unverified Tenant claim.
5. **Given** a matching active key that has not been manually revoked, **When** time passes
   and it is validated again, **Then** it remains eligible for access; this slice introduces
   no automatic expiration.
6. **Given** a caller without valid service authentication or an authenticated caller that
   is not a trusted platform service, **When** they request validation, **Then** E-01 or
   E-16 respectively is returned before the API Key is examined. No validity result, Tenant,
   key identifier, or other key metadata is disclosed, even if the presented key is active.
   Developer authentication or possession of the API Key alone does not authorize validation.
7. **Given** trusted platform services submit an aggregate of 100 validations per second
   across Tenants, **When** active matching, invalid, foreign-Tenant, and revoked keys are
   validated, **Then** the same access decisions and error messages apply as at lower load,
   revocation remains immediately effective, at least 95% of validation responses complete
   within 100 ms, and at least 99% complete within 250 ms, measured from service receipt
   to response for accepted and rejected keys.

---

### User Story 3 - Revoke a Compromised Key Immediately (Priority: P1)

As an authenticated enterprise developer, I want to revoke any key belonging to my Tenant,
including a colleague's key, so a compromised credential loses access immediately and
permanently.

**Why this priority**: Compromised credentials can cause catastrophic data leaks. Revocation
and its enforcement are mandatory parts of this slice.

**Independent Test**: With prepared keys and two authenticated developers belonging to the
same Tenant, revoke a key as the developer who did not create it and use an authenticated
trusted platform service to validate the secret again. Repeat with a developer from another Tenant. Creation and listing need not run in
this test.

**Acceptance Scenarios**:

1. **Given** an active key in Tenant A, **When** an authorized developer in Tenant A revokes
   it by stable key identifier, **Then** its status becomes revoked, revocation time is
   recorded, and success is returned only after revocation is effective. The response
   identifies the key and revoked status without exposing its secret or Key Hash.
2. **Given** a key created by another developer in Tenant A, **When** an authorized Tenant A
   developer revokes it, **Then** revocation succeeds under the same rules; creator
   ownership does not restrict revocation.
3. **Given** successful revocation, **When** any new validation of that key starts,
   **Then** access is denied with E-07 with no grace period, including checks made through
   every supported platform access path that consumes this validation capability.
4. **Given** validation and revocation occur concurrently, **When** revocation takes effect,
   **Then** no validation decision made afterward may accept the key. An operation already
   authorized before revocation took effect is not required to be cancelled.
5. **Given** an already revoked key in the caller's Tenant, **When** revocation is repeated
   or concurrent revocation requests occur, **Then** revocation succeeds idempotently, the
   original revocation time is preserved, and the key remains revoked.
6. **Given** missing authentication, an unauthorized Tenant scope, a missing key identifier,
   or an unknown or foreign-Tenant key identifier within an otherwise authorized Tenant
   context, **When** revocation is requested, **Then** E-01, E-04, E-05, or E-12 respectively
   applies and the request changes no key state.
7. **Given** revocation encounters an operational failure, **When** completion cannot be
   confirmed, **Then** E-09 is returned if a response can be delivered and success is not
   reported. The key's state MUST NOT be reset to active; callers may retry and list its
   actual state, treating it as potentially active until revocation is confirmed.
8. **Given** a revoked key, **When** re-activation is attempted, **Then** the request is
   rejected with E-13 and the key remains revoked. A newly issued replacement key is a
   distinct credential, not a re-activated key.
9. **Given** an aggregate load of 100 validations per second, **When** authorized developers
   revoke active same-Tenant keys, **Then** at least 95% of successful revocations finish
   within 1 second and at least 99% within 2 seconds, measured from service receipt to
   success response. Each response confirms effective revocation; validation decisions made
   after revocation takes effect reject the key throughout the test.
10. **Given** a revocation attempt reaches the service, **When** it succeeds, is rejected,
    fails, or has an unconfirmed outcome, **Then** a security event records its timestamp,
    operation, outcome, and caller, Tenant, and key identifiers when known. The event
    contains neither the raw API Key nor its Key Hash, and event recording MUST NOT undo
    effective revocation or permit acceptance of a revoked key.

---

### User Story 4 - List Non-Secret Key Metadata Within a Tenant (Priority: P2)

As an authenticated enterprise developer, I want to list my Tenant's keys and see their
Key Prefix and status, so I can identify a key to revoke without disclosing any secret.

**Why this priority**: Listing supports discovery and incident response. P2 orders the
stories; listing remains required in this first slice.

**Independent Test**: Prepare active and revoked records in two Tenants, then list as an
authorized developer for one Tenant. Verify the record set, metadata, and absence of
secrets without running creation, validation, or revocation during the test.

**Acceptance Scenarios**:

1. **Given** Tenant A has active and revoked keys, **When** an authorized Tenant A developer
   lists its keys, **Then** the results contain only Tenant A records, including keys
   created by other developers, with stable identifier, Key Prefix, status, creation time,
   and revocation time when revoked. Neither full API Keys nor Key Hashes are included.
2. **Given** a Tenant with no keys, **When** its authorized developer lists keys, **Then**
   the result is an empty successful collection rather than an error.
3. **Given** a developer without valid authentication or authority for the specified
   Tenant, **When** listing is requested, **Then** E-01 or E-04 applies and no metadata
   is returned.
4. **Given** listing cannot be completed, **When** the request fails, **Then** E-14 is
   returned rather than a misleading empty successful collection.
5. **Given** two keys share a Key Prefix, **When** they are listed and one is selected for
   revocation, **Then** their distinct stable identifiers allow only the intended key to
   be revoked; the prefix alone is not a unique identity or credential.

### Edge Cases

- A missing or invalid explicit Tenant scope on any management operation produces E-02 or
  E-03 with no mutation or metadata disclosure. Untrusted Tenant claims do not establish
  membership or validation context.
- A developer belonging to several Tenants must select one authorized Tenant per management
  request. Membership in one Tenant never confers access to another.
- A lost creation response does not permit replaying the same secret. Retrying creation is
  a new creation attempt and may result in another distinct key; callers can list records
  and revoke unwanted keys. Automatic duplicate-request recovery is not promised.
- Full secrets are absent from errors, listing, validation, revocation, and unsupported
  retrieval or re-activation responses. Key Hashes are internal and never returned.
- Unknown and foreign-Tenant key identifiers are indistinguishable to callers in an
  otherwise authorized Tenant context. Rejection never changes the foreign key's state.
- After revocation, stale status information must never cause validation to accept the key.
  If current status cannot be established, validation denies access using E-10.
- A lost revocation response does not undo revocation. Repeating revocation of the same key
  is safe; listing exposes the actual status once it can be read successfully.
- Already authorized work is not retroactively cancelled by revocation; new validation
  decisions after revocation takes effect must fail.
- Unsupported lifecycle operations are rejected without state changes. Secret retrieval and
  re-activation use E-11 and E-13; other unsupported lifecycle operations use E-15.
- Creation and revocation events distinguish success, rejection, operational failure, and
  unconfirmed outcome. Unknown caller, Tenant, or key identity is recorded as unknown;
  event records MUST NOT invent an identity or a confirmed result.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The service MUST expose creation, listing, validation, and revocation through
  a programmatic API only for this slice, serving enterprise developers integrating the
  platform. Routes, transport details, and payload schemas are deferred to planning.
- **FR-002**: All management operations MUST rely on existing developer authentication and
  verified Tenant membership. Each operation MUST identify an explicit authorized Tenant
  scope and reject missing, invalid, or unauthorized scope. API Keys from this slice MUST
  NOT by themselves grant key-management authority.
- **FR-003**: Creation MUST issue one new active API Key for the specified authorized Tenant
  and return its full secret exactly once, solely in the successful creation response. A
  key MUST NOT be issued without a specific Tenant or authorize a different Tenant.
- **FR-004**: Each issued secret MUST be distinct from all previously issued secrets,
  including revoked keys, so creating another key cannot restore a revoked credential.
  The service MUST retain a Key Hash for validation rather than retain the raw secret for
  subsequent recovery. The raw secret MUST NOT be persisted in logs or diagnostic records.
- **FR-005**: Every key MUST have a stable non-secret identifier, Tenant owner, Key Prefix
  consisting of its first 8 characters, active or revoked status, creation time, and
  revocation time when applicable. Key Prefix collisions MUST NOT cause ambiguity in
  validation or revocation; the prefix MUST NOT substitute for the full secret.
- **FR-006**: Listing MUST expose all active and revoked key records within the selected
  authorized Tenant, with the metadata in FR-005, and no records from any other Tenant.
  The full secret and Key Hash MUST NOT appear in listing or other later outputs.
- **FR-007**: Authenticated trusted platform services MUST be able to validate a presented
  full API Key against its stored Key Hash, current status, and trusted expected Tenant
  context. Validation MUST succeed only for an active matching key in that Tenant and
  confirm its owning Tenant and stable identifier without echoing the secret or Key Hash.
- **FR-008**: Validation MUST deny access for missing, malformed, unknown, revoked,
  foreign-Tenant, or unconfirmable keys using E-06, E-07, or E-10 as applicable. Validation
  MUST NOT accept a caller-supplied Tenant claim without trusted context.
- **FR-009**: Any authorized developer within a Tenant MUST be able to revoke any key
  owned by that Tenant, regardless of its creator, using its stable identifier.
- **FR-010**: Revocation MUST be immediate and irreversible: after revocation takes effect,
  no validation decision may accept that key. Success MUST NOT be acknowledged before
  enforcement is effective across all supported consumers of the validation capability.
  No grace period or stale acceptance is permitted.
- **FR-011**: Repeated or concurrent revocation of an already revoked same-Tenant key MUST
  succeed without restoring access or changing its original revocation time. No operation,
  including re-activation or recreation, may restore the same revoked secret's authority.
- **FR-012**: Keys MUST remain active until manually revoked; automatic expiration MUST NOT
  be introduced in this slice.
- **FR-013**: Failures MUST follow the error catalog below, expose no secrets or internal
  digests, and never claim success when the outcome is unconfirmed. Unknown or foreign
  records MUST NOT be distinguishable across Tenant boundaries.
- **FR-014**: When creation or revocation completion is uncertain, the service MUST NOT
  fabricate a successful outcome, roll a revoked key back to active, or offer secret
  recovery. Listing and safe repeated revocation MUST support resolving uncertain state.
- **FR-015**: A failure before any state change MUST leave existing state unchanged.
  Failed authentication, Tenant authorization, validation, and unsupported operations MUST
  NOT issue keys, revoke keys, or change Tenant ownership.
- **FR-016**: Only trusted platform services authenticated through existing service identity
  MUST be authorized to call validation. Caller authentication and authorization MUST occur
  before key examination. Missing or invalid service authentication MUST produce E-01;
  authenticated callers outside the trusted platform services MUST receive E-16. Developer
  authentication and possession of an API Key alone MUST NOT grant validation authority.
- **FR-017**: The service MUST support an aggregate peak rate of 100 API Key validations per
  second across all Tenants and trusted platform services, while preserving Tenant isolation,
  secret protection, and immediate revocation. This is a service-wide target, not a
  per-Tenant allocation or quota.
- **FR-018**: At an aggregate offered load of 100 validations per second, the service MUST
  return at least 95% of validation responses within 100 ms and at least 99% within 250 ms.
  Measurement MUST run from service receipt to response and include both accepted and
  rejected keys. These targets MUST NOT permit stale acceptance or weaken revocation.
- **FR-019**: While the service handles an aggregate of 100 validations per second, at least
  95% of successful revocations MUST finish within 1 second and at least 99% within 2
  seconds, measured from service receipt to success response with enforcement already
  effective. These response targets MUST NOT introduce a grace period for revoked keys.
- **FR-020**: The service MUST record security events for received creation and revocation
  attempts, including successes and failures. Events MUST include timestamp, operation,
  outcome, and caller identity, Tenant identifier, and key identifier when known. Unknown
  identities and unconfirmed outcomes MUST be represented explicitly. Raw API Keys and
  Key Hashes MUST NOT be recorded. Recording MUST preserve immediate revocation, irreversible
  state transitions, and the response-time targets; it MUST NOT restore revoked access.

### Failure Behavior and User-Facing Errors

These are required messages for integrating developers; planning may define stable
machine-readable codes and transport mappings without changing their meaning. If the
transport fails before a response arrives, callers cannot receive an error body and MUST
NOT infer success from that absence. E-08 and E-09 govern uncertainty whenever the service
can deliver a response.

| Ref | Failure condition | Required user-facing message | Business outcome |
|-----|-------------------|------------------------------|------------------|
| E-01 | Management caller or validation service caller is unauthenticated or authentication is invalid | Authentication is required. | No key data disclosure or key-state mutation. |
| E-02 | Explicit management Tenant scope is missing | Tenant scope is required. | No key issued, changed, or listed. |
| E-03 | Explicit management Tenant scope is malformed | Tenant scope is invalid. | No key issued, changed, or listed. |
| E-04 | Caller lacks authority for the requested Tenant | You are not authorized to manage API keys for this Tenant. | No key data disclosure or key-state mutation; nonexistent and inaccessible Tenant scopes behave alike. |
| E-05 | Revocation key identifier is missing | Key identifier is required. | No key state changes. |
| E-06 | Presented API Key is missing during validation | API key is required. | Access denied. |
| E-07 | Presented key is malformed, unknown, revoked, a prefix only, or outside the trusted expected Tenant | Invalid or revoked API key. | Access denied; no key or Tenant existence disclosed. |
| E-08 | Creation encounters an operational failure or cannot confirm completion | Unable to confirm API key creation. Check your key list before retrying. | No success claimed; any existing result is discoverable through listing, with no secret recovery. |
| E-09 | Revocation encounters an operational failure or cannot confirm completion | Unable to confirm revocation. Retry revocation; treat this key as potentially active. | No success claimed; completed revocation is never undone; retry is safe. |
| E-10 | Current validation status or trusted Tenant context cannot be established | API key validation is unavailable. Access denied. Try again. | Access denied, never assumed valid. |
| E-11 | Caller attempts to retrieve an issued secret again | API key secrets are only returned at creation and cannot be retrieved. | No secret returned; state unchanged. |
| E-12 | Key identifier is unknown, invalid, or belongs to another Tenant in an otherwise authorized management context | API key not found. | No metadata disclosure or key state changes. |
| E-13 | Caller attempts to re-activate a revoked key | Revoked API keys cannot be re-activated. | Key remains revoked. |
| E-14 | Key listing cannot be completed | Unable to list API keys. Try again. | No successful empty or partial collection claimed. |
| E-15 | Caller requests another unsupported lifecycle operation | This API key operation is not supported. | No state change. |
| E-16 | Authenticated validation caller is not a trusted platform service | You are not authorized to validate API keys. | No key examination, validity result, metadata disclosure, or mutation. |

Management authentication and Tenant authorization MUST be checked before key-specific
state is revealed. Validation caller authentication and trusted-service authorization MUST
be checked before key examination; a presented API Key does not authenticate that caller.
E-11 and E-13 apply only in an authorized Tenant context; foreign or unknown identifiers
receive E-12. A missing or invalid Tenant is handled before key lookup.
A syntactically valid but nonexistent Tenant receives E-04, just like an inaccessible Tenant.

### Key Entities *(include if feature involves data)*

- **API Key**: The raw secret issued to the developer once. Its possession enables validation
  for platform access within its owning Tenant; it is not a management credential.
- **Key Record**: The lifecycle information associated with an API Key: stable identifier,
  Tenant owner, Key Prefix, internal Key Hash, status, creation time, and revocation time.
  Its only lifecycle transition is active to revoked. Tenant ownership is fixed at creation.
- **Key Prefix**: The first 8 characters of the API Key, used for identification. It is
  non-secret metadata, is not guaranteed unique, and cannot authorize access.
- **Key Hash**: The cryptographic digest of the API Key stored internally for validation.
  It is never returned to a caller. Cryptographic algorithm selection is deferred.
- **Tenant**: The organization owning the key. Existing membership determines which
  developers may manage its keys.
- **Developer**: An enterprise integration developer authenticated by the existing identity
  system, authorized to manage keys within verified Tenant memberships.
- **Security Event**: A record of a received creation or revocation attempt, with timestamp,
  operation, outcome, and caller, Tenant, and key identifiers when known. It contains no
  raw API Key or Key Hash. Event browsing is outside this slice.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: In all successful creation acceptance cases, exactly one active key belongs to
  the selected authorized Tenant and its full secret is delivered only in that creation
  response. Subsequent operations expose the full secret and Key Hash zero times.
- **SC-002**: Across all positive and negative Tenant-boundary acceptance cases, 100% of
  unauthorized management attempts, unauthorized validation callers, and foreign-Tenant
  key validations are rejected, with zero foreign-Tenant metadata disclosures or state changes.
- **SC-003**: After each successful revocation, 100% of subsequent validation attempts across
  supported access paths reject that key, with zero grace period. Concurrent validation
  decisions made after revocation takes effect also reject it.
- **SC-004**: In all repeated-revocation and attempted-re-activation acceptance cases, the key
  stays revoked and its original revocation time remains unchanged. Issuing a new key
  never makes the old secret valid again.
- **SC-005**: For every listing acceptance case, developers receive the complete same-Tenant
  set with required non-secret metadata, distinguish shared prefixes by stable identifier,
  and can select a colleague's key for revocation without obtaining its secret.
- **SC-006**: All defined failure cases produce the specified developer-facing message when
  a response is deliverable, and zero uncertain creation or revocation outcomes are
  reported as successful. Unconfirmable validation grants access zero times.
- **SC-007**: An authorized developer can create a key, capture its secret once, list keys,
  and revoke a key using programmatic management operations. Their integration, validated
  through an authenticated trusted platform service, accepts the active key and rejects it
  after revocation. This journey requires no portal, CLI, secret retrieval, or support intervention.
- **SC-008**: At an aggregate offered load of 100 validations per second across Tenants,
  active matching keys continue to validate, invalid and foreign-Tenant keys are rejected,
  and 100% of validation decisions made after revocation takes effect reject that key.
  The secret-disclosure and uncertain-validation denial criteria remain unchanged.
- **SC-009**: At 100 validations per second in aggregate, at least 95% of validation
  responses complete within 100 ms and at least 99% within 250 ms, measured from service
  receipt to response across accepted and rejected keys. SC-002, SC-003, and SC-006 MUST
  still hold; faster responses cannot be achieved by accepting revoked or unconfirmed keys.
- **SC-010**: During an aggregate load of 100 validations per second, at least 95% of
  successful revocations complete within 1 second and at least 99% within 2 seconds from
  service receipt to success response. Every successful response confirms that enforcement
  is effective, and the zero-grace-period requirements remain satisfied under that load.
- **SC-011**: For 100% of received creation and revocation attempts exercised by acceptance
  scenarios, a security event exists with all known required identifiers and an accurate
  outcome, including rejection, failure, and uncertainty. Raw API Keys and Key Hashes appear
  zero times in those events, and SC-003 and SC-010 remain satisfied with recording enabled.

## Assumptions

Confirmed scope and dependencies from the clarification conversation:

- Enterprise developers use a programmatic API only for this slice.
- Authorized developers may revoke any key belonging to the same Tenant, including keys
  created by other developers. Listing covers the same Tenant-wide set.
- Listing includes Key Prefix and status; full secrets never appear again after creation.
- Existing developer authentication and Tenant membership are available dependencies.
- Only trusted platform services may call validation, authenticated through existing service
  identity. Developers and callers presenting only an API Key are not authorized to call it.
- Keys remain active until manually revoked, and validation is included so revocation
  immediately prevents further access.
- The initial validation capacity target is a peak of 100 validations per second in
  aggregate across all Tenants and trusted platform services. At that load, validation
  response targets are 95% within 100 ms and 99% within 250 ms, including accepted and
  rejected keys and measuring from service receipt to response.
- At that validation load, successful revocations complete within 1 second in at least 95%
  of cases and within 2 seconds in at least 99%, measured from service receipt to success
  response with enforcement already effective.
- Security-event recording covers creation and revocation attempts, including successes and
  failures, with timestamp, caller identity, Tenant and key identifiers when known,
  operation, and outcome. Raw API Keys and Key Hashes are excluded.

Additional assumptions chosen for this draft; these are not additional user decisions:

- Existing membership grants creation, listing, and revocation within that Tenant without
  introducing a new per-key ownership restriction or role hierarchy.
- Existing platform access checks provide a trusted expected Tenant context and consume
  this slice's validation result. They cannot bypass this validation capability or use
  key status that permits revoked keys. Missing trusted context causes access denial.
- A stable non-secret identifier and lifecycle timestamps accompany the requested Key Prefix
  and status to support reliable selection and incident response. Prefixes need not be unique.
- Repeated revocation is idempotent, and active and revoked records remain available for
  listing. Record deletion and retention-policy changes are not part of this slice.
- One-time secret delivery means one successful creation response, not a later reveal
  operation. A lost response has no secret-recovery mechanism; a new create attempt may
  issue a distinct key. Request-deduplication guarantees are not included.
- Revocation controls new validation decisions, not cancellation of previously authorized
  work. The boundary is when revocation takes effect, before success is acknowledged.
- Error messages above are proposed specification wording. Transport mappings and
  machine-readable code formats are planning decisions.

### Explicitly Out of Scope

- A developer portal, any graphical key-management interface, and a CLI.
- Building or replacing developer or service authentication, identity provisioning, Tenant membership,
  Tenant provisioning, or a new management-role system.
- Automatic expiration, scheduled revocation, automatic key rotation, or a rotation workflow.
- Re-displaying or recovering issued secrets, re-activating revoked keys, or transferring a
  key to another Tenant.
- Cancellation or rollback of operations authorized before revocation took effect.
- Key renaming, custom labels, per-key permission scopes within a Tenant, usage analytics,
  audit-log browsing, incident notifications, and billing or quota policy.
- Recording security events for listing and validation.
- Key deletion, record-retention changes, and creation request-deduplication guarantees.
- Platform business endpoints beyond the integration needed to consume API Key validation.
- Endpoint routes, transport status mappings, payload schemas, architecture, data-storage
  design, cryptographic algorithms, implementation, and deployment in this specification.
