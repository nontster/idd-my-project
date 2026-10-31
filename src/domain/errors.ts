const messages: Readonly<Record<string, string>> = Object.freeze({
  'E-01': 'Authentication is required.',
  'E-02': 'Tenant scope is required.',
  'E-03': 'Tenant scope is invalid.',
  'E-04': 'You are not authorized to manage API keys for this Tenant.',
  'E-05': 'Key identifier is required.',
  'E-06': 'API key is required.',
  'E-07': 'Invalid or revoked API key.',
  'E-08': 'Unable to confirm API key creation. Check your key list before retrying.',
  'E-09': 'Unable to confirm revocation. Retry revocation; treat this key as potentially active.',
  'E-10': 'API key validation is unavailable. Access denied. Try again.',
  'E-11': 'API key secrets are only returned at creation and cannot be retrieved.',
  'E-12': 'API key not found.',
  'E-13': 'Revoked API keys cannot be re-activated.',
  'E-14': 'Unable to list API keys. Try again.',
  'E-15': 'This API key operation is not supported.',
  'E-16': 'You are not authorized to validate API keys.',
  REQUEST_INVALID: 'Invalid request.', REQUEST_TOO_LARGE: 'Request body is too large.',
  UNSUPPORTED_MEDIA_TYPE: 'Content-Type must be application/json.',
  NOT_FOUND: 'Resource not found.', METHOD_NOT_ALLOWED: 'Method is not allowed.',
  OPERATION_UNAVAILABLE: 'Unable to process this API key request. Try again.',
});
export function publicError(input: unknown): { code: string; message: string } {
  const code = typeof input === 'string' && Object.hasOwn(messages, input) ? input : 'OPERATION_UNAVAILABLE';
  return { code, message: messages[code] };
}
export class DomainError extends Error {
  readonly code: string;
  constructor(input: unknown) { const safe = publicError(input); super(safe.message); this.code = safe.code; }
}
