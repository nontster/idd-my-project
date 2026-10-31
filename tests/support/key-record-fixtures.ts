import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import type { KeyRecord } from '../../src/domain/key-record';

export function sampleKeyRecord(prefix = randomBytes(6).toString('base64url')) {
  const apiKey = prefix + '.' + randomBytes(32).toString('base64url');
  const salt = randomBytes(16);
  const record: KeyRecord = { keyId: randomUUID(), tenantId: 'tenant-a', prefix, salt,
    keyHash: createHash('sha256').update(salt).update(apiKey, 'utf8').digest(), status: 'active',
    generation: 1, createdAt: new Date().toISOString(), revokedAt: null,
    creationAttemptId: randomUUID(), revocationAttemptId: null };
  return { record, apiKey };
}

export function insertSeed(connection: DatabaseSync, record: KeyRecord) {
  const attempt = connection.prepare('INSERT INTO security_attempts (attemptId, operation, receivedAt, callerId, tenantId, keyId, outcome, finalized, errorCode, completedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
  attempt.run(record.creationAttemptId, 'create', record.createdAt, 'seed-developer', record.tenantId,
    record.keyId, 'succeeded', 1, null, record.createdAt);
  if (record.revocationAttemptId) attempt.run(record.revocationAttemptId, 'revoke', record.revokedAt!,
    'seed-developer', record.tenantId, record.keyId, 'succeeded', 1, null, record.revokedAt);
  connection.prepare('INSERT INTO api_keys (keyId, tenantId, prefix, salt, keyHash, status, generation, createdAt, revokedAt, creationAttemptId, revocationAttemptId) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run(record.keyId, record.tenantId, record.prefix, record.salt, record.keyHash, record.status,
      record.generation, record.createdAt, record.revokedAt, record.creationAttemptId, record.revocationAttemptId);
}
