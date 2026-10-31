# Runtime Selection Review Fix

Finding: scripts/run.cjs accepted any active Node24, bypassing the >=24.15.0 minimum.

RED command:

```sh
npm run test:contract -- --runInBand --runTestsByPath build/tests/contract/runtime-selection.test.js
```

Observed: 5 tests executed, 4 failed and 1 passed. Unsupported active 24.0/24.14 was selected
instead of the pinned executable; absence of a supported replacement did not refuse execution;
and a selected executable's failed capability gate did not prevent compilation.

Fix: share the minimum-version predicate with check-runtime.cjs, select the active executable
only when supported, otherwise use the pinned local runtime, and execute the actual Node/SQLite
capability check before dispatching any runner command.

GREEN command:

```sh
npm run test:contract -- --runInBand --runTestsByPath build/tests/contract/runtime-selection.test.js build/tests/contract/engineering-gates.test.js
```

Observed: 14/14 passed, exit 0. Runner selection tests execute its real source in a VM with
controlled process/filesystem/spawn boundaries; they create no files or real subprocesses.
The engineering fixtures separately exercise the real selected executable, TypeScript, Jest,
and SQLite capability check. No unsupported version is assumed to have run native SQLite.

Whole-project verification after the fix: 132 tests, 48 passed and 84 declared pending-feature
failures, no loader errors. Engineering 14/14 and key-record 32/32 remain green. The product
coverage gate remains incomplete while revocation is unimplemented; no whole-product pass.
