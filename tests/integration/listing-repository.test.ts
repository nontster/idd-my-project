import { openDatabase } from '../../src/adapters/sqlite/database';
import { expect,test } from '@jest/globals';
import { randomUUID } from 'node:crypto';
import { SqliteListingRepository } from '../../src/adapters/sqlite/listing-repository';
import { databaseFixture } from '../support/database-fixture';
import { sampleKeyRecord,insertSeed } from '../support/key-record-fixtures';
test('complete scoped listing retains both statuses and duplicate prefixes without a hidden page limit or new audit stream',()=>{
  const db=databaseFixture();const a=sampleKeyRecord();const b=sampleKeyRecord(a.record.prefix);try{
    db.connection.exec('BEGIN IMMEDIATE');insertSeed(db.connection,a.record);insertSeed(db.connection,{...b.record,status:'revoked',generation:2,revokedAt:new Date().toISOString(),revocationAttemptId:randomUUID()});
    for(let index=0;index<1000;index++)insertSeed(db.connection,sampleKeyRecord().record);insertSeed(db.connection,{...sampleKeyRecord().record,tenantId:'tenant-b'});db.connection.exec('COMMIT');
    const before=db.connection.prepare('SELECT count(*) AS n FROM security_attempts').get()?.n;const repo=new SqliteListingRepository(db.connection);const result=repo.list('tenant-a');expect(result.ok).toBe(true);
    if(result.ok){expect(result.value.length).toBe(1002);expect(result.value.filter(row=>row.prefix===a.record.prefix).length).toBe(2);for(const row of result.value){expect(row.tenantId).toBe('tenant-a');expect(Object.keys(row).sort()).toEqual(['createdAt','keyId','prefix','revokedAt','status','tenantId']);}}
    const empty=repo.list('tenant-empty');expect(empty.ok&&empty.value.length===0).toBe(true);expect(db.connection.prepare('SELECT count(*) AS n FROM security_attempts').get()?.n).toBe(before);
    db.close();expect(repo.list('tenant-a').ok).toBe(false);
  }finally{db.cleanup();}
});
test('one corrupt retained row makes the complete result unavailable, never a partial success',()=>{
  const db=databaseFixture();try{
    insertSeed(db.connection,sampleKeyRecord().record);db.connection.exec('PRAGMA ignore_check_constraints=ON');insertSeed(db.connection,{...sampleKeyRecord().record,salt:Buffer.alloc(0)});db.connection.exec('PRAGMA ignore_check_constraints=OFF');
    expect(new SqliteListingRepository(db.connection).list('tenant-a').ok).toBe(false);
  }finally{db.cleanup();}
});

test('opening a supported existing authority adds the planned index without changing retained records, events or scoped listing order',()=>{
  const db=databaseFixture();const active=sampleKeyRecord();const revoked=sampleKeyRecord(active.record.prefix);const foreign=sampleKeyRecord();let opened:ReturnType<typeof openDatabase>|undefined;
  try{
    insertSeed(db.connection,{...active.record,keyId:'00000000-0000-4000-8000-000000000002',createdAt:'2020-01-01T00:00:00.000Z'});
    insertSeed(db.connection,{...revoked.record,keyId:'00000000-0000-4000-8000-000000000001',createdAt:'2021-01-01T00:00:00.000Z',status:'revoked',generation:2,revokedAt:'2022-01-01T00:00:00.000Z',revocationAttemptId:randomUUID()});
    insertSeed(db.connection,{...foreign.record,tenantId:'tenant-b'});
    // A version1 store from before this additive index remains supported.
    db.connection.exec('DROP INDEX IF EXISTS keys_tenant_created_at');
    const keys=JSON.stringify(db.connection.prepare('SELECT * FROM api_keys ORDER BY keyId').all());const events=JSON.stringify(db.connection.prepare('SELECT * FROM security_attempts ORDER BY attemptId').all());db.close();
    opened=openDatabase({path:db.path});expect(opened.ok).toBe(true);if(!opened.ok)return;
    const connection=opened.value.connection;
    expect(connection.prepare('PRAGMA index_info(keys_tenant_created_at)').all().map(row=>row.name)).toEqual(['tenantId','createdAt','keyId']);
    expect(connection.prepare('PRAGMA user_version').get()?.user_version).toBe(1);
    expect(JSON.stringify(connection.prepare('SELECT * FROM api_keys ORDER BY keyId').all())===keys).toBe(true);
    expect(JSON.stringify(connection.prepare('SELECT * FROM security_attempts ORDER BY attemptId').all())===events).toBe(true);
    const listed=new SqliteListingRepository(connection).list('tenant-a');expect(listed.ok).toBe(true);
    if(listed.ok){expect(listed.value.map(row=>row.keyId)).toEqual(['00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000002']);expect(listed.value.map(row=>row.status)).toEqual(['revoked','active']);expect(listed.value.every(row=>row.tenantId==='tenant-a'&&row.prefix===active.record.prefix)).toBe(true);expect(JSON.stringify(listed.value).includes(active.apiKey)||JSON.stringify(listed.value).includes(revoked.apiKey)).toBe(false);}
  }finally{if(opened?.ok)opened.value.close();db.cleanup();}
});
