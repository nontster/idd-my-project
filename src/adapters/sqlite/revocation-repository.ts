import type { DatabaseSync } from 'node:sqlite';
import { keyRecord,type KeyRecord } from '../../domain/key-record';
import type { Outcome } from '../../domain/outcome';
import type { RevocationRepository } from '../../ports/key-repository';
export class SqliteRevocationRepository implements RevocationRepository{
  constructor(private readonly connection:DatabaseSync){}
  current(keyId:string,tenantId:string):Outcome<KeyRecord|null>{
    try{const row=this.connection.prepare('SELECT * FROM api_keys WHERE tenantId=? AND keyId=?').get(tenantId,keyId);return row?keyRecord(row):{ok:true,value:null};}
    catch{return {ok:false,code:'UNAVAILABLE'};}
  }
  revoke(keyId:string,tenantId:string,at:string,attemptId:string):KeyRecord|null{
    const current=this.current(keyId,tenantId);if(!current.ok)throw new Error('Scoped state unavailable');
    if(!current.value||current.value.status==='revoked')return current.value;
    this.connection.prepare("UPDATE api_keys SET status='revoked',generation=2,revokedAt=?,revocationAttemptId=? WHERE keyId=? AND tenantId=? AND status='active'").run(at,attemptId,keyId,tenantId);
    const updated=this.current(keyId,tenantId);if(!updated.ok||!updated.value||updated.value.status!=='revoked')throw new Error('Terminal transition unavailable');
    return updated.value;
  }
}
