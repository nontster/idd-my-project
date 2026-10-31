import { expect,test } from '@jest/globals';
import { randomUUID } from 'node:crypto';
import { CreationService } from '../../src/services/creation';
import { SqliteCreationRepository } from '../../src/adapters/sqlite/creation-repository';
import { SqliteUnitOfWork } from '../../src/adapters/sqlite/unit-of-work';
import { NodeKeyCryptography } from '../../src/adapters/crypto/node-key-crypto';
import { DecisionGate } from '../../src/services/decision-gate';
import { databaseFixture } from '../support/database-fixture';
import { sampleKeyRecord,insertSeed } from '../support/key-record-fixtures';
import { requestFixture } from '../support/identity-fixtures';
import { ManagementAttempts } from '../../src/services/management-attempt';
const scope={principal:{kind:'developer',subjectId:'developer-colleague',trustedService:false},tenantId:'tenant-a'} as const;
test('creation commits one hash-only record before delivering a new secret once',async()=>{
  const db=databaseFixture();try{const service=new CreationService(new SqliteCreationRepository(db.connection),new NodeKeyCryptography(),new SqliteUnitOfWork(db.connection),new DecisionGate(),randomUUID);
    const result=await service.create(scope,db.attempt().attemptId,requestFixture(2000).context);expect(result.ok).toBe(true);
    if(result.ok){expect(result.value.apiKey.length===52).toBe(true);expect(Object.keys(result.value).some(k=>['salt','keyHash','creationAttemptId'].includes(k))).toBe(false);}
    expect(db.connection.prepare('SELECT count(*) AS n FROM api_keys').get()?.n).toBe(1);
  }finally{db.cleanup();}
});
test('full secrets are never reused, including historical revoked foreign records, with eight bounded candidates',async()=>{
  const db=databaseFixture();const seed=sampleKeyRecord();insertSeed(db.connection,{...seed.record,tenantId:'tenant-b',status:'revoked',generation:2,revokedAt:new Date().toISOString(),revocationAttemptId:randomUUID()});let generated=0;
  const crypto=new NodeKeyCryptography();const repeated={...crypto,generate(){generated++;return {ok:true as const,value:{apiKey:seed.apiKey,prefix:seed.record.prefix,salt:seed.record.salt,keyHash:seed.record.keyHash}};},prefix:crypto.prefix.bind(crypto),hash:crypto.hash.bind(crypto),verify:crypto.verify.bind(crypto)};
  try{const service=new CreationService(new SqliteCreationRepository(db.connection),repeated,new SqliteUnitOfWork(db.connection),new DecisionGate(),randomUUID);
    const result=await service.create(scope,db.attempt().attemptId,requestFixture(2000).context);expect(result.ok?'SUCCESS':result.code).toBe('E-08');expect(generated).toBe(8);
    expect(db.connection.prepare('SELECT count(*) AS n FROM api_keys').get()?.n).toBe(1);
  }finally{db.cleanup();}
});
test('cancel before entry denies mutation; expiry after a real commit never acknowledges or replays the secret',async()=>{
  const db=databaseFixture();try{
    const repo=new SqliteCreationRepository(db.connection);const clock=requestFixture(2000);const work=new SqliteUnitOfWork(db.connection);let commits=0;
    const delayed={run<T>(operation:()=>T){const result=work.run(operation);commits++;clock.clock.advance(2000,false);return result;}};
    const service=new CreationService(repo,new NodeKeyCryptography(),delayed,new DecisionGate(),randomUUID);
    const result=await service.create(scope,db.attempt().attemptId,clock.context);expect(result.ok?'SUCCESS':result.code).toBe('E-08');expect(commits).toBe(1);
    expect(db.connection.prepare('SELECT count(*) AS n FROM api_keys').get()?.n).toBe(1);
    const cancelled=requestFixture(2000);cancelled.controller.abort();
    expect((await service.create(scope,db.attempt().attemptId,cancelled.context)).ok).toBe(false);expect(commits).toBe(1);
  }finally{db.cleanup();}
});
test('entropy, repository and uncertain commit failures cannot disclose a secret or replay a transaction',async()=>{
  const db=databaseFixture();try{
    const repo=new SqliteCreationRepository(db.connection);const crypto=new NodeKeyCryptography();
    const failures=[
      new CreationService(repo,new NodeKeyCryptography(()=>{throw new Error('entropy unavailable');}),new SqliteUnitOfWork(db.connection),new DecisionGate(),randomUUID),
      new CreationService({...repo,insert:repo.insert.bind(repo),retainedCandidates:()=>({ok:false as const,code:'UNAVAILABLE'})},crypto,new SqliteUnitOfWork(db.connection),new DecisionGate(),randomUUID),
      new CreationService(repo,crypto,{run:()=>({kind:'uncertain' as const})},new DecisionGate(),randomUUID),
    ];
    for(const service of failures){const result=await service.create(scope,db.attempt().attemptId,requestFixture(2000).context);
      expect(result.ok?'SUCCESS':result.code).toBe('E-08');expect(Object.keys(result).sort()).toEqual(['code','ok']);}
    expect(db.connection.prepare('SELECT count(*) AS n FROM api_keys').get()?.n).toBe(0);
  }finally{db.cleanup();}
});
test('a shared prefix with a distinct full secret is eligible for new issuance',async()=>{
  const db=databaseFixture();const first=sampleKeyRecord();const second=sampleKeyRecord(first.record.prefix);insertSeed(db.connection,first.record);
  const crypto=new NodeKeyCryptography();const material={apiKey:second.apiKey,prefix:second.record.prefix,salt:second.record.salt,keyHash:second.record.keyHash};
  try{const service=new CreationService(new SqliteCreationRepository(db.connection),{generate:()=>({ok:true,value:material}),prefix:crypto.prefix.bind(crypto),hash:crypto.hash.bind(crypto),verify:crypto.verify.bind(crypto)},new SqliteUnitOfWork(db.connection),new DecisionGate(),randomUUID);
    expect((await service.create(scope,db.attempt().attemptId,requestFixture(2000).context)).ok).toBe(true);
    expect(db.connection.prepare('SELECT count(*) AS n FROM api_keys WHERE prefix=?').get(first.record.prefix)?.n).toBe(2);
  }finally{db.cleanup();}
});
test('corrupt history, invalid identifiers, expired candidate loops and missing audit receipt all prevent issuance',async()=>{
  const db=databaseFixture();try{
    const repo=new SqliteCreationRepository(db.connection);const crypto=new NodeKeyCryptography();const work=new SqliteUnitOfWork(db.connection);const f=requestFixture(2000);
    const invalidId=new CreationService(repo,crypto,work,new DecisionGate(),()=> 'invalid');
    expect((await invalidId.create(scope,db.attempt().attemptId,f.context)).ok).toBe(false);
    const seed=sampleKeyRecord();const repeated={generate:()=>{f.clock.advance(1000,false);return {ok:true as const,value:{apiKey:seed.apiKey,prefix:seed.record.prefix,salt:seed.record.salt,keyHash:seed.record.keyHash}};},prefix:crypto.prefix.bind(crypto),hash:crypto.hash.bind(crypto),verify:crypto.verify.bind(crypto)};
    const history={retainedCandidates:()=>({ok:true as const,value:[seed.record]}),insert:repo.insert.bind(repo)};
    expect((await new CreationService(history,repeated,work,new DecisionGate(),randomUUID).create(scope,db.attempt().attemptId,f.context)).ok).toBe(false);
    const corrupt={...history,retainedCandidates:()=>({ok:true as const,value:[{...seed.record,salt:Buffer.alloc(0)}]})};
    expect((await new CreationService(corrupt,repeated,work,new DecisionGate(),randomUUID).create(scope,db.attempt().attemptId,requestFixture(2000).context)).ok).toBe(false);
    const audited=new CreationService(repo,crypto,work,new DecisionGate(),randomUUID,new ManagementAttempts(db.events,randomUUID,()=>{}));
    expect((await audited.create(scope,db.attempt().attemptId,requestFixture(2000).context)).ok).toBe(false);
    expect(db.connection.prepare('SELECT count(*) AS n FROM api_keys').get()?.n).toBe(0);
  }finally{db.cleanup();}
});
