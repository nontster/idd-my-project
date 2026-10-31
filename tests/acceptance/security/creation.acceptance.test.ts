import { expect, test } from '@jest/globals';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { apiRequest, startAcceptanceApp } from '../../support/acceptance-app';
import { createIdentityFixtures, manualClock } from '../../support/identity-fixtures';
test('authorized developer receives one committed scoped secret with no plaintext storage or logs',async()=>{
  const app=await startAcceptanceApp();
  try{
    const created=await apiRequest(app.url,'/v1/api-keys',app.developerToken,{},app.tenantId);
    expect(created.status).toBe(201); const secret=created.body.apiKey;
    expect(typeof secret==='string'&&secret.length===52&&created.body.prefix===secret.slice(0,8)).toBe(true);
    expect(created.body.tenantId).toBe(app.tenantId);expect(created.body.status).toBe('active');
    expect(created.headers.get('cache-control')).toBe('no-store');
    const db=new DatabaseSync(app.databasePath);
    try{const row=db.prepare('SELECT * FROM api_keys WHERE keyId=?').get(created.body.keyId as string);
      expect(row?.status).toBe('active');expect(Object.keys(row??{}).some(k=>['apiKey','secret','token'].includes(k))).toBe(false);
      expect(readFileSync(app.databasePath).includes(Buffer.from(secret as string))).toBe(false);
      expect(JSON.stringify(db.prepare('SELECT * FROM security_attempts').all()).includes(secret as string)).toBe(false);
    }finally{db.close();}
    const later=await fetch(app.url+`/v1/api-keys/${created.body.keyId}/secret`,{headers:{authorization:`Bearer ${app.developerToken}`,'x-tenant-id':app.tenantId}});
    expect(later.status).toBe(409);expect((await later.json() as {error:{code:string}}).error.code).toBe('E-11');
    expect(app.logs.some(line=>line.includes(secret as string))).toBe(false);
  }finally{await app.close();}
});
test('management deadline before mutation produces E-08 without a late creation or automatic retry',async()=>{
  const identities=createIdentityFixtures();const clock=manualClock();
  identities.beforeAuthenticate=async()=>{clock.advance(2000,false);};
  const app=await startAcceptanceApp({clock},identities);
  try{const result=await apiRequest(app.url,'/v1/api-keys',app.developerToken,{},app.tenantId);
    expect(result.status).toBe(503);expect(result.body.error.code).toBe('E-08');expect(identities.calls.authenticate).toBe(1);
    const db=new DatabaseSync(app.databasePath);try{expect(db.prepare('SELECT count(*) AS n FROM api_keys').get()?.n).toBe(0);}finally{db.close();}
  }finally{await app.close();}
});
test('HTTP expiry immediately after a real creation commit keeps durable truth and never delivers the secret',async()=>{
  const manual=manualClock();let observer:DatabaseSync|undefined;let expired=false;
  const clock={...manual,monotonicNow(){
    if(observer&&!expired&&observer.prepare('SELECT count(*) AS n FROM api_keys').get()?.n===1){expired=true;manual.advance(2000,false);}
    return manual.monotonicNow();
  }};
  const app=await startAcceptanceApp({clock});observer=new DatabaseSync(app.databasePath);
  try{
    const result=await apiRequest(app.url,'/v1/api-keys',app.developerToken,{},app.tenantId);
    expect(expired).toBe(true);expect(result.status).toBe(503);expect(result.body.error.code).toBe('E-08');
    expect(Object.keys(result.body).sort()).toEqual(['error']);
    expect(observer.prepare('SELECT count(*) AS n FROM api_keys').get()?.n).toBe(1);
    expect(observer.prepare('SELECT outcome,finalized FROM security_attempts').get()?.outcome).toBe('succeeded');
  }finally{observer.close();observer=undefined;await app.close();}
});
