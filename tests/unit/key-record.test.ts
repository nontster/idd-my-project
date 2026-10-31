import { expect, test } from '@jest/globals';
import { randomUUID } from 'node:crypto';
import { keyRecord } from '../../src/domain/key-record';
import { sampleKeyRecord } from '../support/key-record-fixtures';

test('a valid active record has verified immutable metadata and isolated verification buffers', () => {
  const { record } = sampleKeyRecord(); const result = keyRecord(record);
  expect(result.ok).toBe(true);
  if (!result.ok) return;
  const original = Buffer.from(result.value.salt); record.salt[0] ^= 1;
  expect(result.value.salt.equals(original)).toBe(true);
  try { Object.assign(result.value, { tenantId: 'tenant-b' }); } catch {}
  expect(result.value.tenantId).toBe('tenant-a');
});

test('a valid terminal record preserves its first revocation metadata', () => {
  const { record } = sampleKeyRecord(); const revokedAt = new Date().toISOString();
  const result = keyRecord({ ...record, status: 'revoked', generation: 2, revokedAt, revocationAttemptId: randomUUID() });
  expect(result.ok).toBe(true);
  if (result.ok) expect(result.value.revokedAt === revokedAt && result.value.generation === 2).toBe(true);
});

test.each([
  ['identifier', { keyId: 'bad' }], ['Tenant', { tenantId: '' }], ['prefix', { prefix: 'short' }],
  ['salt', { salt: Buffer.alloc(15) }], ['digest', { keyHash: Buffer.alloc(31) }],
  ['status', { status: 'expired' }], ['generation', { generation: 0 }],
  ['active timestamp', { revokedAt: new Date().toISOString() }],
  ['active attempt', { revocationAttemptId: randomUUID() }], ['creation time', { createdAt: 'invalid' }],
  ['creation attempt', { creationAttemptId: '' }], ['terminal metadata', { status: 'revoked', generation: 2 }],
  ['unknown field', { unexpected: true }],
] as const)('%s cannot become an authoritative record', (_label, change) => {
  const { record } = sampleKeyRecord(); const result = keyRecord({ ...record, ...change });
  expect(result.ok ? 'SUCCESS' : result.code).toBe('UNAVAILABLE');
});

test('record construction never accepts recoverable raw-secret fields', () => {
  const { record, apiKey } = sampleKeyRecord(); const result = keyRecord({ ...record, apiKey });
  expect(result.ok ? 'SUCCESS' : result.code).toBe('UNAVAILABLE');
});

test.each([null, undefined, [], 1, 'record'])('non-record inputs cannot be authoritative data', input => {
  const result = keyRecord(input);
  expect(result.ok ? 'SUCCESS' : result.code).toBe('UNAVAILABLE');
});

test('unexpected record access failures become safe unavailability', () => {
  const { record } = sampleKeyRecord();
  Object.defineProperty(record, 'tenantId', { get() { throw new Error('unavailable record field'); } });
  const result = keyRecord(record);
  expect(result.ok ? 'SUCCESS' : result.code).toBe('UNAVAILABLE');
});

test.each([
  ['oversized Tenant', { tenantId: 'a'.repeat(257) }], ['non-string Tenant', { tenantId: 1 }],
  ['noncanonical time', { createdAt: '2026-01-01' }], ['non-string time', { createdAt: null }],
  ['non-byte salt', { salt: 'invalid' }], ['non-byte digest', { keyHash: null }],
  ['revoked generation', { status: 'revoked', generation: 1, revokedAt: new Date().toISOString(), revocationAttemptId: randomUUID() }],
  ['revoked timestamp', { status: 'revoked', generation: 2, revokedAt: 'invalid', revocationAttemptId: randomUUID() }],
  ['revoked attempt', { status: 'revoked', generation: 2, revokedAt: new Date().toISOString(), revocationAttemptId: 'invalid' }],
  ['missing field', { prefix: undefined }],
] as const)('%s cannot weaken persisted authority', (_name, change) => {
  const result = keyRecord({ ...sampleKeyRecord().record, ...change });
  expect(result.ok ? 'SUCCESS' : result.code).toBe('UNAVAILABLE');
});
