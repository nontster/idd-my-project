import { expect, test } from '@jest/globals';
import { createHash, randomBytes } from 'node:crypto';
import { NodeKeyCryptography } from '../../src/adapters/crypto/node-key-crypto';

function verifier() {
  const apiKey = randomBytes(6).toString('base64url') + '.' + randomBytes(32).toString('base64url');
  const salt = randomBytes(16);
  const keyHash = createHash('sha256').update(salt).update(apiKey, 'utf8').digest();
  return { apiKey, salt, keyHash };
}

test('generation issues canonical full keys with independent random prefix, secret and salt', () => {
  const sizes: number[] = [];
  const crypto = new NodeKeyCryptography(size => { sizes.push(size); return randomBytes(size); });
  const result = crypto.generate();
  expect(result.ok).toBe(true);
  if (!result.ok) return;
  expect(result.value.apiKey.length === 52 && /^[A-Za-z0-9_-]{8}\.[A-Za-z0-9_-]{43}$/.test(result.value.apiKey)).toBe(true);
  expect(result.value.prefix === result.value.apiKey.slice(0, 8)).toBe(true);
  expect(result.value.salt.length).toBe(16);
  expect(result.value.keyHash.length).toBe(32);
  expect(sizes).toEqual([6, 32, 16]);
  const expected = createHash('sha256').update(result.value.salt).update(result.value.apiKey, 'utf8').digest();
  expect(result.value.keyHash.equals(expected)).toBe(true);
});

test('separate generations do not reuse cached credentials or verification salts', () => {
  const crypto = new NodeKeyCryptography(); const first = crypto.generate(); const second = crypto.generate();
  expect(first.ok && second.ok).toBe(true);
  if (first.ok && second.ok) {
    expect(first.value.apiKey === second.value.apiKey).toBe(false);
    expect(first.value.salt.equals(second.value.salt)).toBe(false);
  }
});

test('hash uses salt bytes followed by the entire UTF-8 key, including prefix and delimiter', () => {
  const value = verifier(); const result = new NodeKeyCryptography().hash(value.apiKey, value.salt);
  expect(result.ok).toBe(true);
  if (result.ok) expect(result.value.equals(value.keyHash)).toBe(true);
});

test('full canonical key extracts its first eight characters for candidate lookup only', () => {
  const value = verifier();
  expect(new NodeKeyCryptography().prefix(value.apiKey) === value.apiKey.slice(0, 8)).toBe(true);
});

test.each(['empty', 'prefix-only', 'leading-space', 'trailing-newline', 'wrong-delimiter', 'noncanonical'] as const)(
  '%s input is not normalized into a credential', kind => {
    const value = verifier();
    const raw = { empty: '', 'prefix-only': value.apiKey.slice(0, 8), 'leading-space': ' ' + value.apiKey,
      'trailing-newline': value.apiKey + '\n', 'wrong-delimiter': value.apiKey.replace('.', '-'),
      noncanonical: value.apiKey.slice(0, -1) + '_' }[kind];
    const crypto = new NodeKeyCryptography();
    expect(crypto.prefix(raw)).toBe(null);
    const result = crypto.verify(raw, value.salt, value.keyHash);
    expect(result.ok && result.value === false).toBe(true);
  });

test('fixed-size native comparison accepts a matching full secret', () => {
  const value = verifier(); const result = new NodeKeyCryptography().verify(value.apiKey, value.salt, value.keyHash);
  expect(result.ok && result.value).toBe(true);
});

test('a different full key and a modified digest are rejected', () => {
  const value = verifier(); const other = verifier(); const crypto = new NodeKeyCryptography();
  const changed = Buffer.from(value.keyHash); changed[0] ^= 1;
  const results = [crypto.verify(other.apiKey, value.salt, value.keyHash), crypto.verify(value.apiKey, value.salt, changed)];
  for (const result of results) expect(result.ok && result.value === false).toBe(true);
});

test.each([[15, 32], [17, 32], [16, 31], [16, 33], [0, 0]])('corrupt verifier lengths deny without buffer-comparison diagnostics', (saltSize, hashSize) => {
  const value = verifier(); let result;
  try { result = new NodeKeyCryptography().verify(value.apiKey, Buffer.alloc(saltSize), Buffer.alloc(hashSize)); }
  catch { result = { ok: false, code: 'THREW' }; }
  expect(result.ok ? 'SUCCESS' : result.code).toBe('UNAVAILABLE');
});

test('entropy failure is a safe unavailable outcome without arbitrary exception data', () => {
  const crypto = new NodeKeyCryptography(() => { throw new Error('entropy source unavailable'); });
  let result;
  try { result = crypto.generate(); } catch { result = { ok: false, code: 'THREW' }; }
  expect(result.ok ? 'SUCCESS' : result.code).toBe('UNAVAILABLE');
  expect(Object.keys(result).sort()).toEqual(['code', 'ok']);
});

test('malformed random-source output cannot produce weakened issued material', () => {
  const result = new NodeKeyCryptography(size => Buffer.alloc(size - 1)).generate();
  expect(result.ok ? 'SUCCESS' : result.code).toBe('UNAVAILABLE');
});
test('digest dependency failures and thrown buffer access stay secret-free',()=>{
  const value=verifier();
  class MissingDigest extends NodeKeyCryptography { override hash(){return {ok:false as const,code:'UNAVAILABLE'};} }
  const missing=new MissingDigest();expect(missing.generate().ok).toBe(false);expect(missing.verify(value.apiKey,value.salt,value.keyHash).ok).toBe(false);
  const crypto=new NodeKeyCryptography();
  for(const [key,salt] of [['',value.salt],[value.apiKey,Buffer.alloc(0)],[value.apiKey,null]] as const)expect(crypto.hash(key,salt as Uint8Array).ok).toBe(false);
  class BrokenPrefix extends NodeKeyCryptography {override prefix():string|null{throw new Error('controlled parsing fault');}}
  expect(new BrokenPrefix().hash(value.apiKey,value.salt).ok).toBe(false);
  class BrokenDigest extends NodeKeyCryptography {override hash():never{throw new Error('controlled digest fault');}}
  expect(new BrokenDigest().verify(value.apiKey,value.salt,value.keyHash).ok).toBe(false);
});
