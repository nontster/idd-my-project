import { expect, test } from '@jest/globals';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { openDatabase } from '../../src/adapters/sqlite/database';
import { SqliteSecurityEvents } from '../../src/adapters/sqlite/security-events';
import type { SecurityAttempt } from '../../src/domain/security-attempt';
test('real attempt repository durably begins unknown outcomes and finalizes safe truth once', () => {
  const directory = mkdtempSync(join(tmpdir(), 'key-events-'));
  const db = openDatabase({ path: join(directory, 'authority.sqlite'), initializeFreshStore: true }); expect(db.ok).toBe(true);
  if (!db.ok) return;
  try {
    const events = new SqliteSecurityEvents(db.value.connection);
    const receivedAt = new Date().toISOString();
    const attempt: SecurityAttempt = { attemptId: randomUUID(), operation: 'create', receivedAt,
      callerId: null, tenantId: null, keyId: null, outcome: 'unconfirmed', finalized: false, errorCode: null, completedAt: null };
    expect(events.begin(attempt).ok).toBe(true);
    const pending = events.unfinished(); expect(pending.ok && pending.value.length === 1).toBe(true);
    expect(events.finalize({ ...attempt, outcome: 'rejected', finalized: true, completedAt: receivedAt, errorCode: 'E-01' }).ok).toBe(true);
    const done = events.unfinished(); expect(done.ok && done.value.length === 0).toBe(true);
    expect(events.finalize({ ...attempt, outcome: 'succeeded', finalized: true, completedAt: receivedAt }).ok).toBe(false);
    expect(events.begin({ ...attempt, attemptId: randomUUID(), errorCode: 'arbitrary diagnostic' }).ok).toBe(false);
    db.value.close(); expect(events.unfinished().ok).toBe(false);
  } finally { db.value.close(); rmSync(directory, { recursive: true, force: true }); }
});
