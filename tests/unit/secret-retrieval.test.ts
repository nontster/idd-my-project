import { expect,test } from '@jest/globals';
import { randomUUID } from 'node:crypto';
import { SecretRetrieval } from '../../src/services/secret-retrieval';
import { sampleKeyRecord } from '../support/key-record-fixtures';
import { requestFixture } from '../support/identity-fixtures';
const scope={principal:{kind:'developer',subjectId:'developer-a',trustedService:false},tenantId:'tenant-a'} as const;
test('secret rejection never returns metadata or credentials and distinguishes only scoped existence',()=>{
  const key=sampleKeyRecord();
  for(const [lookup,code] of [[{ok:true,value:key.record},'E-11'],[{ok:true,value:null},'E-12'],[{ok:false,code:'UNAVAILABLE'},'OPERATION_UNAVAILABLE']] as const){
    const r=new SecretRetrieval({find:()=>lookup}).reject(scope,key.record.keyId,requestFixture(2000).context);
    expect(r.ok?'SUCCESS':r.code).toBe(code);expect(Object.keys(r).sort()).toEqual(['code','ok']);
  }
  let calls=0;const f=requestFixture(2000);const service=new SecretRetrieval({find:()=>{calls++;return {ok:true,value:key.record};}});
  expect(service.reject(scope,'invalid',f.context).ok).toBe(false);expect(calls).toBe(0);
  f.controller.abort();expect((service.reject(scope,randomUUID(),f.context) as {code:string}).code).toBe('OPERATION_UNAVAILABLE');expect(calls).toBe(0);
  expect(new SecretRetrieval({find:()=>{throw new Error('lookup unavailable');}}).reject(scope,randomUUID(),requestFixture(2000).context).ok).toBe(false);
});
