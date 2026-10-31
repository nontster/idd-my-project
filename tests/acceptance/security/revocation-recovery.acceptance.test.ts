import { expect,test } from '@jest/globals';
import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { copyFileSync } from 'node:fs';
import { join } from 'node:path';
import { databaseFixture } from '../../support/database-fixture';
import { sampleKeyRecord,insertSeed } from '../../support/key-record-fixtures';
import { authorityChild } from '../../support/authority-child';
import { startAcceptanceApp,apiRequest } from '../../support/acceptance-app';
import { SqliteCreationRepository } from '../../../src/adapters/sqlite/creation-repository';
test.each(['confirmed','before-reply'] as const)('real process crash after revoke %s cannot restore active access on restart',async mode=>{
  const db=databaseFixture();const seed=sampleKeyRecord();insertSeed(db.connection,seed.record);db.close();let child=await authorityChild(db.path,mode==='before-reply'?seed.record.keyId:undefined);
  try{
    const baseline=await apiRequest(child.url,'/v1/api-keys/validations',child.serviceToken,{apiKey:seed.apiKey,expectedTenantId:'tenant-a',requestId:randomUUID()});expect(baseline.status).toBe(200);
    let status=0;try{status=(await apiRequest(child.url,'/v1/api-keys/revocations',child.developerToken,{keyId:seed.record.keyId},'tenant-a')).status;}catch{/* abrupt socket loss is expected only after actual R */}
    expect(status).toBe(mode==='confirmed'?200:0);await child.stop();
    const observer=new DatabaseSync(db.path,{readOnly:true});const original=observer.prepare('SELECT status,generation,revokedAt,revocationAttemptId FROM api_keys WHERE keyId=?').get(seed.record.keyId);observer.close();expect(original?.status).toBe('revoked');
    child=await authorityChild(db.path);
    const denied=await apiRequest(child.url,'/v1/api-keys/validations',child.serviceToken,{apiKey:seed.apiKey,expectedTenantId:'tenant-a',requestId:randomUUID()});expect(denied.status).toBe(403);expect(denied.body.error.code).toBe('E-07');
    const repeat=await apiRequest(child.url,'/v1/api-keys/revocations',child.developerToken,{keyId:seed.record.keyId},'tenant-a');expect(repeat.status).toBe(200);expect(repeat.body.revokedAt).toBe(original?.revokedAt);
  }finally{await child.stop();db.cleanup();}
},15000);
test('startup reconciles a real interrupted terminal mutation attempt before readiness',async()=>{
  const db=databaseFixture();const seed=sampleKeyRecord();insertSeed(db.connection,seed.record);const attempt=db.attempt('revoke');
  db.connection.prepare("UPDATE api_keys SET status='revoked',generation=2,revokedAt=?,revocationAttemptId=? WHERE keyId=?").run(new Date().toISOString(),attempt.attemptId,seed.record.keyId);db.close();
  const app=await startAcceptanceApp({databasePath:db.path,initializeFreshStore:false});
  try{const health=await fetch(app.url+'/health/ready');expect(health.status).toBe(200);
    const observer=new DatabaseSync(db.path,{readOnly:true});try{const row=observer.prepare('SELECT outcome,finalized,keyId FROM security_attempts WHERE attemptId=?').get(attempt.attemptId);expect(row?.outcome).toBe('succeeded');expect(row?.finalized).toBe(1);expect(row?.keyId===seed.record.keyId).toBe(true);}finally{observer.close();}
  }finally{await app.close();db.cleanup();}
});
test('an explicitly identified old backup is refused rather than serving its active record',async()=>{
  const db=databaseFixture();const seed=sampleKeyRecord();insertSeed(db.connection,seed.record);db.close();const backup=join(db.path,'..','old.sqlite');copyFileSync(db.path,backup);
  let code='NO_FAILURE';let app:Awaited<ReturnType<typeof startAcceptanceApp>>|undefined;
  try{try{app=await startAcceptanceApp({databasePath:backup,initializeFreshStore:false,restoredFromBackup:true});}catch(error){code=(error as {code:string}).code;}
    expect(code).toBe('RECOVERY_UNSAFE');
  }finally{if(app)await app.close();db.cleanup();}
});
test('orphaned attempts fail safely while a correlated committed creation recovers succeeded without any secret recovery',async()=>{
  const db=databaseFixture();const orphan=db.attempt('create');const known=db.attempt('create');const seed=sampleKeyRecord();new SqliteCreationRepository(db.connection).insert({...seed.record,creationAttemptId:known.attemptId});db.close();
  const app=await startAcceptanceApp({databasePath:db.path,initializeFreshStore:false});
  try{const observer=new DatabaseSync(db.path,{readOnly:true});try{
    expect(observer.prepare('SELECT outcome,errorCode FROM security_attempts WHERE attemptId=?').get(orphan.attemptId)?.outcome).toBe('failed');
    expect(observer.prepare('SELECT outcome,keyId FROM security_attempts WHERE attemptId=?').get(known.attemptId)?.outcome).toBe('succeeded');
    expect(JSON.stringify(observer.prepare('SELECT * FROM security_attempts').all()).includes(seed.apiKey)).toBe(false);
  }finally{observer.close();}}
  finally{await app.close();db.cleanup();}
});
test('domain-corrupt retained rows and mismatched operation correlations cannot become a ready authority',async()=>{
  for(const mode of ['uuid','operation'] as const){
    const db=databaseFixture();const seed=sampleKeyRecord();
    if(mode==='uuid')insertSeed(db.connection,{...seed.record,keyId:'z'.repeat(36)});
    else new SqliteCreationRepository(db.connection).insert({...seed.record,creationAttemptId:db.attempt('revoke').attemptId});
    db.close();let code='NO_FAILURE';let app:Awaited<ReturnType<typeof startAcceptanceApp>>|undefined;
    try{try{app=await startAcceptanceApp({databasePath:db.path,initializeFreshStore:false});}catch(error){code=(error as {code:string}).code;}expect(['STORE_UNAVAILABLE','RECOVERY_UNSAFE'].includes(code)).toBe(true);}
    finally{if(app)await app.close();db.cleanup();}
  }
});
