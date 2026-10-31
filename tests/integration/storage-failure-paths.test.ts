import { storageSettings, unsafeSetting } from '../support/storage-setting-faults';
import { join,dirname } from 'node:path';
import { afterEach,expect,jest,test } from '@jest/globals';
import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { openDatabase } from '../../src/adapters/sqlite/database';
import { recover } from '../../src/adapters/sqlite/recovery';
import { SqliteRevocationRepository } from '../../src/adapters/sqlite/revocation-repository';
import { SqliteCreationRepository } from '../../src/adapters/sqlite/creation-repository';
import { SqliteUnitOfWork } from '../../src/adapters/sqlite/unit-of-work';
import { databaseFixture } from '../support/database-fixture';
import { sampleKeyRecord,insertSeed } from '../support/key-record-fixtures';
import { manualClock } from '../support/identity-fixtures';
afterEach(()=>{jest.restoreAllMocks();});
test('unsupported native capability reports and unsafe schema versions refuse opening, including close failure',()=>{
  for(const version of ['2.99.0','3.50.9','3.51.2']){
    const db=databaseFixture();db.close();const prepare=DatabaseSync.prototype.prepare;
    const spy=jest.spyOn(DatabaseSync.prototype,'prepare').mockImplementation(function(this:DatabaseSync,sql:string){const statement=prepare.call(this,sql);if(sql.includes('sqlite_version'))jest.spyOn(statement,'get').mockReturnValueOnce({version});return statement;});
    try{expect(openDatabase({path:db.path}).ok).toBe(false);}finally{spy.mockRestore();jest.restoreAllMocks();db.cleanup();}
  }
  const db=databaseFixture();db.connection.exec('PRAGMA user_version=99');db.close();const close=DatabaseSync.prototype.close;jest.spyOn(DatabaseSync.prototype,'close').mockImplementationOnce(function(this:DatabaseSync){close.call(this);throw new Error('close acknowledgment unavailable');});
  try{expect(openDatabase({path:db.path}).ok).toBe(false);}finally{db.cleanup();}
});
test('unit of work rejects asynchronous/nested callbacks without executing them or leaving a transaction',async()=>{
  const db=databaseFixture();const work=new SqliteUnitOfWork(db.connection);let entered=0;
  try{
    expect(work.run(async()=>{entered++;}).kind).toBe('not-committed');expect(entered).toBe(0);
    db.connection.exec('BEGIN IMMEDIATE');expect(work.run(()=>{entered++;}).kind).toBe('not-committed');db.connection.exec('ROLLBACK');expect(entered).toBe(0);
    expect(work.run(()=>Promise.reject(new Error('async mutation prohibited'))).kind).toBe('not-committed');await Promise.resolve();expect(db.connection.isTransaction).toBe(false);
  }finally{db.cleanup();}
});
test('revocation repository fails closed on initial and post-update read loss using real SQL/rollback',()=>{
  const db=databaseFixture();const seed=sampleKeyRecord();insertSeed(db.connection,seed.record);const attempt=db.attempt('revoke');let reads=0;
  class LostRead extends SqliteRevocationRepository{override current(keyId:string,tenantId:string){if(++reads===2)db.close();return super.current(keyId,tenantId);}}
  try{
    const result=new SqliteUnitOfWork(db.connection).run(()=>new LostRead(db.connection).revoke(seed.record.keyId,'tenant-a',new Date().toISOString(),attempt.attemptId));expect(result.kind==='committed').toBe(false);
    expect(()=>new SqliteRevocationRepository(db.connection).revoke(seed.record.keyId,'tenant-a',new Date().toISOString(),attempt.attemptId)).toThrow('Scoped state unavailable');
  }finally{db.cleanup();}
});
test('audit value/finalization guards refuse invalid transitions and corrupt pending events',()=>{
  const db=databaseFixture();const pending=db.attempt();try{
    expect(db.events.finalize(pending).ok).toBe(false);
    db.connection.exec('PRAGMA ignore_check_constraints=ON');db.connection.prepare("UPDATE security_attempts SET callerId='' WHERE attemptId=?").run(pending.attemptId);db.connection.exec('PRAGMA ignore_check_constraints=OFF');
    expect(db.events.unfinished().ok).toBe(false);expect(recover(db.connection,db.events,manualClock()).ok).toBe(false);
  }finally{db.cleanup();}
});
test('recovery rejects active transactions, invalid flags, unavailable reads, finalization failure and clock loss',()=>{
  const db=databaseFixture();const clock=manualClock();try{
    db.connection.exec('BEGIN IMMEDIATE');expect(recover(db.connection,db.events,clock).ok).toBe(false);db.connection.exec('ROLLBACK');
    expect(recover(db.connection,{...db.events,begin:db.events.begin.bind(db.events),finalize:db.events.finalize.bind(db.events),unfinished:()=>({ok:false,code:'UNAVAILABLE'})},clock).ok).toBe(false);
    const orphan=db.attempt('revoke');expect(recover(db.connection,db.events,clock).ok).toBe(true);expect(db.connection.prepare('SELECT errorCode FROM security_attempts WHERE attemptId=?').get(orphan.attemptId)?.errorCode).toBe('E-09');
    db.attempt();expect(recover(db.connection,{begin:db.events.begin.bind(db.events),unfinished:db.events.unfinished.bind(db.events),finalize:()=>({ok:false,code:'UNAVAILABLE'})},clock).ok).toBe(false);
    expect(recover(db.connection,db.events,{...clock,utcNow:()=>{throw new Error('clock unavailable');}}).ok).toBe(false);
    db.connection.exec('PRAGMA ignore_check_constraints=ON');db.connection.prepare('UPDATE security_attempts SET finalized=2 WHERE finalized=0').run();db.connection.exec('PRAGMA ignore_check_constraints=OFF');expect(recover(db.connection,db.events,clock).ok).toBe(false);
  }finally{db.cleanup();}
});
test('recovery refuses ambiguous first-revoke correlation and a retained row corrupted after the initial scan',()=>{
  const db=databaseFixture();const a=sampleKeyRecord();const b=sampleKeyRecord();insertSeed(db.connection,a.record);insertSeed(db.connection,b.record);const attempt=db.attempt('revoke');
  try{
    db.connection.prepare("UPDATE api_keys SET status='revoked',generation=2,revokedAt=?,revocationAttemptId=?").run(new Date().toISOString(),attempt.attemptId);expect(recover(db.connection,db.events,manualClock()).ok).toBe(false);
  }finally{db.cleanup();}
  const next=databaseFixture();const pending=next.attempt();const seed=sampleKeyRecord();new SqliteCreationRepository(next.connection).insert({...seed.record,creationAttemptId:pending.attemptId});
  try{
    const events={begin:next.events.begin.bind(next.events),finalize:next.events.finalize.bind(next.events),unfinished:()=>{
      const result=next.events.unfinished();next.connection.exec('PRAGMA ignore_check_constraints=ON; DROP TRIGGER immutable_key');next.connection.prepare('UPDATE api_keys SET salt=? WHERE keyId=?').run(Buffer.alloc(0),seed.record.keyId);return result;
    }};
    expect(recover(next.connection,events,manualClock()).ok).toBe(false);
  }finally{next.cleanup();}
});

test.each(storageSettings.flatMap(setting=>[false,true].map(fresh=>({setting,fresh}))))('effective $setting.pragma mismatch closes and refuses fresh=$fresh storage',({setting,fresh})=>{
  const db=databaseFixture();db.close();const fault=unsafeSetting(setting);const close=jest.spyOn(DatabaseSync.prototype,'close');let opened:ReturnType<typeof openDatabase>|undefined;
  try{
    opened=openDatabase({path:fresh?join(dirname(db.path),'fresh.sqlite'):db.path,initializeFreshStore:fresh});
    expect(fault.observed()).toBe(true);expect(opened.ok).toBe(false);expect(close).toHaveBeenCalledTimes(1);
  }finally{fault.restore();if(opened?.ok)opened.value.close();jest.restoreAllMocks();db.cleanup();}
});
test.each(storageSettings.flatMap(setting=>['missing','malformed','unavailable'].map(mode=>({setting,mode}))))('$mode effective $setting.pragma readback refuses storage and releases its handle',({setting,mode})=>{
  const db=databaseFixture();db.close();const prepare=DatabaseSync.prototype.prepare;const close=jest.spyOn(DatabaseSync.prototype,'close');let opened:ReturnType<typeof openDatabase>|undefined;
  jest.spyOn(DatabaseSync.prototype,'prepare').mockImplementation(function(this:DatabaseSync,sql:string){
    const statement=prepare.call(this,sql);
    if(sql===`PRAGMA ${setting.pragma}`){
      const get=jest.spyOn(statement,'get');
      if(mode==='missing')get.mockReturnValueOnce(undefined);
      else if(mode==='malformed')get.mockReturnValueOnce({[setting.field]:null});
      else get.mockImplementationOnce(()=>{throw new Error('Effective setting unavailable');});
    }
    return statement;
  });
  try{opened=openDatabase({path:db.path});expect(opened.ok).toBe(false);expect(close).toHaveBeenCalledTimes(1);}
  finally{if(opened?.ok)opened.value.close();jest.restoreAllMocks();db.cleanup();}
});

test.each([
  'CREATE INDEX keys_tenant_created_at ON api_keys(tenantId,keyId)',
  'CREATE UNIQUE INDEX keys_tenant_created_at ON api_keys(tenantId,createdAt,keyId)',
  "CREATE INDEX keys_tenant_created_at ON api_keys(tenantId,createdAt,keyId) WHERE status='active'",
])('a conflicting planned-index definition refuses authority opening',sql=>{
  const db=databaseFixture();let opened:ReturnType<typeof openDatabase>|undefined;
  try{
    db.connection.exec('DROP INDEX IF EXISTS keys_tenant_created_at');db.connection.exec(sql);db.close();
    const close=jest.spyOn(DatabaseSync.prototype,'close');opened=openDatabase({path:db.path});expect(opened.ok).toBe(false);expect(close).toHaveBeenCalledTimes(1);
  }finally{if(opened?.ok)opened.value.close();jest.restoreAllMocks();db.cleanup();}
});
test('native lock contention during additive index preparation refuses startup without retry or key/event changes',()=>{
  const db=databaseFixture();insertSeed(db.connection,sampleKeyRecord().record);db.connection.exec('DROP INDEX IF EXISTS keys_tenant_created_at');
  const keys=JSON.stringify(db.connection.prepare('SELECT * FROM api_keys').all());const events=JSON.stringify(db.connection.prepare('SELECT * FROM security_attempts').all());db.close();const locker=new DatabaseSync(db.path);let opened:ReturnType<typeof openDatabase>|undefined;
  try{
    locker.exec('BEGIN IMMEDIATE');opened=openDatabase({path:db.path});expect(opened.ok).toBe(false);
    expect(JSON.stringify(locker.prepare('SELECT * FROM api_keys').all())===keys).toBe(true);expect(JSON.stringify(locker.prepare('SELECT * FROM security_attempts').all())===events).toBe(true);
  }finally{if(opened?.ok)opened.value.close();locker.exec('ROLLBACK');locker.close();db.cleanup();}
});
