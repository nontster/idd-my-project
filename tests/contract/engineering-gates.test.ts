import { expect, test } from '@jest/globals';
import { existsSync, mkdirSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { spawnSync } from 'node:child_process';
import { coverageFixture, projectRoot } from '../support/coverage-inventory-fixtures';

test('Jest fails when real authentication or unexecuted revocation branches remain uncovered', () => {
  const fixture = coverageFixture(false);
  try {
    const result = fixture.runJest();
    // Bug caught: collecting coverage without enforcing the security branch threshold.
    expect(result.status).toBe(1);
    expect(Object.keys(fixture.readCoverage()).some(path => path.endsWith('/revocation.js'))).toBe(true);
  } finally { fixture.clean(); }
}, 30000);

test('the inventory accepts complete real coverage before testing denial cases', () => {
  const fixture = coverageFixture(true);
  try {
    expect(fixture.runJest().status).toBe(0);
    expect(fixture.runGate().status).toBe(0);
  } finally { fixture.clean(); }
}, 30000);

test.each(['omitted-report', 'unexecuted-branch', 'missing-emitted', 'empty-inventory', 'pending-security-test'] as const)(
  'the gate rejects %s after a valid coverage baseline', mode => {
    const fixture = coverageFixture(true);
    try {
      expect(fixture.runJest().status).toBe(0);
      expect(fixture.runGate().status).toBe(0); // Always-denying gates cannot satisfy these cases.
      const report = fixture.readCoverage();
      const key = Object.keys(report).find(path => path.endsWith('/authentication.js'))!;
      if (mode === 'omitted-report') delete report[key];
      if (mode === 'unexecuted-branch') {
        const file = report[key] as { b: Record<string, number[]> };
        for (const branch of Object.keys(file.b)) file.b[branch] = file.b[branch].map(() => 0);
      }
      if (mode === 'missing-emitted') rmSync(join(fixture.root, 'build/src/services/revocation.js'));
      if (mode === 'empty-inventory') rmSync(join(fixture.root, 'src'), { recursive: true });
      if (mode === 'pending-security-test') {
        const path = join(fixture.root, 'coverage/test-results.json');
        const results = JSON.parse(readFileSync(path, 'utf8')); results.numPendingTests = 1;
        writeFileSync(path, JSON.stringify(results));
      }
      writeFileSync(join(fixture.root, 'coverage/coverage-final.json'), JSON.stringify(report));
      expect(fixture.runGate().status).toBe(1);
    } finally { fixture.clean(); }
  }, 30000);

test('build removes stale emitted code and does not emit source maps', () => {
  const fixture = coverageFixture(true);
  try {
    mkdirSync(join(fixture.root, 'build/src/removed'), { recursive: true });
    const stale = join(fixture.root, 'build/src/removed/old.js'); writeFileSync(stale, 'stale');
    const npm = join(dirname(process.execPath), '../lib/node_modules/npm/bin/npm-cli.js');
    const result = spawnSync(process.execPath, [npm, 'run', 'build', '--silent'], {
      cwd: fixture.root, encoding: 'utf8', env: { ...process.env, PATH: dirname(process.execPath) + ':' + process.env.PATH },
    });
    expect(result.status).toBe(0);
    expect(existsSync(stale)).toBe(false);
    expect(existsSync(join(fixture.root, 'build/src/services/authentication.js.map'))).toBe(false);
  } finally { fixture.clean(); }
}, 30000);

test('the actual selected runtime and SQLite capabilities pass the runtime gate', () => {
  const result = spawnSync(process.execPath, [join(projectRoot, 'scripts/check-runtime.cjs')], { encoding: 'utf8' });
  expect(result.status).toBe(0);
}, 30000);
