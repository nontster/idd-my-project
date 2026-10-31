import { expect,test } from '@jest/globals';
import { DatabaseSync } from 'node:sqlite';
import { startAcceptanceApp,apiRequest } from '../support/acceptance-app';
import { startGatewayServer } from '../support/gateway-servers';
import { sampleKeyRecord,insertSeed } from '../support/key-record-fixtures';
import { deferred,manualClock } from '../support/identity-fixtures';
import { ControlledGate } from '../support/controlled-gate';
test('a decision paused before D rejects after real R; a partitioned warm peer denies and reconnects to revoked state',async()=>{
  const clock=manualClock();const gate=new ControlledGate();const app=await startAcceptanceApp({clock,decisionGate:gate});const seed=sampleKeyRecord();const db=new DatabaseSync(app.databasePath);insertSeed(db,seed.record);const a=await startGatewayServer(app,{clock});const b=await startGatewayServer(app,{clock});let release=()=>{};
  try{
    for(const g of [a,b]){expect((await g.enforcement.admit(seed.apiKey,app.tenantId)).ok).toBe(true);expect(g.cacheSize()).toBe(1);}
    b.controls.partitioned=true;expect((await b.enforcement.admit(seed.apiKey,app.tenantId) as {code:string}).code).toBe('E-10');
    const pause=gate.arm();release=pause.release;const pending=a.enforcement.admit(seed.apiKey,app.tenantId);await pause.entered;
    const revoked=await apiRequest(app.url,'/v1/api-keys/revocations',app.developerToken,{keyId:seed.record.keyId},app.tenantId);expect(revoked.status).toBe(200);
    pause.release();expect((await pending as {code:string}).code).toBe('E-07');
    expect((await b.enforcement.admit(seed.apiKey,app.tenantId) as {code:string}).code).toBe('E-10');b.controls.partitioned=false;
    for(const g of [a,b]){expect((await g.enforcement.admit(seed.apiKey,app.tenantId) as {code:string}).code).toBe('E-07');expect(g.cacheSize()).toBe(1);}
  }finally{release();db.close();await a.close();await b.close();await app.close();}
});
test('a real D before R delivered late serves only its original pending operation once',async()=>{
  const clock=manualClock();const app=await startAcceptanceApp({clock});const seed=sampleKeyRecord();const db=new DatabaseSync(app.databasePath);insertSeed(db,seed.record);const a=await startGatewayServer(app,{clock});const b=await startGatewayServer(app,{clock});const started=deferred();const release=deferred();
  try{
    for(const g of [a,b])expect((await g.enforcement.admit(seed.apiKey,app.tenantId)).ok).toBe(true);
    a.controls.afterResponse=async reply=>{expect(reply.status).toBe(200);started.resolve();await release.promise;};
    const original=a.enforcement.begin(seed.apiKey,app.tenantId);await started.promise;
    const revoked=await apiRequest(app.url,'/v1/api-keys/revocations',app.developerToken,{keyId:seed.record.keyId},app.tenantId);expect(revoked.status).toBe(200);
    release.resolve();await original.ready;expect(original.consume().ok).toBe(true);expect(original.consume().ok).toBe(false);
    a.controls.afterResponse=undefined;for(const g of [a,b])expect((await g.enforcement.admit(seed.apiKey,app.tenantId) as {code:string}).code).toBe('E-07');
  }finally{release.resolve();db.close();await a.close();await b.close();await app.close();}
});
test('an expired queued revoke cannot enter a late transaction or change either warm gateway admission',async()=>{
  const clock=manualClock();const gate=new ControlledGate();const app=await startAcceptanceApp({clock,decisionGate:gate});const seed=sampleKeyRecord();const db=new DatabaseSync(app.databasePath);insertSeed(db,seed.record);const gateways=[await startGatewayServer(app,{clock}),await startGatewayServer(app,{clock})];let release=()=>{};
  try{
    for(const g of gateways)expect((await g.enforcement.admit(seed.apiKey,app.tenantId)).ok).toBe(true);
    const pause=gate.arm();release=pause.release;const pending=apiRequest(app.url,'/v1/api-keys/revocations',app.developerToken,{keyId:seed.record.keyId},app.tenantId);
    const first=await Promise.race([pause.entered.then(()=>'queued'),pending.then(()=>'response')]);expect(first).toBe('queued');clock.advance(2000,false);pause.release();
    const response=await pending;expect(response.status).toBe(503);expect(response.body.error.code).toBe('E-09');expect(db.prepare('SELECT status FROM api_keys WHERE keyId=?').get(seed.record.keyId)?.status).toBe('active');
    expect(db.prepare("SELECT count(*) AS n FROM security_attempts WHERE operation='revoke'").get()?.n).toBe(1);
    for(const g of gateways)expect((await g.enforcement.admit(seed.apiKey,app.tenantId)).ok).toBe(true);
  }finally{release();db.close();for(const g of gateways)await g.close();await app.close();}
});
