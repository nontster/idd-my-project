import { expect,test } from '@jest/globals';
import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { startAcceptanceApp,apiRequest } from '../../support/acceptance-app';
import { sampleKeyRecord,insertSeed } from '../../support/key-record-fixtures';
import { createIdentityFixtures,manualClock } from '../../support/identity-fixtures';
import { DecisionGate } from '../../../src/services/decision-gate';
import type { RequestContext } from '../../../src/domain/request-context';
test('trusted validation accepts a seeded active full secret independently of issuance and exposes only its bound decision',async()=>{
  const app=await startAcceptanceApp();const seed=sampleKeyRecord();const db=new DatabaseSync(app.databasePath);
  insertSeed(db,{...seed.record,createdAt:'2020-01-01T00:00:00.000Z'});db.close();const requestId=randomUUID();
  try{
    const r=await apiRequest(app.url,'/v1/api-keys/validations',app.serviceToken,{apiKey:seed.apiKey,expectedTenantId:app.tenantId,requestId});
    expect(r.status).toBe(200);expect(r.body.requestId).toBe(requestId);expect(r.body.keyId===seed.record.keyId).toBe(true);expect(r.body.generation).toBe(1);
    expect(Object.keys(r.body).sort()).toEqual(['decisionId','generation','keyId','requestId','tenantId']);expect(r.headers.get('cache-control')).toBe('no-store');
    expect(JSON.stringify(r.body).includes(seed.apiKey)||app.logs.some(line=>line.includes(seed.apiKey))).toBe(false);
  }finally{await app.close();}
});
test('malformed, unknown, prefix-only, foreign and revoked keys are rejected after caller trust',async()=>{
  const app=await startAcceptanceApp();const active=sampleKeyRecord();const foreign=sampleKeyRecord(active.record.prefix);const revoked=sampleKeyRecord(active.record.prefix);
  const db=new DatabaseSync(app.databasePath);insertSeed(db,active.record);insertSeed(db,{...foreign.record,tenantId:'tenant-b'});insertSeed(db,{...revoked.record,status:'revoked',generation:2,revokedAt:new Date().toISOString(),revocationAttemptId:randomUUID()});db.close();
  try{
    for(const apiKey of ['malformed',sampleKeyRecord().apiKey,active.record.prefix,foreign.apiKey,revoked.apiKey,' '+active.apiKey]){
      const r=await apiRequest(app.url,'/v1/api-keys/validations',app.serviceToken,{apiKey,expectedTenantId:app.tenantId,requestId:randomUUID()});expect(r.status).toBe(403);expect(r.body.error.code).toBe('E-07');
      expect(JSON.stringify(r.body).includes(apiKey)).toBe(false);
    }
  }finally{await app.close();}
});
test('a hung verifier at shared identity expiry denies without examining a key or retrying',async()=>{
  const identities=createIdentityFixtures();const clock=manualClock();identities.beforeAuthenticate=async()=>{clock.advance(100,false);};
  const app=await startAcceptanceApp({clock},identities);try{
    const r=await apiRequest(app.url,'/v1/api-keys/validations',app.serviceToken,{apiKey:sampleKeyRecord().apiKey,expectedTenantId:app.tenantId,requestId:randomUUID()});
    expect(r.status).toBe(503);expect(r.body.error.code).toBe('E-10');expect(identities.calls.authenticate).toBe(1);expect(identities.calls.context).toBe(0);
  }finally{await app.close();}
});
test.each([199,200])('HTTP validation uses elapsed time at its final gate boundary',async elapsed=>{
  const clock=manualClock();
  class AtBoundary extends DecisionGate{override run<T>(context:RequestContext,operation:()=>T){clock.advance(elapsed,false);return super.run(context,operation);}}
  const app=await startAcceptanceApp({clock,decisionGate:new AtBoundary()});const seed=sampleKeyRecord();const db=new DatabaseSync(app.databasePath);insertSeed(db,seed.record);db.close();
  try{const r=await apiRequest(app.url,'/v1/api-keys/validations',app.serviceToken,{apiKey:seed.apiKey,expectedTenantId:app.tenantId,requestId:randomUUID()});expect(r.status).toBe(elapsed===199?200:503);if(elapsed===200)expect(r.body.error.code).toBe('E-10');}
  finally{await app.close();}
});
