import { expect,test } from '@jest/globals';
import { randomUUID } from 'node:crypto';
import { ValidationService } from '../../src/services/validation';
import { SqliteValidationRepository } from '../../src/adapters/sqlite/validation-repository';
import { NodeKeyCryptography } from '../../src/adapters/crypto/node-key-crypto';
import { DecisionGate } from '../../src/services/decision-gate';
import type { RequestContext } from '../../src/domain/request-context';
import { databaseFixture } from '../support/database-fixture';
import { sampleKeyRecord,insertSeed } from '../support/key-record-fixtures';
import { requestFixture } from '../support/identity-fixtures';
const scope={principal:{kind:'service',subjectId:'platform-service',trustedService:true},tenantId:'tenant-a'} as const;
test('all salted same-prefix candidates are evaluated using their own material before a bound final decision',async()=>{
  const db=databaseFixture();const a=sampleKeyRecord();const b=sampleKeyRecord(a.record.prefix);insertSeed(db.connection,a.record);insertSeed(db.connection,b.record);
  try{
    const service=new ValidationService(new SqliteValidationRepository(db.connection),new NodeKeyCryptography(),new DecisionGate(),randomUUID);
    const requestId=randomUUID();const result=await service.validate(scope,b.apiKey,requestId,requestFixture().context);expect(result.ok).toBe(true);
    if(result.ok){expect(result.value.keyId===b.record.keyId&&result.value.requestId===requestId).toBe(true);expect(JSON.stringify(result.value).includes(b.apiKey)).toBe(false);}
    for(const apiKey of [a.record.prefix,'malformed',sampleKeyRecord(a.record.prefix).apiKey]){const r=await service.validate(scope,apiKey,randomUUID(),requestFixture().context);expect(r.ok?'SUCCESS':r.code).toBe('E-07');}
  }finally{db.cleanup();}
});
test('a real revoke between hashing and the final authority gate defeats the earlier active candidate',async()=>{
  const db=databaseFixture();const seed=sampleKeyRecord();insertSeed(db.connection,seed.record);
  class BeforeDecision extends DecisionGate{override run<T>(context:RequestContext,operation:()=>T){
    const attempt=db.attempt('revoke');db.connection.prepare("UPDATE api_keys SET status='revoked',generation=2,revokedAt=?,revocationAttemptId=? WHERE keyId=?").run(new Date().toISOString(),attempt.attemptId,seed.record.keyId);
    return super.run(context,operation);
  }}
  try{const service=new ValidationService(new SqliteValidationRepository(db.connection),new NodeKeyCryptography(),new BeforeDecision(),randomUUID);
    const r=await service.validate(scope,seed.apiKey,randomUUID(),requestFixture().context);expect(r.ok?'SUCCESS':r.code).toBe('E-07');
  }finally{db.cleanup();}
});
test('final decisions check just-before and exact authority deadline and deny cancelled requests without retry',async()=>{
  for(const elapsed of [199,200]){
    const db=databaseFixture();const seed=sampleKeyRecord();insertSeed(db.connection,seed.record);const f=requestFixture();
    class BeforeDecision extends DecisionGate{override run<T>(context:RequestContext,operation:()=>T){f.clock.advance(elapsed,false);return super.run(context,operation);}}
    try{const service=new ValidationService(new SqliteValidationRepository(db.connection),new NodeKeyCryptography(),new BeforeDecision(),randomUUID);
      const r=await service.validate(scope,seed.apiKey,randomUUID(),f.context);expect(r.ok).toBe(elapsed===199);
      if(!r.ok)expect(r.code).toBe('E-10');
      const cancelled=requestFixture();cancelled.controller.abort();expect((await service.validate(scope,seed.apiKey,randomUUID(),cancelled.context)).ok).toBe(false);
    }finally{db.cleanup();}
  }
});
test('unknown keys, corrupt verification material, unavailable repositories and missing key remain distinct',async()=>{
  const db=databaseFixture();const seed=sampleKeyRecord();try{
    const repo=new SqliteValidationRepository(db.connection);const crypto=new NodeKeyCryptography();const gate=new DecisionGate();const service=new ValidationService(repo,crypto,gate,randomUUID);
    const missing=await service.validate(scope,'',randomUUID(),requestFixture().context);expect(missing.ok?'SUCCESS':missing.code).toBe('E-06');
    const unknown=await service.validate(scope,seed.apiKey,randomUUID(),requestFixture().context);expect(unknown.ok?'SUCCESS':unknown.code).toBe('E-07');
    db.connection.exec('PRAGMA ignore_check_constraints=ON');insertSeed(db.connection,{...seed.record,salt:Buffer.alloc(0)});db.connection.exec('PRAGMA ignore_check_constraints=OFF');
    expect((await service.validate(scope,seed.apiKey,randomUUID(),requestFixture().context) as {code:string}).code).toBe('E-10');
    db.close();expect((await service.validate(scope,seed.apiKey,randomUUID(),requestFixture().context) as {code:string}).code).toBe('E-10');
  }finally{db.cleanup();}
});
test('service defense rejects wrong roles, ambiguous full secrets, crypto faults and malformed decision identifiers',async()=>{
  const db=databaseFixture();const seed=sampleKeyRecord();insertSeed(db.connection,seed.record);const repo=new SqliteValidationRepository(db.connection);const crypto=new NodeKeyCryptography();
  try{
    const service=new ValidationService(repo,crypto,new DecisionGate(),randomUUID);
    for(const principal of [{kind:'developer',subjectId:'developer-a',trustedService:false},{kind:'service',subjectId:'service',trustedService:false}] as const)expect((await service.validate({...scope,principal},seed.apiKey,randomUUID(),requestFixture().context) as {code:string}).code).toBe('E-16');
    class CryptoFault extends NodeKeyCryptography{override verify(){return {ok:false as const,code:'UNAVAILABLE'};}}
    expect((await new ValidationService(repo,new CryptoFault(),new DecisionGate(),randomUUID).validate(scope,seed.apiKey,randomUUID(),requestFixture().context) as {code:string}).code).toBe('E-10');
    expect((await new ValidationService(repo,crypto,new DecisionGate(),()=> 'invalid').validate(scope,seed.apiKey,randomUUID(),requestFixture().context) as {code:string}).code).toBe('E-10');
    class ReadFault extends SqliteValidationRepository{override candidates():never{throw new Error('storage fault');}}
    expect((await new ValidationService(new ReadFault(db.connection),crypto,new DecisionGate(),randomUUID).validate(scope,seed.apiKey,randomUUID(),requestFixture().context) as {code:string}).code).toBe('E-10');
    insertSeed(db.connection,{...seed.record,keyId:randomUUID(),creationAttemptId:randomUUID()});
    expect((await service.validate(scope,seed.apiKey,randomUUID(),requestFixture().context) as {code:string}).code).toBe('E-10');
  }finally{db.cleanup();}
});
test('a final authoritative read outage cannot reuse the matching active candidate',async()=>{
  const db=databaseFixture();const seed=sampleKeyRecord();insertSeed(db.connection,seed.record);
  class BeforeDecision extends DecisionGate{override run<T>(context:RequestContext,operation:()=>T){db.close();return super.run(context,operation);}}
  try{const result=await new ValidationService(new SqliteValidationRepository(db.connection),new NodeKeyCryptography(),new BeforeDecision(),randomUUID).validate(scope,seed.apiKey,randomUUID(),requestFixture().context);expect(result.ok?'SUCCESS':result.code).toBe('E-10');}
  finally{db.cleanup();}
});
