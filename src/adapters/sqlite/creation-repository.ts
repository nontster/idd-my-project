import type { DatabaseSync } from 'node:sqlite';
import { keyRecord, type KeyRecord } from '../../domain/key-record';
import type { Outcome } from '../../domain/outcome';
import type { CreationRepository } from '../../ports/key-repository';
export class SqliteCreationRepository implements CreationRepository {
  constructor(private readonly connection: DatabaseSync) {}
  retainedCandidates(prefix: string): Outcome<readonly KeyRecord[]> {
    try {
      const records: KeyRecord[]=[];
      for(const row of this.connection.prepare('SELECT * FROM api_keys WHERE prefix=?').all(prefix)){
        const checked=keyRecord(row);if(!checked.ok)return {ok:false,code:'UNAVAILABLE'};records.push(checked.value);
      }
      return {ok:true,value:records};
    }catch{return {ok:false,code:'UNAVAILABLE'};}
  }
  insert(record: KeyRecord): void {
    const checked=keyRecord(record);if(!checked.ok)throw new Error('Invalid key record');
    const v=checked.value;
    this.connection.prepare('INSERT INTO api_keys (keyId,tenantId,prefix,salt,keyHash,status,generation,createdAt,revokedAt,creationAttemptId,revocationAttemptId) VALUES (?,?,?,?,?,?,?,?,?,?,?)')
      .run(v.keyId,v.tenantId,v.prefix,v.salt,v.keyHash,v.status,v.generation,v.createdAt,v.revokedAt,v.creationAttemptId,v.revocationAttemptId);
  }
}
