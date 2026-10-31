import { expect, test } from '@jest/globals';
import { readFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import * as path from 'node:path';
import { runInNewContext } from 'node:vm';

const root = resolve(__dirname, '../../..');

function runWith(version: string, localAvailable: boolean, gateStatus = 0) {
  const pin = readFileSync(join(root, '.nvmrc'), 'utf8').trim();
  const local = join(root, '.runtime', `node-v${pin}-darwin-arm64/bin/node`);
  const active = '/active/bin/node';
  const calls: { binary: string; args: string[] }[] = [];
  const stopped = Symbol('exit');
  const simulated = {
    versions: { node: version }, execPath: active, platform: 'darwin', arch: 'arm64',
    env: { PATH: '/active/bin' }, argv: ['node', 'run.cjs', 'build'], exitCode: undefined as number | undefined,
    stderr: { write: (_value: string) => {} },
    exit: (status: number) => { simulated.exitCode = status; throw stopped; },
  };
  const dependencies: Record<string, unknown> = {
    'node:path': path,
    'node:fs': { readFileSync: () => pin, existsSync: (file: string) => file === active || file === local && localAvailable,
      rmSync: () => {} },
    'node:child_process': { spawnSync: (binary: string, args: string[]) => {
      calls.push({ binary, args }); return { status: args[0].endsWith('check-runtime.cjs') ? gateStatus : 0 };
    } },
    './check-runtime.cjs': require(join(root, 'scripts/check-runtime.cjs')),
  };
  try {
    runInNewContext(readFileSync(join(root, 'scripts/run.cjs'), 'utf8'), {
      __dirname: join(root, 'scripts'), process: simulated,
      require: (name: string) => { if (!(name in dependencies)) throw new Error('Unexpected runner dependency'); return dependencies[name]; },
    });
  } catch (error) { if (error !== stopped) throw error; }
  return { status: simulated.exitCode, calls, active, local };
}

test.each(['24.0.0', '24.14.0'])('Node %s cannot bypass the minimum by sharing major version 24', version => {
  const result = runWith(version, true);
  expect(result.status).toBe(0);
  expect(result.calls.length > 0 && result.calls.every(call => call.binary === result.local)).toBe(true);
});

test('unsupported active runtime without a local replacement refuses execution', () => {
  const result = runWith('24.14.0', false);
  expect(result.status).toBe(1);
  expect(result.calls.length).toBe(0);
});

test('supported active runtime remains usable without a local installation', () => {
  const result = runWith('24.15.0', false);
  expect(result.status).toBe(0);
  expect(result.calls.every(call => call.binary === result.active)).toBe(true);
});

test('a selected executable must pass actual runtime and SQLite capability checks before compilation', () => {
  const result = runWith('24.15.0', false, 1);
  expect(result.status).toBe(1);
  expect(result.calls.length).toBe(1);
  expect(result.calls[0].args[0].endsWith('check-runtime.cjs')).toBe(true);
});
