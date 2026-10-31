# US2 gate — T039

Full regression: 302 passed,1 expected pending revocation501 failure; no skips/todos/import errors.

Direct seeded-record validation and both real warmed gateway caches pass. Independent issuance is not required. Core branch reports:
- validation-repository.js: 14/14 = 100%.
- validation-decision.js: 20/20 = 100%.
- enforcement.js: 47/47 = 100%.
- authentication.js: 72/72 = 100%.
- validation.js: 40/40 = 100%.

Validation acceptance5, gateway acceptance9, validation contracts2, repository2 and service6 all pass. Gateway negatives include malformed/mismatched actual responses, replay, real partitions, revoked keys, unavailable identity,499/500ms and earlier99/100ms platform deadlines, stop-wait timeout/cancellation and ignored late positives with one outbound attempt. No cache hint has authority.

The aggregate all-source final gate remains nonzero for pending revocation and infrastructure edge branches; no exclusions or threshold changes. T052/T064 retain final obligations.
