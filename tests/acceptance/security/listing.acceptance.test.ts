import { expect,test } from '@jest/globals';
import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { startAcceptanceApp } from '../../support/acceptance-app';
import { sampleKeyRecord,insertSeed } from '../../support/key-record-fixtures';
import { createIdentityFixtures,manualClock,deferred } from '../../support/identity-fixtures';
import { keyRecord } from '../../../src/domain/key-record';
import { metadata } from '../../../src/domain/key-dtos';
import type { KeyMetadata } from '../../../src/domain/key-metadata';
test('both same-Tenant developers list the complete active/revoked metadata collection with duplicate prefixes and no secrets',async()=>{
  const ids=createIdentityFixtures();const app=await startAcceptanceApp({},ids);const a=sampleKeyRecord();const b=sampleKeyRecord(a.record.prefix);const foreign=sampleKeyRecord(a.record.prefix);const db=new DatabaseSync(app.databasePath);
  insertSeed(db,a.record);insertSeed(db,{...b.record,status:'revoked',generation:2,revokedAt:new Date().toISOString(),revocationAttemptId:randomUUID()});insertSeed(db,{...foreign.record,tenantId:'tenant-b'});
  try{
    for(const token of [app.developerToken,ids.colleagueToken]){
      const response=await fetch(app.url+'/v1/api-keys?limit=1',{headers:{authorization:`Bearer ${token}`,'x-tenant-id':app.tenantId}});expect(response.status).toBe(200);expect(response.headers.get('cache-control')).toBe('no-store');
      const result=await response.json() as {items:Record<string,unknown>[]};expect(result.items.length).toBe(2);expect(new Set(result.items.map(item=>item.keyId)).size).toBe(2);
      for(const item of result.items){expect(Object.keys(item).sort()).toEqual(['createdAt','keyId','prefix','revokedAt','status','tenantId']);expect(item.tenantId).toBe(app.tenantId);expect(item.prefix===a.record.prefix).toBe(true);}
      const serialized=JSON.stringify(result);expect([a.apiKey,b.apiKey,foreign.apiKey].some(key=>serialized.includes(key)||app.logs.some(line=>line.includes(key)))).toBe(false);
      expect(result.items.some(item=>item.status==='active')&&result.items.some(item=>item.status==='revoked')).toBe(true);
    }
    expect(db.prepare("SELECT count(*) AS n FROM security_attempts WHERE operation NOT IN ('create','revoke')").get()?.n).toBe(0);
  }finally{db.close();await app.close();}
});
test('a late real metadata read is discarded at the management deadline without retry or a partial success',async()=>{
  const clock=manualClock();let observer:DatabaseSync|undefined;let pause=false;let calls=0;const started=deferred();const release=deferred();
  const repository={async list(tenantId:string){
    calls++;const items:KeyMetadata[]=[];
    for(const row of observer!.prepare('SELECT * FROM api_keys WHERE tenantId=?').all(tenantId)){const checked=keyRecord(row);if(!checked.ok)return {ok:false as const,code:'UNAVAILABLE'};items.push(metadata(checked.value));}
    if(pause){started.resolve();await release.promise;}return {ok:true as const,value:items};
  }};
  const app=await startAcceptanceApp({clock,listingRepository:repository});observer=new DatabaseSync(app.databasePath);insertSeed(observer,sampleKeyRecord().record);
  const get=()=>fetch(app.url+'/v1/api-keys',{headers:{authorization:`Bearer ${app.developerToken}`,'x-tenant-id':app.tenantId}});
  try{
    expect((await get()).status).toBe(200);pause=true;const pending=get();
    const first=await Promise.race([started.promise.then(()=>'read'),pending.then(()=>'response')]);expect(first).toBe('read');clock.advance(2000);
    const response=await pending;expect(response.status).toBe(503);const body=await response.json() as {error:{code:string}};expect(body.error.code).toBe('E-14');release.resolve();expect(calls).toBe(2);
  }finally{release.resolve();observer.close();observer=undefined;await app.close();}
});
test('unavailable identity returns the listing-specific failure and never retries the provider',async()=>{
  const ids=createIdentityFixtures();ids.unavailable=true;const app=await startAcceptanceApp({},ids);
  try{const r=await fetch(app.url+'/v1/api-keys',{headers:{authorization:`Bearer ${app.developerToken}`,'x-tenant-id':app.tenantId}});expect(r.status).toBe(503);expect((await r.json() as {error:{code:string}}).error.code).toBe('E-14');expect(ids.calls.authenticate).toBe(1);}
  finally{await app.close();}
});
