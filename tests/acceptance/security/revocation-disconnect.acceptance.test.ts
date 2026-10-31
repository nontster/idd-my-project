import { expect,test } from '@jest/globals';
import { request as httpRequest,type ClientRequest } from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { startAcceptanceApp,apiRequest } from '../../support/acceptance-app';
import { startGatewayServer } from '../../support/gateway-servers';
import { sampleKeyRecord,insertSeed } from '../../support/key-record-fixtures';
import { manualClock,deferred } from '../../support/identity-fixtures';
import { ControlledGate } from '../../support/controlled-gate';
test('premature disconnect of a queued revoke cancels its waiter, records failure, and never starts a late mutation',async()=>{
  const clock=manualClock();const gate=new ControlledGate();const app=await startAcceptanceApp({clock,decisionGate:gate});const seed=sampleKeyRecord();const db=new DatabaseSync(app.databasePath);insertSeed(db,seed.record);const gateways=[await startGatewayServer(app,{clock}),await startGatewayServer(app,{clock})];let release=()=>{};let client:ClientRequest|undefined;
  try{
    for(const g of gateways)expect((await g.enforcement.admit(seed.apiKey,app.tenantId)).ok).toBe(true);
    const pause=gate.arm();release=pause.release;let responseStatus=0;const closed=deferred();
    client=httpRequest(app.url+'/v1/api-keys/revocations',{method:'POST',headers:{authorization:`Bearer ${app.developerToken}`,'x-tenant-id':app.tenantId,'content-type':'application/json'}},response=>{responseStatus=response.statusCode!;response.resume();closed.resolve();});client.on('error',closed.resolve);client.end(JSON.stringify({keyId:seed.record.keyId}));
    await pause.entered;const cancelled=new Promise<void>(done=>pause.context!.signal.addEventListener('abort',()=>done(),{once:true}));client.destroy();await cancelled;await closed.promise;await new Promise<void>(done=>setImmediate(done));
    pause.release();await new Promise<void>(done=>setImmediate(done));expect(responseStatus).toBe(0);expect(db.prepare('SELECT status FROM api_keys WHERE keyId=?').get(seed.record.keyId)?.status).toBe('active');
    const rows=db.prepare("SELECT outcome,errorCode FROM security_attempts WHERE operation='revoke'").all();expect(rows.length).toBe(1);expect(rows[0].outcome).toBe('failed');expect(rows[0].errorCode).toBe('E-09');
    for(const g of gateways)expect((await g.enforcement.admit(seed.apiKey,app.tenantId)).ok).toBe(true);
  }finally{release();client?.destroy();db.close();for(const g of gateways)await g.close();await app.close();}
});
test('socket loss immediately after actual R cannot undo revocation or its audit and both warm gateways deny',async()=>{
  const manual=manualClock();const seed=sampleKeyRecord();let observer:DatabaseSync|undefined;let client:ClientRequest|undefined;let disconnected=false;
  const clock={...manual,monotonicNow(){if(observer&&client&&!disconnected&&observer.prepare('SELECT status FROM api_keys WHERE keyId=?').get(seed.record.keyId)?.status==='revoked'){disconnected=true;client.destroy();}return manual.monotonicNow();}};
  const app=await startAcceptanceApp({clock});observer=new DatabaseSync(app.databasePath);insertSeed(observer,seed.record);const gateways=[await startGatewayServer(app,{clock}),await startGatewayServer(app,{clock})];
  try{
    for(const g of gateways)expect((await g.enforcement.admit(seed.apiKey,app.tenantId)).ok).toBe(true);
    let responseStatus=0;const closed=deferred();client=httpRequest(app.url+'/v1/api-keys/revocations',{method:'POST',headers:{authorization:`Bearer ${app.developerToken}`,'x-tenant-id':app.tenantId,'content-type':'application/json'}},response=>{responseStatus=response.statusCode!;response.resume();closed.resolve();});client.on('error',closed.resolve);client.end(JSON.stringify({keyId:seed.record.keyId}));await closed.promise;
    expect(disconnected).toBe(true);expect(responseStatus).toBe(0);expect(observer.prepare('SELECT generation FROM api_keys WHERE keyId=?').get(seed.record.keyId)?.generation).toBe(2);
    expect(observer.prepare("SELECT outcome FROM security_attempts WHERE operation='revoke'").get()?.outcome).toBe('succeeded');
    for(const g of gateways)expect((await g.enforcement.admit(seed.apiKey,app.tenantId) as {code:string}).code).toBe('E-07');
    const repeat=await apiRequest(app.url,'/v1/api-keys/revocations',app.developerToken,{keyId:seed.record.keyId},app.tenantId);expect(repeat.status).toBe(200);
  }finally{client?.destroy();observer.close();observer=undefined;for(const g of gateways)await g.close();await app.close();}
});
