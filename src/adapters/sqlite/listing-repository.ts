import type { DatabaseSync } from 'node:sqlite';
import type { ListingRepository } from '../../ports/key-repository';
import type { KeyMetadata } from '../../domain/key-metadata';
import type { Outcome } from '../../domain/outcome';
import { keyRecord } from '../../domain/key-record';
import { metadata } from '../../domain/key-dtos';
export class SqliteListingRepository implements ListingRepository{
  constructor(private readonly connection:DatabaseSync){}
  list(tenantId:string):Outcome<readonly KeyMetadata[]>{
    try{
      const items:KeyMetadata[]=[];
      for(const row of this.connection.prepare('SELECT * FROM api_keys WHERE tenantId=? ORDER BY keyId').all(tenantId)){
        const checked=keyRecord(row);if(!checked.ok)return {ok:false,code:'UNAVAILABLE'};items.push(metadata(checked.value));
      }
      return {ok:true,value:Object.freeze(items)};
    }catch{return {ok:false,code:'UNAVAILABLE'};}
  }
}
