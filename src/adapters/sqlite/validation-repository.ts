import type { DatabaseSync } from 'node:sqlite';
import { keyRecord, type KeyRecord } from '../../domain/key-record';
import type { Outcome } from '../../domain/outcome';
import type { ValidationRepository } from '../../ports/key-repository';
export class SqliteValidationRepository implements ValidationRepository {
  constructor(private readonly connection:DatabaseSync){}
  candidates(tenantId:string,prefix:string):Outcome<readonly KeyRecord[]>{
    try{
      const values:KeyRecord[]=[];
      for(const row of this.connection.prepare('SELECT * FROM api_keys WHERE tenantId=? AND prefix=?').all(tenantId,prefix)){
        const checked=keyRecord(row);if(!checked.ok)return {ok:false,code:'UNAVAILABLE'};values.push(checked.value);
      }
      return {ok:true,value:values};
    }catch{return {ok:false,code:'UNAVAILABLE'};}
  }
  current(keyId:string,tenantId:string):Outcome<KeyRecord|null>{
    try{
      const row=this.connection.prepare('SELECT * FROM api_keys WHERE tenantId=? AND keyId=?').get(tenantId,keyId);
      return row?keyRecord(row):{ok:true,value:null};
    }catch{return {ok:false,code:'UNAVAILABLE'};}
  }
}
