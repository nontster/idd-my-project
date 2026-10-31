import { expect,test } from '@jest/globals';
import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { startAcceptanceApp,apiRequest } from '../support/acceptance-app';
import { sampleKeyRecord,insertSeed } from '../support/key-record-fixtures';
test('mutation and validation request schemas reject additional properties before business work',async()=>{
  const app=await startAcceptanceApp();const seed=sampleKeyRecord();const observer=new DatabaseSync(app.databasePath);insertSeed(observer,seed.record);
  try{
    const revoke=await apiRequest(app.url,'/v1/api-keys/revocations',app.developerToken,{keyId:seed.record.keyId,force:true},app.tenantId);expect(revoke.status).toBe(400);expect(revoke.body.error.code).toBe('REQUEST_INVALID');expect(observer.prepare('SELECT status FROM api_keys WHERE keyId=?').get(seed.record.keyId)?.status).toBe('active');
  }finally{observer.close();await app.close();}
});
test('validation request rejects additional fields after key-presence precedence',async()=>{
  const app=await startAcceptanceApp();const seed=sampleKeyRecord();const observer=new DatabaseSync(app.databasePath);insertSeed(observer,seed.record);
  try{
    const validate=await apiRequest(app.url,'/v1/api-keys/validations',app.serviceToken,{apiKey:seed.apiKey,expectedTenantId:app.tenantId,requestId:randomUUID(),role:'developer'});expect(validate.status).toBe(400);expect(validate.body.error.code).toBe('REQUEST_INVALID');
    for(const apiKey of [undefined,null,'']){const r=await apiRequest(app.url,'/v1/api-keys/validations',app.serviceToken,{apiKey,role:'developer'});expect(r.status).toBe(400);expect(r.body.error.code).toBe('E-06');}
  }finally{observer.close();await app.close();}
});
test('the bodyless defensive reactivation path needs no JSON payload or Content-Type',async()=>{
  const app=await startAcceptanceApp();const seed=sampleKeyRecord();const observer=new DatabaseSync(app.databasePath);insertSeed(observer,{...seed.record,status:'revoked',generation:2,revokedAt:new Date().toISOString(),revocationAttemptId:randomUUID()});
  try{const r=await fetch(app.url+`/v1/api-keys/${seed.record.keyId}/reactivate`,{method:'POST',headers:{authorization:`Bearer ${app.developerToken}`,'x-tenant-id':app.tenantId}});expect(r.status).toBe(409);expect((await r.json() as {error:{code:string}}).error.code).toBe('E-13');}
  finally{observer.close();await app.close();}
});
