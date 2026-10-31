import type { Outcome } from '../domain/outcome';
import type { Principal, VerifiedContext } from '../domain/identity';
import { withinContext, type RequestContext } from '../domain/request-context';
import { isObject, isTenantId, isUuid } from '../domain/values';
import type { IdentityVerifier } from '../ports/identity-verifier';
const unavailable = { ok: false, code: 'UNAVAILABLE' } as const;
function principal(value: unknown): value is Principal {
  return isObject(value) && ['developer','service','other'].includes(value.kind as string)
    && typeof value.subjectId === 'string' && value.subjectId.length > 0 && typeof value.trustedService === 'boolean';
}
export class AuthenticationService {
  constructor(private readonly verifier: unknown) {}
  private provider(): IdentityVerifier {
    if (!isObject(this.verifier)) throw new Error('identity unavailable');
    return this.verifier as unknown as IdentityVerifier;
  }
  async caller(credential: unknown, purpose: 'management' | 'validation', context: RequestContext): Promise<Outcome<Principal>> {
    if (typeof credential !== 'string' || credential.length === 0) return { ok: false, code: 'E-01' };
    const result = await withinContext(context, (signal, remainingMs) => this.provider().authenticate(credential, { signal, remainingMs }), true);
    if (!result.ok || !isObject(result.value)) return unavailable;
    if (result.value.kind === 'invalid') return { ok: false, code: 'E-01' };
    if (result.value.kind !== 'verified' || !principal(result.value.principal)) return unavailable;
    const p = result.value.principal;
    if (purpose === 'validation' && (p.kind !== 'service' || !p.trustedService)) return { ok: false, code: 'E-16' };
    return { ok: true, value: Object.freeze({ kind: p.kind, subjectId: p.subjectId, trustedService: p.trustedService }) };
  }
  async management(p: Principal, selector: unknown, context: RequestContext): Promise<Outcome<VerifiedContext>> {
    if (selector === undefined || selector === null || selector === '') return { ok: false, code: 'E-02' };
    if (!isTenantId(selector)) return { ok: false, code: 'E-03' };
    const format = await withinContext(context, () => this.provider().validateTenantIdentifier(selector), true);
    if (!format.ok || typeof format.value !== 'boolean') return unavailable;
    if (!format.value) return { ok: false, code: 'E-03' };
    if (p.kind !== 'developer') return { ok: false, code: 'E-04' };
    const result = await withinContext(context, (signal, remainingMs) => this.provider().authorizeManagement(p, selector, { signal, remainingMs }), true);
    if (!result.ok || !isObject(result.value)) return unavailable;
    if (result.value.kind === 'denied') return { ok: false, code: 'E-04' };
    if (result.value.kind !== 'authorized' || result.value.tenantId !== selector) return unavailable;
    return { ok: true, value: Object.freeze({ principal: p, tenantId: selector }) };
  }
  async validation(p: Principal, selector: unknown, requestId: string, context: RequestContext): Promise<Outcome<VerifiedContext>> {
    if (p.kind !== 'service' || !p.trustedService) return { ok: false, code: 'E-16' };
    if (!isTenantId(selector) || !isUuid(requestId)) return unavailable;
    const result = await withinContext(context, (signal, remainingMs) => this.provider().establishValidationContext(p, selector, requestId, { signal, remainingMs }), true);
    if (!result.ok || !isObject(result.value) || result.value.kind !== 'verified' || result.value.tenantId !== selector) return unavailable;
    return { ok: true, value: Object.freeze({ principal: p, tenantId: selector }) };
  }
}
