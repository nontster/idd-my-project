import { expect, test } from '@jest/globals';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { openDatabase, type DatabaseHandle } from '../../src/adapters/sqlite/database';
import { SqliteUnitOfWork } from '../../src/adapters/sqlite/unit-of-work';
import { sampleKeyRecord, insertSeed } from '../support/key-record-fixtures';

function withDatabase(action: (store: DatabaseHandle, path: string) => void) {
  const directory = mkdtempSync(join(tmpdir(), 'api-key-sqlite-')); const path = join(directory, 'authority.sqlite');
  const opened = openDatabase({ path, initializeFreshStore: true });
  try {
    expect(opened.ok).toBe(true);
    if (opened.ok) try { action(opened.value, path); } finally { opened.value.close(); }
  } finally { rmSync(directory, { recursive: true, force: true }); }
}

test('fresh explicit initialization uses real SQLite WAL/FULL with zero busy wait and no open snapshot', () => withDatabase(({ connection }) => {
  expect(connection.prepare('PRAGMA journal_mode').get()?.journal_mode).toBe('wal');
  expect(connection.prepare('PRAGMA synchronous').get()?.synchronous).toBe(2);
  expect(connection.prepare('PRAGMA busy_timeout').get()?.timeout).toBe(0);
  expect(connection.prepare('PRAGMA foreign_keys').get()?.foreign_keys).toBe(1);
  expect(connection.isTransaction).toBe(false);
}));

test('hash-only records contain no raw-key column or plaintext in the database/WAL', () => withDatabase(({ connection }, path) => {
  const { record, apiKey } = sampleKeyRecord(); insertSeed(connection, record);
  const names = connection.prepare('PRAGMA table_info(api_keys)').all().map(row => row.name);
  expect(names.some(name => ['apiKey', 'secret', 'token'].includes(String(name)))).toBe(false);
  for (const file of [path, path + '-wal']) if (existsSync(file)) expect(readFileSync(file).includes(Buffer.from(apiKey))).toBe(false);
}));

test('distinct keys may share a prefix without losing stable identity', () => withDatabase(({ connection }) => {
  const a = sampleKeyRecord(); const b = sampleKeyRecord(a.record.prefix); insertSeed(connection, a.record); insertSeed(connection, b.record);
  const rows = connection.prepare('SELECT keyId FROM api_keys WHERE prefix = ?').all(a.record.prefix);
  expect(rows.length).toBe(2);
  expect(a.apiKey === b.apiKey || a.record.keyId === b.record.keyId).toBe(false);
}));

test('Tenant ownership and creation metadata cannot be rewritten through persistence', () => withDatabase(({ connection }) => {
  const { record } = sampleKeyRecord(); insertSeed(connection, record);
  for (const sql of ["UPDATE api_keys SET tenantId='tenant-b' WHERE keyId=?", "UPDATE api_keys SET createdAt='2025-01-01T00:00:00.000Z' WHERE keyId=?"]) {
    let denied = false; try { connection.prepare(sql).run(record.keyId); } catch { denied = true; }
    expect(denied).toBe(true);
  }
}));

test('terminal revocation metadata cannot be changed or its record deleted', () => withDatabase(({ connection }) => {
  const { record } = sampleKeyRecord(); const attempt = randomUUID(); const at = new Date().toISOString();
  insertSeed(connection, { ...record, status: 'revoked', generation: 2, revokedAt: at, revocationAttemptId: attempt });
  for (const sql of ["UPDATE api_keys SET status='active', generation=1, revokedAt=NULL, revocationAttemptId=NULL WHERE keyId=?",
    "UPDATE api_keys SET revokedAt='2025-01-01T00:00:00.000Z' WHERE keyId=?", 'DELETE FROM api_keys WHERE keyId=?']) {
    let denied = false; try { connection.prepare(sql).run(record.keyId); } catch { denied = true; }
    expect(denied).toBe(true);
  }
  expect(connection.prepare('SELECT status, generation, revokedAt FROM api_keys WHERE keyId=?').get(record.keyId)?.status).toBe('revoked');
}));

test('invalid lifecycle status/time combinations are refused by real SQLite constraints', () => withDatabase(({ connection }) => {
  const { record } = sampleKeyRecord(); let denied = false;
  try { insertSeed(connection, { ...record, status: 'active', revokedAt: new Date().toISOString() }); } catch { denied = true; }
  expect(denied).toBe(true);
}));

test('received attempt outcomes survive closing and reopening the authority', () => withDatabase((store, path) => {
  const { record } = sampleKeyRecord(); insertSeed(store.connection, record); store.close();
  const reopened = openDatabase({ path }); expect(reopened.ok).toBe(true);
  if (reopened.ok) try {
    const row = reopened.value.connection.prepare('SELECT operation, outcome, finalized FROM security_attempts WHERE attemptId=?').get(record.creationAttemptId);
    expect(row?.operation).toBe('create'); expect(row?.outcome).toBe('succeeded'); expect(row?.finalized).toBe(1);
  } finally { reopened.value.close(); }
}));

test('unit of work commits atomically and rolls back a failed mutation without leaving a snapshot', () => withDatabase(({ connection }) => {
  const work = new SqliteUnitOfWork(connection); const a = sampleKeyRecord();
  expect(work.run(() => { insertSeed(connection, a.record); return true; }).kind).toBe('committed');
  const b = sampleKeyRecord(); const failed = work.run(() => { insertSeed(connection, b.record); throw new Error('injected operation failure'); });
  expect(failed.kind).toBe('not-committed');
  expect(connection.prepare('SELECT count(*) AS count FROM api_keys').get()?.count).toBe(1);
  expect(connection.isTransaction).toBe(false);
}));

test('uncertain commit acknowledgment never reports not-committed or retries a mutation', () => withDatabase(({ connection }) => {
  const { record } = sampleKeyRecord(); let attempts = 0;
  const result = new SqliteUnitOfWork(connection).run(() => {
    attempts++; insertSeed(connection, record); connection.exec('COMMIT'); throw new Error('injected lost acknowledgment');
  });
  expect(result.kind).toBe('uncertain'); expect(attempts).toBe(1);
  expect(connection.prepare('SELECT count(*) AS count FROM api_keys').get()?.count).toBe(1);
}));

test('missing previously authoritative storage is not silently recreated', () => {
  const directory = mkdtempSync(join(tmpdir(), 'api-key-missing-')); const path = join(directory, 'authority.sqlite');
  try { expect(openDatabase({ path }).ok).toBe(false); expect(existsSync(path)).toBe(false); }
  finally { rmSync(directory, { recursive: true, force: true }); }
});

test('corrupt storage and memory-only storage cannot masquerade as a durable authority', () => {
  const directory = mkdtempSync(join(tmpdir(), 'api-key-corrupt-')); const path = join(directory, 'authority.sqlite');
  writeFileSync(path, 'not a database');
  try { expect(openDatabase({ path }).ok).toBe(false); expect(openDatabase({ path: ':memory:', initializeFreshStore: true }).ok).toBe(false); }
  finally { rmSync(directory, { recursive: true, force: true }); }
});

test('lock contention fails without a hidden busy retry loop', () => withDatabase(({ connection }, path) => {
  const other = new DatabaseSync(path);
  try {
    other.exec('BEGIN IMMEDIATE'); let attempted = 0;
    const result = new SqliteUnitOfWork(connection).run(() => { attempted++; return true; });
    expect(result.kind).toBe('not-committed'); expect(attempted).toBe(0);
  } finally { other.exec('ROLLBACK'); other.close(); }
}));

test('fresh authority has the planned non-unique Tenant/creation-time/identifier index',()=>withDatabase(({connection})=>{
  const columns=connection.prepare('PRAGMA index_info(keys_tenant_created_at)').all().map(row=>row.name);
  expect(columns).toEqual(['tenantId','createdAt','keyId']);
  const index=connection.prepare('PRAGMA index_list(api_keys)').all().find(row=>row.name==='keys_tenant_created_at');
  expect(index?.unique).toBe(0);expect(index?.partial).toBe(0);
}));
