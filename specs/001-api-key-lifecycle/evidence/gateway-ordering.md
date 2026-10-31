# Gateway ordering and lifecycle evidence — T051

GW-01–GW-09: actual authority and two independent HTTP gateways accept active keys, both metadata caches warm, then retained hints cannot authorize after R. Partition before/after R denies; reconnect reads revoked. A decision paused before its final gate rejects after real R; a real pre-R decision delayed in transit is consumable only once by its original pending operation. Actual lost-acknowledgment/SIGKILL restart paths retain revocation. Corrupt state and unavailable dependencies deny.

GW-07/GW-11:14 combined gateway/revoke/disconnect acceptance tests plus3 ordering integration tests pass.199/200ms authority,499/500ms gateway,99/100ms earlier platform deadlines and shared100ms identity are exercised with independent monotonic controls. Received management attempts are not replayed. Pre-entry socket loss cancels a queued waiter and records failedE-09 with active state; socket loss after actual R preserves terminal state/audit and both gateways deny. Post-R expiry returnsE-09, explicit repeat keeps original metadata. No physical eviction is needed for enforcement.

Focused follow-up RED2/2 revealed create/validate could await a delayed gate after cancellation. Framework-free withinContext now bounds both waits; GREEN2/2 and16 focused regressions pass. Late released callbacks cannot mutate/authorize. This is a stop-wait observation, not invented timing/performance evidence.

Complete security/coverage run after this work:42 suites/332 tests all behaviorally pass. The deliberately strict all-source branch gate remains closed pending additional infrastructure failure assertions. T052 remains unchecked until its required coverage gate passes; final completion is not claimed.
