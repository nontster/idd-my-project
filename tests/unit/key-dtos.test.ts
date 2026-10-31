import { expect,test } from '@jest/globals';
import { createdKey,metadata } from '../../src/domain/key-dtos';
import { sampleKeyRecord } from '../support/key-record-fixtures';
test('metadata projection never spreads salt, digest, attempt or unexpected raw-secret properties',()=>{
  const {record,apiKey}=sampleKeyRecord();const result=metadata({...record,apiKey} as typeof record);
  expect(Object.keys(result).sort()).toEqual(['createdAt','keyId','prefix','revokedAt','status','tenantId']);
  expect(result.keyId===record.keyId&&result.prefix===record.prefix).toBe(true);expect(JSON.stringify(result).includes(apiKey)).toBe(false);
});
test('creation adds exactly the transient secret to explicit public metadata',()=>{
  const {record,apiKey}=sampleKeyRecord();const result=createdKey(record,apiKey);
  expect(Object.keys(result).sort()).toEqual(['apiKey','createdAt','keyId','prefix','revokedAt','status','tenantId']);
  expect(result.apiKey===apiKey).toBe(true);expect(result.status).toBe('active');
});
