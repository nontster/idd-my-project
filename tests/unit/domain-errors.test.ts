import { expect, test } from '@jest/globals';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { DomainError, publicError } from '../../src/domain/errors';

const spec = readFileSync(resolve(__dirname, '../../../specs/001-api-key-lifecycle/spec.md'), 'utf8');
const cases = spec.split('\n').filter(line => /^\| E-\d\d \|/.test(line))
  .map(line => { const cells = line.split('|'); return { code: cells[1].trim(), message: cells[3].trim() }; });

test.each(cases)('public failure $code uses the independently specified message', ({ code, message }) => {
  expect(publicError(code)).toEqual({ code, message });
  const error = new DomainError(code);
  expect(error.code).toBe(code);
  expect(publicError(error.code)).toEqual({ code, message });
});

test('unknown codes and arbitrary errors cannot disclose exception or credential values', () => {
  const secret = randomUUID();
  for (const input of [undefined, null, secret, { code: 'E-07', message: secret, stack: secret }]) {
    const value = publicError(input);
    expect(value.code).toBe('OPERATION_UNAVAILABLE');
    expect(value.message).toBe('Unable to process this API key request. Try again.');
    expect(Object.keys(value).sort()).toEqual(['code', 'message']);
    expect(JSON.stringify(value).includes(secret)).toBe(false);
  }
});

test('unknown error construction retains only a safe recognized failure code', () => {
  const error = new DomainError(randomUUID());
  expect(error.code).toBe('OPERATION_UNAVAILABLE');
  expect(error.message).toBe('Unable to process this API key request. Try again.');
});
