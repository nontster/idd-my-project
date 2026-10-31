import { expect,test } from '@jest/globals';
import { SqliteRevocationRepository } from '../../src/adapters/sqlite/revocation-repository';
import { SqliteUnitOfWork } from '../../src/adapters/sqlite/unit-of-work';
import { databaseFixture } from '../support/database-fixture';
import { sampleKeyRecord,insertSeed } from '../support/key-record-fixtures';
test('real terminal transition is scoped, durable and preserves first metadata on repeat',()=>{
  const db=databaseFixture();const seed=sampleKeyRecord();insertSeed(db.connection,seed.record);const repo=new SqliteRevocationRepository(db.connection);const work=new SqliteUnitOfWork(db.connection);
  try{
    const baseline=repo.current(seed.record.keyId,'tenant-a');expect(baseline.ok&&baseline.value?.status==='active').toBe(true);
    const at=new Date().toISOString();const firstAttempt=db.attempt('revoke');const first=work.run(()=>repo.revoke(seed.record.keyId,'tenant-a',at,firstAttempt.attemptId));expect(first.kind).toBe('committed');
    const row=repo.current(seed.record.keyId,'tenant-a');expect(row.ok&&row.value?.generation===2&&row.value.revokedAt===at&&row.value.revocationAttemptId===firstAttempt.attemptId).toBe(true);
    const repeat=work.run(()=>repo.revoke(seed.record.keyId,'tenant-a','2030-01-01T00:00:00.000Z',db.attempt('revoke').attemptId));expect(repeat.kind).toBe('committed');
    const later=repo.current(seed.record.keyId,'tenant-a');expect(later.ok&&later.value?.revokedAt===at&&later.value.revocationAttemptId===firstAttempt.attemptId).toBe(true);
    const foreign=work.run(()=>repo.revoke(seed.record.keyId,'tenant-b',at,db.attempt('revoke').attemptId));expect(foreign.kind==='committed'&&foreign.value===null).toBe(true);
    db.close();expect(repo.current(seed.record.keyId,'tenant-a').ok).toBe(false);
  }finally{db.cleanup();}
});
