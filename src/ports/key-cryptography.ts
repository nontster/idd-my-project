import type { Outcome } from '../domain/outcome';
export interface GeneratedKeyMaterial { apiKey: string; prefix: string; salt: Uint8Array; keyHash: Uint8Array; }
export interface KeyCryptography {
  generate(): Outcome<GeneratedKeyMaterial>;
  prefix(apiKey: unknown): string | null;
  hash(apiKey: unknown, salt: Uint8Array): Outcome<Uint8Array>;
  verify(apiKey: unknown, salt: Uint8Array, digest: Uint8Array): Outcome<boolean>;
}
