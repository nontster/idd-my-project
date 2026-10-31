import type { Outcome } from './outcome';
import { isObject, isUuid, isTimestamp, isTenantId } from './values';

export interface KeyRecord {
  readonly keyId: string;
  readonly tenantId: string;
  readonly prefix: string;
  readonly salt: Buffer;
  readonly keyHash: Buffer;
  readonly status: 'active' | 'revoked';
  readonly generation: number;
  readonly createdAt: string;
  readonly revokedAt: string | null;
  readonly creationAttemptId: string;
  readonly revocationAttemptId: string | null;
}

const fields = ['keyId', 'tenantId', 'prefix', 'salt', 'keyHash', 'status', 'generation',
  'createdAt', 'revokedAt', 'creationAttemptId', 'revocationAttemptId'] as const;

export function keyRecord(input: unknown): Outcome<KeyRecord> {
  try {
    if (!isObject(input)) return { ok: false, code: 'UNAVAILABLE' };
    const keys = Object.keys(input);
    if (keys.length !== fields.length || keys.some(key => !fields.includes(key as typeof fields[number]))) return { ok: false, code: 'UNAVAILABLE' };
    const value = Object.fromEntries(fields.map(field => [field, input[field]]));
    if (!isUuid(value.keyId) || !isTenantId(value.tenantId) || typeof value.prefix !== 'string' || !/^[A-Za-z0-9_-]{8}$/.test(value.prefix)
      || !(value.salt instanceof Uint8Array) || value.salt.byteLength !== 16
      || !(value.keyHash instanceof Uint8Array) || value.keyHash.byteLength !== 32
      || !isTimestamp(value.createdAt) || !isUuid(value.creationAttemptId)) return { ok: false, code: 'UNAVAILABLE' };
    const active = value.status === 'active' && value.generation === 1 && value.revokedAt === null && value.revocationAttemptId === null;
    const revoked = value.status === 'revoked' && value.generation === 2 && isTimestamp(value.revokedAt) && isUuid(value.revocationAttemptId);
    if (!active && !revoked) return { ok: false, code: 'UNAVAILABLE' };
    const record = { ...value, salt: Buffer.from(value.salt), keyHash: Buffer.from(value.keyHash) } as unknown as KeyRecord;
    return { ok: true, value: Object.freeze(record) };
  } catch { return { ok: false, code: 'UNAVAILABLE' }; }
}
