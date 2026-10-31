import { expect,test } from '@jest/globals';
import { publicMetadata } from '../../src/domain/key-metadata';
import { sampleKeyRecord } from '../support/key-record-fixtures';
test('safe metadata validates both lifecycle states while ignoring internal fields',()=>{
  const seed=sampleKeyRecord();
  for(const input of [seed.record,{...seed.record,status:'revoked',revokedAt:new Date().toISOString()}]){
    const result=publicMetadata(input);expect(result.ok).toBe(true);if(result.ok){expect(Object.keys(result.value).sort()).toEqual(['createdAt','keyId','prefix','revokedAt','status','tenantId']);expect(Object.isFrozen(result.value)).toBe(true);expect(JSON.stringify(result.value).includes(seed.apiKey)).toBe(false);}
  }
});
test('malformed lifecycle or metadata values cannot become part of a successful collection',()=>{
  const seed=sampleKeyRecord();for(const input of [null,[],{}, {...seed.record,keyId:'invalid'}, {...seed.record,tenantId:''}, {...seed.record,prefix:'bad'}, {...seed.record,prefix:null}, {...seed.record,createdAt:'bad'}, {...seed.record,status:'unknown'}, {...seed.record,revokedAt:new Date().toISOString()}, {...seed.record,status:'revoked',revokedAt:null}, {...seed.record,get prefix(){throw new Error('invalid accessor');}}])expect(publicMetadata(input).ok).toBe(false);
});
