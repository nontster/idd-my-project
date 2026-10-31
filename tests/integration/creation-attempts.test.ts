import { expect,test } from '@jest/globals';
import { randomUUID } from 'node:crypto';
import { ManagementAttempts,type ManagedAttempt } from '../../src/services/management-attempt';
import { CreationService } from '../../src/services/creation';
import { SqliteCreationRepository } from '../../src/adapters/sqlite/creation-repository';
import { SqliteUnitOfWork } from '../../src/adapters/sqlite/unit-of-work';
import { NodeKeyCryptography } from '../../src/adapters/crypto/node-key-crypto';
import { DecisionGate } from '../../src/services/decision-gate';
import { databaseFixture } from '../support/database-fixture';
import { requestFixture } from '../support/identity-fixtures';
import { createIdentityFixtures } from '../support/identity-fixtures';
import { AuthenticationService } from '../../src/services/authentication';
import { RequestCoordinator } from '../../src/services/management-attempt';
const scope={principal:{kind:'developer',subjectId:'developer-a',trustedService:false},tenantId:'tenant-a'} as const;
test('a committed creation finalizes its correlated audit before acknowledgment, including expiry after commit',async()=>{
  for(const expire of [false,true]){
    const db=databaseFixture();const f=requestFixture(2000);const receipt:ManagedAttempt={value:db.attempt()};const audit=new ManagementAttempts(db.events,randomUUID,()=>{});
    const work=new SqliteUnitOfWork(db.connection);const wrapper={run<T>(callback:()=>T){const result=work.run(callback);if(expire)f.clock.advance(2000,false);return result;}};
    try{
      const service=new CreationService(new SqliteCreationRepository(db.connection),new NodeKeyCryptography(),wrapper,new DecisionGate(),randomUUID,audit);
      const result=await service.create(scope,receipt.value.attemptId,f.context,receipt);
      expect(result.ok).toBe(!expire);
      const row=db.connection.prepare('SELECT outcome,finalized,keyId FROM security_attempts WHERE attemptId=?').get(receipt.value.attemptId);
      expect(row?.outcome).toBe('succeeded');expect(row?.finalized).toBe(1);expect(typeof row?.keyId==='string').toBe(true);
      audit.complete(receipt,expire?'E-08':null,f.context);expect(db.connection.prepare('SELECT outcome FROM security_attempts WHERE attemptId=?').get(receipt.value.attemptId)?.outcome).toBe('succeeded');
    }finally{db.cleanup();}
  }
});
test('received rejected attempts keep explicit unknowns, and media loss emits safe emergency and refuses recording',()=>{
  const db=databaseFixture();let emergencies=0;const f=requestFixture(2000);const audit=new ManagementAttempts(db.events,randomUUID,()=>{emergencies++;});
  try{
    const began=audit.begin('create',f.context);expect(began.ok).toBe(true);if(!began.ok)return;
    expect(audit.complete(began.value,'E-01',f.context)).toBe(true);
    const row=db.connection.prepare('SELECT callerId,tenantId,keyId,outcome,errorCode FROM security_attempts WHERE attemptId=?').get(began.value.value.attemptId);
    expect(row?.callerId).toBe(null);expect(row?.tenantId).toBe(null);expect(row?.keyId).toBe(null);expect(row?.outcome).toBe('rejected');expect(row?.errorCode).toBe('E-01');
    db.close();expect(audit.begin('create',f.context).ok).toBe(false);expect(emergencies).toBe(1);
  }finally{db.cleanup();}
});
test('lost actual commit acknowledgment preserves durable success and refuses a secret-bearing response',async()=>{
  const db=databaseFixture();const f=requestFixture(2000);let emergencies=0;
  const audit=new ManagementAttempts(db.events,randomUUID,()=>{emergencies++;});const receipt:ManagedAttempt={value:db.attempt()};
  const work=new SqliteUnitOfWork(db.connection);let entries=0;
  const lost={run<T>(callback:()=>T){return work.run<T>(()=>{entries++;callback();db.connection.exec('COMMIT');throw new Error('lost acknowledgment');});}};
  try{
    const service=new CreationService(new SqliteCreationRepository(db.connection),new NodeKeyCryptography(),lost,new DecisionGate(),randomUUID,audit);
    const r=await service.create(scope,receipt.value.attemptId,f.context,receipt);expect(r.ok?'SUCCESS':r.code).toBe('E-08');expect(entries).toBe(1);
    expect(audit.complete(receipt,'E-08',f.context)).toBe(false);expect(emergencies).toBe(1);
    expect(db.connection.prepare('SELECT outcome FROM security_attempts WHERE attemptId=?').get(receipt.value.attemptId)?.outcome).toBe('succeeded');
    expect(db.connection.prepare('SELECT count(*) AS n FROM api_keys').get()?.n).toBe(1);
  }finally{db.cleanup();}
});
test('audit finalization failure rolls back an uncommitted creation, then records a truthful failure separately',async()=>{
  const db=databaseFixture();let fail=true;let emergencies=0;const f=requestFixture(2000);
  const events={begin:db.events.begin.bind(db.events),unfinished:db.events.unfinished.bind(db.events),finalize:(value:ManagedAttempt['value'])=>{if(fail){fail=false;return {ok:false as const,code:'UNAVAILABLE'};}return db.events.finalize(value);}};
  const audit=new ManagementAttempts(events,randomUUID,()=>{emergencies++;});const receipt:ManagedAttempt={value:db.attempt()};
  try{
    const service=new CreationService(new SqliteCreationRepository(db.connection),new NodeKeyCryptography(),new SqliteUnitOfWork(db.connection),new DecisionGate(),randomUUID,audit);
    expect((await service.create(scope,receipt.value.attemptId,f.context,receipt)).ok).toBe(false);
    expect(audit.complete(receipt,'E-08',f.context)).toBe(true);expect(db.connection.prepare('SELECT count(*) AS n FROM api_keys').get()?.n).toBe(0);
    expect(db.connection.prepare('SELECT outcome FROM security_attempts WHERE attemptId=?').get(receipt.value.attemptId)?.outcome).toBe('failed');
    const another=audit.begin('create',f.context);expect(another.ok).toBe(true);db.close();if(another.ok)expect(audit.complete(another.value,'E-08',f.context)).toBe(false);expect(emergencies).toBe(1);
  }finally{db.cleanup();}
});
test('unusable clocks and identifiers never fabricate receipt or outcome durability',()=>{
  const db=databaseFixture();const f=requestFixture(2000);let emergencies=0;
  const audit=new ManagementAttempts(db.events,()=>{throw new Error('identifier unavailable');},()=>{emergencies++;});
  try{
    expect(audit.begin('create',f.context).ok).toBe(false);
    const real=new ManagementAttempts(db.events,randomUUID,()=>{emergencies++;});const receipt:ManagedAttempt={value:db.attempt()};
    expect(real.complete(receipt,'E-08',{...f.context,clock:{...f.clock,utcNow:()=>{throw new Error('clock unavailable');}}})).toBe(false);expect(emergencies).toBe(2);
  }finally{db.cleanup();}
});
test('coordinator suppresses unavailable, expired, thrown and late management results',async()=>{
  const identities=createIdentityFixtures();const verifier={...identities.verifier,authorizeManagement:async()=>({kind:'unavailable'})};
  const coordinator=new RequestCoordinator(new AuthenticationService(verifier));
  const denied=await coordinator.preflight('create',identities.developerToken,'tenant-a',requestFixture(2000).context);expect(denied.ok?'SUCCESS':denied.code).toBe('E-08');
  const input={session:scope,body:{},context:requestFixture(2000).context};
  expect((await coordinator.execute('create',input)).ok).toBe(false);
  const expired=requestFixture(2000);expired.clock.advance(2000,false);
  expect((await coordinator.execute('create',{...input,context:expired.context})).ok).toBe(false);
  const throwing=new RequestCoordinator(new AuthenticationService(identities.verifier),{create:async()=>{throw new Error('operation unavailable');}});
  expect((await throwing.execute('create',input)).ok).toBe(false);
  const late=requestFixture(2000);const delayed=new RequestCoordinator(new AuthenticationService(identities.verifier),{create:async()=>{late.clock.advance(2000,false);return {ok:true,value:{}};}});
  expect((await delayed.execute('create',{...input,context:late.context})).ok).toBe(false);
});
test.each(['operation','identifier','finalized'] as const)('creation cannot correlate a new key with an invalid %s receipt',async mode=>{
    const db=databaseFixture();const f=requestFixture(2000);const correct=db.attempt(mode==='operation'?'revoke':'create');let value=mode==='identifier'?db.attempt('create'):correct;
    if(mode==='finalized')value={...value,finalized:true,outcome:'succeeded',completedAt:f.clock.utcNow()};
    const receipt:ManagedAttempt={value};const audit=new ManagementAttempts(db.events,randomUUID,()=>{});
    try{
      const service=new CreationService(new SqliteCreationRepository(db.connection),new NodeKeyCryptography(),new SqliteUnitOfWork(db.connection),new DecisionGate(),randomUUID,audit);
      const result=await service.create(scope,correct.attemptId,f.context,receipt);expect(result.ok?'SUCCESS':result.code).toBe('E-08');expect(db.connection.prepare('SELECT count(*) AS n FROM api_keys').get()?.n).toBe(0);
    }finally{db.cleanup();}
});
