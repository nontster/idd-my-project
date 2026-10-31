export interface Principal {
  readonly kind: 'developer' | 'service' | 'other';
  readonly subjectId: string;
  readonly trustedService: boolean;
}

export interface VerifiedContext {
  readonly principal: Principal;
  readonly tenantId: string;
}
