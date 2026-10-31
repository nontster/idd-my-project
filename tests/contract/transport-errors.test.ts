import { expect, test } from '@jest/globals';
import { randomUUID } from 'node:crypto';
import { errorStatus } from '../../src/routes/api';
import { publicError } from '../../src/domain/errors';
import { startAcceptanceApp } from '../support/acceptance-app';
const statuses = [401,400,400,403,400,400,403,503,503,503,409,404,409,503,400,403];
test.each(statuses.map((status, index) => ({ status, code: `E-${String(index+1).padStart(2,'0')}` })))('$code has exact HTTP status', ({ code, status }) => {
  expect(errorStatus(code)).toBe(status);
});
test.each([
  ['NOT_FOUND',404,'Resource not found.'], ['METHOD_NOT_ALLOWED',405,'Method is not allowed.'],
  ['REQUEST_INVALID',400,'Invalid request.'], ['REQUEST_TOO_LARGE',413,'Request body is too large.'],
  ['UNSUPPORTED_MEDIA_TYPE',415,'Content-Type must be application/json.'],
  ['OPERATION_UNAVAILABLE',503,'Unable to process this API key request. Try again.'],
] as const)('%s has an exact safe transport projection', (code, status, message) => {
  expect(errorStatus(code)).toBe(status); expect(publicError(code)).toEqual({ code, message });
});
test('real HTTP enforces JSON framing, method/path errors and no-store without request diagnostics', async () => {
  const app = await startAcceptanceApp(); const sentinel = randomUUID();
  try {
    const cases = [
      { path: '/missing?secret='+sentinel, method: 'GET', expected:404, code:'NOT_FOUND' },
      { path: '/v1/api-keys', method:'DELETE', expected:405, code:'METHOD_NOT_ALLOWED' },
      { path: '/v1/api-keys', method:'POST', content:'text/plain', body:sentinel, expected:415, code:'UNSUPPORTED_MEDIA_TYPE' },
      { path: '/v1/api-keys', method:'POST', content:'application/json', body:'{"x":', expected:400, code:'REQUEST_INVALID' },
      { path: '/v1/api-keys', method:'POST', content:'application/json', body:JSON.stringify({x:'x'.repeat(8192)}), expected:413, code:'REQUEST_TOO_LARGE' },
    ];
    for (const c of cases) {
      const headers: Record<string,string> = { authorization:`Bearer ${app.developerToken}`, 'x-tenant-id':app.tenantId };
      if (c.content) headers['content-type']=c.content;
      const response = await fetch(app.url+c.path,{method:c.method,headers,body:c.body});
      expect(response.status).toBe(c.expected); expect(response.headers.get('cache-control')).toBe('no-store');
      const body = await response.json() as {error:{code:string}}; expect(body.error.code).toBe(c.code);
      expect(JSON.stringify(body).includes(sentinel)).toBe(false);
    }
    expect(app.logs.some(line=>line.includes(sentinel)||line.includes(app.developerToken))).toBe(false);
  } finally { await app.close(); }
});
