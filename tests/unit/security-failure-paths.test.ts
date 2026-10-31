import { expect,test } from '@jest/globals';
import { randomUUID } from 'node:crypto';
import { safeLogger } from '../../src/adapters/logging/safe-logger';
import { requestScope,withinContext,isActive } from '../../src/domain/request-context';
import { ListingService } from '../../src/services/listing';
import { ReactivationRejection } from '../../src/services/reactivation-rejection';
import { RevocationService } from '../../src/services/revocation';
import { AuthenticationService } from '../../src/services/authentication';
import { RequestCoordinator,ManagementAttempts } from '../../src/services/management-attempt';
import { SqliteRevocationRepository } from '../../src/adapters/sqlite/revocation-repository';
import { SqliteUnitOfWork } from '../../src/adapters/sqlite/unit-of-work';
import type { Outcome } from '../../src/domain/outcome';
import type { KeyMetadata } from '../../src/domain/key-metadata';
import { DecisionGate } from '../../src/services/decision-gate';
import { manualClock,requestFixture,createIdentityFixtures } from '../support/identity-fixtures';
import { databaseFixture } from '../support/database-fixture';
import { sampleKeyRecord,insertSeed } from '../support/key-record-fixtures';
const scope={principal:{kind:'developer',subjectId:'developer-a',trustedService:false},tenantId:'tenant-a'} as const;
test('allowlisted logs include safe UUIDs but no credential/body/stack fields, including sink failure',()=>{
  const secret=randomUUID();const output:Record<string,unknown>[]=[];const log=safeLogger(value=>output.push(value));const requestId=randomUUID();
  const event={operation:'create',requestId,status:201,code:'E-08',authorization:secret,body:{apiKey:secret},stack:secret};expect(log(event)).toBe(true);expect(Object.keys(output[0]).sort()).toEqual(['code','operation','requestId','status']);expect(JSON.stringify(output).includes(secret)).toBe(false);
  log({operation:'unknown',requestId:'invalid',status:0,code:'unknown'});expect(output[1]).toEqual({});expect(safeLogger(()=>{throw new Error(secret);})({operation:'revoke',status:503})).toBe(false);
});
test('late cancelled alarms, scheduling faults and unusable clocks cannot revive a request',async()=>{
  const manual=manualClock();let callback=()=>{};const clock={...manual,schedule(_ms:number,action:()=>void){callback=action;return ()=>{};}};
  const scope=requestScope(clock,200,100);expect(scope.ok).toBe(true);if(scope.ok){scope.value.dispose();callback();expect(isActive(scope.value.context)).toBe(false);}
  const scheduling={...manual,schedule():never{throw new Error('timer unavailable');}};
  const failed=requestScope(scheduling,200,100);expect(failed.ok&&failed.value.context.signal.aborted).toBe(true);
  expect(requestScope({...manual,monotonicNow():never{throw new Error('clock unavailable');}},200,100).ok).toBe(false);
  const f=requestFixture();expect((await withinContext({...f.context,clock:scheduling},()=>true)).ok).toBe(false);
  for(const budget of [0,Number.NaN])expect((await withinContext({...f.context,identityTimeoutMs:budget},()=>true,true)).ok).toBe(false);
});
test('an already exhausted identity window never starts a third call',async()=>{
  const f=requestFixture();expect((await withinContext(f.context,()=>{f.clock.advance(99,false);return true;},true)).ok).toBe(true);
  f.clock.advance(1,false);let calls=0;expect((await withinContext(f.context,()=>{calls++;return true;},true)).ok).toBe(false);expect(calls).toBe(0);
});
test('clock failure or expiry between entry, timer arming and final comparison fails closed',async()=>{
  for(const failureAt of [2,6,7]){
    const f=requestFixture();let reads=0;const clock={...f.clock,monotonicNow(){if(++reads===failureAt)throw new Error('clock unavailable');return 0;}};
    expect((await withinContext({...f.context,clock},()=>true)).ok).toBe(false);
  }
  const f=requestFixture();let reads=0;let invoked=false;const clock={...f.clock,monotonicNow(){return ++reads<3?0:200;}};
  expect((await withinContext({...f.context,clock},()=>{invoked=true;return true;})).ok).toBe(false);expect(invoked).toBe(false);
});
test('malformed repository payloads cannot become metadata or reactivation success',async()=>{
  expect((await new ListingService({list:()=>undefined as unknown as Outcome<readonly KeyMetadata[]>}).list(scope,requestFixture(2000).context)).ok).toBe(false);
  const seed=sampleKeyRecord();expect((new ReactivationRejection({find:()=>({ok:true,value:{...seed.record,status:'unknown'} as unknown as KeyMetadata})}).reject(scope,seed.record.keyId,requestFixture(2000).context) as {code:string}).code).toBe('OPERATION_UNAVAILABLE');
});
test('validation coordinator keeps its inner service-trust defense when invoked with a verified developer principal',async()=>{
  const ids=createIdentityFixtures();const f=requestFixture();const auth=new AuthenticationService(ids.verifier);const caller=await auth.caller(ids.developerToken,'management',f.context);expect(caller.ok).toBe(true);if(!caller.ok)return;
  const result=await new RequestCoordinator(auth).execute('validate',{session:{principal:caller.value},context:f.context,body:{apiKey:sampleKeyRecord().apiKey,expectedTenantId:'tenant-a',requestId:randomUUID()}});expect(result.ok?'SUCCESS':result.code).toBe('E-16');
});
test('revocation rejects missing audit receipt, invalid attempt IDs, pre-expiry and false terminal repository states',async()=>{
  const db=databaseFixture();const seed=sampleKeyRecord();insertSeed(db.connection,seed.record);const work=new SqliteUnitOfWork(db.connection);const repo=new SqliteRevocationRepository(db.connection);
  try{
    const audit=new ManagementAttempts(db.events,randomUUID,()=>{});const service=new RevocationService(repo,work,new DecisionGate(),audit);
    expect((await service.revoke(scope,seed.record.keyId,db.attempt('revoke').attemptId,requestFixture(2000).context)).ok).toBe(false);
    const plain=new RevocationService(repo,work,new DecisionGate());expect((await plain.revoke(scope,seed.record.keyId,'invalid',requestFixture(2000).context)).ok).toBe(false);
    const expired=requestFixture(2000);expired.clock.advance(2000,false);expect((await plain.revoke(scope,seed.record.keyId,db.attempt('revoke').attemptId,expired.context)).ok).toBe(false);
    class WrongState extends SqliteRevocationRepository{override revoke(){return seed.record;}}
    expect((await new RevocationService(new WrongState(db.connection),work,new DecisionGate()).revoke(scope,seed.record.keyId,db.attempt('revoke').attemptId,requestFixture(2000).context)).ok).toBe(false);
    expect(db.connection.prepare('SELECT status FROM api_keys WHERE keyId=?').get(seed.record.keyId)?.status).toBe('active');
  }finally{db.cleanup();}
});
test('an emergency sink failure stays fail-closed, redacted and latched without retrying the sink or new receipt writes',()=>{
  const db=databaseFixture();db.close();let emergencies=0;let escaped=false;const sentinel=randomUUID();const audit=new ManagementAttempts(db.events,randomUUID,()=>{emergencies++;throw new Error(sentinel);});
  try{
    try{const result=audit.begin('create',requestFixture(2000).context);expect(result.ok).toBe(false);}catch{escaped=true;}
    expect(escaped).toBe(false);expect(audit.begin('create',requestFixture(2000).context).ok).toBe(false);expect(emergencies).toBe(1);
  }finally{db.cleanup();}
});
