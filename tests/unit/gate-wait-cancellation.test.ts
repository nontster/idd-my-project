import { expect,test } from '@jest/globals';
import { randomUUID } from 'node:crypto';
import { CreationService } from '../../src/services/creation';
import { ValidationService } from '../../src/services/validation';
import { SqliteCreationRepository } from '../../src/adapters/sqlite/creation-repository';
import { SqliteValidationRepository } from '../../src/adapters/sqlite/validation-repository';
import { SqliteUnitOfWork } from '../../src/adapters/sqlite/unit-of-work';
import { NodeKeyCryptography } from '../../src/adapters/crypto/node-key-crypto';
import { databaseFixture } from '../support/database-fixture';
import { sampleKeyRecord,insertSeed } from '../support/key-record-fixtures';
import { requestFixture } from '../support/identity-fixtures';
import { ControlledGate } from '../support/controlled-gate';
test.each(['create','validate'] as const)('%s stops waiting for an expired/cancelled gate and never revives its late result',async operation=>{
  for(const mode of ['expiry','cancel'] as const){
    const db=databaseFixture();const seed=sampleKeyRecord();insertSeed(db.connection,seed.record);const gate=new ControlledGate();const crypto=new NodeKeyCryptography();
    const creation=new CreationService(new SqliteCreationRepository(db.connection),crypto,new SqliteUnitOfWork(db.connection),gate,randomUUID);
    const validation=new ValidationService(new SqliteValidationRepository(db.connection),crypto,gate,randomUUID);
    const developer={principal:{kind:'developer',subjectId:'developer-a',trustedService:false},tenantId:'tenant-a'} as const;
    const service={principal:{kind:'service',subjectId:'service',trustedService:true},tenantId:'tenant-a'} as const;
    const run=(context:ReturnType<typeof requestFixture>['context'])=>operation==='create'?creation.create(developer,db.attempt().attemptId,context):validation.validate(service,seed.apiKey,randomUUID(),context);
    const baseline=await run(requestFixture(operation==='create'?2000:200).context);expect(baseline.ok).toBe(true);const before=db.connection.prepare('SELECT count(*) AS n FROM api_keys').get()?.n;
    const pause=gate.arm();const f=requestFixture(operation==='create'?2000:200);const pending=run(f.context);
    try{
      await pause.entered;if(mode==='expiry')f.clock.advance(operation==='create'?2000:200);else f.controller.abort();
      // Promise settlement from cancellation must precede the next event-loop turn;
      // this observes stop-wait semantics, not a measured response-latency claim.
      const observed=await Promise.race([pending.then(()=>'settled'),new Promise<void>(done=>setImmediate(done)).then(()=>'waiting')]);
      expect(observed).toBe('settled');const result=await pending;expect(result.ok?'SUCCESS':result.code).toBe(operation==='create'?'E-08':'E-10');
      pause.release();await new Promise<void>(done=>setImmediate(done));expect(db.connection.prepare('SELECT count(*) AS n FROM api_keys').get()?.n).toBe(before);
    }finally{pause.release();await pending;db.cleanup();}
  }
});
