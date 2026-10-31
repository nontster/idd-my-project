import { expect,test } from '@jest/globals';
import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { startAcceptanceApp,apiRequest } from '../../support/acceptance-app';
import { startGatewayServer } from '../../support/gateway-servers';
import { sampleKeyRecord,insertSeed } from '../../support/key-record-fixtures';
import { deferred,manualClock,requestFixture } from '../../support/identity-fixtures';
import { createIdentityFixtures } from '../../support/identity-fixtures';
import { GatewayEnforcement,type AuthorityReply } from '../../../src/gateway/enforcement';
test('two independent HTTP gateways first verify real authority success then populate only advisory metadata and call online every time',async()=>{
  const app=await startAcceptanceApp();const seed=sampleKeyRecord();const db=new DatabaseSync(app.databasePath);insertSeed(db,seed.record);db.close();const gateways=[];
  try{
    const baseline=await apiRequest(app.url,'/v1/api-keys/validations',app.serviceToken,{apiKey:seed.apiKey,expectedTenantId:app.tenantId,requestId:randomUUID()});expect(baseline.status).toBe(200);
    gateways.push(await startGatewayServer(app),await startGatewayServer(app));
    for(const gateway of gateways){
      for(let attempt=0;attempt<2;attempt++){
        const r=await apiRequest(gateway.url,'/admit',app.serviceToken,{apiKey:seed.apiKey,expectedTenantId:app.tenantId});expect(r.status).toBe(200);expect(JSON.stringify(r.body).includes(seed.apiKey)).toBe(false);
      }
      expect(gateway.cacheSize()).toBe(1);expect(gateway.controls.calls).toBe(2);expect(new Set(gateway.controls.requestIds).size).toBe(2);
      expect(JSON.stringify(gateway.enforcement.cacheEntries()).includes(seed.apiKey)).toBe(false);
      expect(Object.keys(gateway.enforcement.cacheEntries()[0]).sort()).toEqual(['generation','keyId','status','tenantId']);
      gateway.controls.partitioned=true;const isolated=await apiRequest(gateway.url,'/admit',app.serviceToken,{apiKey:seed.apiKey,expectedTenantId:app.tenantId});expect(isolated.status).toBe(503);expect(isolated.body.error.code).toBe('E-10');expect(gateway.cacheSize()).toBe(1);
    }
  }finally{for(const gateway of gateways)await gateway.close();await app.close();}
});
test('a real positive decision may be consumed once and an old positive cannot authorize another operation',async()=>{
  const app=await startAcceptanceApp();const seed=sampleKeyRecord();const db=new DatabaseSync(app.databasePath);insertSeed(db,seed.record);db.close();const gateway=await startGatewayServer(app);
  try{
    const operation=gateway.enforcement.begin(seed.apiKey,app.tenantId);await operation.ready;const first=operation.consume();expect(first.ok).toBe(true);
    expect(operation.consume().ok).toBe(false);if(!first.ok)return;
    gateway.controls.transform=reply=>({...reply,body:first.value});
    const replay=await gateway.enforcement.admit(seed.apiKey,app.tenantId);expect(replay.ok?'SUCCESS':replay.code).toBe('E-10');expect(gateway.controls.calls).toBe(2);
  }finally{await gateway.close();await app.close();}
});
test.each([499,500])('the gateway checks exact elapsed outbound budget after the complete real response',async elapsed=>{
  const app=await startAcceptanceApp();const seed=sampleKeyRecord();const db=new DatabaseSync(app.databasePath);insertSeed(db,seed.record);db.close();const clock=manualClock();const gateway=await startGatewayServer(app,{clock});
  const started=deferred();const release=deferred();gateway.controls.afterResponse=async()=>{started.resolve();await release.promise;};
  try{
    const pending=gateway.enforcement.admit(seed.apiKey,app.tenantId);
    const first=await Promise.race([started.promise.then(()=>'response'),pending.then(()=>'result')]);expect(first).toBe('response');clock.advance(elapsed,false);release.resolve();
    const result=await pending;expect(result.ok).toBe(elapsed===499);if(!result.ok)expect(result.code).toBe('E-10');expect(gateway.controls.calls).toBe(1);
  }finally{release.resolve();await gateway.close();await app.close();}
});
test('timeout and earlier operation cancellation stop waiting and ignore a late real positive without retry',async()=>{
  for(const mode of ['timeout','cancel'] as const){
    const app=await startAcceptanceApp();const seed=sampleKeyRecord();const db=new DatabaseSync(app.databasePath);insertSeed(db,seed.record);db.close();const f=requestFixture(1000);const gateway=await startGatewayServer(app,{clock:f.clock});
    const started=deferred();const release=deferred();gateway.controls.afterResponse=async()=>{started.resolve();await release.promise;};
    try{
      const pending=gateway.enforcement.begin(seed.apiKey,app.tenantId,f.context);
      const first=await Promise.race([started.promise.then(()=>'response'),pending.ready.then(()=>'result')]);expect(first).toBe('response');
      if(mode==='timeout')f.clock.advance(500);else f.controller.abort();await pending.ready;
      expect((pending.consume() as {code:string}).code).toBe('E-10');release.resolve();await Promise.resolve();expect(pending.consume().ok).toBe(false);expect(gateway.controls.calls).toBe(1);
    }finally{release.resolve();await gateway.close();await app.close();}
  }
});
test('warm hints cannot replace revoked, unavailable, malformed or mismatched real authority responses',async()=>{
  const ids=createIdentityFixtures();const app=await startAcceptanceApp({},ids);const seed=sampleKeyRecord();const db=new DatabaseSync(app.databasePath);insertSeed(db,seed.record);const gateway=await startGatewayServer(app);
  try{
    expect((await gateway.enforcement.admit(seed.apiKey,app.tenantId)).ok).toBe(true);
    const transforms=[
      (_reply:AuthorityReply)=>null as unknown as AuthorityReply,
      (reply:AuthorityReply)=>({...reply,body:null}),
      (reply:AuthorityReply)=>({...reply,body:{...(reply.body as object),tenantId:'tenant-b'}}),
      (reply:AuthorityReply)=>({...reply,body:{...(reply.body as object),apiKey:seed.apiKey}}),
      (_reply:AuthorityReply)=>({status:403,body:null}),
      (_reply:AuthorityReply)=>({status:403,body:{code:'E-16'}}),
      (_reply:AuthorityReply)=>({status:403,body:{error:{code:'E-16'}}}),
    ];
    for(const transform of transforms){gateway.controls.transform=transform;const r=await gateway.enforcement.admit(seed.apiKey,app.tenantId);expect(r.ok?'SUCCESS':r.code).toBe('E-10');expect(gateway.cacheSize()).toBe(1);}
    gateway.controls.transform=undefined;ids.unavailable=true;expect((await gateway.enforcement.admit(seed.apiKey,app.tenantId) as {code:string}).code).toBe('E-10');ids.unavailable=false;
    const attempt=randomUUID();db.prepare('INSERT INTO security_attempts (attemptId,operation,receivedAt,callerId,tenantId,keyId,outcome,finalized,errorCode,completedAt) VALUES (?,?,?,?,?,?,?,?,?,?)').run(attempt,'revoke',new Date().toISOString(),null,null,null,'unconfirmed',0,null,null);
    db.prepare("UPDATE api_keys SET status='revoked',generation=2,revokedAt=?,revocationAttemptId=? WHERE keyId=?").run(new Date().toISOString(),attempt,seed.record.keyId);
    expect((await gateway.enforcement.admit(seed.apiKey,app.tenantId) as {code:string}).code).toBe('E-07');expect(gateway.cacheSize()).toBe(1);
  }finally{db.close();await gateway.close();await app.close();}
});
test.each([99,100])('an earlier platform deadline clamps the outbound budget',async elapsed=>{
  const app=await startAcceptanceApp();const seed=sampleKeyRecord();const db=new DatabaseSync(app.databasePath);insertSeed(db,seed.record);db.close();const f=requestFixture(100);const gateway=await startGatewayServer(app,{clock:f.clock});const started=deferred();const release=deferred();
  gateway.controls.afterResponse=async()=>{started.resolve();await release.promise;};
  try{
    const pending=gateway.enforcement.admit(seed.apiKey,app.tenantId,f.context);await started.promise;f.clock.advance(elapsed,false);release.resolve();expect((await pending).ok).toBe(elapsed===99);expect(gateway.controls.calls).toBe(1);
  }finally{release.resolve();await gateway.close();await app.close();}
});
test('invalid gateway composition, pre-cancelled operations and pre-consumption deny before outbound work',async()=>{
  const f=requestFixture();let calls=0;const client={async validate():Promise<AuthorityReply>{calls++;throw new Error('offline');}};
  for(const timeout of [0,-1,0.5,Infinity,Number.NaN])expect(()=>new GatewayEnforcement(client,f.clock,randomUUID,timeout)).toThrow('Invalid gateway deadline');
  f.controller.abort();const gateway=new GatewayEnforcement(client,f.clock,randomUUID);
  expect((await gateway.admit('transient','tenant-a',f.context)).ok).toBe(false);expect(calls).toBe(0);
  expect((await new GatewayEnforcement(client,f.clock,()=> 'invalid').admit('transient','tenant-a')).ok).toBe(false);expect(calls).toBe(0);
  expect((await new GatewayEnforcement(client,{...f.clock,monotonicNow:()=>{throw new Error('clock unavailable');}},randomUUID).admit('transient','tenant-a')).ok).toBe(false);expect(calls).toBe(0);
  const pending=gateway.begin('transient','tenant-a');expect(pending.consume().ok).toBe(false);await pending.ready;expect(pending.consume().ok).toBe(false);expect(calls).toBe(1);
});
