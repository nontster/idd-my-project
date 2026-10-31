import { expect,test } from '@jest/globals';
import { RevocationService } from '../../src/services/revocation';
import { SqliteRevocationRepository } from '../../src/adapters/sqlite/revocation-repository';
import { SqliteUnitOfWork } from '../../src/adapters/sqlite/unit-of-work';
import { DecisionGate } from '../../src/services/decision-gate';
import { databaseFixture } from '../support/database-fixture';
import { sampleKeyRecord,insertSeed } from '../support/key-record-fixtures';
import { requestFixture } from '../support/identity-fixtures';
const scope={principal:{kind:'developer',subjectId:'developer-colleague',trustedService:false},tenantId:'tenant-a'} as const;
test('same-Tenant non-creator can revoke once and repeat preserves terminal metadata',async()=>{
  const db=databaseFixture();const seed=sampleKeyRecord();insertSeed(db.connection,seed.record);const service=new RevocationService(new SqliteRevocationRepository(db.connection),new SqliteUnitOfWork(db.connection),new DecisionGate());
  try{
    const first=await service.revoke(scope,seed.record.keyId,db.attempt('revoke').attemptId,requestFixture(2000).context);expect(first.ok).toBe(true);
    const repeated=await service.revoke(scope,seed.record.keyId,db.attempt('revoke').attemptId,requestFixture(2000).context);expect(repeated).toEqual(first);
    const foreign=await service.revoke({...scope,tenantId:'tenant-b'},seed.record.keyId,db.attempt('revoke').attemptId,requestFixture(2000).context);expect(foreign.ok?'SUCCESS':foreign.code).toBe('E-12');
  }finally{db.cleanup();}
});
test('expiry or cancellation after a real durable revoke never restores the active key or retries',async()=>{
  for(const mode of ['expiry','cancel'] as const){
    const db=databaseFixture();const seed=sampleKeyRecord();insertSeed(db.connection,seed.record);const f=requestFixture(2000);let entries=0;const work=new SqliteUnitOfWork(db.connection);
    const controlled={run<T>(callback:()=>T){const outcome=work.run(callback);entries++;if(mode==='expiry')f.clock.advance(2000,false);else f.controller.abort();return outcome;}};
    try{
      const service=new RevocationService(new SqliteRevocationRepository(db.connection),controlled,new DecisionGate());const r=await service.revoke(scope,seed.record.keyId,db.attempt('revoke').attemptId,f.context);expect(r.ok?'SUCCESS':r.code).toBe('E-09');expect(entries).toBe(1);
      expect(db.connection.prepare('SELECT status,generation FROM api_keys WHERE keyId=?').get(seed.record.keyId)?.status).toBe('revoked');
    }finally{db.cleanup();}
  }
});
