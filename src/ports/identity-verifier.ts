import type { Principal } from '../domain/identity';
export interface IdentityCall { readonly signal: AbortSignal; readonly remainingMs: number; }
export interface IdentityVerifier {
  readonly mode: 'host' | 'fixture';
  authenticate(credential: string, context: IdentityCall): Promise<{ kind: 'verified'; principal: Principal } | { kind: 'invalid' | 'unavailable' }>;
  validateTenantIdentifier(selector: string): boolean;
  authorizeManagement(principal: Principal, tenant: string, context: IdentityCall): Promise<{ kind: 'authorized'; tenantId: string } | { kind: 'denied' | 'unavailable' }>;
  establishValidationContext(principal: Principal, tenant: string, requestId: string, context: IdentityCall): Promise<{ kind: 'verified'; tenantId: string } | { kind: 'unavailable' }>;
}
