import { expect,test } from '@jest/globals';
import { randomUUID } from 'node:crypto';
import { SqliteValidationRepository } from '../../src/adapters/sqlite/validation-repository';
import { databaseFixture } from '../support/database-fixture';
import { sampleKeyRecord,insertSeed } from '../support/key-record-fixtures';
test('candidate reads are scoped and final current reads observe real changes without an old snapshot',()=>{
  const db=databaseFixture();const a=sampleKeyRecord();const b=sampleKeyRecord(a.record.prefix);const c=sampleKeyRecord(a.record.prefix);
  try{
    insertSeed(db.connection,a.record);insertSeed(db.connection,b.record);insertSeed(db.connection,{...c.record,tenantId:'tenant-b'});
    const repo=new SqliteValidationRepository(db.connection);const result=repo.candidates('tenant-a',a.record.prefix);expect(result.ok).toBe(true);if(result.ok)expect(result.value.length).toBe(2);
    expect(db.connection.isTransaction).toBe(false);
    const attempt=db.attempt('revoke');db.connection.prepare("UPDATE api_keys SET status='revoked',generation=2,revokedAt=?,revocationAttemptId=? WHERE keyId=?").run(new Date().toISOString(),attempt.attemptId,a.record.keyId);
    const current=repo.current(a.record.keyId,'tenant-a');expect(current.ok&&current.value?.status==='revoked').toBe(true);
    const foreign=repo.current(c.record.keyId,'tenant-a');expect(foreign.ok&&foreign.value===null).toBe(true);
    const absent=repo.current(randomUUID(),'tenant-a');expect(absent.ok&&absent.value===null).toBe(true);
    db.close();expect(repo.candidates('tenant-a',a.record.prefix).ok).toBe(false);expect(repo.current(a.record.keyId,'tenant-a').ok).toBe(false);
  }finally{db.cleanup();}
});
test('corrupt stored verification material is unavailable rather than a normal miss',()=>{
  const db=databaseFixture();const seed=sampleKeyRecord();try{
    db.connection.exec('PRAGMA ignore_check_constraints=ON');insertSeed(db.connection,{...seed.record,keyHash:Buffer.alloc(0)});db.connection.exec('PRAGMA ignore_check_constraints=OFF');
    const repo=new SqliteValidationRepository(db.connection);expect(repo.candidates('tenant-a',seed.record.prefix).ok).toBe(false);expect(repo.current(seed.record.keyId,'tenant-a').ok).toBe(false);
  }finally{db.cleanup();}
});
