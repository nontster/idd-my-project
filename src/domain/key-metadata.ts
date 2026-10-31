import type { KeyRecord } from './key-record';
import type { Outcome } from './outcome';
import { isObject,isUuid,isTenantId,isTimestamp } from './values';
import { metadata } from './key-dtos';

export function publicMetadata(input:unknown):Outcome<KeyMetadata>{
  const unavailable={ok:false,code:'UNAVAILABLE'} as const;
  try{
    if(!isObject(input))return unavailable;
    const fields=['keyId','tenantId','prefix','status','createdAt','revokedAt'];
    const value=Object.fromEntries(fields.map(field=>[field,input[field]]));
    if(!isUuid(value.keyId)||!isTenantId(value.tenantId)||typeof value.prefix!=='string'||!/^[A-Za-z0-9_-]{8}$/.test(value.prefix)||!isTimestamp(value.createdAt))return unavailable;
    const active=value.status==='active'&&value.revokedAt===null;
    const revoked=value.status==='revoked'&&isTimestamp(value.revokedAt);
    if(!active&&!revoked)return unavailable;
    return {ok:true,value:metadata(value as unknown as KeyMetadata)};
  }catch{return unavailable;}
}

export type KeyMetadata = Readonly<Pick<KeyRecord, 'keyId' | 'tenantId' | 'prefix' | 'status' | 'createdAt' | 'revokedAt'>>;
