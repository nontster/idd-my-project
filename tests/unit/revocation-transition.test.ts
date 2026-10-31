import { expect,test } from '@jest/globals';
import { randomUUID } from 'node:crypto';
import { RevocationService } from '../../src/services/revocation';
import { SqliteRevocationRepository } from '../../src/adapters/sqlite/revocation-repository';
import { SqliteUnitOfWork } from '../../src/adapters/sqlite/unit-of-work';
import { DecisionGate } from '../../src/services/decision-gate';
import { databaseFixture } from '../support/database-fixture';
import { sampleKeyRecord,insertSeed } from '../support/key-record-fixtures';
import { requestFixture } from '../support/identity-fixtures';
import { ControlledGate } from '../support/controlled-gate';
const scope={principal:{kind:'developer',subjectId:'colleague',trustedService:false},tenantId:'tenant-a'} as const;
test('missing, invalid, unknown and foreign identifiers are safe and do not mutate valid records',async()=>{
  const db=databaseFixture();const seed=sampleKeyRecord();insertSeed(db.connection,seed.record);const service=new RevocationService(new SqliteRevocationRepository(db.connection),new SqliteUnitOfWork(db.connection),new DecisionGate());
  try{
    for(const id of [undefined,null,'']){const r=await service.revoke(scope,id,db.attempt('revoke').attemptId,requestFixture(2000).context);expect(r.ok?'SUCCESS':r.code).toBe('E-05');}
    for(const id of ['invalid',7,randomUUID()]){const r=await service.revoke(scope,id,db.attempt('revoke').attemptId,requestFixture(2000).context);expect(r.ok?'SUCCESS':r.code).toBe('E-12');}
    expect((await service.revoke({...scope,principal:{kind:'service',subjectId:'service',trustedService:true}},seed.record.keyId,db.attempt('revoke').attemptId,requestFixture(2000).context) as {code:string}).code).toBe('E-04');
    expect(db.connection.prepare('SELECT status FROM api_keys WHERE keyId=?').get(seed.record.keyId)?.status).toBe('active');
  }finally{db.cleanup();}
});
test('an expired queued revoke stops waiting and its eventual gate callback never mutates the key',async()=>{
  const db=databaseFixture();const seed=sampleKeyRecord();insertSeed(db.connection,seed.record);const f=requestFixture(2000);const gate=new ControlledGate();const pause=gate.arm();
  const service=new RevocationService(new SqliteRevocationRepository(db.connection),new SqliteUnitOfWork(db.connection),gate);
  try{
    const pending=service.revoke(scope,seed.record.keyId,db.attempt('revoke').attemptId,f.context);
    const first=await Promise.race([pause.entered.then(()=>'queued'),pending.then(()=>'result')]);expect(first).toBe('queued');f.clock.advance(2000);
    const r=await pending;expect(r.ok?'SUCCESS':r.code).toBe('E-09');expect(db.connection.prepare('SELECT status FROM api_keys WHERE keyId=?').get(seed.record.keyId)?.status).toBe('active');
    pause.release();await new Promise<void>(done=>setImmediate(done));expect(db.connection.prepare('SELECT status FROM api_keys WHERE keyId=?').get(seed.record.keyId)?.status).toBe('active');
  }finally{pause.release();db.cleanup();}
});
test('unavailable or uncertain transaction outcomes never acknowledge revocation',async()=>{
  const db=databaseFixture();const seed=sampleKeyRecord();insertSeed(db.connection,seed.record);
  try{for(const kind of ['not-committed','uncertain'] as const){let entries=0;const service=new RevocationService(new SqliteRevocationRepository(db.connection),{run:()=>{entries++;return {kind};}},new DecisionGate());
    const r=await service.revoke(scope,seed.record.keyId,db.attempt('revoke').attemptId,requestFixture(2000).context);expect(r.ok?'SUCCESS':r.code).toBe('E-09');expect(entries).toBe(1);}
  }finally{db.cleanup();}
});
