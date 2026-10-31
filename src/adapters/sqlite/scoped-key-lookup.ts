import type { DatabaseSync } from 'node:sqlite';
import { keyRecord } from '../../domain/key-record';
import { metadata } from '../../domain/key-dtos';
import type { KeyMetadata } from '../../domain/key-metadata';
import type { Outcome } from '../../domain/outcome';
import type { ScopedKeyLookup } from '../../ports/key-repository';
export class SqliteScopedKeyLookup implements ScopedKeyLookup {
  constructor(private readonly connection:DatabaseSync){}
  find(keyId:string,tenantId:string):Outcome<KeyMetadata|null>{
    try{
      const row=this.connection.prepare('SELECT * FROM api_keys WHERE tenantId=? AND keyId=?').get(tenantId,keyId);
      if(!row)return {ok:true,value:null};
      const checked=keyRecord(row);return checked.ok?{ok:true,value:metadata(checked.value)}:{ok:false,code:'UNAVAILABLE'};
    }catch{return {ok:false,code:'UNAVAILABLE'};}
  }
}
