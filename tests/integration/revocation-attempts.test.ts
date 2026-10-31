import { expect,test } from '@jest/globals';
import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { ManagementAttempts,type ManagedAttempt } from '../../src/services/management-attempt';
import { RevocationService } from '../../src/services/revocation';
import { SqliteRevocationRepository } from '../../src/adapters/sqlite/revocation-repository';
import { SqliteUnitOfWork } from '../../src/adapters/sqlite/unit-of-work';
import { DecisionGate } from '../../src/services/decision-gate';
import { databaseFixture } from '../support/database-fixture';
import { sampleKeyRecord,insertSeed } from '../support/key-record-fixtures';
import { requestFixture } from '../support/identity-fixtures';
const scope={principal:{kind:'developer',subjectId:'developer-colleague',trustedService:false},tenantId:'tenant-a'} as const;
test('actual committed revoke and repeat audit truthful success independently of response expiry/cancellation',async()=>{
  for(const mode of ['normal','expiry','cancel'] as const){
    const db=databaseFixture();const seed=sampleKeyRecord();insertSeed(db.connection,seed.record);const f=requestFixture(2000);const receipt:ManagedAttempt={value:db.attempt('revoke')};const audit=new ManagementAttempts(db.events,randomUUID,()=>{});const work=new SqliteUnitOfWork(db.connection);
    const controlled={run<T>(callback:()=>T){const result=work.run(callback);if(mode==='expiry')f.clock.advance(2000,false);if(mode==='cancel')f.controller.abort();return result;}};
    try{
      const service=new RevocationService(new SqliteRevocationRepository(db.connection),controlled,new DecisionGate(),audit);
      const result=await service.revoke(scope,seed.record.keyId,receipt.value.attemptId,f.context,receipt);expect(result.ok).toBe(mode==='normal');
      const event=db.connection.prepare('SELECT outcome,finalized,keyId FROM security_attempts WHERE attemptId=?').get(receipt.value.attemptId);expect(event?.outcome).toBe('succeeded');expect(event?.finalized).toBe(1);expect(event?.keyId===seed.record.keyId).toBe(true);
      const original=db.connection.prepare('SELECT revokedAt,revocationAttemptId,generation FROM api_keys WHERE keyId=?').get(seed.record.keyId);
      audit.complete(receipt,mode==='normal'?null:'E-09',f.context);expect(db.connection.prepare('SELECT outcome FROM security_attempts WHERE attemptId=?').get(receipt.value.attemptId)?.outcome).toBe('succeeded');
      const repeat:ManagedAttempt={value:db.attempt('revoke')};const repeated=await new RevocationService(new SqliteRevocationRepository(db.connection),work,new DecisionGate(),audit).revoke(scope,seed.record.keyId,repeat.value.attemptId,requestFixture(2000).context,repeat);expect(repeated.ok).toBe(true);
      expect(db.connection.prepare('SELECT revokedAt,revocationAttemptId,generation FROM api_keys WHERE keyId=?').get(seed.record.keyId)).toEqual(original);
    }finally{db.cleanup();}
  }
});
test('actual commit followed by lost acknowledgment and media closure leaves terminal state, never a retry or false response',async()=>{
  const db=databaseFixture();const seed=sampleKeyRecord();insertSeed(db.connection,seed.record);let entries=0;let emergencies=0;const f=requestFixture(2000);const receipt:ManagedAttempt={value:db.attempt('revoke')};const audit=new ManagementAttempts(db.events,randomUUID,()=>{emergencies++;});const work=new SqliteUnitOfWork(db.connection);
  const lost={run<T>(callback:()=>T){return work.run<T>(()=>{entries++;callback();db.connection.exec('COMMIT');db.close();throw new Error('lost acknowledgment');});}};
  try{
    const r=await new RevocationService(new SqliteRevocationRepository(db.connection),lost,new DecisionGate(),audit).revoke(scope,seed.record.keyId,receipt.value.attemptId,f.context,receipt);expect(r.ok?'SUCCESS':r.code).toBe('E-09');expect(entries).toBe(1);expect(audit.complete(receipt,'E-09',f.context)).toBe(false);expect(emergencies).toBe(1);
    const observer=new DatabaseSync(db.path,{readOnly:true});try{expect(observer.prepare('SELECT status FROM api_keys WHERE keyId=?').get(seed.record.keyId)?.status).toBe('revoked');expect(observer.prepare('SELECT outcome FROM security_attempts WHERE attemptId=?').get(receipt.value.attemptId)?.outcome).toBe('succeeded');}finally{observer.close();}
  }finally{db.cleanup();}
});
test('audit correlation mismatches cannot mutate a key or finalize an unrelated receipt',async()=>{
  const db=databaseFixture();const seed=sampleKeyRecord();insertSeed(db.connection,seed.record);const receipt:ManagedAttempt={value:db.attempt('create')};const audit=new ManagementAttempts(db.events,randomUUID,()=>{});
  try{
    const r=await new RevocationService(new SqliteRevocationRepository(db.connection),new SqliteUnitOfWork(db.connection),new DecisionGate(),audit).revoke(scope,seed.record.keyId,db.attempt('revoke').attemptId,requestFixture(2000).context,receipt);expect(r.ok?'SUCCESS':r.code).toBe('E-09');
    expect(db.connection.prepare('SELECT status FROM api_keys WHERE keyId=?').get(seed.record.keyId)?.status).toBe('active');
  }finally{db.cleanup();}
});
