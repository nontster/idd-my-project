const codes: ReadonlySet<unknown> = new Set([
  ...Array.from({ length: 16 }, (_, index) => `E-${String(index + 1).padStart(2, '0')}`),
  'REQUEST_INVALID', 'REQUEST_TOO_LARGE', 'UNSUPPORTED_MEDIA_TYPE',
  'NOT_FOUND', 'METHOD_NOT_ALLOWED', 'OPERATION_UNAVAILABLE',
]);

export function isErrorCode(value: unknown): value is string { return codes.has(value); }
