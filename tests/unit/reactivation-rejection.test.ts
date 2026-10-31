import { expect,test } from '@jest/globals';
import { randomUUID } from 'node:crypto';
import { ReactivationRejection } from '../../src/services/reactivation-rejection';
import { sampleKeyRecord } from '../support/key-record-fixtures';
import { requestFixture } from '../support/identity-fixtures';
const scope={principal:{kind:'developer',subjectId:'developer-a',trustedService:false},tenantId:'tenant-a'} as const;
test('reactivation rejection handles both known states and unavailable lookup without a mutation capability',()=>{
  const seed=sampleKeyRecord();
  for(const [value,code] of [[{...seed.record,status:'revoked' as const},'E-13'],[seed.record,'E-15'],[null,'E-12']] as const){
    const result=new ReactivationRejection({find:()=>({ok:true,value})}).reject(scope,seed.record.keyId,requestFixture(2000).context);expect(result.ok?'SUCCESS':result.code).toBe(code);
  }
  for(const find of [()=>({ok:false as const,code:'UNAVAILABLE'}),()=>{throw new Error('lookup unavailable');}])expect((new ReactivationRejection({find}).reject(scope,randomUUID(),requestFixture(2000).context) as {code:string}).code).toBe('OPERATION_UNAVAILABLE');
  const f=requestFixture(2000);f.controller.abort();expect((new ReactivationRejection({find:()=>({ok:true,value:seed.record})}).reject(scope,seed.record.keyId,f.context) as {code:string}).code).toBe('OPERATION_UNAVAILABLE');
});
