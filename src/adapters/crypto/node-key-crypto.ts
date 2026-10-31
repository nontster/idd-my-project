import type { Outcome } from '../../domain/outcome';
import type { KeyCryptography } from '../../ports/key-cryptography';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

export interface GeneratedKey { apiKey: string; prefix: string; salt: Buffer; keyHash: Buffer }

const unavailable = { ok: false, code: 'UNAVAILABLE' } as const;
export class NodeKeyCryptography implements KeyCryptography {
  constructor(private readonly random: (size: number) => Buffer = randomBytes) {}
  generate(): Outcome<GeneratedKey> {
    try {
      const prefixBytes = this.random(6); const suffix = this.random(32); const salt = this.random(16);
      if (!Buffer.isBuffer(prefixBytes) || prefixBytes.length !== 6 || !Buffer.isBuffer(suffix) || suffix.length !== 32 || !Buffer.isBuffer(salt) || salt.length !== 16) return unavailable;
      const prefix = prefixBytes.toString('base64url'); const apiKey = prefix + '.' + suffix.toString('base64url');
      const digest = this.hash(apiKey, salt);
      if (!digest.ok) return unavailable;
      return { ok: true, value: { apiKey, prefix, salt, keyHash: digest.value } };
    } catch { return unavailable; }
  }
  prefix(apiKey: unknown): string | null {
    if (typeof apiKey !== 'string' || apiKey.length !== 52 || !/^[A-Za-z0-9_-]{8}\.[A-Za-z0-9_-]{43}$/.test(apiKey)) return null;
    if (Buffer.from(apiKey.slice(9), 'base64url').toString('base64url') !== apiKey.slice(9)) return null;
    return apiKey.slice(0, 8);
  }
  hash(apiKey: unknown, salt: Uint8Array): Outcome<Buffer> {
    try {
      if (!this.prefix(apiKey) || !(salt instanceof Uint8Array) || salt.length !== 16) return unavailable;
      return { ok: true, value: createHash('sha256').update(salt).update(apiKey as string, 'utf8').digest() };
    } catch { return unavailable; }
  }
  verify(apiKey: unknown, salt: Uint8Array, keyHash: Uint8Array): Outcome<boolean> {
    try {
      if (!(salt instanceof Uint8Array) || salt.length !== 16 || !(keyHash instanceof Uint8Array) || keyHash.length !== 32) return unavailable;
      if (!this.prefix(apiKey)) return { ok: true, value: false };
      const digest = this.hash(apiKey, salt);
      return digest.ok ? { ok: true, value: timingSafeEqual(digest.value, keyHash) } : unavailable;
    } catch { return unavailable; }
  }
}
