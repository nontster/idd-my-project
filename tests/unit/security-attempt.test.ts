import { expect, test } from '@jest/globals';
import { randomUUID, randomBytes } from 'node:crypto';
import { securityAttempt } from '../../src/domain/security-attempt';

function attempt(change: Record<string, unknown> = {}) {
  return { attemptId: randomUUID(), operation: 'create', receivedAt: new Date().toISOString(),
    callerId: null, tenantId: null, keyId: null, outcome: 'unconfirmed', finalized: false,
    errorCode: null, completedAt: null, ...change };
}

test('received attempts preserve explicitly unknown identities without inventing a successful outcome', () => {
  const result = securityAttempt(attempt()); expect(result.ok).toBe(true);
  if (result.ok) expect(result.value.callerId === null && result.value.tenantId === null && result.value.keyId === null && !result.value.finalized).toBe(true);
});

test.each(['succeeded', 'rejected', 'failed'])('known terminal %s has a completion timestamp and safe identities', outcome => {
  const result = securityAttempt(attempt({ operation: 'revoke', callerId: 'verified-developer', tenantId: 'tenant-a',
    keyId: randomUUID(), outcome, finalized: true, completedAt: new Date().toISOString(),
    errorCode: outcome === 'succeeded' ? null : 'E-09' }));
  expect(result.ok).toBe(true);
});

test('an unconfirmed mutation remains pending with its known scoped identifiers', () => {
  const result = securityAttempt(attempt({ operation: 'revoke', callerId: 'verified-developer', tenantId: 'tenant-a',
    keyId: randomUUID(), errorCode: 'E-09' }));
  expect(result.ok).toBe(true);
});

test('accepted event values cannot be mutated into a fabricated outcome', () => {
  const result = securityAttempt(attempt()); expect(result.ok).toBe(true);
  if (!result.ok) return;
  try { Object.assign(result.value, { outcome: 'succeeded' }); } catch {}
  expect(result.value.outcome).toBe('unconfirmed');
});

test.each([null, undefined, [], 'event', 1])('non-event values cannot become audit evidence', input => {
  const result = securityAttempt(input); expect(result.ok ? 'SUCCESS' : result.code).toBe('UNAVAILABLE');
});

test.each([
  ['attempt ID', { attemptId: 'invalid' }], ['operation', { operation: 'list' }],
  ['received time', { receivedAt: 'invalid' }], ['non-string received time', { receivedAt: null }],
  ['unknown caller', { callerId: undefined }], ['caller type', { callerId: 3 }], ['empty caller', { callerId: '' }],
  ['empty Tenant', { tenantId: '' }], ['Tenant bound', { tenantId: 'a'.repeat(257) }],
  ['key ID', { keyId: 'invalid' }], ['non-string key ID', { keyId: 7 }],
  ['outcome', { outcome: 'invented' }], ['finalization flag', { finalized: 1 }],
  ['unknown error', { errorCode: 'arbitrary exception details' }], ['internal error', { errorCode: 'UNAVAILABLE' }],
  ['non-string error', { errorCode: 5 }], ['unknown error field', { errorCode: undefined }],
  ['unknown completion', { completedAt: undefined }], ['bad completion', { completedAt: 'invalid' }],
  ['premature success', { outcome: 'succeeded', finalized: false }],
  ['missing completion', { finalized: true, outcome: 'failed' }],
  ['completed pending event', { completedAt: new Date().toISOString() }],
  ['falsely finalized uncertainty', { finalized: true, completedAt: new Date().toISOString() }],
] as const)('%s is not silently converted into trusted audit data', (_label, change) => {
  const result = securityAttempt(attempt(change)); expect(result.ok ? 'SUCCESS' : result.code).toBe('UNAVAILABLE');
});

test.each(['apiKey', 'keyHash', 'credential', 'stack'])('sensitive %s fields are rejected rather than retained', field => {
  const result = securityAttempt(attempt({ [field]: randomBytes(32).toString('base64url') }));
  expect(result.ok ? 'SUCCESS' : result.code).toBe('UNAVAILABLE');
});

test.each(['REQUEST_INVALID', 'REQUEST_TOO_LARGE', 'UNSUPPORTED_MEDIA_TYPE', 'NOT_FOUND', 'METHOD_NOT_ALLOWED', 'OPERATION_UNAVAILABLE'])('safe transport code %s can describe an actual failed attempt', errorCode => {
  const result = securityAttempt(attempt({ outcome: 'failed', finalized: true, completedAt: new Date().toISOString(), errorCode }));
  expect(result.ok).toBe(true);
});

test('unexpected event access failure produces no retained arbitrary exception data', () => {
  const input = attempt(); Object.defineProperty(input, 'callerId', { get() { throw new Error('record unavailable'); } });
  const result = securityAttempt(input); expect(result.ok ? 'SUCCESS' : result.code).toBe('UNAVAILABLE');
});
