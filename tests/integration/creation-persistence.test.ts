import { expect,test } from '@jest/globals';
import { SqliteCreationRepository } from '../../src/adapters/sqlite/creation-repository';
import { databaseFixture } from '../support/database-fixture';
import { sampleKeyRecord,insertSeed } from '../support/key-record-fixtures';
import { randomUUID } from 'node:crypto';
import { SqliteScopedKeyLookup } from '../../src/adapters/sqlite/scoped-key-lookup';
test('historical candidates include revoked and foreign Tenant records with duplicate prefixes',()=>{
  const db=databaseFixture();const a=sampleKeyRecord();const b=sampleKeyRecord(a.record.prefix);try{
    insertSeed(db.connection,a.record);insertSeed(db.connection,{...b.record,tenantId:'tenant-b',status:'revoked',generation:2,revokedAt:new Date().toISOString(),revocationAttemptId:randomUUID()});
    const repo=new SqliteCreationRepository(db.connection);const result=repo.retainedCandidates(a.record.prefix);expect(result.ok).toBe(true);
    if(result.ok){expect(result.value.length).toBe(2);expect(result.value.some(r=>r.tenantId==='tenant-b'&&r.status==='revoked')).toBe(true);}
    const attempt=db.attempt();const c=sampleKeyRecord();repo.insert({...c.record,creationAttemptId:attempt.attemptId});
    expect(db.connection.prepare('SELECT count(*) AS n FROM api_keys').get()?.n).toBe(3);
    db.close();expect(repo.retainedCandidates(a.record.prefix).ok).toBe(false);
  }finally{db.cleanup();}
});
test('corrupt retained verifier rows and invalid insert values fail closed',()=>{
  const db=databaseFixture();const a=sampleKeyRecord();try{
    db.connection.exec('PRAGMA ignore_check_constraints=ON');insertSeed(db.connection,{...a.record,salt:Buffer.alloc(0)});db.connection.exec('PRAGMA ignore_check_constraints=OFF');
    const repo=new SqliteCreationRepository(db.connection);expect(repo.retainedCandidates(a.record.prefix).ok).toBe(false);
    const lookup=new SqliteScopedKeyLookup(db.connection);expect(lookup.find(a.record.keyId,a.record.tenantId).ok).toBe(false);
    expect(()=>repo.insert({...a.record,keyId:randomUUID(),keyHash:Buffer.alloc(0)})).toThrow('Invalid key record');
    db.close();expect(lookup.find(a.record.keyId,a.record.tenantId).ok).toBe(false);
  }finally{db.cleanup();}
});
