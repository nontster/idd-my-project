import type { Outcome } from './outcome';
import { isObject, isTimestamp, isUuid, isTenantId } from './values';
import { isErrorCode } from './error-codes';

export interface SecurityAttempt {
  readonly attemptId: string;
  readonly operation: 'create' | 'revoke';
  readonly receivedAt: string;
  readonly callerId: string | null;
  readonly tenantId: string | null;
  readonly keyId: string | null;
  readonly outcome: 'succeeded' | 'rejected' | 'failed' | 'unconfirmed';
  readonly finalized: boolean;
  readonly errorCode: string | null;
  readonly completedAt: string | null;
}

const fields = ['attemptId', 'operation', 'receivedAt', 'callerId', 'tenantId', 'keyId',
  'outcome', 'finalized', 'errorCode', 'completedAt'] as const;
const operations: ReadonlySet<unknown> = new Set(['create', 'revoke']);
const outcomes: ReadonlySet<unknown> = new Set(['succeeded', 'rejected', 'failed', 'unconfirmed']);
const nullable = (value: unknown, valid: (value: unknown) => boolean) => value === null || valid(value);

export function securityAttempt(input: unknown): Outcome<SecurityAttempt> {
  try {
    if (!isObject(input)) return { ok: false, code: 'UNAVAILABLE' };
    const keys = Object.keys(input);
    if (keys.length !== fields.length || keys.some(key => !fields.includes(key as typeof fields[number]))) return { ok: false, code: 'UNAVAILABLE' };
    const value = Object.fromEntries(fields.map(field => [field, input[field]]));
    if (!isUuid(value.attemptId) || !operations.has(value.operation) || !isTimestamp(value.receivedAt)
      || !nullable(value.callerId, id => typeof id === 'string' && id.length > 0)
      || !nullable(value.tenantId, isTenantId) || !nullable(value.keyId, isUuid)
      || !outcomes.has(value.outcome) || typeof value.finalized !== 'boolean'
      || !nullable(value.errorCode, isErrorCode) || !nullable(value.completedAt, isTimestamp)) return { ok: false, code: 'UNAVAILABLE' };
    const pending = !value.finalized && value.outcome === 'unconfirmed' && value.completedAt === null;
    const terminal = value.finalized && value.outcome !== 'unconfirmed' && isTimestamp(value.completedAt);
    if (!pending && !terminal) return { ok: false, code: 'UNAVAILABLE' };
    return { ok: true, value: Object.freeze(value) as unknown as SecurityAttempt };
  } catch { return { ok: false, code: 'UNAVAILABLE' }; }
}
