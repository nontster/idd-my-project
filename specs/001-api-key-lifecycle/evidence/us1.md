# US1 gate — T029

Full regression: 271 passed, 1 failed, 0 pending. The only behavioral failure is the intentionally unfinished gateway501 after successful creation. All US1 suites pass, including real HTTP expiry after commit and actual lost-acknowledgment persistence.

Current branch reports:
- node-key-crypto.js: 37/37 (100%).
- creation-repository.js: 12/12 (100%).
- scoped-key-lookup.js: 10/10 (100%).
- authentication.js: 70/70 (100%).
- creation.js: 38/38 (100%).
- management-attempt.js: 67/69 (97.1%).
- secret-retrieval.js: 15/15 (100%).

The global coverage command remains nonzero: the deliberately stricter all-production inventory still includes cross-story coordinator paths, pending revocation and other infrastructure edge cases. No source was excluded and no threshold reduced. This is an independent US1 behavior/current-core-coverage gate, not the final all-story coverage or deployment gate. Remaining aggregate coverage work is retained for T052/T064.
