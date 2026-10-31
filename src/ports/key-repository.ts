import type { KeyRecord } from '../domain/key-record';
import type { KeyMetadata } from '../domain/key-metadata';
import type { Outcome } from '../domain/outcome';
export interface CreationRepository {
  retainedCandidates(prefix: string): Outcome<readonly KeyRecord[]>;
  insert(record: KeyRecord): void;
}
export interface ValidationRepository {
  candidates(tenantId: string, prefix: string): Outcome<readonly KeyRecord[]>;
  current(keyId: string, tenantId: string): Outcome<KeyRecord | null>;
}
export interface RevocationRepository {
  current(keyId: string, tenantId: string): Outcome<KeyRecord | null>;
  revoke(keyId: string, tenantId: string, at: string, attemptId: string): KeyRecord | null;
}
export interface ListingRepository { list(tenantId: string): Outcome<readonly KeyMetadata[]> | Promise<Outcome<readonly KeyMetadata[]>>; }
export interface ScopedKeyLookup { find(keyId:string,tenantId:string):Outcome<KeyMetadata|null>; }
