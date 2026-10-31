import { expect, test } from '@jest/globals';
import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { startAcceptanceApp } from '../support/acceptance-app';
import { createIdentityFixtures } from '../support/identity-fixtures';
import { sampleKeyRecord, insertSeed } from '../support/key-record-fixtures';
test('retrieval rejects known, foreign and unknown keys without ever exposing secret material',async()=>{
  const identities=createIdentityFixtures();const app=await startAcceptanceApp({},identities);const a=sampleKeyRecord();const b=sampleKeyRecord();
  const db=new DatabaseSync(app.databasePath);insertSeed(db,a.record);insertSeed(db,{...b.record,tenantId:'tenant-b'});
  try{
    for(const [keyId,code,status] of [[a.record.keyId,'E-11',409],[b.record.keyId,'E-12',404],[randomUUID(),'E-12',404],['invalid','E-12',404]] as const){
      const r=await fetch(app.url+`/v1/api-keys/${keyId}/secret`,{headers:{authorization:`Bearer ${app.developerToken}`,'x-tenant-id':app.tenantId}});
      expect(r.status).toBe(status);expect(r.headers.get('cache-control')).toBe('no-store');const body=await r.json() as {error:{code:string}};expect(body.error.code).toBe(code);expect(JSON.stringify(body).includes(a.apiKey)).toBe(false);
    }
    identities.unavailable=true;const down=await fetch(app.url+`/v1/api-keys/${a.record.keyId}/secret`,{headers:{authorization:`Bearer ${app.developerToken}`,'x-tenant-id':app.tenantId}});
    expect(down.status).toBe(503);expect((await down.json() as {error:{code:string}}).error.code).toBe('OPERATION_UNAVAILABLE');
  }finally{db.close();await app.close();}
});
