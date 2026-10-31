import type { IdentityVerifier } from '../../ports/identity-verifier';
import { isObject } from '../../domain/values';
export function hostIdentity(value: unknown, development = false): IdentityVerifier {
  if (!isObject(value) || !(value.mode === 'host' || development && value.mode === 'fixture')
    || !['authenticate','validateTenantIdentifier','authorizeManagement','establishValidationContext'].every(name => typeof value[name] === 'function')) {
    throw Object.assign(new Error('Host identity integration is required.'), { code: 'IDENTITY_REQUIRED' });
  }
  return value as unknown as IdentityVerifier;
}
