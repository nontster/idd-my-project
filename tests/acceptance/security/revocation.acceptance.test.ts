import { expect,test } from '@jest/globals';
import { DatabaseSync } from 'node:sqlite';
import { startAcceptanceApp,apiRequest } from '../../support/acceptance-app';
import { startGatewayServer } from '../../support/gateway-servers';
import { createIdentityFixtures,manualClock } from '../../support/identity-fixtures';
import { sampleKeyRecord,insertSeed } from '../../support/key-record-fixtures';
test('a same-Tenant colleague revokes durably after both real gateways warm, with immediate logical invalidation despite retained hints',async()=>{
  const ids=createIdentityFixtures();const app=await startAcceptanceApp({},ids);const seed=sampleKeyRecord();const db=new DatabaseSync(app.databasePath);insertSeed(db,seed.record);const gateways=[await startGatewayServer(app),await startGatewayServer(app)];
  try{
    for(const g of gateways){const r=await apiRequest(g.url,'/admit',app.serviceToken,{apiKey:seed.apiKey,expectedTenantId:app.tenantId});expect(r.status).toBe(200);expect(g.cacheSize()).toBe(1);}
    const revoked=await apiRequest(app.url,'/v1/api-keys/revocations',ids.colleagueToken,{keyId:seed.record.keyId},app.tenantId);expect(revoked.status).toBe(200);expect(revoked.body.status).toBe('revoked');
    expect(db.prepare('SELECT status,generation FROM api_keys WHERE keyId=?').get(seed.record.keyId)?.generation).toBe(2);
    for(const g of gateways){const r=await apiRequest(g.url,'/admit',app.serviceToken,{apiKey:seed.apiKey,expectedTenantId:app.tenantId});expect(r.status).toBe(403);expect(r.body.error.code).toBe('E-07');expect(g.cacheSize()).toBe(1);}
    expect(JSON.stringify(revoked.body).includes(seed.apiKey)||app.logs.some(line=>line.includes(seed.apiKey))).toBe(false);
    const repeat=await apiRequest(app.url,'/v1/api-keys/revocations',app.developerToken,{keyId:seed.record.keyId},app.tenantId);expect(repeat.status).toBe(200);expect(repeat.body).toEqual(revoked.body);
  }finally{db.close();for(const g of gateways)await g.close();await app.close();}
});
test('expiry immediately after real revoke commit preserves terminal state and audit truth and denies both gateways',async()=>{
  const manual=manualClock();let observer:DatabaseSync|undefined;let expired=false;const seed=sampleKeyRecord();
  const clock={...manual,monotonicNow(){if(observer&&!expired&&observer.prepare('SELECT status FROM api_keys WHERE keyId=?').get(seed.record.keyId)?.status==='revoked'){expired=true;manual.advance(2000,false);}return manual.monotonicNow();}};
  const app=await startAcceptanceApp({clock});observer=new DatabaseSync(app.databasePath);insertSeed(observer,seed.record);const gateways=[await startGatewayServer(app),await startGatewayServer(app)];
  try{
    for(const g of gateways)expect((await g.enforcement.admit(seed.apiKey,app.tenantId)).ok).toBe(true);
    const r=await apiRequest(app.url,'/v1/api-keys/revocations',app.developerToken,{keyId:seed.record.keyId},app.tenantId);expect(r.status).toBe(503);expect(r.body.error.code).toBe('E-09');expect(expired).toBe(true);
    const original=observer.prepare('SELECT generation,revokedAt,revocationAttemptId FROM api_keys WHERE keyId=?').get(seed.record.keyId);expect(original?.generation).toBe(2);
    expect(observer.prepare("SELECT outcome FROM security_attempts WHERE operation='revoke'").get()?.outcome).toBe('succeeded');
    for(const g of gateways)expect((await g.enforcement.admit(seed.apiKey,app.tenantId) as {code:string}).code).toBe('E-07');
    const repeat=await apiRequest(app.url,'/v1/api-keys/revocations',app.developerToken,{keyId:seed.record.keyId},app.tenantId);expect(repeat.status).toBe(200);expect(repeat.body.revokedAt).toBe(original?.revokedAt);
    expect(observer.prepare('SELECT revocationAttemptId FROM api_keys WHERE keyId=?').get(seed.record.keyId)?.revocationAttemptId).toBe(original?.revocationAttemptId);
  }finally{observer.close();observer=undefined;for(const g of gateways)await g.close();await app.close();}
});
test('management expiry before transaction entry cannot create a late revocation or retry',async()=>{
  const ids=createIdentityFixtures();const clock=manualClock();ids.beforeAuthenticate=async()=>{clock.advance(2000,false);};const app=await startAcceptanceApp({clock},ids);const seed=sampleKeyRecord();const db=new DatabaseSync(app.databasePath);insertSeed(db,seed.record);
  try{const r=await apiRequest(app.url,'/v1/api-keys/revocations',app.developerToken,{keyId:seed.record.keyId},app.tenantId);expect(r.status).toBe(503);expect(r.body.error.code).toBe('E-09');expect(db.prepare('SELECT status FROM api_keys WHERE keyId=?').get(seed.record.keyId)?.status).toBe('active');expect(ids.calls.authenticate).toBe(1);}
  finally{db.close();await app.close();}
});
