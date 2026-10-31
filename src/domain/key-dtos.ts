import type { KeyRecord } from './key-record';
import type { KeyMetadata } from './key-metadata';
export type CreatedKey = KeyMetadata & { readonly apiKey: string };
export function metadata(record: KeyMetadata): KeyMetadata {
  return Object.freeze({keyId:record.keyId,tenantId:record.tenantId,prefix:record.prefix,status:record.status,createdAt:record.createdAt,revokedAt:record.revokedAt});
}
export function createdKey(record: KeyRecord, apiKey: string): CreatedKey {
  return Object.freeze({...metadata(record),apiKey});
}
